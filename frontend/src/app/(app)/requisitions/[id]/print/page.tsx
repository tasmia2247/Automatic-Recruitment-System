'use client';

import { useParams } from 'next/navigation';
import { FormView } from '@/components/FormView';
import { Button, LinkButton, Loaded, useLoad } from '@/components/ui';
import { api, fmtDateTime } from '@/lib/api';

/** Print / "Save as PDF" view of Form No. 01 including approval decisions at the time of export. */
export default function PrintRequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const state = useLoad(() => api(`/requisitions/${id}`), [id]);
  return (
    <Loaded state={state}>
      {(r: any) => (
        <>
          <div className="no-print mb-4 flex gap-2">
            <LinkButton href={`/requisitions/${id}`}>Back</LinkButton>
            <Button onClick={() => window.print()}>Print / Save as PDF</Button>
          </div>
          <div className="print-sheet mx-auto max-w-3xl rounded-lg border border-line bg-white p-8 shadow-sm">
            <div className="mb-6 border-b border-ink pb-3 text-center">
              <div className="text-lg font-bold tracking-wide">ANANTA COMPANIES</div>
              <div className="text-sm">Manpower Requisition — {r.formNo}</div>
            </div>
            <FormView r={r} />
            <div className="mt-8 text-[10px] text-muted">Generated from ARS on {fmtDateTime(new Date())}. Status at export: {r.status}.</div>
          </div>
        </>
      )}
    </Loaded>
  );
}
