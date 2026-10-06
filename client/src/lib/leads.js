export const TIERS = ['Hot', 'Warm', 'Cold', 'Dead'];

export const TIER_STYLE = {
  Hot: { badge: 'bg-rose-50 text-rose-700 ring-rose-600/20', ring: '#e11d48', bar: 'bg-rose-500' },
  Warm: { badge: 'bg-amber-50 text-amber-700 ring-amber-600/20', ring: '#d97706', bar: 'bg-amber-500' },
  Cold: { badge: 'bg-sky-50 text-sky-700 ring-sky-600/20', ring: '#0284c7', bar: 'bg-sky-500' },
  Dead: { badge: 'bg-slate-100 text-slate-500 ring-slate-400/30', ring: '#94a3b8', bar: 'bg-slate-400' },
};

export const EMAIL_STATUS = {
  verified: { label: 'Verified', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  role: { label: 'Shared inbox', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  risky: { label: 'Risky', cls: 'bg-orange-50 text-orange-700 ring-orange-600/20', dot: 'bg-orange-500' },
  invalid: { label: 'Invalid', cls: 'bg-rose-50 text-rose-700 ring-rose-600/20', dot: 'bg-rose-500' },
};

export const isPending = (lead) => lead.status === 'pending' || lead.status === 'processing';

/** Short, scannable chips for the table — the "why should I care" at a glance. */
export function signalChips(lead, mode) {
  const e = lead.enrichment;
  if (!e) return [];
  const s = e.signals ?? {};
  const chips = [];
  const year = new Date().getFullYear();
  if (e.blocked) chips.push({ label: 'Bot-protected', tone: 'slate' });
  if (mode === 'eta') {
    if (s.foundedYear) chips.push({ label: `${year - s.foundedYear} yrs`, tone: 'violet' });
    if (s.family) chips.push({ label: 'Owner-operated', tone: 'emerald' });
    if (s.recurring) chips.push({ label: 'Recurring revenue', tone: 'sky' });
    if (s.vc) chips.push({ label: 'VC-backed', tone: 'slate' });
  } else {
    if (s.hiring) chips.push({ label: 'Hiring', tone: 'emerald' });
    const crm = e.tech?.find((t) => t.category === 'crm');
    if (crm) chips.push({ label: crm.name, tone: 'violet' });
    if (s.pricing || s.demo) chips.push({ label: 'Sales funnel', tone: 'sky' });
  }
  if (lead.scoring?.excludedBy) chips.unshift({ label: 'Excluded', tone: 'rose' });
  return chips;
}

export const CHIP_TONE = {
  emerald: 'bg-emerald-50 text-emerald-700',
  violet: 'bg-violet-50 text-violet-700',
  sky: 'bg-sky-50 text-sky-700',
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-50 text-rose-700',
};

export function groupTotals(breakdown = []) {
  const groups = new Map();
  for (const item of breakdown) {
    if (!item.max) continue;
    const g = groups.get(item.group) ?? { group: item.group, points: 0, max: 0 };
    g.points += item.points;
    g.max += item.max;
    groups.set(item.group, g);
  }
  return [...groups.values()];
}

export const faviconUrl = (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
