'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { SpecializationFields, specPayload } from '@/components/SpecializationFields';
import { CandidatesTab } from '@/components/vacancy/CandidatesTab';
import { JobPostDeleteNote } from '@/components/vacancy/JobPostDeleteNote';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, Loaded, Modal, PageHeader, Select, Table, Tabs, Td, useAction, useLoad } from '@/components/ui';
import { api, download, fmtDate } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

/** One key fact in the vacancy's summary strip. */
function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** What this vacancy's CVs are screened against, one labelled block per requirement. */
function Requirements({ s }: { s: any }) {
  const lines = (t?: string | null) => (t ?? '').split(/\r?\n/).map((x) => x.replace(/^[\s•\-*▪●]+/, '').trim()).filter(Boolean);
  const blocks: [string, React.ReactNode][] = [];
  if (s?.education) blocks.push(['Education / qualification', <p key="e" className="whitespace-pre-line">{s.education}</p>]);
  if (s?.experienceYears !== null && s?.experienceYears !== undefined && s?.experienceYears !== '') blocks.push(['Minimum experience', <p key="x">{Number(s.experienceYears)} year{Number(s.experienceYears) === 1 ? '' : 's'}</p>]);
  if (s?.skills) {
    const items = lines(s.skills).flatMap((l) => (l.length <= 60 && l.includes(',') ? l.split(',').map((x) => x.trim()).filter(Boolean) : [l]));
    blocks.push(['Required skills', items.every((x) => x.length <= 40)
      ? <div key="s" className="flex flex-wrap gap-1.5">{items.map((x, i) => <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{x}</span>)}</div>
      : <ul key="s" className="list-disc space-y-0.5 pl-4">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>]);
  }
  if (s?.keyResponsibilities) blocks.push(['Key responsibilities', <ul key="k" className="list-disc space-y-0.5 pl-4">{lines(s.keyResponsibilities).map((x, i) => <li key={i}>{x}</li>)}</ul>]);
  if (s?.other) blocks.push(['Other requirements', <p key="o" className="whitespace-pre-line">{s.other}</p>]);
  if (!blocks.length) return <Alert tone="warning">No screening requirements are set, so CVs of this vacancy are not screened.</Alert>;
  return (
    <div className="space-y-4 text-sm">
      {blocks.map(([label, body]) => (
        <section key={label}>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</h3>
          {body}
        </section>
      ))}
      <p className="border-t border-line pt-3 text-xs text-muted">A CV passes when it meets these and its match score reaches 70%; otherwise it goes to Review Required.</p>
    </div>
  );
}

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const [tab, setTab] = useState(['overview', 'candidates'].includes(sp.get('tab') ?? '') ? sp.get('tab')! : 'overview');
  const state = useLoad(() => api(`/vacancies/${id}`), [id]);
  const [newPost, setNewPost] = useState<any | null>(null);
  const [spec, setSpec] = useState<Record<string, any> | null>(null);
  const act = useAction();

  const createPost = async () => {
    const r = await act.run(() => api(`/vacancies/${id}/job-posts`, { body: { title: newPost.title, startDate: newPost.startDate || undefined, deadline: newPost.deadline || undefined } }));
    if (r) router.push(`/job-posts/${r.id}`);
  };
  const saveSpec = () => act.run(() => api(`/vacancies/${id}`, { method: 'PUT', body: specPayload(spec!) }), 'Specialization required saved. Use Re-run screening on the Candidates tab to apply it to CVs already received.').then((r) => { if (r) { setSpec(null); state.reload(); } });
  // Vacancy coordinator, HR Manager, Super Admin (owner, 2026-11-08); the API checks the scope.
  const [deletePost, setDeletePost] = useState<any | null>(null);
  const removePost = async () => {
    const r: any = await act.run(() => api(`/job-posts/${deletePost.id}`, { method: 'DELETE' }), (x: any) => `${x.jobNo} deleted.`);
    if (r) { setDeletePost(null); state.reload(); }
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
          ]} />
          {tab === 'overview' && (
            // Layout (owner, 2026-11-09): key facts in one strip, then what CVs are screened against beside the job posts.
            <div className="space-y-4">
              <Card pad={false}>
                <div className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
                  <Fact label="Company" value={<>{v.company.name} <span className="text-muted">({v.company.code})</span></>} />
                  <Fact label="Department" value={v.department.name} />
                  <Fact label="Type" value={v.vacancyType === 'REPLACEMENT' ? `Replacement${v.replacementEmployee ? ` — ${v.replacementEmployee}` : ''}` : 'New position'} />
                  <Fact label="Approved headcount" value={<span className="text-lg font-semibold tabular-nums">{v.headcount}</span>} />
                  {/* The coordinator is shown, not changed, here (owner, 2026-11-08). */}
                  <Fact label="Coordinator" value={v.coordinator?.name ?? <Badge tone="amber">Unassigned</Badge>} />
                  <Fact label="Created" value={fmtDate(v.createdAt)} hint={v.source === 'DIRECT_HR' ? 'Direct HR entry' : 'From the requisition'} />
                </div>
                {(v.directReason || v.remarks) && (
                  <div className="grid gap-3 border-t border-line px-4 py-3 text-sm sm:grid-cols-2">
                    {v.directReason && <div><span className="text-xs font-medium uppercase tracking-wide text-muted">Direct entry reason</span><p className="mt-0.5 whitespace-pre-line">{v.directReason}</p></div>}
                    {v.remarks && <div><span className="text-xs font-medium uppercase tracking-wide text-muted">Remarks</span><p className="mt-0.5 whitespace-pre-line">{v.remarks}</p></div>}
                  </div>
                )}
              </Card>

              <div className="grid gap-4 lg:grid-cols-5">
                <Card className="lg:col-span-2" title="Screening requirements"
                  actions={v.source === 'DIRECT_HR'
                    ? can(P.VACANCY_EDIT) && <Button size="sm" variant="secondary" onClick={() => setSpec({ requiredEducation: v.requiredEducation ?? '', requiredSkills: v.requiredSkills ?? '', requiredExperienceYears: v.requiredExperienceYears ?? '', specialization: v.specialization ?? '' })}>Edit</Button>
                    : <span className="text-xs text-muted">From the requisition</span>}>
                  <Requirements s={v.screening} />
                </Card>

                <Card className="lg:col-span-3" title={<>Job posts / circulars <span className="font-normal text-muted">({v.jobPosts.length})</span></>}
                  actions={can(P.JOBPOST_EDIT) && <Button size="sm" onClick={() => setNewPost({ title: v.positionTitle, startDate: '', deadline: '' })}>New job post</Button>} pad={false}>
                  {v.jobPosts.length ? (
                    <Table head={['Job post', 'Application window', 'Status', 'Circular', ...(can(P.JOBPOST_EDIT) ? [''] : [])]}>
                      {v.jobPosts.map((j: any) => (
                        <tr key={j.id}>
                          <Td><Link className="font-medium text-brand-700 hover:underline" href={`/job-posts/${j.id}`}>{j.title}</Link><div className="text-xs text-muted">{j.jobNo}</div></Td>
                          <Td className="whitespace-nowrap text-sm">{j.startDate || j.deadline ? <>{fmtDate(j.startDate)} – {fmtDate(j.deadline)}</> : <span className="text-muted">Not set</span>}</Td>
                          <Td><Badge>{j.status}</Badge></Td>
                          <Td><div className="flex gap-1.5" title="Download the hiring circular">
                            <Button size="sm" variant="secondary" onClick={() => download(`/job-posts/${j.id}/circular-file?format=pdf&download=1`)}>PDF</Button>
                            <Button size="sm" variant="secondary" onClick={() => download(`/job-posts/${j.id}/circular-file?format=txt&download=1`)}>Text</Button>
                          </div></Td>
                          {can(P.JOBPOST_EDIT) && <Td className="text-right"><Button size="sm" variant="danger" onClick={() => setDeletePost(j)}>Delete</Button></Td>}
                        </tr>
                      ))}
                    </Table>
                  ) : (
                    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h4" /></svg>
                      </span>
                      <div>
                        <div className="font-medium">No job post yet</div>
                        <p className="mt-0.5 text-sm text-muted">Create a job post to set the application dates and get the hiring circular (PDF / text).</p>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}
          {tab === 'candidates' && <CandidatesTab vacancy={v} />}

          <ConfirmDialog open={!!deletePost} title={`Delete ${deletePost?.jobNo ?? 'job post'}?`} danger confirmLabel="Delete permanently" busy={act.busy} error={act.error}
            message={<JobPostDeleteNote />} onConfirm={removePost} onClose={() => setDeletePost(null)} />
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
          <Modal open={!!spec} title="Specialization required" onClose={() => setSpec(null)}
            footer={<><Button variant="secondary" onClick={() => setSpec(null)}>Cancel</Button><Button busy={act.busy} onClick={saveSpec}>Save</Button></>}>
            {spec && <SpecializationFields value={spec} onChange={(k, val) => setSpec({ ...spec, [k]: val })} errors={act.fieldErrors} />}
            <p className="mt-3 text-xs text-muted">CVs of this Direct HR vacancy are screened against these fields.</p>
          </Modal>
        </>
      )}
    </Loaded>
  );
}

export default function VacancyPage() {
  return <Suspense><Workspace /></Suspense>;
}
