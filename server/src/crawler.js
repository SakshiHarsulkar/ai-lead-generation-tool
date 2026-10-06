import { config } from './config.js';
import { query } from './db.js';
import { checkHost } from './netguard.js';
import { mapLimit, sleep, stripNul } from './util.js';

const MAX_REDIRECTS = 5;

function describeError(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Timed out';
  const code = err.cause?.code ?? err.code;
  const known = {
    ENOTFOUND: 'Domain not found',
    ECONNREFUSED: 'Connection refused',
    ECONNRESET: 'Connection reset',
    CERT_HAS_EXPIRED: 'Expired SSL certificate',
    ERR_TLS_CERT_ALTNAME_INVALID: 'SSL certificate does not match domain',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Untrusted SSL certificate',
  };
  return known[code] ?? err.message ?? 'Request failed';
}

async function readCapped(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return text + decoder.decode();
}

/**
 * Polite, cached, concurrent HTTP fetcher.
 *  - Postgres-backed page cache with TTL (re-runs cost zero network)
 *  - bounded concurrency, per-request timeout, one retry on transient failures
 *  - manual redirect following so every hop passes the SSRF guard
 *  - identifies itself honestly via User-Agent (no stealth / CAPTCHA evasion)
 */
export class Crawler {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? config.httpTimeoutMs;
    this.concurrency = options.concurrency ?? config.concurrency;
    this.ttlMs = options.ttlMs ?? config.cacheTtlMs;
    this.stats = { fetched: 0, cached: 0 };
  }

  /** @returns {Promise<Map<string, Page>>} keyed by requested URL */
  async fetchAll(urls) {
    const unique = [...new Set(urls)];
    const pages = new Map();
    if (!unique.length) return pages;

    const cutoff = new Date(Date.now() - this.ttlMs).toISOString();
    const cachedRows = await query(
      `SELECT url, status, final_url, content_type, body FROM page_cache WHERE url = ANY($1) AND fetched_at > $2`,
      [unique, cutoff],
    );
    for (const row of cachedRows) {
      pages.set(row.url, {
        url: row.url,
        finalUrl: row.final_url,
        status: row.status,
        contentType: row.content_type,
        body: row.body ?? '',
        cached: true,
        ms: 0,
      });
      this.stats.cached++;
    }

    const toFetch = unique.filter((u) => !pages.has(u));
    await mapLimit(toFetch, this.concurrency, async (url) => {
      pages.set(url, await this.fetchWithRetry(url));
    });
    return pages;
  }

  async fetchWithRetry(url) {
    let page = await this.fetchOne(url);
    const transient = page.status === 0 && /reset|Timed out/.test(page.error ?? '');
    if (transient || page.status === 502 || page.status === 503) {
      await sleep(600);
      page = await this.fetchOne(url);
    }
    return page;
  }

  async fetchOne(url) {
    const started = Date.now();
    let current = url;
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const target = new URL(current);
        const guard = await checkHost(target.hostname);
        if (!guard.ok) return this.failure(url, guard.reason, started);

        const response = await fetch(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            'User-Agent': config.userAgent,
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'Accept-Language': 'en-US,en;q=0.8',
          },
        });

        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          await response.body?.cancel();
          current = new URL(location, current).toString();
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const isText = !contentType || /text\/|html|xml/.test(contentType);
        const body = isText ? stripNul(await readCapped(response, config.maxBodyBytes)) : '';
        if (!isText) await response.body?.cancel();

        const page = { url, finalUrl: current, status: response.status, contentType, body, cached: false, ms: Date.now() - started };
        this.stats.fetched++;
        await this.store(page);
        return page;
      }
      return this.failure(url, 'Too many redirects', started);
    } catch (err) {
      return this.failure(url, describeError(err), started);
    }
  }

  failure(url, error, started) {
    return { url, finalUrl: url, status: 0, contentType: '', body: '', cached: false, error, ms: Date.now() - started };
  }

  async store(page) {
    await query(
      `INSERT INTO page_cache (url, status, final_url, content_type, body, fetched_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (url) DO UPDATE SET status = EXCLUDED.status, final_url = EXCLUDED.final_url,
         content_type = EXCLUDED.content_type, body = EXCLUDED.body, fetched_at = now()`,
      [page.url, page.status, page.finalUrl, page.contentType, page.body],
    );
  }
}

/** Drop cached pages for a domain so a "Re-crawl" really hits the network. */
export async function purgeDomainCache(domain) {
  await query(`DELETE FROM page_cache WHERE url LIKE $1 OR url LIKE $2 OR url LIKE $3`, [
    `https://${domain}/%`,
    `https://www.${domain}/%`,
    `http://${domain}/%`,
  ]);
}
