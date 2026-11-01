'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Loaded, Modal, PageHeader, Pager, Radio, Select, Table, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, fmtDate, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { CoordinatorSelect } from '@/components/vacancy/CoordinatorSelect';

const STATUSES = ['Open', 'Posting', 'Screening', 'On Hold', 'Filled', 'Closed'];

function List() {
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState(sp.get('departmentId') ?? '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const lookups = useLoad(() => api('/master/lookups'));
  const state = useLoad(() => api(`/vacancies${qs({ status, departmentId, q, page })}`), [status, departmentId, q, page]);
  const coordinators = useLoad(() => (can(P.COORDINATOR_ASSIGN) ? api('/hr-queue/coordinators') : Promise.resolve(null)), [can]);
  const [direct, setDirect] = useState<any | null>(null);
  const act = useAction();
  const listAct = useAction();

  const createDirect = async () => {
    const r = await act.run(() => api('/vacancies/direct', { body: { ...direct, headcount: Number(direct.headcount), positionId: direct.positionId || undefined, coordinatorId: direct.coordinatorId || undefined } }));
    if (r) router.push(`/vacancies/${r.id}`);
  };

  return (
    <>
      <PageHeader title="Vacancies" subtitle={can(P.RECRUITMENT_ALL) ? "Department → position/vacancy → recruitment stage → candidates." : "The vacancies you are coordinator of. The HR Manager assigns coordinators in the HR Approved Queue."}
        actions={can(P.VACANCY_DIRECT) && <Button variant="secondary" onClick={() => setDirect({ vacancyType: 'NEW', headcount: 1 })}>Direct HR vacancy</Button>} />
      <div className="mb-3 empty:hidden"><Alert>{listAct.error}</Alert></div>
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search ID or position…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-xs" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="All departments" options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select className="max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: s }))} />
        </div>
        <Loaded state={state} empty={(d: any) => !d.items.length && 'No vacancies yet. Create one from the HR approved queue.'}>
          {(d: any) => (
            <>
              <Table head={['Vacancy', 'Source', 'Department', 'Company', 'Position', 'Headcount', 'Type', 'CVs', 'Pass', 'Shortlisted', 'Selected', 'Coordinator', 'Status', 'Created']}>
                {d.items.map((v: any) => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" href={`/vacancies/${v.id}`}>{v.vacancyNo}</Link></Td>
                    <Td>{v.source === 'DIRECT_HR' ? <Badge tone="violet">Direct HR Entry</Badge> : <Link className="text-xs text-brand-700 hover:underline" href={`/requisitions/${v.requisition?.id}`}>{v.requisition?.reqNo}</Link>}</Td>
                    <Td>{v.department.name}</Td>
                    <Td>{v.company.code}</Td>
                    <Td>{v.positionTitle}</Td>
                    <Td>{v.headcount}</Td>
                    <Td>{v.vacancyType === 'REPLACEMENT' ? 'Replacement' : 'New'}</Td>
                    <Td className="tabular-nums">{v.stats.total}</Td>
                    <Td className="tabular-nums">{v.stats.pass}</Td>
                    <Td className="tabular-nums">{v.stats.shortlisted}</Td>
                    <Td className="tabular-nums">{v.stats.selected}</Td>
                    <Td className="text-xs">{can(P.COORDINATOR_ASSIGN) && coordinators.data
                      ? <CoordinatorSelect key={`${v.id}-${v.coordinator?.id ?? ''}`} path={`/vacancies/${v.id}/coordinator`} value={v.coordinator} options={coordinators.data} onError={listAct.setError} onSaved={() => listAct.setError(null)} />
                      : v.coordinator?.name ?? <Badge tone="amber">Unassigned</Badge>}</Td>
                    <Td><Badge>{v.status}</Badge></Td>
                    <Td className="whitespace-nowrap">{fmtDate(v.createdAt)}</Td>
                  </tr>
                ))}
              </Table>
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </Loaded>
      </Card>

      <Modal open={!!direct} title="Direct HR vacancy" onClose={() => setDirect(null)}
        footer={<><Button variant="secondary" onClick={() => setDirect(null)}>Cancel</Button><Button busy={act.busy} onClick={createDirect}>Create vacancy</Button></>}>
        {direct && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Alert tone="info">This vacancy will be marked <b>Direct HR Entry</b>. It has no department requisition approvals; your reason and identity are recorded.</Alert></div>
            <Field label="Department" required><Select value={direct.departmentId ?? ''} placeholder="Select…" onChange={(e) => setDirect({ ...direct, departmentId: e.target.value })} options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Company" required><Select value={direct.companyId ?? ''} placeholder="Select…" onChange={(e) => setDirect({ ...direct, companyId: e.target.value })} options={(lookups.data?.companies ?? []).map((c: any) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Position" required><Select value={direct.positionId ?? ''} placeholder="Select…" onChange={(e) => { const p = lookups.data.positions.find((x: any) => x.id === e.target.value); setDirect({ ...direct, positionId: e.target.value, positionTitle: p?.title }); }} options={(lookups.data?.positions ?? []).map((p: any) => ({ value: p.id, label: p.title }))} /></Field>
            <Field label="Headcount" required><Input type="number" min={1} value={direct.headcount} onChange={(e) => setDirect({ ...direct, headcount: e.target.value })} /></Field>
            <Field label="Vacancy type"><Radio name="vt" value={direct.vacancyType} onChange={(v) => setDirect({ ...direct, vacancyType: v })} options={[{ value: 'NEW', label: 'New position' }, { value: 'REPLACEMENT', label: 'Replacement' }]} /></Field>
            {direct.vacancyType === 'REPLACEMENT' && <Field label="Replacement employee"><Input value={direct.replacementEmployee ?? ''} onChange={(e) => setDirect({ ...direct, replacementEmployee: e.target.value })} /></Field>}
            {can(P.COORDINATOR_ASSIGN) && (
              <Field label="Coordinator" className="sm:col-span-2" hint="The HR user responsible for this vacancy's CVs and recruitment. You can also choose later." error={act.fieldErrors.coordinatorId}>
                <Select value={direct.coordinatorId ?? ''} placeholder="Unassigned" onChange={(e) => setDirect({ ...direct, coordinatorId: e.target.value })}
                  options={(coordinators.data ?? []).map((u: any) => ({ value: u.id, label: u.designation ? `${u.name} (${u.designation})` : u.name }))} />
              </Field>
            )}
            <Field label="Reason for direct entry" required className="sm:col-span-2"><Textarea value={direct.directReason ?? ''} onChange={(e) => setDirect({ ...direct, directReason: e.target.value })} /></Field>
          </div>
        )}
        <div className="mt-3"><Alert>{act.error}</Alert></div>
      </Modal>
    </>
  );
}

export default function VacanciesPage() {
  return <Suspense><List /></Suspense>;
}
