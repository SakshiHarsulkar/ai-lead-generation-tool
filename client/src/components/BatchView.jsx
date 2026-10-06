import { ChevronDown, Download, Loader2, Search, SlidersHorizontal, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { isPending, TIER_STYLE, TIERS } from '../lib/leads.js';
import LeadDrawer from './LeadDrawer.jsx';
import LeadTable from './LeadTable.jsx';
import { Badge, Button, cx, TagInput } from './ui.jsx';

const EXPORTS = [
  { id: 'csv', title: 'CSV (all fields)', body: 'Every contact, signal, score reason and opener' },
  { id: 'hubspot', title: 'HubSpot import', body: 'Columns auto-map to Company + Contact properties' },
  { id: 'salesforce', title: 'Salesforce leads', body: 'Lead object with Hot / Warm / Cold rating' },
];

function ExportMenu({ batchId, ids }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <Button variant="primary" onClick={() => setOpen((v) => !v)} disabled={!ids.length}>
        <Download className="h-4 w-4" /> Export {ids.length} <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200">
          {EXPORTS.map((x) => (
            <a key={x.id} href={api.exportUrl(batchId, x.id, ids)} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-slate-50">
              <div className="text-sm font-medium text-slate-900">{x.title}</div>
              <div className="text-xs text-slate-500">{x.body}</div>
            </a>
          ))}
          <p className="border-t border-slate-100 px-3 pt-2 pb-1 text-[11px] text-slate-400">Exports the {ids.length} leads matching your current filters.</p>
        </div>
      )}
    </div>
  );
}

function TunePanel({ batch, onRescore, busy }) {
  const [mode, setMode] = useState(batch.mode);
  const [keywords, setKeywords] = useState(batch.icp?.keywords ?? []);
  const [exclude, setExclude] = useState(batch.icp?.exclude ?? []);
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="grid gap-4 md:grid-cols-[auto_1fr_1fr]">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Playbook</span>
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            {[
              ['sales', 'Sales'],
              ['eta', 'Acquisition'],
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMode(id)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium transition', mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Target keywords</span>
          <TagInput value={keywords} onChange={setKeywords} placeholder="Add keyword" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Exclude</span>
          <TagInput value={exclude} onChange={setExclude} placeholder="Add exclusion" tone="rose" />
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Re-ranks instantly from saved crawl data. No sites are re-visited.</p>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => onRescore({ mode, icp: { keywords, exclude } })}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Re-score list
        </Button>
      </div>
    </div>
  );
}

