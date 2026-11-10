'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, Loaded, PageHeader, Select, Textarea, useAction, useLoad } from '@/components/ui';
import { api, download } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { JobPostDeleteNote } from '@/components/vacancy/JobPostDeleteNote';

const LABELS: Record<string, string> = { education: 'Education', experienceRequirement: 'Experience', duties: 'Key responsibilities', skills: 'Required skills' };
const FILLED_LABEL = (keys: string[]) => keys.map((k) => LABELS[k] ?? k).join(', ');

export default function JobPostPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const router = useRouter();
  const state = useLoad(() => api(`/job-posts/${id}`), [id]);
  const [form, setForm] = useState<any>(null);
  const [statusDialog, setStatusDialog] = useState<string | null>(null);
  const [circularText, setCircularText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [filled, setFilled] = useState<string[]>([]);
  const act = useAction();
  const editable = can(P.JOBPOST_EDIT);

  useEffect(() => {
    if (!state.data) return;
    const j = state.data;
    const base: any = { title: j.title, startDate: j.startDate ?? '', deadline: j.deadline ?? '', description: j.description ?? '', duties: j.duties ?? '', education: j.education ?? '', requiredDegree: j.requiredDegree ?? '', minCgpa: j.minCgpa ?? '', experienceRequirement: j.experienceRequirement ?? '', cvCollection: j.cvCollection ?? '', circularContent: j.circularContent ?? '', location: j.location ?? '', employmentType: j.employmentType ?? 'Full-time', jobShift: j.jobShift ?? '', salary: j.salary ?? '', skills: j.skills ?? '', applyEmail: j.applyEmail ?? '', emailSubject: j.emailSubject ?? '' };
    // A post that is still a draft takes the requisition's education, experience, JD and skills into the fields it left empty.
    const empty = j.status === 'Draft' && editable ? Object.keys(j.prefill ?? {}).filter((k) => !String(base[k] ?? '').trim()) : [];
    for (const k of empty) base[k] = j.prefill[k];
    setFilled(empty);
    setForm(base);
    api(`/job-posts/${j.id}/circular-file?format=txt`, { raw: true }).then((r: Response) => r.text()).then(setCircularText).catch(() => setCircularText(null));
  }, [state.data]);

  const savePost = () => act.run(() => api(`/job-posts/${id}`, { method: 'PUT', body: { ...form, startDate: form.startDate || null, deadline: form.deadline || null, minCgpa: form.minCgpa === '' ? null : Number(form.minCgpa), applyEmail: form.applyEmail || null } }), 'Job post saved. The circular below uses the saved details.').then(state.reload);
  const copyText = async () => { await navigator.clipboard.writeText(circularText ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const setStatus = async (status: string) => { const r = await act.run(() => api(`/job-posts/${id}/status`, { body: { status } }), `Job post ${status.toLowerCase()}.`); setStatusDialog(null); if (r) state.reload(); };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deletePost = async () => {
    const r: any = await act.run(() => api(`/job-posts/${id}`, { method: 'DELETE' }));
    if (r) router.push(`/vacancies/${r.vacancyId}`);
  };
  const uploadCircular = async (file: File) => { const fd = new FormData(); fd.append('file', file); await act.run(() => api(`/job-posts/${id}/circular`, { form: fd }), 'Circular attached.'); state.reload(); };

  return (
    <Loaded state={state}>
      {(j: any) => form && (
        <>
          <PageHeader back={{ href: `/vacancies/${j.vacancyId}`, label: j.vacancy.vacancyNo }}
            title={<span className="flex items-center gap-3">{j.jobNo} <Badge>{j.status}</Badge></span>}
            subtitle={`${j.vacancy.positionTitle} · ${j.vacancy.department.name} · ${j.vacancy.company.name} · headcount ${j.vacancy.headcount}`}
            actions={<>
              <Button variant="secondary" onClick={() => download(`/job-posts/${id}/circular-file?format=pdf&download=1`)}>Download PDF</Button>
              <Button variant="secondary" onClick={() => download(`/job-posts/${id}/circular-file?format=txt&download=1`)}>Download text</Button>
              {editable && <>
              {j.status === 'Draft' && <Button onClick={() => setStatus('Published')}>Publish</Button>}
              {j.status === 'Published' && <Button variant="secondary" onClick={() => setStatusDialog('Closed')}>Close post</Button>}
              {j.status === 'Closed' && <Button variant="secondary" onClick={() => setStatus('Published')}>Re-open</Button>}
              {['Draft', 'Published'].includes(j.status) && <Button variant="danger" onClick={() => setStatusDialog('Cancelled')}>Cancel post</Button>}
              {/* Vacancy coordinator, HR Manager, Super Admin (owner, 2026-11-08); the API checks the scope. */}
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
              </>}
            </>} />
          <div className="mb-4 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert>
            {filled.length > 0 && <Alert tone="info">{FILLED_LABEL(filled)} filled in from the {j.vacancy.source === 'DIRECT_HR' ? 'vacancy' : 'requisition'}. Check them and click Save; the circular uses the saved details.</Alert>}</div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Circular & requirements" actions={editable && <Button size="sm" busy={act.busy} onClick={savePost}>Save</Button>}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Attached company" className="sm:col-span-2" hint="Comes from the vacancy (its requisition for an approved requisition) and is printed on the circular."><Input value={`${j.vacancy.company.name} (${j.vacancy.company.code})`} disabled readOnly /></Field>
                <Field label="Title" className="sm:col-span-2"><Input value={form.title} disabled={!editable} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                <Field label="Application start"><Input type="date" value={form.startDate} disabled={!editable} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
                <Field label="Deadline"><Input type="date" value={form.deadline} disabled={!editable} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
                <Field label="Education / qualification"><Input value={form.education} disabled={!editable} onChange={(e) => setForm({ ...form, education: e.target.value })} /></Field>
                <Field label="Required degree / subject"><Input value={form.requiredDegree} disabled={!editable} onChange={(e) => setForm({ ...form, requiredDegree: e.target.value })} /></Field>
                <Field label="Minimum CGPA (if applicable)"><Input type="number" step="0.01" value={form.minCgpa} disabled={!editable} onChange={(e) => setForm({ ...form, minCgpa: e.target.value })} /></Field>
                <Field label="Experience requirement"><Input value={form.experienceRequirement} disabled={!editable} placeholder="e.g. 3-6 years in factory administration" onChange={(e) => setForm({ ...form, experienceRequirement: e.target.value })} /></Field>
                <Field label="Job location"><Input value={form.location} disabled={!editable} placeholder="e.g. Head Office, Uttara, Dhaka" onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
                <Field label="Employment type"><Select value={form.employmentType} disabled={!editable} onChange={(e) => setForm({ ...form, employmentType: e.target.value })} options={['Full-time', 'Part-time', 'Contractual', 'Internship', 'Trainee'].map((v) => ({ value: v, label: v }))} /></Field>
                <Field label="Job shift"><Input value={form.jobShift} disabled={!editable} placeholder="e.g. Day and Night (optional)" onChange={(e) => setForm({ ...form, jobShift: e.target.value })} /></Field>
                <Field label="Salary"><Input value={form.salary} disabled={!editable} placeholder="As per company policy" onChange={(e) => setForm({ ...form, salary: e.target.value })} /></Field>
                <Field label="Send CVs to (email)" hint="Empty = the company career address."><Input type="email" value={form.applyEmail} disabled={!editable} placeholder="career@ananta.com.bd" onChange={(e) => setForm({ ...form, applyEmail: e.target.value })} /></Field>
                <Field label="Email subject for applicants" hint="Designation and department are enough: the mail scan matches emailed CVs to this post by them. Empty = the placeholder."><Input value={form.emailSubject} disabled={!editable} placeholder={form.title.toLowerCase().includes(j.vacancy.department.name.toLowerCase()) ? `Application for ${form.title}` : `Application for ${form.title} - ${j.vacancy.department.name}`} onChange={(e) => setForm({ ...form, emailSubject: e.target.value })} /></Field>
                <Field label="CV submission method" className="sm:col-span-2" hint="How applicants should send their CV."><Input value={form.cvCollection} disabled={!editable} onChange={(e) => setForm({ ...form, cvCollection: e.target.value })} /></Field>
                <Field label="Job description / purpose of the role" className="sm:col-span-2" hint="Printed as the introduction on the circular."><Textarea rows={4} value={form.description} disabled={!editable} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <Field label="Key responsibilities" className="sm:col-span-2" hint="One per line; each line becomes a bullet."><Textarea rows={5} value={form.duties} disabled={!editable} onChange={(e) => setForm({ ...form, duties: e.target.value })} /></Field>
                <Field label="Required skills" className="sm:col-span-2" hint="One per line."><Textarea rows={4} value={form.skills} disabled={!editable} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></Field>
                <Field label="Circular content (paste)" className="sm:col-span-2"><Textarea rows={5} value={form.circularContent} disabled={!editable} onChange={(e) => setForm({ ...form, circularContent: e.target.value })} /></Field>
                <Field label="Circular attachment (PDF / image)" className="sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {j.circularAttachmentName ? <a className="text-brand-700 hover:underline" target="_blank" href={`/api/job-posts/${id}/circular`}>{j.circularAttachmentName}</a> : <span className="text-muted">None</span>}
                    {editable && <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCircular(f); e.target.value = ''; }} />}
                  </div>
                </Field>
              </div>
            </Card>

            <div className="space-y-4">
              <Card title="Hiring circular" actions={<>
                <a className="text-sm text-brand-700 hover:underline" target="_blank" href={`/api/job-posts/${id}/circular-file?format=pdf`}>Open PDF</a>
                <Button size="sm" onClick={() => download(`/job-posts/${id}/circular-file?format=pdf&download=1`)}>Download PDF</Button>
                <Button size="sm" variant="secondary" onClick={() => download(`/job-posts/${id}/circular-file?format=txt&download=1`)}>Download text</Button>
              </>}>
                <p className="mb-2 text-xs text-muted">Generated from the saved job post details (empty fields come from the requisition) as a poster PDF and plain text for job portals, email or social media.{j.status === 'Draft' ? ' This post is still a draft: publish it when the circular is ready.' : ''}</p>
                <iframe key={j.updatedAt} title="Circular preview" className="h-[640px] w-full rounded-md border border-line bg-white"
                  src={`/api/job-posts/${id}/circular-file?format=pdf#view=FitH&toolbar=0`} />
                <div className="mt-3 flex items-center justify-between"><span className="text-xs font-medium text-muted">Text version</span>
                  <Button size="sm" variant="ghost" disabled={!circularText} onClick={copyText}>{copied ? 'Copied' : 'Copy text'}</Button></div>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-slate-50 p-3 text-xs">{circularText ?? 'Loading…'}</pre>
              </Card>
            </div>
          </div>
          <ConfirmDialog open={!!statusDialog} title={`${statusDialog === 'Cancelled' ? 'Cancel' : 'Close'} job post`} danger={statusDialog === 'Cancelled'} confirmLabel="Confirm" busy={act.busy} error={act.error}
            message={statusDialog === 'Cancelled' ? 'A cancelled job post cannot be re-opened.' : 'Closing stops it from being the active circular. It can be re-opened.'}
            onConfirm={() => setStatus(statusDialog!)} onClose={() => setStatusDialog(null)} />
          <ConfirmDialog open={confirmDelete} title={`Delete ${j.jobNo}?`} danger confirmLabel="Delete permanently" busy={act.busy} error={act.error}
            message={<JobPostDeleteNote />} onConfirm={deletePost} onClose={() => setConfirmDelete(false)} />
        </>
      )}
    </Loaded>
  );
}
