'use client';

import { useMemo, useState } from 'react';
import { Input, Select } from '@/components/ui';

/** Period presets for every report page; "today" is computed in the browser (local time). */
export type Range = { from: string; to: string; label: string };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function presetRange(key: string): Range {
  const today = new Date();
  const start = (d: Date) => iso(d);
  if (key === '7d') { const d = new Date(today); d.setDate(d.getDate() - 7); return { from: start(d), to: iso(today), label: 'Last 7 days' }; }
  if (key === '30d') { const d = new Date(today); d.setDate(d.getDate() - 30); return { from: start(d), to: iso(today), label: 'Last 30 days' }; }
  if (key === '90d') { const d = new Date(today); d.setDate(d.getDate() - 90); return { from: start(d), to: iso(today), label: 'Last 90 days' }; }
  if (key === 'ytd') { return { from: `${today.getFullYear()}-01-01`, to: iso(today), label: 'Year to date' }; }
  if (key === 'all') { return { from: '', to: '', label: 'All time' }; }
  return { from: '', to: '', label: 'All time' };
}

export function PeriodBar({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [custom, setCustom] = useState(false);
  const presets = useMemo(() => [
    { key: '7d', label: '7d' }, { key: '30d', label: '30d' }, { key: '90d', label: '90d' },
    { key: 'ytd', label: 'YTD' }, { key: 'all', label: 'All' },
  ], []);
  const setPreset = (k: string) => { setCustom(false); onChange(presetRange(k)); };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Period:</span>
      {presets.map((p) => (
        <button key={p.key} onClick={() => setPreset(p.key)}
          className={`rounded-full px-3 py-1 ${!custom && value.label.toLowerCase().includes(p.label.toLowerCase().replace('ytd', 'year').replace('all', 'all time').replace('d', ' days')) ? 'bg-brand-600 text-white' : 'border border-line hover:bg-slate-50'}`}>
          {p.label}
        </button>
      ))}
      <button onClick={() => setCustom(true)} className={`rounded-full px-3 py-1 ${custom ? 'bg-brand-600 text-white' : 'border border-line hover:bg-slate-50'}`}>Custom</button>
      {custom && <>
        <Input type="date" className="w-40" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value, label: 'Custom' })} aria-label="From" />
        <span className="text-muted">to</span>
        <Input type="date" className="w-40" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value, label: 'Custom' })} aria-label="To" />
      </>}
      {!custom && <span className="ml-1 text-xs text-muted">{value.label}{value.from && ` · ${value.from} → ${value.to}`}</span>}
    </div>
  );
}

export function rangeQs(r: Range) {
  const p = new URLSearchParams();
  if (r.from) p.set('from', r.from);
  if (r.to) p.set('to', r.to);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function pctLabel(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return `${n}%`;
}

export function daysLabel(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return n === 1 ? '1 day' : `${n} days`;
}

/** Simple horizontal funnel bar: each stage shown as a shrinking row with its count and % of the top. */
export function Funnel({ stages }: { stages: { label: string; value: number; tone?: string }[] }) {
  const top = Math.max(...stages.map((s) => s.value), 1);
  const tone = (k?: string) => k === 'green' ? 'bg-emerald-500' : k === 'amber' ? 'bg-amber-500' : k === 'violet' ? 'bg-violet-500' : k === 'red' ? 'bg-red-500' : 'bg-brand-600';
  return (
    <div className="space-y-2">
      {stages.map((s) => {
        const pct = Math.max(2, Math.round((s.value / top) * 100));
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-44 shrink-0 truncate text-sm text-ink">{s.label}</div>
            <div className="h-7 flex-1 rounded-md bg-slate-100">
              <div className={`h-7 rounded-md ${tone(s.tone)} flex items-center justify-end px-2 text-xs font-semibold text-white`} style={{ width: `${pct}%` }}>
                {s.value > 0 && <span>{s.value}</span>}
              </div>
            </div>
            <div className="w-16 text-right text-sm tabular-nums text-muted">{Math.round((s.value / top) * 100)}%</div>
          </div>
        );
      })}
    </div>
  );
}

/** Mini line / area chart from {bucket, value} rows; renders inline SVG (no chart lib). */
export function Trend({ rows, keys, height = 120 }: { rows: any[]; keys: { k: string; label: string; tone?: string }[]; height?: number }) {
  if (!rows.length) return <div className="p-4 text-sm text-muted">No data in this period.</div>;
  const w = 600;
  const pad = 24;
  const maxY = Math.max(1, ...rows.flatMap((r) => keys.map((k) => Number(r[k.k] ?? 0))));
  const xStep = (w - pad * 2) / Math.max(rows.length - 1, 1);
  const y = (v: number) => height - pad - (v / maxY) * (height - pad * 2);
  const paths = keys.map((k) => rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * xStep} ${y(Number(r[k.k] ?? 0))}`).join(' '));
  const colour = (tone?: string) => tone === 'green' ? '#059669' : tone === 'amber' ? '#d97706' : tone === 'violet' ? '#7c3aed' : tone === 'red' ? '#dc2626' : '#2563eb';
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="Trend">
        {paths.map((d, i) => <path key={i} d={d} fill="none" stroke={colour(keys[i].tone)} strokeWidth={2} />)}
        <line x1={pad} y1={height - pad} x2={w - pad} y2={height - pad} stroke="#e5e7eb" />
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {keys.map((k) => (
          <span key={k.k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: colour(k.tone) }} />{k.label}
          </span>
        ))}
        <span className="ml-auto text-muted">{rows[0].bucket} → {rows[rows.length - 1].bucket}</span>
      </div>
    </div>
  );
}

export function DeptPicker({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { id: string; name: string }[] }) {
  return (
    <Select className="max-w-xs" value={value} onChange={(e) => onChange(e.target.value)} placeholder="All departments in your scope"
      options={options.map((o) => ({ value: o.id, label: o.name }))} aria-label="Department" />
  );
}
