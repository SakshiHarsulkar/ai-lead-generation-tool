import { query } from './db.js';
import { stripNul } from './util.js';

const json = (value) => (value === null || value === undefined ? null : stripNul(JSON.stringify(value)));

/** Shape a DB row for the API. The raw page text stays server-side (only needed for re-scoring). */
export function toApiLead(row) {
  let enrichment = row.enrichment;
  if (enrichment) {
    const { text, ...rest } = enrichment;
    enrichment = rest;
  }
  return {
    id: row.id,
    company: row.company,
    domain: row.domain,
    status: row.status,
    score: row.score,
    tier: row.tier,
    enrichment,
    scoring: row.scoring,
    insight: row.insight,
    updatedAt: row.updated_at,
  };
}

export async function createBatch({ name, mode, icp, leads, duplicates, invalid }) {
  const [batch] = await query(
    `INSERT INTO batches (name, mode, icp, total, duplicates, invalid) VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
    [name, mode, json(icp), leads.length, duplicates, invalid],
  );
  // Bulk insert via unnest(): one round trip regardless of list size.
  await query(
    `INSERT INTO leads (batch_id, company, domain)
     SELECT $1, c, d FROM unnest($2::text[], $3::text[]) AS t(c, d)
     ON CONFLICT (batch_id, domain) DO NOTHING`,
    [batch.id, leads.map((l) => l.company), leads.map((l) => l.domain)],
  );
  return batch;
}

export async function listBatches() {
  return query(
    `SELECT b.id, b.name, b.mode, b.total, b.created_at,
            COUNT(l.id) FILTER (WHERE l.status IN ('done', 'failed'))::int AS processed,
            COUNT(l.id) FILTER (WHERE l.tier = 'Hot')::int AS hot
       FROM batches b LEFT JOIN leads l ON l.batch_id = b.id
      GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`,
  );
}

export async function getBatch(id) {
  const [batch] = await query(`SELECT * FROM batches WHERE id = $1`, [id]);
  return batch ?? null;
}

export async function updateBatchIcp(id, mode, icp) {
  await query(`UPDATE batches SET mode = $2, icp = $3::jsonb WHERE id = $1`, [id, mode, json(icp)]);
}

export async function deleteBatch(id) {
  await query(`DELETE FROM batches WHERE id = $1`, [id]);
}

export async function getLeads(batchId, ids = null) {
  const rows = ids
    ? await query(`SELECT * FROM leads WHERE batch_id = $1 AND id = ANY($2::int[]) ORDER BY score DESC NULLS LAST, id`, [batchId, ids])
    : await query(`SELECT * FROM leads WHERE batch_id = $1 ORDER BY score DESC NULLS LAST, id`, [batchId]);
  return rows;
}

/**
 * Atomically claim the next pending leads. SKIP LOCKED + a stale-claim timeout means two browser tabs
 * (or two server instances) never enrich the same lead, and a crashed request's leads get picked up again.
 */
export async function claimPending(batchId, limit) {
  return query(
    `UPDATE leads SET status = 'processing', claimed_at = now()
      WHERE id IN (
        SELECT id FROM leads
         WHERE batch_id = $1
           AND (status = 'pending' OR (status = 'processing' AND claimed_at < now() - interval '3 minutes'))
         ORDER BY id LIMIT $2
         FOR UPDATE SKIP LOCKED)
      RETURNING id, company, domain`,
    [batchId, limit],
  );
}

export async function countRemaining(batchId) {
  const [row] = await query(`SELECT COUNT(*)::int AS n FROM leads WHERE batch_id = $1 AND status IN ('pending', 'processing')`, [batchId]);
  return row.n;
}

export async function saveResult(id, { enrichment, scoring, insight }) {
  const [row] = await query(
    `UPDATE leads SET status = $2, enrichment = $3::jsonb, scoring = $4::jsonb, insight = $5::jsonb,
                      score = $6, tier = $7, claimed_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, enrichment.alive ? 'done' : 'failed', json(enrichment), json(scoring), json(insight), scoring.score, scoring.tier],
  );
  return row;
}

export async function saveScore(id, scoring) {
  await query(`UPDATE leads SET scoring = $2::jsonb, score = $3, tier = $4, updated_at = now() WHERE id = $1`, [id, json(scoring), scoring.score, scoring.tier]);
}

export async function resetLead(id) {
  const [row] = await query(
    `UPDATE leads SET status = 'pending', claimed_at = NULL, enrichment = NULL, scoring = NULL, insight = NULL, score = NULL, tier = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id],
  );
  return row ?? null;
}
