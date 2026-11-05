'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, Input, Loaded, Modal, Pager, Select, Table, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

export const STATUSES = ['Received', 'Screening', 'Pass', 'Fail', 'Review Required', 'Shortlisted', 'Interview', 'Selected', 'Not Selected', 'On Hold', 'Joined', 'Rejected'];

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

/** CV applications for a vacancy, or across every vacancy when searching. Each row keeps its own status. */
export function CandidateTable({ vacancyId, q, status, showVacancy = false, onChanged }: { vacancyId?: string; q: string; status: string; showVacancy?: boolean; onChanged?: () => void }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [vacancyId, q, status]);
  const state = useLoad(() => api(`/cv-bank/applications${qs({ vacancyId, q, status, page, pageSize: 25 })}`), [vacancyId, q, status, page]);
  const [editing, setEditing] = useState<any | null>(null);
  const head = ['Candidate', 'Application ID', ...(showVacancy ? ['Department · Company', 'Vacancy / position'] : []), 'CV', 'Criteria met', 'Screening', 'Status', 'Remarks', 'Last updated', ''];
  return (
    <>
      <Loaded state={state} empty={(d: any) => !d.items.length && (q || status ? 'No candidates match these filters.' : 'No CVs have been received for this vacancy yet.')}>
        {(d: any) => (
          <>
            <Table head={head}>
              {d.items.map((r: any) => (
                <tr key={r.applicationId} className="bg-white hover:bg-slate-50">
                  <Td><div className="font-medium">{r.name ?? <i className="text-amber-700">Name needs review</i>}</div><div className="text-xs text-muted">{r.candidateNo}</div></Td>
                  <Td className="whitespace-nowrap text-xs">{r.applicationNo}{r.duplicateReview === 'PENDING' && <div><Badge tone="amber">Possible duplicate</Badge></div>}</Td>
                  {showVacancy && <Td className="text-xs">{r.department}<div className="text-muted">{r.company}</div></Td>}
                  {showVacancy && <Td className="text-xs">{r.positionTitle}<div className="text-muted">{r.vacancyNo}</div></Td>}
                  <Td className="whitespace-nowrap text-xs">
                    {!r.documentId ? '—' : can(P.CV_DOWNLOAD) ? (
                      <div className="flex flex-col gap-0.5">
                        <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`/api/documents/${r.documentId}`}>Preview</a>
                        <a className="text-brand-700 hover:underline" href={`/api/documents/${r.documentId}?download=1`}>Download</a>
                      </div>
                    ) : <span className="text-muted">No access</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs tabular-nums">{r.criteriaTotal ? <>{r.criteriaMet} / {r.criteriaTotal}<div className="text-muted">{r.screeningBasis === 'REQUISITION' || r.screeningBasis === 'VACANCY' ? 'requirements' : `criteria v${r.criteriaVersion}`}</div></> : '—'}</Td>
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
      {editing && <StatusModal row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); state.reload(); onChanged?.(); }} />}
    </>
  );
}

/** Search box and status filter; typing waits briefly so each keystroke does not send a request. */
export function CandidateFilters({ onChange, searchLabel }: { onChange: (f: { q: string; status: string }) => void; searchLabel: string }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const t = setTimeout(() => onChange({ q: search.trim(), status }), 350);
    return () => clearTimeout(t);
  }, [search, status]);
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2">
      <Field label={searchLabel}>
        <Input value={search} placeholder="e.g. Rahim, CAND-000001, APP-2026-000001" onChange={(e) => setSearch(e.target.value)} />
      </Field>
      <Field label="Application status">
        <Select value={status} placeholder="All statuses" onChange={(e) => setStatus(e.target.value)} options={STATUSES.map((s) => ({ value: s, label: s }))} />
      </Field>
    </div>
  );
}
