'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Loaded, PageHeader, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime } from '@/lib/api';

export default function IntakePage() {
  const state = useLoad(() => api('/intake/unmatched'));
  const vacancies = useLoad(() => api('/vacancies?pageSize=200'));
  const [choice, setChoice] = useState<Record<string, string>>({});
  const act = useAction();
  const open = (vacancies.data?.items ?? []).filter((v: any) => !['Closed', 'Filled'].includes(v.status));
  return (
    <>
      <PageHeader title="Unmatched CVs" subtitle="Emailed CVs whose vacancy could not be identified reliably. ARS never guesses — assign each one manually." />
      <div className="mb-3 space-y-2">
        <Alert tone="info">Mailbox intake is not connected in this prototype build (mailbox and protocol are pending confirmation, SRS 25). Use manual upload on each vacancy; items appear here once mailbox sync is configured.</Alert>
        <Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert>
      </div>
      <Card pad={false}>
        <Loaded state={state} empty={(d: any[]) => !d.length && 'No unmatched CVs.'}>
          {(rows: any[]) => (
            <Table head={['Received', 'Sender', 'Subject', 'Attachments', 'Status', 'Assign to vacancy']}>
              {rows.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(m.receivedAt)}</Td>
                  <Td className="text-xs">{m.sender}</Td>
                  <Td className="max-w-xs text-xs">{m.subject}</Td>
                  <Td className="text-xs">{m.attachments.map((a: any, i: number) => <div key={i}>{a.originalName}{a.error && <span className="text-red-700"> — {a.error}</span>}</div>)}</Td>
                  <Td><Badge>{m.status}</Badge>{m.error && <div className="text-xs text-red-700">{m.error}</div>}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Select className="w-56" value={choice[m.id] ?? ''} placeholder="Select vacancy…" onChange={(e) => setChoice({ ...choice, [m.id]: e.target.value })} options={open.map((v: any) => ({ value: v.id, label: `${v.vacancyNo} — ${v.positionTitle}` }))} />
                      <Button size="sm" disabled={!choice[m.id]} busy={act.busy} onClick={() => act.run(() => api(`/intake/${m.id}/assign`, { body: { vacancyId: choice[m.id] } }), 'Assigned and queued for extraction.').then(state.reload)}>Assign</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Loaded>
      </Card>
    </>
  );
}
