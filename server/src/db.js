import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS batches (
     id          SERIAL PRIMARY KEY,
     name        TEXT        NOT NULL,
     mode        TEXT        NOT NULL DEFAULT 'sales',
     icp         JSONB       NOT NULL DEFAULT '{}',
     total       INT         NOT NULL DEFAULT 0,
     duplicates  INT         NOT NULL DEFAULT 0,
     invalid     INT         NOT NULL DEFAULT 0,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS leads (
     id          SERIAL PRIMARY KEY,
     batch_id    INT         NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
     company     TEXT        NOT NULL,
     domain      TEXT        NOT NULL,
     status      TEXT        NOT NULL DEFAULT 'pending',
     claimed_at  TIMESTAMPTZ,
     enrichment  JSONB,
     scoring     JSONB,
     insight     JSONB,
     score       INT,
     tier        TEXT,
     updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (batch_id, domain)
   )`,
  `CREATE INDEX IF NOT EXISTS leads_batch_status ON leads (batch_id, status)`,
  `CREATE TABLE IF NOT EXISTS page_cache (
     url          TEXT PRIMARY KEY,
     status       INT  NOT NULL,
     final_url    TEXT,
     content_type TEXT,
     body         TEXT,
     fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS dns_cache (
     domain     TEXT PRIMARY KEY,
     has_mx     BOOLEAN NOT NULL,
     checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];

let client = null;
export let dbKind = 'none';

export async function initDb() {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
    client = { query: (sql, params) => pool.query(sql, params) };
    dbKind = 'postgres';
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    mkdirSync(dirname(config.pgliteDir), { recursive: true });
    const lite = await PGlite.create(config.pgliteDir);
    client = { query: (sql, params) => lite.query(sql, params) };
    dbKind = 'pglite';
  }
  for (const statement of SCHEMA) {
    await client.query(statement);
  }
}

/** Run a parameterised query ($1, $2 ...). Returns the rows array. */
export async function query(sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}
