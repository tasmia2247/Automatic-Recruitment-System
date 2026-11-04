'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Alert, Badge, Card, Loaded, PageHeader, useAction, useLoad } from '@/components/ui';
import { api, download, qs } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

/** Step 2 of the CV Bank: the vacancies of one department. */
export default function CvBankDepartmentPage() {
  const { departmentId } = useParams<{ departmentId: string }>();
  const { can } = useAuth();
  const tree = useLoad(() => api(`/cv-bank/tree${qs({ departmentId })}`), [departmentId]);
  const act = useAction();
  const dep = tree.data?.departments[0];
  return (
    <>
      <PageHeader title={dep?.name ?? 'Department'} subtitle="Choose a vacancy to see its CVs." back={{ href: '/cv-bank', label: 'All departments' }} />
      <div className="mb-3"><Alert>{act.error}</Alert></div>
      <Loaded state={tree} empty={(d: any) => !d?.departments[0]?.vacancies.length && 'No vacancies in this department.'}>
        {(d: any) => (
          <div className="space-y-2">
            {d.departments[0].vacancies.map((v: any) => (
              <Card key={v.id} pad={false}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <Link href={`/cv-bank/${departmentId}/${v.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 hover:underline">
                    <span className="font-medium text-brand-700">{v.vacancyNo}</span>
                    <span>{v.positionTitle}</span>
                    <span className="text-xs text-muted">{v.companyCode} · headcount {v.headcount}</span>
                  </Link>
                  <Badge>{v.status}</Badge>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{v.total} CV{v.total === 1 ? '' : 's'}</span>
                  {can(P.EXPORT) && (
                    <button className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50" disabled={act.busy} onClick={() => act.run(() => download(`/vacancies/${v.id}/cv-data-export`))}>Download Excel</button>
                  )}
                  <Link href={`/cv-bank/${departmentId}/${v.id}/excel`} className="text-xs font-medium text-brand-700 hover:underline">View Excel</Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Loaded>
    </>
  );
}
