'use client';

import { useParams } from 'next/navigation';
import { RequisitionForm } from '@/components/RequisitionForm';
import { Alert, Loaded, PageHeader, useLoad } from '@/components/ui';
import { api } from '@/lib/api';

export default function EditRequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const state = useLoad(() => api(`/requisitions/${id}`), [id]);
  return (
    <Loaded state={state}>
      {(r: any) => (
        <>
          <PageHeader title={`Edit ${r.reqNo ?? 'draft'}`} back={{ href: `/requisitions/${id}`, label: 'Back to requisition' }} />
          {!r.canEdit ? <Alert>This requisition is "{r.status}" and can no longer be edited by you.</Alert> : (
            <>
              {r.status === 'Returned for Clarification' && (
                <div className="mb-4"><Alert tone="warning">Returned for clarification: {r.approvals.find((a: any) => a.status === 'Returned')?.remarks}</Alert></div>
              )}
              <RequisitionForm initial={r} />
            </>
          )}
        </>
      )}
    </Loaded>
  );
}
