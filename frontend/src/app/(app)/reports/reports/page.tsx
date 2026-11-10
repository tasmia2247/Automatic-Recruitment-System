'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, Empty, Loaded, PageHeader, Table, Tabs, Td, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { PeriodBar, Range, pctLabel, presetRange, rangeQs } from '../_shared';

type Tab = 'vacancies' | 'sources' | 'approvals' | 'screening';

/**
 * Recruitment Reports (owner, 2026-11-09): tabular reports per vacancy / CV source / approval step /
 * screening quality. Everything scoped to the user's coordinator vacancies. Period filter applies to each tab.
 * The "By department" tab was removed on 2026-11-10 (owner) — the rollup was raising internal errors on prod
 * seeds and the same figures are reachable from "By vacancy" grouped on Department.
 */
export default function RecruitmentReports() {
  const [range, setRange] = useState<Range>(presetRange('90d'));
  const [tab, setTab] = useState<Tab>('vacancies');
  const qs = rangeQs(range);

  return (
    <>
      <PageHeader title="Recruitment Reports" subtitle="Detailed tabular reports across vacancies, CV sources and the approval chain." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodBar value={range} onChange={setRange} />
      </div>
      <Tabs active={tab} onChange={(k) => setTab(k as Tab)} tabs={[
        { key: 'vacancies', label: 'By vacancy' },
        { key: 'sources', label: 'CV sources' },
        { key: 'approvals', label: 'Approval TAT' },
        { key: 'screening', label: 'Screening quality' },
      ]} />
      <div className="mt-4">
        {tab === 'vacancies' && <VacancyTable qs={qs} />}
        {tab === 'sources' && <SourceTable qs={qs} />}
        {tab === 'approvals' && <ApprovalTat qs={qs} />}
        {tab === 'screening' && <ScreeningQuality qs={qs} />}
      </div>
    </>
  );
}

function VacancyTable({ qs }: { qs: string }) {
  const s = useLoad(() => api(`/reports/vacancies${qs}`), [qs]);
  return (
    <Card pad={false}>
      <Loaded state={s} empty={(d: any) => (d.rows.length ? false : 'No vacancies created in this period.')}>
        {(d: any) => (
          <Table head={['Vacancy', 'Position / Company', 'Department', 'Coordinator', 'Status', 'CVs', 'Shortlisted', 'Selected', 'Waiting', 'Joined', 'Days open']}>
            {d.rows.map((r: any) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><Link href={`/vacancies/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.vacancyNo}</Link></Td>
                <Td><div>{r.positionTitle}</div><div className="text-xs text-muted">{r.company}</div></Td>
                <Td className="text-sm">{r.department}</Td>
                <Td className="text-sm">{r.coordinator ?? <span className="text-muted">—</span>}</Td>
                <Td className="text-sm">{r.status}</Td>
                <Td className="text-right tabular-nums">{r.cvs}</Td>
                <Td className="text-right tabular-nums">{r.shortlisted}</Td>
                <Td className="text-right tabular-nums">{r.selected}</Td>
                <Td className="text-right tabular-nums">{r.waiting}</Td>
                <Td className="text-right font-semibold tabular-nums">{r.joined} / {r.headcount}</Td>
                <Td className="text-right tabular-nums">{r.days_open}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Loaded>
    </Card>
  );
}

function SourceTable({ qs }: { qs: string }) {
  const s = useLoad(() => api(`/reports/sources${qs}`), [qs]);
  const label = (code: string) => ({ MANUAL: 'Manual upload', INTAKE: 'Mail intake', CV_BANK: 'CV Bank', UNKNOWN: 'Unknown' } as any)[code] ?? code;
  return (
    <Card pad={false}>
      <Loaded state={s} empty={(d: any) => (d.rows.length ? false : 'No CVs in this period.')}>
        {(d: any) => (
          <Table head={['Source', 'CVs', 'Shortlisted', 'Selected', 'Joined', 'Join rate']}>
            {d.rows.map((r: any) => (
              <tr key={r.source} className="hover:bg-slate-50">
                <Td>{label(r.source)}</Td>
                <Td className="text-right tabular-nums">{r.cvs}</Td>
                <Td className="text-right tabular-nums">{r.shortlisted}</Td>
                <Td className="text-right tabular-nums">{r.selected}</Td>
                <Td className="text-right tabular-nums">{r.joined}</Td>
                <Td className="text-right tabular-nums text-muted">{pctLabel(r.cvs ? Math.round((r.joined / r.cvs) * 1000) / 10 : null)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Loaded>
    </Card>
  );
}

function ApprovalTat({ qs }: { qs: string }) {
  const s = useLoad(() => api(`/reports/approval-tat${qs}`), [qs]);
  return (
    <div className="space-y-4">
      <Card title="Decided — turnaround per approver / step" pad={false}>
        <Loaded state={s} empty={(d: any) => (d.perStep.length ? false : 'No decisions in this period.')}>
          {(d: any) => (
            <Table head={['Approver', 'Step', 'Approved', 'Returned', 'Rejected', 'Avg. hours']}>
              {d.perStep.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <Td>{r.approver ?? <span className="text-muted">—</span>}</Td>
                  <Td className="text-sm">{r.step}</Td>
                  <Td className="text-right tabular-nums">{r.approved}</Td>
                  <Td className="text-right tabular-nums">{r.returned}</Td>
                  <Td className="text-right tabular-nums">{r.rejected}</Td>
                  <Td className="text-right tabular-nums font-semibold">{r.avg_hours ?? '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Loaded>
      </Card>
      <Card title="Currently pending with" pad={false}>
        <Loaded state={s}>
          {(d: any) => (d.pending.length === 0 ? <div className="p-4"><Empty>Nothing pending with any approver right now.</Empty></div>
            : (
              <Table head={['Approver', 'Step', 'Pending', 'Avg. days waiting']}>
                {d.pending.map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <Td>{r.approver ?? <span className="text-muted">—</span>}</Td>
                    <Td className="text-sm">{r.step}</Td>
                    <Td className="text-right tabular-nums">{r.pending}</Td>
                    <Td className="text-right tabular-nums font-semibold">{r.avg_days_waiting ?? '—'}</Td>
                  </tr>
                ))}
              </Table>
            ))}
        </Loaded>
      </Card>
    </div>
  );
}

function ScreeningQuality({ qs }: { qs: string }) {
  const s = useLoad(() => api(`/reports/screening-quality${qs}`), [qs]);
  return (
    <Card title="Screening outcomes" pad={true}>
      <Loaded state={s}>
        {(d: any) => (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <div><div className="text-sm text-muted">Screened</div><div className="text-2xl font-semibold tabular-nums">{d.overall.screened}</div></div>
            <div><div className="text-sm text-muted">Pass</div><div className="text-2xl font-semibold tabular-nums text-emerald-700">{d.overall.pass}</div></div>
            <div><div className="text-sm text-muted">Fail</div><div className="text-2xl font-semibold tabular-nums text-red-700">{d.overall.fail}</div></div>
            <div><div className="text-sm text-muted">Review required</div><div className="text-2xl font-semibold tabular-nums text-amber-700">{d.overall.review}</div></div>
            <div><div className="text-sm text-muted">HR overrides</div><div className="text-2xl font-semibold tabular-nums">{d.overall.overrides}</div><div className="text-xs text-muted">Shortlisted while non-Pass</div></div>
          </div>
        )}
      </Loaded>
    </Card>
  );
}
