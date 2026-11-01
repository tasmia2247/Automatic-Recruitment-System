'use client';

import Link from 'next/link';
import { Card, Empty, Loaded, PageHeader, Stat, Table, Td, useLoad } from '@/components/ui';
import { api, fmtDateTime } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const STAGE_LABEL: Record<string, string> = { WRITTEN: 'Written exam', INTERVIEW: 'Interview', VIVA: 'Viva' };

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/** Requisition counts as users read them: Processing = in approval, Approved = fully approved (sent to HR). */
function RequisitionStats({ r }: { r: { total: number; pending: number; approved: number } }) {
  return <>
    <Stat label="Total requisitions" value={r.total} href="/requisitions" />
    <Stat label="Pending (processing)" value={r.pending} tone="amber" href="/requisitions?status=Pending Approval" />
    <Stat label="Approved" value={r.approved} tone="green" href="/requisitions?status=Sent to HR" />
  </>;
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const state = useLoad(() => api('/dashboard'));

  return (
    <>
      <PageHeader title={`Welcome, ${user?.name}`} subtitle="Your dashboard shows only the records and actions your role permits. All figures are live counts from ARS records." />
      <Loaded state={state}>
        {(d: any) => (
          <div className="space-y-8">
            {d.myApprovals !== undefined && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Awaiting my approval" value={d.myApprovals} tone={d.myApprovals ? 'amber' : 'slate'} href="/approvals" />
              </div>
            )}

            {d.department && (
              <Section title={d.department.name ? `Department — ${d.department.name}` : 'Departments — all'}
                subtitle="Positions & quota, requisitions and joined candidates of the department.">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Total quota (designations)" value={d.department.quota.approvedQuota} href="/quotas" />
                  <Stat label="Current manpower" value={d.department.quota.presentManpower} />
                  <Stat label="Vacant positions" value={d.department.quota.vacant} tone={d.department.quota.vacant ? 'amber' : 'slate'} />
                  <Stat label="Quota rows needing review" value={d.department.quota.needsReview} tone={d.department.quota.needsReview ? 'amber' : 'slate'} hint="Missing quota or headcount" href="/quotas" />
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <RequisitionStats r={d.department.requisitions} />
                  <Stat label="Joined candidates" value={d.department.joined} tone="green" href={can(P.JOINED_VIEW) ? '/joined' : undefined} />
                </div>
              </Section>
            )}

            {d.hr && (
              <Section title="HR — recruitment" subtitle={d.hr.assignedOnly ? 'The vacancies you are coordinator of.' : 'Every vacancy and coordinator.'}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                  {d.hr.queue !== undefined && <Stat label="HR queue (no vacancy yet)" value={d.hr.queue} tone={d.hr.queue ? 'amber' : 'slate'} href="/hr-queue" />}
                  {d.hr.unassigned !== undefined && <Stat label="Vacancies without coordinator" value={d.hr.unassigned} tone={d.hr.unassigned ? 'amber' : 'slate'} href="/vacancies" />}
                  <Stat label="Active vacancies" value={d.hr.activeVacancies} href="/vacancies" />
                  <Stat label="CVs received" value={d.hr.cvs.received} href="/cv-bank" />
                  <Stat label="Shortlisted" value={d.hr.cvs.shortlisted} tone="violet" />
                  <Stat label="Joining pending" value={d.hr.joining.pending} tone="amber" href="/joining" />
                  <Stat label="Joined" value={d.hr.joining.joined} tone="green" href="/joined" />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title="CV screening">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Stat label="Pending" value={d.hr.cvs.pending} tone="slate" />
                      <Stat label="Pass" value={d.hr.cvs.pass} tone="green" />
                      <Stat label="Fail" value={d.hr.cvs.fail} tone="red" />
                      <Stat label="Review required" value={d.hr.cvs.review} tone="amber" />
                    </div>
                  </Card>
                  <Card title="Interview / exam / viva progress" pad={false}>
                    {d.hr.stages.length ? (
                      <Table head={['Stage', 'Scheduled', 'Attendance recorded', 'Result recorded']}>
                        {d.hr.stages.map((s: any) => (
                          <tr key={s.stage}><Td>{STAGE_LABEL[s.stage] ?? s.stage}</Td><Td className="tabular-nums">{s.scheduled}</Td><Td className="tabular-nums">{s.attended}</Td><Td className="tabular-nums">{s.completed}</Td></tr>
                        ))}
                      </Table>
                    ) : <div className="p-4"><Empty>No interviews or exams scheduled yet.</Empty></div>}
                  </Card>
                </div>
              </Section>
            )}

            {d.admin && (
              <Section title="Admin — requisitions" subtitle="Every department's submitted requisitions.">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <RequisitionStats r={d.admin.requisitions} />
                  {can(P.ACT_ON_BEHALF) && <Stat label="Approver inbox" value={d.admin.requisitions.pending} tone={d.admin.requisitions.pending ? 'amber' : 'slate'} href="/approvals" hint="Waiting for a decision" />}
                </div>
              </Section>
            )}

            {can(P.MONITOR_VIEW) && (d.failedJobs > 0 || d.failedEmails > 0) && (
              <Card title="Processing issues" actions={<Link className="text-sm text-brand-700 hover:underline" href="/admin/monitor">Open monitor</Link>}>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Failed background jobs" value={d.failedJobs} tone="red" href="/admin/monitor?status=Failed" />
                  <Stat label="Failed emails" value={d.failedEmails} tone="red" />
                </div>
              </Card>
            )}

            <Card title="My recent activity">
              {d.recentActivity.length ? (
                <Table head={['When', 'Action', 'Record']}>
                  {d.recentActivity.map((e: any) => <tr key={e.id}><Td className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt)}</Td><Td>{e.action}</Td><Td>{e.entityLabel ?? e.entityType}</Td></tr>)}
                </Table>
              ) : <Empty>No activity yet.</Empty>}
            </Card>
          </div>
        )}
      </Loaded>
    </>
  );
}
