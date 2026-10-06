import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Crawler, purgeDomainCache } from './crawler.js';
import { dbKind } from './db.js';
import { enrichLeads } from './enricher.js';
import { exportLeads, EXPORT_FORMATS } from './exporter.js';
import { parseLeadInput } from './importer.js';
import { aiEnabled, generateInsight } from './insights.js';
import * as repo from './repository.js';
import { DEFAULT_ICP, MODES, scoreLead } from './scorer.js';
import { mapLimit } from './util.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanIcp(icp = {}) {
  const list = (v) =>
    (Array.isArray(v) ? v : String(v ?? '').split(','))
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 25);
  return { keywords: list(icp.keywords), exclude: list(icp.exclude) };
}

const cleanMode = (mode) => (mode in MODES ? mode : 'sales');

async function loadBatch(id) {
  const batch = await repo.getBatch(Number(id));
  if (!batch) throw new HttpError(404, 'List not found');
  return batch;
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true, db: dbKind, ai: aiEnabled(), model: aiEnabled() ? config.aiModel : null }));

  api.get('/meta', (_req, res) => res.json({ modes: MODES, defaultIcp: DEFAULT_ICP, exportFormats: EXPORT_FORMATS, ai: aiEnabled(), maxLeads: config.maxLeadsPerList }));

  api.get('/sample', async (_req, res) => {
    const file = fileURLToPath(new URL('../../sample/companies.csv', import.meta.url));
    res.type('text/plain').send(await readFile(file, 'utf8'));
  });

  // Dry run: lets the UI preview "42 companies, 3 duplicates, 2 invalid" before committing.
  api.post('/preview', (req, res) => {
    const parsed = parseLeadInput(req.body.input, config.maxLeadsPerList);
    res.json({ count: parsed.leads.length, sample: parsed.leads.slice(0, 5), duplicates: parsed.duplicates, invalid: parsed.invalid });
  });

  api.get('/batches', async (_req, res) => res.json(await repo.listBatches()));

  api.post('/batches', async (req, res) => {
    const parsed = parseLeadInput(req.body.input, config.maxLeadsPerList);
    if (!parsed.leads.length) throw new HttpError(400, 'No valid company websites found. Add one domain or URL per line.');
    const mode = cleanMode(req.body.mode);
    const name = String(req.body.name ?? '').trim().slice(0, 80) || `List ${new Date().toLocaleDateString('en-US')}`;
    const batch = await repo.createBatch({
      name,
      mode,
      icp: cleanIcp(req.body.icp),
      leads: parsed.leads,
      duplicates: parsed.duplicates.length,
      invalid: parsed.invalid.length,
    });
    res.status(201).json({ batch, duplicates: parsed.duplicates, invalid: parsed.invalid });
  });

  api.get('/batches/:id', async (req, res) => {
    const batch = await loadBatch(req.params.id);
    const leads = await repo.getLeads(batch.id);
    res.json({ batch, leads: leads.map(repo.toApiLead) });
  });

  api.delete('/batches/:id', async (req, res) => {
    await repo.deleteBatch(Number(req.params.id));
    res.status(204).end();
  });

  // Enrich the next few pending leads. The client calls this in a loop, which keeps each request
  // short (no serverless/proxy timeouts), streams progress to the UI, and survives restarts.
  api.post('/batches/:id/process', async (req, res) => {
    const batch = await loadBatch(req.params.id);
    const claimed = await repo.claimPending(batch.id, config.leadsPerTick);
    if (!claimed.length) return res.json({ leads: [], remaining: await repo.countRemaining(batch.id), stats: null });

    const crawler = new Crawler();
    const started = Date.now();
    const enrichments = await enrichLeads(claimed, crawler);

    const saved = await mapLimit(claimed, 3, async (lead) => {
      const enrichment = enrichments.get(lead.id);
      const scoring = scoreLead(lead, enrichment, batch.mode, batch.icp);
      const insight = scoring.score >= config.aiMinScore ? await generateInsight(lead, enrichment, batch.mode, batch.icp) : null;
      return repo.saveResult(lead.id, { enrichment, scoring, insight });
    });

    res.json({
      leads: saved.map(repo.toApiLead),
      remaining: await repo.countRemaining(batch.id),
      stats: { ...crawler.stats, ms: Date.now() - started },
    });
  });

  // Change the ICP or playbook and re-rank instantly from stored data — no re-crawling.
  api.post('/batches/:id/rescore', async (req, res) => {
    const batch = await loadBatch(req.params.id);
    const mode = cleanMode(req.body.mode ?? batch.mode);
    const icp = cleanIcp(req.body.icp ?? batch.icp);
    await repo.updateBatchIcp(batch.id, mode, icp);

    const rows = await repo.getLeads(batch.id);
    for (const row of rows) {
      if (!row.enrichment) continue;
      const scoring = scoreLead(row, row.enrichment, mode, icp);
      await repo.saveScore(row.id, scoring);
    }
    const updated = await repo.getLeads(batch.id);
    res.json({ batch: { ...batch, mode, icp }, leads: updated.map(repo.toApiLead) });
  });

  api.post('/leads/:id/retry', async (req, res) => {
    const lead = await repo.resetLead(Number(req.params.id));
    if (!lead) throw new HttpError(404, 'Lead not found');
    await purgeDomainCache(lead.domain);
    res.json(repo.toApiLead(lead));
  });

  api.get('/batches/:id/export', async (req, res) => {
    const batch = await loadBatch(req.params.id);
    const ids = req.query.ids ? String(req.query.ids).split(',').map(Number).filter(Number.isInteger) : null;
    const format = EXPORT_FORMATS.includes(req.query.format) ? req.query.format : 'csv';
    const leads = (await repo.getLeads(batch.id, ids)).filter((l) => l.status === 'done' || l.status === 'failed');
    const filename = `${batch.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${format}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportLeads(leads, format));
  });

  app.use('/api', api);

  // Single-service deploy: serve the built React app from the same origin.
  const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: dist }));
  }

  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
  });

  return app;
}
