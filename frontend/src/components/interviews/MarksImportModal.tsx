'use client';

import { useState } from 'react';
import { api, download } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Field, Input, Modal, Table, Td, useAction } from '../ui';
import { ROUND_LABEL } from './rounds';

/** Excel marks upload for one exam of one vacancy: preview first, nothing is saved until confirmed; rows are matched by ID only. */
export function MarksImportModal({ vacancyId, vacancyLabel, stage, open, onClose, onDone }: { vacancyId: string; vacancyLabel: string; stage: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const [maxMarks, setMaxMarks] = useState('100');
  const [batch, setBatch] = useState<any | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const act = useAction();
  const preview = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await act.run(() => api(`/vacancies/${vacancyId}/marks-import?stageType=${stage}&maxMarks=${maxMarks}`, { form: fd }));
    if (r) { setBatch(r); setOverwrite(false); }
  };
  const confirm = async () => {
    const r = await act.run(() => api(`/imports/${batch.id}/confirm`, { body: { allowOverwrite: overwrite } }), (x: any) => (x.duplicate ? 'Already imported.' : `${x.saved} row(s) saved.`));
    if (r) { setBatch({ ...batch, status: 'Confirmed' }); onDone(); }
  };
  const close = () => { setBatch(null); onClose(); };
  return (
    <Modal open={open} wide title={`Upload ${ROUND_LABEL[stage]} marks · ${vacancyLabel}`} onClose={close}
      footer={<>
        <Button variant="secondary" onClick={close}>{batch?.status === 'Confirmed' ? 'Close' : 'Cancel'}</Button>
        {batch && batch.status === 'Previewed' && <Button busy={act.busy} disabled={!batch.rowsAccepted || (batch.rowsOverwrite > 0 && !overwrite)} onClick={confirm}>Save {batch.rowsAccepted} valid row(s)</Button>}
      </>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Maximum marks"><Input type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} /></Field>
          <Field label="Template"><Button variant="secondary" onClick={() => act.run(() => download(`/vacancies/${vacancyId}/marks-template?stageType=${stage}`))}>Download template</Button></Field>
        </div>
        <Field label="Excel file (.xlsx)" hint="Rows are matched by Application ID (or Candidate ID within this vacancy). Name-only or row-order matching is not used.">
          <input type="file" accept=".xlsx" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) preview(f); e.target.value = ''; }} />
        </Field>
        <Alert>{act.error}</Alert>
        <Alert tone="success">{act.message}</Alert>
        {batch && (
          <>
            <div className="text-sm">Batch <b>{batch.batchNo}</b> · sheet “{batch.sheetName}” · columns: {batch.detectedColumns.join(', ')}</div>
            <div className="flex flex-wrap gap-3 text-sm"><span>Rows: <b>{batch.rowsTotal}</b></span><span className="text-emerald-700">Valid: <b>{batch.rowsAccepted}</b></span><span className="text-red-700">Errors: <b>{batch.rowsRejected}</b></span>{batch.rowsOverwrite > 0 && <span className="text-amber-700">Overwrites: <b>{batch.rowsOverwrite}</b></span>}</div>
            <Table head={['Row', 'Application ID', 'Candidate ID', 'Name', 'Marks', 'Previous', 'Status', 'Errors']}>
              {batch.rows.map((r: any) => (
                <tr key={r.id} className={r.status === 'Error' ? 'bg-red-50/50' : r.status === 'Overwrite' ? 'bg-amber-50/50' : ''}>
                  <Td>{r.rowNumber}</Td><Td>{r.applicationNo ?? '—'}</Td><Td>{r.candidateNo ?? '—'}</Td><Td>{r.candidateName ?? '—'}</Td>
                  <Td>{r.marks ?? '—'}</Td><Td>{r.previousMarks ?? '—'}</Td><Td><Badge tone={r.status === 'Error' ? 'red' : r.status === 'Overwrite' ? 'amber' : 'green'}>{r.status}</Badge></Td>
                  <Td className="text-xs text-red-700">{r.errors.join(' ')}</Td>
                </tr>
              ))}
            </Table>
            {batch.rowsOverwrite > 0 && batch.status === 'Previewed' && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} disabled={!can(P.MARKS_OVERWRITE)} onChange={(e) => setOverwrite(e.target.checked)} className="accent-brand-600" />
                Replace {batch.rowsOverwrite} existing mark(s) {!can(P.MARKS_OVERWRITE) && <span className="text-red-700">(requires overwrite permission)</span>}</label>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
