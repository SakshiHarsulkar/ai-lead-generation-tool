import * as cheerio from 'cheerio';
import { isSameSite } from './normalizer.js';
import { stripNul } from './util.js';

// ---------- Technology fingerprints (script/CDN signatures in raw HTML) ----------
export const TECH_FINGERPRINTS = [
  { name: 'HubSpot', category: 'crm', patterns: ['js.hs-scripts.com', 'js.hsforms.net', 'js.hs-analytics.net', 'hs-banner.com'] },
  { name: 'Salesforce Pardot', category: 'crm', patterns: ['pardot.com/pd.js', 'pi.pardot.com'] },
  { name: 'Marketo', category: 'crm', patterns: ['munchkin.marketo.net', 'mktoforms'] },
  { name: 'Klaviyo', category: 'crm', patterns: ['static.klaviyo.com', 'klaviyo.js'] },
  { name: 'Mailchimp', category: 'crm', patterns: ['chimpstatic.com', 'list-manage.com'] },
  { name: 'Intercom', category: 'support', patterns: ['widget.intercom.io', 'js.intercomcdn.com'] },
  { name: 'Drift', category: 'support', patterns: ['js.driftt.com'] },
  { name: 'Zendesk', category: 'support', patterns: ['static.zdassets.com'] },
  { name: 'Calendly', category: 'scheduling', patterns: ['assets.calendly.com', 'calendly.com/'] },
  { name: 'Google Analytics', category: 'analytics', patterns: ['googletagmanager.com/gtag', 'google-analytics.com/analytics.js'] },
  { name: 'Google Tag Manager', category: 'analytics', patterns: ['googletagmanager.com/gtm.js'] },
  { name: 'Segment', category: 'analytics', patterns: ['cdn.segment.com'] },
  { name: 'Hotjar', category: 'analytics', patterns: ['static.hotjar.com'] },
  { name: 'Shopify', category: 'ecommerce', patterns: ['cdn.shopify.com', 'myshopify.com'] },
  { name: 'WooCommerce', category: 'ecommerce', patterns: ['woocommerce'] },
  { name: 'Stripe', category: 'payments', patterns: ['js.stripe.com'] },
  { name: 'WordPress', category: 'cms', patterns: ['/wp-content/', '/wp-includes/'] },
  { name: 'Wix', category: 'cms', patterns: ['static.wixstatic.com', 'wix-code'] },
  { name: 'Squarespace', category: 'cms', patterns: ['static1.squarespace.com', 'squarespace-cdn.com'] },
  { name: 'Webflow', category: 'cms', patterns: ['data-wf-page', 'webflow.js'] },
  { name: 'Next.js', category: 'framework', patterns: ['__next_data__', '/_next/static/'] },
];

