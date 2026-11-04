'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Card, Loaded, PageHeader, useLoad } from '@/components/ui';
import { CandidateFilters, CandidateTable } from '@/components/cv-bank/CandidateTable';
import { api } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

/** Step 1 of the CV Bank: choose a department. Searching lists matching candidates across every vacancy. */
export default function CvBankPage() {
  const { can } = useAuth();
  const allowed = can(P.CANDIDATE_VIEW);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const tree = useLoad(() => (allowed ? api('/cv-bank/tree') : Promise.resolve(null)), [allowed]);
  const filtering = !!(filters.q || filters.status);
  const seesUnmatched = can(P.CV_UPLOAD) && can(P.RECRUITMENT_ALL);
  const unmatched = useLoad(() => (seesUnmatched ? api('/intake/unmatched') : Promise.resolve(null)), [seesUnmatched]);

  if (!allowed) {
    return (<><PageHeader title="All CVs / Candidate CV Bank" /><Alert>You do not have permission to view candidate CVs.</Alert></>);
  }

  return (
    <>
      <PageHeader title="All CVs / Candidate CV Bank" subtitle="Choose a department to see its vacancies and CVs. Each application keeps its own screening result, status, remarks and history." />
      <Card pad={false} className="mb-4">
        <CandidateFilters searchLabel="Search all CVs by candidate name, Candidate ID or Application ID" onChange={setFilters} />
      </Card>
      {filtering ? (
        <Card pad={false}><CandidateTable q={filters.q} status={filters.status} showVacancy /></Card>
      ) : (
        <Loaded state={tree} empty={(d: any) => !d?.departments.length && 'No departments found.'}>
          {(d: any) => (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...d.departments].sort((a: any, b: any) => Number(b.vacancies.length > 0) - Number(a.vacancies.length > 0)).map((dep: any) => (
                <Link key={dep.id} href={`/cv-bank/${dep.id}`} className="rounded-lg border border-line bg-white p-4 shadow-sm transition hover:border-brand-600 hover:bg-slate-50">
                  <div className="font-semibold">{dep.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    {dep.vacancies.length} vacanc{dep.vacancies.length === 1 ? 'y' : 'ies'} · {dep.total} CV{dep.total === 1 ? '' : 's'}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Loaded>
      )}
      {seesUnmatched && (
        <Link href="/cv-bank/unmatched" className="mt-4 flex items-center justify-between rounded-lg border border-dashed border-amber-400 bg-amber-50 p-4 transition hover:border-amber-600">
          <div>
            <div className="font-semibold">Unmatched CVs</div>
            <div className="mt-1 text-xs text-muted">Scan saved CV mails; move the ones that fit no job to a vacancy by department and designation, or delete them.</div>
          </div>
          <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-sm font-semibold text-amber-900 tabular-nums">{unmatched.data?.length ?? '…'}</span>
        </Link>
      )}
    </>
  );
}
