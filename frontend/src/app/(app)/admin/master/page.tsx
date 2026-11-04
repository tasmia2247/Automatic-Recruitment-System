'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, ConfirmDialog, Input, Loaded, PageHeader, Table, Tabs, Td, useAction, useLoad } from '@/components/ui';
import { api } from '@/lib/api';

type Kind = 'companies' | 'departments' | 'positions';

export default function MasterDataPage() {
  const [tab, setTab] = useState<Kind>('companies');
  const state = useLoad(() => api('/master/lookups'));
  const [draft, setDraft] = useState<{ code: string; name: string }>({ code: '', name: '' });
  const [editing, setEditing] = useState<any | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);
  const act = useAction();

  const add = async () => {
    const body = tab === 'positions' ? { title: draft.name, code: draft.code || undefined } : { code: draft.code, name: draft.name };
    const r = await act.run(() => api(`/master/${tab}`, { body }), 'Added.');
    if (r) { setDraft({ code: '', name: '' }); state.reload(); }
  };
  const save = async (row: any) => {
    const body = tab === 'positions' ? { title: row.title, code: row.code || undefined, active: row.active } : { code: row.code, name: row.name, active: row.active };
    const r = await act.run(() => api(`/master/${tab}/${row.id}`, { method: 'PATCH', body }), 'Saved.');
    if (r) { setEditing(null); state.reload(); }
  };

  const remove = async () => {
    const r = await act.run(() => api(`/master/${tab}/${removing.id}`, { method: 'DELETE' }), 'Deleted.');
    setRemoving(null);
    if (r) state.reload();
  };
  const label = (row: any) => row.title ?? row.name;

  return (
    <>
      <PageHeader title="Master data" subtitle="Companies, departments and positions used across ARS. A record still used by requisitions, vacancies, quotas or users cannot be deleted; deactivate it instead." />
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>
      <Tabs active={tab} onChange={(k) => { setTab(k as Kind); setEditing(null); }} tabs={[{ key: 'companies', label: 'Companies' }, { key: 'departments', label: 'Departments' }, { key: 'positions', label: 'Positions' }]} />
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-[10rem]" placeholder={tab === 'positions' ? 'Code (optional)' : 'Code'} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          <Input className="max-w-sm" placeholder={tab === 'positions' ? 'Position title' : 'Name'} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Button busy={act.busy} disabled={!draft.name || (tab !== 'positions' && !draft.code)} onClick={add}>Add</Button>
        </div>
        <Loaded state={state}>
          {(d: any) => (
            <Table head={['Code', tab === 'positions' ? 'Title' : 'Name', 'Status', '']}>
              {d[tab].map((row: any) => {
                const e = editing?.id === row.id ? editing : null;
                const nameKey = tab === 'positions' ? 'title' : 'name';
                return (
                  <tr key={row.id}>
                    <Td>{e ? <Input className="w-28" value={e.code ?? ''} onChange={(ev) => setEditing({ ...e, code: ev.target.value })} /> : row.code ?? '—'}</Td>
                    <Td>{e ? <Input value={e[nameKey]} onChange={(ev) => setEditing({ ...e, [nameKey]: ev.target.value })} /> : row[nameKey]}</Td>
                    <Td>{e ? <label className="flex items-center gap-1 text-sm"><input type="checkbox" className="accent-brand-600" checked={e.active} onChange={(ev) => setEditing({ ...e, active: ev.target.checked })} /> Active</label>
                      : <Badge tone={row.active ? 'green' : 'slate'}>{row.active ? 'Active' : 'Inactive'}</Badge>}</Td>
                    <Td>{e ? <div className="flex gap-1"><Button size="sm" onClick={() => save(e)}>Save</Button><Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button></div>
                      : <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setEditing({ ...row })}>Edit</Button><Button size="sm" variant="danger" onClick={() => setRemoving(row)}>Delete</Button></div>}</Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Loaded>
      </Card>
      <ConfirmDialog open={!!removing} danger title={`Delete ${removing ? label(removing) : ''}`} confirmLabel="Delete" busy={act.busy}
        message="This removes it from the list for good. If anything still uses it, ARS refuses and says what, so you can deactivate it instead."
        onConfirm={remove} onClose={() => setRemoving(null)} />
    </>
  );
}
