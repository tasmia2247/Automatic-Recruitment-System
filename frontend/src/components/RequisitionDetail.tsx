'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormView } from '@/components/FormView';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, LinkButton, Loaded, Modal, PageHeader, Select, Table, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, approvalStep, fmtDateTime, reqStatusLabel } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

type Dialog = null | 'approve' | 'reject' | 'return' | 'cancel';

/**
 * A requisition. In the requisition module it is read-only for approvers: decisions are taken only from the Approver inbox
 * (`inbox`, route /approvals/[id]) (owner, 2026-11-05).
 */
export function RequisitionDetail({ inbox = false }: { inbox?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, user } = useAuth();
  const state = useLoad(() => api(`/requisitions/${id}`), [id]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const act = useAction();
  const [corp, setCorp] = useState<{ remarks?: string; chart?: string }>({});

  const decide = async (kind: Exclude<Dialog, null>, reason: string, file?: File | null, actionId?: string) => {
    const path = { approve: 'approve', reject: 'reject', return: 'return', cancel: 'cancel' }[kind];
    const fields: Record<string, string | undefined> = kind === 'approve' ? { remarks: reason || undefined } : { reason };
    if (actionId) fields.actionId = actionId;
    // Approval decisions go as multipart so a supporting document can travel with them.
    const form = kind === 'cancel' ? undefined : new FormData();
    if (form) {
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, v);
      if (file) form.append('file', file);
    }
    const r = await act.run(() => api(`/requisitions/${id}/${path}`, form ? { form } : { body: fields }), {
      approve: 'Approved.', reject: 'Requisition rejected.', return: 'Returned to requester for clarification.', cancel: 'Requisition cancelled.',
    }[kind]);
    if (r) { setDialog(null); state.reload(); }
  };

  const createVacancy = async () => {
    const r = await act.run(() => api(`/hr-queue/${id}/vacancy`, { method: 'POST' }));
    if (r) router.push(`/vacancies/${r.vacancy.id}`);
  };

  const saveCorp = async (r: any) => {
    const body: any = {};
    if (corp.remarks !== undefined) body.corporateHrRemarks = corp.remarks;
    if (corp.chart) body.insertedInQuotaChart = corp.chart;
    const ok = await act.run(() => api(`/requisitions/${id}/corporate-hr`, { body }), 'Corporate HR details saved.');
    if (ok) { setCorp({}); state.reload(); }
  };

  return (
    <Loaded state={state}>
      {(r: any) => {
        const versions = [...new Set<number>(r.approvals.map((a: any) => a.version))].sort((a, b) => b - a);
        const cancellable = ['Draft', 'Returned for Clarification', 'Pending Approval'].includes(r.status) && (r.requester?.id === user?.id || can(P.APPROVAL_ROUTE_CONFIGURE));
        return (
          <>
            <PageHeader back={inbox ? { href: '/approvals', label: 'Approver inbox' } : { href: '/requisitions', label: 'Requisitions' }}
              title={<span className="flex items-center gap-3">{r.reqNo ?? 'Draft requisition'} <Badge>{reqStatusLabel(r.status)}</Badge>{reqStatusLabel(r.status) !== r.status && <span className="text-xs font-normal text-muted">{r.status}</span>}</span>}
              subtitle={`${r.rank ?? '—'} × ${r.headcount ?? '—'} · ${r.department?.name} · ${r.company?.name}`}
              actions={<>
                <LinkButton href={`/requisitions/${id}/print`}>Print / PDF</LinkButton>
                {!inbox && r.canEdit && <LinkButton variant="primary" href={`/requisitions/${id}/edit`}>{r.status === 'Draft' ? 'Edit & submit' : 'Edit & resubmit'}</LinkButton>}
                {!inbox && cancellable && <Button variant="danger" onClick={() => setDialog('cancel')}>Cancel requisition</Button>}
              </>} />

            <div className="mb-4 space-y-2">
              <Alert>{act.error}</Alert>
              <Alert tone="success">{act.message}</Alert>
              {r.status === 'Returned for Clarification' && <Alert tone="warning">Returned for clarification: {r.approvals.find((a: any) => a.status === 'Returned' && a.version === r.version)?.remarks}</Alert>}
              {r.status === 'Rejected' && <Alert>Rejected: {r.approvals.find((a: any) => a.status === 'Rejected')?.remarks}. A new requisition can be raised if the position is still needed.</Alert>}
              {r.status === 'Cancelled' && <Alert tone="info">Cancelled: {r.cancelReason}</Alert>}
              {r.canEdit && Object.keys(r.submitErrors ?? {}).length > 0 && <Alert tone="warning">Before submitting, complete: {Object.values(r.submitErrors).join(' ')}</Alert>}
            </div>

            {!inbox && r.canAct && (
              <div className="mb-4"><Alert tone="info">This requisition is waiting for your decision. Approve, return or reject it from the{' '}
                <Link className="font-medium text-brand-700 hover:underline" href={`/approvals/${id}`}>Approver inbox</Link>.</Alert></div>
            )}
            {inbox && !r.canAct && <div className="mb-4"><Alert tone="info">Nothing is waiting for your decision on this requisition now.</Alert></div>}
            {inbox && r.canAct && (
              <Card className="mb-4 border-amber-300" title={r.currentAction.onBehalf ? 'Final approval' : 'Your approval is required'}>
                <p className="mb-3 text-sm text-muted">
                  {r.currentAction.onBehalf
                    ? <>Your approval is sufficient: approving completes the approval route and sends the requisition to the HR Approved Queue. </>
                    : null}
                  Review the form, attachments and history below, then record your decision. Reject and Return require a comment; you can attach a supporting document to any decision.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setDialog('approve')}>Approve</Button>
                  <Button variant="secondary" onClick={() => setDialog('return')}>Return for clarification</Button>
                  <Button variant="danger" onClick={() => setDialog('reject')}>Reject</Button>
                </div>
              </Card>
            )}

            {!inbox && r.status === 'Sent to HR' && can(P.HR_QUEUE) && (
              <Card className="mb-4" title="HR recruitment">
                {r.vacancy ? (
                  <p className="text-sm">Vacancy <Link className="font-medium text-brand-700 hover:underline" href={`/vacancies/${r.vacancy.id}`}>{r.vacancy.vacancyNo}</Link> <Badge>{r.vacancy.status}</Badge></p>
                ) : can(P.VACANCY_CREATE) ? (
                  <div className="flex items-center gap-3"><span className="text-sm text-muted">All mandatory approvals are complete.</span><Button busy={act.busy} onClick={createVacancy}>Create vacancy</Button></div>
                ) : <p className="text-sm text-muted">Awaiting HR vacancy creation.</p>}
              </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2" title="Form No. 01">
                <FormView r={r} />
                {r.attachments?.length > 0 && (
                  <div className="mt-5 border-t border-line pt-3">
                    <div className="mb-1 text-xs font-semibold text-muted">Attachments</div>
                    <ul className="space-y-1 text-sm">{r.attachments.map((a: any) => <li key={a.id}><a className="text-brand-700 hover:underline" target="_blank" href={`/api/requisitions/${id}/attachments/${a.id}`}>{a.originalName}</a> <span className="text-xs text-muted">({a.kind.replace('_', ' ').toLowerCase()})</span></li>)}</ul>
                  </div>
                )}
              </Card>
              <div className="space-y-4">
                <Card title="Approval history">
                  {!versions.length ? <p className="text-sm text-muted">Not submitted yet.</p> : versions.map((v) => (
                    <div key={v} className="mb-4 last:mb-0">
                      <div className="mb-1 text-xs font-semibold text-muted">Submission version {v}{v === r.version ? ' (current)' : ''}</div>
                      <ol className="space-y-2">
                        {r.approvals.filter((a: any) => a.version === v).map((a: any) => { const s = approvalStep(a, r.approvals); return (
                          <li key={a.id} className="rounded border border-line p-2 text-sm">
                            <div className="flex items-center justify-between gap-2"><span className="font-medium">{a.stepOrder}. {a.stepLabel}</span><Badge>{s.status}</Badge></div>
                            <div className="text-xs text-muted">{a.approver.name}{a.actedBy ? ` · recorded by ${a.actedBy.name} on behalf` : ''}{s.decidedAt ? ` · ${fmtDateTime(s.decidedAt)}` : ''}{a.carriedOver ? ' · carried forward' : ''}</div>
                            {s.note && <div className="mt-1 text-xs italic">“{s.note}”</div>}
                            {a.documents?.map((doc: any) => (
                              <a key={doc.id} className="mt-1 block text-xs text-brand-700 hover:underline" target="_blank" href={`/api/requisitions/${id}/attachments/${doc.id}`}>📎 {doc.originalName}</a>
                            ))}
                          </li>
                        ); })}
                      </ol>
                    </div>
                  ))}
                </Card>
                {!inbox && (can(P.REQ_CORPORATE_HR) || can(P.REQ_QUOTA_CHART)) && r.status !== 'Draft' && (
                  <Card title="Corporate HR">
                    <div className="space-y-3">
                      {can(P.REQ_CORPORATE_HR) && <Field label="Remarks and notes of the corporate HR"><Textarea value={corp.remarks ?? r.corporateHrRemarks ?? ''} onChange={(e) => setCorp({ ...corp, remarks: e.target.value })} /></Field>}
                      {can(P.REQ_QUOTA_CHART) && (
                        <Field label="Inserted in quota chart?" hint={r.status !== 'Sent to HR' ? '"Yes" is available after all approvals are complete; it applies the revised quota.' : 'Choosing "Yes" applies the approved revised quota to the quota list.'}>
                          <Select value={corp.chart ?? r.insertedInQuotaChart ?? ''} placeholder="Not set" onChange={(e) => setCorp({ ...corp, chart: e.target.value })}
                            options={['Yes', 'No', 'Not Applicable'].map((v) => ({ value: v, label: v }))} />
                        </Field>
                      )}
                      <Button size="sm" busy={act.busy} disabled={corp.remarks === undefined && !corp.chart} onClick={() => saveCorp(r)}>Save</Button>
                    </div>
                  </Card>
                )}
              </div>
            </div>

            {inbox && r.currentAction && (() => {
              const step = r.currentAction.onBehalf
                ? `approval step ${r.currentAction.stepOrder} of ${r.currentAction.totalSteps}`
                : `your step (${r.currentAction.stepLabel})`;
              const common = { busy: act.busy, error: act.error, onClose: () => setDialog(null) };
              const go = (kind: 'approve' | 'return' | 'reject') => (reason: string, file: File | null) => decide(kind, reason, file, r.currentAction.id);
              return <>
                <DecisionDialog {...common} open={dialog === 'approve'} title="Approve requisition" confirmLabel="Approve"
                  message={r.currentAction.onBehalf ? `You are giving the final approval for ${r.reqNo}. It becomes Approved and moves to the HR Approved Queue.` : `You are approving ${r.reqNo} at ${step}.`} reasonLabel="Remarks (optional)" onConfirm={go('approve')} />
                <DecisionDialog {...common} open={dialog === 'return'} title="Return for clarification" confirmLabel="Return to requester"
                  message={`Returning ${r.reqNo} at ${step}.`} requireReason reasonLabel="What needs clarification?" onConfirm={go('return')} />
                <DecisionDialog {...common} open={dialog === 'reject'} title="Reject requisition" confirmLabel="Reject" danger
                  message={`Rejecting ${r.reqNo} at ${step}. Rejection stops the approval route; the requisition cannot become a vacancy.`} requireReason reasonLabel="Reason for rejection" onConfirm={go('reject')} />
              </>;
            })()}
            <ConfirmDialog open={dialog === 'cancel'} title="Cancel requisition" confirmLabel="Cancel requisition" danger busy={act.busy} error={act.error}
              requireReason reasonLabel="Reason for cancellation" onConfirm={(x) => decide('cancel', x)} onClose={() => setDialog(null)} />
          </>
        );
      }}
    </Loaded>
  );
}

/** Approve / return / reject with a comment and an optional supporting document (signed note, email, minutes). */
function DecisionDialog({ open, title, message, confirmLabel, danger, requireReason, reasonLabel, busy, error, onConfirm, onClose }: {
  open: boolean; title: string; message: string; confirmLabel: string; danger?: boolean; requireReason?: boolean; reasonLabel: string;
  busy?: boolean; error?: string | null; onConfirm: (reason: string, file: File | null) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (open) { setReason(''); setFile(null); } }, [open]);
  return (
    <Modal open={open} title={title} onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Back</Button>
      <Button variant={danger ? 'danger' : 'primary'} busy={busy} disabled={requireReason && reason.trim().length < 3} onClick={() => onConfirm(reason.trim(), file)}>{confirmLabel}</Button>
    </>}>
      <div className="space-y-3">
        <div className="text-sm text-ink">{message}</div>
        <Field label={reasonLabel} required={requireReason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <Field label="Supporting document (optional)" hint="PDF, Word or image, up to the upload size limit.">
          <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-slate-50"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Alert>{error}</Alert>
      </div>
    </Modal>
  );
}
