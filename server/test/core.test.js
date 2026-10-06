import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportLeads } from '../src/exporter.js';
import { decodeCloudflareEmail, detectSignals, extractPage, normalizePhone } from '../src/extractor.js';
import { parseLeadInput } from '../src/importer.js';
import { normalizeDomain } from '../src/normalizer.js';
import { isAllowed, parseRobots } from '../src/robots.js';
import { scoreLead } from '../src/scorer.js';

test('normalizeDomain handles URLs, emails, www and junk', () => {
  assert.equal(normalizeDomain('https://www.Acme.com/about?x=1'), 'acme.com');
  assert.equal(normalizeDomain('jane@acme.co.uk'), 'acme.co.uk');
  assert.equal(normalizeDomain('mailto:sales@acme.io'), 'acme.io');
  assert.equal(normalizeDomain('Acme Inc'), null);
  assert.equal(normalizeDomain('someone@gmail.com'), null);
  assert.equal(normalizeDomain('localhost'), null);
  assert.equal(normalizeDomain('192.168.0.1'), null);
});

test('importer detects headers, dedupes by domain and explains rejects', () => {
  const csv = 'Company,Website\nAcme,acme.com\nAcme again,https://www.acme.com/contact\n"Beta, LLC",beta.io\nNobody,\nGmail user,me@gmail.com';
  const { leads, duplicates, invalid } = parseLeadInput(csv);
  assert.deepEqual(leads.map((l) => l.domain), ['acme.com', 'beta.io']);
  assert.equal(leads[1].company, 'Beta, LLC');
  assert.equal(duplicates.length, 1);
  assert.equal(invalid.length, 2);
  assert.match(invalid[1].reason, /Personal email/);
});

test('importer accepts a plain pasted list without header', () => {
  const { leads } = parseLeadInput('stripe.com\nhttps://linear.app\nblue-river-hvac.com');
  assert.deepEqual(leads.map((l) => l.company), ['Stripe', 'Linear', 'Blue River Hvac']);
});

test('robots.txt: specific group, wildcards, longest match wins', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: LeadLensBot\nDisallow: /private\nAllow: /private/contact$\nDisallow: /*.pdf');
  assert.equal(isAllowed(rules, '/'), true);
  assert.equal(isAllowed(rules, '/private/team'), false);
  assert.equal(isAllowed(rules, '/private/contact'), true);
  assert.equal(isAllowed(rules, '/files/deck.pdf'), false);
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow: /'), '/about'), false);
});

test('extractor pulls emails (incl. obfuscated), phones, socials, tech, JSON-LD', () => {
  const cf = '5d' + [...'ceo@acme.com'].map((c) => (c.charCodeAt(0) ^ 0x5d).toString(16).padStart(2, '0')).join('');
  assert.equal(decodeCloudflareEmail(cf), 'ceo@acme.com');

  const html = `<html><head><title>Acme | HVAC services</title>
    <script type="application/ld+json">{"@type":"Organization","foundingDate":"1987","telephone":"+1 512 555 0199","sameAs":["https://www.linkedin.com/company/acme"]}</script>
    <script src="https://js.hs-scripts.com/123.js"></script></head>
    <body><a href="mailto:jane.doe@acme.com">Email</a><a href="tel:(512) 555-0100">Call</a>
    <span data-cfemail="${cf}"></span><p>Write to sales [at] acme [dot] com. Family-owned since 1987. We're hiring!</p>
    <a href="/contact-us">Contact</a><a href="https://twitter.com/intent/tweet">share</a><a href="https://x.com/acmehvac">X</a>
    <footer>© 1987–2025 Acme</footer></body></html>`;
  const page = extractPage(html, 'https://acme.com/', 'acme.com');

  assert.deepEqual(page.emails.sort(), ['ceo@acme.com', 'jane.doe@acme.com', 'sales@acme.com']);
  assert.deepEqual(page.phones.map((p) => p.e164).sort(), ['+15125550100', '+15125550199']);
  assert.equal(page.socials.linkedin, 'https://www.linkedin.com/company/acme');
  assert.equal(page.socials.twitter, 'https://x.com/acmehvac');
  assert.deepEqual(page.tech.map((t) => t.name), ['HubSpot']);
  assert.equal(page.pageLinks.contact, 'https://acme.com/contact-us');

  const signals = detectSignals(page.text, page.structured);
  assert.equal(signals.foundedYear, 1987);
  assert.equal(signals.copyrightYear, 2025);
  assert.equal(signals.family, true);
  assert.equal(signals.hiring, true);
});

test('normalizePhone formats US numbers and rejects junk', () => {
  assert.deepEqual(normalizePhone('512.555.0100'), { e164: '+15125550100', display: '+1 (512) 555-0100' });
  assert.equal(normalizePhone('12345'), null);
});

const enrichment = {
  alive: true,
  https: true,
  title: 'Acme HVAC',
  description: 'Commercial HVAC maintenance contracts',
  text: 'family owned hvac maintenance company since 1990',
  primaryEmail: { email: 'owner@acme.com', status: 'verified', onDomain: true },
  emails: [{ email: 'owner@acme.com', status: 'verified', onDomain: true }],
  phones: [{ e164: '+15125550100', display: '+1 (512) 555-0100' }],
  socials: { linkedin: 'https://linkedin.com/company/acme' },
  tech: [],
  signals: { family: true, recurring: true, vc: false, foundedYear: 1990, copyrightYear: 2019 },
};

test('scorer: ETA playbook rewards longevity + owner-operated, explains every point', () => {
  const r = scoreLead({ company: 'Acme' }, enrichment, 'eta', { keywords: ['hvac', 'maintenance'], exclude: [] });
  assert.equal(r.tier, 'Hot');
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.equal(r.score, r.breakdown.reduce((s, b) => s + b.points, 0));
  assert.match(r.opener, /years serving customers/);
});

test('scorer: exclusion keyword caps score, dead site scores zero', () => {
  const excluded = scoreLead({ company: 'Acme' }, enrichment, 'eta', { keywords: ['hvac'], exclude: ['family owned'] });
  assert.ok(excluded.score <= 15);
  const dead = scoreLead({ company: 'X' }, { alive: false, error: 'Domain does not exist' }, 'sales', {});
  assert.deepEqual([dead.score, dead.tier], [0, 'Dead']);
});

test('exporter guards against CSV formula injection and maps Salesforce rating', () => {
  const csv = exportLeads([{ company: '=HYPERLINK("x")', domain: 'a.com', score: 80, tier: 'Hot', enrichment: {}, scoring: {} }], 'salesforce');
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes(',Hot,'));
});
