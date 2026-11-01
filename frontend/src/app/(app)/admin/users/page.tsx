'use client';

import { useState } from 'react';
import { Alert, Loading, PageHeader, Tabs, useLoad } from '@/components/ui';
import { PermissionsTab, RolesTab, TemplatesTab } from '@/components/admin/RolesTemplatesTabs';
import { UsersTab } from '@/components/admin/UsersTab';
import { api } from '@/lib/api';

export default function UsersPage() {
  const [tab, setTab] = useState('users');
  const users = useLoad(() => api('/admin/users'));
  const roles = useLoad(() => api('/admin/roles'));
  const templates = useLoad(() => api('/admin/permission-templates'));
  const matrix = useLoad(() => api('/admin/permission-matrix'));
  const lookups = useLoad(() => api('/master/lookups'));
  const all = [users, roles, templates, matrix, lookups];
  const error = all.find((s) => s.error)?.error;
  const ready = all.every((s) => s.data);
  const departments = (lookups.data?.departments ?? []).map((d: any) => ({ id: d.id, name: d.name }));

  return (
    <>
      <PageHeader title="Users & Roles" subtitle="Manage user accounts, roles and permissions for ARS. Approvers use their own named accounts; every change is audited." />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'users', label: 'Users' }, { key: 'roles', label: 'Roles' },
        { key: 'permissions', label: 'Permissions' }, { key: 'templates', label: 'Permission Templates' },
      ]} />
      {error ? <Alert>{error}</Alert> : !ready ? <Loading /> : (
        <>
          {tab === 'users' && <UsersTab users={users.data} roles={roles.data} templates={templates.data} matrix={matrix.data} departments={departments}
            onSaved={users.reload} onTemplateSaved={templates.reload} />}
          {tab === 'roles' && <RolesTab roles={roles.data} users={users.data} matrix={matrix.data} onSaved={roles.reload} />}
          {tab === 'permissions' && <PermissionsTab matrix={matrix.data} roles={roles.data} onSaved={matrix.reload} />}
          {tab === 'templates' && <TemplatesTab templates={templates.data} matrix={matrix.data} departments={departments} onSaved={templates.reload} />}
        </>
      )}
    </>
  );
}
