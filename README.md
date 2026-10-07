# LeadLens: from a raw company list to a ranked, verified call sheet

**Live demo: https://leadlens-v18q.onrender.com**. Open the *"Demo: B2B software companies"* list in the sidebar, or click **New lead list → Try the sample list**.
*(Hosted on Render's free tier: the first visit after a period of inactivity takes ~30–60 s while the server wakes up.)*

LeadLens is an enrichment and prioritisation layer for lead-generation tools like **SaaSquatch Leads**.
Paste a list of company websites (or upload any CRM / spreadsheet export) and LeadLens:

1. **Cleans** the list by normalising URLs, emails and domains, merging duplicates, and explaining every row it rejects
2. **Enriches** each company by visiting its public site (homepage plus discovered contact, about and careers pages) and extracting emails, phones, social profiles, tech stack, founding year, hiring status and other signals
3. **Validates** contacts: email syntax, mail-server (MX) checks, role-inbox and vendor-address detection
4. **Scores** each lead from 0 to 100 against *your* ideal customer profile, with a line-by-line reason for every point
5. **Writes the first line**: a suggested opener and talking points per lead (optionally AI-generated)
6. **Exports** to a CSV formatted for **HubSpot** or **Salesforce**, so leads land in the CRM with no re-mapping

> Two playbooks for SaaSquatch's two audiences: **Sales prospecting** (who is ready to *buy*?) and
> **Acquisition sourcing / ETA** (who is worth *acquiring*: established, owner-operated, recurring revenue, digital upside).

---

## Why this feature

A scraper that returns 500 rows has not saved a rep any time yet. The rep still has to answer three questions per row:
*Is this contact real? Is this company a fit? What do I say?* LeadLens answers those three questions, so the output is
a call order rather than a spreadsheet to research.

| Rep's problem | What LeadLens does |
|---|---|
| Bounced emails hurt sender reputation | MX validation; flags role inboxes (`info@`) and vendor addresses (e.g. a chat widget's email) |
| Duplicate and garbage rows | Domain normalisation (`https://www.Acme.com/about` = `jane@acme.com` = `acme.com`) and dedupe |
| No idea who to call first | Transparent 0–100 score with Hot / Warm / Cold tiers |
| "Why is this lead Hot?" | Every point is itemised in the lead panel, so reps can trust the score or challenge it |
| Personalisation takes 10 min per lead | Opener and talking points generated from real signals (hiring, CRM in use, years in business...) |
| Data stuck in a tool | One-click HubSpot / Salesforce / full CSV export of exactly the filtered view |
| Changing the ICP means re-scraping | **Re-score instantly** from stored crawl data, with no network calls |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | **React 19**, **Vite 6**, **Tailwind CSS 4**, lucide-react icons |
| Backend | **Node.js 22**, **Express 5** (ES modules, no build step) |
| Scraping | Native `fetch` (undici), **Cheerio** for HTML parsing, `node:dns` for MX / SSRF checks |
| Database | **PostgreSQL** (Neon in production) · **PGlite** (embedded Postgres, WASM) for zero-setup local dev |
| AI (optional) | **Anthropic Claude API** (`@anthropic-ai/sdk`) with JSON-schema structured output |
| Tests | `node:test` (built-in test runner, no extra dependency) |
| Hosting | **Render** (Docker web service) for API + app · optional **Vercel** for the static frontend |

## Architecture

```
┌──────────────────────────┐        ┌──────────────────────────────────────────────────────────┐
│  React SPA (Vite build)  │  JSON  │  Express API                                             │
│  ─ 3-step import wizard  │ ─────► │  POST /batches           parse ► normalise ► dedupe      │
│  ─ live progress table   │        │  POST /batches/:id/process  (loop, 6 leads per call)     │
│  ─ lead detail drawer    │ ◄───── │     claim (SKIP LOCKED) ► enrich ► score ► AI ► save     │
│  ─ tune & re-score       │        │  POST /batches/:id/rescore  (no network, stored data)    │
│  ─ CRM export            │        │  GET  /batches/:id/export?format=hubspot|salesforce|csv  │
└──────────────────────────┘        └───────────────┬──────────────────────────┬───────────────┘
                                                    │                          │
                                     ┌──────────────▼─────────────┐   ┌────────▼─────────┐
                                     │ PostgreSQL                 │   │ Public websites  │
                                     │  batches, leads (JSONB)    │   │ robots.txt ► home│
                                     │  page_cache   (TTL 7 days) │   │ ► contact/about/ │
                                     │  dns_cache    (MX results) │   │   careers pages  │
                                     └────────────────────────────┘   └──────────────────┘
```

### Enrichment pipeline (`server/src/enricher.js`)

Each `/process` call claims up to 6 leads and runs them **in parallel, in rounds**, so every network step is batched:

1. **DNS and SSRF guard**: dead domains fail in milliseconds; hosts resolving to private IPs are refused (`netguard.js`)
2. **robots.txt**: parsed per RFC 9309 (groups, wildcards, `$`, longest match). Disallowed paths are skipped and shown in the UI
3. **Homepage**: `https://domain` → fallbacks `https://www.` / `http://`. Redirects are followed manually so every hop passes the SSRF guard
4. **Subpages discovered from the homepage's own links** (contact, about, careers), not hard-coded paths, so it adapts when a site is restructured
5. **Extraction** (`extractor.js`), in order of reliability: JSON-LD `schema.org` data → `mailto:` / `tel:` links → Cloudflare-obfuscated emails → `name [at] domain [dot] com` text → regex on visible text → script/CDN fingerprints for 20+ tools (HubSpot, Salesforce Pardot, Shopify, Intercom...)
6. **Validation** (`emailValidator.js`): MX lookup (cached), role-inbox, free-mail, disposable and third-party detection. No SMTP "pinging", which is unreliable and gets IPs blocklisted

Sites that block bots (HTTP 403/429) are marked **"Bot-protected, verify manually"**. The tool identifies itself honestly and does not try to get around CAPTCHAs or anti-bot systems.

### Data storage

| Table | Purpose |
|---|---|
| `batches` | One uploaded list: name, playbook (`sales`/`eta`), ICP keywords (JSONB), import stats |
| `leads` | One company: status, `enrichment` JSONB (everything scraped), `scoring` JSONB (itemised breakdown), `insight` JSONB (AI), indexed `score`/`tier` |
| `page_cache` | Raw HTML per URL with fetch time: 7-day TTL |
| `dns_cache` | MX results per email domain |

JSONB keeps the schema flexible: a new extracted field needs no migration, yet `score` and `tier` stay real indexed columns for sorting.
Locally, **PGlite** runs the same Postgres engine in-process (WASM), so the identical SQL (`unnest`, `FOR UPDATE SKIP LOCKED`, JSONB) runs in dev and prod and nobody has to install a database.

### Caching and performance

- **Page cache (Postgres, TTL 7 days)**: re-running a list, or another user uploading an overlapping list, costs no network requests
- **DNS cache**: in-memory host checks plus Postgres MX cache
- **Bounded concurrency** (16 in-flight requests), 10 s timeouts, one retry on transient errors, 1.5 MB body cap
- **Chunked processing**: the client loops `/process` (6 leads per call). Each request stays well under proxy/serverless timeouts, progress streams into the UI, and work survives a restart
- **Safe parallelism**: leads are claimed with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so multiple tabs or multiple server instances never process the same lead, and stale claims are retried after 3 minutes
- **Instant re-score**: ICP / playbook changes re-rank from stored enrichment data with no crawling
- **Bulk insert** with `unnest()`, a single round trip for a 500-row list
- Measured: **13 real company sites (~50 pages) enriched in ~10 s locally, ~37 s on Render's free tier** (0.1 CPU); a cached re-run takes well under 1 s

### Scoring model (`server/src/scorer.js`)

| Group | Sales prospecting | Acquisition (ETA) |
|---|---|---|
| Reachability (35) | Verified personal email 20 · phone 10 · LinkedIn 5 | same |
| ICP fit (30) | 1 / 2 / 3+ keyword matches → 12 / 20 / 30 | same |
| Signals | Hiring 8 · CRM/CX tooling 7 · pricing/demo funnel 5 · social presence 5 | Years in business 12 · owner-operated 8 · not VC-backed 5 · recurring revenue 5 · under-digitised (AI upside) 5 |
| Site health (10) | HTTPS 5 · updated within a year 5 | n/a |

Guardrails: exclusion keywords cap a lead at 15. A lead with no email or phone can't be Hot ("call first" requires someone to call). Hot ≥ 70, Warm ≥ 45.

### AI insights (optional)

With `ANTHROPIC_API_KEY` set, Warm and Hot leads (score ≥ 45, so AI spend goes only to leads worth contacting) get a
one-sentence summary, a fit reason, red flags and a personalised opener, generated by Claude with **JSON-schema
structured output**. Scraped site text is passed as untrusted data, not instructions. Any API error falls back to the
rule-based opener, so the app works fully without a key.

### Hosting and deployment

| | Choice | Why |
|---|---|---|
| API + app | **Render web service (Docker)**, `render.yaml` blueprint | Crawling is long-running, network-heavy work: a persistent container avoids serverless cold starts and 10-second function limits. One container also serves the built React app (same origin, no CORS) |
| Database | **Neon serverless Postgres** | Managed Postgres with a free tier, connection via `DATABASE_URL` |
| Frontend (optional split) | **Vercel** static hosting + CDN | Set `VITE_API_URL` to the Render URL and `CORS_ORIGIN` on the API |
| CI/CD | Push to `main` → Render auto-deploys (health check `/api/health`) | |

---

## Run it locally

Requirements: **Node.js 22+**. No database or API keys needed.

```bash
npm install
npm run dev
```

Open **http://localhost:5317** and click **"Try the sample list"**. The API runs on `:4000`, and Vite proxies `/api`.

Optional configuration: copy `server/.env.example` to `server/.env` (Postgres URL, Anthropic key, crawler tuning).

```bash
npm test          # unit tests: parsing, dedupe, robots.txt, extraction, scoring, CSV-injection guard
npm run build     # production build of the React app
npm start         # serves API + built app on :4000
```

### Deploy

1. Create a free **Neon** project and copy its connection string
2. On **Render**: *New → Blueprint →* select this repo. Set `DATABASE_URL` (and optionally `ANTHROPIC_API_KEY`)
3. Done: the app is served at your Render URL. *(Optional: deploy `client/` to Vercel with `VITE_API_URL=https://<render-url>`.)*

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | DB type, AI status |
| POST | `/api/preview` | Dry-run parse: count, duplicates, invalid rows with reasons |
| POST | `/api/batches` | Create list `{ name, mode, icp: { keywords, exclude }, input }` |
| GET | `/api/batches/:id` | List with all leads |
| POST | `/api/batches/:id/process` | Enrich the next chunk; returns updated leads and `remaining` |
| POST | `/api/batches/:id/rescore` | Re-rank with a new `{ mode, icp }`, without re-crawling |
| POST | `/api/leads/:id/retry` | Purge cache and re-crawl one lead |
| GET | `/api/batches/:id/export?format=csv\|hubspot\|salesforce&ids=` | CRM-ready CSV (UTF-8 BOM, formula-injection safe) |

## Ethics and data quality

- Public pages only, **robots.txt respected**, honest `User-Agent`, bounded request rate, no CAPTCHA or anti-bot bypassing
- Bot-protected sites are surfaced for manual follow-up, not attacked
- SSRF protection: user-supplied domains can't make the server crawl private networks
- CSV exports neutralise spreadsheet formula injection (`=`, `+`, `-`, `@`)

## Trade-offs and next steps

- **Job queue**: for 10k+ row lists, move `/process` to a worker (e.g. BullMQ / Postgres-backed queue) with per-domain rate limits
- **Headless rendering** for JavaScript-only sites (Playwright), used only as a fallback because it costs ~10× more
- **People data**: decision-maker names and titles from team pages plus email-pattern inference (`first.last@`)
- **Native CRM push** via HubSpot / Salesforce APIs instead of CSV, and a scheduled re-crawl to catch changes (new hiring, website refresh)

## Project layout

```
server/src/
  app.js            Express routes
  importer.js       CSV / paste parsing, header detection, dedupe
  normalizer.js     domain + company normalisation
  crawler.js        cached, concurrent, SSRF-safe fetcher
  robots.js         RFC 9309 robots.txt
  extractor.js      emails, phones, socials, tech, JSON-LD, signals
  emailValidator.js MX + role/vendor/disposable checks
  enricher.js       the multi-round pipeline
  scorer.js         explainable scoring + outreach suggestions
  insights.js       optional Claude structured-output insights
  exporter.js       CSV / HubSpot / Salesforce
  repository.js     SQL
client/src/
  components/NewListView.jsx   3-step import wizard with live preview
  components/BatchView.jsx     progress, stats, filters, tune & re-score, export
  components/LeadTable.jsx     ranked table
  components/LeadDrawer.jsx    score breakdown, opener, contacts, data sources
sample/companies.csv           demo dataset (includes duplicates + invalid rows on purpose)
```
