'use client';

import { PageHeader } from '@/components/ui';
import { RecruitmentDashboardBody } from './_body';

/** Recruitment Dashboard page (owner, 2026-11-09). The body is shared with the main dashboard. */
export default function RecruitmentDashboardPage() {
  return (
    <>
      <PageHeader title="Recruitment Dashboard"
        subtitle="Live funnel, conversion and top vacancies across the vacancies you coordinate (HR Manager / Super Admin see every vacancy)." />
      <RecruitmentDashboardBody />
    </>
  );
}
