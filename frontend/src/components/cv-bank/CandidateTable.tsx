'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, ConfirmDialog, cx, Field, Input, Loaded, Modal, Pager, ScoreBar, Select, Table, Td, Textarea, useAction, useLoad } from '@/components/ui';
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
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const del = useAction();
  useEffect(() => setSelected({}), [vacancyId, q, status, page]);
  const canDelete = can(P.CANDIDATE_DELETE);
  const selectedIds = Object.keys(selected);
  const head = [...(canDelete ? [''] : []), 'Candidate', 'Application ID', ...(showVacancy ? ['Department · Company', 'Vacancy / position'] : []), 'CV', 'Criteria met', 'Screening', 'Status', 'Remarks', 'Last updated', ''];
  const toggle = (id: string) => setSelected((s) => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const doDelete = async (reason: string) => {
    const r = await del.run(
      () => api('/cv-bank/applications/delete', { body: { ids: selectedIds, reason: reason || undefined } }),
      `${selectedIds.length} CV${selectedIds.length === 1 ? '' : 's'} deleted permanently.`,
    );
    if (r) { setConfirmingDelete(false); setSelected({}); state.reload(); onChanged?.(); }
  };
  return (
    <>
      {canDelete && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="text-xs text-muted">
            {selectedIds.length ? <><b className="text-ink">{selectedIds.length}</b> selected on this page</> : 'Tick rows to delete CVs permanently. Joined candidates are kept and cannot be deleted from here.'}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected({})}>Clear selection</Button>}
            <Button size="sm" variant="danger" disabled={!selectedIds.length} onClick={() => setConfirmingDelete(true)}>Delete selected</Button>
          </div>
        </div>
      )}
      {canDelete && del.message && <div className="p-3"><Alert tone="success">{del.message}</Alert></div>}
      <Loaded state={state} empty={(d: any) => !d.items.length && (q || status ? 'No candidates match these filters.' : 'No CVs have been received for this vacancy yet.')}>
        {(d: any) => {
          const canSel = (r: any) => r.status !== 'Joined';
          const sel = d.items.filter(canSel);
          const allOnPage = sel.length > 0 && sel.every((r: any) => selected[r.applicationId]);
          const toggleAll = () => setSelected((s) => {
            if (allOnPage) { const n = { ...s }; for (const r of sel) delete n[r.applicationId]; return n; }
            const n = { ...s }; for (const r of sel) n[r.applicationId] = true; return n;
          });
          return (
          <>
            <Table head={canDelete ? [<input key="all" type="checkbox" aria-label="Select all on this page" checked={allOnPage} disabled={!sel.length} onChange={toggleAll} />, ...head.slice(1)] : head}>
              {d.items.map((r: any) => (
                <tr key={r.applicationId} className={cx('bg-white hover:bg-slate-50', selected[r.applicationId] && 'bg-red-50/60 hover:bg-red-50')}>
                  {canDelete && <Td>{canSel(r)
                    ? <input type="checkbox" aria-label={`Select ${r.applicationNo}`} checked={!!selected[r.applicationId]} onChange={() => toggle(r.applicationId)} />
                    : <input type="checkbox" disabled title="Joined candidate — their records cannot be deleted from here" />}</Td>}
                  <Td><div className="font-medium">{r.name ?? <i className="text-amber-700">Name needs review</i>}</div><div className="text-xs text-muted">{r.candidateNo}</div></Td>
                  <Td className="whitespace-nowrap text-xs">{r.applicationNo}{r.duplicateReview === 'PENDING' && <div><Badge tone="amber">Possible duplicate</Badge></div>}</Td>
                  {showVacancy && <Td className="text-xs">{r.department}<div className="text-muted">{r.company}</div></Td>}
                  {showVacancy && <Td className="text-xs">{r.positionTitle}<div className="text-muted">{r.vacancyNo}</div></Td>}
                  <Td className="whitespace-nowrap text-xs">
                    {!r.documentId ? '—' : !can(P.CV_DOWNLOAD) ? <span className="text-muted">No access</span> : r.hasFile ? (
                      // Only a CV that could not be read still has its file (kept until HR enters the data).
                      <div className="flex flex-col gap-0.5">
                        <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`/api/documents/${r.documentId}`}>Preview</a>
                        <a className="text-brand-700 hover:underline" href={`/api/documents/${r.documentId}?download=1`}>Download</a>
                      </div>
                    ) : <Link className="text-brand-700 hover:underline" href={`/applications/${r.applicationId}`} title="The file is not kept; open the text read from it">CV text</Link>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs tabular-nums">{r.criteriaTotal ? <>{r.criteriaMet} / {r.criteriaTotal}<div className="text-muted">{r.screeningBasis === 'REQUISITION' || r.screeningBasis === 'VACANCY' ? 'requirements' : `criteria v${r.criteriaVersion}`}</div></> : '—'}</Td>
                  <Td>{r.screeningResult ? <Badge>{r.screeningResult}</Badge> : <span className="text-xs text-muted">{r.processingStatus === 'Failed' ? 'CV processing failed' : 'Not screened'}</span>}{r.screeningScore != null && <ScoreBar score={r.screeningScore} />}</Td>
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
          );
        }}
      </Loaded>
      {editing && <StatusModal row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); state.reload(); onChanged?.(); }} />}
      <ConfirmDialog open={confirmingDelete} danger title={`Delete ${selectedIds.length} CV${selectedIds.length === 1 ? '' : 's'}?`}
        confirmLabel="Delete permanently" requireReason={false} reasonLabel="Reason (optional)"
        busy={del.busy} error={del.error} onClose={() => setConfirmingDelete(false)} onConfirm={doDelete}
        message={<div className="space-y-2">
          <p>This permanently deletes the selected application{selectedIds.length === 1 ? '' : 's'} with their CV files, extracted data, screening runs, remarks, interview records, marks, pending joining entries and sent emails. It cannot be undone.</p>
          <p>A candidate who is left with no other application anywhere is deleted too; a candidate who also applied to another vacancy is kept.</p>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">Joined candidates are not touched. If any selected CV belongs to a candidate who has already joined anywhere, the delete is refused and the list is kept as it is.</p>
          <p className="text-muted">The Logs keep a record of the delete and your reason.</p>
        </div>} />
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
