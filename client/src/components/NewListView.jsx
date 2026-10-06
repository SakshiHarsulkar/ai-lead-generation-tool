import { ArrowRight, Building2, CheckCircle2, FileUp, Loader2, Target, TrendingUp, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Button, cx, TagInput } from './ui.jsx';

const MODE_CARDS = [
  {
    id: 'sales',
    icon: TrendingUp,
    title: 'Sales prospecting',
    body: 'Find companies ready to buy: reachable decision makers, hiring, already investing in sales tools.',
  },
  {
    id: 'eta',
    icon: Building2,
    title: 'Acquisition sourcing',
    body: 'Find businesses worth buying: long track record, owner-operated, recurring revenue, digital upside.',
  },
];

function Step({ n, title, hint, children }) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{n}</span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function NewListView({ meta, onCreated, notify }) {
  const [mode, setMode] = useState('sales');
  const [input, setInput] = useState('');
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState([]);
  const [exclude, setExclude] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const fileRef = useRef(null);

  // Mode presets give a sensible ICP out of the box; the user can edit freely.
  useEffect(() => {
    if (!meta) return;
    setKeywords(meta.defaultIcp[mode].keywords);
    setExclude(meta.defaultIcp[mode].exclude);
  }, [mode, meta]);

  // Live, debounced dry-run so users see exactly what will be imported before committing.
  useEffect(() => {
    if (!input.trim()) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    const t = setTimeout(() => {
      api
        .preview(input)
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewing(false));
    }, 350);
    return () => clearTimeout(t);
  }, [input]);

  const loadFile = async (file) => {
    if (!file) return;
    if (file.size > 4_000_000) return notify('That file is over 4 MB. Split it into smaller lists.');
    setInput(await file.text());
    if (!name) setName(file.name.replace(/\.(csv|txt|tsv)$/i, ''));
  };

  const loadSample = async () => {
    setInput(await api.sample());
    setName('Sample: B2B software companies');
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await api.createBatch({ name, mode, icp: { keywords, exclude }, input });
      onCreated(result.batch.id);
    } catch (err) {
      notify(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const issues = preview ? preview.duplicates.length + preview.invalid.length : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Turn a raw company list into a ranked call sheet</h1>
        <p className="mt-2 text-slate-600">
          Paste websites or upload a CSV. LeadLens visits each site, finds and verifies contacts, scores fit against your ideal profile, and tells you who to call first.
        </p>
      </header>

      <div className="space-y-5">
        <Step n={1} title="What are you sourcing for?" hint="This decides which signals count toward the score.">
          <div className="grid gap-3 sm:grid-cols-2">
            {MODE_CARDS.map(({ id, icon: Icon, title, body }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={mode === id}
                className={cx(
                  'rounded-xl p-4 text-left ring-1 transition',
                  mode === id ? 'bg-indigo-50/60 ring-2 ring-indigo-600' : 'ring-slate-200 hover:ring-slate-300',
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className={cx('h-4 w-4', mode === id ? 'text-indigo-600' : 'text-slate-400')} />
                  <span className="text-sm font-semibold">{title}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{body}</p>
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="Add companies" hint="One website, domain or work email per line, or any CSV with a Website / Domain column.">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              loadFile(e.dataTransfer.files[0]);
            }}
            className={cx('relative rounded-xl ring-1 transition', dragging ? 'bg-indigo-50 ring-2 ring-indigo-500' : 'ring-slate-300')}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={'acme.com\nhttps://www.globex.com\nCompany,Website\nInitech,initech.io'}
              className="block w-full resize-y rounded-xl border-0 bg-transparent px-4 py-3 font-mono text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
            {dragging && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-indigo-700">Drop CSV to import</div>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <FileUp className="h-3.5 w-3.5" /> Upload CSV
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv" className="hidden" onChange={(e) => loadFile(e.target.files[0])} />
            <Button size="sm" variant="ghost" onClick={loadSample}>
              Try the sample list
            </Button>

            <div className="ml-auto text-sm" aria-live="polite">
              {previewing && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              {!previewing && preview && (
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1 font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {preview.count} {preview.count === 1 ? 'company' : 'companies'} ready
                  </span>
                  {issues > 0 && (
                    <button type="button" onClick={() => setShowIssues((v) => !v)} className="flex items-center gap-1 text-amber-700 hover:underline">
                      <TriangleAlert className="h-4 w-4" /> {issues} cleaned up
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>

          {showIssues && preview && issues > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-amber-50/60 p-3 text-xs text-slate-700 ring-1 ring-amber-200">
              {preview.duplicates.map((d, i) => (
                <div key={`d${i}`} className="py-0.5">
                  <span className="font-medium text-amber-800">Merged duplicate</span> · {d.row} <span className="text-slate-400">→ {d.domain}</span>
                </div>
              ))}
              {preview.invalid.map((d, i) => (
                <div key={`i${i}`} className="py-0.5">
                  <span className="font-medium text-rose-700">Skipped</span> · {d.row || '(empty row)'} <span className="text-slate-400">: {d.reason}</span>
                </div>
              ))}
            </div>
          )}
        </Step>

        <Step n={3} title="Describe your ideal company" hint="Leads mentioning these words rank higher. Exclusions are capped at Cold.">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Target className="h-3.5 w-3.5" /> Target keywords
              </span>
              <TagInput value={keywords} onChange={setKeywords} placeholder="e.g. hvac, maintenance, b2b" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">Exclude if the site mentions</span>
              <TagInput value={exclude} onChange={setExclude} placeholder="e.g. franchise, agency" tone="rose" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">List name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 Texas HVAC targets"
                className="block w-full rounded-lg border-0 px-3 py-2.5 text-sm ring-1 ring-slate-300 ring-inset outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </label>
          </div>
        </Step>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">Public pages only · robots.txt respected · results cached for 7 days</p>
          <Button variant="primary" size="lg" disabled={!preview?.count || submitting} onClick={submit}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {preview?.count ? `Enrich & score ${preview.count} ${preview.count === 1 ? 'company' : 'companies'}` : 'Add companies to start'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
