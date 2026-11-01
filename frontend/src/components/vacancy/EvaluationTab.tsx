'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, download, fmtDateTime } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { EmailComposer } from '../EmailComposer';
import { Alert, Badge, Button, Card, Field, Input, Loaded, Modal, Select, Table, Td, useAction, useLoad } from '../ui';

const STAGES = [['WRITTEN', 'Written exam'], ['INTERVIEW', 'Interview'], ['VIVA', 'Viva']] as const;
const DECISIONS = ['Pending', 'Selected', 'Not Selected', 'On Hold'];

function MarkCell({ row, stage, onSaved, disabled }: { row: any; stage: string; onSaved: () => void; disabled: boolean }) {
  const mark = row.marks.find((m: any) => m.stageType === stage && m.component === 'Total');
  const [v, setV] = useState<string>(mark?.marks?.toString() ?? '');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (v === (mark?.marks?.toString() ?? '')) return;
    if (v === '') return;
    try {
      await api(`/applications/${row.applicationId}/marks`, { method: 'PUT', body: { stageType: stage, marks: Number(v), maxMarks: mark?.maxMarks ?? 100 } });
      setErr(null);
      onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <div>
      <Input type="number" min={0} className="w-20" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={save} aria-label={`${stage} marks`} />
      {mark && <div className="mt-0.5 text-[10px] text-muted" title={fmtDateTime(mark.updatedAt)}>/{mark.maxMarks ?? '—'} · {mark.evaluator.name}</div>}
      {err && <div className="mt-0.5 max-w-[8rem] text-[10px] text-red-700">{err}</div>}
    </div>
  );
}

