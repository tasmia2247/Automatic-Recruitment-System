'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DeleteRequisitionDialog } from '@/components/DeleteRequisitionDialog';
import { Alert, Badge, Button, Card, Input, LinkButton, Loaded, PageHeader, Pager, Select, Table, Td, useLoad } from '@/components/ui';
import { api, fmtDate, qs, reqStatusLabel, show } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const STATUSES = ['Draft', 'Pending Approval', 'Returned for Clarification', 'Rejected', 'Sent to HR', 'Cancelled'];

function List() {
  const { can, scopes } = useAuth();
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [view, setView] = useState<'all' | 'mine'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const state = useLoad(() => api(`/requisitions${qs({ status, view, q, page, pageSize: 25 })}`), [status, view, q, page]);
  // Delete is for the Super Admin only (`requisition.manage_all`, owner 2026-11-08); the API enforces it.
  const canDelete = can(P.REQ_MANAGE_ALL);
  const [toDelete, setToDelete] = useState<any | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Manpower requisitions" subtitle={scopes.requisitions === null ? 'Form No. 01 requests of all departments and their approval status.' : (scopes.requisitions?.length ?? 0) > 1 ? 'Form No. 01 requests of your departments and their approval status.' : 'Form No. 01 requests of your department and their approval status.'}
        actions={can(P.REQ_CREATE) && <LinkButton variant="primary" href="/requisitions/new">New requisition</LinkButton>} />
      {message && <div className="mb-3"><Alert tone="success">{message}</Alert></div>}
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search ID or rank…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: s }))} />
          <Select className="max-w-[10rem]" value={view} onChange={(e) => setView(e.target.value as any)} options={[{ value: 'all', label: 'All visible' }, { value: 'mine', label: 'Created by me' }]} />
        </div>
        <Loaded state={state} empty={(d: any) => !d.items.length && 'No requisitions match these filters.'}>
          {(d: any) => (
            <>
              <Table head={['Requisition', 'Date', 'Department', 'Company', 'Rank', 'How many', 'Replace', 'Status', 'Current approver', ...(canDelete ? [''] : [])]}>
                {d.items.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" href={`/requisitions/${r.id}`}>{r.reqNo ?? 'Draft'}</Link></Td>
                    <Td className="whitespace-nowrap">{fmtDate(r.requestDate)}</Td>
                    <Td>{r.department?.name}</Td>
                    <Td>{r.company?.code}</Td>
                    <Td>{show(r.rank)}</Td>
                    <Td className="tabular-nums">{show(r.headcount)}</Td>
                    <Td>{r.replacePlan ? 'Yes' : 'No'}</Td>
                    <Td><Badge>{reqStatusLabel(r.status)}</Badge>{reqStatusLabel(r.status) !== r.status && <div className="mt-0.5 text-[11px] text-muted">{r.status}</div>}</Td>
                    <Td className="text-xs">{r.currentApprover ? <>{r.currentApprover.name}<div className="text-muted">{r.currentApprover.step}</div></> : '—'}</Td>
                    {canDelete && <Td><Button size="sm" variant="danger" onClick={() => { setMessage(null); setToDelete(r); }}>Delete</Button></Td>}
                  </tr>
                ))}
              </Table>
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </Loaded>
      </Card>

      <DeleteRequisitionDialog requisition={toDelete} onClose={() => setToDelete(null)} onDeleted={(m) => { setToDelete(null); setMessage(m); state.reload(); }} />
    </>
  );
}

export default function RequisitionsPage() {
  return <Suspense><List /></Suspense>;
}
