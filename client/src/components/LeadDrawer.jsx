import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  ExternalLink,
  Github,
  Globe,
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  Phone,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Twitter,
  X,
  Youtube,
} from 'lucide-react';
import { useEffect } from 'react';
import { EMAIL_STATUS, groupTotals, TIER_STYLE } from '../lib/leads.js';
import { Badge, Button, CopyButton, cx, Favicon, ScoreRing, TierBadge } from './ui.jsx';

const SOCIAL_ICONS = { linkedin: Linkedin, twitter: Twitter, facebook: Facebook, instagram: Instagram, youtube: Youtube, github: Github };

function Section({ title, icon: Icon, children, right }) {
  return (
    <section className="border-t border-slate-100 px-6 py-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-slate-500 uppercase">
          {Icon && <Icon className="h-3.5 w-3.5" />} {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function LeadDrawer({ lead, mode, onClose, onPrev, onNext, onRetry }) {
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.target.closest?.('input, textarea')) return;
      if (ev.key === 'Escape') onClose();
      if (ev.key === 'ArrowDown' || ev.key === 'j') onNext?.();
      if (ev.key === 'ArrowUp' || ev.key === 'k') onPrev?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNext, onPrev]);

  if (!lead) return null;
  const e = lead.enrichment ?? {};
  const sc = lead.scoring ?? {};
  const ai = lead.insight;
  const opener = ai?.opener ?? sc.opener;
  const groups = groupTotals(sc.breakdown);
  const s = e.signals ?? {};

  return (
    <>
      <div className="fixed inset-0 z-30 bg-slate-900/20 lg:hidden" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[480px] flex-col bg-white shadow-2xl ring-1 ring-slate-200 animate-slide-in" aria-label={`${lead.company} details`}>
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4">
          <Favicon domain={lead.domain} size={40} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900">{lead.company}</h2>
            <a href={e.finalUrl ?? `https://${lead.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
              {lead.domain} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center">
            <button type="button" onClick={onPrev} disabled={!onPrev} title="Previous (↑)" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30">
              <ArrowUp className="h-4 w-4" />
            </button>
            <button type="button" onClick={onNext} disabled={!onNext} title="Next (↓)" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30">
              <ArrowDown className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} title="Close (Esc)" className="ml-1 rounded p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Score summary */}
          <div className="flex items-center gap-5 px-6 pb-5">
            <ScoreRing score={lead.score} tier={lead.tier} size={72} />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <TierBadge tier={lead.tier} />
                <span className="text-xs text-slate-500">{mode === 'eta' ? 'Acquisition fit' : 'Sales readiness'}</span>
              </div>
              {groups.map((g) => (
                <div key={g.group}>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>{g.group}</span>
                    <span className="tabular-nums">
                      {g.points}/{g.max}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={cx('h-full rounded-full', TIER_STYLE[lead.tier]?.bar)} style={{ width: `${(g.points / g.max) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {(e.blocked || !e.alive) && (
            <div className="mx-6 mb-5 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{e.error}</span>
            </div>
          )}

          {/* Outreach */}
          {opener && (
            <Section title={ai ? 'AI insight' : 'Suggested opener'} icon={Sparkles} right={<CopyButton text={opener} label="Copy opener" />}>
              {ai?.summary && <p className="mb-2 text-sm text-slate-700">{ai.summary}</p>}
              <blockquote className="rounded-lg bg-indigo-50/70 p-3 text-sm leading-relaxed text-slate-800 ring-1 ring-indigo-100">{opener}</blockquote>
              {ai?.fit_reason && <p className="mt-2 text-xs text-slate-600">{ai.fit_reason}</p>}
              {ai?.red_flags?.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-rose-700">
                  {ai.red_flags.map((f) => (
                    <li key={f}>⚠ {f}</li>
                  ))}
                </ul>
              )}
              {sc.talkingPoints?.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {sc.talkingPoints.map((p) => (
                    <li key={p} className="flex gap-2 text-xs text-slate-600">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" /> {p}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* Why */}
          <Section title="Why this score">
            <ul className="space-y-1.5">
              {(sc.breakdown ?? []).map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {b.hit ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
                  <span className={cx('flex-1', b.hit ? 'text-slate-800' : 'text-slate-500')}>{b.label}</span>
                  {b.max > 0 && <span className={cx('text-xs tabular-nums', b.hit ? 'font-medium text-emerald-700' : 'text-slate-400')}>{b.hit ? `+${b.points}` : `0/${b.max}`}</span>}
                </li>
              ))}
            </ul>
          </Section>

          {/* Contacts */}
          <Section title="Contacts" icon={Mail}>
            {e.emails?.length ? (
              <ul className="space-y-1.5">
                {e.emails.map((em) => (
                  <li key={em.email} className="flex items-center gap-2 text-sm">
                    <span className={cx('flex-1 truncate', em.status === 'invalid' ? 'text-slate-400 line-through' : 'text-slate-800')}>{em.email}</span>
                    <Badge className={EMAIL_STATUS[em.status]?.cls}>{EMAIL_STATUS[em.status]?.label}</Badge>
                    <CopyButton text={em.email} label="Copy email" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No public email addresses found.</p>
            )}
            {e.phones?.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {e.phones.map((p) => (
                  <li key={p.e164} className="flex items-center gap-2 text-sm text-slate-800">
                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                    <a href={`tel:${p.e164}`} className="flex-1 hover:underline">
                      {p.display}
                    </a>
                    <CopyButton text={p.e164} label="Copy phone" />
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(e.socials ?? {}).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(e.socials).map(([network, url]) => {
                  const Icon = SOCIAL_ICONS[network] ?? Globe;
                  return (
                    <a key={network} href={url} target="_blank" rel="noreferrer" title={url} className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">
                      <Icon className="h-3.5 w-3.5" /> {network}
                    </a>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Company */}
          {(e.title || e.description || e.tech?.length > 0) && (
            <Section title="Company" icon={Globe}>
              {e.description && <p className="text-sm text-slate-700">{e.description}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <dt className="text-slate-500">Founded</dt>
                <dd className="text-slate-800">{s.foundedYear ?? '—'}</dd>
                <dt className="text-slate-500">Site last updated</dt>
                <dd className="text-slate-800">{s.copyrightYear ? `© ${s.copyrightYear}` : '—'}</dd>
                <dt className="text-slate-500">Hiring</dt>
                <dd className="text-slate-800">{s.hiring ? 'Yes' : 'No signal'}</dd>
                <dt className="text-slate-500">Keyword matches</dt>
                <dd className="text-slate-800">{sc.matchedKeywords?.join(', ') || '—'}</dd>
              </dl>
              {e.tech?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {e.tech.map((t) => (
                    <span key={t.name} className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700" title={t.category}>
                      {t.name}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Crawl log */}
          <Section title="Data sources" right={<Button size="sm" variant="ghost" onClick={() => onRetry(lead.id)}><RefreshCw className="h-3.5 w-3.5" /> Re-crawl</Button>}>
            <ul className="space-y-1 font-mono text-[11px]">
              {(e.pages ?? []).map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={cx('w-8 tabular-nums', p.status >= 200 && p.status < 300 ? 'text-emerald-600' : 'text-rose-600')}>{p.status || 'ERR'}</span>
                  <span className="flex-1 truncate text-slate-600" title={p.url}>
                    {p.url?.replace(/^https?:\/\//, '')}
                  </span>
                  <span className="text-slate-400">{p.cached ? 'cache' : `${p.ms}ms`}</span>
                </li>
              ))}
              {e.robotsBlocked?.map((path) => (
                <li key={path} className="text-amber-700">
                  robots.txt disallows {path}, skipped
                </li>
              ))}
            </ul>
            {e.crawledAt && <p className="mt-2 text-[11px] text-slate-400">Crawled {new Date(e.crawledAt).toLocaleString()}</p>}
          </Section>
        </div>
      </aside>
    </>
  );
}
