'use client';

import { useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Loaded, PageHeader, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime, uploadBatches } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const OUTCOME_TONE: Record<string, string> = { Added: 'green', Unmatched: 'orange', Duplicate: 'slate', Failed: 'red' };
/** Mails are sent in small groups so a large folder does not become one huge request. */
const MAILS_PER_REQUEST = 20;

type Picked = { name: string; mails: File[]; others: number };

/** CV Bank → Unmatched CVs: scan saved mails, then move what fits no job to a vacancy, or delete it. */
export default function UnmatchedCvsPage() {
  const { can } = useAuth();
  const allowed = can(P.CV_UPLOAD) && can(P.RECRUITMENT_ALL);
  const state = useLoad(() => (allowed ? api('/intake/unmatched') : Promise.resolve([])), [allowed]);
  const folder = useLoad(() => (allowed ? api('/intake/mail-folder') : Promise.resolve(null)), [allowed]);
  const vacancies = useLoad(() => (allowed ? api('/vacancies?pageSize=200') : Promise.resolve({ items: [] })), [allowed]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState({ departmentId: '', designation: '', vacancyId: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [progress, setProgress] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const act = useAction();
  const scan = useAction();

  // Move targets: every vacancy that is not Closed (Filled is kept so HR can still top up the Waiting pool).
  const open: any[] = useMemo(() => (vacancies.data?.items ?? []).filter((v: any) => v.status !== 'Closed'), [vacancies.data]);
  const departments = [...new Map(open.map((v) => [v.department.id, v.department.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const designations = [...new Set(open.filter((v) => v.department.id === target.departmentId).map((v) => v.positionTitle as string))].sort();
  const matches = open.filter((v) => v.department.id === target.departmentId && v.positionTitle === target.designation);
  const vacancyId = matches.length === 1 ? matches[0].id : target.vacancyId;

  const rows: any[] = state.data ?? [];
  const movable = rows.filter((m) => selected.has(m.id) && m.attachments.length > 0);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const done = () => { setSelected(new Set()); state.reload(); };

  /** Runs one request per selected mail so one failure does not stop the rest. */
  const each = async (ids: string[], call: (id: string) => Promise<any>, verb: string) => {
    const errors: string[] = [];
    await act.run(async () => {
      for (const id of ids) {
        try { await call(id); } catch (e: any) { errors.push(`${rows.find((m) => m.id === id)?.subject ?? 'Mail'}: ${e.message}`); }
      }
      return true;
    });
    act.setMessage(`${ids.length - errors.length} of ${ids.length} ${verb}.`);
    if (errors.length) act.setError(errors.join(' '));
    done();
  };
  const move = () => each(movable.map((m) => m.id), (id) => api(`/intake/${id}/assign`, { body: { vacancyId } }), 'moved and queued for extraction')
    .then(() => setTarget({ departmentId: '', designation: '', vacancyId: '' }));
  const remove = () => each([...selected], (id) => api(`/intake/${id}`, { method: 'DELETE' }), 'deleted permanently').then(() => setConfirmDelete(false));

  const finished = (r: any) => { if (r) { setResult(r); state.reload(); folder.reload(); } };
  const scanServerFolder = async () => finished(await scan.run(() => api('/intake/scan', { method: 'POST' })));
  const choose = (files: FileList | null) => {
    const all = Array.from(files ?? []);
    if (!all.length) return;
    const mails = all.filter((f) => f.name.toLowerCase().endsWith('.eml'));
    setPicked({ name: all[0].webkitRelativePath.split('/')[0] || 'Selected folder', mails, others: all.length - mails.length });
    setResult(null);
  };
  const scanPicked = async () => {
    if (!picked) return;
    const r = await scan.run(async () => {
      const total: any = { scanned: 0, cvsAdded: 0, remaining: 0, items: [] };
      let sent = 0;
      for (const batch of uploadBatches(picked.mails, MAILS_PER_REQUEST)) {
        sent += batch.length;
        setProgress(`Scanning ${sent} of ${picked.mails.length}…`);
        const form = new FormData();
        batch.forEach((f) => form.append('files', f, f.name));
        const part = await api('/intake/scan-files', { form });
        total.scanned += part.scanned;
        total.cvsAdded += part.cvsAdded;
        total.items.push(...part.items);
      }
      return total;
    });
    setProgress('');
    if (r) setPicked(null);
    finished(r);
  };

  const header = <PageHeader title="Unmatched CVs" back={{ href: '/cv-bank', label: 'CV Bank' }}
    subtitle="CVs from saved mails whose subject fits no open job. Select them to move them to a vacancy by department and designation, or delete them." />;
  if (!allowed) return (<>{header}<Alert>Only HR Manager and Super Admin can see unmatched CVs.</Alert></>);

  return (
    <>
      {header}
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert>{scan.error}</Alert><Alert tone="success">{act.message}</Alert></div>

      <Card className="mb-4" title="Scan mails">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              {picked ? (
                <>
                  Folder <span className="font-semibold">{picked.name}</span>: <span className="font-semibold">{picked.mails.length}</span> mail{picked.mails.length === 1 ? '' : 's'} found
                  {picked.others > 0 && <span className="text-muted"> ({picked.others} other file{picked.others === 1 ? '' : 's'} ignored)</span>}
                  {!picked.mails.length && <div className="text-xs text-amber-700">No .eml files in this folder. Save mails as .eml files.</div>}
                </>
              ) : <span className="text-muted">Choose the folder where CV mails are saved as .eml files. Each subject is matched to a circular&apos;s position and department; anything unclear lands below.</span>}
              {progress && <div className="text-xs text-muted">{progress}</div>}
            </div>
            <div className="flex gap-2">
              <input ref={picker} type="file" multiple hidden aria-label="Mail folder" {...({ webkitdirectory: '' } as object)}
                onChange={(e) => { choose(e.target.files); e.target.value = ''; }} />
              <Button variant="secondary" disabled={scan.busy} onClick={() => picker.current?.click()}>Choose folder</Button>
              <Button busy={scan.busy} disabled={!picked?.mails.length} onClick={scanPicked}>Scan selected folder</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div className="text-sm text-muted">
              Server folder <span className="font-mono text-xs">mail-inbox</span>: <span className="font-semibold">{folder.data?.pending ?? '…'}</span> mail{folder.data?.pending === 1 ? '' : 's'} waiting
              {folder.data?.unsupported?.length > 0 && <div className="text-xs text-amber-700">Not read: {folder.data.unsupported.join(', ')}. Save mails as .eml files.</div>}
            </div>
            <Button variant="secondary" busy={scan.busy} onClick={scanServerFolder}>Scan server folder</Button>
          </div>
        </div>
      </Card>

      {result && (
        <Card className="mb-4" pad={false} title={`Scan result: ${result.scanned} mail${result.scanned === 1 ? '' : 's'}, ${result.cvsAdded} CV${result.cvsAdded === 1 ? '' : 's'} added${result.remaining ? `, ${result.remaining} still waiting: scan again` : ''}`}>
          {result.items.length > 0 && (
            <Table head={['File', 'Subject', 'Result', 'Vacancy', 'CVs added', 'Note']}>
              {result.items.map((i: any, n: number) => (
                <tr key={`${i.file}-${n}`}>
                  <Td className="max-w-[12rem] break-words text-xs">{i.file}</Td>
                  <Td className="max-w-xs text-xs">{i.subject || '—'}</Td>
                  <Td><Badge tone={OUTCOME_TONE[i.outcome]}>{i.outcome}</Badge></Td>
                  <Td className="whitespace-nowrap text-xs">{i.vacancyNo ?? '—'}</Td>
                  <Td className="text-xs tabular-nums">{i.cvsAdded}</Td>
                  <Td className="max-w-xs text-xs">{i.reason ?? ''}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Card pad={false} title={`Unmatched CVs (${rows.length})`}>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-end gap-3 border-b border-line bg-brand-50 px-3 py-3 text-sm">
            <b className="self-center">{selected.size} selected</b>
            <Field label="Department"><Select className="w-48" value={target.departmentId} placeholder="Select…" onChange={(e) => setTarget({ departmentId: e.target.value, designation: '', vacancyId: '' })} options={departments.map(([id, name]) => ({ value: id, label: name }))} /></Field>
            <Field label="Designation"><Select className="w-52" value={target.designation} placeholder={target.departmentId ? 'Select…' : 'Choose a department'} disabled={!target.departmentId} onChange={(e) => setTarget({ ...target, designation: e.target.value, vacancyId: '' })} options={designations.map((d) => ({ value: d, label: d }))} /></Field>
            {matches.length > 1 && (
              <Field label="Vacancy"><Select className="w-56" value={target.vacancyId} placeholder="Several open: choose…" onChange={(e) => setTarget({ ...target, vacancyId: e.target.value })} options={matches.map((v) => ({ value: v.id, label: `${v.vacancyNo} · ${v.company?.code ?? ''}` }))} /></Field>
            )}
            <Button busy={act.busy} disabled={!vacancyId || !movable.length} onClick={move}>Move to vacancy{matches.length === 1 ? ` ${matches[0].vacancyNo}` : ''}</Button>
            <Button variant="danger" disabled={act.busy} onClick={() => setConfirmDelete(true)}>Delete</Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            {movable.length < selected.size && <span className="self-center text-xs text-amber-700">{selected.size - movable.length} selected mail{selected.size - movable.length === 1 ? ' has' : 's have'} no CV and can only be deleted.</span>}
          </div>
        )}
        <Loaded state={state} empty={(d: any[]) => !d.length && 'No unmatched CVs.'}>
          {(list: any[]) => (
            <Table head={[<input key="all" type="checkbox" aria-label="Select all" className="accent-brand-600" checked={list.length > 0 && list.every((m) => selected.has(m.id))}
              onChange={(e) => setSelected(e.target.checked ? new Set(list.map((m) => m.id)) : new Set())} />, 'Received', 'Sender', 'Subject', 'CV files', 'Status']}>
              {list.map((m) => (
                <tr key={m.id} className={selected.has(m.id) ? 'bg-brand-50/50' : 'hover:bg-slate-50'}>
                  <Td><input type="checkbox" className="accent-brand-600" aria-label={`Select ${m.subject ?? 'mail'}`} checked={selected.has(m.id)} onChange={() => toggle(m.id)} /></Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(m.receivedAt)}</Td>
                  <Td className="text-xs">{m.sender}</Td>
                  <Td className="max-w-xs text-xs">{m.subject}</Td>
                  <Td className="text-xs">{m.attachments.length ? m.attachments.map((a: any, i: number) => <div key={i}>{a.originalName}{a.error && <span className="text-red-700"> — {a.error}</span>}</div>) : <span className="text-muted">No CV attached</span>}</Td>
                  <Td><Badge>{m.status}</Badge>{m.error && <div className="mt-1 max-w-xs text-xs text-red-700">{m.error}</div>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Loaded>
      </Card>

      <ConfirmDialog open={confirmDelete} danger title="Delete unmatched CVs permanently" confirmLabel="Delete permanently" busy={act.busy} error={act.error}
        message={<>The {selected.size} selected mail{selected.size === 1 ? '' : 's'} and {selected.size === 1 ? 'its' : 'their'} CV files will be erased. This cannot be undone; only an audit entry remains. Scanning the same mail again would bring it back.</>}
        onConfirm={remove} onClose={() => setConfirmDelete(false)} />
    </>
  );
}
