'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Loaded, PageHeader, useAction, useLoad } from '@/components/ui';
import { CandidateFilters, CandidateTable } from '@/components/cv-bank/CandidateTable';
import { api, download, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

/** Step 3 of the CV Bank: every CV received for one vacancy. */
export default function CvBankVacancyPage() {
  const { departmentId, vacancyId } = useParams<{ departmentId: string; vacancyId: string }>();
  const { can } = useAuth();
  const tree = useLoad(() => api(`/cv-bank/tree${qs({ departmentId, vacancyId })}`), [departmentId, vacancyId]);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const act = useAction();
  const dep = tree.data?.departments[0];
  const vacancy = dep?.vacancies[0];
  return (
    <>
      <PageHeader
        title={vacancy ? `${vacancy.vacancyNo} — ${vacancy.positionTitle}` : 'Vacancy CVs'}
        subtitle={vacancy && <>{dep.name} · {vacancy.companyCode} · headcount {vacancy.headcount} · {vacancy.total} CV{vacancy.total === 1 ? '' : 's'} <Badge>{vacancy.status}</Badge></>}
        back={{ href: `/cv-bank/${departmentId}`, label: dep?.name ?? 'Department' }}
        actions={vacancy && <>
          {can(P.EXPORT) && <Button variant="secondary" busy={act.busy} onClick={() => act.run(() => download(`/vacancies/${vacancyId}/cv-data-export`))}>Download CV data Excel</Button>}
          <Link href={`/cv-bank/${departmentId}/${vacancyId}/excel`} className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-slate-50">View Excel</Link>
        </>}
      />
      <div className="mb-3"><Alert>{act.error}</Alert></div>
      <Loaded state={tree} empty={(d: any) => !d?.departments[0]?.vacancies.length && 'This vacancy was not found, or you do not have access to it.'}>
        {() => (
          <>
            <Card pad={false} className="mb-4">
              <CandidateFilters searchLabel="Candidate name, Candidate ID or Application ID" onChange={setFilters} />
            </Card>
            <Card pad={false}><CandidateTable vacancyId={vacancyId} q={filters.q} status={filters.status} onChanged={tree.reload} /></Card>
          </>
        )}
      </Loaded>
    </>
  );
}
