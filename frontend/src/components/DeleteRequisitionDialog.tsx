'use client';

import { ConfirmDialog, useAction } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * Super Admin delete of a requisition (owner, 2026-11-08), used on the requisition list and the HR Approved Queue.
 * `requisition.vacancy` (vacancyNo, applications) names what goes with it. The API checks `requisition.manage_all`.
 */
export function DeleteRequisitionDialog({ requisition, onClose, onDeleted }: {
  requisition: { id: string; reqNo: string | null; vacancy?: { vacancyNo: string; applications: number } | null } | null;
  onClose: () => void; onDeleted: (message: string) => void;
}) {
  const act = useAction();
  const remove = async (reason: string) => {
    const r: any = await act.run(() => api(`/requisitions/${requisition!.id}/delete`, { body: { reason } }));
    if (r) onDeleted(`${r.reqNo ?? 'Draft requisition'} deleted${r.vacancyNo ? `, with vacancy ${r.vacancyNo} and ${r.counts.applications} application(s)` : ''}.`);
  };
  return (
    <ConfirmDialog open={!!requisition} danger title={`Delete ${requisition?.reqNo ?? 'draft requisition'}?`} confirmLabel="Delete permanently"
      busy={act.busy} error={act.error} requireReason reasonLabel="Reason for deleting" onClose={onClose} onConfirm={remove}
      message={requisition && <div className="space-y-2">
        <p>This permanently deletes the requisition with its approval history and attachments. It cannot be undone.</p>
        {requisition.vacancy && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">
          Vacancy <b>{requisition.vacancy.vacancyNo}</b> was made from it and is deleted too, with its job posts and <b>{requisition.vacancy.applications}</b> candidate application(s):
          CV data, screening, marks, interviews, emails and joining records. Candidates who did not apply anywhere else are deleted as well.</p>}
        <p className="text-muted">The Logs keep a record of the delete and your reason.</p>
      </div>} />
  );
}
