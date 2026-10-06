import { fileURLToPath } from 'node:url';

const num = (value, fallback) => (value !== undefined && value !== '' ? Number(value) : fallback);

export const config = {
  // API_PORT (local dev, see .env.development) wins over PORT (set by hosts such as Render).
  port: num(process.env.API_PORT ?? process.env.PORT, 4000),

  // Production: PostgreSQL (e.g. Neon). Local dev without DATABASE_URL: embedded Postgres (PGlite),
  // so the exact same SQL runs everywhere and nobody has to install a database to try the app.
  databaseUrl: process.env.DATABASE_URL || '',
  pgliteDir: process.env.PGLITE_DIR || fileURLToPath(new URL('../data/pglite', import.meta.url)),

  // Crawled pages + MX lookups are cached this long. Re-running a list is near-instant.
  cacheTtlMs: num(process.env.CACHE_TTL_HOURS, 168) * 3600_000,

  httpTimeoutMs: num(process.env.HTTP_TIMEOUT_MS, 10_000),
  concurrency: num(process.env.CRAWL_CONCURRENCY, 16),
  maxBodyBytes: 1_500_000,
  userAgent:
    process.env.CRAWLER_USER_AGENT ||
    'LeadLensBot/1.0 (+https://github.com/leadlens; B2B research crawler; respects robots.txt)',

  // Homepage + up to N discovered pages (contact / about / careers ...) per company.
  maxSubpages: num(process.env.MAX_SUBPAGES, 3),

  // Leads enriched per /process request — keeps every request short and the UI live.
  leadsPerTick: num(process.env.LEADS_PER_TICK, 6),
  maxLeadsPerList: num(process.env.MAX_LEADS, 500),

  // Optional AI insights. Without a key the app uses rule-based openers.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'claude-opus-5-5',
  // Only spend AI calls on leads that are worth a salesperson's time.
  aiMinScore: num(process.env.AI_MIN_SCORE, 45),

  corsOrigin: process.env.CORS_ORIGIN || '*',
};
