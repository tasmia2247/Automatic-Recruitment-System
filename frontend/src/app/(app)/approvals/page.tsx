'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DecisionDialog } from '@/components/RequisitionDetail';
import { Alert, Badge, Button, Card, Empty, Loaded, PageHeader, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, fmtDate, fmtDateTime, reqStatusLabel } from '@/lib/api';

type Pick = { kind: 'approve' | 'reject'; actionId: string; requisition: any; onBehalf: boolean; step: string };

export default function ApprovalsPage() {
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const state = useLoad(() => api(`/approvals/inbox?decisions=${order}`), [order]);
  const [pick, setPick] = useState<Pick | null>(null);
  const act = useAction();

  // Approve / Reject straight from the inbox (owner, 2026-11-08), with the same dialog, comment and optional document as the requisition page.
  const decide = async (reason: string, file: File | null) => {
    if (!pick) return;
    const form = new FormData();
    form.append('actionId', pick.actionId);
    if (pick.kind === 'approve') { if (reason) form.append('remarks', reason); } else form.append('reason', reason);
    if (file) form.append('file', file);
    const no = pick.requisition.reqNo;
    const r = await act.run(() => api(`/requisitions/${pick.requisition.id}/${pick.kind}`, { form }), pick.kind === 'approve' ? `${no} approved.` : `${no} rejected.`);
    if (r) { setPick(null); state.reload(); }
  };
  const buttons = (p: any, onBehalf: boolean, step: string) => (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => setPick({ kind: 'approve', actionId: p.actionId, requisition: p.requisition, onBehalf, step })}>Approve</Button>
      <Button size="sm" variant="danger" onClick={() => setPick({ kind: 'reject', actionId: p.actionId, requisition: p.requisition, onBehalf, step })}>Reject</Button>
    </div>
  );

  return (
    <>
      <PageHeader title="Approver inbox" subtitle="Requisitions waiting for your decision at your assigned step. You act with your own named account." />
      {!pick && act.message && <div className="mb-3"><Alert tone="success">{act.message}</Alert></div>}
      <Loaded state={state}>
        {(d: any) => (
          <div className="space-y-4">
            {d.all && (
              <Card title={`All pending approvals — every department (${d.all.length})`} pad={false}>
                <div className="px-4 pt-3 text-xs text-muted">Every submitted requisition still in approval. Your approval is final: it approves the requisition and sends it to the HR Approved Queue. Open a requisition to read the form or return it for clarification.</div>
                {d.all.length ? (
                  <Table head={['Requisition', 'Step', 'Department', 'Company', 'Rank', 'How many', 'Requester', 'Submitted', '']}>
                    {d.all.map((p: any) => (
                      <tr key={p.actionId} className="hover:bg-slate-50">
                        <Td><Link className="font-medium text-brand-700 hover:underline" href={`/approvals/${p.requisition.id}`}>{p.requisition.reqNo}</Link></Td>
                        <Td className="whitespace-nowrap">{p.stepOrder} of {p.totalSteps}</Td>
                        <Td>{p.requisition.department?.name}</Td>
                        <Td>{p.requisition.company?.code}</Td>
                        <Td>{p.requisition.rank}</Td>
                        <Td>{p.requisition.headcount}</Td>
                        <Td>{p.requisition.requester?.name}</Td>
                        <Td className="whitespace-nowrap">{fmtDate(p.requisition.submittedAt)}</Td>
                        <Td>{buttons(p, true, `approval step ${p.stepOrder} of ${p.totalSteps}`)}</Td>
                      </tr>
                    ))}
                  </Table>
                ) : <div className="p-4"><Empty>No requisition is pending approval.</Empty></div>}
              </Card>
            )}
            {(!d.all || d.pending.length > 0) && (
              <Card title={`Waiting for your decision (${d.pending.length})`} pad={false}>
                {d.pending.length ? (
                  <Table head={['Requisition', 'Your step', 'Department', 'Company', 'Rank', 'How many', 'Replace', 'Requester', 'Submitted', '']}>
                    {d.pending.map((p: any) => (
                      <tr key={p.actionId} className="hover:bg-slate-50">
                        <Td><Link className="font-medium text-brand-700 hover:underline" href={`/approvals/${p.requisition.id}`}>{p.requisition.reqNo}</Link></Td>
                        <Td>{p.stepOrder}. {p.stepLabel}</Td>
                        <Td>{p.requisition.department?.name}</Td>
                        <Td>{p.requisition.company?.code}</Td>
                        <Td>{p.requisition.rank}</Td>
                        <Td>{p.requisition.headcount}</Td>
                        <Td>{p.requisition.replacePlan ? <Badge tone="amber">Replacement</Badge> : 'No'}</Td>
                        <Td>{p.requisition.requester?.name}</Td>
                        <Td className="whitespace-nowrap">{fmtDate(p.requisition.submittedAt)}</Td>
                        <Td>{buttons(p, false, `your step (${p.stepLabel})`)}</Td>
                      </tr>
                    ))}
                  </Table>
                ) : <div className="p-4"><Empty>Nothing is waiting for your approval.</Empty></div>}
              </Card>
            )}
            {!!d.upcoming.length && (
              <Card title={`Coming to you next (${d.upcoming.length})`} pad={false}>
                <div className="px-4 pt-3 text-xs text-muted">Still with an earlier approver. You can open them now and act when your step is reached.</div>
                <Table head={['Requisition', 'Your step', 'Department', 'Rank', 'How many', 'Now with', 'Submitted']}>
                  {d.upcoming.map((p: any) => (
                    <tr key={p.actionId} className="hover:bg-slate-50">
                      <Td><Link className="font-medium text-brand-700 hover:underline" href={`/approvals/${p.requisition.id}`}>{p.requisition.reqNo}</Link></Td>
                      <Td>{p.stepOrder}. {p.stepLabel}</Td>
                      <Td>{p.requisition.department?.name}</Td>
                      <Td>{p.requisition.rank}</Td>
                      <Td>{p.requisition.headcount}</Td>
                      <Td className="text-xs">{p.currentApprover ? <>{p.currentApprover.name}<div className="text-muted">{p.currentApprover.step}</div></> : '—'}</Td>
                      <Td className="whitespace-nowrap">{fmtDate(p.requisition.submittedAt)}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
            {(!d.all || d.history.length > 0) && (
              <Card title="My recent decisions" pad={false}
                actions={d.history.length > 1 && <Select className="w-44" value={order} onChange={(e) => setOrder(e.target.value as 'desc' | 'asc')}
                  options={[{ value: 'desc', label: 'Newest first' }, { value: 'asc', label: 'Oldest first' }]} />}>
                {d.history.length ? (
                  <Table head={['Requisition', 'Step', 'My decision', 'Remarks', 'When', 'Current status']}>
                    {d.history.map((h: any) => (
                      <tr key={h.actionId}>
                        <Td><Link className="text-brand-700 hover:underline" href={`/requisitions/${h.requisition.id}`}>{h.requisition.reqNo}</Link> <span className="text-xs text-muted">{h.requisition.rank}</span></Td>
                        <Td>{h.stepLabel}</Td>
                        <Td><Badge>{h.status}</Badge></Td>
                        <Td className="max-w-xs text-xs">{h.remarks ?? '—'}</Td>
                        <Td className="whitespace-nowrap text-xs">{fmtDateTime(h.decidedAt)}</Td>
                        <Td><Badge>{reqStatusLabel(h.requisition.status)}</Badge></Td>
                      </tr>
                    ))}
                  </Table>
                ) : <div className="p-4"><Empty>No decisions yet.</Empty></div>}
              </Card>
            )}
          </div>
        )}
      </Loaded>

      {pick && (() => {
        const no = pick.requisition.reqNo;
        const common = { busy: act.busy, error: act.error, onClose: () => setPick(null), onConfirm: decide };
        return pick.kind === 'approve'
          ? <DecisionDialog {...common} open title="Approve requisition" confirmLabel="Approve" reasonLabel="Remarks (optional)"
              message={pick.onBehalf ? `You are giving the final approval for ${no}. It becomes Approved and moves to the HR Approved Queue.` : `You are approving ${no} at ${pick.step}.`} />
          : <DecisionDialog {...common} open title="Reject requisition" confirmLabel="Reject" danger requireReason reasonLabel="Reason for rejection"
              message={`Rejecting ${no} at ${pick.step}. Rejection stops the approval route; the requisition cannot become a vacancy.`} />;
      })()}
    </>
  );
}
