'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useAction } from '../ui';
import { DECISIONS, KIND_LABEL, KIND_ROUND, Kind, ROUND_LABEL, markOf, slotStage, toLocalInput } from './rounds';

const DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180, 240];
const durationLabel = (m: number) => (m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`);

/**
 * One candidate's slot: for the main day the shared time, duration, venue, panel and attendance, plus Written and
 * Interview board marks and results; for the optional exam the same for that exam alone. Only changed fields are sent.
 */
export function SlotDialog({ row, kind, onClose, onSaved }: { row: any | null; kind: Kind; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const act = useAction();
  const [f, setF] = useState<any>(null);
  const rounds = kind === 'MAIN' ? ['WRITTEN', 'INTERVIEW'] : ['OPTIONAL'];
  const stage = row ? slotStage(row, kind) : null;
  useEffect(() => {
    if (!row) return setF(null);
    const exams = Object.fromEntries(rounds.map((r) => {
      const mk = markOf(row, r);
      return [r, { marks: mk?.marks?.toString() ?? '', maxMarks: mk?.maxMarks?.toString() ?? '100', result: row.stages[r]?.result ?? 'Pending' }];
    }));
    setF({
      when: toLocalInput(stage?.scheduledAt), durationMinutes: stage?.durationMinutes?.toString() ?? (kind === 'MAIN' ? '120' : '60'),
      location: stage?.location ?? '', panel: stage?.panel ?? '', attendance: stage?.attendance ?? 'Not Recorded', exams,
    });
  }, [row, kind]);
  if (!row || !f) return null;
  const canPlan = can(P.SHORTLIST) || can(P.MARKS_ENTER);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const setExam = (r: string, k: string, v: string) => setF({ ...f, exams: { ...f.exams, [r]: { ...f.exams[r], [k]: v } } });

  const save = async () => {
    const slot: Record<string, any> = {};
    // A slot without a date and never scheduled saves no venue, panel or duration: that alone is not a slot.
    if (canPlan && (stage || f.when)) {
      if (toLocalInput(stage?.scheduledAt) !== f.when) slot.scheduledAt = f.when ? new Date(f.when).toISOString() : null;
      if ((stage?.durationMinutes?.toString() ?? '') !== f.durationMinutes) slot.durationMinutes = Number(f.durationMinutes);
      if ((stage?.location ?? '') !== f.location) slot.location = f.location || null;
      if ((stage?.panel ?? '') !== f.panel) slot.panel = f.panel || null;
    }
    if (can(P.ATTENDANCE) && (stage?.attendance ?? 'Not Recorded') !== f.attendance) slot.attendance = f.attendance;
    const r = await act.run(async () => {
      if (Object.keys(slot).length) await api(`/applications/${row.applicationId}/stages/${KIND_ROUND[kind].toLowerCase()}`, { method: 'PUT', body: slot });
      if (!can(P.MARKS_ENTER)) return true;
      for (const round of rounds) {
        const e = f.exams[round];
        const mk = markOf(row, round);
        if ((row.stages[round]?.result ?? 'Pending') !== e.result) await api(`/applications/${row.applicationId}/stages/${round.toLowerCase()}`, { method: 'PUT', body: { result: e.result } });
        if (e.marks !== '' && (e.marks !== (mk?.marks?.toString() ?? '') || e.maxMarks !== (mk?.maxMarks?.toString() ?? '100'))) {
          await api(`/applications/${row.applicationId}/marks`, { method: 'PUT', body: { stageType: round, marks: Number(e.marks), maxMarks: e.maxMarks === '' ? null : Number(e.maxMarks) } });
        }
      }
      return true;
    });
    if (r) { onSaved(); onClose(); }
  };

  return (
    <Modal open wide title={`${KIND_LABEL[kind]} · ${row.name ?? row.applicationNo}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={act.busy} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <div className="text-sm text-muted">{row.vacancy.department} · {row.vacancy.positionTitle} · {row.vacancy.vacancyNo} · {row.applicationNo}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date & time"><Input type="datetime-local" value={f.when} disabled={!canPlan} onChange={(e) => set('when', e.target.value)} /></Field>
          <Field label="Duration"><Select value={f.durationMinutes} disabled={!canPlan} onChange={(e) => set('durationMinutes', e.target.value)} options={DURATIONS.map((m) => ({ value: String(m), label: durationLabel(m) }))} /></Field>
          <Field label="Venue"><Input value={f.location} disabled={!canPlan} placeholder="e.g. Board Room, Head Office, Uttara" onChange={(e) => set('location', e.target.value)} /></Field>
          <Field label="Interview panel" hint="Names, separated by commas."><Input value={f.panel} disabled={!canPlan} placeholder="e.g. Head of ICT, HR Manager" onChange={(e) => set('panel', e.target.value)} /></Field>
          <Field label={kind === 'MAIN' ? 'Attendance (written & interview)' : 'Attendance'}><Select value={f.attendance} disabled={!can(P.ATTENDANCE)} onChange={(e) => set('attendance', e.target.value)} options={['Not Recorded', 'Present', 'Absent'].map((x) => ({ value: x, label: x }))} /></Field>
        </div>
        {!stage?.scheduledAt && !f.when && <p className="text-xs text-muted">Not scheduled yet: pick a date and time to schedule {kind === 'MAIN' ? 'the written exam & interview board' : 'the optional exam'}.</p>}
        {toLocalInput(stage?.scheduledAt) !== f.when && pastWarning(f.when)}
        {rounds.map((round) => {
          const e = f.exams[round];
          const mk = markOf(row, round);
          return (
            <div key={round} className="rounded-md border border-line p-3">
              <div className="mb-2 text-sm font-semibold">{ROUND_LABEL[round]}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Marks"><Input type="number" min={0} value={e.marks} disabled={!can(P.MARKS_ENTER)} onChange={(x) => setExam(round, 'marks', x.target.value)} /></Field>
                <Field label="Out of"><Input type="number" min={1} value={e.maxMarks} disabled={!can(P.MARKS_ENTER)} onChange={(x) => setExam(round, 'maxMarks', x.target.value)} /></Field>
                <Field label="Result"><Select value={e.result} disabled={!can(P.MARKS_ENTER)} onChange={(x) => setExam(round, 'result', x.target.value)} options={DECISIONS.map((x) => ({ value: x, label: x }))} /></Field>
              </div>
              {mk && <p className="mt-1 text-xs text-muted">Last entered by {mk.evaluator.name}.</p>}
            </div>
          );
        })}
        <p className="text-xs text-muted">Missing attendance stays “Not Recorded”, never Present. No weighted total is calculated.</p>
        <Alert>{act.error}</Alert>
      </div>
    </Modal>
  );
}

