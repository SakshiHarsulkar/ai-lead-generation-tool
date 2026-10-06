import { config } from './config.js';
import { validateEmails } from './emailValidator.js';
import { detectSignals, extractPage } from './extractor.js';
import { checkHost } from './netguard.js';
import { isAllowed, rulesFromResponse } from './robots.js';
import { mapLimit } from './util.js';

const BOT_WALL_STATUSES = new Set([401, 403, 406, 429, 503]);
const ok = (page) => page && page.status >= 200 && page.status < 300 && page.body;

function deadResult(reason) {
  return { alive: false, blocked: false, error: reason, emails: [], phones: [], socials: {}, tech: [], signals: {}, pages: [], robotsBlocked: [] };
}

/**
 * Enrich a small group of leads in parallel, in rounds so every network step is batched:
 *   1. DNS + SSRF check        (dead domains fail fast, no HTTP wasted)
 *   2. robots.txt              (respected for every later request)
 *   3. homepage                (https, then www / http fallbacks)
 *   4. discovered subpages     (contact/about/careers links found on the homepage, not guessed paths,
 *                               so it adapts when a site restructures)
 *   5. merge + email validation
 */
export async function enrichLeads(leads, crawler) {
  const results = new Map();

  // 1. DNS
  const dns = await mapLimit(leads, 10, (lead) => checkHost(lead.domain));
  const live = [];
  leads.forEach((lead, i) => (dns[i].ok ? live.push(lead) : results.set(lead.id, deadResult(dns[i].reason))));

  // 2. robots.txt
  const robotsPages = await crawler.fetchAll(live.map((l) => `https://${l.domain}/robots.txt`));
  const rules = new Map(live.map((l) => [l.id, rulesFromResponse(robotsPages.get(`https://${l.domain}/robots.txt`))]));
  const robotsBlocked = new Map(live.map((l) => [l.id, []]));
  const allowed = (lead, url) => {
    const path = new URL(url).pathname;
    if (isAllowed(rules.get(lead.id), path)) return true;
    robotsBlocked.get(lead.id).push(path);
    return false;
  };

  // 3. Homepage (with fallbacks for sites that only answer on www. or plain http)
  const crawlable = live.filter((l) => allowed(l, `https://${l.domain}/`));
  live.filter((l) => !crawlable.includes(l)).forEach((l) => {
    results.set(l.id, { ...deadResult('robots.txt disallows crawling this site'), alive: true, robotsBlocked: ['/'] });
  });

  const home = new Map();
  const first = await crawler.fetchAll(crawlable.map((l) => `https://${l.domain}/`));
  crawlable.forEach((l) => home.set(l.id, first.get(`https://${l.domain}/`)));

  const retry = crawlable.filter((l) => home.get(l.id).status === 0);
  if (retry.length) {
    const second = await crawler.fetchAll(retry.flatMap((l) => [`https://www.${l.domain}/`, `http://${l.domain}/`]));
    for (const l of retry) {
      const alt = [second.get(`https://www.${l.domain}/`), second.get(`http://${l.domain}/`)].find((p) => p.status > 0);
      if (alt) home.set(l.id, alt);
    }
  }

  // 4. Subpages
  const extracted = new Map();
  const subpageUrls = new Map();
  for (const lead of crawlable) {
    const page = home.get(lead.id);
    if (!ok(page)) continue;
    const data = extractPage(page.body, page.finalUrl, lead.domain);
    extracted.set(lead.id, [{ type: 'home', page, data }]);

    const wanted = ['contact', 'about', 'careers']
      .map((type) => ({ type, url: data.pageLinks[type] }))
      .filter((p) => p.url && p.url.replace(/\/$/, '') !== page.finalUrl.replace(/\/$/, ''));
    if (!data.pageLinks.contact) wanted.unshift({ type: 'contact', url: new URL('/contact', page.finalUrl).toString() });

    subpageUrls.set(
      lead.id,
      wanted.filter((p, i, arr) => arr.findIndex((q) => q.url === p.url) === i && allowed(lead, p.url)).slice(0, config.maxSubpages),
    );
  }
  const subpages = await crawler.fetchAll([...subpageUrls.values()].flat().map((p) => p.url));
  for (const [leadId, wanted] of subpageUrls) {
    const lead = crawlable.find((l) => l.id === leadId);
    for (const { type, url } of wanted) {
      const page = subpages.get(url);
      const entry = { type, page, data: null };
      if (ok(page)) entry.data = extractPage(page.body, page.finalUrl, lead.domain);
      extracted.get(leadId).push(entry);
    }
  }

  // 5. Merge per lead
  await mapLimit(crawlable, 4, async (lead) => {
    const homepage = home.get(lead.id);
    const pages = extracted.get(lead.id) ?? [];
    const pageLog = (pages.length ? pages : [{ type: 'home', page: homepage }]).map(({ type, page }) => ({
      type,
      url: page.finalUrl,
      status: page.status,
      cached: page.cached,
      ms: page.ms,
      error: page.error,
    }));

    if (!ok(homepage)) {
      const blocked = BOT_WALL_STATUSES.has(homepage.status);
      results.set(lead.id, {
        ...deadResult(
          blocked
            ? `Site blocks automated access (HTTP ${homepage.status}). Verify manually.`
            : homepage.error || `Homepage returned HTTP ${homepage.status}`,
        ),
        alive: blocked || homepage.status > 0,
        blocked,
        httpStatus: homepage.status,
        pages: pageLog,
        robotsBlocked: robotsBlocked.get(lead.id),
      });
      return;
    }

    const datas = pages.map((p) => p.data).filter(Boolean);
    const main = datas[0];
    const phones = new Map();
    const socials = {};
    const tech = new Map();
    const pageLinks = {};
    datas.forEach((d) => {
      d.phones.forEach((p) => phones.set(p.e164, p));
      Object.entries(d.socials).forEach(([k, v]) => (socials[k] ??= v));
      d.tech.forEach((t) => tech.set(t.name, t));
      Object.assign(pageLinks, { ...d.pageLinks, ...pageLinks });
    });
    const structured = Object.assign({}, ...datas.map((d) => d.structured).reverse());

    // Text from homepage + about page drives keyword fit and signals.
    const text = datas.map((d) => d.text).join(' ').slice(0, 40_000);
    const signals = detectSignals(text, structured);
    signals.hiring ||= Boolean(pageLinks.careers);
    signals.pricing = Boolean(pageLinks.pricing);
    signals.demo ||= Boolean(pageLinks.demo);

    const emails = await validateEmails([...new Set(datas.flatMap((d) => d.emails))], lead.domain);

    results.set(lead.id, {
      alive: true,
      blocked: false,
      error: null,
      httpStatus: homepage.status,
      finalUrl: homepage.finalUrl,
      https: homepage.finalUrl.startsWith('https://'),
      title: main.title,
      description: main.description,
      siteName: main.siteName,
      emails,
      // Primary contact must belong to the company: on-domain, or a verified personal mailbox elsewhere.
      primaryEmail: emails.find((e) => (e.onDomain && e.status !== 'invalid') || e.status === 'verified') ?? null,
      phones: [...phones.values()].slice(0, 5),
      socials,
      tech: [...tech.values()],
      signals,
      pages: pageLog,
      robotsBlocked: robotsBlocked.get(lead.id),
      text: text.slice(0, 8000),
      crawledAt: new Date().toISOString(),
    });
  });

  return results;
}
