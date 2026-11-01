'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Badge, Button, Card, Input, Loaded, PageHeader, Pager, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, fmtDateTime, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const LINK: Record<string, (id: string) => string | null> = { EXTRACTION: (id) => `/applications/${id}`, SCREENING: (id) => `/applications/${id}`, EMAIL_SEND: () => null };

function Monitor() {
  const sp = useSearchParams();
  const { can } = useAuth();
  const [f, setF] = useState({ type: '', status: sp.get('status') ?? '', q: '', from: '' });
  const [page, setPage] = useState(1);
  const state = useLoad(() => api(`/monitor/jobs${qs({ ...f, page })}`), [f, page]);
  const act = useAction();
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title="Processing monitor" subtitle="Background CV extraction, screening and email jobs. Retry is explicit and safe — it never duplicates records."
        actions={<Button variant="secondary" onClick={state.reload}>Refresh</Button>} />
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>
      {state.data?.summary?.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {state.data.summary.map((s: any) => <span key={`${s.type}${s.status}`} className="rounded border border-line bg-white px-2 py-1">{s.type} · <Badge>{s.status}</Badge> <b>{s.n}</b></span>)}
        </div>
      )}
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Select className="max-w-[12rem]" value={f.type} onChange={(e) => set('type', e.target.value)} placeholder="All job types" options={['EXTRACTION', 'SCREENING', 'EMAIL_SEND'].map((v) => ({ value: v, label: v }))} />
          <Select className="max-w-[12rem]" value={f.status} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={['Queued', 'Processing', 'Completed', 'Partial', 'Failed'].map((v) => ({ value: v, label: v }))} />
          <Input type="date" className="max-w-[10rem]" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
          <Input className="max-w-xs" placeholder="Search record or error…" value={f.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <Loaded state={state} empty={(d: any) => !d.items.length && 'No jobs match.'}>
          {(d: any) => (
            <>
              <Table head={['Created', 'Type', 'Source record', 'Status', 'Attempts', 'Error / note', 'Finished', '']}>
                {d.items.map((j: any) => {
                  const href = LINK[j.type]?.(j.refId);
                  return (
                    <tr key={j.id}>
                      <Td className="whitespace-nowrap text-xs">{fmtDateTime(j.createdAt)}</Td>
                      <Td className="text-xs">{j.type}</Td>
                      <Td className="text-xs">{href ? <Link className="text-brand-700 hover:underline" href={href}>{j.refLabel ?? j.refId}</Link> : j.refLabel ?? j.refId}</Td>
                      <Td><Badge>{j.status}</Badge></Td>
                      <Td className="tabular-nums">{j.attempts}</Td>
                      <Td className="max-w-md text-xs text-red-700">{j.error}</Td>
                      <Td className="whitespace-nowrap text-xs">{fmtDateTime(j.completedAt)}</Td>
                      <Td>{j.status === 'Failed' && can(P.MONITOR_RETRY) && <Button size="sm" variant="secondary" onClick={() => act.run(() => api(`/monitor/jobs/${j.id}/retry`, { method: 'POST' }), (r: any) => r.message).then(() => setTimeout(state.reload, 1500))}>Retry</Button>}</Td>
                    </tr>
                  );
                })}
              </Table>
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}

export default function MonitorPage() {
  return <Suspense><Monitor /></Suspense>;
}
