'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Table, Td, Textarea, cx, useAction } from '@/components/ui';
import { api } from '@/lib/api';
import { cleanScopes, DepartmentScopes, Matrix, PermissionGrid } from './PermissionGrid';

type Role = { id: string; code: string; name: string; description: string | null; active: boolean; permissions: string[]; builtIn?: boolean };
type Template = { id: string; name: string; description: string | null; permissions: string[]; departmentScopes: DepartmentScopes };

/** Roles: the default permission set every member starts from. */
export function RolesTab({ roles, users, matrix, onSaved }: { roles: Role[]; users: any[]; matrix: Matrix; onSaved: () => void }) {
  const [edit, setEdit] = useState<(Partial<Role> & { permissions: string[] }) | null>(null);
  const act = useAction();
  const members = (code: string) => users.filter((u) => u.roles.some((r: any) => r.code === code)).length;

  const save = async () => {
    const body = edit!.id
      ? { name: edit!.name, description: edit!.description ?? '', active: edit!.active, permissions: edit!.permissions }
      : { code: edit!.code, name: edit!.name, description: edit!.description || undefined, permissions: edit!.permissions };
    const r = await act.run(() => (edit!.id ? api(`/admin/roles/${edit!.id}`, { method: 'PATCH', body }) : api('/admin/roles', { body })), 'Role saved.');
    if (r) { setEdit({ ...(r as Role) }); onSaved(); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete role "${edit!.name}"? This cannot be undone.`)) return;
    const r = await act.run(() => api(`/admin/roles/${edit!.id}`, { method: 'DELETE' }), 'Role deleted.');
    if (r) { setEdit(null); onSaved(); }
  };

  return (
    <div className={cx('grid gap-4', edit && 'xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]')}>
      <Card pad={false} title={<>Roles <span className="font-normal text-muted">({roles.length})</span></>}
        actions={<Button size="sm" onClick={() => setEdit({ code: '', name: '', description: '', permissions: [], active: true })}>New Role</Button>}>
        <Table head={['Role', 'Users', 'Permissions', 'Status', '']}>
          {roles.map((r) => (
            <tr key={r.id} className={cx('hover:bg-slate-50', edit?.id === r.id && 'bg-brand-50/60')}>
              <Td><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.code}</div>{r.description && <div className="max-w-sm text-xs text-muted">{r.description}</div>}</Td>
              <Td className="tabular-nums">{members(r.code)}</Td>
              <Td className="tabular-nums">{r.permissions.length}</Td>
              <Td><Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Active' : 'Inactive'}</Badge></Td>
              <Td><Button size="sm" variant="secondary" onClick={() => setEdit({ ...r })}>Edit</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
      {edit && (
        <Card title={edit.id ? `Edit role: ${edit.name}` : 'New role'}
          actions={<>
            {edit.id && !edit.builtIn && <Button size="sm" variant="danger" onClick={remove}>Delete</Button>}
            {edit.builtIn && <span className="text-xs text-muted">Built-in role: deactivate instead of deleting</span>}
            <Button size="sm" variant="secondary" onClick={() => setEdit(null)}>Close</Button><Button size="sm" busy={act.busy} onClick={save}>Save Role</Button>
          </>}>
          <div className="space-y-3">
            <Alert tone="success">{act.message}</Alert>
            <Alert>{act.error}</Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" required error={act.fieldErrors.code} hint={edit.id ? 'Fixed once created.' : 'e.g. HR_ASSISTANT'}><Input value={edit.code ?? ''} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>
              <Field label="Name" required error={act.fieldErrors.name}><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
              {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active (inactive roles grant nothing)</label>}
            </div>
            <PermissionGrid matrix={matrix} base={[]} allow={edit.permissions} deny={[]} allowDeny={false} onChange={(allow) => setEdit({ ...edit, permissions: allow })} />
            <div className="text-xs text-muted">{edit.permissions.length} permissions. Changes apply to every member of the role, except rights a user has allowed or denied individually.</div>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Permissions: the whole catalogue as a module x action grid. Labels, descriptions and module names can be edited, and
 * a permission can be switched off for everyone; the codes themselves are fixed because the API checks them in code. */
export function PermissionsTab({ matrix, roles, onSaved }: { matrix: Matrix; roles: Role[]; onSaved: () => void }) {
  const holders = (code: string) => roles.filter((r) => r.active && r.permissions.includes(code));
  const [edit, setEdit] = useState<{ kind: 'permission' | 'module'; key: string; title: string; label: string; description: string; disabled: boolean; custom: boolean } | null>(null);
  const act = useAction();
  const perm = (code: string) => matrix.permissions?.[code];

  const openPermission = (code: string, defaultLabel: string) => {
    const p = perm(code);
    setEdit({ kind: 'permission', key: code, title: `Permission ${code}`, label: p?.label ?? '', description: p?.description ?? '', disabled: !!p?.disabled, custom: !!p });
    setDefaultLabel(defaultLabel);
  };
  const [defaultLabel, setDefaultLabel] = useState('');
  const openModule = (m: Matrix['modules'][number]) => {
    const renamed = m.defaultLabel && m.label !== m.defaultLabel;
    setEdit({ kind: 'module', key: m.key, title: `Module ${m.defaultLabel ?? m.label}`, label: renamed ? m.label : '', description: m.description ?? '', disabled: false, custom: !!(renamed || m.description) });
    setDefaultLabel(m.defaultLabel ?? m.label);
  };
  const save = async () => {
    const r = await act.run(() => api(`/admin/permission-settings/${edit!.kind}/${encodeURIComponent(edit!.key)}`, { method: 'PUT', body: { label: edit!.label, description: edit!.description, disabled: edit!.disabled } }), 'Saved.');
    if (r) { setEdit(null); onSaved(); }
  };
  const reset = async () => {
    const r = await act.run(() => api(`/admin/permission-settings/${edit!.kind}/${encodeURIComponent(edit!.key)}`, { method: 'DELETE' }), 'Reset to the built-in label.');
    if (r) { setEdit(null); onSaved(); }
  };

  return (
    <Card pad={false} title="Permission catalogue">
      <div className="space-y-2 px-4 pt-3">
        <div className="text-xs text-muted">Every right in ARS, grouped by module and enforced by the API. Edit a module or permission to rename it, describe it, or switch a permission off for everyone.</div>
        <Alert tone="success">{act.message}</Alert>
        <Alert>{!edit && act.error}</Alert>
      </div>
      <Table head={['Module', 'Action', 'Permission code', 'Granted by roles', 'Status', '']}>
        {matrix.modules.flatMap((m) => {
          const rows = [
            ...matrix.actions.filter((a) => m.actions[a.key]?.length).map((a) => ({ label: a.label, codes: m.actions[a.key]! })),
            ...(m.extras ?? []).map((e) => ({ label: e.label, codes: [e.code] })),
          ];
          return rows.map((r, i) => {
            const p = perm(r.codes[0]);
            return (
              <tr key={`${m.key}-${r.label}`} className={cx(i === 0 && 'border-t-2 border-line', p?.disabled && 'bg-red-50/40')}>
                <Td className="font-medium">{i === 0 && <>
                  {m.label}{m.defaultLabel && m.label !== m.defaultLabel && <div className="text-[11px] font-normal text-muted">was {m.defaultLabel}</div>}
                  {m.description && <div className="max-w-[14rem] text-[11px] font-normal text-muted">{m.description}</div>}
                  <button type="button" className="mt-1 block text-xs font-normal text-brand-700 hover:underline" onClick={() => openModule(m)}>Edit module</button>
                </>}</Td>
                <Td>{p?.label || r.label}{p?.label && <div className="text-[11px] text-muted">was {r.label}</div>}{p?.description && <div className="max-w-xs text-[11px] text-muted">{p.description}</div>}</Td>
                <Td className="font-mono text-xs">{r.codes.join(', ')}</Td>
                <Td><div className="flex flex-wrap gap-1">{holders(r.codes[0]).map((h) => <Badge key={h.code} tone="slate">{h.name}</Badge>)}</div></Td>
                <Td>{r.codes.some((c) => perm(c)?.disabled) ? <Badge tone="red">Switched off</Badge> : <Badge tone="green">On</Badge>}</Td>
                <Td className="whitespace-nowrap">{r.codes.map((c) => (
                  <Button key={c} size="sm" variant="secondary" onClick={() => openPermission(c, r.label)}>{r.codes.length > 1 ? `Edit ${c}` : 'Edit'}</Button>
                ))}</Td>
              </tr>
            );
          });
        })}
      </Table>

      <Modal open={!!edit} title={edit?.title ?? ''} onClose={() => setEdit(null)}
        footer={<>
          {edit?.custom && <Button variant="secondary" onClick={reset}>Reset to default</Button>}
          <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
          <Button busy={act.busy} onClick={save}>Save</Button>
        </>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Display name" hint={`Leave empty to use the built-in name: ${defaultLabel}`}><Input value={edit.label} placeholder={defaultLabel} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
            <Field label="Description"><Textarea rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            {edit.kind === 'permission' && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 accent-red-600" checked={edit.disabled} disabled={edit.key === 'admin.users'} onChange={(e) => setEdit({ ...edit, disabled: e.target.checked })} />
                <span>Switch off system-wide<div className="text-xs text-muted">{edit.key === 'admin.users' ? 'Users & Roles cannot be switched off.' : 'Nobody holds this permission while it is off, whatever their roles or individual permissions say.'}</div></span>
              </label>
            )}
            <Alert>{act.error}</Alert>
          </div>
        )}
      </Modal>
    </Card>
  );
}

/** Permission templates: named permission sets with access scopes, copied onto users. */
export function TemplatesTab({ templates, matrix, departments, onSaved }: { templates: Template[]; matrix: Matrix; departments: { id: string; name: string }[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<(Partial<Template> & { permissions: string[]; departmentScopes: DepartmentScopes }) | null>(null);
  const act = useAction();

  const save = async () => {
    const body = { name: edit!.name, description: edit!.description || null, permissions: edit!.permissions, departmentScopes: cleanScopes(edit!.departmentScopes) };
    const r = await act.run(() => (edit!.id ? api(`/admin/permission-templates/${edit!.id}`, { method: 'PUT', body }) : api('/admin/permission-templates', { body })), 'Template saved.');
    if (r) { setEdit({ ...(r as Template) }); onSaved(); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete template "${edit!.name}"? Users who copied it keep their permissions.`)) return;
    const r = await act.run(() => api(`/admin/permission-templates/${edit!.id}`, { method: 'DELETE' }), 'Template deleted.');
    if (r) { setEdit(null); onSaved(); }
  };

  return (
    <div className={cx('grid gap-4', edit && 'xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]')}>
      <Card pad={false} title={<>Permission Templates <span className="font-normal text-muted">({templates.length})</span></>}
        actions={<Button size="sm" onClick={() => setEdit({ name: '', description: '', permissions: [], departmentScopes: {} })}>New Template</Button>}>
        <div className="px-4 pt-3 text-xs text-muted">Copy a template onto a user from their Permissions tab (“Copy from Permission Template”).</div>
        {templates.length ? (
          <Table head={['Template', 'Permissions', 'Access scopes', '']}>
            {templates.map((t) => (
              <tr key={t.id} className={cx('hover:bg-slate-50', edit?.id === t.id && 'bg-brand-50/60')}>
                <Td><div className="font-medium">{t.name}</div>{t.description && <div className="max-w-sm text-xs text-muted">{t.description}</div>}</Td>
                <Td className="tabular-nums">{t.permissions.length}</Td>
                <Td className="text-xs">{Object.keys(t.departmentScopes ?? {}).length ? Object.entries(t.departmentScopes).map(([k, v]) => `${k}: ${v?.mode}`).join(', ') : 'Role default'}</Td>
                <Td><Button size="sm" variant="secondary" onClick={() => setEdit({ ...t, departmentScopes: { ...t.departmentScopes } })}>Edit</Button></Td>
              </tr>
            ))}
          </Table>
        ) : <div className="p-4"><Empty>No templates yet.</Empty></div>}
      </Card>
      {edit && (
        <Card title={edit.id ? `Edit template: ${edit.name}` : 'New template'}
          actions={<>
            {edit.id && <Button size="sm" variant="danger" onClick={remove}>Delete</Button>}
            <Button size="sm" variant="secondary" onClick={() => setEdit(null)}>Close</Button>
            <Button size="sm" busy={act.busy} onClick={save}>Save Template</Button>
          </>}>
          <div className="space-y-3">
            <Alert tone="success">{act.message}</Alert>
            <Alert>{act.error}</Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required error={act.fieldErrors.name}><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Description"><Input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            </div>
            <PermissionGrid matrix={matrix} base={[]} allow={edit.permissions} deny={[]} allowDeny={false}
              onChange={(allow) => setEdit({ ...edit, permissions: allow })} scopes={edit.departmentScopes}
              onScopes={(departmentScopes) => setEdit({ ...edit, departmentScopes })} departments={departments} />
          </div>
        </Card>
      )}
    </div>
  );
}
