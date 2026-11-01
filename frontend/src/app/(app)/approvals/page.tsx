'use client';

import Link from 'next/link';
import { Badge, Card, Empty, LinkButton, Loaded, PageHeader, Table, Td, useLoad } from '@/components/ui';
import { api, fmtDate, fmtDateTime, reqStatusLabel } from '@/lib/api';

export default function ApprovalsPage() {
  const state = useLoad(() => api('/approvals/inbox'));
  return (
    <>
      <PageHeader title="Approver inbox" subtitle="Requisitions waiting for your decision at your assigned step. You act with your own named account." />
      <Loaded state={state}>
        {(d: any) => (
          <div className="space-y-4">
            {d.all && (
              <Card title={`All pending approvals — every department (${d.all.length})`} pad={false}>
                <div className="px-4 pt-3 text-xs text-muted">Every submitted requisition still in approval. Your approval is final: it approves the requisition and sends it to the HR Approved Queue.</div>
                {d.all.length ? (
                  <Table head={['Requisition', 'Step', 'Department', 'Company', 'Rank', 'How many', 'Requester', 'Submitted', '']}>
                    {d.all.map((p: any) => (
                      <tr key={p.actionId} className="hover:bg-slate-50">
                        <Td><Link className="font-medium text-brand-700 hover:underline" href={`/requisitions/${p.requisition.id}`}>{p.requisition.reqNo}</Link></Td>
                        <Td className="whitespace-nowrap">{p.stepOrder} of {p.totalSteps}</Td>
                        <Td>{p.requisition.department?.name}</Td>
                        <Td>{p.requisition.company?.code}</Td>
                        <Td>{p.requisition.rank}</Td>
                        <Td>{p.requisition.headcount}</Td>
                        <Td>{p.requisition.requester?.name}</Td>
                        <Td className="whitespace-nowrap">{fmtDate(p.requisition.submittedAt)}</Td>
                        <Td><LinkButton variant="primary" href={`/requisitions/${p.requisition.id}`}>Approve</LinkButton></Td>
                      </tr>
                    ))}
                  </Table>
                ) : <div className="p-4"><Empty>No requisition is pending approval.</Empty></div>}
              </Card>
            )}
            {(!d.all || d.pending.length > 0) && (
              <Card title={`Waiting for your decision (${d.pending.length})`} pad={false}>
                {d.pending.length ? (
                  <Table head={['Requisition', 'Your step', 'Department', 'Company', 'Rank', 'How many', 'Replace', 'Requester', 'Submitted']}>
                    {d.pending.map((p: any) => (
                      <tr key={p.actionId} className="hover:bg-slate-50">
                        <Td><Link className="font-medium text-brand-700 hover:underline" href={`/requisitions/${p.requisition.id}`}>{p.requisition.reqNo}</Link></Td>
                        <Td>{p.stepOrder}. {p.stepLabel}</Td>
                        <Td>{p.requisition.department?.name}</Td>
                        <Td>{p.requisition.company?.code}</Td>
                        <Td>{p.requisition.rank}</Td>
                        <Td>{p.requisition.headcount}</Td>
                        <Td>{p.requisition.replacePlan ? <Badge tone="amber">Replacement</Badge> : 'No'}</Td>
                        <Td>{p.requisition.requester?.name}</Td>
                        <Td className="whitespace-nowrap">{fmtDate(p.requisition.submittedAt)}</Td>
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
                      <Td><Link className="font-medium text-brand-700 hover:underline" href={`/requisitions/${p.requisition.id}`}>{p.requisition.reqNo}</Link></Td>
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
              <Card title="My recent decisions" pad={false}>
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
    </>
  );
}
