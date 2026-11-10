'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Badge, Button, Select, cx } from '../ui';
import { markOf, shortDate, slotStage, time } from './rounds';

type Col = 'WRITTEN' | 'INTERVIEW' | 'OPTIONAL';
const COL_LABEL: Record<Col, string> = { WRITTEN: 'Written', INTERVIEW: 'Interview', OPTIONAL: 'Optional exam' };
const ATTENDANCE = ['Not Recorded', 'Present', 'Absent'];
const key = (appId: string, col: Col) => `${appId}:${col}`;

/**
 * Interview step 2 (owner, 2026-11-09): attendance and marks typed into a sheet-like grid. Changes stay on screen, highlighted,
 * until **Save changes** sends them all (or Discard drops them); Enter and the arrow keys move up and down like Excel. The "out of"
 * in each header is sent with every mark. The Optional exam column appears only when a candidate in view has one.
 */
export function MarksGrid({ rows, showVacancy, canMarks, canAttendance, canSalary, onError, onMessage, onDirtyChange, selected, onToggle, onToggleAll, onSaved }: {
  rows: any[]; showVacancy: boolean; canMarks: boolean; canAttendance: boolean; canSalary: boolean;
  onError: (msg: string | null) => void; onMessage: (msg: string) => void; onDirtyChange?: (n: number) => void;
  selected: Set<string>; onToggle: (id: string) => void; onToggleAll: () => void; onSaved: () => void;
}) {
  const cols: Col[] = useMemo(() => (rows.some((r) => r.stages.OPTIONAL || markOf(r, 'OPTIONAL')) ? ['WRITTEN', 'INTERVIEW', 'OPTIONAL'] : ['WRITTEN', 'INTERVIEW']), [rows]);
  const initialMax = (c: Col) => String(rows.map((r) => markOf(r, c)?.maxMarks).find((x) => x != null) ?? 100);
  const [max, setMax] = useState<Record<Col, string>>({ WRITTEN: '100', INTERVIEW: '100', OPTIONAL: '100' });
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, number | null>>({});
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [attendance, setAttendance] = useState<Record<string, string>>({});
  const [savedAttendance, setSavedAttendance] = useState<Record<string, string>>({});
  // Expected salary (owner, 2026-11-09): read from the CV, corrected here, saved with the marks.
  const [salary, setSalary] = useState<Record<string, string>>({});
  const [savedSalary, setSavedSalary] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const table = useRef<HTMLTableElement>(null);
  // Cells that failed to save keep what was typed when the page reloads its data after a save.
  const keepTyped = useRef<Record<string, string>>({});

  // What is on record, loaded whenever the candidates in view change (after Save the page reloads them).
  useEffect(() => {
    setMax({ WRITTEN: initialMax('WRITTEN'), INTERVIEW: initialMax('INTERVIEW'), OPTIONAL: initialMax('OPTIONAL') });
    const v: Record<string, string> = {};
    const s: Record<string, number | null> = {};
    const a: Record<string, string> = {};
    const sal: Record<string, string> = {};
    for (const r of rows) {
      for (const c of ['WRITTEN', 'INTERVIEW', 'OPTIONAL'] as Col[]) { const m = markOf(r, c); v[key(r.applicationId, c)] = m ? String(m.marks) : ''; s[key(r.applicationId, c)] = m ? Number(m.marks) : null; }
      a[r.applicationId] = slotStage(r, 'MAIN')?.attendance ?? 'Not Recorded';
      sal[r.applicationId] = r.expectedSalary ?? '';
    }
    const kept = keepTyped.current;
    keepTyped.current = {};
    setVals({ ...v, ...kept }); setSaved(s); setAttendance(a); setSavedAttendance(a); setSalary(sal); setSavedSalary(sal); setBad(new Set(Object.keys(kept)));
  }, [rows]);

  const changedMark = (k: string) => (vals[k] ?? '').trim() !== (saved[k] == null ? '' : String(saved[k]));
  const changedMarks = Object.keys(vals).filter(changedMark);
  const changedAttendance = Object.keys(attendance).filter((id) => attendance[id] !== savedAttendance[id]);
  const changedSalary = Object.keys(salary).filter((id) => salary[id].trim() !== savedSalary[id]);
  const dirty = changedMarks.length + changedAttendance.length + changedSalary.length;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);
  // Leaving the page with changes not saved asks first.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const nameOf = (id: string) => { const r = rows.find((x) => x.applicationId === id); return r?.name ?? r?.applicationNo ?? id; };
  const save = async () => {
    const errors: string[] = [];
    const wrong = new Set<string>();
    setBusy(true);
    let done = 0;
    const okMarks: Record<string, number> = {};
    const okAttendance: Record<string, string> = {};
    for (const id of changedAttendance) {
      try { await api(`/applications/${id}/stages/INTERVIEW`, { method: 'PUT', body: { attendance: attendance[id] } }); okAttendance[id] = attendance[id]; done++; }
      catch (e: any) { errors.push(`${nameOf(id)}: ${e?.message ?? 'attendance not saved'}`); }
    }
    const okSalary: Record<string, string> = {};
    for (const id of changedSalary) {
      const value = salary[id].trim();
      try { await api(`/applications/${id}`, { method: 'PATCH', body: { expectedSalary: value || null } }); okSalary[id] = value; done++; }
      catch (e: any) { errors.push(`${nameOf(id)}: ${e?.message ?? 'expected salary not saved'}`); }
    }
    for (const k of changedMarks) {
      const [id, c] = k.split(':') as [string, Col];
      const raw = vals[k].trim();
      const n = Number(raw);
      const out = Number(max[c]) || null;
      if (raw === '') { wrong.add(k); errors.push(`${nameOf(id)}: a ${COL_LABEL[c].toLowerCase()} mark cannot be emptied; type the corrected number.`); continue; }
      if (Number.isNaN(n) || n < 0) { wrong.add(k); errors.push(`${nameOf(id)}: "${raw}" is not a valid mark.`); continue; }
      if (out !== null && n > out) { wrong.add(k); errors.push(`${nameOf(id)}: ${n} is more than ${out}.`); continue; }
      try { await api(`/applications/${id}/marks`, { method: 'PUT', body: { stageType: c, component: 'Total', marks: n, maxMarks: out } }); okMarks[k] = n; done++; }
      catch (e: any) { wrong.add(k); errors.push(`${nameOf(id)}: ${e?.message ?? 'not saved'}`); }
    }
    setBusy(false);
    setBad(wrong);
    // What saved is now the value on record; cells that failed keep what was typed so it can be corrected.
    setSaved((x) => ({ ...x, ...okMarks }));
    setSavedAttendance((x) => ({ ...x, ...okAttendance }));
    setSavedSalary((x) => ({ ...x, ...okSalary }));
    onError(errors.length ? `Not saved: ${errors.join(' · ')}` : null);
    if (done) {
      onMessage(`${done} change${done === 1 ? '' : 's'} saved.`);
      keepTyped.current = Object.fromEntries([...wrong].map((k) => [k, vals[k]]));
      onSaved(); // reload so the step counts and the other steps see the new marks
    }
  };
  const discard = () => {
    setVals(Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, v == null ? '' : String(v)])));
    setAttendance(savedAttendance); setSalary(savedSalary); setBad(new Set()); onError(null);
  };

  /** Enter / arrow keys move to the same column in the next or previous row. */
  const move = (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    const step = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = table.current?.querySelector<HTMLInputElement>(`input[data-cell="${rowIdx + step}-${colIdx}"]`);
    if (next) { next.focus(); next.select(); } else (e.target as HTMLInputElement).blur();
  };

  const total = (r: any) => {
    const nums = cols.map((c) => { const v = (vals[key(r.applicationId, c)] ?? '').trim(); return v === '' || Number.isNaN(Number(v)) ? null : Number(v); }).filter((x): x is number => x != null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  };
  const outOf = cols.reduce((a, c) => a + (Number(max[c]) || 0), 0);
  const allTicked = rows.length > 0 && rows.every((r) => selected.has(r.applicationId));

  return (
    <div>
      {(canMarks || canAttendance || canSalary) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <Button size="sm" busy={busy} disabled={!dirty} onClick={save}>Save changes{dirty ? ` (${dirty})` : ''}</Button>
          <Button size="sm" variant="ghost" disabled={!dirty || busy} onClick={discard}>Discard</Button>
          <span className="text-xs text-muted">{dirty ? 'Changed cells are highlighted until you save.' : 'Type marks (Enter moves down), then Save changes.'}</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table ref={table} className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="border border-line px-2 py-2"><input type="checkbox" className="accent-brand-600" aria-label="Select all" checked={allTicked} disabled={!rows.length} onChange={onToggleAll} /></th>
              <th className="border border-line px-2 py-2">#</th>
              <th className="border border-line px-2 py-2">Candidate</th>
              {showVacancy && <th className="border border-line px-2 py-2">Vacancy</th>}
              <th className="border border-line px-2 py-2">Interview</th>
              <th className="border border-line px-2 py-2">Attendance</th>
              {cols.map((c) => (
                <th key={c} className="border border-line px-2 py-1.5">
                  <div>{COL_LABEL[c]}</div>
                  <label className="mt-0.5 flex items-center gap-1 font-normal normal-case tracking-normal">out of
                    <input type="number" min={1} className="w-14 rounded border border-line bg-white px-1 py-0.5 text-xs text-ink" value={max[c]} disabled={!canMarks}
                      onChange={(e) => setMax({ ...max, [c]: e.target.value })} aria-label={`${COL_LABEL[c]} out of`} /></label>
                </th>
              ))}
              <th className="border border-line px-2 py-2">Total{outOf ? <span className="font-normal normal-case"> / {outOf}</span> : null}</th>
              <th className="border border-line px-2 py-2">Expected salary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const slot = slotStage(r, 'MAIN');
              const att = attendance[r.applicationId] ?? 'Not Recorded';
              return (
                <tr key={r.applicationId} className={cx(selected.has(r.applicationId) ? 'bg-brand-50/50' : att === 'Absent' && 'bg-slate-50 text-muted')}>
                  <td className="border border-line px-2 py-1"><input type="checkbox" className="accent-brand-600" aria-label={`Select ${r.name ?? r.applicationNo}`} checked={selected.has(r.applicationId)} onChange={() => onToggle(r.applicationId)} /></td>
                  <td className="border border-line px-2 py-1 text-xs text-muted tabular-nums">{i + 1}</td>
                  <td className="border border-line px-2 py-1"><Link className="font-medium text-brand-700 hover:underline" href={`/applications/${r.applicationId}`}>{r.name ?? r.applicationNo}</Link>
                    <div className="text-[11px] text-muted">{r.applicationNo}</div></td>
                  {showVacancy && <td className="border border-line px-2 py-1 text-xs">{r.vacancy.positionTitle}<div className="text-muted">{r.vacancy.vacancyNo}</div></td>}
                  <td className="whitespace-nowrap border border-line px-2 py-1 text-xs">{slot?.scheduledAt ? `${shortDate(slot.scheduledAt)} · ${time(slot.scheduledAt)}` : <span className="text-amber-700">Not scheduled</span>}</td>
                  <td className={cx('border border-line p-0.5', att !== savedAttendance[r.applicationId] && 'bg-amber-50')}>
                    <Select className="min-w-[8.5rem] text-xs" value={att} disabled={!canAttendance || !slot?.scheduledAt}
                      title={!slot?.scheduledAt ? 'Schedule the interview first (step 1)' : undefined} aria-label={`Attendance of ${r.name ?? r.applicationNo}`}
                      onChange={(e) => setAttendance((x) => ({ ...x, [r.applicationId]: e.target.value }))} options={ATTENDANCE.map((x) => ({ value: x, label: x }))} />
                  </td>
                  {cols.map((c, j) => {
                    const k = key(r.applicationId, c);
                    return (
                      <td key={c} className="border border-line p-0">
                        <input type="number" min={0} inputMode="decimal" data-cell={`${i}-${j}`} disabled={!canMarks} value={vals[k] ?? ''} aria-label={`${COL_LABEL[c]} marks of ${r.name ?? r.applicationNo}`}
                          className={cx('block w-24 bg-white px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-50 disabled:text-muted',
                            changedMark(k) && 'bg-amber-50', bad.has(k) && 'bg-red-50 ring-1 ring-inset ring-red-400')}
                          onChange={(e) => { setVals((x) => ({ ...x, [k]: e.target.value })); setBad((b) => { if (!b.has(k)) return b; const n = new Set(b); n.delete(k); return n; }); }}
                          onKeyDown={(e) => move(e, i, j)} onFocus={(e) => e.target.select()} />
                      </td>
                    );
                  })}
                  <td className="border border-line px-2 py-1 text-right font-medium tabular-nums">{total(r) ?? <span className="text-muted">—</span>}</td>
                  <td className="border border-line p-0">
                    <input type="text" maxLength={60} disabled={!canSalary} value={salary[r.applicationId] ?? ''} placeholder="—" aria-label={`Expected salary of ${r.name ?? r.applicationNo}`}
                      className={cx('block w-40 bg-white px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-50 disabled:text-muted',
                        (salary[r.applicationId] ?? '').trim() !== (savedSalary[r.applicationId] ?? '') && 'bg-amber-50')}
                      onChange={(e) => setSalary((x) => ({ ...x, [r.applicationId]: e.target.value }))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="p-4 text-sm text-muted">No candidates here.</p>}
      {!canMarks && <div className="px-3 py-2"><Badge tone="slate">View only: you cannot enter marks</Badge></div>}
    </div>
  );
}
