'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, download, qs, show } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { EmailComposer } from '../EmailComposer';
import { Alert, Badge, Button, Card, ConfirmDialog, Input, Loaded, Pager, Select, Table, Td, useAction, useLoad } from '../ui';

export function CandidatesTab({ vacancy }: { vacancy: any }) {
  const { can } = useAuth();
  const [filters, setFilters] = useState({ q: '', result: '', sort: '', dir: 'DESC', shortlisted: '', duplicate: '' });
  const [page, setPage] = useState(1);
  const state = useLoad(() => api(`/vacancies/${vacancy.id}/applications${qs({ ...filters, page, pageSize: 50 })}`), [vacancy.id, filters, page]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadResults, setUploadResults] = useState<any[] | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [invite, setInvite] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const act = useAction();

  // Poll while CVs are still being extracted/screened so progress is visible.
  const processing = (state.data?.items ?? []).some((a: any) => ['Queued', 'Processing', 'Received'].includes(a.processingStatus));
  useEffect(() => {
    if (!processing) return;
    const t = setTimeout(state.reload, 3000);
    return () => clearTimeout(t);
  }, [processing, state.data]);

  const items: any[] = state.data?.items ?? [];
  const chosen = items.filter((a) => selected.has(a.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setF = (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const upload = async (files: FileList) => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    const r = await act.run(() => api(`/vacancies/${vacancy.id}/cvs`, { form: fd }));
    if (r) { setUploadResults(r); state.reload(); }
  };

  const shortlist = async (reason?: string) => {
    const r = await act.run(() => api(`/vacancies/${vacancy.id}/shortlist`, { body: { applicationIds: [...selected], shortlisted: true, reason: reason || undefined } }));
    if (r) {
      const failed = r.filter((x: any) => !x.ok);
      act.setMessage(`${r.length - failed.length} shortlisted.`);
      if (failed.length) act.setError(failed.map((f: any) => `${f.applicationNo ?? ''}: ${f.error}`).join(' '));
      setOverrideOpen(false);
      setSelected(new Set());
      state.reload();
    }
  };
  const needsOverride = chosen.some((a) => a.screeningResult !== 'Pass');
  const counts = Object.fromEntries((state.data?.counts ?? []).map((c: any) => [c.result, c.n]));

  return (
    <div className="space-y-4">
      {can(P.CV_UPLOAD) && (
        <Card title="Add CVs (manual upload)" actions={<span className="text-xs text-muted">PDF, DOCX or TXT · each file is processed separately</span>}>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.doc,.txt" className="text-sm" onChange={(e) => e.target.files?.length && upload(e.target.files)} />
            {act.busy && <span className="text-sm text-muted">Uploading…</span>}
          </div>
          {uploadResults && (
            <ul className="mt-3 space-y-1 text-sm">
              {uploadResults.map((r, i) => (
                <li key={i} className={r.ok ? 'text-emerald-700' : 'text-red-700'}>
                  {r.ok ? '✓' : '✕'} {r.fileName} — {r.ok ? `${r.applicationNo} (${r.candidateNo}) queued for extraction` : r.error}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {['Pass', 'Review Required', 'Fail', 'Not screened'].map((k) => <span key={k} className="flex items-center gap-1"><Badge>{k}</Badge><b className="tabular-nums">{counts[k] ?? 0}</b></span>)}
        {processing && <span className="text-muted">· processing CVs…</span>}
      </div>

      <Alert>{act.error}</Alert>
      <Alert tone="success">{act.message}</Alert>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input className="max-w-[14rem]" placeholder="Search name, email, ID, institution…" value={filters.q} onChange={(e) => setF('q', e.target.value)} />
          <Select className="max-w-[11rem]" value={filters.result} onChange={(e) => setF('result', e.target.value)} placeholder="All results" options={['Pass', 'Review Required', 'Fail'].map((s) => ({ value: s, label: s }))} />
          <Select className="max-w-[12rem]" value={filters.sort} onChange={(e) => setF('sort', e.target.value)} placeholder="Sort: result group" options={[['cgpa', 'CGPA'], ['experience', 'Experience'], ['name', 'Name'], ['institution', 'Institution'], ['degree', 'Degree'], ['received', 'Received']].map(([v, l]) => ({ value: v, label: `Sort: ${l}` }))} />
          {filters.sort && <Select className="max-w-[8rem]" value={filters.dir} onChange={(e) => setF('dir', e.target.value)} options={[{ value: 'DESC', label: 'High → low' }, { value: 'ASC', label: 'Low → high' }]} />}
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={filters.shortlisted === 'true'} onChange={(e) => setF('shortlisted', e.target.checked ? 'true' : '')} className="accent-brand-600" /> Shortlisted only</label>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={filters.duplicate === 'true'} onChange={(e) => setF('duplicate', e.target.checked ? 'true' : '')} className="accent-brand-600" /> Duplicate review</label>
          <div className="flex-1" />
          {can(P.SCREENING_RUN) && <Button size="sm" variant="secondary" onClick={() => act.run(() => api(`/vacancies/${vacancy.id}/rescreen`, { method: 'POST' }), (r: any) => `${r.queued} application(s) queued for re-screening with the current criteria version.`).then(() => setTimeout(state.reload, 1500))}>Re-run screening</Button>}
          {can(P.EXPORT) && <Button size="sm" variant="secondary" onClick={() => act.run(() => download(`/vacancies/${vacancy.id}/export${qs({ result: filters.result })}`))}>Export Excel</Button>}
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50 px-3 py-2 text-sm">
            <b>{selected.size} selected</b>
            {can(P.SHORTLIST) && <Button size="sm" onClick={() => (needsOverride ? setOverrideOpen(true) : shortlist())}>Shortlist for interview</Button>}
            {can(P.EMAIL_SEND) && <Button size="sm" variant="secondary" onClick={() => setInvite(true)}>Send interview invitation</Button>}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
        <Loaded state={state} empty={(d: any) => !d.items.length && 'No applications yet. Upload CVs above.'}>
          {(d: any) => (
            <>
              <Table head={[<input key="all" type="checkbox" aria-label="Select all" checked={items.length > 0 && items.every((a) => selected.has(a.id))} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((a) => a.id)) : new Set())} className="accent-brand-600" />,
                'Candidate', 'Application', 'Degree / Institution', 'CGPA', 'Exp. (yrs)', 'Contact', 'Processing', 'Screening', 'HR decision']}>
                {d.items.map((a: any) => (
                  <tr key={a.id} className={selected.has(a.id) ? 'bg-brand-50/50' : 'hover:bg-slate-50'}>
                    <Td><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="accent-brand-600" aria-label={`Select ${a.applicationNo}`} /></Td>
                    <Td><Link className="font-medium text-brand-700 hover:underline" href={`/applications/${a.id}`}>{a.candidate.name ?? <i className="text-amber-700">Name needs review</i>}</Link><div className="text-xs text-muted">{a.candidate.candidateNo}</div></Td>
                    <Td className="text-xs">{a.applicationNo}{a.duplicateReview === 'PENDING' && <div><Badge tone="amber">Possible duplicate</Badge></div>}</Td>
                    <Td className="max-w-[14rem] text-xs">{show(a.degree, '—')}<div className="text-muted">{show(a.institution, '')}</div></Td>
                    <Td className="tabular-nums">{a.cgpa ?? (a.cgpaRaw ? <span className="text-xs text-amber-700">{a.cgpaRaw}</span> : '—')}</Td>
                    <Td className="tabular-nums">{show(a.totalExperienceYears)}</Td>
                    <Td className="text-xs">{a.candidate.email ?? <span className="text-amber-700">no email</span>}<div className="text-muted">{a.candidate.phone ?? ''}</div></Td>
                    <Td><Badge>{a.processingStatus}</Badge>{a.processingError && <div className="mt-1 max-w-[12rem] text-xs text-red-700">{a.processingError}</div>}</Td>
                    <Td>{a.screeningResult ? <Badge>{a.screeningResult}</Badge> : <Badge>Not screened</Badge>}
                      {a.screeningReasons?.length > 0 && <div className="mt-1 max-w-[16rem] text-xs text-muted">{a.screeningReasons.join(' ')}</div>}</Td>
                    <Td className="text-xs">{a.shortlisted ? <Badge tone="violet">Shortlisted</Badge> : '—'}{a.shortlistReason && <div className="mt-1 text-muted">Override: {a.shortlistReason}</div>}
                      {a.finalDecision !== 'Pending' && <div className="mt-1"><Badge>{a.finalDecision}</Badge></div>}</Td>
                  </tr>
                ))}
              </Table>
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </Loaded>
      </Card>

      <ConfirmDialog open={overrideOpen} title="Shortlist with HR override" confirmLabel="Shortlist" busy={act.busy} error={act.error}
        message={<>Some selected candidates did not pass automated screening ({chosen.filter((a) => a.screeningResult !== 'Pass').map((a) => `${a.candidate.name ?? a.applicationNo}: ${a.screeningResult ?? 'Not screened'}`).join('; ')}). Their screening result will stay unchanged; your override and reason are recorded separately.</>}
        requireReason={chosen.some((a) => a.screeningResult === 'Fail')} reasonLabel="Override reason" onConfirm={(r) => shortlist(r)} onClose={() => setOverrideOpen(false)} />
      <EmailComposer open={invite} onClose={() => setInvite(false)} kind="INTERVIEW_INVITE" applicationIds={[...selected]} onSent={() => state.reload()} />
    </div>
  );
}
