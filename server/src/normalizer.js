const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,23}$/;

// Personal mailbox providers are never a company website.
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com', 'yandex.com',
]);

/**
 * Accepts anything a user might paste — "https://www.Acme.com/about?x=1", "acme.com",
 * "jane@acme.com", "mailto:jane@acme.com" — and returns the bare registrable host ("acme.com"),
 * or null when it is not a usable company domain.
 */
export function normalizeDomain(input) {
  let s = String(input ?? '').trim().toLowerCase().replace(/^mailto:/, '');
  if (!s) return null;
  if (s.includes('@') && !s.includes('/')) s = s.slice(s.lastIndexOf('@') + 1);
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;

  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\d*\./, '').replace(/\.$/, '');
  if (!DOMAIN_RE.test(host) || FREE_EMAIL_DOMAINS.has(host)) return null;
  return host;
}

/** "blue-river-hvac.com" -> "Blue River Hvac" (used when the list has no company name). */
export function companyFromDomain(domain) {
  return domain
    .split('.')[0]
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function normalizeCompany(name, domain) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
  return clean || companyFromDomain(domain);
}

/** True when `host` is `domain` or one of its subdomains. */
export function isSameSite(host, domain) {
  const h = host.toLowerCase().replace(/^www\d*\./, '');
  return h === domain || h.endsWith(`.${domain}`);
}
