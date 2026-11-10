'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DL, Field, Input, Loaded, PageHeader, ScoreBar, Table, Tabs, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, fmtDate, fmtDateTime, show } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const EDIT_FIELDS: [string, string, 'text' | 'number' | 'long'][] = [
  ['name', 'Candidate name', 'text'], ['email', 'Email', 'text'], ['phone', 'Phone', 'text'],
  ['degree', 'Degree', 'text'], ['specialization', 'Education specialization', 'text'], ['education', 'Education', 'text'], ['institution', 'Institution', 'text'],
  ['cgpaRaw', 'CGPA (as written)', 'text'], ['cgpa', 'CGPA (normalised, /4)', 'number'],
  ['totalExperienceYears', 'Total experience (yrs)', 'number'], ['relevantExperienceYears', 'Relevant experience (yrs)', 'number'],
  ['lastPosition', 'Last position', 'text'], ['workplace', 'Last organization', 'text'], ['skills', 'Skills', 'text'],
  ['previousJobs', 'Previous jobs & designations', 'long'], ['certifications', 'Certifications', 'long'], ['address', 'Address', 'long'],
  ['expectedSalary', 'Expected salary', 'text'], ['age', 'Age', 'number'],
];
const runBasis = (r: any) => (r.basis === 'REQUISITION' ? `Specialization required (requisition v${r.criteriaVersion})`
  : r.basis === 'VACANCY' ? `Specialization required (vacancy v${r.criteriaVersion})` : `job post criteria v${r.criteriaVersion}`);
