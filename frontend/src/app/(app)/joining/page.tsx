'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmailComposer } from '@/components/EmailComposer';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, Loaded, Modal, PageHeader, Select, Table, Tabs, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, fmtDate, fmtDateTime } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

/** Today in the browser's time zone, as YYYY-MM-DD for date inputs. */
const todayKey = () => new Date().toLocaleDateString('en-CA');
const seatsFull = (j: any) => j.headcount != null && j.joinedCount >= j.headcount;

/** "Joined 1 of 2" for the row's vacancy, red once every seat is taken. */
function Seats({ j }: { j: any }) {
  if (j.headcount == null) return null;
  return <div className="mt-1"><Badge tone={seatsFull(j) ? 'red' : 'slate'}>Joined {j.joinedCount} of {j.headcount}</Badge></div>;
}

/** Agreed salary, typed in and kept with Save (owner, 2026-11-09); Enter saves too, Esc puts the saved value back. */
function SalaryCell({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (v: string) => Promise<unknown> }) {
  const [v, setV] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const changed = v.trim() !== (value ?? '');
  const save = async () => { setBusy(true); await onSave(v.trim()); setBusy(false); };
  return (
    <div className="flex min-w-[13rem] items-center gap-1.5">
      <Input className={changed ? 'border-amber-400 bg-amber-50' : ''} value={v} disabled={disabled} placeholder="e.g. 45,000 / month" maxLength={100} aria-label="Salary"
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && changed) save(); if (e.key === 'Escape') setV(value ?? ''); }} />
      {!disabled && <Button size="sm" disabled={!changed} busy={busy} onClick={save}>Save</Button>}
    </div>
  );
}

/** Search and vacancy filter, applied to the loaded list; `withDate` adds the planned joining date filter (owner, 2026-11-08). */
function useFilter(rows: any[] | null, withDate = false) {
  const [q, setQ] = useState('');
  const [vacancyId, setVacancyId] = useState('');
  const [plannedOn, setPlannedOn] = useState('');
  const vacancies = [...new Map((rows ?? []).map((j) => [j.vacancyId, `${j.vacancyNo} · ${j.position} · ${j.department}`])).entries()];
  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((j) => (!vacancyId || j.vacancyId === vacancyId) && (!plannedOn || j.joiningDate === plannedOn)
    && (!needle || [j.name, j.candidateNo, j.applicationNo, j.position, j.vacancyNo, j.department, j.phone, j.email].some((x) => x?.toLowerCase().includes(needle))));
  const bar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
      <Input className="max-w-xs" placeholder="Search name, ID, phone, position…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      {vacancies.length > 1 && <Select className="max-w-sm" value={vacancyId} placeholder="All vacancies" onChange={(e) => setVacancyId(e.target.value)} options={vacancies.map(([value, label]) => ({ value, label }))} aria-label="Vacancy" />}
      {withDate && <label className="flex items-center gap-2 text-sm text-muted">Planned joining date
        <Input type="date" className="w-44" value={plannedOn} onChange={(e) => setPlannedOn(e.target.value)} aria-label="Planned joining date filter" /></label>}
      {plannedOn && <Button size="sm" variant="ghost" onClick={() => setPlannedOn('')}>Any date</Button>}
      {(q || vacancyId || plannedOn) && <span className="text-xs text-muted">{shown.length} of {rows?.length ?? 0} shown</span>}
    </div>
  );
  return { shown, bar, plannedOn };
}

