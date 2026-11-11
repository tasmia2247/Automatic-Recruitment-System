'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { EmailComposer } from '@/components/EmailComposer';
import { MarksGrid } from '@/components/interviews/MarksGrid';
import { MarksImportModal } from '@/components/interviews/MarksImportModal';
import { dayKey, markOf, nextStep, shortDate, slotStage, time } from '@/components/interviews/rounds';
import { SendToJoiningDialog } from '@/components/interviews/SendToJoiningDialog';
import { ScheduleDialog, SlotDialog } from '@/components/interviews/SlotDialogs';
import { Alert, Badge, Button, Card, ConfirmDialog, Input, Loaded, PageHeader, Select, Table, Td, cx, useAction, useLoad } from '@/components/ui';
import { api, download, fmtDate } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

type Step = 'schedule' | 'marks' | 'joining';
type JoinView = 'decide' | 'joining' | 'waiting' | 'not' | 'all';

/** Nothing left to do: joined, rejected at joining, or already decided out (Not Selected). A filled or closed vacancy
 * does not by itself finish a shortlisted candidate: they may still be interviewed as backups, decided out by hand,
 * or kept on hold. "Show finished" brings these back in view. */
const finished = (r: any) => ['Approved', 'Rejected'].includes(r.joining?.status)
  || r.finalDecision === 'Not Selected';
const scheduledAt = (r: any) => slotStage(r, 'MAIN')?.scheduledAt ?? null;
const totalOf = (r: any) => {
  const m = ['WRITTEN', 'INTERVIEW', 'OPTIONAL'].map((x) => markOf(r, x)).filter(Boolean);
  return m.length ? m.reduce((a: number, x: any) => a + Number(x.marks), 0) : null;
};
const decisionBadge = (r: any) => {
  if (r.joining?.status === 'Approved') return <Badge tone="green">Joined</Badge>;
  if (r.joining?.status === 'Rejected') return <Badge tone="red">Rejected at joining</Badge>;
  if (r.finalDecision === 'Selected') return <><Badge tone="green">Sent to joining</Badge>{r.joining?.joiningDate && <div className="mt-0.5 text-[11px] text-muted">Planned {fmtDate(r.joining.joiningDate)}</div>}</>;
  if (r.finalDecision === 'Not Selected') return <Badge tone="slate">Not selected</Badge>;
  if (r.finalDecision === 'On Hold') return <Badge tone="amber">Waiting</Badge>;
  return <span className="text-xs text-muted">To decide</span>;
};

/**
 * Interview (owner, 2026-11-09): one page, three steps per vacancy, the way recruitment systems usually split it:
 * 1 Schedule the interview day → 2 Attendance & marks (a sheet-like grid, or Excel download / upload) → 3 Select for joining
 * (tick or select all, then Send to joining with a planned date, or Not selected). Shortlisting stays on the vacancy page.
 */
