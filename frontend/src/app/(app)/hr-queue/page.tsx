'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DeleteRequisitionDialog } from '@/components/DeleteRequisitionDialog';
import { Alert, Badge, Button, Card, Input, Loaded, PageHeader, Pager, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, fmtDate, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { CoordinatorSelect } from '@/components/vacancy/CoordinatorSelect';

export default function HrQueuePage() {
  const router = useRouter();
  const { can } = useAuth();
  const [view, setView] = useState<'pending' | 'all'>('all');
  const [departmentId, setDepartmentId] = useState('');
  const [approvedOn, setApprovedOn] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const lookups = useLoad(() => api('/master/lookups'));
  const coordinators = useLoad(() => (can(P.COORDINATOR_ASSIGN) ? api('/hr-queue/coordinators') : Promise.resolve(null)), [can]);
  const state = useLoad(() => api(`/hr-queue${qs({ view, departmentId, approvedOn, q, page })}`), [view, departmentId, approvedOn, q, page]);
  const act = useAction();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Delete is for the Super Admin only (`requisition.manage_all`, owner 2026-11-08); the API enforces it.
  const canDelete = can(P.REQ_MANAGE_ALL);
  const [toDelete, setToDelete] = useState<any | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const create = async (id: string) => {
    setBusyId(id);
    const r = await act.run(() => api(`/hr-queue/${id}/vacancy`, { method: 'POST' }));
    setBusyId(null);
    if (r) router.push(`/vacancies/${r.vacancy.id}`);
  };

  return (
    <>
      <PageHeader title="HR approved requisition queue" subtitle="Only fully approved requisitions appear here. Choose the HR coordinator responsible for each one; only that coordinator works on its CVs and recruitment." />
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert>{message && <Alert tone="success">{message}</Alert>}</div>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search ID or position…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-xs" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }} placeholder="All departments" options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select className="max-w-[14rem]" value={view} onChange={(e) => { setView(e.target.value as any); setPage(1); }} options={[{ value: 'all', label: 'All approved' }, { value: 'pending', label: 'Awaiting vacancy creation' }]} />
          {/* Requisitions approved on one day (owner, 2026-11-08). */}
          <label className="flex items-center gap-2 text-sm text-muted">Approved on
            <Input type="date" className="w-44" value={approvedOn} onChange={(e) => { setApprovedOn(e.target.value); setPage(1); }} />
          </label>
          {approvedOn && <Button size="sm" variant="ghost" onClick={() => { setApprovedOn(''); setPage(1); }}>Any date</Button>}
        </div>
        <Loaded state={state} empty={(d: any) => !d.items.length && (approvedOn ? `No requisitions were approved on ${fmtDate(approvedOn)}${view === 'pending' ? ' that still need a vacancy' : ''}.` : view === 'all' ? 'No approved requisitions yet.' : 'Every approved requisition already has a vacancy.')}>
          {(d: any) => (
            <>
              <Table head={['Requisition', 'Department', 'Company', 'Position', 'Headcount', 'Replacement', 'Submitted', 'Approved', 'Background', 'Coordinator', ...(canDelete ? [''] : [])]}>
                {d.items.map((r: any) => (
                  <tr key={r.id}>
                    <Td>
                      <Link className="font-medium text-brand-700 hover:underline" href={`/requisitions/${r.id}`}>{r.reqNo}</Link>
                      {/* The vacancy number is no longer shown here (owner, 2026-11-08); a requisition without one still offers Create vacancy. */}
                      {!r.vacancy && can(P.VACANCY_CREATE) && <div className="mt-1"><Button size="sm" busy={busyId === r.id} disabled={!!busyId} onClick={() => create(r.id)}>Create vacancy</Button></div>}
                    </Td>
                    <Td>{r.department.name}</Td>
                    <Td>{r.company.code}</Td>
                    <Td>{r.rank}</Td>
                    <Td>{r.headcount}</Td>
                    <Td>{r.replacePlan ? r.replacementEmployeeName ?? 'Yes' : 'No'}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(r.submittedAt)}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(r.approvedAt)}</Td>
                    <Td className="max-w-xs text-xs text-muted">{r.background}</Td>
                    <Td>{can(P.COORDINATOR_ASSIGN) && coordinators.data
                      ? <CoordinatorSelect path={`/hr-queue/${r.id}/coordinator`} value={r.coordinator} options={coordinators.data} onError={act.setError} />
                      : r.coordinator?.name ?? <Badge tone="amber">Unassigned</Badge>}</Td>
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