const STAGE_LABEL: Record<string, string> = { WRITTEN: 'Written exam', INTERVIEW: 'Interview board (viva)', OPTIONAL: 'Optional exam' };

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const state = useLoad(() => api(`/applications/${id}`), [id]);
  const [tab, setTab] = useState('profile');
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [remark, setRemark] = useState('');
  const act = useAction();

  const a = state.data;
  // Keep polling while background extraction/screening is running.
  useEffect(() => {
    if (!a || !['Queued', 'Processing', 'Received'].includes(a.processingStatus)) return;
    const t = setTimeout(state.reload, 2500);
    return () => clearTimeout(t);
  }, [a]);

  const startEdit = () => {
    const v: Record<string, any> = {};
    for (const [k] of EDIT_FIELDS) v[k] = (['name', 'email', 'phone'].includes(k) ? a.candidate[k] : a[k]) ?? '';
    setEdit(v);
  };
  const saveEdit = async () => {
    const body: Record<string, any> = {};
    for (const [k, , t] of EDIT_FIELDS) {
      const orig = (['name', 'email', 'phone'].includes(k) ? a.candidate[k] : a[k]) ?? '';
      if (String(edit![k]) !== String(orig)) body[k] = t === 'number' ? (edit![k] === '' ? null : Number(edit![k])) : edit![k] === '' && !['name', 'email', 'phone'].includes(k) ? null : edit![k];
    }
    const r = await act.run(() => api(`/applications/${id}`, { method: 'PATCH', body }), 'Corrections saved and audited. Screening will re-run with the corrected data.');
    if (r) { setEdit(null); setTimeout(state.reload, 800); }
  };

  return (
    <Loaded state={state}>
      {(a: any) => {
        const doc = a.documents[0];
        const run = a.screeningRuns[0];
        const ex = a.extractionRuns[0];
        return (
          <>
            <PageHeader back={{ href: `/vacancies/${a.vacancyId}?tab=candidates`, label: `${a.vacancy.vacancyNo} candidates` }}
              title={<span className="flex flex-wrap items-center gap-3">{a.candidate.name ?? <i className="text-amber-700">Name needs review</i>}
                {a.screeningResult && <Badge>{a.screeningResult}</Badge>}{a.shortlisted && <Badge tone="violet">Shortlisted</Badge>}{a.finalDecision !== 'Pending' && <Badge>{a.finalDecision}</Badge>}</span>}
              subtitle={<>Candidate <b>{a.candidate.candidateNo}</b> · Application <b>{a.applicationNo}</b> for <b>{a.vacancy.positionTitle}</b> ({a.vacancy.vacancyNo}, {a.vacancy.department.name})</>} />

            <div className="mb-4 space-y-2">
              <Alert>{act.error}</Alert>
              <Alert tone="success">{act.message}</Alert>
              {a.processingStatus === 'Failed' && <Alert>CV processing failed: {a.processingError}. The file is kept so you can open it below; enter the data with "Correct data", after which the file is deleted.</Alert>}
              {['Queued', 'Processing'].includes(a.processingStatus) && <Alert tone="info">CV is being processed ({a.processingStatus})…</Alert>}
              {a.duplicateReview === 'PENDING' && a.suspectedDuplicate && (
                <Card className="border-amber-300" title="Possible duplicate candidate — needs review">
                  <p className="text-sm">Evidence: {a.duplicateEvidence}. Existing record <b>{a.suspectedDuplicate.candidateNo}</b> — {show(a.suspectedDuplicate.name)}, {show(a.suspectedDuplicate.email)}, {show(a.suspectedDuplicate.phone)}; applications: {a.suspectedDuplicate.applications.map((x: any) => `${x.applicationNo} (${x.vacancyNo})`).join(', ')}.</p>
                  <p className="mt-1 text-xs text-muted">Records are never merged automatically. Merging moves this application under the existing Candidate ID; the Application ID stays the same.</p>
                  {can(P.CANDIDATE_MERGE) && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => act.run(() => api(`/applications/${id}/duplicate`, { body: { action: 'MERGE' } }), 'Merged into existing candidate.').then(state.reload)}>Same person — merge</Button>
                      <Button size="sm" variant="secondary" onClick={() => act.run(() => api(`/applications/${id}/duplicate`, { body: { action: 'SEPARATE' } }), 'Kept as separate people.').then(state.reload)}>Different people — keep separate</Button>
                    </div>
                  )}
                </Card>
              )}
              {a.otherApplications.length > 0 && <Alert tone="info">This candidate also applied for: {a.otherApplications.map((o: any) => <Link key={o.id} className="ml-1 text-brand-700 underline" href={`/applications/${o.id}`}>{o.positionTitle} ({o.applicationNo})</Link>)}. You are viewing application {a.applicationNo}.</Alert>}
            </div>

            <Tabs active={tab} onChange={setTab} tabs={[
              // The Emails and Activity tabs were removed (owner, 2026-11-08); actions stay in the Audit Log.
              { key: 'profile', label: 'Profile & CV' }, { key: 'screening', label: 'Screening' }, { key: 'evaluation', label: 'Marks & decision' },
            ]} />

            {tab === 'profile' && (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title={doc && !doc.storageKey ? 'CV text' : 'Original CV'} actions={doc?.storageKey && can(P.CV_DOWNLOAD) && <a className="text-sm text-brand-700 hover:underline" target="_blank" href={`/api/documents/${doc.id}`}>Open in new tab</a>} pad={false}>
                  {!doc ? <p className="p-4 text-sm text-muted">No document.</p> : !can(P.CV_DOWNLOAD) ? <p className="p-4 text-sm text-muted">You do not have permission to view CVs.</p>
                    // CV files are not kept once read (owner, 2026-11-08): the text read from the file is shown instead.
                    : !doc.storageKey
                      ? doc.textContent
                        ? <><p className="border-b border-line bg-slate-50 px-4 py-2 text-xs text-muted">The original file is not kept. This is the text ARS read from it, in reading order.</p>
                          <pre className="h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 font-sans text-xs leading-relaxed text-ink">{doc.textContent}</pre></>
                        : <p className="p-4 text-sm text-muted">The file could not be read and is no longer kept; the data was entered by hand.</p>
                    : /pdf|text/.test(doc.mimeType) || /\.(pdf|txt)$/i.test(doc.originalName)
                      ? <iframe title="CV preview" src={`/api/documents/${doc.id}`} className="h-[70vh] w-full rounded-b-lg" />
                      : <p className="p-4 text-sm">Preview is not available for this file type. <a className="text-brand-700 underline" href={`/api/documents/${doc.id}`}>Download {doc.originalName}</a></p>}
                  {doc && <div className="border-t border-line px-4 py-2 text-xs text-muted">{doc.originalName} · {(doc.size / 1024).toFixed(0)} KB · {doc.source === 'EMAIL' ? 'email intake' : 'manual upload'} · {fmtDateTime(doc.createdAt)}</div>}
                </Card>
                <div className="space-y-4">
                  <Card title="Extracted data" actions={!edit && <>
                    {doc && can(P.SCREENING_RUN) && <Button size="sm" variant="ghost" title="Read this CV again with the latest reading rules, then screen it again. Fields corrected by hand are kept."
                      onClick={() => act.run(() => api(`/applications/${id}/reread`, { method: 'POST' }), 'The CV is being read again; screening follows. Fields corrected by hand are kept.').then(() => setTimeout(state.reload, 800))}>Re-read CV</Button>}
                    {can(P.CANDIDATE_EDIT) && <Button size="sm" variant="secondary" onClick={startEdit}>Correct data</Button>}
                  </>}>
                    <p className="mb-3 text-xs text-muted">Values come only from the CV text; anything not found stays empty for review. Extraction: <Badge>{a.extractionStatus ?? a.processingStatus}</Badge>{ex?.missingFields?.length ? <> · missing: {ex.missingFields.join(', ')}</> : null}{a.correctedFields.length ? <> · corrected by HR: {a.correctedFields.join(', ')}</> : null}</p>
                    {edit ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {EDIT_FIELDS.map(([k, l, t]) => <Field key={k} label={l}>{t === 'long'
                            ? <Textarea rows={3} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                            : <Input type={t} step={t === 'number' ? '0.01' : undefined} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}</Field>)}
                        </div>
                        <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button busy={act.busy} onClick={saveEdit}>Save corrections</Button></div>
                      </>
                    ) : (
                      <DL items={EDIT_FIELDS.map(([k, l]) => {
                        const v = ['name', 'email', 'phone'].includes(k) ? a.candidate[k] : a[k];
                        return [l, v === null || v === undefined || v === '' ? <span className="text-amber-700">Review required</span> : <span className="whitespace-pre-line">{String(v)}</span>] as [string, React.ReactNode];
                      })} />
                    )}
                  </Card>
                  <Card title="HR remarks">
                    <div className="space-y-2">
                      {a.remarks.map((r: any) => <div key={r.id} className="rounded border border-line p-2 text-sm"><div className="whitespace-pre-wrap">{r.text}</div><div className="mt-1 text-xs text-muted">{r.author.name} · {fmtDateTime(r.createdAt)}</div></div>)}
                      {!a.remarks.length && <p className="text-sm text-muted">No remarks.</p>}
                      <Textarea placeholder="Add a remark about this application…" value={remark} onChange={(e) => setRemark(e.target.value)} />
                      <Button size="sm" disabled={!remark.trim()} busy={act.busy} onClick={() => act.run(() => api(`/applications/${id}/remarks`, { body: { text: remark } })).then((r) => { if (r) { setRemark(''); state.reload(); } })}>Add remark</Button>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {tab === 'screening' && (
              <div className="space-y-4">
                {!run ? <Alert tone="info">Not screened yet. CVs are screened against the Specialization required of the requisition, or of a Direct HR vacancy; without it they are not screened.</Alert> : (
                  <Card title={<>Latest screening · {runBasis(run)} · {fmtDateTime(run.createdAt)}</>} actions={<>{run.score != null && <ScoreBar score={run.score} passMark={run.scoreParts?.passMark} />}<Badge>{run.overallResult}</Badge></>} pad={false}>
                    {run.scoreParts && (
                      <div className="border-b border-line p-4 text-sm">
                        <div className="mb-2 font-medium">Match score {run.score}% <span className="font-normal text-muted">(pass mark {run.scoreParts.passMark}%; keywords of each requirement line searched in the CV)</span></div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {run.scoreParts.parts.map((p: any) => (
                            <div key={p.key} className="rounded-md border border-line p-2">
                              <div className="text-xs text-muted">{p.label} · weight {p.weight}</div>
                              <div className="tabular-nums"><b>{Math.round(p.earned * p.weight * 10) / 10}</b> <span className="text-xs text-muted">of {p.weight} ({Math.round(p.earned * 1000) / 10}% matched)</span></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <Table head={['Criterion', 'Type', 'Expected', 'Found in CV', 'Outcome', 'Reason']}>
                      {run.results.map((c: any) => (
                        <tr key={c.criterionId}><Td>{c.label}</Td><Td>{c.operator === 'keywords' ? 'Scored' : c.mandatory ? 'Mandatory' : 'Preferred'}</Td><Td className="text-xs">{c.operator === 'mentions' ? 'written in CV:' : c.operator === 'education' ? 'degree and subject:' : c.operator === 'min_years' ? 'at least (years):' : c.operator === 'keywords' ? 'keywords:' : c.operator === 'score' ? 'pass mark (%):' : c.operator} {c.expected}</Td>
                          <Td className="text-xs">{show(c.actual, 'missing')}</Td><Td><Badge tone={c.outcome === 'Pass' ? 'green' : c.outcome === 'Fail' ? 'red' : 'amber'}>{c.outcome !== 'Missing' ? c.outcome : c.operator !== 'keywords' ? 'Review' : c.actual ? 'Partly' : 'Not found'}</Badge></Td><Td className="text-xs">{c.reason}</Td></tr>
                      ))}
                    </Table>
                  </Card>
                )}
                {a.shortlisted && <Alert tone="info">HR shortlisted this application on {fmtDateTime(a.shortlistedAt)}{a.shortlistReason ? ` with override reason: “${a.shortlistReason}”` : ''}. The automated screening result above is unchanged.</Alert>}
                {a.screeningRuns.length > 1 && (
                  <Card title="Earlier screening runs" pad={false}>
                    <Table head={['When', 'Screened against', 'Result']}>
                      {a.screeningRuns.slice(1).map((r: any) => <tr key={r.id}><Td className="text-xs">{fmtDateTime(r.createdAt)}</Td><Td>{runBasis(r)}</Td><Td><Badge>{r.overallResult}</Badge></Td></tr>)}
                    </Table>
                  </Card>
                )}
              </div>
            )}

            {tab === 'evaluation' && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Stages" pad={false}>
                  {a.stages.length ? (
                    <Table head={['Stage', 'Schedule', 'Attendance', 'Stage result']}>
                      {a.stages.map((s: any) => <tr key={s.id}><Td>{STAGE_LABEL[s.stageType]}</Td><Td className="text-xs">{fmtDateTime(s.scheduledAt)}{s.location ? ` · ${s.location}` : ''}</Td><Td><Badge>{s.attendance}</Badge></Td><Td><Badge>{s.result}</Badge></Td></tr>)}
                    </Table>
                  ) : <p className="p-4 text-sm text-muted">No stages scheduled.</p>}
                </Card>
                <Card title="Marks" pad={false}>
                  {a.marks.length ? (
                    <Table head={['Stage', 'Component', 'Marks', 'Evaluator', 'When']}>
                      {a.marks.map((m: any) => <tr key={m.id}><Td>{STAGE_LABEL[m.stageType]}</Td><Td>{m.component}</Td><Td className="tabular-nums">{m.marks}{m.maxMarks ? ` / ${m.maxMarks}` : ''}</Td><Td>{m.evaluator.name}{m.importBatchId ? ' (import)' : ''}</Td><Td className="text-xs">{fmtDateTime(m.updatedAt)}</Td></tr>)}
                    </Table>
                  ) : <p className="p-4 text-sm text-muted">No marks recorded.</p>}
                </Card>
                <Card title="Final decision & joining">
                  <DL items={[
                    ['Final decision', <Badge key="d">{a.finalDecision}</Badge>], ['Decided', fmtDateTime(a.finalDecisionAt)], ['Remarks', show(a.finalDecisionRemarks)],
                    ['Joining status', a.joining ? <Badge key="j">{a.joining.status}</Badge> : '—'], ['Joining date', fmtDate(a.joining?.joiningDate)], ['Joining letter', show(a.joining?.letterStatus)],
                  ]} />
                </Card>
              </div>
            )}
          </>
        );
      }}
    </Loaded>
  );
}
