import { ChevronRight, Loader2, Phone } from 'lucide-react';
import { CHIP_TONE, EMAIL_STATUS, isPending, signalChips } from '../lib/leads.js';
import { CopyButton, cx, Favicon, ScoreRing, TierBadge } from './ui.jsx';

function PendingRow({ lead }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="py-3 pr-3 pl-4">
        <div className="skeleton h-10 w-10 rounded-full" />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-3">
          <Favicon domain={lead.domain} />
          <div>
            <div className="text-sm font-medium text-slate-900">{lead.company}</div>
            <div className="text-xs text-slate-500">{lead.domain}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3" colSpan={3}>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {lead.status === 'processing' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" /> Crawling site and verifying contacts…
            </>
          ) : (
            <>
              <span className="skeleton h-2.5 w-40 rounded" /> Queued
            </>
          )}
        </span>
      </td>
      <td />
    </tr>
  );
}

export default function LeadTable({ leads, mode, selectedId, onSelect }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full min-w-[820px] text-left">
        <thead>
          <tr className="border-b border-slate-200 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            <th className="py-3 pr-3 pl-4">Score</th>
            <th className="px-3 py-3">Company</th>
            <th className="px-3 py-3">Best contact</th>
            <th className="px-3 py-3">Phone</th>
            <th className="px-3 py-3">Signals</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            if (isPending(lead)) return <PendingRow key={lead.id} lead={lead} />;
            const e = lead.enrichment ?? {};
            const pe = e.primaryEmail;
            const phone = e.phones?.[0];
            const chips = signalChips(lead, mode);
            return (
              <tr
                key={lead.id}
                onClick={() => onSelect(lead.id)}
                className={cx(
                  'group cursor-pointer border-b border-slate-100 transition last:border-0',
                  selectedId === lead.id ? 'bg-indigo-50/60' : 'hover:bg-slate-50',
                  lead.tier === 'Dead' && 'opacity-60',
                )}
              >
                <td className="py-3 pr-3 pl-4">
                  <ScoreRing score={lead.score} tier={lead.tier} />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <Favicon domain={lead.domain} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{lead.company}</span>
                        <TierBadge tier={lead.tier} />
                      </div>
                      <div className="truncate text-xs text-slate-500">{e.error && !e.alive ? <span className="text-rose-600">{e.error}</span> : lead.domain}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  {pe ? (
                    <div className="flex items-center gap-1.5">
                      <span className={cx('h-2 w-2 shrink-0 rounded-full', EMAIL_STATUS[pe.status]?.dot)} title={EMAIL_STATUS[pe.status]?.label} />
                      <span className="max-w-[220px] truncate text-sm text-slate-700">{pe.email}</span>
                      <CopyButton text={pe.email} label="Copy email" className="opacity-0 group-hover:opacity-100" />
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">{e.blocked ? 'Site blocks bots' : 'None found'}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-sm whitespace-nowrap text-slate-700">
                  {phone ? (
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-400" /> {phone.display}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {chips.slice(0, 3).map((c) => (
                      <span key={c.label} className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', CHIP_TONE[c.tone])}>
                        {c.label}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="pr-3">
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
