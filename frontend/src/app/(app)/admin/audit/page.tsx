'use client';

import { useState } from 'react';
import { Card, Input, Loaded, PageHeader, Pager, Select, Table, Td, useLoad } from '@/components/ui';
import { api, fmtDateTime, qs } from '@/lib/api';

const ENTITIES = ['Requisition', 'ApprovalRoute', 'ManpowerQuota', 'Vacancy', 'JobPost', 'Application', 'Candidate', 'ImportBatch', 'EmailTemplate', 'EmailBatch', 'User', 'Role', 'ProcessingJob'];

const fmt = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function AuditPage() {
  const [f, setF] = useState({ q: '', entityType: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const state = useLoad(() => api(`/audit${qs({ ...f, page, pageSize: 50 })}`), [f, page]);
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title="Audit log" subtitle="Read-only record of critical actions with actor, time and old → new values." />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search record, actor…" value={f.q} onChange={(e) => set('q', e.target.value)} />
          <Select className="max-w-[12rem]" value={f.entityType} onChange={(e) => set('entityType', e.target.value)} placeholder="All record types" options={ENTITIES.map((v) => ({ value: v, label: v }))} />
          <Input className="max-w-[12rem]" placeholder="Action (e.g. approve)" value={f.action} onChange={(e) => set('action', e.target.value)} />
          <Input type="date" className="max-w-[10rem]" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="From" />
          <Input type="date" className="max-w-[10rem]" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="To" />
        </div>
        <Loaded state={state} empty={(d: any) => !d.items.length && 'No audit events match.'}>
          {(d: any) => (
            <>
              <Table head={['When', 'Actor', 'Action', 'Record', 'Changes']}>
                {d.items.map((e: any) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</Td>
                    <Td className="text-xs">{e.actorName}</Td>
                    <Td className="text-xs font-medium">{e.action}</Td>
                    <Td className="text-xs">{e.entityType}<div className="text-muted">{e.entityLabel ?? e.entityId}</div></Td>
                    <Td className="max-w-xl text-xs">
                      {e.newValues ? Object.keys(e.newValues).map((k) => (
                        <div key={k} className="break-words"><b>{k}</b>: {e.oldValues && k in e.oldValues ? <><span className="text-red-700 line-through">{fmt(e.oldValues[k])}</span> → </> : null}<span className="text-emerald-800">{fmt(e.newValues[k])}</span></div>
                      )) : '—'}
                    </Td>
                  </tr>
                ))}
              </Table>
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}
