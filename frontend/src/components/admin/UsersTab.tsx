'use client';

import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Table, Tabs, Td, cx, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime } from '@/lib/api';
import { cleanScopes, DepartmentScopes, Matrix, PermissionGrid } from './PermissionGrid';

type Role = { id: string; code: string; name: string; active: boolean; permissions: string[] };
type Template = { id: string; name: string; permissions: string[]; departmentScopes: DepartmentScopes };
type Dept = { id: string; name: string };

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const AVATAR = ['bg-violet-100 text-violet-700', 'bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700'];
const avatarTone = (n: string) => AVATAR[[...n].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR.length];
const roleTone = (code: string) => (code === 'SUPER_ADMIN' ? 'violet' : code === 'ADMIN' ? 'amber' : code.startsWith('HR') ? 'brand' : code === 'DEPT_REQUESTER' ? 'green' : 'slate');

const blank = () => ({ id: null as string | null, name: '', email: '', designation: '', departmentId: '', active: true, roleCodes: [] as string[], password: '', extra: [] as string[], denied: [] as string[], scopes: {} as DepartmentScopes });
type Draft = ReturnType<typeof blank>;

const toDraft = (u: any): Draft => ({
  id: u.id, name: u.name, email: u.email, designation: u.designation ?? '', departmentId: u.departmentId ?? '', active: u.active,
  roleCodes: u.roles.map((r: any) => r.code), password: '', extra: u.extraPermissions ?? [], denied: u.deniedPermissions ?? [],
  scopes: { ...(u.departmentScopes ?? {}) },
});

export function UsersTab({ users, roles, templates, matrix, departments, onSaved, onTemplateSaved }: {
  users: any[]; roles: Role[]; templates: Template[]; matrix: Matrix; departments: Dept[];
  onSaved: () => void; onTemplateSaved: () => void;
}) {
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const deleted = useLoad(() => (status === 'deleted' ? api('/admin/users?deleted=true') : Promise.resolve([])), [status]);
  const restore = useAction();
  const doRestore = async (u: any) => {
    const r = await restore.run(() => api(`/admin/users/${u.id}/restore`, { method: 'POST' }), `${u.name} restored as Inactive. Edit the user to activate them.`);
    if (r) { deleted.reload(); onSaved(); }
  };
  /** Keeps history: past requisitions, approvals and audit entries still show the name. Restorable from "Deleted". */
  const doDelete = async (u: any) => {
    if (!window.confirm(`Delete ${u.name}? They can no longer sign in and disappear from lists; their name stays on past records. You can restore them from the "Deleted" filter.`)) return;
    const r = await restore.run(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }), `${u.name} deleted.`);
    if (r) { if (draft?.id === u.id) setDraft(null); onSaved(); }
  };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const source: any[] = status === 'deleted' ? deleted.data ?? [] : users;
    return source.filter((u) => (!s || [u.name, u.email, u.department?.name, ...u.roles.map((r: any) => r.name)].some((v) => v?.toLowerCase().includes(s)))
      && (!roleFilter || u.roles.some((r: any) => r.code === roleFilter))
      && (!status || status === 'deleted' || (status === 'active') === u.active));
  }, [users, deleted.data, q, roleFilter, status]);

  return (
    <div className={cx('grid gap-4', draft && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]')}>
      <Card pad={false} title={<>User Accounts <span className="font-normal text-muted">({users.length})</span></>}
        actions={<Button size="sm" onClick={() => setDraft(blank())}>Create New User</Button>}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search by name, email or role…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-[12rem]" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} placeholder="All roles" options={roles.map((r) => ({ value: r.code, label: r.name }))} />
          <Select className="max-w-[9rem]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'deleted', label: 'Deleted' }]} />
        </div>
        <div className="px-3 pt-2"><Alert tone="success">{restore.message}</Alert><Alert>{restore.error}</Alert></div>
        {rows.length ? (
          <Table head={['Name', 'Email', 'Department', 'Role', 'Status', 'Actions']}>
            {rows.map((u) => (
              <tr key={u.id} className={cx('hover:bg-slate-50', draft?.id === u.id && 'bg-brand-50/60')}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', avatarTone(u.name))}>{initials(u.name)}</span>
                    <div><div className="font-medium">{u.name}</div>{u.designation && <div className="text-xs text-muted">{u.designation}</div>}</div>
                  </div>
                </Td>
                <Td className="text-xs">{u.email}</Td>
                <Td className="text-xs">{u.department?.name ?? '—'}</Td>
                <Td><div className="flex flex-wrap gap-1">{u.roles.map((r: any) => <Badge key={r.code} tone={roleTone(r.code)}>{r.name}</Badge>)}</div>
                  {(u.extraPermissions.length > 0 || u.deniedPermissions.length > 0 || Object.keys(u.departmentScopes ?? {}).length > 0) && <div className="mt-0.5 text-[11px] text-muted">custom permissions</div>}</Td>
                <Td>{u.deletedAt ? <Badge tone="slate">Deleted</Badge> : <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Active' : 'Inactive'}</Badge>}</Td>
                <Td className="whitespace-nowrap">{u.deletedAt
                  ? <Button size="sm" variant="secondary" busy={restore.busy} onClick={() => doRestore(u)}>Restore</Button>
                  : <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setDraft(toDraft(u))}>Edit</Button>
                    <Button size="sm" variant="danger" disabled={restore.busy} onClick={() => doDelete(u)}>Delete</Button>
                  </div>}</Td>
              </tr>
            ))}
          </Table>
        ) : <div className="p-4"><Empty>No users match this search.</Empty></div>}
      </Card>

      {draft && (
        <UserEditor key={draft.id ?? 'new'} initial={draft} user={users.find((u) => u.id === draft.id)} roles={roles} templates={templates}
          matrix={matrix} departments={departments} onClose={() => setDraft(null)}
          onSaved={(u) => { onSaved(); if (u) setDraft(toDraft(u)); else setDraft(null); }} onTemplateSaved={onTemplateSaved} />
      )}
    </div>
  );
}