/**
 * Confirms a final decision before it is recorded: Selected puts the candidate in Joining Pending, and moving away from
 * Selected removes a still-pending joining record (its planned date and letter status), so a stray click must not do either.
 */
export function DecisionDialog({ row, decision, onClose, onSaved }: { row: any | null; decision: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const act = useAction();
  const [f, setF] = useState({ decision, remarks: '' });
  useEffect(() => { if (row) setF({ decision, remarks: row.finalDecisionRemarks ?? '' }); }, [row, decision]);
  if (!row) return null;
  const main = slotStage(row, 'MAIN');
  const leavesJoining = row.finalDecision === 'Selected' && f.decision !== 'Selected' && row.joining?.status === 'Pending';
  const marks = ['WRITTEN', 'INTERVIEW', 'OPTIONAL'].map((r) => [r, markOf(row, r)] as const).filter(([, m]) => m);
  const save = async () => {
    const r = await act.run(() => api(`/applications/${row.applicationId}/final-decision`, { body: { decision: f.decision, remarks: f.remarks.trim() || undefined } }));
    if (r) {
      onSaved(f.decision === 'Selected' ? `${row.name ?? row.applicationNo} selected: now in Joining Pending.` : `Final decision for ${row.name ?? row.applicationNo}: ${f.decision}.`);
      onClose();
    }
  };
  return (
    <Modal open title={`Final decision · ${row.name ?? row.applicationNo}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={act.busy} disabled={f.decision === row.finalDecision && f.remarks.trim() === (row.finalDecisionRemarks ?? '')} onClick={save}>Save decision</Button></>}>
      <div className="space-y-3">
        <div className="text-sm text-muted">{row.vacancy.department} · {row.vacancy.positionTitle} · {row.vacancy.vacancyNo} · {row.applicationNo}</div>
        <div className="rounded-md border border-line bg-slate-50 p-3 text-sm">
          <div>Written & interview day: <b>{main?.scheduledAt ? `${new Date(main.scheduledAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${main.attendance}` : 'not scheduled'}</b></div>
          <div className="mt-1">Marks: {marks.length ? marks.map(([r, m]) => `${ROUND_LABEL[r].replace(' (viva)', '')} ${m.marks}/${m.maxMarks ?? '—'}`).join(' · ') : <span className="text-muted">none entered</span>}</div>
        </div>
        <Field label="Decision"><Select value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })} options={DECISIONS.map((x) => ({ value: x, label: x }))} /></Field>
        <Field label="Remarks" hint="Optional; kept with the decision."><Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        {f.decision === 'Selected' && row.finalDecision !== 'Selected' && <Alert tone="info">The candidate moves to Joining Pending, where HR sets the joining date and approves the actual joining.</Alert>}
        {f.decision === 'Selected' && main?.attendance === 'Absent' && <Alert tone="warning">The candidate is recorded as Absent for the written & interview day.</Alert>}
        {leavesJoining && <Alert tone="warning">The candidate leaves Joining Pending; the planned joining date{row.joining?.joiningDate ? ` (${row.joining.joiningDate})` : ''} and letter status recorded there are removed.</Alert>}
        <Alert>{act.error}</Alert>
      </div>
    </Modal>
  );
}

/** A slot time already past when it is being set: allowed (recording an exam held earlier), but worth a second look. */
export const pastWarning = (local: string) => (local && new Date(local).getTime() < Date.now() ? <Alert tone="warning">This date and time is in the past. Check it, unless you are recording an exam that was already held.</Alert> : null);

/** Schedules or reschedules the main day (written + interview) or the optional exam for several candidates, of any vacancy, at once. */
export function ScheduleDialog({ open, count, applicationIds, onClose, onSaved }: { open: boolean; count: number; applicationIds: string[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const act = useAction();
  const [f, setF] = useState({ kind: 'MAIN' as Kind, when: '', durationMinutes: '120', location: '', panel: '' });
  useEffect(() => { if (open) setF((x) => ({ ...x, when: '' })); }, [open]);
  const save = async () => {
    const r = await act.run(() => api('/interviews/schedule', { body: {
      applicationIds, stageType: KIND_ROUND[f.kind], scheduledAt: new Date(f.when).toISOString(), durationMinutes: Number(f.durationMinutes),
      location: f.location || undefined, panel: f.panel || undefined,
    } }));
    if (r) {
      const failed = r.filter((x: any) => !x.ok);
      onSaved(`${r.length - failed.length} scheduled.${failed.length ? ` Not scheduled: ${failed.map((x: any) => `${x.applicationNo ?? ''} ${x.error}`).join('; ')}` : ''}`);
      onClose();
    }
  };
  return (
    <Modal open={open} title={`Schedule ${count} candidate${count === 1 ? '' : 's'}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={act.busy} disabled={!f.when} onClick={save}>Save schedule</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Exam" className="sm:col-span-2"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind, durationMinutes: e.target.value === 'MAIN' ? '120' : '60' })}
          options={[{ value: 'MAIN', label: 'Written exam & interview board (same day)' }, { value: 'OPTIONAL', label: 'Optional exam' }]} /></Field>
        <Field label="Date & time" required><Input type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></Field>
        <Field label="Duration (each)"><Select value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} options={DURATIONS.map((m) => ({ value: String(m), label: durationLabel(m) }))} /></Field>
        <Field label="Venue" className="sm:col-span-2"><Input value={f.location} placeholder="e.g. Board Room, Head Office" onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Interview panel" className="sm:col-span-2"><Textarea rows={2} value={f.panel} placeholder="e.g. Head of ICT, HR Manager" onChange={(e) => setF({ ...f, panel: e.target.value })} /></Field>
      </div>
      <div className="mt-3">{pastWarning(f.when)}</div>
      <p className="mt-3 text-xs text-muted">Shortlisted candidates sit the written exam and the interview board on the same day, so one slot covers both. All selected candidates get the same time; adjust single slots afterwards.</p>
      <div className="mt-2"><Alert>{act.error}</Alert></div>
    </Modal>
  );
}
