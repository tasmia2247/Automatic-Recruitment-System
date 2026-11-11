'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, P } from '@/lib/auth';
import { SpecializationFields, specPayload } from './SpecializationFields';
import { Alert, Button, Card, Field, Input, Radio, Select, Textarea, useAction, useLoad } from './ui';

type Form = Record<string, any>;

const NUM_FIELDS = ['headcount', 'currentQuotaDept', 'currentQuotaDesig', 'revisedQuotaDept', 'revisedQuotaDesig', 'presentManpowerDept', 'presentManpowerDesig', 'vacancyDept', 'vacancyDesig', 'deadlineDays'];
const TEXT_FIELDS = ['rank', 'replacementEmployeeName', 'replacementEmployeeId', 'terminationReference', 'minEducation', 'experience', 'salaryPresent', 'salaryProposed', 'vacancyOverrideReason', 'jobDescription', 'background'];

const toPayload = (f: Form) => {
  const out: Form = { departmentId: f.departmentId, companyId: f.companyId, positionId: f.positionId || null, replacePlan: !!f.replacePlan };
  for (const k of NUM_FIELDS) out[k] = f[k] === '' || f[k] === null || f[k] === undefined ? null : Number(f[k]);
  for (const k of TEXT_FIELDS) out[k] = f[k] === '' || f[k] === undefined ? null : f[k];
  Object.assign(out, specPayload(f));
  out.seatsAvailable = f.seatsAvailable ?? null;
  out.gender = f.gender || null;
  if (f.requestDate) out.requestDate = f.requestDate;
  return out;
};

