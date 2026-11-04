'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, Loaded, PageHeader, Select, Table, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime } from '@/lib/api';

const KINDS = [['INTERVIEW_INVITE', 'Interview invitation'], ['RESULT', 'Result / confirmation'], ['JOINING_LETTER', 'Joining letter'], ['GENERAL', 'General']];

export default function TemplatesPage() {
  const state = useLoad(() => api('/email/templates'));
  const meta = useLoad(() => api('/email/placeholders'));
  const [edit, setEdit] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = useAction();
  const save = async () => {
    const body = { name: edit.name, kind: edit.kind, subject: edit.subject, body: edit.body, active: edit.active ?? true };
    const r = await act.run(() => (edit.id ? api(`/email/templates/${edit.id}`, { method: 'PUT', body }) : api('/email/templates', { body })), (t: any) => `Saved (version ${t.version}).`);
    if (r) { setEdit(r); state.reload(); }
  };
  const remove = async () => {
    const r = await act.run(() => api(`/email/templates/${edit.id}`, { method: 'DELETE' }), 'Template deleted. Emails already sent keep their text.');
    setConfirmDelete(false);
    if (r) { setEdit(null); state.reload(); }
  };
  return (
    <>
      <PageHeader title="Email templates" subtitle="Templates are versioned; each sent email records the template version used."
        actions={<Button onClick={() => setEdit({ kind: 'INTERVIEW_INVITE', name: '', subject: '', body: '', active: true })}>New template</Button>} />
      {meta.data?.transport === 'dev-outbox' && <div className="mb-3"><Alert tone="warning">SMTP is not configured. Sent emails are written to the dev outbox and are not delivered.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" pad={false}>
          <Loaded state={state} empty={(d: any[]) => !d.length && 'No templates.'}>
            {(rows: any[]) => (
              <Table head={['Template', 'Type', 'Version', 'Updated']}>
                {rows.map((t) => (
                  <tr key={t.id} className={`cursor-pointer hover:bg-slate-50 ${edit?.id === t.id ? 'bg-brand-50' : ''}`} onClick={() => setEdit({ ...t })}>
                    <Td className="font-medium">{t.name}{!t.active && <> <Badge>inactive</Badge></>}</Td>
                    <Td className="text-xs">{KINDS.find((k) => k[0] === t.kind)?.[1]}</Td>
                    <Td>v{t.version}</Td>
                    <Td className="text-xs">{fmtDateTime(t.updatedAt)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Loaded>
        </Card>
        <Card className="lg:col-span-3" title={edit ? (edit.id ? `Edit: ${edit.name}` : 'New template') : 'Select a template'}>
          {edit ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name" className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                <Field label="Type"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} options={KINDS.map(([v, l]) => ({ value: v, label: l }))} /></Field>
              </div>
              <Field label="Subject"><Input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
              <Field label="Body" hint={<>Allowed placeholders: {(meta.data?.placeholders ?? []).map((p: string) => `{{${p}}}`).join(' ')}</>}>
                <Textarea rows={16} className="font-mono text-xs" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
              <Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert>
              <div className="flex justify-end gap-2">{edit.id && <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>Delete</Button>}<Button variant="secondary" onClick={() => setEdit(null)}>Close</Button><Button busy={act.busy} onClick={save}>Save</Button></div>
            </div>
          ) : <p className="text-sm text-muted">Choose a template on the left or create a new one.</p>}
        </Card>
      </div>
      <ConfirmDialog open={confirmDelete} danger title={`Delete template ${edit?.name ?? ''}`} confirmLabel="Delete" busy={act.busy}
        message="The template and all its versions are removed for good. Emails already sent keep their own subject and text."
        onConfirm={remove} onClose={() => setConfirmDelete(false)} />
    </>
  );
}
