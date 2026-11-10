'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, Loaded, Stat, Table, Td, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { Funnel, PeriodBar, Range, Trend, pctLabel, presetRange, rangeQs } from './_shared';

/**
 * Recruitment Dashboard body (owner, 2026-11-09). The same block is rendered on `/reports` and under the main
 * dashboard (`/`) for users who hold `recruitment.view_all` (HR Manager / Super Admin).
 */
export function RecruitmentDashboardBody({ defaultRange = '30d' }: { defaultRange?: string }) {
  const [range, setRange] = useState<Range>(presetRange(defaultRange));
  const qs = rangeQs(range);
  const overview = useLoad(() => api(`/reports/overview${qs}`), [qs]);
  const trends = useLoad(() => api(`/reports/trends${qs}&bucket=month`), [qs]);

  return (
    <>
      <div className="mb-4"><PeriodBar value={range} onChange={setRange} /></div>
      <Loaded state={overview}>
        {(d: any) => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
              <Stat label="CVs received" value={d.funnel.cvs} />
              <Stat label="Shortlisted" value={d.funnel.shortlisted} tone="violet" />
              <Stat label="Interviewed" value={d.funnel.interviewed} />
              <Stat label="Selected" value={d.funnel.selected} tone="green" />
              <Stat label="Joined" value={d.funnel.joined} tone="green" />
              <Stat label="Overall join rate" value={pctLabel(d.conversion.overall)} tone="amber" hint="CVs → Joined (period)" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Recruitment funnel" actions={<span className="text-xs text-muted">CVs → Joined, within period</span>}>
                <Funnel stages={[
                  { label: 'CVs received', value: d.funnel.cvs },
                  { label: 'Screened', value: d.funnel.screened },
                  { label: 'Pass screening', value: d.funnel.pass, tone: 'green' },
                  { label: 'Shortlisted (HR)', value: d.funnel.shortlisted, tone: 'violet' },
                  { label: 'Interviewed', value: d.funnel.interviewed },
                  { label: 'Selected', value: d.funnel.selected, tone: 'green' },
                  { label: 'Waiting (backup)', value: d.funnel.waiting, tone: 'amber' },
                  { label: 'Joined', value: d.funnel.joined, tone: 'green' },
                ]} />
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div><div className="text-muted">Pass rate</div><div className="font-semibold">{pctLabel(d.conversion.passRate)}</div></div>
                  <div><div className="text-muted">Shortlist rate</div><div className="font-semibold">{pctLabel(d.conversion.shortlistRate)}</div></div>
                  <div><div className="text-muted">Interview rate</div><div className="font-semibold">{pctLabel(d.conversion.interviewRate)}</div></div>
                  <div><div className="text-muted">Selection rate</div><div className="font-semibold">{pctLabel(d.conversion.selectRate)}</div></div>
                  <div><div className="text-muted">Join rate</div><div className="font-semibold">{pctLabel(d.conversion.joinRate)}</div></div>
                  <div><div className="text-muted">Overall</div><div className="font-semibold">{pctLabel(d.conversion.overall)}</div></div>
                </div>
              </Card>

              <Card title="Vacancies & requisitions">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Active vacancies" value={d.vacancies.active} />
                  <Stat label="Filled" value={d.vacancies.filled} tone="green" />
                  <Stat label="Unassigned" value={d.vacancies.unassigned} tone={d.vacancies.unassigned ? 'amber' : 'slate'} />
                  <Stat label="Closed" value={d.vacancies.closed} tone="slate" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Stat label="Requisitions submitted" value={d.requisitions.total} />
                  <Stat label="Pending approval" value={d.requisitions.pending} tone="amber" />
                  <Stat label="Approved" value={d.requisitions.approved} tone="green" />
                  <Stat label="Rejected / Cancelled" value={d.requisitions.rejected + d.requisitions.cancelled} tone="red" />
                </div>
              </Card>
            </div>

            <Card title="Monthly trend" actions={<span className="text-xs text-muted">CVs received, shortlisted, selected and joined per month</span>}>
              <Loaded state={trends}>
                {(t: any) => (
                  <Trend rows={t.apps} keys={[
                    { k: 'cvs', label: 'CVs received' },
                    { k: 'shortlisted', label: 'Shortlisted', tone: 'violet' },
                    { k: 'selected', label: 'Selected', tone: 'green' },
                    { k: 'joined', label: 'Joined', tone: 'amber' },
                  ]} />
                )}
              </Loaded>
            </Card>

            <Card title="Top vacancies by CV volume" pad={false}>
              {d.topVacancies.length === 0
                ? <div className="p-4 text-sm text-muted">No vacancies with CVs in this period.</div>
                : (
                  <Table head={['Vacancy', 'Position', 'Status', 'CVs', 'Shortlisted', 'Selected', 'Joined']}>
                    {d.topVacancies.map((v: any) => (
                      <tr key={v.id} className="hover:bg-slate-50">
                        <Td><Link href={`/vacancies/${v.id}`} className="font-medium text-brand-700 hover:underline">{v.vacancyNo}</Link></Td>
                        <Td>{v.positionTitle}</Td>
                        <Td className="text-sm">{v.status}</Td>
                        <Td className="text-right tabular-nums">{v.cvs}</Td>
                        <Td className="text-right tabular-nums">{v.shortlisted}</Td>
                        <Td className="text-right tabular-nums">{v.selected}</Td>
                        <Td className="text-right tabular-nums font-semibold">{v.joined}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
            </Card>
          </div>
        )}
      </Loaded>
    </>
  );
}