export default function JoiningPendingPage() {
  const { can } = useAuth();
  const state = useLoad(() => api('/joining/pending'));
  const rejected = useLoad(() => api('/joining/rejected'));
  const [tab, setTab] = useState('pending');
  const [approve, setApprove] = useState<any | null>(null);
  const [reject, setReject] = useState<any | null>(null);
  const [reopen, setReopen] = useState<any | null>(null);
  const reload = () => { state.reload(); rejected.reload(); };
  const [letterFor, setLetterFor] = useState<string | null>(null);
  const act = useAction();
  const canApprove = can(P.JOINING_APPROVE);
  const pending = useFilter(state.data, true);
  const rej = useFilter(rejected.data);
  // Join several at once (owner, 2026-11-08): tick rows, or filter by the planned date and tick "select all", then join on one date.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ joiningDate: string; remarks: string } | null>(null);
  const [batchResult, setBatchResult] = useState<{ name: string; error: string }[]>([]);
  const selectable = pending.shown.filter((j) => !seatsFull(j));
  const chosen = selectable.filter((j) => picked.has(j.id));
  const allPicked = selectable.length > 0 && chosen.length === selectable.length;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(selectable.map((j) => j.id)));
  const doBatch = async () => {
    const r: any = await act.run(() => api('/joining/approve-batch', { body: { ids: chosen.map((j) => j.id), joiningDate: batch!.joiningDate, remarks: batch!.remarks || undefined } }),
      (x: any) => `${x.approved} candidate${x.approved === 1 ? '' : 's'} approved as joined on ${fmtDate(batch!.joiningDate)}.${x.failed ? ` ${x.failed} could not be approved (see below).` : ''} They now appear in Joined Candidates.`);
    if (!r) return;
    const name = (id: string) => { const j = state.data.find((x: any) => x.id === id); return j ? `${j.name ?? j.applicationNo} (${j.applicationNo})` : id; };
    setBatchResult(r.results.filter((x: any) => !x.ok).map((x: any) => ({ name: name(x.id), error: Array.isArray(x.error) ? x.error.join(' ') : x.error })));
    setBatch(null); setPicked(new Set()); state.reload();
  };

  // "Back to interview" (owner, 2026-11-09): sent to joining by mistake, the Selected decision is removed and the candidate is back in
  // the Interview page's step 3 (To decide); the pending joining record and its planned date go.
  const [backTo, setBackTo] = useState<any[] | null>(null);
  const canDecide = can(P.FINAL_DECISION);
  const doBack = async () => {
    const failed: string[] = [];
    await act.run(async () => {
      for (const j of backTo!) {
        try { await api(`/applications/${j.applicationId}/final-decision`, { body: { decision: 'Pending' } }); } catch (e: any) { failed.push(`${j.name ?? j.applicationNo}: ${e?.message}`); }
      }
    });
    act.setMessage(`${backTo!.length - failed.length} candidate${backTo!.length - failed.length === 1 ? '' : 's'} moved back to the Interview page (Select for joining, To decide).`);
    if (failed.length) act.setError(`Not moved: ${failed.join(' · ')}`);
    setBackTo(null); setPicked(new Set()); reload();
  };

  const update = (j: any, body: any, what: string) => act.run(() => api(`/joining/${j.id}`, { method: 'PUT', body }), `${what} saved for ${j.name ?? j.applicationNo}.`).then(state.reload);
  const doApprove = async () => {
    const r = await act.run(() => api(`/joining/${approve.id}/approve`, { body: { joiningDate: approve.joiningDate, remarks: approve.remarks || undefined } }), `${approve.name ?? approve.applicationNo} approved as joined. They now appear in Joined Candidates.`);
    if (r) { setApprove(null); state.reload(); }
  };
  const future = approve?.joiningDate && approve.joiningDate > todayKey();

  return (
    <>
      <PageHeader title="Joining pending" subtitle="Final-selected candidates. Sending a joining letter does not mark anyone as joined: when the candidate has actually joined, approve it here. Approved joinings move to Joined Candidates; rejected ones stay under Rejected." />
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'pending', label: <>Pending {state.data && <Badge tone="blue">{state.data.length}</Badge>}</> },
        { key: 'rejected', label: <>Rejected {rejected.data && <Badge tone="red">{rejected.data.length}</Badge>}</> },
      ]} />
      {tab === 'rejected' ? (
        <Card pad={false}>
          <Loaded state={rejected} empty={(d: any[]) => !d.length && 'No rejected candidates.'}>
            {() => (
              <>
                {rej.bar}
                <Table head={['Candidate', 'Position / Vacancy', 'Department · Company', 'Contact', 'Reason', 'Rejected', '']}>
                  {rej.shown.map((j) => (
                    <tr key={j.id}>
                      <Td><Link className="font-medium text-brand-700 hover:underline" href={`/applications/${j.applicationId}`}>{j.name ?? j.applicationNo}</Link><div className="text-xs text-muted">{j.candidateNo} · {j.applicationNo}</div><div className="mt-1"><Badge tone="red">Rejected</Badge></div></Td>
                      <Td>{j.position}<div className="text-xs text-muted">{j.vacancyNo}</div><Seats j={j} /></Td>
                      <Td className="text-xs">{j.department}<div className="text-muted">{j.company}</div></Td>
                      <Td className="text-xs">{j.email}<div className="text-muted">{j.phone}</div></Td>
                      <Td className="max-w-xs text-xs">{j.remarks}</Td>
                      <Td className="whitespace-nowrap text-xs">{fmtDateTime(j.updatedAt)}</Td>
                      <Td>{canApprove && (j.finalDecision === 'Selected'
                        ? <Button size="sm" variant="secondary" onClick={() => setReopen(j)}>Move back to pending</Button>
                        : <span className="text-xs text-muted">Final decision is now {j.finalDecision}; set it to Selected to reopen.</span>)}</Td>
                    </tr>
                  ))}
                </Table>
              </>
            )}
          </Loaded>
        </Card>
      ) : (
        <Card pad={false}>
          <Loaded state={state} empty={(d: any[]) => !d.length && 'No final-selected candidates are waiting for joining. Candidates appear here when they are sent to joining from the Interview page (step 3).'}>
            {() => (
              <>
                {pending.bar}
                {canApprove && (
                  <div className="flex flex-wrap items-center gap-3 border-b border-line bg-slate-50 px-3 py-2 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={allPicked} disabled={!selectable.length} onChange={toggleAll} />
                      Select all {selectable.length} shown{pending.plannedOn ? ` with planned date ${fmtDate(pending.plannedOn)}` : ''}</label>
                    <Button size="sm" disabled={!chosen.length} onClick={() => setBatch({ joiningDate: pending.plannedOn || todayKey(), remarks: '' })}>Join selected ({chosen.length})</Button>
                    {canDecide && <Button size="sm" variant="secondary" disabled={!chosen.length} onClick={() => setBackTo(chosen)}>Back to interview ({chosen.length})</Button>}
                    {selectable.length < pending.shown.length && <span className="text-xs text-muted">Rows whose vacancy has every seat filled cannot be selected.</span>}
                  </div>
                )}
                {batchResult.length > 0 && <div className="border-b border-line p-3"><Alert>Not approved: {batchResult.map((x) => `${x.name}: ${x.error}`).join(' · ')}</Alert></div>}
                <Table head={[...(canApprove ? [''] : []), 'Candidate', 'Position / Vacancy', 'Department · Company', 'Contact', 'Planned joining date', 'Salary', 'Joining letter', '']}>
                  {pending.shown.map((j) => (
                    <tr key={j.id} className={picked.has(j.id) ? 'bg-brand-50/50' : ''}>
                      {canApprove && <Td><input type="checkbox" className="accent-brand-600" aria-label={`Select ${j.name ?? j.applicationNo}`} checked={picked.has(j.id)} disabled={seatsFull(j)} onChange={() => toggle(j.id)} /></Td>}
                      <Td><Link className="font-medium text-brand-700 hover:underline" href={`/applications/${j.applicationId}`}>{j.name ?? j.applicationNo}</Link><div className="text-xs text-muted">{j.candidateNo} · {j.applicationNo}</div>
                        {j.finalDecisionAt && <div className="text-xs text-muted">Selected {fmtDate(j.finalDecisionAt)}</div>}</Td>
                      <Td>{j.position}<div className="text-xs text-muted">{j.vacancyNo}</div><Seats j={j} /></Td>
                      <Td className="text-xs">{j.department}<div className="text-muted">{j.company}</div></Td>
                      <Td className="text-xs">{j.email}<div className="text-muted">{j.phone}</div></Td>
                      <Td><Input type="date" className="w-40" key={j.joiningDate ?? ''} defaultValue={j.joiningDate ?? ''} disabled={!canApprove} aria-label="Planned joining date"
                        onChange={(e) => e.target.value.length === 10 && e.target.value !== j.joiningDate && update(j, { joiningDate: e.target.value }, 'Planned joining date')}
                        onBlur={(e) => !e.target.value && j.joiningDate && update(j, { joiningDate: null }, 'Planned joining date')} /></Td>
                      <Td><SalaryCell key={`${j.id}-${j.salary ?? ''}`} value={j.salary} disabled={!canApprove} onSave={(salary) => update(j, { salary }, 'Salary')} /></Td>
                      <Td>
                        <Select className="w-36 text-xs" value={j.letterStatus} disabled={!canApprove} aria-label="Joining letter" onChange={(e) => update(j, { letterStatus: e.target.value }, 'Joining letter status')} options={['Not Prepared', 'Prepared', 'Sent'].map((x) => ({ value: x, label: x }))} />
                        {can(P.EMAIL_SEND) && (j.joiningDate
                          ? <Button size="sm" variant="ghost" className="mt-1" onClick={() => setLetterFor(j.applicationId)}>Email joining letter</Button>
                          : <div className="mt-1 text-[11px] text-muted">Set the planned date to email the letter.</div>)}
                      </Td>
                      <Td>{canApprove && (
                        <div className="flex flex-col gap-1 whitespace-nowrap">
                          <Button size="sm" disabled={seatsFull(j)} title={seatsFull(j) ? 'Every seat of this vacancy is filled' : undefined} onClick={() => setApprove({ ...j, joiningDate: j.joiningDate ?? todayKey(), remarks: '' })}>Approve joining</Button>
                          <Button size="sm" variant="danger" onClick={() => setReject(j)}>Reject</Button>
                          {canDecide && <Button size="sm" variant="ghost" title="Sent to joining by mistake: back to the Interview page" onClick={() => setBackTo([j])}>Back to interview</Button>}
                          {seatsFull(j) && <span className="max-w-[9rem] whitespace-normal text-[11px] text-red-700">All {j.headcount} seat{j.headcount === 1 ? '' : 's'} filled. Reject, or raise a new requisition for more.</span>}
                        </div>
                      )}</Td>
                    </tr>
                  ))}
                </Table>
              </>
            )}
          </Loaded>
        </Card>
      )}

      <Modal open={!!approve} title="Approve actual joining" onClose={() => setApprove(null)}
        footer={<><Button variant="secondary" onClick={() => setApprove(null)}>Cancel</Button><Button busy={act.busy} disabled={!approve?.joiningDate || (approve && seatsFull(approve))} onClick={doApprove}>Approve joining</Button></>}>
        {approve && (
          <div className="space-y-3">
            <p className="text-sm">Confirm that <b>{approve.name ?? approve.applicationNo}</b> ({approve.applicationNo}) has actually joined as <b>{approve.position}</b> ({approve.vacancyNo}). This cannot be undone here.</p>
            {seatsFull(approve) && <Alert>All {approve.headcount} seat{approve.headcount === 1 ? '' : 's'} of {approve.vacancyNo} are already filled ({approve.joinedCount} joined), so no more joinings can be approved.</Alert>}
            <Field label="Actual joining date" required hint={approve.joiningDate === state.data?.find((x: any) => x.id === approve.id)?.joiningDate ? 'The planned date; change it if the candidate joined on another day.' : undefined}>
              <Input type="date" value={approve.joiningDate} onChange={(e) => setApprove({ ...approve, joiningDate: e.target.value })} />
            </Field>
            {future && <Alert tone="warning">This date is in the future. Approve only once the candidate has actually joined.</Alert>}
            <Field label="Remarks"><Textarea value={approve.remarks} onChange={(e) => setApprove({ ...approve, remarks: e.target.value })} /></Field>
            <Alert>{act.error}</Alert>
          </div>
        )}
      </Modal>
      <Modal open={!!batch} title={`Approve joining for ${chosen.length} candidate${chosen.length === 1 ? '' : 's'}`} onClose={() => setBatch(null)}
        footer={<><Button variant="secondary" onClick={() => setBatch(null)}>Cancel</Button><Button busy={act.busy} disabled={!batch?.joiningDate || !chosen.length} onClick={doBatch}>Approve joining ({chosen.length})</Button></>}>
        {batch && (
          <div className="space-y-3">
            <p className="text-sm">Confirm that these candidates have actually joined. This cannot be undone here.</p>
            <ul className="max-h-48 list-disc overflow-auto pl-5 text-sm">
              {chosen.map((j) => <li key={j.id}><b>{j.name ?? j.applicationNo}</b> ({j.applicationNo}) as {j.position}, {j.vacancyNo}{j.joiningDate && j.joiningDate !== batch.joiningDate ? <span className="text-xs text-amber-700"> · planned {fmtDate(j.joiningDate)}</span> : null}</li>)}
            </ul>
            <Field label="Actual joining date (for all of them)" required><Input type="date" value={batch.joiningDate} onChange={(e) => setBatch({ ...batch, joiningDate: e.target.value })} /></Field>
            {batch.joiningDate > todayKey() && <Alert tone="warning">This date is in the future. Approve only once the candidates have actually joined.</Alert>}
            <Field label="Remarks"><Textarea value={batch.remarks} onChange={(e) => setBatch({ ...batch, remarks: e.target.value })} /></Field>
            <p className="text-xs text-muted">Each candidate is checked on its own: one whose vacancy has no seat left is not approved and the others still are.</p>
            <Alert>{act.error}</Alert>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!backTo} title={`Move ${backTo?.length ?? 0} candidate${backTo?.length === 1 ? '' : 's'} back to the interview?`} confirmLabel="Back to interview" busy={act.busy} error={act.error}
        message={<div className="space-y-2">
          <p>{backTo?.map((j) => j.name ?? j.applicationNo).join(', ')}</p>
          <p>The Selected decision is removed and they leave Joining Pending, with their planned joining date and letter status. They are back on the Interview page under Select for joining (To decide).</p>
        </div>}
        onConfirm={doBack} onClose={() => setBackTo(null)} />
      <ConfirmDialog open={!!reject} title={`Reject ${reject?.name ?? 'candidate'} at joining`} danger confirmLabel="Reject" requireReason reasonLabel="Reason (for example: declined the offer, did not report)" busy={act.busy} error={act.error}
        message="The candidate moves to the Rejected tab and shows as Rejected in the CV Bank. The final decision (Selected) is kept for the record; you can move a rejection back to pending if it was a mistake."
        onConfirm={(r) => act.run(() => api(`/joining/${reject.id}/reject`, { body: { remarks: r } }), 'Rejected. The candidate is listed under Rejected.').then((x) => { if (x) { setReject(null); reload(); } })} onClose={() => setReject(null)} />
      <ConfirmDialog open={!!reopen} title={`Move ${reopen?.name ?? 'candidate'} back to Joining Pending`} confirmLabel="Move back" requireReason reasonLabel="Reason" busy={act.busy} error={act.error}
        onConfirm={(r) => act.run(() => api(`/joining/${reopen.id}/reopen`, { body: { remarks: r } }), 'Moved back to Joining Pending.').then((x) => { if (x) { setReopen(null); reload(); } })} onClose={() => setReopen(null)} />
      {letterFor && <EmailComposer open kind="JOINING_LETTER" applicationIds={[letterFor]} onClose={() => setLetterFor(null)} onSent={state.reload} />}
    </>
  );
}
