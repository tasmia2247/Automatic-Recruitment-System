'use client';

import { useEffect, useState } from 'react';
import { api, download } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Field, Input, Modal, Select, Table, Td, useAction } from '../ui';
import { ROUND_LABEL } from './rounds';

export type ImportVacancy = { id: string; vacancyNo: string; positionTitle: string; department: string; departmentId: string; status?: string };

/**
 * Excel marks upload: preview first, nothing is saved until confirmed; rows are matched by ID only.
 * `MAIN` (owner, 2026-11-05) is one sheet with Written Marks and Interview Marks, giving one preview per exam, saved together;
 * `OPTIONAL` (or any single exam) has one Marks column. The vacancy is picked here by department and designation.
 */
export function MarksImportModal({ vacancies, vacancyId: initial, stage, open, onClose, onDone }: {
  vacancies: ImportVacancy[]; vacancyId?: string; stage: 'MAIN' | string; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const { can } = useAuth();
  const main = stage === 'MAIN';
  const [pick, setPick] = useState({ departmentId: '', designation: '', vacancyId: '' });
  const [max, setMax] = useState({ written: '100', interview: '100', single: '100' });
  const [batches, setBatches] = useState<any[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const act = useAction();
  useEffect(() => {
    if (!open) return;
    const v = vacancies.find((x) => x.id === initial) ?? (vacancies.length === 1 ? vacancies[0] : undefined);
    setPick({ departmentId: v?.departmentId ?? '', designation: v?.positionTitle ?? '', vacancyId: v?.id ?? '' });
    setBatches([]); setOverwrite(false);
  }, [open, initial]);

  const departments = [...new Map(vacancies.map((v) => [v.departmentId, v.department])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const designations = [...new Set(vacancies.filter((v) => v.departmentId === pick.departmentId).map((v) => v.positionTitle))].sort();
  const choices = vacancies.filter((v) => v.departmentId === pick.departmentId && v.positionTitle === pick.designation);
  // One vacancy for the department and designation is chosen by itself.
  const vacancy = vacancies.find((v) => v.id === pick.vacancyId) ?? (choices.length === 1 ? choices[0] : undefined);
  const title = main ? 'written exam & interview board' : ROUND_LABEL[stage].toLowerCase();

  const preview = async (file: File) => {
    if (!vacancy) return;
    const fd = new FormData();
    fd.append('file', file);
    const r = await act.run(() => (main
      ? api(`/vacancies/${vacancy.id}/marks-import-main?writtenMaxMarks=${max.written}&interviewMaxMarks=${max.interview}`, { form: fd }).then((x: any) => x.batches)
      : api(`/vacancies/${vacancy.id}/marks-import?stageType=${stage}&maxMarks=${max.single}`, { form: fd }).then((x: any) => [x])));
    if (r) { setBatches(r); setOverwrite(false); }
  };
  const open_ = batches.filter((b) => b.status === 'Previewed');
  const accepted = open_.reduce((n, b) => n + b.rowsAccepted, 0);
  const overwrites = open_.reduce((n, b) => n + b.rowsOverwrite, 0);
  const confirm = async () => {
    const r = await act.run(async () => {
      let saved = 0;
      for (const b of open_) saved += (await api(`/imports/${b.id}/confirm`, { body: { allowOverwrite: overwrite } }) as any).saved ?? 0;
      return saved;
    }, (n) => `${n} mark(s) saved.`);
    if (r !== undefined) { setBatches(batches.map((b) => ({ ...b, status: 'Confirmed' }))); onDone(); }
  };
  const close = () => { setBatches([]); onClose(); };
  const done = batches.length > 0 && !open_.length;

  return (
    <Modal open={open} wide title={`Upload marks: ${title}`} onClose={close}
      footer={<>
        <Button variant="secondary" onClick={close}>{done ? 'Close' : 'Cancel'}</Button>
        {open_.length > 0 && <Button busy={act.busy} disabled={!accepted || (overwrites > 0 && !overwrite)} onClick={confirm}>Save {accepted} mark(s)</Button>}
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Department"><Select value={pick.departmentId} placeholder="Choose…" disabled={!!batches.length} onChange={(e) => setPick({ departmentId: e.target.value, designation: '', vacancyId: '' })} options={departments.map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Designation"><Select value={pick.designation} placeholder="Choose…" disabled={!pick.departmentId || !!batches.length} onChange={(e) => setPick({ ...pick, designation: e.target.value, vacancyId: '' })} options={designations.map((d) => ({ value: d, label: d }))} /></Field>
          {choices.length > 1
            ? <Field label="Vacancy"><Select value={pick.vacancyId} placeholder="Choose…" disabled={!!batches.length} onChange={(e) => setPick({ ...pick, vacancyId: e.target.value })} options={choices.map((v) => ({ value: v.id, label: v.status ? `${v.vacancyNo} (${v.status})` : v.vacancyNo }))} /></Field>
            : <Field label="Vacancy"><div className="py-2 text-sm">{vacancy?.vacancyNo ?? <span className="text-muted">—</span>}</div></Field>}
        </div>

        {vacancy && (
          <>
            <div className="rounded-md border border-line bg-slate-50 p-3 text-sm">
              <div className="font-medium">1. Download the template</div>
              <p className="mt-0.5 text-xs text-muted">It lists every shortlisted candidate of {vacancy.vacancyNo} ({vacancy.department} · {vacancy.positionTitle}) with Application ID, Candidate ID and name{main ? ', with a Written Marks and an Interview Marks column' : ''}. Only fill in the marks.</p>
              <Button className="mt-2" variant="secondary" size="sm" onClick={() => act.run(() => download(`/vacancies/${vacancy.id}/marks-template?stageType=${main ? 'MAIN' : stage}`))}>Download template (.xlsx)</Button>
            </div>
            <div className="rounded-md border border-line p-3 text-sm">
              <div className="font-medium">2. Upload the filled file</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                {main ? (
                  <>
                    <Field label="Written exam out of"><Input type="number" min={1} value={max.written} disabled={!!batches.length} onChange={(e) => setMax({ ...max, written: e.target.value })} /></Field>
                    <Field label="Interview board out of"><Input type="number" min={1} value={max.interview} disabled={!!batches.length} onChange={(e) => setMax({ ...max, interview: e.target.value })} /></Field>
                  </>
                ) : <Field label="Out of"><Input type="number" min={1} value={max.single} disabled={!!batches.length} onChange={(e) => setMax({ ...max, single: e.target.value })} /></Field>}
                <Field label="Excel file (.xlsx)" hint={main ? 'A blank cell means that mark is not entered yet.' : undefined}>
                  <input type="file" accept=".xlsx" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) preview(f); e.target.value = ''; }} />
                </Field>
              </div>
              <p className="mt-1 text-xs text-muted">Rows are matched by Application ID (or Candidate ID within this vacancy), never by name or row order. Nothing is saved until you check the preview and press Save.</p>
            </div>
          </>
        )}
        {!vacancies.length && <Alert tone="info">No shortlisted candidates yet, so there is nothing to upload marks for.</Alert>}
        <Alert>{act.error}</Alert>
        <Alert tone="success">{act.message}</Alert>

        {batches.map((b) => (
          <div key={b.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-3 text-sm">
              <b>{ROUND_LABEL[b.stageType]}</b><span className="text-muted">batch {b.batchNo}{b.maxMarks != null ? ` · out of ${b.maxMarks}` : ''}</span>
              <span className="text-emerald-700">Valid: <b>{b.rowsAccepted}</b></span><span className="text-red-700">Errors: <b>{b.rowsRejected}</b></span>
              {b.rowsOverwrite > 0 && <span className="text-amber-700">Replace existing: <b>{b.rowsOverwrite}</b></span>}
              {b.status === 'Confirmed' && <Badge tone="green">Saved</Badge>}
            </div>
            <Table head={['Row', 'Application ID', 'Candidate ID', 'Name', 'Marks', 'Previous', 'Status', 'Errors']}>
              {b.rows.map((r: any) => (
                <tr key={r.id} className={r.status === 'Error' ? 'bg-red-50/50' : r.status === 'Overwrite' ? 'bg-amber-50/50' : ''}>
                  <Td>{r.rowNumber}</Td><Td>{r.applicationNo ?? '—'}</Td><Td>{r.candidateNo ?? '—'}</Td><Td>{r.candidateName ?? '—'}</Td>
                  <Td>{r.marks ?? '—'}</Td><Td>{r.previousMarks ?? '—'}</Td><Td><Badge tone={r.status === 'Error' ? 'red' : r.status === 'Overwrite' ? 'amber' : 'green'}>{r.status === 'Overwrite' ? 'Replace' : r.status}</Badge></Td>
                  <Td className="text-xs text-red-700">{r.errors.join(' ')}</Td>
                </tr>
              ))}
            </Table>
          </div>
        ))}
        {overwrites > 0 && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} disabled={!can(P.MARKS_OVERWRITE)} onChange={(e) => setOverwrite(e.target.checked)} className="accent-brand-600" />
            Replace {overwrites} existing mark(s) {!can(P.MARKS_OVERWRITE) && <span className="text-red-700">(requires overwrite permission)</span>}</label>
        )}
      </div>
    </Modal>
  );
}