export default function InterviewPage() {
  const { can } = useAuth();
  const state = useLoad(() => api('/interviews/board'));
  const [vacancyId, setVacancyId] = useState('');
  const [q, setQ] = useState('');
  // Candidates whose interview day is this date, in every step (owner, 2026-11-09).
  const [interviewOn, setInterviewOn] = useState('');
  const [showFinished, setShowFinished] = useState(false);
  const [step, setStep] = useState<Step>('schedule');
  const [joinView, setJoinView] = useState<JoinView>('decide');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'' | 'schedule' | 'invite' | 'result' | 'joining' | 'waiting' | 'not' | 'undo' | 'upload' | 'back-screening' | 'back-schedule'>('');
  const [slot, setSlot] = useState<any | null>(null);
  const act = useAction();

  // Lists are rebuilt only when the data or a filter changes: the marks grid reloads its cells when its rows change, so a
  // fresh array on every render would wipe what was just typed and saved.
  const loaded: any[] = useMemo(() => state.data?.rows ?? [], [state.data]);
  const active = useMemo(() => (showFinished ? loaded : loaded.filter((r) => !finished(r))), [loaded, showFinished]);
  const vacancies = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of active) { const v = m.get(r.vacancy.id) ?? { ...r.vacancy, count: 0 }; v.count++; m.set(r.vacancy.id, v); }
    return [...m.values()].sort((a, b) => `${a.department} ${a.positionTitle}`.localeCompare(`${b.department} ${b.positionTitle}`));
  }, [active]);
  // With one vacancy in scope it is chosen by itself; a vacancy that drops out of the list clears the choice.
  useEffect(() => {
    if (vacancies.length === 1 && vacancyId !== vacancies[0].id) setVacancyId(vacancies[0].id);
    else if (vacancyId && !vacancies.some((v) => v.id === vacancyId)) setVacancyId('');
  }, [vacancies]);
  const vacancy = vacancies.find((v) => v.id === vacancyId);
  const needle = q.trim().toLowerCase();
  const inView = useMemo(() => active.filter((r) => (!vacancyId || r.vacancy.id === vacancyId)
    && (!interviewOn || (scheduledAt(r) && dayKey(scheduledAt(r)) === interviewOn))
    && (!needle || [r.name, r.candidateNo, r.applicationNo, r.phone, r.email].some((x) => x?.toLowerCase().includes(needle)))), [active, vacancyId, interviewOn, needle]);

  // What each step still needs, shown on the step buttons.
  const toSchedule = inView.filter((r) => !scheduledAt(r) && r.finalDecision === 'Pending');
  const toMark = inView.filter((r) => scheduledAt(r) && slotStage(r, 'MAIN')?.attendance !== 'Absent' && (!markOf(r, 'WRITTEN') || !markOf(r, 'INTERVIEW')) && r.finalDecision === 'Pending');
  const toDecide = inView.filter((r) => r.finalDecision === 'Pending');

  const scheduleRows = [...inView].sort((a, b) => (scheduledAt(a) ? 1 : 0) - (scheduledAt(b) ? 1 : 0) || String(scheduledAt(a) ?? '').localeCompare(String(scheduledAt(b) ?? '')) || (a.name ?? '').localeCompare(b.name ?? ''));
  const marksRows = useMemo(() => [...inView].sort((a, b) => String(scheduledAt(a) ?? '9').localeCompare(String(scheduledAt(b) ?? '9')) || (a.name ?? '').localeCompare(b.name ?? '')), [inView]);
  const joinRows = inView.filter((r) => joinView === 'all' || (joinView === 'decide' ? r.finalDecision === 'Pending'
    : joinView === 'joining' ? r.finalDecision === 'Selected'
    : joinView === 'waiting' ? r.finalDecision === 'On Hold'
    : r.finalDecision === 'Not Selected'))
    .sort((a, b) => (totalOf(b) ?? -1) - (totalOf(a) ?? -1) || (a.name ?? '').localeCompare(b.name ?? ''));
  const rowsOfStep = step === 'schedule' ? scheduleRows : step === 'joining' ? joinRows : marksRows;
  // Marks typed but not saved in step 2: leaving the step asks first.
  const [unsaved, setUnsaved] = useState(0);
  const goStep = (s: Step) => { if (s !== step && unsaved && !window.confirm(`${unsaved} change${unsaved === 1 ? ' is' : 's are'} not saved. Leave step 2 and drop them?`)) return; setUnsaved(0); setStep(s); };

  // A tick belongs to the step it was made in.
  useEffect(() => setSelected(new Set()), [step, vacancyId, joinView, interviewOn]);
  const chosen = loaded.filter((r) => selected.has(r.applicationId));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allTicked = rowsOfStep.length > 0 && rowsOfStep.every((r) => selected.has(r.applicationId));
  const tickAll = () => setSelected(allTicked ? new Set() : new Set(rowsOfStep.map((r) => r.applicationId)));
  const done = (msg: string, keep: string[] = []) => { act.setMessage(msg); setSelected(new Set(keep)); setDialog(''); state.reload(); };

  /** Final decision for each ticked candidate, one by one; refused ones stay ticked. */
  const decideAll = async (decision: 'Not Selected' | 'Pending' | 'On Hold') => {
    const failed: string[] = [];
    const errors: string[] = [];
    const list = decision === 'Pending' ? decided : chosen;
    await act.run(async () => {
      for (const r of list) {
        try { await api(`/applications/${r.applicationId}/final-decision`, { body: { decision } }); } catch (e: any) { failed.push(r.applicationId); errors.push(`${r.name ?? r.applicationNo}: ${e?.message}`); }
      }
    });
    const verb = decision === 'Pending' ? 'moved back to To decide (decision removed)'
      : decision === 'On Hold' ? 'moved to Waiting'
      : 'marked Not selected';
    done(`${list.length - failed.length} candidate${list.length - failed.length === 1 ? '' : 's'} ${verb}.`, failed);
    if (errors.length) act.setError(`Not changed: ${errors.join(' · ')}`);
  };

  /** "Remove" in step 1 or 2 (owner, 2026-11-09): back one stage; the API checks each candidate and refused ones stay ticked. */
  const moveBack = async (to: 'schedule' | 'screening') => {
    const r: any = await act.run(() => api('/interviews/move-back', { body: { applicationIds: chosen.map((x) => x.applicationId), to } }));
    if (!r) return;
    const failed = r.results.filter((x: any) => !x.ok);
    done(`${r.moved} candidate${r.moved === 1 ? '' : 's'} moved back to ${to === 'screening' ? 'the vacancy\'s Candidates & screening' : 'step 1 (Schedule)'}.`, failed.map((x: any) => x.applicationId));
    if (failed.length) act.setError(`Not moved: ${failed.map((x: any) => `${loaded.find((y) => y.applicationId === x.applicationId)?.name ?? ''}: ${x.error}`).join(' · ')}`);
  };
  const decided = chosen.filter((r) => r.finalDecision !== 'Pending');

  const tickHead = <input type="checkbox" className="accent-brand-600" aria-label="Select all" checked={allTicked} disabled={!rowsOfStep.length} onChange={tickAll} />;
  const tickCell = (r: any) => <Td><input type="checkbox" className="accent-brand-600" aria-label={`Select ${r.name ?? r.applicationNo}`} checked={selected.has(r.applicationId)} onChange={() => toggle(r.applicationId)} /></Td>;
  const who = (r: any) => (
    <Td><Link className="font-medium text-brand-700 hover:underline" href={`/applications/${r.applicationId}`}>{r.name ?? r.applicationNo}</Link>
      <div className="text-xs text-muted">{r.applicationNo}{r.phone ? ` · ${r.phone}` : ''}</div>
      {r.hasFile && r.documentId && <a className="text-xs text-brand-700 hover:underline" href={`/api/documents/${r.documentId}`} target="_blank" rel="noopener noreferrer">View CV</a>}</Td>
  );
  const vacCell = (r: any) => !vacancyId && <Td className="text-xs">{r.vacancy.positionTitle}<div className="text-muted">{r.vacancy.department} · {r.vacancy.vacancyNo}</div></Td>;
  const markCell = (r: any, round: string) => { const m = markOf(r, round); return <Td className="text-right tabular-nums">{m ? <>{m.marks}<span className="text-muted">/{m.maxMarks ?? '—'}</span></> : <span className="text-muted">—</span>}</Td>; };

  const STEPS: { key: Step; n: number; title: string; hint: string; todo: number }[] = [
    { key: 'schedule', n: 1, title: 'Schedule', hint: 'Set the interview date & time', todo: toSchedule.length },
    { key: 'marks', n: 2, title: 'Attendance & marks', hint: 'Type in or upload Excel', todo: toMark.length },
    { key: 'joining', n: 3, title: 'Select for joining', hint: 'Send to joining, waiting or not selected', todo: toDecide.length },
  ];

  return (
    <>
      <PageHeader title="Interview" subtitle="Shortlisted candidates, step by step: schedule the interview, enter attendance and marks, then select who goes to joining. Candidates are shortlisted on the vacancy's Candidates tab." />

      <Card pad={false} className="mb-4">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Select className="max-w-md" value={vacancyId} onChange={(e) => setVacancyId(e.target.value)} placeholder={`All vacancies (${active.length} candidates)`} aria-label="Vacancy"
            options={vacancies.map((v) => ({ value: v.id, label: `${v.department} · ${v.positionTitle} · ${v.vacancyNo} (${v.count})` }))} />
          <Input className="max-w-[14rem]" placeholder="Search name, ID or phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search candidates" />
          <label className="flex items-center gap-2 text-sm text-muted">Interview date
            <Input type="date" className="w-44" value={interviewOn} onChange={(e) => setInterviewOn(e.target.value)} aria-label="Interview date" /></label>
          <Button size="sm" variant={interviewOn === dayKey(new Date()) ? 'primary' : 'secondary'} onClick={() => setInterviewOn(dayKey(new Date()))}>Today</Button>
          {interviewOn && <Button size="sm" variant="ghost" onClick={() => setInterviewOn('')}>Any date</Button>}
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="accent-brand-600" checked={showFinished} onChange={(e) => setShowFinished(e.target.checked)} />
            Show finished ({loaded.filter(finished).length})
          </label>
        </div>
        <div className="grid border-t border-line sm:grid-cols-3">
          {STEPS.map((s) => (
            <button key={s.key} onClick={() => goStep(s.key)} className={cx('flex items-center gap-3 border-line px-4 py-3 text-left sm:border-r sm:last:border-r-0', step === s.key ? 'bg-brand-50 ring-2 ring-inset ring-brand-600' : 'hover:bg-slate-50')}>
              <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold', step === s.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink')}>{s.n}</span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">{s.title}</span><span className="block text-xs text-muted">{s.hint}</span></span>
              {s.todo > 0 && <Badge tone="amber">{s.todo} to do</Badge>}
            </button>
          ))}
        </div>
      </Card>

      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>

      {selected.size > 0 && (
        <div className="sticky top-14 z-[5] mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm shadow-sm">
          <b>{selected.size} selected</b>
          {step === 'schedule' && <>
            {can(P.SHORTLIST) && <Button size="sm" onClick={() => setDialog('schedule')}>Set interview date & time</Button>}
            {can(P.EMAIL_SEND) && <Button size="sm" variant="secondary" onClick={() => setDialog('invite')}>Email invitation</Button>}
            {can(P.SHORTLIST) && <Button size="sm" variant="danger" onClick={() => setDialog('back-screening')}>Remove from interview</Button>}
          </>}
          {step === 'marks' && can(P.SHORTLIST) && <Button size="sm" variant="danger" onClick={() => setDialog('back-schedule')}>Remove (back to Schedule)</Button>}
          {step === 'joining' && <>
            {can(P.FINAL_DECISION) && can(P.JOINING_APPROVE) && <Button size="sm" onClick={() => setDialog('joining')}>Send to joining</Button>}
            {can(P.FINAL_DECISION) && <Button size="sm" variant="secondary" onClick={() => setDialog('waiting')} title="Keep as backup; move to joining later if a selected candidate does not join.">Send to waiting</Button>}
            {can(P.FINAL_DECISION) && <Button size="sm" variant="secondary" onClick={() => setDialog('not')}>Not selected</Button>}
            {can(P.EMAIL_SEND) && <Button size="sm" variant="secondary" onClick={() => setDialog('result')}>Email result</Button>}
            {can(P.FINAL_DECISION) && decided.length > 0 && <Button size="sm" variant="danger" onClick={() => setDialog('undo')}>Remove decision</Button>}
          </>}
          {can(P.CV_DOWNLOAD) && <Button size="sm" variant="secondary" onClick={() => act.run(() => download('/applications/cv-pack', { applicationIds: [...selected] }), 'CV ZIP downloaded.')}>Download CVs</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Loaded state={state} empty={(d: any) => (!d.rows.length ? 'No shortlisted candidates yet. Shortlist candidates on a vacancy\'s Candidates tab; they appear here.'
        : !inView.length && (interviewOn ? `No interview on ${fmtDate(interviewOn)}${vacancyId || needle ? ' for this vacancy or search' : ''}.` : active.length ? 'No candidate matches this vacancy or search.' : 'Every candidate is finished. Tick "Show finished" to see them.'))}>
        {() => (
          <>
            {step === 'schedule' && (
              <Card pad={false} title="1 · Schedule the interview" actions={<span className="text-xs text-muted">Written exam and interview board are held on the same day. Tick candidates, then Set interview date & time. Click a date to change one candidate.</span>}>
                <Table head={[tickHead, 'Candidate', ...(!vacancyId ? ['Vacancy'] : []), 'Interview date & time', 'Venue', 'Status']}>
                  {scheduleRows.map((r) => {
                    const s = slotStage(r, 'MAIN');
                    return (
                      <tr key={r.applicationId} className={selected.has(r.applicationId) ? 'bg-brand-50/50' : 'hover:bg-slate-50'}>
                        {tickCell(r)}{who(r)}{vacCell(r)}
                        <Td><button className="rounded-md border border-line px-2 py-1 text-left text-sm hover:border-brand-600" onClick={() => setSlot(r)}>
                          {s?.scheduledAt ? <span className="whitespace-nowrap font-medium">{shortDate(s.scheduledAt)} · {time(s.scheduledAt)}</span> : <span className="text-amber-700">Not scheduled · set</span>}</button></Td>
                        <Td className="text-xs">{s?.location ?? <span className="text-muted">—</span>}</Td>
                        <Td><Badge tone={nextStep(r).tone}>{nextStep(r).label}</Badge></Td>
                      </tr>
                    );
                  })}
                </Table>
              </Card>
            )}

            {step === 'marks' && (
              <Card pad={false} title="2 · Attendance & marks"
                actions={can(P.MARKS_IMPORT) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" disabled={!vacancy} title={vacancy ? undefined : 'Choose one vacancy above'} onClick={() => act.run(() => download(`/vacancies/${vacancy.id}/marks-template?stageType=MAIN`))}>Download Excel</Button>
                    <Button size="sm" disabled={!vacancy} title={vacancy ? undefined : 'Choose one vacancy above'} onClick={() => setDialog('upload')}>Upload Excel</Button>
                    {!vacancy && <span className="text-xs text-muted">Choose one vacancy above to use Excel.</span>}
                  </div>
                )}>
                <MarksGrid rows={marksRows} showVacancy={!vacancyId} canMarks={can(P.MARKS_ENTER)} canAttendance={can(P.ATTENDANCE)} onError={act.setError} onMessage={act.setMessage} canSalary={can(P.CANDIDATE_EDIT)}
                  onDirtyChange={setUnsaved} selected={selected} onToggle={toggle} onToggleAll={tickAll} onSaved={state.reload} />
              </Card>
            )}

            {step === 'joining' && (
              <Card pad={false} title="3 · Select for joining">
                <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2 text-sm">
                  {([['decide', 'To decide'], ['joining', 'Sent to joining'], ['waiting', 'Waiting'], ['not', 'Not selected'], ['all', 'All']] as [JoinView, string][]).map(([k, label]) => (
                    <button key={k} onClick={() => setJoinView(k)} className={cx('rounded-full px-3 py-1', joinView === k ? 'bg-brand-600 text-white' : 'hover:bg-slate-100')}>
                      {label} <span className="tabular-nums opacity-80">({inView.filter((r) => k === 'all' || (k === 'decide' ? r.finalDecision === 'Pending' : k === 'joining' ? r.finalDecision === 'Selected' : k === 'waiting' ? r.finalDecision === 'On Hold' : r.finalDecision === 'Not Selected')).length})</span>
                    </button>
                  ))}
                  <span className="ml-auto text-xs text-muted">Highest total first. Tick candidates, or Select all, then Send to joining or Waiting.</span>
                </div>
                <Table head={[tickHead, 'Candidate', ...(!vacancyId ? ['Vacancy'] : []), 'Attendance', 'Written', 'Interview', 'Total', 'Expected salary', 'Decision']}>
                  {joinRows.map((r) => (
                    <tr key={r.applicationId} className={selected.has(r.applicationId) ? 'bg-brand-50/50' : 'hover:bg-slate-50'}>
                      {tickCell(r)}{who(r)}{vacCell(r)}
                      <Td className="text-xs">{slotStage(r, 'MAIN')?.attendance ?? <span className="text-muted">Not scheduled</span>}</Td>
                      {markCell(r, 'WRITTEN')}{markCell(r, 'INTERVIEW')}
                      <Td className="text-right font-semibold tabular-nums">{totalOf(r) ?? <span className="font-normal text-muted">—</span>}</Td>
                      <Td className="whitespace-nowrap text-sm">{r.expectedSalary ?? <span className="text-muted">—</span>}</Td>
                      <Td>{decisionBadge(r)}</Td>
                    </tr>
                  ))}
                </Table>
                {!joinRows.length && <p className="p-4 text-sm text-muted">No candidates in this list.</p>}
              </Card>
            )}
          </>
        )}
      </Loaded>

      <ScheduleDialog mainOnly open={dialog === 'schedule'} count={selected.size} applicationIds={[...selected]} onClose={() => setDialog('')} onSaved={(m) => done(m)} />
      <SlotDialog row={slot} kind="MAIN" onClose={() => setSlot(null)} onSaved={() => { act.setMessage('Saved.'); state.reload(); }} />
      {(dialog === 'invite' || dialog === 'result') && (
        <EmailComposer open kind={dialog === 'invite' ? 'INTERVIEW_INVITE' : 'RESULT'} applicationIds={[...selected]} onClose={() => setDialog('')} onSent={state.reload} />
      )}
      <SendToJoiningDialog open={dialog === 'joining'} rows={chosen} onClose={() => setDialog('')} onSaved={(m, failedIds) => done(m, failedIds)} />
      <ConfirmDialog open={dialog === 'not' || dialog === 'undo' || dialog === 'waiting'} danger={dialog === 'not'} busy={act.busy}
        title={dialog === 'not' ? `Mark ${chosen.length} candidate${chosen.length === 1 ? '' : 's'} as Not selected?`
          : dialog === 'waiting' ? `Move ${chosen.length} candidate${chosen.length === 1 ? '' : 's'} to waiting?`
          : `Remove the decision of ${decided.length} candidate${decided.length === 1 ? '' : 's'}?`}
        confirmLabel={dialog === 'not' ? 'Not selected' : dialog === 'waiting' ? 'Send to waiting' : 'Remove decision'}
        message={<div className="space-y-2">
          <p>{chosen.map((r) => r.name ?? r.applicationNo).join(', ')}</p>
          {dialog === 'waiting' && <Alert tone="info">Kept as a backup. If a selected candidate does not join, you can move someone from Waiting to Joining later.</Alert>}
          {chosen.some((r) => r.finalDecision === 'Selected' && r.joining?.status === 'Pending') && <Alert tone="warning">Some of them are waiting in Joining Pending; they leave it, with their planned joining date.</Alert>}
          {chosen.some((r) => r.joining?.status === 'Approved') && <Alert tone="info">Candidates who already joined cannot be changed and are skipped.</Alert>}
        </div>}
        onConfirm={() => decideAll(dialog === 'not' ? 'Not Selected' : dialog === 'waiting' ? 'On Hold' : 'Pending')} onClose={() => setDialog('')} />
      <ConfirmDialog open={dialog === 'back-screening' || dialog === 'back-schedule'} danger busy={act.busy}
        title={dialog === 'back-screening' ? `Remove ${chosen.length} candidate${chosen.length === 1 ? '' : 's'} from the interview?` : `Move ${chosen.length} candidate${chosen.length === 1 ? '' : 's'} back to Schedule?`}
        confirmLabel={dialog === 'back-screening' ? 'Remove from interview' : 'Move back'}
        message={<div className="space-y-2">
          <p>{chosen.map((r) => r.name ?? r.applicationNo).join(', ')}</p>
          <p>{dialog === 'back-screening'
            ? 'They go back to the vacancy\'s Candidates & screening (no longer shortlisted) and leave the Interview page. Their interview date, attendance and any marks are cleared.'
            : 'They go back to step 1 (Schedule): their interview date, attendance and marks are cleared, so they can be scheduled again.'}</p>
          {chosen.some((r) => r.marks.length) && <Alert tone="warning">Marks already entered for {chosen.filter((r) => r.marks.length).map((r) => r.name ?? r.applicationNo).join(', ')} will be removed. The Logs keep a copy.</Alert>}
          {decided.length > 0 && <Alert tone="info">Candidates with a final decision are skipped; remove their decision in step 3 first.</Alert>}
        </div>}
        onConfirm={() => moveBack(dialog === 'back-screening' ? 'screening' : 'schedule')} onClose={() => setDialog('')} />
      {vacancy && <MarksImportModal fixed vacancies={[{ id: vacancy.id, vacancyNo: vacancy.vacancyNo, positionTitle: vacancy.positionTitle, department: vacancy.department, departmentId: vacancy.departmentId, status: vacancy.status }]}
        vacancyId={vacancy.id} stage="MAIN" open={dialog === 'upload'} onClose={() => setDialog('')} onDone={state.reload} />}
    </>
  );
}
