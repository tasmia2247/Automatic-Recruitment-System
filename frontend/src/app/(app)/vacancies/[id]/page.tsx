'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CandidatesTab } from '@/components/vacancy/CandidatesTab';
import { EvaluationTab } from '@/components/vacancy/EvaluationTab';
import { CoordinatorSelect } from '@/components/vacancy/CoordinatorSelect';
import { Alert, Badge, Button, Card, DL, Field, Input, Loaded, Modal, PageHeader, Select, Table, Tabs, Td, useAction, useLoad } from '@/components/ui';
import { api, download, fmtDate, fmtDateTime, show } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

function EmailsTab({ vacancyId }: { vacancyId: string }) {
  const state = useLoad(() => api(`/email/history?vacancyId=${vacancyId}`), [vacancyId]);
  const act = useAction();
  return (
    <Card pad={false} title="Email history" actions={<Button size="sm" variant="secondary" onClick={state.reload}>Refresh</Button>}>
      <div className="px-4 pt-3"><Alert>{act.error}</Alert></div>
      <Loaded state={state} empty={(d: any[]) => !d.length && 'No emails sent for this vacancy yet.'}>
        {(rows: any[]) => (
          <Table head={['When', 'Type', 'Candidate', 'Recipient', 'Subject', 'Status', 'Transport', '']}>
            {rows.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(e.sentAt ?? e.createdAt)}</Td>
                <Td className="text-xs">{e.kind.replace('_', ' ').toLowerCase()}</Td>
                <Td>{e.candidateName ?? e.applicationNo}</Td>
                <Td className="text-xs">{e.recipient}</Td>
                <Td className="max-w-xs text-xs">{e.subject}</Td>
                <Td><Badge>{e.status}</Badge>{e.error && <div className="mt-1 max-w-[12rem] text-xs text-red-700">{e.error}</div>}</Td>
                <Td className="text-xs">{e.transport === 'dev-outbox' ? <span className="text-amber-700">dev outbox (not delivered)</span> : show(e.transport)}</Td>
                <Td>{e.status === 'Failed' && <Button size="sm" variant="secondary" onClick={() => act.run(() => api(`/email/events/${e.id}/retry`, { method: 'POST' })).then(state.reload)}>Retry</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Loaded>
    </Card>
  );
}

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const [tab, setTab] = useState(sp.get('tab') ?? 'overview');
  const state = useLoad(() => api(`/vacancies/${id}`), [id]);
  const coordinators = useLoad(() => (can(P.COORDINATOR_ASSIGN) ? api('/hr-queue/coordinators') : Promise.resolve(null)), [can]);
  const [newPost, setNewPost] = useState<any | null>(null);
  const act = useAction();

  const createPost = async () => {
    const r = await act.run(() => api(`/vacancies/${id}/job-posts`, { body: { title: newPost.title, startDate: newPost.startDate || undefined, deadline: newPost.deadline || undefined } }));
    if (r) router.push(`/job-posts/${r.id}`);
  };
  const setStatus = (status: string) => act.run(() => api(`/vacancies/${id}`, { method: 'PUT', body: { status } }), `Vacancy status set to ${status}.`).then(state.reload);

  return (
    <Loaded state={state}>
      {(v: any) => (
        <>
          <PageHeader back={{ href: '/vacancies', label: 'Vacancies' }}
            title={<span className="flex items-center gap-3">{v.vacancyNo} <Badge>{v.status}</Badge> {v.source === 'DIRECT_HR' && <Badge tone="violet">Direct HR Entry</Badge>}</span>}
            subtitle={`${v.positionTitle} × ${v.headcount} · ${v.department.name} · ${v.company.name}`}
            actions={can(P.VACANCY_EDIT) && (
              <Select className="w-40" value={v.status} onChange={(e) => setStatus(e.target.value)} options={['Open', 'Posting', 'Screening', 'On Hold', 'Filled', 'Closed'].map((s) => ({ value: s, label: `Status: ${s}` }))} />
            )} />
          <div className="mb-3 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'overview', label: 'Overview & job posts' }, { key: 'candidates', label: 'Candidates & screening' },
            { key: 'evaluation', label: 'Interview / exam / results' }, { key: 'emails', label: 'Emails' },
          ]} />
          {tab === 'overview' && (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Vacancy">
                <DL items={[
                  ['Source', v.source === 'DIRECT_HR' ? 'Direct HR Entry' : <Link className="text-brand-700 hover:underline" href={`/requisitions/${v.requisition?.id}`}>{v.requisition?.reqNo}</Link>],
                  ['Type', v.vacancyType === 'REPLACEMENT' ? `Replacement${v.replacementEmployee ? ` — ${v.replacementEmployee}` : ''}` : 'New position'],
                  ['Coordinator', can(P.COORDINATOR_ASSIGN) && coordinators.data
                    ? <CoordinatorSelect path={`/vacancies/${v.id}/coordinator`} value={v.coordinator} options={coordinators.data} onError={act.setError} onSaved={() => act.setMessage('Coordinator saved.')} />
                    : v.coordinator?.name ?? <Badge tone="amber">Unassigned</Badge>],
                  ['Approved headcount', v.headcount], ['Created', fmtDate(v.createdAt)],
                  ...(v.directReason ? [['Direct entry reason', v.directReason] as [string, string]] : []),
                  ['Remarks', show(v.remarks)],
                ]} />
              </Card>
              <Card className="lg:col-span-2" title="Job posts / circulars" actions={can(P.JOBPOST_EDIT) && <Button size="sm" onClick={() => setNewPost({ title: v.positionTitle, startDate: '', deadline: '' })}>New job post</Button>} pad={false}>
                {v.jobPosts.length ? (
                  <Table head={['Job post', 'Title', 'Application window', 'Criteria version', 'Status']}>
                    {v.jobPosts.map((j: any) => (
                      <tr key={j.id}>
                        <Td>
                          <Link className="font-medium text-brand-700 hover:underline" href={`/job-posts/${j.id}`}>{j.jobNo}</Link>
                          <div className="mt-1 flex gap-1.5" title="Download the hiring circular">
                            <Button size="sm" variant="secondary" onClick={() => download(`/job-posts/${j.id}/circular-file?format=pdf&download=1`)}>PDF</Button>
                            <Button size="sm" variant="secondary" onClick={() => download(`/job-posts/${j.id}/circular-file?format=txt&download=1`)}>Text</Button>
                          </div>
                        </Td>
                        <Td>{j.title}</Td>
                        <Td className="whitespace-nowrap">{fmtDate(j.startDate)} – {fmtDate(j.deadline)}</Td>
                        <Td>{j.currentCriteriaVersion ? `v${j.currentCriteriaVersion}` : <span className="text-amber-700">not configured</span>}</Td>
                        <Td><Badge>{j.status}</Badge></Td>
                      </tr>
                    ))}
                  </Table>
                ) : <p className="p-4 text-sm text-muted">No job post yet. Create one to set the circular, dates and screening criteria.</p>}
              </Card>
            </div>
          )}
          {tab === 'candidates' && <CandidatesTab vacancy={v} />}
          {tab === 'evaluation' && <EvaluationTab vacancy={v} />}
          {tab === 'emails' && <EmailsTab vacancyId={v.id} />}

          <Modal open={!!newPost} title="New job post" onClose={() => setNewPost(null)}
            footer={<><Button variant="secondary" onClick={() => setNewPost(null)}>Cancel</Button><Button busy={act.busy} onClick={createPost}>Create & edit</Button></>}>
            {newPost && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title" required className="sm:col-span-2"><Input value={newPost.title} onChange={(e) => setNewPost({ ...newPost, title: e.target.value })} /></Field>
                <Field label="Application start"><Input type="date" value={newPost.startDate} onChange={(e) => setNewPost({ ...newPost, startDate: e.target.value })} /></Field>
                <Field label="Deadline"><Input type="date" value={newPost.deadline} onChange={(e) => setNewPost({ ...newPost, deadline: e.target.value })} /></Field>
              </div>
            )}
            <div className="mt-3"><Alert>{act.error}</Alert></div>
          </Modal>
        </>
      )}
    </Loaded>
  );
}

export default function VacancyPage() {
  return <Suspense><Workspace /></Suspense>;
}
