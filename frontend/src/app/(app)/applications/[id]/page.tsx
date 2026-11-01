'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DL, Field, Input, Loaded, PageHeader, Table, Tabs, Td, Textarea, useAction, useLoad } from '@/components/ui';
import { api, fmtDate, fmtDateTime, show } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';

const EDIT_FIELDS: [string, string, 'text' | 'number'][] = [
  ['name', 'Candidate name', 'text'], ['email', 'Email', 'text'], ['phone', 'Phone', 'text'],
  ['degree', 'Degree', 'text'], ['education', 'Education', 'text'], ['institution', 'Institution', 'text'],
  ['cgpaRaw', 'CGPA (as written)', 'text'], ['cgpa', 'CGPA (normalised, /4)', 'number'],
  ['totalExperienceYears', 'Total experience (yrs)', 'number'], ['relevantExperienceYears', 'Relevant experience (yrs)', 'number'],
  ['workplace', 'Workplace', 'text'], ['skills', 'Skills / specialization', 'text'], ['expectedSalary', 'Expected salary', 'text'], ['age', 'Age', 'number'],
];
const STAGE_LABEL: Record<string, string> = { WRITTEN: 'Written exam', INTERVIEW: 'Interview', VIVA: 'Viva' };

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
              {a.processingStatus === 'Failed' && <Alert>CV processing failed: {a.processingError}. The original CV is preserved; retry from the Processing Monitor or correct the data manually.</Alert>}
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
              { key: 'profile', label: 'Profile & CV' }, { key: 'screening', label: 'Screening' }, { key: 'evaluation', label: 'Marks & decision' },
              { key: 'emails', label: `Emails (${a.emails.length})` }, { key: 'history', label: 'Activity' },
            ]} />

            {tab === 'profile' && (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title="Original CV" actions={doc && can(P.CV_DOWNLOAD) && <a className="text-sm text-brand-700 hover:underline" target="_blank" href={`/api/documents/${doc.id}`}>Open in new tab</a>} pad={false}>
                  {!doc ? <p className="p-4 text-sm text-muted">No document.</p> : !can(P.CV_DOWNLOAD) ? <p className="p-4 text-sm text-muted">You do not have permission to view CV files.</p>
                    : /pdf|text/.test(doc.mimeType) || /\.(pdf|txt)$/i.test(doc.originalName)
                      ? <iframe title="CV preview" src={`/api/documents/${doc.id}`} className="h-[70vh] w-full rounded-b-lg" />
                      : <p className="p-4 text-sm">Preview is not available for this file type. <a className="text-brand-700 underline" href={`/api/documents/${doc.id}`}>Download {doc.originalName}</a></p>}
                  {doc && <div className="border-t border-line px-4 py-2 text-xs text-muted">{doc.originalName} · {(doc.size / 1024).toFixed(0)} KB · {doc.source === 'EMAIL' ? 'email intake' : 'manual upload'} · {fmtDateTime(doc.createdAt)}</div>}
                </Card>
                <div className="space-y-4">
                  <Card title="Extracted data" actions={can(P.CANDIDATE_EDIT) && !edit && <Button size="sm" variant="secondary" onClick={startEdit}>Correct data</Button>}>
                    <p className="mb-3 text-xs text-muted">Values come only from the CV text; anything not found stays empty for review. Extraction: <Badge>{a.extractionStatus ?? a.processingStatus}</Badge>{ex?.missingFields?.length ? <> · missing: {ex.missingFields.join(', ')}</> : null}{a.correctedFields.length ? <> · corrected by HR: {a.correctedFields.join(', ')}</> : null}</p>
                    {edit ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {EDIT_FIELDS.map(([k, l, t]) => <Field key={k} label={l}><Input type={t} step={t === 'number' ? '0.01' : undefined} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></Field>)}
                        </div>
                        <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button busy={act.busy} onClick={saveEdit}>Save corrections</Button></div>
                      </>
                    ) : (
                      <DL items={EDIT_FIELDS.map(([k, l]) => {
                        const v = ['name', 'email', 'phone'].includes(k) ? a.candidate[k] : a[k];
                        return [l, v === null || v === undefined || v === '' ? <span className="text-amber-700">Review required</span> : String(v)] as [string, React.ReactNode];
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
                {!run ? <Alert tone="info">Not screened yet{a.jobPost ? '' : ' — the vacancy has no job post with criteria'}.</Alert> : (
                  <Card title={<>Latest screening · criteria v{run.criteriaVersion} · {fmtDateTime(run.createdAt)}</>} actions={<Badge>{run.overallResult}</Badge>} pad={false}>
                    <Table head={['Criterion', 'Type', 'Expected', 'Found in CV', 'Outcome', 'Reason']}>
                      {run.results.map((c: any) => (
                        <tr key={c.criterionId}><Td>{c.label}</Td><Td>{c.mandatory ? 'Mandatory' : 'Preferred'}</Td><Td className="text-xs">{c.operator} {c.expected}</Td>
                          <Td className="text-xs">{show(c.actual, 'missing')}</Td><Td><Badge tone={c.outcome === 'Pass' ? 'green' : c.outcome === 'Fail' ? 'red' : 'amber'}>{c.outcome}</Badge></Td><Td className="text-xs">{c.reason}</Td></tr>
                      ))}
                    </Table>
                  </Card>
                )}
                {a.shortlisted && <Alert tone="info">HR shortlisted this application on {fmtDateTime(a.shortlistedAt)}{a.shortlistReason ? ` with override reason: “${a.shortlistReason}”` : ''}. The automated screening result above is unchanged.</Alert>}
                {a.screeningRuns.length > 1 && (
                  <Card title="Earlier screening runs" pad={false}>
                    <Table head={['When', 'Criteria version', 'Result']}>
                      {a.screeningRuns.slice(1).map((r: any) => <tr key={r.id}><Td className="text-xs">{fmtDateTime(r.createdAt)}</Td><Td>v{r.criteriaVersion}</Td><Td><Badge>{r.overallResult}</Badge></Td></tr>)}
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

            {tab === 'emails' && (
              <Card pad={false}>
                {a.emails.length ? (
                  <Table head={['When', 'Type', 'Recipient', 'Subject', 'Status', 'Transport']}>
                    {a.emails.map((e: any) => <tr key={e.id}><Td className="text-xs">{fmtDateTime(e.sentAt ?? e.createdAt)}</Td><Td className="text-xs">{e.kind}</Td><Td className="text-xs">{e.recipient}</Td><Td className="text-xs">{e.subject}</Td><Td><Badge>{e.status}</Badge></Td><Td className="text-xs">{e.transport === 'dev-outbox' ? 'dev outbox (not delivered)' : show(e.transport)}</Td></tr>)}
                  </Table>
                ) : <p className="p-4 text-sm text-muted">No emails.</p>}
              </Card>
            )}

            {tab === 'history' && (
              <Card pad={false}>
                <Table head={['When', 'Who', 'Action', 'Changes']}>
                  {a.history.map((h: any) => (
                    <tr key={h.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(h.createdAt)}</Td><Td>{h.actorName}</Td><Td className="text-xs">{h.action}</Td>
                      <Td className="text-xs">{h.newValues ? Object.entries(h.newValues).map(([k, v]) => <div key={k}><b>{k}</b>: {h.oldValues && k in h.oldValues ? <><s className="text-muted">{String(h.oldValues[k])}</s> → </> : null}{typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>) : '—'}</Td></tr>
                  ))}
                </Table>
              </Card>
            )}
          </>
        );
      }}
    </Loaded>
  );
}
