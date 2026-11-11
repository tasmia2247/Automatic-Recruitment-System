'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Card, Input, Loaded, PageHeader, Pager, Select, Table, Td, useAction, useLoad } from '@/components/ui';
import { api, download, fmtDate, fmtDateTime, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

export default function JoinedPage() {
  const { can } = useAuth();
  // Department users see their own department's joiners, without candidate records or contact details.
  const hr = can(P.CANDIDATE_VIEW);
  const canDownload = can(P.CV_DOWNLOAD);
  const [f, setF] = useState({ q: '', departmentId: '', position: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lookups = useLoad(() => api('/master/lookups'));
  const state = useLoad(() => api(`/joining/joined${qs({ ...f, page })}`), [f, page]);
  const act = useAction();
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); setPicked(new Set()); };
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const items: any[] = state.data?.items ?? [];
  // Selection is open to every row (owner, 2026-11-11): rows whose CV file was removed under the old policy still get a tick,
  // and the ZIP endpoint lists them in `_not_available.txt` so HR sees why nothing is in the ZIP for that candidate.
  const allPicked = items.length > 0 && items.every((j) => picked.has(j.applicationId));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(items.map((j) => j.applicationId)));
  const missingCount = [...picked].filter((id) => items.find((j) => j.applicationId === id)?.hasFile === false).length;
  return (
    <>
      <PageHeader title="Joined candidate list" subtitle={hr ? "Only candidates whose actual joining has been verified and approved by HR." : "Candidates who joined your department, verified and approved by HR."} />
      <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Input className="max-w-[14rem]" placeholder="Name or ID…" value={f.q} onChange={(e) => set('q', e.target.value)} />
          {hr && <Select className="max-w-[14rem]" value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)} placeholder="All departments" options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />}
          <Input className="max-w-[12rem]" placeholder="Position…" value={f.position} onChange={(e) => set('position', e.target.value)} />
          <Input type="date" className="max-w-[10rem]" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="Joined from" />
          <Input type="date" className="max-w-[10rem]" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="Joined to" />
          {canDownload && <Button size="sm" variant="secondary" className="ml-auto" disabled={!picked.size || act.busy}
            title={missingCount ? `${missingCount} of the ${picked.size} selected joined before CV files were kept — their rows will be listed in _not_available.txt inside the ZIP.` : undefined}
            onClick={() => act.run(() => download('/applications/cv-pack', { applicationIds: [...picked] }), 'CV ZIP downloaded.')}>Download CVs ({picked.size}{missingCount ? `, ${picked.size - missingCount} with file` : ''})</Button>}
        </div>
        <Loaded state={state} empty={(d: any) => !d.items.length && 'No approved joinings match these filters.'}>
          {(d: any) => (
            <>
              <Table head={[...(canDownload ? [<input key="h" type="checkbox" className="accent-brand-600" aria-label="Select all" checked={allPicked} disabled={!d.items.length} onChange={toggleAll} />] : []),
                'Candidate ID', 'Application ID', 'Name', 'Department', 'Company', 'Position', 'Vacancy', ...(hr ? ['Contact'] : []), 'Final selection', 'Joining date', ...(hr ? ['Salary'] : []), 'Approved by']}>
                {d.items.map((j: any) => (
                  <tr key={j.id} className={picked.has(j.applicationId) ? 'bg-brand-50/50' : undefined}>
                    {canDownload && <Td><input type="checkbox" className="accent-brand-600" aria-label={`Select ${j.name}`} checked={picked.has(j.applicationId)} onChange={() => toggle(j.applicationId)} title={j.hasFile ? undefined : 'No stored CV file — this candidate joined before the file-keeping policy was enabled. Will show in _not_available.txt.'} /></Td>}
                    <Td>{j.candidateNo}</Td>
                    <Td>{hr ? <Link className="text-brand-700 hover:underline" href={`/applications/${j.applicationId}`}>{j.applicationNo}</Link> : j.applicationNo}
                      {j.hasFile && j.documentId && <div><a className="text-xs text-brand-700 hover:underline" href={`/api/documents/${j.documentId}`} target="_blank" rel="noopener noreferrer">View CV</a></div>}</Td>
                    <Td className="font-medium">{j.name}</Td>
                    <Td>{j.department}</Td>
                    <Td className="text-xs">{j.company}</Td>
                    <Td>{j.position}</Td>
                    <Td>{hr ? <Link className="text-brand-700 hover:underline" href={`/vacancies/${j.vacancyId}`}>{j.vacancyNo}</Link> : j.vacancyNo}</Td>
                    {hr && <Td className="text-xs">{j.email}<div className="text-muted">{j.phone}</div></Td>}
                    <Td className="text-xs">{j.finalDecision} · {fmtDate(j.finalDecisionAt)}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(j.joiningDate)}</Td>
                    {hr && <Td className="whitespace-nowrap text-sm">{j.salary ?? <span className="text-muted">—</span>}</Td>}
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
