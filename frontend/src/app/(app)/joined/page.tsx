'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, Input, Loaded, PageHeader, Pager, Select, Table, Td, useLoad } from '@/components/ui';
import { api, fmtDate, fmtDateTime, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

export default function JoinedPage() {
  const { can } = useAuth();
  // Department users see their own department's joiners, without candidate records or contact details.
  const hr = can(P.CANDIDATE_VIEW);
  const [f, setF] = useState({ q: '', departmentId: '', position: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const lookups = useLoad(() => api('/master/lookups'));
  const state = useLoad(() => api(`/joining/joined${qs({ ...f, page })}`), [f, page]);
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title="Joined candidate list" subtitle={hr ? "Only candidates whose actual joining has been verified and approved by HR." : "Candidates who joined your department, verified and approved by HR."} />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Input className="max-w-[14rem]" placeholder="Name or ID…" value={f.q} onChange={(e) => set('q', e.target.value)} />
          {hr && <Select className="max-w-[14rem]" value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)} placeholder="All departments" options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />}
          <Input className="max-w-[12rem]" placeholder="Position…" value={f.position} onChange={(e) => set('position', e.target.value)} />
          <Input type="date" className="max-w-[10rem]" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="Joined from" />
          <Input type="date" className="max-w-[10rem]" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="Joined to" />
        </div>
        <Loaded state={state} empty={(d: any) => !d.items.length && 'No approved joinings match these filters.'}>
          {(d: any) => (
            <>
              <Table head={['Candidate ID', 'Application ID', 'Name', 'Department', 'Company', 'Position', 'Vacancy', ...(hr ? ['Contact'] : []), 'Final selection', 'Joining date', 'Approved by']}>
                {d.items.map((j: any) => (
                  <tr key={j.id}>
                    <Td>{j.candidateNo}</Td>
                    <Td>{hr ? <Link className="text-brand-700 hover:underline" href={`/applications/${j.applicationId}`}>{j.applicationNo}</Link> : j.applicationNo}</Td>
                    <Td className="font-medium">{j.name}</Td>
                    <Td>{j.department}</Td>
                    <Td className="text-xs">{j.company}</Td>
                    <Td>{j.position}</Td>
                    <Td>{hr ? <Link className="text-brand-700 hover:underline" href={`/vacancies/${j.vacancyId}`}>{j.vacancyNo}</Link> : j.vacancyNo}</Td>
                    {hr && <Td className="text-xs">{j.email}<div className="text-muted">{j.phone}</div></Td>}
                    <Td className="text-xs">{j.finalDecision} · {fmtDate(j.finalDecisionAt)}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(j.joiningDate)}</Td>
                    <Td className="text-xs">{j.approvedBy}<div className="text-muted">{fmtDateTime(j.approvedAt)}</div></Td>
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
