'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, Loaded, PageHeader, Select, Table, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, download, fmtDateTime } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const FIELDS: [string, string, boolean][] = [
  ['degree', 'Degree', false], ['education', 'Education (all lines)', false], ['institution', 'Institution', false], ['cgpa', 'CGPA', true],
  ['totalExperienceYears', 'Total experience (years)', true], ['relevantExperienceYears', 'Relevant experience (years)', true],
  ['skills', 'Skills', false], ['expectedSalary', 'Expected salary', true], ['age', 'Age', true],
];
const OPS: Record<string, [string, string][]> = {
  num: [['gte', 'at least (≥)'], ['lte', 'at most (≤)'], ['eq', 'equals']],
  text: [['contains_any', 'contains any of'], ['contains_all', 'contains all of']],
};
const isNum = (f: string) => FIELDS.find((x) => x[0] === f)?.[2];

export default function JobPostPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const state = useLoad(() => api(`/job-posts/${id}`), [id]);
  const [form, setForm] = useState<any>(null);
  const [criteria, setCriteria] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [statusDialog, setStatusDialog] = useState<string | null>(null);
  const [circularText, setCircularText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const act = useAction();
  const editable = can(P.JOBPOST_EDIT);

  useEffect(() => {
    if (!state.data) return;
    const j = state.data;
    setForm({ title: j.title, startDate: j.startDate ?? '', deadline: j.deadline ?? '', description: j.description ?? '', duties: j.duties ?? '', education: j.education ?? '', requiredDegree: j.requiredDegree ?? '', minCgpa: j.minCgpa ?? '', experienceRequirement: j.experienceRequirement ?? '', cvCollection: j.cvCollection ?? '', circularContent: j.circularContent ?? '', location: j.location ?? '', employmentType: j.employmentType ?? 'Full-time', jobShift: j.jobShift ?? '', salary: j.salary ?? '', skills: j.skills ?? '', applyEmail: j.applyEmail ?? '', emailSubject: j.emailSubject ?? '' });
    api(`/job-posts/${j.id}/circular-file?format=txt`, { raw: true }).then((r: Response) => r.text()).then(setCircularText).catch(() => setCircularText(null));
    setCriteria((j.currentCriteria?.criteria ?? []).map(({ label, field, operator, value, mandatory, missingPolicy }: any) => ({ label, field, operator, value, mandatory, missingPolicy })));
  }, [state.data]);

  const savePost = () => act.run(() => api(`/job-posts/${id}`, { method: 'PUT', body: { ...form, startDate: form.startDate || null, deadline: form.deadline || null, minCgpa: form.minCgpa === '' ? null : Number(form.minCgpa), applyEmail: form.applyEmail || null } }), 'Job post saved. The circular below uses the saved details.').then(state.reload);
  const copyText = async () => { await navigator.clipboard.writeText(circularText ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const saveCriteria = () => act.run(() => api(`/job-posts/${id}/criteria`, { body: { criteria, note: note || undefined } }), (r: any) => `Saved as criteria version ${r.version}. Earlier screening results keep their original version.`).then(() => { setNote(''); state.reload(); });
  const setStatus = async (status: string) => { const r = await act.run(() => api(`/job-posts/${id}/status`, { body: { status } }), `Job post ${status.toLowerCase()}.`); setStatusDialog(null); if (r) state.reload(); };
  const upd = (i: number, k: string, v: any) => setCriteria((c) => c.map((x, j) => (j === i ? { ...x, [k]: v, ...(k === 'field' ? { operator: isNum(v) ? 'gte' : 'contains_any' } : {}) } : x)));
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
              </>}
            </>} />
          <div className="mb-4 space-y-2"><Alert>{act.error}</Alert><Alert tone="success">{act.message}</Alert></div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Circular & requirements" actions={editable && <Button size="sm" busy={act.busy} onClick={savePost}>Save</Button>}>
              <div className="grid gap-3 sm:grid-cols-2">
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
                <Field label="Email subject for applicants" hint={`${j.jobNo} is added automatically so emailed CVs reach this post.`}><Input value={form.emailSubject} disabled={!editable} placeholder={`Application for ${form.title}`} onChange={(e) => setForm({ ...form, emailSubject: e.target.value })} /></Field>
                <Field label="CV submission method" className="sm:col-span-2" hint={`Email intake routes CVs whose subject contains ${j.jobNo}.`}><Input value={form.cvCollection} disabled={!editable} onChange={(e) => setForm({ ...form, cvCollection: e.target.value })} /></Field>
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
                {j.status === 'Draft'
                  ? <Alert tone="warning">Draft: the files are marked “not yet published”. Publish the job post to get the final circular.</Alert>
                  : <p className="mb-2 text-xs text-muted">Generated from the saved job post details as a poster PDF and plain text (for job portals, email or social media).</p>}
                <div className="mt-2 flex items-center justify-between"><span className="text-xs font-medium text-muted">Text version</span>
                  <Button size="sm" variant="ghost" disabled={!circularText} onClick={copyText}>{copied ? 'Copied' : 'Copy text'}</Button></div>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-slate-50 p-3 text-xs">{circularText ?? 'Loading…'}</pre>
              </Card>
              <Card title={<>Screening criteria {j.currentCriteriaVersion ? <span className="font-normal text-muted">· current v{j.currentCriteriaVersion}</span> : null}</>}
                actions={editable && <Button size="sm" variant="secondary" onClick={() => setCriteria([...criteria, { label: '', field: 'degree', operator: 'contains_any', value: '', mandatory: true, missingPolicy: 'REVIEW' }])}>Add criterion</Button>}>
                <p className="mb-3 text-xs text-muted">Mandatory criteria decide Pass / Fail; preferred ones are reported only. Missing data → “Review Required” unless set otherwise. Saving creates a new version; past results are never rewritten.</p>
                {!criteria.length && <p className="text-sm text-amber-700">No criteria yet — screening will be skipped until criteria are saved.</p>}
                <div className="space-y-3">
                  {criteria.map((c, i) => (
                    <div key={i} className="rounded-md border border-line p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="Label"><Input value={c.label} disabled={!editable} placeholder="e.g. CGPA at least 3.00" onChange={(e) => upd(i, 'label', e.target.value)} /></Field>
                        <Field label="Field"><Select value={c.field} disabled={!editable} onChange={(e) => upd(i, 'field', e.target.value)} options={FIELDS.map(([v, l]) => ({ value: v, label: l }))} /></Field>
                        <Field label="Condition"><Select value={c.operator} disabled={!editable} onChange={(e) => upd(i, 'operator', e.target.value)} options={(isNum(c.field) ? OPS.num : OPS.text).map(([v, l]) => ({ value: v, label: l }))} /></Field>
                        <Field label={isNum(c.field) ? 'Value' : 'Keywords (comma-separated)'}><Input value={c.value} disabled={!editable} onChange={(e) => upd(i, 'value', e.target.value)} /></Field>
                        <Field label="Type"><Select value={c.mandatory ? 'm' : 'p'} disabled={!editable} onChange={(e) => upd(i, 'mandatory', e.target.value === 'm')} options={[{ value: 'm', label: 'Mandatory' }, { value: 'p', label: 'Preferred' }]} /></Field>
                        <Field label="If data is missing"><Select value={c.missingPolicy} disabled={!editable} onChange={(e) => upd(i, 'missingPolicy', e.target.value)} options={[{ value: 'REVIEW', label: 'Review Required' }, { value: 'FAIL', label: 'Treat as Fail' }, { value: 'IGNORE', label: 'Ignore' }]} /></Field>
                      </div>
                      {editable && <div className="mt-2 text-right"><Button size="sm" variant="ghost" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>Remove</Button></div>}
                    </div>
                  ))}
                </div>
                {editable && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Field label="Change note (optional)" className="flex-1"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                    <Button busy={act.busy} disabled={!criteria.length || criteria.some((c) => !c.label || !c.value)} onClick={saveCriteria}>Save as new version</Button>
                  </div>
                )}
              </Card>
              <Card title="Criteria version history" pad={false}>
                {j.criteriaSets.length ? (
                  <Table head={['Version', 'Saved', 'Criteria', 'Note']}>
                    {j.criteriaSets.map((s: any) => (
                      <tr key={s.id}>
                        <Td>v{s.version}{s.version === j.currentCriteriaVersion && <> <Badge tone="green">current</Badge></>}</Td>
                        <Td className="whitespace-nowrap text-xs">{fmtDateTime(s.createdAt)}</Td>
                        <Td className="text-xs">{s.criteria.map((c: any) => `${c.label}${c.mandatory ? '' : ' (preferred)'}`).join('; ')}</Td>
                        <Td className="text-xs">{s.note ?? '—'}</Td>
                      </tr>
                    ))}
                  </Table>
                ) : <p className="p-4 text-sm text-muted">No versions yet.</p>}
              </Card>
            </div>
          </div>
          <ConfirmDialog open={!!statusDialog} title={`${statusDialog === 'Cancelled' ? 'Cancel' : 'Close'} job post`} danger={statusDialog === 'Cancelled'} confirmLabel="Confirm" busy={act.busy} error={act.error}
            message={statusDialog === 'Cancelled' ? 'A cancelled job post cannot be re-opened.' : 'Closing stops it from being the active circular. It can be re-opened.'}
            onConfirm={() => setStatus(statusDialog!)} onClose={() => setStatusDialog(null)} />
        </>
      )}
    </Loaded>
  );
}
