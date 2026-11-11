'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Field, Input, Loaded, Modal, PageHeader, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime, qs, show } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

/**
 * Designation-wise quota entries for a (company, department, position) (owner, 2026-11-10). The department-level
 * total manpower is edited on Master Data → Departments; it is shown here as a read-only header per department
 * together with the live sum of its designation rows' present manpower.
 */
export default function QuotasPage() {
  const { can, user, scopes } = useAuth();
  const [departmentId, setDepartmentId] = useState('');
  const [q, setQ] = useState('');
  const lookups = useLoad(() => api('/master/lookups'));
  const state = useLoad(() => api(`/master/quotas${qs({ departmentId })}`), [departmentId]);
  const [edit, setEdit] = useState<any | null>(null);
  const [create, setCreate] = useState(false);
  const act = useAction();
  const inScopeDepts = (lookups.data?.departments ?? []).filter((d: any) => scopes.quotas === null || scopes.quotas?.includes(d.id)).map((d: any) => ({ value: d.id, label: d.name }));
  const allDepts = scopes.quotas === null || (scopes.quotas?.length ?? 0) > 1;

  // Per-department rollup from the designation rows plus `totalQuota` from master data.
  const deptSummary = useMemo(() => {
    const rows: any[] = state.data ?? [];
    const byDept = new Map<string, { id: string; name: string; present: number; total: number | null }>();
    const totals = new Map<string, number | null>();
    (lookups.data?.departments ?? []).forEach((d: any) => totals.set(d.id, d.totalQuota ?? null));
    for (const r of rows) {
      const cur = byDept.get(r.departmentId) ?? { id: r.departmentId, name: r.department.name, present: 0, total: totals.get(r.departmentId) ?? null };
      cur.present += r.presentManpower ?? 0;
      byDept.set(r.departmentId, cur);
    }
    return [...byDept.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [state.data, lookups.data]);

  const save = async () => {
    if (!edit) return;
    if (create && !edit.positionId) { act.setError('Pick the designation. Department total is edited on Master Data → Departments.'); return; }
    const r = await act.run(() => edit.id
      ? api(`/master/quotas/${edit.id}`, { method: 'PATCH', body: { approvedQuota: num(edit.approvedQuota), presentManpower: num(edit.presentManpower), remarks: edit.remarks ?? '' } })
      : api('/master/quotas', { body: { departmentId: edit.departmentId, positionId: edit.positionId, approvedQuota: num(edit.approvedQuota), presentManpower: num(edit.presentManpower), remarks: edit.remarks || undefined } }));
    if (r) { setEdit(null); setCreate(false); state.reload(); }
  };
  const remove = async (r: any) => {
    const label = `${r.department.name} — ${r.position?.title}`;
    if (!window.confirm(`Delete the quota row ${label}? This cannot be undone; the figures stay in the Logs.`)) return;
    if (await act.run(() => api(`/master/quotas/${r.id}`, { method: 'DELETE' }), `Quota row ${label} deleted.`)) state.reload();
  };

  return (
    <>
      <PageHeader title="Department positions & quota" subtitle="Designation-wise quota and present manpower. The department's total quota is edited on Master Data → Departments; current manpower here is the live sum of its designation rows."
        actions={can(P.QUOTA_EDIT) && <Button onClick={() => { setCreate(true); setEdit({ departmentId: user?.departmentId ?? '', positionId: '' }); }}>Add quota row</Button>} />
      {!edit && <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>}
      {deptSummary.length > 0 && (
        <Card pad={false} className="mb-4">
          <Table head={['Department', 'Total quota (master)', 'Present manpower (sum)', 'Vacancy', '']}>
            {deptSummary.map((d) => {
              const vac = d.total == null ? null : Math.max(0, d.total - d.present);
              return (
                <tr key={d.id} className="bg-slate-50/70 font-medium">
                  <Td>{d.name}</Td>
                  <Td className="tabular-nums">{d.total ?? <span className="text-muted">Not set</span>}</Td>
                  <Td className="tabular-nums">{d.present}</Td>
                  <Td className="tabular-nums">{vac == null ? <span className="text-muted">—</span> : vac}</Td>
                  <Td>{can(P.MASTER_CONFIGURE) && <Link href="/admin/master" className="text-sm text-brand-700 hover:underline">Edit on Master Data</Link>}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
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
            <Table head={['Department', 'Position', 'Approved quota', 'Present manpower', 'Vacancy', 'Remarks', 'Last updated', '']}>
              {rows.filter((r) => !q || `${r.position?.title ?? ''} ${r.department.name}`.toLowerCase().includes(q.toLowerCase())).map((r) => (
                <tr key={r.id}>
                  <Td>{r.department.name}</Td>
                  <Td>{r.position?.title}</Td>
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
              <Field label="Department" required><Select value={edit.departmentId} disabled={!allDepts} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })} placeholder="Select…" options={inScopeDepts} /></Field>
              <Field label="Position" required><Select value={edit.positionId} onChange={(e) => setEdit({ ...edit, positionId: e.target.value })} placeholder="Select…" options={(lookups.data?.positions ?? []).map((p: any) => ({ value: p.id, label: p.title }))} /></Field>
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
