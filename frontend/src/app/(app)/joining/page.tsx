'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmailComposer } from '@/components/EmailComposer';
import { Alert, Button, Card, ConfirmDialog, Field, Input, Loaded, Modal, PageHeader, Select, Table, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

export default function JoiningPendingPage() {
  const { can } = useAuth();
  const state = useLoad(() => api('/joining/pending'));
  const [approve, setApprove] = useState<any | null>(null);
  const [notJoined, setNotJoined] = useState<any | null>(null);
  const [letterFor, setLetterFor] = useState<string | null>(null);
  const act = useAction();

  const update = (j: any, body: any) => act.run(() => api(`/joining/${j.id}`, { method: 'PUT', body })).then(state.reload);
  const doApprove = async () => {
    const r = await act.run(() => api(`/joining/${approve.id}/approve`, { body: { joiningDate: approve.joiningDate, remarks: approve.remarks || undefined } }), 'Joining approved. The candidate now appears in the Joined Candidate List.');
    if (r) { setApprove(null); state.reload(); }
  };

  return (
    <>
      <PageHeader title="Joining pending" subtitle="Final-selected candidates. Sending a joining letter does not mark anyone as joined — HR must verify actual joining and approve it here." />
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>
      <Card pad={false}>
        <Loaded state={state} empty={(d: any[]) => !d.length && 'No final-selected candidates are waiting for joining confirmation.'}>
          {(rows: any[]) => (
            <Table head={['Candidate', 'Position / Vacancy', 'Department · Company', 'Contact', 'Planned joining date', 'Joining letter', '']}>
              {rows.map((j) => (
                <tr key={j.id}>
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`/applications/${j.applicationId}`}>{j.name}</Link><div className="text-xs text-muted">{j.candidateNo} · {j.applicationNo}</div></Td>
                  <Td>{j.position}<div className="text-xs text-muted">{j.vacancyNo}</div></Td>
                  <Td className="text-xs">{j.department}<div className="text-muted">{j.company}</div></Td>
                  <Td className="text-xs">{j.email}<div className="text-muted">{j.phone}</div></Td>
                  <Td><Input type="date" className="w-40" defaultValue={j.joiningDate ?? ''} disabled={!can(P.JOINING_APPROVE)} onBlur={(e) => e.target.value !== (j.joiningDate ?? '') && update(j, { joiningDate: e.target.value || null })} /></Td>
                  <Td>
                    <Select className="w-36 text-xs" value={j.letterStatus} disabled={!can(P.JOINING_APPROVE)} onChange={(e) => update(j, { letterStatus: e.target.value })} options={['Not Prepared', 'Prepared', 'Sent'].map((x) => ({ value: x, label: x }))} />
                    {can(P.EMAIL_SEND) && <Button size="sm" variant="ghost" className="mt-1" disabled={!j.joiningDate} title={!j.joiningDate ? 'Set the joining date first' : undefined} onClick={() => setLetterFor(j.applicationId)}>Email joining letter</Button>}
                  </Td>
                  <Td>{can(P.JOINING_APPROVE) && (
                    <div className="flex flex-col gap-1">
                      <Button size="sm" onClick={() => setApprove({ ...j, joiningDate: j.joiningDate ?? '', remarks: '' })}>Verify & approve joining</Button>
                      <Button size="sm" variant="danger" onClick={() => setNotJoined(j)}>Did not join</Button>
                    </div>
                  )}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Loaded>
      </Card>

      <Modal open={!!approve} title="Approve actual joining" onClose={() => setApprove(null)}
        footer={<><Button variant="secondary" onClick={() => setApprove(null)}>Cancel</Button><Button busy={act.busy} disabled={!approve?.joiningDate} onClick={doApprove}>Approve joining</Button></>}>
        {approve && (
          <div className="space-y-3">
            <p className="text-sm">Confirm that <b>{approve.name}</b> ({approve.applicationNo}) has actually joined as <b>{approve.position}</b>.</p>
            <Field label="Verified joining date" required><Input type="date" value={approve.joiningDate} onChange={(e) => setApprove({ ...approve, joiningDate: e.target.value })} /></Field>
            <Field label="Remarks"><Textarea value={approve.remarks} onChange={(e) => setApprove({ ...approve, remarks: e.target.value })} /></Field>
            <Alert>{act.error}</Alert>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!notJoined} title="Mark as did not join" danger confirmLabel="Confirm" requireReason reasonLabel="Remarks" busy={act.busy} error={act.error}
        onConfirm={(r) => act.run(() => api(`/joining/${notJoined.id}/not-joined`, { body: { remarks: r } })).then((x) => { if (x) { setNotJoined(null); state.reload(); } })} onClose={() => setNotJoined(null)} />
      {letterFor && <EmailComposer open kind="JOINING_LETTER" applicationIds={[letterFor]} onClose={() => setLetterFor(null)} onSent={state.reload} />}
    </>
  );
}

