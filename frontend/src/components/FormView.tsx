import { approvalStep, fmtDate, fmtDateTime, show } from '@/lib/api';
import { SpecializationView } from './SpecializationFields';

const yn = (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No');

function Line({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="min-h-[1.5rem] border-b border-dotted border-slate-300 pb-0.5 text-sm whitespace-pre-wrap">{value}</div>
    </div>
  );
}

/** Read-only rendering of Form No. 01 with the original labels, used on screen and for print/PDF. */
export function FormView({ r }: { r: any }) {
  const latest = Math.max(0, ...r.approvals.map((a: any) => a.version));
  const sign = (label: string) => r.approvals.find((a: any) => a.version === latest && a.stepLabel === label);
  const SignBox = ({ label }: { label: string }) => {
    const a = sign(label);
    const s = a ? approvalStep(a, r.approvals) : null;
    return (
      <div className="rounded border border-line p-2 text-xs">
        <div className="font-semibold">{label}</div>
        <div className="mt-1">Decision: <b>{s ? s.status : 'Not in route'}</b>{a?.carriedOver ? ' (carried forward)' : ''}</div>
        <div>Name: {a?.approver.name ?? '—'}</div>
        <div>Date: {s?.decidedAt ? fmtDateTime(s.decidedAt) : '—'}</div>
        {s?.note && <div className="mt-1 italic">“{s.note}”</div>}
      </div>
    );
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <div><span className="text-muted">Requisition number:</span> <b>{show(r.reqNo)}</b></div>
        <div><span className="text-muted">{r.formNo}</span> · <span className="text-muted">Date:</span> {fmtDate(r.requestDate)}</div>
      </div>
      <div className="text-sm">To<br />The Head of Human Resource<br />Ananta Companies<br /><b>Subject: Request for arranging manpower.</b></div>
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Line label="How many" value={show(r.headcount)} />
        <Line label="Replace plan?" value={r.replacePlan ? `Yes — ${show(r.replacementEmployeeName)}${r.replacementEmployeeId ? ` (${r.replacementEmployeeId})` : ''}; termination ref: ${show(r.terminationReference)}` : 'No'} />
        <Line label="Rank" value={show(r.rank)} />
        <Line label="Dept." value={r.department?.name} />
        <Line label="Attached Company" value={r.company?.name} />
        <Line label="Min Edu. Qualification" value={show(r.minEducation)} />
        <Line label="Experience" value={show(r.experience)} />
        <Line label="Salary range — Present / This case" value={`${show(r.salaryPresent)} / ${show(r.salaryProposed)}`} />
        <Line label="Current quota (Dept. / Designation)" value={`${show(r.currentQuotaDept)} / ${show(r.currentQuotaDesig)}`} />
        <Line label="Revised quota (Dept. / Designation)" value={`${show(r.revisedQuotaDept)} / ${show(r.revisedQuotaDesig)}`} />
        <Line label="Present manpower (Dept. / Designation)" value={`${show(r.presentManpowerDept)} / ${show(r.presentManpowerDesig)}`} />
        <Line label="Vacancy (Dept. / Designation)" value={<>{show(r.vacancyDept)} / {show(r.vacancyDesig)}{r.calculated?.overridden && <span className="ml-2 text-xs text-amber-700">(overridden: {r.vacancyOverrideReason})</span>}</>} />
        <Line label="Seats available" value={yn(r.seatsAvailable)} />
        <Line label="Deadline · Gender" value={`${r.deadlineDays ? `${r.deadlineDays} days` : '—'} · ${show(r.gender)}`} />
        <Line label="Specialization required" value={<SpecializationView value={r} empty="—" />} wide />
        <Line label="Key Responsibilities" value={show(r.jobDescription)} wide />
        <Line label="Background of the requirement" value={show(r.background)} wide />
      </div>
      <div className="text-sm">
        <div className="text-[11px] uppercase tracking-wide text-muted">Requester</div>
        {r.requester?.name}{r.requester?.designation ? `, ${r.requester.designation}` : ''} · submitted {fmtDateTime(r.submittedAt)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SignBox label="Concerned Director" />
        <SignBox label="Concerned HR" />
        <SignBox label="Concerned AD/ED" />
      </div>
      <Line label="Remarks and notes of the corporate HR" value={show(r.corporateHrRemarks)} wide />
      <div className="grid gap-3 sm:grid-cols-2">
        <SignBox label="Corporate HR" />
        <SignBox label="HOD-HR" />
      </div>
      <div className="text-sm"><span className="text-muted">Inserted in quota chart?</span> <b>{show(r.insertedInQuotaChart)}</b>{r.quotaChartSetAt && <span className="text-xs text-muted"> (set {fmtDateTime(r.quotaChartSetAt)})</span>}</div>
    </div>
  );
}
