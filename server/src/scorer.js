/**
 * Transparent, explainable lead scoring (0-100). Every point is tied to a reason the rep can read,
 * so the score can be trusted and argued with, unlike a black-box number.
 *
 * Two playbooks, because SaaSquatch serves two audiences:
 *   sales -> companies likely to BUY now      (reachable, ICP fit, growth + tooling signals)
 *   eta   -> companies worth ACQUIRING        (reachable, ICP fit, longevity, owner-operated, upside)
 */

export const MODES = {
  sales: { label: 'Sales prospecting' },
  eta: { label: 'Acquisition sourcing (ETA)' },
};

export const DEFAULT_ICP = {
  sales: { keywords: ['software', 'saas', 'platform', 'b2b', 'automation'], exclude: ['casino', 'adult'] },
  eta: { keywords: ['services', 'maintenance', 'hvac', 'plumbing', 'manufacturing', 'distribution'], exclude: ['franchise opportunity'] },
};

export const tierFor = (score, alive = true) => (!alive ? 'Dead' : score >= 70 ? 'Hot' : score >= 45 ? 'Warm' : 'Cold');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const containsWord = (haystack, word) => new RegExp(`(^|[^a-z0-9])${escapeRe(word.toLowerCase())}($|[^a-z0-9])`, 'i').test(haystack);