function ImportModal({ vacancyId, open, onClose, onDone }: { vacancyId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const [stage, setStage] = useState('WRITTEN');
  const [maxMarks, setMaxMarks] = useState('100');
  const [batch, setBatch] = useState<any | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const act = useAction();
  const preview = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await act.run(() => api(`/vacancies/${vacancyId}/marks-import?stageType=${stage}&maxMarks=${maxMarks}`, { form: fd }));
    if (r) { setBatch(r); setOverwrite(false); }
  };
  const confirm = async () => {
    const r = await act.run(() => api(`/imports/${batch.id}/confirm`, { body: { allowOverwrite: overwrite } }), (x: any) => (x.duplicate ? 'Already imported.' : `${x.saved} row(s) saved.`));
    if (r) { setBatch({ ...batch, status: 'Confirmed' }); onDone(); }
  };
  const close = () => { setBatch(null); onClose(); };
  return (
    <Modal open={open} wide title="Import exam marks from Excel" onClose={close}
      footer={<>
        <Button variant="secondary" onClick={close}>{batch?.status === 'Confirmed' ? 'Close' : 'Cancel'}</Button>
        {batch && batch.status === 'Previewed' && <Button busy={act.busy} disabled={!batch.rowsAccepted || (batch.rowsOverwrite > 0 && !overwrite)} onClick={confirm}>Save {batch.rowsAccepted} valid row(s)</Button>}
      </>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Stage"><Select value={stage} onChange={(e) => { setStage(e.target.value); setBatch(null); }} options={STAGES.map(([v, l]) => ({ value: v, label: l }))} /></Field>
          <Field label="Maximum marks"><Input type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} /></Field>
          <Field label="Template"><Button variant="secondary" onClick={() => act.run(() => download(`/vacancies/${vacancyId}/marks-template?stageType=${stage}`))}>Download template</Button></Field>
        </div>
        <Field label="Excel file (.xlsx)" hint="Rows are matched by Application ID (or Candidate ID within this vacancy). Name-only or row-order matching is not used.">
          <input type="file" accept=".xlsx" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) preview(f); e.target.value = ''; }} />
        </Field>
        <Alert>{act.error}</Alert>
        <Alert tone="success">{act.message}</Alert>
        {batch && (
          <>
            <div className="text-sm">Batch <b>{batch.batchNo}</b> · sheet “{batch.sheetName}” · columns: {batch.detectedColumns.join(', ')}</div>
            <div className="flex flex-wrap gap-3 text-sm"><span>Rows: <b>{batch.rowsTotal}</b></span><span className="text-emerald-700">Valid: <b>{batch.rowsAccepted}</b></span><span className="text-red-700">Errors: <b>{batch.rowsRejected}</b></span>{batch.rowsOverwrite > 0 && <span className="text-amber-700">Overwrites: <b>{batch.rowsOverwrite}</b></span>}</div>
            <Table head={['Row', 'Application ID', 'Candidate ID', 'Name', 'Marks', 'Previous', 'Status', 'Errors']}>
              {batch.rows.map((r: any) => (
                <tr key={r.id} className={r.status === 'Error' ? 'bg-red-50/50' : r.status === 'Overwrite' ? 'bg-amber-50/50' : ''}>
                  <Td>{r.rowNumber}</Td><Td>{r.applicationNo ?? '—'}</Td><Td>{r.candidateNo ?? '—'}</Td><Td>{r.candidateName ?? '—'}</Td>
                  <Td>{r.marks ?? '—'}</Td><Td>{r.previousMarks ?? '—'}</Td><Td><Badge tone={r.status === 'Error' ? 'red' : r.status === 'Overwrite' ? 'amber' : 'green'}>{r.status}</Badge></Td>
                  <Td className="text-xs text-red-700">{r.errors.join(' ')}</Td>
                </tr>
              ))}
            </Table>
            {batch.rowsOverwrite > 0 && batch.status === 'Previewed' && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} disabled={!can(P.MARKS_OVERWRITE)} onChange={(e) => setOverwrite(e.target.checked)} className="accent-brand-600" />
                Replace {batch.rowsOverwrite} existing mark(s) {!can(P.MARKS_OVERWRITE) && <span className="text-red-700">(requires overwrite permission)</span>}</label>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export function EvaluationTab({ vacancy }: { vacancy: any }) {
  const { can } = useAuth();
  const state = useLoad(() => api(`/vacancies/${vacancy.id}/evaluation`), [vacancy.id]);
  const [importOpen, setImportOpen] = useState(false);
  const [schedule, setSchedule] = useState<any | null>(null);
  const [resultFor, setResultFor] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const act = useAction();

  const setStage = (id: string, stage: string, body: any) => act.run(() => api(`/applications/${id}/stages/${stage.toLowerCase()}`, { method: 'PUT', body })).then(state.reload);
  const decide = (id: string, decision: string) => act.run(() => api(`/applications/${id}/final-decision`, { body: { decision } }), `Final decision recorded: ${decision}.`).then(state.reload);
  const doSchedule = async () => {
    const r = await act.run(() => api(`/vacancies/${vacancy.id}/schedule`, { body: { applicationIds: [...selected], stageType: schedule.stageType, scheduledAt: new Date(schedule.when).toISOString(), location: schedule.location } }), 'Schedule saved.');
    if (r) { setSchedule(null); state.reload(); }
  };

  return (
    <div className="space-y-4">
      <Alert>{act.error}</Alert>
      <Alert tone="success">{act.message}</Alert>
      <Card pad={false} title="Interview, written exam & viva" actions={<>
        {selected.size > 0 && can(P.SHORTLIST) && <Button size="sm" variant="secondary" onClick={() => setSchedule({ stageType: 'INTERVIEW', when: '', location: '' })}>Schedule {selected.size}</Button>}
        {selected.size > 0 && can(P.EMAIL_SEND) && <Button size="sm" variant="secondary" onClick={() => setResultFor([...selected])}>Send result email</Button>}
        {can(P.MARKS_IMPORT) && <Button size="sm" onClick={() => setImportOpen(true)}>Import marks (Excel)</Button>}
      </>}>
        <Loaded state={state} empty={(d: any) => !d.rows.length && 'No shortlisted candidates yet. Shortlist from the Candidates tab.'}>
          {(d: any) => (
            <Table head={['', 'Candidate', ...STAGES.map(([, l]) => l), 'Final decision', 'Joining']}>
              {d.rows.map((r: any) => (
                <tr key={r.applicationId} className="align-top">
                  <Td><input type="checkbox" className="accent-brand-600" checked={selected.has(r.applicationId)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(r.applicationId) ? n.delete(r.applicationId) : n.add(r.applicationId); return n; })} /></Td>
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`/applications/${r.applicationId}`}>{r.name ?? r.applicationNo}</Link>
                    <div className="text-xs text-muted">{r.applicationNo} · {r.candidateNo}</div>
                    <div className="mt-1 flex gap-1"><Badge>{r.screeningResult ?? 'Not screened'}</Badge></div></Td>
                  {STAGES.map(([st]) => {
                    const s = r.stages[st];
                    return (
                      <Td key={st}>
                        <div className="space-y-1">
                          {s?.scheduledAt && <div className="text-[11px] text-muted">{fmtDateTime(s.scheduledAt)}{s.location ? ` · ${s.location}` : ''}</div>}
                          <Select className="w-32 text-xs" value={s?.attendance ?? 'Not Recorded'} disabled={!can(P.ATTENDANCE)} onChange={(e) => setStage(r.applicationId, st, { attendance: e.target.value })}
                            options={['Not Recorded', 'Present', 'Absent'].map((x) => ({ value: x, label: x }))} aria-label={`${st} attendance`} />
                          <MarkCell row={r} stage={st} disabled={!can(P.MARKS_ENTER)} onSaved={state.reload} />
                          <Select className="w-32 text-xs" value={s?.result ?? 'Pending'} disabled={!can(P.MARKS_ENTER)} onChange={(e) => setStage(r.applicationId, st, { result: e.target.value })}
                            options={DECISIONS.map((x) => ({ value: x, label: `Stage: ${x}` }))} aria-label={`${st} result`} />
                        </div>
                      </Td>
                    );
                  })}
                  <Td>
                    <Select className="w-36" value={r.finalDecision} disabled={!can(P.FINAL_DECISION) || r.joining?.status === 'Approved'} onChange={(e) => decide(r.applicationId, e.target.value)}
                      options={DECISIONS.map((x) => ({ value: x, label: x }))} aria-label="Final decision" />
                  </Td>
                  <Td>{r.joining ? <><Badge>{r.joining.status}</Badge><div className="mt-1 text-[11px] text-muted">Letter: {r.joining.letterStatus}</div></> : '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Loaded>
      </Card>
      <p className="text-xs text-muted">Marks are stored per stage with evaluator and time. No weighted total is calculated: mark maxima and weighting are configurable decisions awaiting business confirmation (SRS 13.5). Missing attendance is shown as “Not Recorded”, never as Present.</p>

      <ImportModal vacancyId={vacancy.id} open={importOpen} onClose={() => setImportOpen(false)} onDone={state.reload} />
      <Modal open={!!schedule} title={`Schedule ${selected.size} candidate(s)`} onClose={() => setSchedule(null)}
        footer={<><Button variant="secondary" onClick={() => setSchedule(null)}>Cancel</Button><Button busy={act.busy} disabled={!schedule?.when} onClick={doSchedule}>Save schedule</Button></>}>
        {schedule && (
          <div className="grid gap-3">
            <Field label="Stage"><Select value={schedule.stageType} onChange={(e) => setSchedule({ ...schedule, stageType: e.target.value })} options={STAGES.map(([v, l]) => ({ value: v, label: l }))} /></Field>
            <Field label="Date & time" required><Input type="datetime-local" value={schedule.when} onChange={(e) => setSchedule({ ...schedule, when: e.target.value })} /></Field>
            <Field label="Location"><Input value={schedule.location} onChange={(e) => setSchedule({ ...schedule, location: e.target.value })} placeholder="e.g. Ananta Head Office, Uttara" /></Field>
          </div>
        )}
      </Modal>
      {resultFor && <EmailComposer open kind="RESULT" applicationIds={resultFor} onClose={() => setResultFor(null)} />}
    </div>
  );
}

