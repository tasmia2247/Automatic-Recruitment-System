'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Input, Loaded, PageHeader, Pager, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, fmtDate, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { CoordinatorSelect } from '@/components/vacancy/CoordinatorSelect';

export default function HrQueuePage() {
  const router = useRouter();
  const { can } = useAuth();
  const [view, setView] = useState<'pending' | 'all'>('all');
  const [departmentId, setDepartmentId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const lookups = useLoad(() => api('/master/lookups'));
  const coordinators = useLoad(() => (can(P.COORDINATOR_ASSIGN) ? api('/hr-queue/coordinators') : Promise.resolve(null)), [can]);
  const state = useLoad(() => api(`/hr-queue${qs({ view, departmentId, q, page })}`), [view, departmentId, q, page]);
  const act = useAction();
  const [busyId, setBusyId] = useState<string | null>(null);

  const create = async (id: string) => {
    setBusyId(id);
    const r = await act.run(() => api(`/hr-queue/${id}/vacancy`, { method: 'POST' }));
    setBusyId(null);
    if (r) router.push(`/vacancies/${r.vacancy.id}`);
  };

  return (
    <>
      <PageHeader title="HR approved requisition queue" subtitle="Only fully approved requisitions appear here. Choose the HR coordinator responsible for each one; only that coordinator works on its CVs and recruitment." />
      <Alert>{act.error}</Alert>
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search ID or position…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-xs" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="All departments" options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select className="max-w-[14rem]" value={view} onChange={(e) => setView(e.target.value as any)} options={[{ value: 'all', label: 'All approved' }, { value: 'pending', label: 'Awaiting vacancy creation' }]} />
        </div>
        <Loaded state={state} empty={(d: any) => !d.items.length && (view === 'all' ? 'No approved requisitions yet.' : 'Every approved requisition already has a vacancy.')}>
          {(d: any) => (
            <>
              <Table head={['Requisition', 'Department', 'Company', 'Position', 'Headcount', 'Replacement', 'Submitted', 'Approved', 'Background', 'Coordinator']}>
                {d.items.map((r: any) => (
                  <tr key={r.id}>
                    <Td>
                      <Link className="font-medium text-brand-700 hover:underline" href={`/requisitions/${r.id}`}>{r.reqNo}</Link>
                      <div className="mt-1 text-xs">{r.vacancy ? <Link className="text-brand-700 hover:underline" href={`/vacancies/${r.vacancy.id}`}>{r.vacancy.vacancyNo}</Link>
                        : can(P.VACANCY_CREATE) && <Button size="sm" busy={busyId === r.id} disabled={!!busyId} onClick={() => create(r.id)}>Create vacancy</Button>}</div>
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
                  </tr>
                ))}
              </Table>
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}
