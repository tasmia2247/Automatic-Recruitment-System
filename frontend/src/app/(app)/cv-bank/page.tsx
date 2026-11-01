'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, cx, Empty, Field, Input, Loaded, Modal, PageHeader, Pager, Select, Table, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const STATUSES = ['Received', 'Screening', 'Pass', 'Fail', 'Review Required', 'Shortlisted', 'Interview', 'Selected', 'Not Selected', 'On Hold', 'Joined'];

type Filters = { departmentId: string; vacancyId: string; q: string; status: string };

/** Moves one application to another status via the workflow-checked API; only server-allowed targets are offered. */
function StatusModal({ row, onClose, onDone }: { row: any; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState(row.transitions[0]?.status ?? '');
  const [reason, setReason] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [when, setWhen] = useState('');
  const [location, setLocation] = useState('');
  const act = useAction();
  const opt = row.transitions.find((t: any) => t.status === target);
  const save = async () => {
    const r = await act.run(() => api(`/applications/${row.applicationId}/status`, {
      body: {
        fromStatus: row.status, status: target, reason: reason.trim() || undefined,
        joiningDate: opt?.needsJoiningDate ? joiningDate || undefined : undefined,
        scheduledAt: opt?.allowsSchedule && when ? new Date(when).toISOString() : undefined,
        location: opt?.allowsSchedule && location ? location : undefined,
      },
    }));
    if (r) onDone();
  };
  const label = (s: string) => (row.status === 'Shortlisted' && s === (row.screeningResult ?? 'Review Required') ? `${s} (remove from shortlist)` : s);
  return (
    <Modal open title={`Change status — ${row.applicationNo}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={act.busy} disabled={!target || (opt?.reasonRequired && reason.trim().length < 3) || (opt?.needsJoiningDate && !joiningDate)} onClick={save}>Update status</Button></>}>
      <div className="space-y-3">
        <p className="text-sm">{row.name ?? row.candidateNo} · {row.positionTitle} ({row.vacancyNo}). Current status: <Badge>{row.status}</Badge></p>
        <p className="text-xs text-muted">Only this application changes; the candidate's applications to other vacancies keep their own status.</p>
        <Field label="New status" required>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} options={row.transitions.map((t: any) => ({ value: t.status, label: label(t.status) }))} />
        </Field>
        {opt?.allowsSchedule && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Interview date & time (optional)"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
            <Field label="Location (optional)"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          </div>
        )}
        {opt?.needsJoiningDate && (
          <Field label="Verified joining date" required error={act.fieldErrors.joiningDate}><Input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></Field>
        )}
        <Field label={opt?.reasonRequired ? 'Reason' : 'Reason / remarks (optional)'} required={opt?.reasonRequired} error={act.fieldErrors.reason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Alert>{act.error}</Alert>
      </div>
    </Modal>
  );
}

function VacancyCandidates({ vacancy, filters, onChanged }: { vacancy: any; filters: Filters; onChanged: () => void }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters.q, filters.status]);
  const state = useLoad(() => api(`/cv-bank/applications${qs({ vacancyId: vacancy.id, q: filters.q, status: filters.status, page, pageSize: 25 })}`), [vacancy.id, filters.q, filters.status, page]);
  const [editing, setEditing] = useState<any | null>(null);
  return (
    <div className="border-t border-line bg-slate-50/40">
      <Loaded state={state} empty={(d: any) => !d.items.length && (filters.q || filters.status ? 'No candidates in this vacancy match the filters.' : 'No candidates have applied for this vacancy yet.')}>
        {(d: any) => (
          <>
            <Table head={['Candidate', 'Application ID', 'Department · Company', 'Vacancy / position', 'CV', 'Criteria met', 'Screening', 'Status', 'Remarks', 'Last updated', '']}>
              {d.items.map((r: any) => (
                <tr key={r.applicationId} className="bg-white hover:bg-slate-50">
                  <Td><div className="font-medium">{r.name ?? <i className="text-amber-700">Name needs review</i>}</div><div className="text-xs text-muted">{r.candidateNo}</div></Td>
                  <Td className="whitespace-nowrap text-xs">{r.applicationNo}{r.duplicateReview === 'PENDING' && <div><Badge tone="amber">Possible duplicate</Badge></div>}</Td>
                  <Td className="text-xs">{r.department}<div className="text-muted">{r.company}</div></Td>
                  <Td className="text-xs">{r.positionTitle}<div className="text-muted">{r.vacancyNo}</div></Td>
                  <Td className="whitespace-nowrap text-xs">
                    {!r.documentId ? '—' : can(P.CV_DOWNLOAD) ? (
                      <div className="flex flex-col gap-0.5">
                        <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`/api/documents/${r.documentId}`}>Preview</a>
                        <a className="text-brand-700 hover:underline" href={`/api/documents/${r.documentId}?download=1`}>Download</a>
                      </div>
                    ) : <span className="text-muted">No access</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs tabular-nums">{r.criteriaTotal ? <>{r.criteriaMet} / {r.criteriaTotal}<div className="text-muted">criteria v{r.criteriaVersion}</div></> : '—'}</Td>
                  <Td>{r.screeningResult ? <Badge>{r.screeningResult}</Badge> : <span className="text-xs text-muted">{r.processingStatus === 'Failed' ? 'CV processing failed' : 'Not screened'}</span>}</Td>
                  <Td>
                    <Badge>{r.status}</Badge>
                    {r.transitions.length > 0 && <div className="mt-1"><Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Change</Button></div>}
                  </Td>
                  <Td className="max-w-[14rem] text-xs">{r.latestRemark ? <>{r.latestRemark}{r.remarkCount > 1 && <div className="text-muted">+{r.remarkCount - 1} more</div>}</> : '—'}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(r.lastUpdated)}</Td>
                  <Td><Link className="whitespace-nowrap text-sm font-medium text-brand-700 hover:underline" href={`/applications/${r.applicationId}`}>Open profile</Link></Td>
                </tr>
              ))}
            </Table>
            <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </>
        )}
      </Loaded>
      {editing && <StatusModal row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); state.reload(); onChanged(); }} />}
    </div>
  );
}

export default function CvBankPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState<Filters>({ departmentId: '', vacancyId: '', q: '', status: '' });
  const [search, setSearch] = useState('');
  const [openDept, setOpenDept] = useState<Set<string>>(new Set());
  const [openVac, setOpenVac] = useState<Set<string>>(new Set());
  const allowed = can(P.CANDIDATE_VIEW);

  // Debounce free-text search so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() })), 350);
    return () => clearTimeout(t);
  }, [search]);

  const lookups = useLoad(() => (allowed ? api('/master/lookups') : Promise.resolve(null)), [allowed]);
  const tree = useLoad(() => (allowed ? api(`/cv-bank/tree${qs(filters)}`) : Promise.resolve(null)), [allowed, filters]);
  const filtered = !!(filters.q || filters.status || filters.vacancyId);

  // When filtering, open every department/vacancy that has matches so results are visible at once.
  useEffect(() => {
    if (!tree.data || !filtered) return;
    const ds = tree.data.departments.filter((d: any) => d.matching > 0);
    setOpenDept(new Set(ds.map((d: any) => d.id)));
    setOpenVac(new Set(ds.flatMap((d: any) => d.vacancies.filter((v: any) => v.matching > 0 && (!filters.vacancyId || v.id === filters.vacancyId)).map((v: any) => v.id))));
  }, [tree.data, filtered, filters.vacancyId]);

  const vacancyOptions = useMemo(() => (tree.data?.departments ?? [])
    .filter((d: any) => !filters.departmentId || d.id === filters.departmentId)
    .flatMap((d: any) => d.vacancies.map((v: any) => ({ value: v.id, label: `${v.vacancyNo} — ${v.positionTitle}` }))), [tree.data, filters.departmentId]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n); };
  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  if (!allowed) {
    return (<><PageHeader title="All CVs / Candidate CV Bank" /><Alert>You do not have permission to view candidate CVs.</Alert></>);
  }

  const departments = (tree.data?.departments ?? []).filter((d: any) => !filtered || d.matching > 0)
    .map((d: any) => ({ ...d, vacancies: d.vacancies.filter((v: any) => (!filters.vacancyId || v.id === filters.vacancyId) && (!filtered || v.matching > 0)) }));

  return (
    <>
      <PageHeader title="All CVs / Candidate CV Bank" subtitle="Every candidate application, organised department → vacancy → candidate. Each application keeps its own screening result, status, remarks and history." />
      <Card pad={false} className="mb-4">
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Department">
            <Select value={filters.departmentId} placeholder="All departments" onChange={(e) => setF({ departmentId: e.target.value, vacancyId: '' })}
              options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />
          </Field>
          <Field label="Vacancy">
            <Select value={filters.vacancyId} placeholder="All vacancies" onChange={(e) => setF({ vacancyId: e.target.value })} options={vacancyOptions} />
          </Field>
          <Field label="Candidate name, Candidate ID or Application ID">
            <Input value={search} placeholder="e.g. Rahim, CAND-000001, APP-2026-000001" onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Application status">
            <Select value={filters.status} placeholder="All statuses" onChange={(e) => setF({ status: e.target.value })} options={STATUSES.map((s) => ({ value: s, label: s }))} />
          </Field>
        </div>
        {(filtered || filters.departmentId) && (
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
            <span>{departments.reduce((s: number, d: any) => s + d.matching, 0)} matching application(s)</span>
            <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setFilters({ departmentId: '', vacancyId: '', q: '', status: '' }); }}>Clear filters</Button>
          </div>
        )}
      </Card>

      <Loaded state={tree} empty={() => !departments.length && (filtered ? 'No candidate applications match these filters.' : 'No departments found.')}>
        {() => (
          <div className="space-y-3">
            {departments.map((d: any) => {
              const open = openDept.has(d.id);
              return (
                <Card key={d.id} pad={false}>
                  <button className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50" aria-expanded={open} onClick={() => toggle(openDept, setOpenDept, d.id)}>
                    <span className="flex items-center gap-2 font-semibold"><span className={cx('inline-block w-3 text-muted transition', open && 'rotate-90')}>›</span>{d.name}</span>
                    <span className="text-xs text-muted">{d.vacancies.length} vacanc{d.vacancies.length === 1 ? 'y' : 'ies'} · {filtered ? `${d.matching} of ${d.total}` : d.total} candidate application{d.total === 1 ? '' : 's'}</span>
                  </button>
                  {open && (
                    <div className="border-t border-line">
                      {!d.vacancies.length ? <div className="p-4"><Empty>No vacancies in this department.</Empty></div> : d.vacancies.map((v: any) => {
                        const vOpen = openVac.has(v.id);
                        return (
                          <div key={v.id} className="border-b border-line last:border-b-0">
                            <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 pl-8 text-left text-sm hover:bg-slate-50" aria-expanded={vOpen} onClick={() => toggle(openVac, setOpenVac, v.id)}>
                              <span className={cx('inline-block w-3 text-muted transition', vOpen && 'rotate-90')}>›</span>
                              <span className="font-medium text-brand-700">{v.vacancyNo}</span>
                              <span>{v.positionTitle}</span>
                              <span className="text-xs text-muted">{v.companyCode} · headcount {v.headcount}</span>
                              <Badge>{v.status}</Badge>
                              <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{filtered ? `${v.matching} / ${v.total}` : v.total} candidate{v.total === 1 ? '' : 's'}</span>
                            </button>
                            {vOpen && <VacancyCandidates vacancy={v} filters={filters} onChanged={tree.reload} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Loaded>
    </>
  );
}
