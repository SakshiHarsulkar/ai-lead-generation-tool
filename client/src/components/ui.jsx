import { Check, Copy, Globe, X } from 'lucide-react';
import { useState } from 'react';
import { faviconUrl, TIER_STYLE } from '../lib/leads.js';

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

const BUTTON = {
  primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:bg-indigo-300',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'text-rose-600 hover:bg-rose-50',
};

export function Button({ variant = 'secondary', size = 'md', className, children, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : size === 'lg' ? 'px-5 py-3 text-sm' : 'px-3.5 py-2 text-sm',
        BUTTON[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({ className, children }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', className)}>{children}</span>;
}

export function TierBadge({ tier }) {
  if (!tier) return null;
  return <Badge className={TIER_STYLE[tier]?.badge}>{tier}</Badge>;
}

export function ScoreRing({ score, tier, size = 40 }) {
  const stroke = size > 50 ? 6 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`Score ${value} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TIER_STYLE[tier]?.ring ?? '#94a3b8'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (value / 100) * c}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <span className={cx('absolute inset-0 flex items-center justify-center font-semibold tabular-nums', size > 50 ? 'text-xl' : 'text-xs')}>{value}</span>
    </div>
  );
}

export function Favicon({ domain, size = 28 }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-slate-200" style={{ width: size, height: size }}>
      {failed ? (
        <Globe className="h-1/2 w-1/2 text-slate-400" />
      ) : (
        <img src={faviconUrl(domain)} alt="" width={size - 8} height={size - 8} loading="lazy" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy', className }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? 'Copied' : label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className={cx('rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700', className)}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Chip-style keyword input: Enter or comma adds, Backspace removes the last chip. */
export function TagInput({ value, onChange, placeholder, tone = 'indigo' }) {
  const [draft, setDraft] = useState('');
  const commit = (raw) => {
    const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  const chip = tone === 'rose' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-indigo-50 text-indigo-700 ring-indigo-200';
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-300 ring-inset focus-within:ring-2 focus-within:ring-indigo-600">
      {value.map((tag) => (
        <span key={tag} className={cx('inline-flex items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-xs font-medium ring-1', chip)}>
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))} className="rounded opacity-60 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => (e.target.value.includes(',') ? commit(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => commit(draft)}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-400"
      />
    </div>
  );
}

export function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl animate-slide-in" role="status">
      <span className="flex-1">{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="text-slate-400 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