function UserEditor({ initial, user, roles, templates, matrix, departments, onClose, onSaved, onTemplateSaved }: {
  initial: Draft; user: any; roles: Role[]; templates: Template[]; matrix: Matrix; departments: Dept[];
  onClose: () => void; onSaved: (u: any | null) => void; onTemplateSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [tab, setTab] = useState('basic');
  const [method, setMethod] = useState<'custom' | 'template'>('custom');
  const [templateId, setTemplateId] = useState('');
  const [reset, setReset] = useState<string | null>(null);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const act = useAction();
  const isNew = !d.id;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const base = roles.filter((r) => d.roleCodes.includes(r.code)).flatMap((r) => r.permissions);
  const effective = [...new Set([...base, ...d.extra])].filter((c) => !d.denied.includes(c));

  /** Copying a template makes the user's permissions exactly the template's: allow what roles lack, deny what they add. */
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const want = new Set(t.permissions);
    set({ extra: t.permissions.filter((c) => !base.includes(c)), denied: [...new Set(base)].filter((c) => !want.has(c)), scopes: { ...t.departmentScopes } });
  };

  const save = async () => {
    const body: any = { name: d.name, designation: d.designation || undefined, departmentId: d.departmentId || null, roleCodes: d.roleCodes };
    if (isNew) Object.assign(body, { email: d.email, password: d.password });
    else Object.assign(body, { email: d.email, active: d.active, extraPermissions: d.extra, deniedPermissions: d.denied, departmentScopes: cleanScopes(d.scopes) });
    const r = await act.run(() => (isNew ? api('/admin/users', { body }) : api(`/admin/users/${d.id}`, { method: 'PATCH', body })), isNew ? 'User created. You can now set individual permissions.' : 'Changes saved.');
    if (r) onSaved(r);
  };
  /** Keeps history: past requisitions, approvals and audit entries still show the name. Restorable. */
  const doDelete = async () => {
    if (!window.confirm(`Delete ${d.name}? They can no longer sign in and disappear from lists; their name stays on past records. You can restore them later.`)) return;
    const r = await act.run(() => api(`/admin/users/${d.id}`, { method: 'DELETE' }));
    if (r) onSaved(null);
  };
  const doReset = async () => {
    const r = await act.run(() => api(`/admin/users/${d.id}`, { method: 'PATCH', body: { password: reset } }), 'Password reset. Give the new password to the user.');
    if (r) setReset(null);
  };
  const doSaveAs = async () => {
    const r = await act.run(() => api('/admin/permission-templates', { body: { name: saveAs, description: `Saved from ${d.name}`, permissions: effective, departmentScopes: cleanScopes(d.scopes) } }), 'Saved as a permission template.');
    if (r) { setSaveAs(null); onTemplateSaved(); }
  };
  const generate = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    setReset([...buf].map((n) => chars[n % chars.length]).join(''));
  };

  return (
    <Card title={<span className="flex items-center gap-2"><button type="button" aria-label="Close" className="rounded px-1 text-muted hover:bg-slate-100" onClick={onClose}>←</button>{isNew ? 'Create User' : 'Edit User'}</span>}
      actions={<>
        {!isNew && <Button size="sm" variant="danger" onClick={doDelete}>Delete</Button>}
        {!isNew && <Button size="sm" variant="secondary" onClick={() => setReset('')}>Reset Password</Button>}
        <Button size="sm" busy={act.busy} onClick={save}>{isNew ? 'Create User' : 'Save Changes'}</Button>
      </>}>
      <div className="space-y-3">
        <Alert tone="success">{act.message}</Alert>
        <Alert>{act.error}</Alert>
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: 'basic', label: 'Basic Information' }, { key: 'role', label: 'Role & Department' },
          ...(isNew ? [] : [{ key: 'perms', label: 'Permissions' }]),
        ]} />

        {tab === 'basic' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required error={act.fieldErrors.name}><Input value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Email" required error={act.fieldErrors.email}><Input type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Designation"><Input value={d.designation} onChange={(e) => set({ designation: e.target.value })} /></Field>
            {isNew
              ? <Field label="Initial password" required hint="At least 8 characters" error={act.fieldErrors.password}><Input type="password" autoComplete="new-password" value={d.password} onChange={(e) => set({ password: e.target.value })} /></Field>
              : <Field label="Status"><Select value={d.active ? '1' : '0'} onChange={(e) => set({ active: e.target.value === '1' })} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive (cannot sign in)' }]} /></Field>}
            {!isNew && <div className="text-xs text-muted sm:col-span-2">Last login: {fmtDateTime(user?.lastLoginAt)}</div>}
          </div>
        )}

        {tab === 'role' && (
          <div className="space-y-3">
            <Field label="Department" hint="Own Department scopes use this department.">
              <Select value={d.departmentId} placeholder="None (cross-department)" onChange={(e) => set({ departmentId: e.target.value })} options={departments.map((x) => ({ value: x.id, label: x.name }))} />
            </Field>
            <Field label="Roles" hint="Role permissions are the starting point; the Permissions tab adds or removes rights for this user only. Legacy roles are only shown while a user still holds them — uncheck to replace with HR Coordinator.">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {roles.filter((r) => r.active || d.roleCodes.includes(r.code)).map((r) => (
                  <label key={r.code} className={cx('flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-sm', !r.active && 'opacity-60')}>
                    <input type="checkbox" className="accent-brand-600" checked={d.roleCodes.includes(r.code)}
                      onChange={(e) => set({ roleCodes: e.target.checked ? [...d.roleCodes, r.code] : d.roleCodes.filter((c) => c !== r.code) })} />
                    <span>{r.name}{!r.active && ' (legacy)'}</span>
                    <span className="ml-auto text-[11px] text-muted">{r.permissions.length}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}

        {tab === 'perms' && (
          <div className="space-y-3">
            <Alert tone="info">Set module-wise permissions for this user. Different users with the same role can have different permissions.</Alert>
            <div>
              <div className="mb-1 text-sm font-semibold">Permission Method</div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="method" className="accent-brand-600" checked={method === 'custom'} onChange={() => setMethod('custom')} /><b>Custom Permissions</b> (set manually)</label>
                <label className="flex items-center gap-2"><input type="radio" name="method" className="accent-brand-600" checked={method === 'template'} onChange={() => setMethod('template')} />Copy from Permission Template</label>
                <Select className="max-w-[14rem]" disabled={method !== 'template'} value={templateId} placeholder="Select template" onChange={(e) => applyTemplate(e.target.value)} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
              </div>
              {method === 'template' && templateId && <div className="mt-1 text-xs text-muted">Template copied into the grid below. Adjust if needed, then Save Changes.</div>}
            </div>
            <PermissionGrid matrix={matrix} base={base} allow={d.extra} deny={d.denied} allowDeny
              onChange={(extra, denied) => set({ extra, denied })} scopes={d.scopes} onScopes={(scopes) => set({ scopes })} departments={departments} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
              <span>{effective.length} permissions in effect · {d.extra.length} allowed and {d.denied.length} denied on top of the role{d.roleCodes.length === 1 ? '' : 's'}</span>
              <span className="flex gap-2">
                {(d.extra.length > 0 || d.denied.length > 0) && <Button size="sm" variant="ghost" onClick={() => set({ extra: [], denied: [] })}>Reset to role permissions</Button>}
                <Button size="sm" variant="secondary" onClick={() => setSaveAs(`${d.name} permissions`)}>Save as template</Button>
              </span>
            </div>
          </div>
        )}
      </div>

      <Modal open={reset !== null} title={`Reset password: ${d.email}`} onClose={() => setReset(null)}
        footer={<><Button variant="secondary" onClick={() => setReset(null)}>Cancel</Button><Button variant="danger" busy={act.busy} disabled={(reset ?? '').length < 8} onClick={doReset}>Reset Password</Button></>}>
        <Field label="New password" hint="At least 8 characters. Share it with the user privately; they should change it after signing in.">
          <div className="flex gap-2"><Input value={reset ?? ''} autoComplete="new-password" onChange={(e) => setReset(e.target.value)} /><Button variant="secondary" onClick={generate}>Generate</Button></div>
        </Field>
        <div className="mt-3"><Alert>{act.error}</Alert></div>
      </Modal>

      <Modal open={saveAs !== null} title="Save as permission template" onClose={() => setSaveAs(null)}
        footer={<><Button variant="secondary" onClick={() => setSaveAs(null)}>Cancel</Button><Button busy={act.busy} disabled={(saveAs ?? '').trim().length < 2} onClick={doSaveAs}>Save template</Button></>}>
        <Field label="Template name" error={act.fieldErrors.name}><Input value={saveAs ?? ''} onChange={(e) => setSaveAs(e.target.value)} /></Field>
        <div className="mt-2 text-xs text-muted">Saves the {effective.length} permissions in effect and the access scopes shown in the grid.</div>
        <div className="mt-3"><Alert>{act.error}</Alert></div>
      </Modal>
    </Card>
  );
}
