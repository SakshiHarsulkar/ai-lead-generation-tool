import { promises as dns } from 'node:dns';
import { config } from './config.js';
import { query } from './db.js';
import { FREE_EMAIL_DOMAINS } from './normalizer.js';

const ROLE_INBOXES = new Set([
  'info', 'contact', 'hello', 'hi', 'sales', 'support', 'help', 'admin', 'office', 'team', 'hr', 'careers',
  'jobs', 'press', 'media', 'marketing', 'billing', 'accounts', 'enquiries', 'inquiries', 'service',
  'customerservice', 'noreply', 'no-reply', 'webmaster', 'privacy', 'legal', 'orders', 'talent', 'recruiting',
  'visitors', 'partners', 'partnerships', 'security', 'abuse', 'feedback', 'newsletter', 'events', 'investors',
  'ir', 'compliance', 'dpo', 'gdpr', 'pr', 'social', 'community', 'success', 'ops', 'operations', 'finance',
]);
const DISPOSABLE = new Set(['mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'yopmail.com', 'trashmail.com']);

/** Does the domain accept mail? MX lookup, cached in Postgres. Returns true / false / null (unknown). */
export async function hasMailServer(domain) {
  const cutoff = new Date(Date.now() - config.cacheTtlMs).toISOString();
  const [cached] = await query(`SELECT has_mx FROM dns_cache WHERE domain = $1 AND checked_at > $2`, [domain, cutoff]);
  if (cached) return cached.has_mx;

  let hasMx;
  try {
    const records = await dns.resolveMx(domain);
    hasMx = records.some((r) => r.exchange && r.exchange !== '.');
  } catch (err) {
    if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') hasMx = false;
    else return null; // timeout / SERVFAIL: unknown, don't cache
  }
  await query(
    `INSERT INTO dns_cache (domain, has_mx, checked_at) VALUES ($1, $2, now())
     ON CONFLICT (domain) DO UPDATE SET has_mx = EXCLUDED.has_mx, checked_at = now()`,
    [domain, hasMx],
  );
  return hasMx;
}

const RANK = { verified: 4, role: 3, risky: 2, invalid: 0 };

/**
 * Classify each email so sales reps only see addresses worth sending to.
 *   verified  personal mailbox, domain has MX       -> best
 *   role      info@/sales@ style shared inbox        -> usable, lower reply rates
 *   risky     free-mail or MX unknown                -> double-check
 *   invalid   bad syntax, disposable, or no MX       -> hidden from primary contact
 * (No SMTP "ping": it is unreliable, slow, and gets IPs blocklisted.)
 */
export async function validateEmails(emails, companyDomain) {
  const results = await Promise.all(
    emails.slice(0, 15).map(async (email) => {
      const [local, emailDomain] = email.split('@');
      const onDomain = emailDomain === companyDomain || emailDomain.endsWith(`.${companyDomain}`);
      const role = ROLE_INBOXES.has(local.split('+')[0]);
      const free = FREE_EMAIL_DOMAINS.has(emailDomain);

      let status;
      let reason;
      if (DISPOSABLE.has(emailDomain)) {
        status = 'invalid';
        reason = 'Disposable email provider';
      } else {
        const mx = await hasMailServer(emailDomain);
        if (mx === false) {
          status = 'invalid';
          reason = 'Domain has no mail server (MX)';
        } else if (mx === null) {
          status = 'risky';
          reason = 'Mail server could not be verified';
        } else if (free) {
          status = 'risky';
          reason = 'Personal mailbox (free provider)';
        } else if (role && !onDomain) {
          status = 'risky';
          reason = 'Third-party address (likely a vendor or widget)';
        } else if (role) {
          status = 'role';
          reason = 'Shared role inbox';
        } else {
          status = 'verified';
          reason = onDomain ? 'Personal mailbox on company domain' : 'Valid mailbox (different domain)';
        }
      }
      return { email, status, reason, onDomain, role };
    }),
  );

  // Best first. An off-domain address is often the web agency's, so a company role inbox beats it.
  const quality = (e) => RANK[e.status] * 10 + (e.onDomain && e.status !== 'invalid' ? 15 : 0);
  return results.sort((a, b) => quality(b) - quality(a));
}
