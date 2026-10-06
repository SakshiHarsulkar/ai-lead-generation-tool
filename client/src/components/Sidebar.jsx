import { Database, ListPlus, Search, Sparkles } from 'lucide-react';
import { timeAgo } from '../lib/leads.js';
import { cx } from './ui.jsx';

export default function Sidebar({ batches, activeId, onSelect, onNew, health }) {
  return (
    <aside className="flex w-full shrink-0 flex-col bg-slate-900 text-slate-300 md:h-full md:w-64">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500">
          <Search className="h-4 w-4 text-white" strokeWidth={2.5} />
        </span>
        <div>
          <div className="text-base font-semibold tracking-tight text-white">LeadLens</div>
          <div className="text-[11px] text-slate-400">Enrich · Verify · Prioritize</div>
        </div>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onNew}
          className={cx(
            'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
            activeId === null ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-white hover:bg-slate-700',
          )}
        >
          <ListPlus className="h-4 w-4" /> New lead list
        </button>
      </div>

      <div className="mt-6 px-5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Your lists</div>
      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4 max-md:max-h-48">
        {batches.length === 0 && <p className="px-2 py-3 text-xs text-slate-500">No lists yet. Upload your first one.</p>}
        {batches.map((b) => {
          const pct = b.total ? Math.round((b.processed / b.total) * 100) : 0;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect(b.id)}
              className={cx('w-full rounded-lg px-3 py-2 text-left transition', activeId === b.id ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{b.name}</span>
                {b.hot > 0 && <span className="shrink-0 rounded bg-rose-500/15 px-1.5 text-[11px] font-semibold text-rose-300">{b.hot} hot</span>}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                <span>{b.mode === 'eta' ? 'Acquisition' : 'Sales'}</span>·<span>{b.total} cos</span>·<span>{timeAgo(b.created_at)}</span>
              </div>
              {pct < 100 && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-700">
                  <div className="h-full bg-indigo-400 transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {health && (
        <div className="space-y-1.5 border-t border-slate-800 px-5 py-4 text-[11px] text-slate-500 max-md:hidden">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5" /> {health.db === 'postgres' ? 'PostgreSQL' : 'Embedded Postgres (local)'}
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className={cx('h-3.5 w-3.5', health.ai && 'text-indigo-400')} /> AI insights {health.ai ? 'on' : 'off (rule-based)'}
          </div>
        </div>
      )}
    </aside>
  );
}
