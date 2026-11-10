'use client';

import { useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { Alert, Button, Field, Input, Modal, useAction } from '../ui';

const todayKey = () => new Date().toLocaleDateString('en-CA');

/**
 * Interview Board "Send to joining" (owner, 2026-11-08): the selected candidates get the final decision Selected and one planned
 * joining date, and wait in Joining Pending. Each is checked on its own; those refused stay selected and are listed.
 */
export function SendToJoiningDialog({ open, rows, onClose, onSaved }: {
  open: boolean; rows: any[]; onClose: () => void; onSaved: (msg: string, failedIds: string[]) => void;
}) {
  const [date, setDate] = useState(todayKey());
  const [failures, setFailures] = useState<string[]>([]);
  const act = useAction();
  useEffect(() => { if (open) { setDate(todayKey()); setFailures([]); } }, [open]);
  const skipped = rows.filter((r) => r.joining && r.joining.status !== 'Pending');

  const send = async () => {
    const r: any = await act.run(() => api('/applications/send-to-joining', { body: { applicationIds: rows.map((x) => x.applicationId), joiningDate: date } }));
    if (!r) return;
    const label = (id: string) => { const x = rows.find((y) => y.applicationId === id); return x ? `${x.name ?? x.applicationNo} (${x.applicationNo})` : id; };
    const failed = r.results.filter((x: any) => !x.ok);
    if (failed.length) setFailures(failed.map((x: any) => `${label(x.applicationId)}: ${x.error}`));
    if (r.sent) onSaved(`${r.sent} candidate${r.sent === 1 ? '' : 's'} sent to Joining Pending with planned joining date ${fmtDate(date)}.${failed.length ? ` ${failed.length} could not be sent and stay selected.` : ''}`, failed.map((x: any) => x.applicationId));
  };

  return (
    <Modal open={open} title={`Send ${rows.length} candidate${rows.length === 1 ? '' : 's'} to joining`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={act.busy} disabled={!date || !rows.length} onClick={send}>Send to joining</Button></>}>
      <div className="space-y-3">
        <p className="text-sm">The final decision of each candidate becomes <b>Selected</b> and they move to <b>Joining Pending</b> with this planned joining date. Their actual joining is still approved on the Joining page.</p>
        <ul className="max-h-48 list-disc overflow-auto pl-5 text-sm">
          {rows.map((r) => <li key={r.applicationId}><b>{r.name ?? r.applicationNo}</b> ({r.applicationNo}) · {r.vacancy.positionTitle}, {r.vacancy.vacancyNo}
            {r.finalDecision !== 'Selected' && <span className="text-xs text-muted"> · now {r.finalDecision}</span>}</li>)}
        </ul>
        <Field label="Planned joining date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {skipped.length > 0 && <Alert tone="warning">{skipped.length} of them already joined or were rejected at joining; they will not be changed.</Alert>}
        {failures.length > 0 && <Alert>Not sent: {failures.join(' · ')}</Alert>}
        <Alert>{act.error}</Alert>
      </div>
    </Modal>
  );
}
