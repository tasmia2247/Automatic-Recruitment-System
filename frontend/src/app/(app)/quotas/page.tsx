'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Loaded, Modal, PageHeader, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime, qs, show } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

export default function QuotasPage() {
  const { can, user, scopes } = useAuth();
  const [departmentId, setDepartmentId] = useState('');
  const [q, setQ] = useState('');
  const lookups = useLoad(() => api('/master/lookups'));
  const state = useLoad(() => api(`/master/quotas${qs({ departmentId })}`), [departmentId]);
  const [edit, setEdit] = useState<any | null>(null);
  const [create, setCreate] = useState(false);
  const act = useAction();
  // More than one department in scope: show the department filter and column.
  const inScopeDepts = (lookups.data?.departments ?? []).filter((d: any) => scopes.quotas === null || scopes.quotas?.includes(d.id)).map((d: any) => ({ value: d.id, label: d.name }));
  const allDepts = scopes.quotas === null || (scopes.quotas?.length ?? 0) > 1;

  const save = async () => {
    const r = await act.run(() => edit.id
      ? api(`/master/quotas/${edit.id}`, { method: 'PATCH', body: { approvedQuota: num(edit.approvedQuota), presentManpower: num(edit.presentManpower), remarks: edit.remarks ?? '' } })
      : api('/master/quotas', { body: { companyId: edit.companyId, departmentId: edit.departmentId, positionId: edit.positionId || null, approvedQuota: num(edit.approvedQuota), presentManpower: num(edit.presentManpower), remarks: edit.remarks || undefined } }));
    if (r) { setEdit(null); setCreate(false); state.reload(); }
  };
  // Department users delete rows of their own department; Super Admin any row (owner, 2026-11-08). The API checks the scope.
  const remove = async (r: any) => {
    const label = `${r.department.name} — ${r.level === 'Department' ? 'Department total' : r.position?.title} (${r.company.code})`;
    if (!window.confirm(`Delete the quota row ${label}? This cannot be undone; the figures stay in the Logs.`)) return;
    if (await act.run(() => api(`/master/quotas/${r.id}`, { method: 'DELETE' }), `Quota row ${label} deleted.`)) state.reload();
  };

  return (
    <>
      <PageHeader title="Department positions & quota" subtitle="Vacant = approved quota − present manpower. Department and designation figures are kept separate; missing or inconsistent data is flagged rather than shown as a number."
        actions={can(P.QUOTA_EDIT) && <Button onClick={() => { setCreate(true); setEdit({ departmentId: user?.departmentId ?? '', companyId: '', positionId: '' }); }}>Add quota row</Button>} />
      {!edit && <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>}
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          {allDepts && (
            <Select className="max-w-xs" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="All departments"
              options={inScopeDepts} />
          )}
          <Input className="max-w-xs" placeholder="Search position / company…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Loaded state={state} empty={(rows: any[]) => !rows.length && 'No quota records for this selection.'}>
          {(rows: any[]) => (
            <Table head={['Company', 'Department', 'Level / Position', 'Approved quota', 'Present manpower', 'Vacancy', 'Remarks', 'Last updated', '']}>
              {rows.filter((r) => !q || `${r.position?.title ?? ''} ${r.company.name}`.toLowerCase().includes(q.toLowerCase())).map((r) => (
                <tr key={r.id} className={r.level === 'Department' ? 'bg-slate-50/70 font-medium' : ''}>
                  <Td>{r.company.code}</Td>
                  <Td>{r.department.name}</Td>
                  <Td>{r.level === 'Department' ? 'Department total' : r.position?.title}</Td>
                  <Td className="tabular-nums">{show(r.approvedQuota, 'Not available')}</Td>
                  <Td className="tabular-nums">{show(r.presentManpower, 'Not available')}</Td>
                  <Td>{r.vacancyFlag ? <Badge tone="amber">{r.vacancy !== null ? `${r.vacancy} · ` : ''}{r.vacancyFlag}</Badge> : <span className="tabular-nums">{r.vacancy}</span>}</Td>
                  <Td className="max-w-xs text-muted">{show(r.remarks)}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(r.updatedAt)}</Td>
                  <Td>{can(P.QUOTA_EDIT) && <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { setCreate(false); setEdit({ ...r }); }}>Edit</Button>
                    <Button size="sm" variant="danger" busy={act.busy} onClick={() => remove(r)}>Delete</Button>
                  </div>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Loaded>
      </Card>

      <Modal open={!!edit} title={create ? 'Add quota row' : 'Update quota row'} onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button busy={act.busy} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            {create && <>
              <Field label="Company" required><Select value={edit.companyId} onChange={(e) => setEdit({ ...edit, companyId: e.target.value })} placeholder="Select…" options={(lookups.data?.companies ?? []).map((c: any) => ({ value: c.id, label: c.name }))} /></Field>
              <Field label="Department" required><Select value={edit.departmentId} disabled={!allDepts} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })} placeholder="Select…" options={inScopeDepts} /></Field>
              <Field label="Position" hint="Leave empty for the department total" className="sm:col-span-2"><Select value={edit.positionId} onChange={(e) => setEdit({ ...edit, positionId: e.target.value })} placeholder="Department total" options={(lookups.data?.positions ?? []).map((p: any) => ({ value: p.id, label: p.title }))} /></Field>
            </>}
            <Field label="Approved quota" hint={!create && !can(P.REQ_QUOTA_CHART) ? 'Changes only via an approved requisition / quota chart' : undefined}>
              <Input type="number" min={0} value={edit.approvedQuota ?? ''} disabled={!create && !can(P.REQ_QUOTA_CHART)} onChange={(e) => setEdit({ ...edit, approvedQuota: e.target.value })} />
            </Field>
            <Field label="Present manpower"><Input type="number" min={0} value={edit.presentManpower ?? ''} onChange={(e) => setEdit({ ...edit, presentManpower: e.target.value })} /></Field>
            <Field label="Remarks" className="sm:col-span-2"><Input value={edit.remarks ?? ''} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} /></Field>
          </div>
        )}
        <div className="mt-3"><Alert>{act.error}</Alert></div>
      </Modal>
    </>
  );
}

const num = (v: any) => (v === '' || v === null || v === undefined ? null : Number(v));
