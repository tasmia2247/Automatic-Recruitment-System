'use client';

import { useEffect, useState } from 'react';
import { api, newKey } from '@/lib/api';
import { Alert, Badge, Button, Field, Input, Modal, Select, Table, Td, Textarea, useAction, useLoad } from './ui';

const KIND_LABEL: Record<string, string> = { INTERVIEW_INVITE: 'Interview invitation', RESULT: 'Result / confirmation', JOINING_LETTER: 'Joining letter', GENERAL: 'General' };

/** Extra per-send values HR can type; everything else comes from ARS records. */
const EXTRA_VARS: Record<string, { key: string; label: string }[]> = {
  INTERVIEW_INVITE: [{ key: 'instructions', label: 'Instructions' }, { key: 'location', label: 'Venue (overrides schedule)' }],
  RESULT: [],
  JOINING_LETTER: [{ key: 'reportingTime', label: 'Reporting time' }, { key: 'contactPerson', label: 'Contact person (name, phone)' }],
  GENERAL: [{ key: 'instructions', label: 'Instructions' }],
};

/** Compose → preview every recipient → explicit confirmation → individual emails (SRS 12.3/12.4, 13.7). */
export function EmailComposer({ open, onClose, kind, applicationIds, onSent }: { open: boolean; onClose: () => void; kind: string; applicationIds: string[]; onSent?: () => void }) {
  const templates = useLoad(() => (open ? api(`/email/templates?kind=${kind}`) : Promise.resolve([])), [open, kind]);
  const meta = useLoad(() => api('/email/placeholders'), []);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<any[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [clientKey, setClientKey] = useState(newKey());
  const act = useAction();

  useEffect(() => {
    if (!open) return;
    setPreview(null); setResult(null); setConfirmed(false); setClientKey(newKey()); setVars({});
  }, [open]);
  useEffect(() => {
    const t = (templates.data ?? []).find((x: any) => x.id === templateId) ?? (templates.data ?? []).find((x: any) => x.active);
    if (t && !templateId) setTemplateId(t.id);
    if (t) { setSubject(t.subject); setBody(t.body); }
  }, [templates.data, templateId]);

  const payload = () => ({ applicationIds, kind, templateId: templateId || undefined, subject, body, variables: vars });
  const doPreview = async () => {
    setConfirmed(false);
    const r = await act.run(() => api('/email/preview', { body: payload() }));
    if (r) setPreview(r);
  };
  const send = async () => {
    const r = await act.run(() => api('/email/send', { body: { ...payload(), clientKey, confirmed } }));
    if (r) { setResult(r); onSent?.(); }
  };
  const okCount = preview?.filter((p) => p.ok).length ?? 0;

  return (
    <Modal open={open} wide title={`${KIND_LABEL[kind]} — ${applicationIds.length} candidate(s)`} onClose={onClose}
      footer={result ? <Button onClick={onClose}>Close</Button> : <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" busy={act.busy} onClick={doPreview}>Preview recipients</Button>
        <Button busy={act.busy} disabled={!preview || !confirmed || !okCount} onClick={send}>Send {okCount} individual email{okCount === 1 ? '' : 's'}</Button>
      </>}>
      {result ? (
        <div className="space-y-3">
          <Alert tone={result.duplicate ? 'info' : 'success'}>{result.duplicate ? 'This send request was already processed; nothing was sent twice.' : 'Emails queued. Each recipient gets a separate message; status updates appear in the Emails tab.'}</Alert>
          {result.transport === 'dev-outbox' && <Alert tone="warning">SMTP is not configured: messages are written to the dev outbox and are <b>not delivered</b>.</Alert>}
          <Table head={['Application', 'Recipient', 'Status', 'Notes']}>
            {result.results.map((r: any) => <tr key={r.applicationId}><Td>{r.applicationNo}</Td><Td>{r.recipient ?? '—'}</Td><Td><Badge>{r.status}</Badge></Td><Td className="text-xs text-red-700">{r.errors?.join(' ')}</Td></tr>)}
          </Table>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Template"><Select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setPreview(null); }} placeholder="(no template)" options={(templates.data ?? []).map((t: any) => ({ value: t.id, label: `${t.name} (v${t.version})` }))} /></Field>
            {(EXTRA_VARS[kind] ?? []).map((v) => <Field key={v.key} label={v.label}><Input value={vars[v.key] ?? ''} onChange={(e) => { setVars({ ...vars, [v.key]: e.target.value }); setPreview(null); }} /></Field>)}
          </div>
          <Field label="Subject"><Input value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} /></Field>
          <Field label="Message" hint={<>Placeholders: {(meta.data?.placeholders ?? []).map((p: string) => `{{${p}}}`).join(' ')}. Edits here apply to this send only.</>}>
            <Textarea rows={10} value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} className="font-mono text-xs" />
          </Field>
          <Alert>{act.error}</Alert>
          {preview && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Preview ({okCount} ready, {preview.length - okCount} with problems)</div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {preview.map((p) => (
                  <details key={p.applicationId} className={`rounded border p-2 text-sm ${p.ok ? 'border-line' : 'border-red-200 bg-red-50/40'}`}>
                    <summary className="cursor-pointer"><b>{p.candidateName ?? p.applicationNo}</b> &lt;{p.recipient ?? 'no email'}&gt; {p.ok ? <Badge tone="green">Ready</Badge> : <Badge tone="red">Will be skipped</Badge>}
                      {!p.ok && <span className="ml-2 text-xs text-red-700">{p.errors.join(' ')}</span>}</summary>
                    <div className="mt-2 text-xs"><b>Subject:</b> {p.subject}</div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{p.body}</pre>
                  </details>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="accent-brand-600" />
                I have reviewed the preview and want to send {okCount} separate email{okCount === 1 ? '' : 's'}.</label>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
