'use client';

import { Field, Input, Textarea } from './ui';

/** The "Specialization required" fields CVs are screened against. `specialization` holds "Other requirements". */
export const SPEC_KEYS = ['requiredEducation', 'requiredSkills', 'requiredExperienceYears', 'specialization'] as const;
type Spec = Record<string, any>;

/** The request body for the four fields: blank text and an empty number become null. */
export const specPayload = (f: Spec) => ({
  requiredEducation: f.requiredEducation?.trim() || null,
  requiredSkills: f.requiredSkills?.trim() || null,
  requiredExperienceYears: f.requiredExperienceYears === '' || f.requiredExperienceYears === null || f.requiredExperienceYears === undefined ? null : Number(f.requiredExperienceYears),
  specialization: f.specialization?.trim() || null,
});

export const hasSpec = (f: Spec | null | undefined) => !!f && SPEC_KEYS.some((k) => f[k] !== null && f[k] !== undefined && String(f[k]).trim() !== '');

export function SpecializationFields({ value, onChange, errors = {}, disabled }: {
  value: Spec; onChange: (key: string, v: any) => void; errors?: Record<string, string | undefined>; disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Education / Qualification" error={errors.requiredEducation}
        hint="Minimum degree and subject, e.g. BSc in Textile Engineering. Put alternatives on separate lines; one of them is enough.">
        <Textarea rows={2} disabled={disabled} value={value.requiredEducation ?? ''} onChange={(e) => onChange('requiredEducation', e.target.value)} />
      </Field>
      <Field label="Skills" error={errors.requiredSkills} hint="Separate with commas or new lines, e.g. MS Excel, AutoCAD. Each must be written in the CV.">
        <Textarea rows={2} disabled={disabled} value={value.requiredSkills ?? ''} onChange={(e) => onChange('requiredSkills', e.target.value)} />
      </Field>
      <Field label="Minimum experience (years)" error={errors.requiredExperienceYears} hint="Compared with the experience in the CV. Leave empty if not needed.">
        <Input type="number" min={0} max={60} step={0.5} disabled={disabled} value={value.requiredExperienceYears ?? ''} onChange={(e) => onChange('requiredExperienceYears', e.target.value)} />
      </Field>
      <Field label="Other requirements" error={errors.specialization} hint="Anything else that must be written in the CV (certificates, tools, languages), separated by commas or new lines.">
        <Textarea rows={2} disabled={disabled} value={value.specialization ?? ''} onChange={(e) => onChange('specialization', e.target.value)} />
      </Field>
    </div>
  );
}

/** Read-only view of the four fields. */
export function SpecializationView({ value, empty = 'Not set' }: { value: Spec | null | undefined; empty?: string }) {
  if (!hasSpec(value)) return <span className="text-amber-700">{empty}</span>;
  const rows: [string, any][] = [
    ['Education / Qualification', value!.requiredEducation],
    ['Skills', value!.requiredSkills],
    ['Minimum experience', value!.requiredExperienceYears !== null && value!.requiredExperienceYears !== undefined && value!.requiredExperienceYears !== '' ? `${Number(value!.requiredExperienceYears)} years` : null],
    ['Other requirements', value!.specialization],
  ];
  return (
    <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[11rem_1fr]">
      {rows.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '').map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>
      ))}
    </dl>
  );
}
