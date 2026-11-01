'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Loaded, PageHeader, Select, useAction, useLoad } from '@/components/ui';
import { api } from '@/lib/api';

const LABELS = ['Concerned Director', 'Concerned HR', 'Concerned AD/ED', 'Corporate HR', 'HOD-HR'];

export default function RoutesPage() {
  const routes = useLoad(() => api('/approvals/routes'));
  const users = useLoad(() => api('/admin/users'));
  const lookups = useLoad(() => api('/master/lookups'));
  const [edit, setEdit] = useState<any | null>(null);
  const act = useAction();

  const save = async () => {
    const body = { name: edit.name, departmentId: edit.departmentId || null, active: edit.active, steps: edit.steps.map((s: any, i: number) => ({ stepOrder: i + 1, label: s.label, approverUserId: s.approverUserId, required: s.required })) };
    const r = await act.run(() => (edit.id ? api(`/approvals/routes/${edit.id}`, { method: 'PUT', body }) : api('/approvals/routes', { body })), 'Route saved. It applies to requisitions submitted from now on.');
    if (r) { setEdit(null); routes.reload(); }
  };
  const move = (i: number, d: number) => { const s = [...edit.steps]; [s[i], s[i + d]] = [s[i + d], s[i]]; setEdit({ ...edit, steps: s }); };
  const approvers = (users.data ?? []).filter((u: any) => u.active);

  return (
    <>
      <PageHeader title="Approval routes" subtitle="Configure which sign-offs are required and in what order. A department route overrides the default route. The prototype default follows the Form No. 01 order and must be confirmed by the business owner."
        actions={<Button onClick={() => setEdit({ name: '', departmentId: '', active: true, steps: [{ label: LABELS[0], approverUserId: '', required: true }] })}>New route</Button>} />
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>
      {edit ? (
        <Card title={edit.id ? `Edit route: ${edit.name}` : 'New route'}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Route name" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Applies to"><Select value={edit.departmentId ?? ''} placeholder="All departments (default route)" onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })} options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Status"><Select value={edit.active ? '1' : '0'} onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} /></Field>
          </div>
          <div className="mt-4 space-y-2">
            {edit.steps.map((s: any, i: number) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-line p-2">
                <div className="w-8 pb-2 text-center font-semibold text-muted">{i + 1}</div>
                <Field label="Sign-off step" className="min-w-[12rem] flex-1">
                  <Input list="step-labels" value={s.label} onChange={(e) => setEdit({ ...edit, steps: edit.steps.map((x: any, j: number) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                </Field>
                <Field label="Named approver" className="min-w-[14rem] flex-1">
                  <Select value={s.approverUserId} placeholder="Select user…" onChange={(e) => setEdit({ ...edit, steps: edit.steps.map((x: any, j: number) => (j === i ? { ...x, approverUserId: e.target.value } : x)) })}
                    options={approvers.map((u: any) => ({ value: u.id, label: `${u.name} (${u.email})` }))} />
                </Field>
                <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={s.required} onChange={(e) => setEdit({ ...edit, steps: edit.steps.map((x: any, j: number) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> Mandatory</label>
                <div className="flex gap-1 pb-1">
                  <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                  <Button size="sm" variant="secondary" disabled={i === edit.steps.length - 1} onClick={() => move(i, 1)}>↓</Button>
                  <Button size="sm" variant="danger" onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_: any, j: number) => j !== i) })}>Remove</Button>
                </div>
              </div>
            ))}
            <datalist id="step-labels">{LABELS.map((l) => <option key={l} value={l} />)}</datalist>
            <Button size="sm" variant="secondary" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { label: '', approverUserId: '', required: true }] })}>Add step</Button>
          </div>
          <p className="mt-3 text-xs text-muted">Prototype approval mode: one named approver per step, sequential. Optional (non-mandatory) steps are skipped. Changing a route does not alter requisitions already in approval.</p>
          <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button busy={act.busy} disabled={!edit.name || edit.steps.some((s: any) => !s.label || !s.approverUserId)} onClick={save}>Save route</Button></div>
        </Card>
      ) : (
        <Loaded state={routes} empty={(d: any[]) => !d.length && 'No approval routes. Requisitions cannot be submitted until a route exists.'}>
          {(rows: any[]) => (
            <div className="grid gap-4 lg:grid-cols-2">
              {rows.map((r) => (
                <Card key={r.id} title={<span className="flex items-center gap-2">{r.name} <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Active' : 'Inactive'}</Badge></span>}
                  actions={<Button size="sm" variant="secondary" onClick={() => setEdit({ ...r, departmentId: r.departmentId ?? '', steps: r.steps.map((s: any) => ({ label: s.label, approverUserId: s.approverUserId, required: s.required })) })}>Edit</Button>}>
                  <div className="mb-2 text-xs text-muted">{r.departmentId ? `Department: ${lookups.data?.departments.find((d: any) => d.id === r.departmentId)?.name ?? ''}` : 'Default route (all departments)'}</div>
                  <ol className="space-y-1 text-sm">{r.steps.map((s: any) => <li key={s.id}>{s.stepOrder}. <b>{s.label}</b> — {s.approver?.name}{!s.required && <span className="text-xs text-muted"> (optional)</span>}</li>)}</ol>
                </Card>
              ))}
            </div>
          )}
        </Loaded>
      )}
    </>
  );
}