/** The number of years in an "Experience" text such as "2 years" or "3-5 yrs" (the lower figure); null when none. */
const yearsIn = (s: unknown) => {
  const m = String(s ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

const calc = (q: any, p: any) => (q === '' || q === null || q === undefined || p === '' || p === null || p === undefined ? null : Number(q) - Number(p));

/** Digitized Manpower Requisition Form No. 01 - keeps the original form's labels and grouping. */
export function RequisitionForm({ initial }: { initial?: Form }) {
  const router = useRouter();
  const { user, can, scopes } = useAuth();
  const lookups = useLoad(() => api('/master/lookups'));
  const [f, setF] = useState<Form>(() => initial ?? { departmentId: user?.departmentId ?? '', companyId: '', replacePlan: false, requestDate: new Date().toISOString().slice(0, 10) });
  const [attachKind, setAttachKind] = useState('TERMINATION_REQUEST');
  const [errors, setErrors] = useState<Record<string, string>>(initial?.submitErrors ?? {});
  const save = useAction();
  const set = (k: string, v: any) => setF((p) => {
    const next = { ...p, [k]: v };
    // "Min Edu. Qualification" and "Experience" fill the matching "Specialization required" fields, until those are changed by hand.
    if (k === 'minEducation' && (!p.requiredEducation || p.requiredEducation === (p.minEducation ?? ''))) next.requiredEducation = v;
    if (k === 'experience') {
      const was = yearsIn(p.experience);
      if (p.requiredExperienceYears === '' || p.requiredExperienceYears === null || p.requiredExperienceYears === undefined || Number(p.requiredExperienceYears) === was) next.requiredExperienceYears = yearsIn(v) ?? '';
    }
    return next;
  });
  const err = (k: string) => errors[k] ?? save.fieldErrors[k];

  // Prefill current quota / manpower when the scope changes (owner, 2026-11-10: dept total from master data →
  // Departments, dept present manpower is the live sum of designation rows; designation figures from the
  // matching `/master/quotas` row).
  // Prefill current quota / manpower from master data (owner, 2026-11-10: quotas are per department +
  // designation, independent of the attached company, so only departmentId / positionId matter here).
  useEffect(() => {
    if (initial?.id || !f.departmentId) return;
    Promise.all([
      api(`/master/dept-figures?departmentId=${f.departmentId}`).catch(() => null),
      f.positionId ? api(`/master/quotas?departmentId=${f.departmentId}`).catch(() => []) : Promise.resolve([]),
    ]).then(([dept, rows]) => {
      const desig = f.positionId ? (rows as any[]).find((r) => r.positionId === f.positionId) : null;
      setF((p) => ({
        ...p,
        currentQuotaDept: dept?.approvedQuota ?? p.currentQuotaDept ?? '',
        presentManpowerDept: dept?.presentManpower ?? p.presentManpowerDept ?? '',
        currentQuotaDesig: desig?.approvedQuota ?? p.currentQuotaDesig ?? '',
        presentManpowerDesig: desig?.presentManpower ?? p.presentManpowerDesig ?? '',
      }));
    });
  }, [f.departmentId, f.positionId, initial?.id]);

  const calcDept = calc(f.currentQuotaDept, f.presentManpowerDept);
  const calcDesig = calc(f.currentQuotaDesig, f.presentManpowerDesig);
  const overridden = (f.vacancyDept !== '' && f.vacancyDept !== null && f.vacancyDept !== undefined && Number(f.vacancyDept) !== calcDept)
    || (f.vacancyDesig !== '' && f.vacancyDesig !== null && f.vacancyDesig !== undefined && Number(f.vacancyDesig) !== calcDesig);

  const positions = useMemo(() => (lookups.data?.positions ?? []).filter((p: any) => p.active), [lookups.data]);
  const depts = (lookups.data?.departments ?? []).filter((d: any) => scopes.requisitions === null || (scopes.requisitions ?? [user?.departmentId]).includes(d.id));

  const persist = async () => {
    const body = toPayload(f);
    return f.id ? api(`/requisitions/${f.id}`, { method: 'PUT', body }) : api('/requisitions', { body });
  };

  const saveDraft = async () => {
    const r = await save.run(persist, 'Draft saved.');
    if (r && !f.id) router.replace(`/requisitions/${r.id}/edit`);
    else if (r) setF((p) => ({ ...p, ...r }));
  };

  const submit = async () => {
    setErrors({});
    const r = await save.run(async () => {
      const saved = await persist();
      setF((p) => ({ ...p, id: saved.id, reqNo: saved.reqNo }));
      return api(`/requisitions/${saved.id}/submit`, { method: 'POST' });
    });
    if (r) router.push(`/requisitions/${r.id}?submitted=1`);
  };

  const upload = async (file: File) => {
    if (!f.id) { save.setError('Save the draft first, then attach files.'); return; }
    const fd = new FormData();
    fd.append('file', file);
    const r = await save.run(() => api(`/requisitions/${f.id}/attachments?kind=${attachKind}`, { form: fd }), 'Attachment uploaded.');
    if (r) setF((p) => ({ ...p, attachments: [...(p.attachments ?? []), r] }));
  };

  const numInput = (k: string, props: any = {}) => <Input type="number" min={0} value={f[k] ?? ''} invalid={!!err(k)} onChange={(e) => set(k, e.target.value)} {...props} />;

  return (
    <div className="space-y-4">
      <Card title={<>Manpower Requisition Form <span className="font-normal text-muted">· {f.formNo ?? 'Form No. 01'}</span></>}
        actions={<span className="text-xs text-muted">Requisition number: <b className="text-ink">{f.reqNo ?? 'assigned on save'}</b></span>}>
        <p className="mb-4 text-sm text-muted">To: The Head of Human Resource, Ananta Companies — <i>Subject: Request for arranging manpower.</i></p>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Date" required><Input type="date" value={f.requestDate?.slice(0, 10) ?? ''} onChange={(e) => set('requestDate', e.target.value)} /></Field>
          <Field label="How many" required error={err('headcount')}>{numInput('headcount', { min: 1 })}</Field>
          <Field label="Replace plan?" error={err('replacePlan')}>
            <Radio name="replacePlan" value={!!f.replacePlan} onChange={(v) => set('replacePlan', v)} options={[{ value: true, label: 'Yes (attach termination request)' }, { value: false, label: 'No' }]} />
          </Field>
          <Field label="Rank / Position" required error={err('rank')}>
            <Select value={f.positionId ?? ''} placeholder="Select position…" options={positions.map((p: any) => ({ value: p.id, label: p.title }))}
              onChange={(e) => { const p = positions.find((x: any) => x.id === e.target.value); set('positionId', e.target.value); if (p) set('rank', p.title); }} />
          </Field>
          <Field label="Dept." required error={err('departmentId')}>
            <Select value={f.departmentId ?? ''} placeholder="Select department…" options={depts.map((d: any) => ({ value: d.id, label: d.name }))} onChange={(e) => set('departmentId', e.target.value)} />
          </Field>
          <Field label="Attached Company" required error={err('companyId')}>
            <Select value={f.companyId ?? ''} placeholder="Select company…" options={(lookups.data?.companies ?? []).filter((c: any) => c.active).map((c: any) => ({ value: c.id, label: c.name }))} onChange={(e) => set('companyId', e.target.value)} />
          </Field>
          <Field label="Min Edu. Qualification" hint="Shown on the job post." error={err('minEducation')}><Input value={f.minEducation ?? ''} onChange={(e) => set('minEducation', e.target.value)} /></Field>
          <Field label="Experience" hint="Shown on the job post." error={err('experience')}><Input value={f.experience ?? ''} placeholder="e.g. 2 years" onChange={(e) => set('experience', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Salary range: Present"><Input value={f.salaryPresent ?? ''} onChange={(e) => set('salaryPresent', e.target.value)} /></Field>
            <Field label="This case"><Input value={f.salaryProposed ?? ''} onChange={(e) => set('salaryProposed', e.target.value)} /></Field>
          </div>
        </div>

        {f.replacePlan && (
          <div className="mt-4 grid gap-4 rounded-md border border-amber-200 bg-amber-50/50 p-3 md:grid-cols-3">
            <Field label="Employee being replaced" required error={err('replacementEmployeeName')}><Input value={f.replacementEmployeeName ?? ''} onChange={(e) => set('replacementEmployeeName', e.target.value)} /></Field>
            <Field label="Employee ID"><Input value={f.replacementEmployeeId ?? ''} onChange={(e) => set('replacementEmployeeId', e.target.value)} /></Field>
            <Field label="Termination request reference" required error={err('terminationReference')} hint="Or attach the termination request below"><Input value={f.terminationReference ?? ''} onChange={(e) => set('terminationReference', e.target.value)} /></Field>
          </div>
        )}
      </Card>

      <Card title="Quota and manpower">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-3 font-medium"></th><th className="py-1 pr-3 font-medium">For Dept.</th><th className="py-1 font-medium">For Designation</th></tr></thead>
            <tbody>
              {[
                ['Current quota', 'currentQuotaDept', 'currentQuotaDesig', true],
                ['Revised quota (proposed)', 'revisedQuotaDept', 'revisedQuotaDesig', false],
                ['Present manpower', 'presentManpowerDept', 'presentManpowerDesig', true],
              ].map(([label, a, b, req]) => (
                <tr key={a as string}>
                  <td className="py-1.5 pr-3 text-xs font-medium text-muted">{label as string}{req && <span className="text-red-600"> *</span>}</td>
                  <td className="py-1.5 pr-3"><Field label="" error={err(a as string)}>{numInput(a as string)}</Field></td>
                  <td className="py-1.5"><Field label="" error={err(b as string)}>{numInput(b as string)}</Field></td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 pr-3 text-xs font-medium text-muted">Vacancy</td>
                <td className="py-1.5 pr-3">{numInput('vacancyDept', { placeholder: calcDept === null ? 'Not available' : `Calculated: ${calcDept}`, min: undefined })}</td>
                <td className="py-1.5">{numInput('vacancyDesig', { placeholder: calcDesig === null ? 'Not available' : `Calculated: ${calcDesig}`, min: undefined })}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Vacancy is calculated as quota − present manpower (Dept: {calcDept ?? 'n/a'}, Designation: {calcDesig ?? 'n/a'}). Leave blank to use the calculation. Revised quota stays a proposal until all approvals are complete.</p>
        {((calcDept ?? 0) < 0 || (calcDesig ?? 0) < 0) && <div className="mt-2"><Alert tone="warning">Present manpower exceeds quota — please review the figures.</Alert></div>}
        {overridden && (
          <Field label="Reason for overriding the calculated vacancy" required error={err('vacancyOverrideReason')} className="mt-3">
            <Input value={f.vacancyOverrideReason ?? ''} onChange={(e) => set('vacancyOverrideReason', e.target.value)} />
          </Field>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Seats available" required error={err('seatsAvailable')}><Radio name="seats" value={f.seatsAvailable} onChange={(v) => set('seatsAvailable', v)} options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]} /></Field>
          <Field label="Deadline" required error={err('deadlineDays')}><Radio name="deadline" value={f.deadlineDays === '' || f.deadlineDays == null ? null : Number(f.deadlineDays)} onChange={(v) => set('deadlineDays', v)} options={[{ value: 30, label: '30 days' }, { value: 60, label: '60 days' }]} /></Field>
          <Field label="Gender" required error={err('gender')}><Radio name="gender" value={f.gender} onChange={(v) => set('gender', v)} options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Any', label: 'Any' }]} /></Field>
        </div>
      </Card>

      <Card title="Position details">
        <div className="grid gap-4">
          <Field label="Key Responsibilities" error={err('jobDescription')}
            hint="One responsibility per line, as on the job post, e.g. Provide technical support to users and troubleshoot software/hardware/network issues. CVs are scored on the keywords of each line, and the lines go on the job post.">
            <Textarea rows={5} value={f.jobDescription ?? ''} onChange={(e) => set('jobDescription', e.target.value)} />
          </Field>
          <div>
            <div className="mb-2 text-sm font-semibold">Specialization required</div>
            <p className="mb-3 text-xs text-muted">
              CVs for this position are screened against these fields and the Key Responsibilities. Each CV gets a match score: Required Skills 50%, Key Responsibilities 30%,
              education 10% and experience 10%. A CV passes with a score of 70% or more when the education, minimum experience and other requirements are also met;
              otherwise it goes to Review Required for HR to check, with the reasons. Education and experience are filled in from Min Edu. Qualification and Experience above; you can change them.
              Required Skills also go on the job post; the other fields are used only for screening.
            </p>
            <SpecializationFields value={f} onChange={set} errors={{ requiredEducation: err('requiredEducation'), requiredSkills: err('requiredSkills'), requiredExperienceYears: err('requiredExperienceYears'), specialization: err('specialization') }} />
          </div>
          <Field label="Background of the requirement" required error={err('background')}><Textarea rows={4} value={f.background ?? ''} onChange={(e) => set('background', e.target.value)} /></Field>
        </div>
      </Card>

      <Card title="Attachments">
        {f.attachments?.length ? (
          <ul className="mb-3 space-y-1 text-sm">
            {f.attachments.map((a: any) => <li key={a.id}><a className="text-brand-700 hover:underline" href={`/api/requisitions/${f.id}/attachments/${a.id}`} target="_blank">{a.originalName}</a> <span className="text-xs text-muted">({a.kind.replace('_', ' ').toLowerCase()})</span></li>)}
          </ul>
        ) : <p className="mb-3 text-sm text-muted">No attachments.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Select className="max-w-[14rem]" value={attachKind} onChange={(e) => setAttachKind(e.target.value)} options={[{ value: 'TERMINATION_REQUEST', label: 'Termination request' }, { value: 'SIGNATURE', label: 'Signature' }, { value: 'OTHER', label: 'Other' }]} />
          <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={!f.id} onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ''; }} className="text-sm" />
          {!f.id && <span className="text-xs text-muted">Save the draft to enable attachments.</span>}
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Alert>{save.error}</Alert>
            <Alert tone="success">{save.message}</Alert>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" busy={save.busy} onClick={saveDraft}>Save draft</Button>
            <Button busy={save.busy} onClick={submit}>{initial?.status === 'Returned for Clarification' ? 'Resubmit for approval' : 'Submit for approval'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