const SOCIAL_PATTERNS = [
  ['linkedin', /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|school|in)\/[^/?#]+/i],
  ['twitter', /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share|home|search|hashtag)[a-z0-9_]{1,15}(?=$|[/?#])/i],
  ['facebook', /^https?:\/\/([a-z-]+\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|groups)[^/?#]+/i],
  ['instagram', /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|explore)[^/?#]+/i],
  ['youtube', /^https?:\/\/(www\.)?youtube\.com\/(@|c\/|channel\/|user\/)[^/?#]+/i],
  ['github', /^https?:\/\/(www\.)?github\.com\/[^/?#]+/i],
];

// Which internal pages are worth a second request, by URL path or link text.
export const PAGE_TYPES = {
  contact: /contact|get-in-touch|reach-us|locations?\b/i,
  about: /about|our-story|who-we-are|leadership|our-team|\bteam\b/i,
  careers: /careers?|jobs|join-us|hiring|work-with-us/i,
  pricing: /pricing|\bplans\b/i,
  demo: /demo|book-a-call|request-a-quote|get-a-quote/i,
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const US_PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]([2-9]\d{2})[\s.-](\d{4})\b/g;

function cleanEmail(raw) {
  const e = String(raw).trim().toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[.,;:]+$/, '');
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(e)) return null;
  if (/\.(png|jpe?g|gif|svg|webp|css|js|ico)$/.test(e)) return null;
  if (/(example\.|sentry|wixpress\.com|domain\.com|yourdomain|yourcompany|email\.com|@2x|@3x|u003e|placeholder)/.test(e)) return null;
  return e;
}

/** Cloudflare "email protection" obfuscation: hex string XOR'd with its first byte. */
export function decodeCloudflareEmail(hex) {
  if (!/^[0-9a-f]+$/i.test(hex ?? '') || hex.length < 4) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function normalizePhone(raw) {
  const hasPlus = String(raw).trim().startsWith('+');
  const digits = String(raw).replace(/\D/g, '');
  let e164;
  if (digits.length === 10 && !hasPlus) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`;
  else if (hasPlus && digits.length >= 8 && digits.length <= 15) e164 = `+${digits}`;
  else return null;

  const display = e164.startsWith('+1') && e164.length === 12
    ? `+1 (${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`
    : e164;
  return { e164, display };
}

function walkJsonLd(node, visit, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) return node.forEach((n) => walkJsonLd(n, visit, depth + 1));
  visit(node);
  for (const value of Object.values(node)) walkJsonLd(value, visit, depth + 1);
}

/**
 * Extract every sales-relevant fact from one HTML page.
 * Sources, in order of reliability: JSON-LD structured data, mailto:/tel: links,
 * Cloudflare-protected emails, de-obfuscated visible text, and raw-HTML tech fingerprints.
 */
export function extractPage(html, pageUrl, domain) {
  const $ = cheerio.load(html);
  const emails = new Set();
  const phones = new Map();
  const socials = {};
  const links = [];
  const structured = {};

  const addEmail = (e) => {
    const clean = cleanEmail(e ?? '');
    if (clean) emails.add(clean);
  };
  const addPhone = (p) => {
    const phone = normalizePhone(p ?? '');
    if (phone && !phones.has(phone.e164)) phones.set(phone.e164, phone);
  };

  const title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 200);
  const description = (
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''
  ).replace(/\s+/g, ' ').trim().slice(0, 400);
  const siteName = ($('meta[property="og:site_name"]').attr('content') || '').trim();

  // 1. Structured data (schema.org Organization / LocalBusiness)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walkJsonLd(JSON.parse($(el).contents().text()), (obj) => {
        if (obj.email) addEmail(String(obj.email).replace(/^mailto:/i, ''));
        if (obj.telephone) addPhone(String(obj.telephone));
        if (obj.foundingDate && !structured.foundingYear) {
          const y = String(obj.foundingDate).match(/(18|19|20)\d{2}/);
          if (y) structured.foundingYear = Number(y[0]);
        }
        if (obj.numberOfEmployees && !structured.employees) {
          const n = obj.numberOfEmployees.value ?? obj.numberOfEmployees.maxValue ?? obj.numberOfEmployees;
          if (Number(n)) structured.employees = Number(n);
        }
        for (const url of [].concat(obj.sameAs ?? [])) {
          for (const [network, re] of SOCIAL_PATTERNS) {
            const m = String(url).match(re);
            if (m && !socials[network]) socials[network] = m[0];
          }
        }
      });
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  });

  // 2. Cloudflare-protected emails
  $('[data-cfemail]').each((_, el) => addEmail(decodeCloudflareEmail($(el).attr('data-cfemail'))));

  // 3. Links: mailto, tel, socials, internal pages
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 80);

    if (/^mailto:/i.test(href)) {
      try {
        addEmail(decodeURIComponent(href.slice(7).split('?')[0]));
      } catch {
        addEmail(href.slice(7).split('?')[0]);
      }
      return;
    }
    if (/^tel:/i.test(href)) return addPhone(href.slice(4));
    const cf = href.match(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i);
    if (cf) return addEmail(decodeCloudflareEmail(cf[1]));

    let abs;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(abs.protocol)) return;
    for (const [network, re] of SOCIAL_PATTERNS) {
      const m = abs.href.match(re);
      if (m && !socials[network]) socials[network] = m[0];
    }
    if (isSameSite(abs.hostname, domain)) {
      abs.hash = '';
      links.push({ url: abs.href, path: abs.pathname.toLowerCase(), text });
    }
  });

  // 4. Visible text (scripts/styles removed), with "name [at] company [dot] com" de-obfuscation
  const lowerHtml = html.toLowerCase();
  $('script, style, noscript, svg, template, iframe').remove();
  const text = stripNul($('body').text().replace(/\s+/g, ' ').trim());
  const deobfuscated = text
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, '@')
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, '.');
  for (const m of deobfuscated.matchAll(EMAIL_RE)) addEmail(m[0]);
  for (const m of text.matchAll(US_PHONE_RE)) addPhone(`${m[1]}${m[2]}${m[3]}`);

  // 5. Tech stack
  const tech = TECH_FINGERPRINTS.filter((t) => t.patterns.some((p) => lowerHtml.includes(p))).map(({ name, category }) => ({ name, category }));

  // 6. Classified internal pages
  const pageLinks = {};
  for (const [type, re] of Object.entries(PAGE_TYPES)) {
    const candidates = links.filter((l) => re.test(l.path) || re.test(l.text)).sort((a, b) => a.path.length - b.path.length);
    if (candidates.length) pageLinks[type] = candidates[0].url;
  }

  return {
    title,
    description,
    siteName,
    text,
    emails: [...emails],
    phones: [...phones.values()],
    socials,
    tech,
    pageLinks,
    structured,
  };
}

// ---------- Text signals used by scoring ----------
const SIGNAL_PATTERNS = {
  hiring: /we['’]re hiring|we are hiring|join our team|open positions|now hiring|current openings/i,
  demo: /book a demo|request a demo|schedule a demo|get a demo|start (a |your )?free trial/i,
  family: /family[- ](owned|run|operated)|owner[- ]operated|locally owned|(second|third|fourth)[- ]generation|generations of/i,
  vc: /series [abcd]\b|venture[- ]backed|backed by [^.]{0,40}(capital|ventures|partners)|raised \$\d|y combinator/i,
  recurring: /maintenance (plans?|contracts?|agreements?)|service (agreements?|contracts?|plans?)|subscriptions?|recurring|managed services|retainer|monthly plans?/i,
};

export function detectSignals(text, structured = {}) {
  const now = new Date().getFullYear();
  const signals = Object.fromEntries(Object.entries(SIGNAL_PATTERNS).map(([key, re]) => [key, re.test(text)]));

  const founded = [];
  if (structured.foundingYear) founded.push(structured.foundingYear);
  for (const m of text.matchAll(/\b(?:since|established(?: in)?|est\.?|founded(?: in)?)\s+((?:18|19|20)\d{2})\b/gi)) {
    founded.push(Number(m[1]));
  }

  let copyrightYear = null;
  for (const m of text.matchAll(/(?:©|\(c\)|copyright)\s*(?:((?:19|20)\d{2})\s*[-–—]\s*)?((?:19|20)\d{2})/gi)) {
    if (m[1]) founded.push(Number(m[1]));
    const year = Number(m[2]);
    if (year <= now && (!copyrightYear || year > copyrightYear)) copyrightYear = year;
  }

  const plausible = founded.filter((y) => y >= 1800 && y <= now);
  return {
    ...signals,
    foundedYear: plausible.length ? Math.min(...plausible) : null,
    copyrightYear,
    employees: structured.employees ?? null,
  };
}
