'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Input, Loaded, PageHeader, useAction, useLoad } from '@/components/ui';
import { api, download, fmtDate } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

/** The vacancy's CV data Excel shown in the browser: same columns and rows as the download. */
export default function CvDataSheetPage() {
  const { departmentId, vacancyId } = useParams<{ departmentId: string; vacancyId: string }>();
  const { can } = useAuth();
  const state = useLoad(() => api(`/vacancies/${vacancyId}/cv-data`), [vacancyId]);
  const [q, setQ] = useState('');
  const act = useAction();
  const cell = (key: string, v: any) => (key === 'received' ? fmtDate(v) : v === '' || v === null ? '' : String(v));
  return (
    <>
      <PageHeader
        title={state.data ? `CV data — ${state.data.vacancy.vacancyNo}` : 'CV data'}
        subtitle={state.data && `${state.data.vacancy.positionTitle} · ${state.data.rows.length} CV${state.data.rows.length === 1 ? '' : 's'}`}
        back={{ href: `/cv-bank/${departmentId}/${vacancyId}`, label: 'Vacancy CVs' }}
        actions={can(P.EXPORT) && <Button variant="secondary" busy={act.busy} onClick={() => act.run(() => download(`/vacancies/${vacancyId}/cv-data-export`))}>Download Excel</Button>}
      />
      <div className="mb-3"><Alert>{act.error}</Alert></div>
      <Loaded state={state} empty={(d: any) => !d.rows.length && 'No CVs received for this vacancy yet.'}>
        {(d: any) => {
          const needle = q.trim().toLowerCase();
          const rows = needle ? d.rows.filter((r: any) => d.columns.some((c: any) => cell(c.key, r[c.key]).toLowerCase().includes(needle))) : d.rows;
          return (
            <Card pad={false}>
              <div className="border-b border-line p-3"><Input className="max-w-xs" placeholder="Search any column…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="max-h-[70vh] overflow-auto">
                <table className="border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="border border-slate-300 bg-slate-100 px-2 py-1 text-muted">#</th>
                      {d.columns.map((c: any) => <th key={c.key} className="min-w-[8rem] border border-slate-300 bg-[#A9D08E] px-2 py-1.5 text-center font-semibold text-ink">{c.header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any, i: number) => (
                      <tr key={r.applicationId} className="align-top hover:bg-amber-50">
                        <td className="border border-slate-300 bg-slate-50 px-2 py-1 text-right text-muted tabular-nums">{i + 1}</td>
                        {d.columns.map((c: any) => (
                          <td key={c.key} className={`max-w-[18rem] whitespace-pre-line border border-slate-300 px-2 py-1 ${r[c.key] === 'Needs review' ? 'text-amber-700' : ''}`}>{cell(c.key, r[c.key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <p className="p-4 text-sm text-muted">No row matches the search.</p>}
              </div>
            </Card>
          );
        }}
      </Loaded>
    </>
  );
}
