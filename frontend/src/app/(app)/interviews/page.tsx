'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmailComposer } from '@/components/EmailComposer';
import { MarksImportModal } from '@/components/interviews/MarksImportModal';
import { DECISIONS, KIND_LABEL, Kind, ROUND_LABEL, ROUNDS, Slot, dayKey, endTime, markOf, nextStep, shortDate, slotStage, slotsOf, time } from '@/components/interviews/rounds';
import { ScheduleDialog, SlotDialog } from '@/components/interviews/SlotDialogs';
import { Alert, Badge, Button, Card, Input, Loaded, PageHeader, Select, Stat, Table, Tabs, Td, cx, useAction, useLoad } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const KIND_TONE: Record<Kind, string> = { MAIN: 'violet', OPTIONAL: 'orange' };
const ATT_TONE: Record<string, string> = { Present: 'green', Absent: 'red', 'Not Recorded': 'slate' };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return addDays(x, -((x.getDay() + 1) % 7)); }; // weeks start on Saturday
const longDay = (k: string) => new Date(`${k}T00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const roundsOf = (kind: Kind) => (kind === 'MAIN' ? ['WRITTEN', 'INTERVIEW'] : ['OPTIONAL']);
const shortRound = (r: string) => ROUND_LABEL[r].replace(' (viva)', '');

/** Marks of a round, e.g. "Written exam 72/100", or a dash. */
function MarkText({ row, round }: { row: any; round: string }) {
  const m = markOf(row, round);
  return m ? <span className="tabular-nums">{m.marks}<span className="text-muted">/{m.maxMarks ?? '—'}</span></span> : <span className="text-muted">—</span>;
}

function SlotCard({ slot, onOpen }: { slot: Slot; onOpen: () => void }) {
  const { row, kind, stage } = slot;
  return (
    <div className="flex gap-4 rounded-lg border border-line bg-white p-3 shadow-sm">
      <div className="w-24 shrink-0 border-r border-line pr-3 text-right">
        <div className="text-lg font-semibold tabular-nums">{time(stage.scheduledAt)}</div>
        {endTime(stage.scheduledAt, stage.durationMinutes) && <div className="text-xs text-muted tabular-nums">to {endTime(stage.scheduledAt, stage.durationMinutes)}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="font-semibold text-brand-700 hover:underline" href={`/applications/${row.applicationId}`}>{row.name ?? row.applicationNo}</Link>
          <Badge tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Badge>
          <span className="text-xs text-muted">{row.candidateNo} · {row.applicationNo}</span>
        </div>
        <div className="mt-0.5 text-sm">{row.vacancy.positionTitle} <span className="text-muted">· {row.vacancy.department} · {row.vacancy.company} · {row.vacancy.vacancyNo}</span></div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
          {stage.location && <span>Venue: <span className="text-ink">{stage.location}</span></span>}
          {stage.panel && <span>Panel: <span className="text-ink">{stage.panel}</span></span>}
          {row.phone && <span>Phone: <span className="text-ink">{row.phone}</span></span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
        <Badge tone={ATT_TONE[stage.attendance]}>{stage.attendance}</Badge>
        {roundsOf(kind).map((r) => <span key={r} className="text-muted">{shortRound(r)}: <MarkText row={row} round={r} /></span>)}
        <Button size="sm" variant="secondary" onClick={onOpen}>Manage</Button>
      </div>
    </div>
  );
}

/** Interview Board (owner, 2026-11-04): shortlisted candidates' written exam & interview day, optional exam, marks and decisions. */
export default function InterviewBoardPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({ departmentId: '', designation: '', vacancyId: '', kind: '', q: '' });
  const state = useLoad(() => api(`/interviews/board${qs({ departmentId: filters.departmentId, vacancyId: filters.vacancyId, q: filters.q })}`), [filters.departmentId, filters.vacancyId, filters.q]);
  const [tab, setTab] = useState('schedule');
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [open, setOpen] = useState<{ row: any; kind: Kind } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'' | 'schedule' | 'invite' | 'result'>('');
  const [upload, setUpload] = useState<string | null>(null);
  const act = useAction();

  const all: any[] = state.data?.rows ?? [];
  // Department and vacancy go to the API; designation and exam narrow what is loaded.
  const rows = all.filter((r) => !filters.designation || r.vacancy.positionTitle === filters.designation);
  const slots = slotsOf(rows, filters.kind || undefined);
  const today = dayKey(new Date());
  const byDay = useMemo(() => slots.reduce<Record<string, Slot[]>>((m, s) => { (m[dayKey(s.stage.scheduledAt)] ??= []).push(s); return m; }, {}), [slots]);
  const upcoming = Object.keys(byDay).filter((k) => k >= today).sort().slice(0, 14);
  const weekDays = Array.from({ length: 7 }, (_, i) => dayKey(addDays(week, i)));

  const departments = [...new Map(all.map((r) => [r.vacancy.departmentId, r.vacancy.department])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const designations = [...new Set(all.filter((r) => !filters.departmentId || r.vacancy.departmentId === filters.departmentId).map((r) => r.vacancy.positionTitle as string))].sort();
  const vacancies = [...new Map(all.map((r) => [r.vacancy.id, r.vacancy])).values()];
  const uploadFor = vacancies.find((v) => v.id === filters.vacancyId);

  const notScheduled = rows.filter((r) => r.shortlisted && r.finalDecision === 'Pending' && !slotStage(r, 'MAIN')?.scheduledAt).length;
  const in7 = dayKey(addDays(new Date(), 7));
  const awaitingMarks = slots.filter((s) => s.stage.attendance === 'Present' && roundsOf(s.kind).some((r) => !markOf(s.row, r))).length;

  // Candidates view: department → designation (vacancy) groups.
  const groups = useMemo(() => {
    const g = new Map<string, { key: string; title: string; vacancy: any; rows: any[] }>();
    for (const r of rows) {
      if (!g.has(r.vacancy.id)) g.set(r.vacancy.id, { key: r.vacancy.id, title: `${r.vacancy.department} · ${r.vacancy.positionTitle}`, vacancy: r.vacancy, rows: [] });
      g.get(r.vacancy.id)!.rows.push(r);
    }
    return [...g.values()];
  }, [rows]);

  const setF = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v, ...(k === 'departmentId' ? { designation: '', vacancyId: '' } : {}) }));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const decide = (id: string, decision: string) => act.run(() => api(`/applications/${id}/final-decision`, { body: { decision } }),
    decision === 'Selected' ? 'Selected: the candidate is now in Joining Pending.' : `Final decision recorded: ${decision}.`).then(state.reload);
  const goTo = (k: string) => { setDay(k); setWeek(startOfWeek(new Date(`${k}T00:00`))); };

  const slotCell = (r: any, kind: Kind) => {
    const s = slotStage(r, kind);
    return (
      <button className="w-full rounded-md border border-line p-2 text-left text-xs hover:border-brand-600" onClick={() => setOpen({ row: r, kind })}>
        {s?.scheduledAt ? (
          <>
            <div className="font-medium text-ink">{shortDate(s.scheduledAt)} · {time(s.scheduledAt)}{endTime(s.scheduledAt, s.durationMinutes) ? `–${endTime(s.scheduledAt, s.durationMinutes)}` : ''}</div>
            {s.location && <div className="truncate text-muted">{s.location}</div>}
            <div className="mt-1"><Badge tone={ATT_TONE[s.attendance]}>{s.attendance}</Badge></div>
          </>
        ) : <span className="text-muted">{kind === 'MAIN' ? 'Not scheduled · set' : 'Not held · set'}</span>}
      </button>
    );
  };

  return (
    <>
      <PageHeader title="Interview Board"
        subtitle={state.data ? (state.data.allVacancies ? 'Every shortlisted candidate across all vacancies and coordinators.' : 'Shortlisted candidates of the vacancies you coordinate.') : ' '} />
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>

      <Card pad={false} className="mb-4">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Select className="max-w-[12rem]" value={filters.departmentId} placeholder="All departments" onChange={(e) => setF('departmentId', e.target.value)} options={departments.map(([id, name]) => ({ value: id, label: name }))} />
          <Select className="max-w-[13rem]" value={filters.designation} placeholder="All designations" onChange={(e) => setF('designation', e.target.value)} options={designations.map((d) => ({ value: d, label: d }))} />
          <Select className="max-w-[14rem]" value={filters.vacancyId} placeholder="All vacancies" onChange={(e) => setF('vacancyId', e.target.value)}
            options={vacancies.filter((v) => (!filters.departmentId || v.departmentId === filters.departmentId) && (!filters.designation || v.positionTitle === filters.designation)).map((v) => ({ value: v.id, label: `${v.vacancyNo} · ${v.positionTitle}` }))} />
          <Select className="max-w-[15rem]" value={filters.kind} placeholder="All exams" onChange={(e) => setF('kind', e.target.value)} options={(['MAIN', 'OPTIONAL'] as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <Input className="max-w-[14rem]" placeholder="Candidate name or ID…" value={filters.q} onChange={(e) => setF('q', e.target.value)} />
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Shortlisted" value={rows.filter((r) => r.shortlisted).length} tone="slate" />
        <Stat label="Not scheduled" value={notScheduled} tone="amber" hint="No written & interview day yet" />
        <Stat label="Today" value={byDay[today]?.length ?? 0} tone="brand" />
        <Stat label="Next 7 days" value={slots.filter((s) => { const k = dayKey(s.stage.scheduledAt); return k >= today && k < in7; }).length} tone="violet" />
        <Stat label="Marks pending" value={awaitingMarks} tone="amber" hint="Attended, marks not entered" />
        <Stat label="Selected" value={rows.filter((r) => r.finalDecision === 'Selected').length} tone="green" />
      </div>

      {can(P.MARKS_IMPORT) && (
        <Card className="mb-4" title="Upload marks from Excel" actions={!uploadFor && <span className="text-xs text-muted">Choose a vacancy in the filters first</span>}>
          <div className="flex flex-wrap items-center gap-2">
            {ROUNDS.map(([r, l]) => (
              <Button key={r} variant={r === 'OPTIONAL' ? 'secondary' : 'primary'} disabled={!uploadFor} onClick={() => setUpload(r)}>Upload {l.replace(' (viva)', '').toLowerCase()} marks</Button>
            ))}
            <span className="text-xs text-muted">{uploadFor ? `For ${uploadFor.vacancyNo} · ${uploadFor.positionTitle}. The optional exam is uploaded only when it was held.` : 'Each exam has its own upload; rows are matched by Application ID.'}</span>
          </div>
        </Card>
      )}

      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'schedule', label: 'Schedule (date-wise)' }, { key: 'candidates', label: 'Candidates by department & designation' }]} />

      <Loaded state={state} empty={(d: any) => !d.rows.length && 'No shortlisted candidates yet. Shortlist candidates from a vacancy\'s Candidates tab; they appear here.'}>
        {() => tab === 'schedule' ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <div className="space-y-3">
              <Card pad={false}>
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(week, -7))}>‹ Previous week</Button>
                  <div className="text-sm font-medium">{new Date(`${weekDays[0]}T00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – {new Date(`${weekDays[6]}T00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                  <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => goTo(today)}>Today</Button><Button size="sm" variant="ghost" onClick={() => setWeek(addDays(week, 7))}>Next week ›</Button></div>
                </div>
                <div className="grid grid-cols-7">
                  {weekDays.map((k) => {
                    const d = new Date(`${k}T00:00`);
                    const n = byDay[k]?.length ?? 0;
                    return (
                      <button key={k} onClick={() => setDay(k)} className={cx('border-r border-line px-1 py-2 text-center last:border-r-0 hover:bg-slate-50', k === day && 'bg-brand-50 ring-2 ring-inset ring-brand-600')}>
                        <div className="text-[11px] uppercase tracking-wide text-muted">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                        <div className={cx('text-lg font-semibold tabular-nums', k === today && 'text-brand-700')}>{d.getDate()}</div>
                        <div className={cx('mx-auto mt-0.5 w-fit rounded-full px-2 text-xs tabular-nums', n ? 'bg-brand-600 text-white' : 'text-muted')}>{n || '–'}</div>
                      </button>
                    );
                  })}
                </div>
              </Card>
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold">{longDay(day)}</h2>
                <span className="text-sm text-muted">{byDay[day]?.length ?? 0} candidate{byDay[day]?.length === 1 ? '' : 's'}</span>
              </div>
              {byDay[day]?.length
                ? byDay[day].map((s) => <SlotCard key={`${s.row.applicationId}-${s.kind}`} slot={s} onOpen={() => setOpen({ row: s.row, kind: s.kind })} />)
                : <div className="rounded-lg border border-dashed border-line bg-white p-6 text-center text-sm text-muted">No exams or interviews on this day.</div>}
            </div>
            <div className="space-y-3">
              <Card title="Upcoming" pad={false}>
                {upcoming.length ? upcoming.map((k) => (
                  <button key={k} onClick={() => goTo(k)} className={cx('block w-full border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-slate-50', k === day && 'bg-brand-50')}>
                    <div className="flex items-center justify-between text-sm font-medium"><span>{new Date(`${k}T00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</span><Badge tone="blue">{byDay[k].length}</Badge></div>
                    <div className="mt-0.5 truncate text-xs text-muted">{[...new Set(byDay[k].map((s) => `${s.row.vacancy.department} · ${s.row.vacancy.positionTitle}`))].join('; ')}</div>
                  </button>
                )) : <p className="p-3 text-sm text-muted">Nothing scheduled ahead.</p>}
              </Card>
              {notScheduled > 0 && (
                <Alert tone="warning">{notScheduled} shortlisted candidate{notScheduled === 1 ? ' has' : 's have'} no written & interview day yet. <button className="font-medium underline" onClick={() => setTab('candidates')}>Schedule them</button>.</Alert>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {selected.size > 0 && (
              <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm shadow-sm">
                <b>{selected.size} selected</b>
                {can(P.SHORTLIST) && <Button size="sm" onClick={() => setDialog('schedule')}>Schedule / reschedule</Button>}
                {can(P.EMAIL_SEND) && <Button size="sm" variant="secondary" onClick={() => setDialog('invite')}>Send invitation</Button>}
                {can(P.EMAIL_SEND) && <Button size="sm" variant="secondary" onClick={() => setDialog('result')}>Send result email</Button>}
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            )}
            {groups.map((g) => (
              <Card key={g.key} pad={false} title={<>{g.title} <span className="font-normal text-muted">· {g.vacancy.vacancyNo} · {g.vacancy.company} · {g.rows.length} candidate{g.rows.length === 1 ? '' : 's'}</span></>}>
                <Table head={[<input key="all" type="checkbox" aria-label={`Select all of ${g.vacancy.vacancyNo}`} className="accent-brand-600" checked={g.rows.every((r) => selected.has(r.applicationId))}
                  onChange={(e) => setSelected((s) => { const n = new Set(s); g.rows.forEach((r) => (e.target.checked ? n.add(r.applicationId) : n.delete(r.applicationId))); return n; })} />,
                  'Candidate', 'Written & interview day', 'Written exam', 'Interview board', 'Optional exam', 'Next step', 'Final decision']}>
                  {g.rows.map((r) => {
                    const next = nextStep(r);
                    return (
                      <tr key={r.applicationId} className={cx('align-top', selected.has(r.applicationId) ? 'bg-brand-50/50' : 'hover:bg-slate-50')}>
                        <Td><input type="checkbox" className="accent-brand-600" aria-label={`Select ${r.applicationNo}`} checked={selected.has(r.applicationId)} onChange={() => toggle(r.applicationId)} /></Td>
                        <Td><Link className="font-medium text-brand-700 hover:underline" href={`/applications/${r.applicationId}`}>{r.name ?? r.applicationNo}</Link>
                          <div className="text-xs text-muted">{r.applicationNo} · {r.candidateNo}</div>
                          <div className="text-xs text-muted">{r.phone ?? ''}{r.email ? ` · ${r.email}` : ''}</div>
                          <div className="mt-1"><Badge>{r.screeningResult ?? 'Not screened'}</Badge></div></Td>
                        <Td className="min-w-[10rem]">{slotCell(r, 'MAIN')}</Td>
                        {['WRITTEN', 'INTERVIEW'].map((k) => (
                          <Td key={k} className="whitespace-nowrap text-sm"><MarkText row={r} round={k} />{r.stages[k] && r.stages[k].result !== 'Pending' && <div className="mt-1"><Badge>{r.stages[k].result}</Badge></div>}</Td>
                        ))}
                        <Td className="min-w-[9rem]">{slotCell(r, 'OPTIONAL')}{markOf(r, 'OPTIONAL') && <div className="mt-1 text-sm"><MarkText row={r} round="OPTIONAL" /></div>}</Td>
                        <Td><Badge tone={next.tone}>{next.label}</Badge></Td>
                        <Td>
                          <Select className="w-36" value={r.finalDecision} disabled={!can(P.FINAL_DECISION) || !!r.joining && r.joining.status !== 'Pending'} onChange={(e) => decide(r.applicationId, e.target.value)}
                            options={DECISIONS.map((x) => ({ value: x, label: x }))} aria-label="Final decision" />
                          {r.joining && <div className="mt-1 text-[11px] text-muted">Joining: {r.joining.status}</div>}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              </Card>
            ))}
            <p className="text-xs text-muted">Every shortlisted candidate sits the written exam and the interview board on the same day; the optional exam only when it is held. Marks stay per exam; no weighted total is calculated. Selected candidates move to Joining Pending.</p>
          </div>
        )}
      </Loaded>

      <SlotDialog row={open?.row ?? null} kind={open?.kind ?? 'MAIN'} onClose={() => setOpen(null)} onSaved={() => { act.setMessage('Saved.'); state.reload(); }} />
      <ScheduleDialog open={dialog === 'schedule'} count={selected.size} applicationIds={[...selected]} onClose={() => setDialog('')} onSaved={(m) => { act.setMessage(m); setSelected(new Set()); state.reload(); }} />
      {(dialog === 'invite' || dialog === 'result') && (
        <EmailComposer open kind={dialog === 'invite' ? 'INTERVIEW_INVITE' : 'RESULT'} applicationIds={[...selected]} onClose={() => setDialog('')} onSent={state.reload} />
      )}
      {uploadFor && upload && (
        <MarksImportModal vacancyId={uploadFor.id} vacancyLabel={`${uploadFor.vacancyNo} · ${uploadFor.positionTitle}`} stage={upload} open onClose={() => setUpload(null)} onDone={state.reload} />
      )}
    </>
  );
}