export default function BatchView({ batchId, notify, onChanged, onDeleted }) {
  const [batch, setBatch] = useState(null);
  const [leads, setLeads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('All');
  const [needEmail, setNeedEmail] = useState(false);
  const [needPhone, setNeedPhone] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [crawlStats, setCrawlStats] = useState({ fetched: 0, cached: 0 });
  const runningRef = useRef(false);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    const data = await api.getBatch(batchId);
    setBatch(data.batch);
    setLeads(data.leads);
    return data;
  }, [batchId]);

  // Processing loop: ask the API to enrich the next few leads until none remain.
  const runProcessing = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const myBatch = batchId;
    try {
      while (runningRef.current) {
        const result = await api.processBatch(myBatch);
        if (result.stats) setCrawlStats((s) => ({ fetched: s.fetched + result.stats.fetched, cached: s.cached + result.stats.cached }));
        if (result.leads.length) {
          setLeads((prev) => {
            const byId = new Map(result.leads.map((l) => [l.id, l]));
            return prev.map((l) => byId.get(l.id) ?? l);
          });
          onChanged();
        }
        if (result.remaining === 0) break;
        if (!result.leads.length) await new Promise((r) => setTimeout(r, 1500)); // another worker holds the rest
      }
    } catch (err) {
      notify(`Enrichment paused: ${err.message}`);
    } finally {
      runningRef.current = false;
    }
  }, [batchId, notify, onChanged]);

  useEffect(() => {
    setSelectedId(null);
    setTier('All');
    setQuery('');
    setTuning(false);
    setCrawlStats({ fetched: 0, cached: 0 });
    load()
      .then((data) => data.leads.some(isPending) && runProcessing())
      .catch((err) => notify(err.message));
    return () => {
      runningRef.current = false;
    };
  }, [load, runProcessing, notify]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !e.target.closest?.('input, textarea')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pending = leads.filter(isPending).length;
  const done = leads.length - pending;

  const counts = useMemo(() => {
    const c = Object.fromEntries(TIERS.map((t) => [t, 0]));
    leads.forEach((l) => l.tier && c[l.tier]++);
    return c;
  }, [leads]);

  const verified = leads.filter((l) => ['verified', 'role'].includes(l.enrichment?.primaryEmail?.status)).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads
      .filter((l) => tier === 'All' || l.tier === tier || (isPending(l) && tier === 'All'))
      .filter((l) => !needEmail || l.enrichment?.primaryEmail)
      .filter((l) => !needPhone || l.enrichment?.phones?.length)
      .filter((l) => !q || `${l.company} ${l.domain} ${l.enrichment?.primaryEmail?.email ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(isPending(a)) - Number(isPending(b)) || (b.score ?? -1) - (a.score ?? -1));
  }, [leads, tier, needEmail, needPhone, query]);

  const exportIds = visible.filter((l) => !isPending(l)).map((l) => l.id);
  const selectedIndex = visible.findIndex((l) => l.id === selectedId);
  const selected = selectedIndex >= 0 ? visible[selectedIndex] : null;

  const rescore = async (payload) => {
    setRescoring(true);
    try {
      const data = await api.rescore(batchId, payload);
      setBatch(data.batch);
      setLeads(data.leads);
      setTuning(false);
      notify('List re-scored with your new profile.');
      onChanged();
    } catch (err) {
      notify(err.message);
    } finally {
      setRescoring(false);
    }
  };

  const retry = async (leadId) => {
    try {
      const lead = await api.retryLead(leadId);
      setLeads((prev) => prev.map((l) => (l.id === leadId ? lead : l)));
      setSelectedId(null);
      runProcessing();
    } catch (err) {
      notify(err.message);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${batch.name}" and all its leads?`)) return;
    await api.deleteBatch(batchId);
    onDeleted();
  };

  if (!batch) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const statCards = [
    ...['Hot', 'Warm', 'Cold'].map((t) => ({ key: t, label: t === 'Hot' ? 'Hot: call first' : t === 'Warm' ? 'Warm: nurture' : 'Cold: deprioritize', value: counts[t], tier: t })),
    { key: 'verified', label: 'Reachable by email', value: verified },
    { key: 'Dead', label: 'Dead / blocked', value: counts.Dead + leads.filter((l) => l.enrichment?.blocked).length, tier: 'Dead' },
  ];

  return (
    <div className={cx('px-4 py-8 transition-[padding] sm:px-8', selected && '2xl:pr-[500px]')}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{batch.name}</h1>
            <Badge className="bg-slate-100 text-slate-600 ring-slate-300/50">{batch.mode === 'eta' ? 'Acquisition sourcing' : 'Sales prospecting'}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {batch.total} companies
            {batch.duplicates > 0 && ` · ${batch.duplicates} duplicates merged`}
            {batch.invalid > 0 && ` · ${batch.invalid} invalid rows skipped`}
            {batch.icp?.keywords?.length > 0 && ` · targeting ${batch.icp.keywords.join(', ')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={remove} title="Delete list" className="text-slate-400 hover:text-rose-600">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button onClick={() => setTuning((v) => !v)} disabled={pending > 0}>
            <SlidersHorizontal className="h-4 w-4" /> Tune scoring
          </Button>
          <ExportMenu batchId={batchId} ids={exportIds} />
        </div>
      </div>

      {/* Progress */}
      {pending > 0 && (
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium text-slate-800">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" /> Enriching {done} of {leads.length} companies
            </span>
            <span className="text-xs text-slate-500">
              {crawlStats.fetched} pages fetched · {crawlStats.cached} from cache
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${(done / leads.length) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">Results appear below as they land. You can start working the top leads now.</p>
        </div>
      )}

      {tuning && (
        <div className="mt-6">
          <TunePanel batch={batch} onRescore={rescore} busy={rescoring} />
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((c) => {
          const clickable = Boolean(c.tier);
          const active = clickable && tier === c.tier;
          return (
            <button
              key={c.key}
              type="button"
              disabled={!clickable}
              onClick={() => setTier(active ? 'All' : c.tier)}
              className={cx(
                'rounded-xl bg-white p-4 text-left shadow-sm ring-1 transition',
                active ? 'ring-2 ring-indigo-600' : 'ring-slate-200',
                clickable && 'hover:ring-slate-300',
              )}
            >
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                {c.tier && <span className={cx('h-2 w-2 rounded-full', TIER_STYLE[c.tier].bar)} />}
                {c.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{c.value}</div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies  ( / )"
            className="w-64 rounded-lg border-0 bg-white py-2 pr-3 pl-9 text-sm ring-1 ring-slate-300 ring-inset outline-none focus:ring-2 focus:ring-indigo-600"
          />
        </div>
        <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
          {['All', ...TIERS].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={cx('rounded-md px-2.5 py-1 text-xs font-medium transition', tier === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
            >
              {t}
              {t !== 'All' && <span className="ml-1 opacity-60">{counts[t]}</span>}
            </button>
          ))}
        </div>
        {[
          ['Has email', needEmail, setNeedEmail],
          ['Has phone', needPhone, setNeedPhone],
        ].map(([label, on, set]) => (
          <button
            key={label}
            type="button"
            onClick={() => set(!on)}
            aria-pressed={on}
            className={cx('rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition', on ? 'bg-indigo-50 text-indigo-700 ring-indigo-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">
          Showing {visible.length} of {leads.length}
        </span>
      </div>

      {visible.length ? (
        <LeadTable leads={visible} mode={batch.mode} selectedId={selectedId} onSelect={setSelectedId} />
      ) : (
        <div className="rounded-2xl bg-white p-12 text-center text-sm text-slate-500 ring-1 ring-slate-200">No leads match these filters.</div>
      )}

      {selected && !isPending(selected) && (
        <LeadDrawer
          lead={selected}
          mode={batch.mode}
          onClose={() => setSelectedId(null)}
          onPrev={selectedIndex > 0 ? () => setSelectedId(visible[selectedIndex - 1].id) : null}
          onNext={selectedIndex < visible.length - 1 && !isPending(visible[selectedIndex + 1]) ? () => setSelectedId(visible[selectedIndex + 1].id) : null}
          onRetry={retry}
        />
      )}
    </div>
  );
}
