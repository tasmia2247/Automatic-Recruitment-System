'use client';

import { RequisitionForm } from '@/components/RequisitionForm';
import { PageHeader } from '@/components/ui';

export default function NewRequisitionPage() {
  return (
    <>
      <PageHeader title="New manpower requisition" back={{ href: '/requisitions', label: 'Requisitions' }}
        subtitle="Save a draft at any time. Required fields are checked when you submit; your entries are kept if anything is missing." />
      <RequisitionForm />
    </>
  );
}
