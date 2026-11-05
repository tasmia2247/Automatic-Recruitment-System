'use client';

import { RequisitionDetail } from '@/components/RequisitionDetail';

/** The only place where an approver approves, returns or rejects a requisition. */
export default function ApprovalDecisionPage() {
  return <RequisitionDetail inbox />;
}