export function scoreLead(lead, e, mode = 'sales', icp = {}) {
  const items = [];
  const add = (group, label, points, max) => items.push({ group, label, points, max, hit: points > 0 });
  const year = new Date().getFullYear();

  if (!e.alive || (e.blocked && !e.emails?.length)) {
    const label = e.blocked ? e.error : `Not reachable: ${e.error ?? 'unknown error'}`;
    return { score: 0, tier: e.alive ? 'Cold' : 'Dead', breakdown: [{ group: 'Status', label, points: 0, max: 0, hit: false }], matchedKeywords: [], excludedBy: null, talkingPoints: [], opener: '' };
  }

  // --- Reachability (35): can a rep actually start a conversation? ---
  const pe = e.primaryEmail;
  if (pe?.status === 'verified' && pe.onDomain) add('Reachability', `Verified personal email (${pe.email})`, 20, 20);
  else if (pe?.status === 'verified') add('Reachability', `Verified email, different domain (${pe.email})`, 12, 20);
  else if (pe?.status === 'role') add('Reachability', `Shared inbox only (${pe.email})`, 10, 20);
  else if (pe) add('Reachability', `Unverified email (${pe.email})`, 4, 20);
  else add('Reachability', 'No usable email found', 0, 20);
  add('Reachability', e.phones?.length ? `Phone number (${e.phones[0].display})` : 'No phone number found', e.phones?.length ? 10 : 0, 10);
  add('Reachability', e.socials?.linkedin ? 'LinkedIn page found' : 'No LinkedIn page', e.socials?.linkedin ? 5 : 0, 5);

  // --- ICP fit (30): does the company match who we sell to / buy? ---
  const keywords = (icp.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const haystack = `${e.title ?? ''} ${e.description ?? ''} ${e.text ?? ''}`.toLowerCase();
  const matchedKeywords = keywords.filter((k) => containsWord(haystack, k));
  if (!keywords.length) add('ICP fit', 'No ICP keywords set (neutral)', 15, 30);
  else {
    const pts = [0, 12, 20, 30][Math.min(matchedKeywords.length, 3)];
    add('ICP fit', matchedKeywords.length ? `Matches: ${matchedKeywords.join(', ')}` : `No match for: ${keywords.join(', ')}`, pts, 30);
  }

  // --- Mode-specific signals ---
  const s = e.signals ?? {};
  const crm = e.tech?.filter((t) => t.category === 'crm' || t.category === 'support') ?? [];
  const socialCount = Object.keys(e.socials ?? {}).length;
  const founded = s.foundedYear;
  const age = founded ? year - founded : null;

  if (mode === 'eta') {
    add('Acquisition signals', age >= 20 ? `Established ${age} yrs (since ${founded})` : age >= 10 ? `In business ${age} yrs (since ${founded})` : founded ? `Young company (since ${founded})` : 'Founding year unknown', age >= 20 ? 12 : age >= 10 ? 8 : 0, 12);
    add('Acquisition signals', s.family ? 'Family / owner-operated (succession candidate)' : 'No owner-operated signal', s.family ? 8 : 0, 8);
    add('Acquisition signals', s.vc ? 'Appears venture-backed (harder to acquire)' : 'No sign of VC funding (bootstrapped)', s.vc ? 0 : 5, 5);
    add('Acquisition signals', s.recurring ? 'Recurring / contract revenue language' : 'No recurring-revenue signal', s.recurring ? 5 : 0, 5);
    const underDigitized = (s.copyrightYear && s.copyrightYear <= year - 2) || !e.tech?.some((t) => t.category === 'analytics' || t.category === 'crm');
    add('Acquisition signals', underDigitized ? 'Under-digitized: room for AI / ops upside' : 'Already digitally mature', underDigitized ? 5 : 0, 5);
  } else {
    add('Buying signals', s.hiring ? 'Hiring now (growth mode)' : 'No hiring signal', s.hiring ? 8 : 0, 8);
    add('Buying signals', crm.length ? `Invests in sales/CX tools (${crm.map((t) => t.name).join(', ')})` : 'No sales tooling detected', crm.length ? 7 : 0, 7);
    add('Buying signals', s.pricing || s.demo ? 'Sales-led funnel (pricing / demo page)' : 'No pricing or demo page', s.pricing || s.demo ? 5 : 0, 5);
    add('Buying signals', socialCount >= 2 ? `Active on ${socialCount} social networks` : 'Thin social presence', socialCount >= 2 ? 5 : 0, 5);
    add('Site health', e.https ? 'Secure site (HTTPS)' : 'No HTTPS', e.https ? 5 : 0, 5);
    const fresh = s.copyrightYear && s.copyrightYear >= year - 1;
    add('Site health', fresh ? `Recently updated (© ${s.copyrightYear})` : s.copyrightYear ? `Possibly stale (© ${s.copyrightYear})` : 'Update date unknown', fresh ? 5 : 0, 5);
  }

  let score = Math.min(100, items.reduce((sum, i) => sum + i.points, 0));

  // "Hot" means "call first", so a lead with no way to reach anyone can't be Hot.
  if (!pe && !e.phones?.length && score >= 70) {
    score = 64;
    items.push({ group: 'Cap', label: 'Capped at Warm: no direct email or phone yet', points: 0, max: 0, hit: false });
  }

  // Hard exclusions cap the score: they should never surface as Hot.
  const excludedBy = (icp.exclude ?? []).map((k) => k.trim()).filter(Boolean).find((k) => containsWord(haystack, k)) ?? null;
  if (excludedBy) {
    score = Math.min(score, 15);
    items.push({ group: 'Exclusion', label: `Excluded keyword: "${excludedBy}"`, points: 0, max: 0, hit: false });
  }

  const { talkingPoints, opener } = buildOutreach(lead, e, mode, matchedKeywords, age);
  return { score, tier: tierFor(score), breakdown: items, matchedKeywords, excludedBy, talkingPoints, opener };
}

/** Rule-based outreach suggestions (always available; AI insight refines them when enabled). */
function buildOutreach(lead, e, mode, matched, age) {
  const s = e.signals ?? {};
  const points = [];
  const topic = matched[0] ?? (mode === 'eta' ? 'services' : 'growth');

  if (mode === 'eta') {
    if (age) points.push(`${age} years in business: lead with respect for the legacy the owner built.`);
    if (s.family) points.push('Owner-operated: frame the conversation around succession and keeping the team intact.');
    if (s.recurring) points.push('Recurring revenue mentioned: ask about contract mix and customer retention.');
    if (s.copyrightYear && s.copyrightYear <= new Date().getFullYear() - 2) points.push(`Website last touched in ${s.copyrightYear}: a modernization / AI story post-close.`);
    const opener = age
      ? `Congratulations on ${age} years serving customers. I'm an operator-investor looking to partner with established ${topic} businesses like ${lead.company}, and I'd value 15 minutes to learn how you think about the next chapter.`
      : `I've been researching ${topic} businesses and ${lead.company} stood out. I'm an operator-investor focused on long-term partnerships. Open to a short, confidential conversation?`;
    return { talkingPoints: points, opener };
  }

  if (s.hiring) points.push('Actively hiring: pitch on scaling output without adding headcount.');
  const crm = e.tech?.find((t) => t.category === 'crm');
  if (crm) points.push(`Uses ${crm.name}: emphasise a native integration and pipeline ROI.`);
  if (s.pricing || s.demo) points.push('Runs a sales-led funnel: speak to conversion rate and lead quality.');
  if (e.tech?.some((t) => t.category === 'ecommerce')) points.push('E-commerce stack detected: talk about repeat revenue and AOV.');
  const opener = s.hiring
    ? `Saw ${lead.company} is hiring. Teams scaling that fast usually feel lead-flow pain first. Worth a quick idea on how similar ${topic} companies keep pipeline ahead of headcount?`
    : crm
      ? `Noticed ${lead.company} runs on ${crm.name}. We plug straight into it to surface which accounts are ready to buy. Open to a 15-minute look?`
      : `Came across ${lead.company} while researching ${topic} companies. I have one idea that could help your team book more qualified meetings. Worth a short chat?`;
  return { talkingPoints: points, opener };
}
