import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity, numeric } from './base';
import { User } from './identity.entities';
import { Company, Department, Position } from './master.entities';

export const REQ_STATUS = {
  DRAFT: 'Draft',
  PENDING: 'Pending Approval',
  RETURNED: 'Returned for Clarification',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
  SENT_TO_HR: 'Sent to HR',
  CANCELLED: 'Cancelled',
} as const;
export type RequisitionStatus = (typeof REQ_STATUS)[keyof typeof REQ_STATUS];

/** Digitized Manpower Requisition Form No. 01 (SRS section 6). */
@Entity('requisitions')
export class Requisition extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  reqNo: string | null;

  @Column({ length: 30, default: 'Form No. 01' })
  formNo: string;

  @Column({ type: 'date' })
  requestDate: string;

  @Column('uuid')
  requesterId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'requesterId' })
  requester: User;

  @Column('uuid')
  departmentId: string;

  @ManyToOne(() => Department)
  @JoinColumn({ name: 'departmentId' })
  department: Department;

  @Column('uuid')
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'uuid', nullable: true })
  positionId: string | null;

  @ManyToOne(() => Position, { nullable: true })
  @JoinColumn({ name: 'positionId' })
  position: Position | null;

  /** Rank as written on the form (from position master or free text when permitted). */
  @Column({ type: 'varchar', length: 160, nullable: true })
  rank: string | null;

  @Column({ type: 'int', nullable: true })
  headcount: number | null;

  @Column({ default: false })
  replacePlan: boolean;

  @Column({ type: 'varchar', length: 160, nullable: true })
  replacementEmployeeName: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  replacementEmployeeId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  terminationReference: string | null;

  @Column({ type: 'text', nullable: true })
  minEducation: string | null;

  @Column({ type: 'text', nullable: true })
  experience: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  salaryPresent: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  salaryProposed: string | null;

  @Column({ type: 'int', nullable: true }) currentQuotaDept: number | null;
  @Column({ type: 'int', nullable: true }) currentQuotaDesig: number | null;
  @Column({ type: 'int', nullable: true }) revisedQuotaDept: number | null;
  @Column({ type: 'int', nullable: true }) revisedQuotaDesig: number | null;
  @Column({ type: 'int', nullable: true }) presentManpowerDept: number | null;
  @Column({ type: 'int', nullable: true }) presentManpowerDesig: number | null;
  @Column({ type: 'int', nullable: true }) vacancyDept: number | null;
  @Column({ type: 'int', nullable: true }) vacancyDesig: number | null;

  /** Reason when an authorized user overrides the calculated vacancy figure. */
  @Column({ type: 'text', nullable: true })
  vacancyOverrideReason: string | null;

  @Column({ type: 'boolean', nullable: true })
  seatsAvailable: boolean | null;

  @Column({ type: 'int', nullable: true })
  deadlineDays: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: 'Male' | 'Female' | 'Any' | null;

  /** 'Specialization required', what CVs are screened against. `specialization` holds 'Other requirements'. */
  @Column({ type: 'text', nullable: true }) requiredEducation: string | null;
  @Column({ type: 'text', nullable: true }) requiredSkills: string | null;
  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true, transformer: numeric }) requiredExperienceYears: number | null;
  @Column({ type: 'text', nullable: true }) specialization: string | null;
  /** Roles and responsibilities; not used for screening. */
  @Column({ type: 'text', nullable: true }) jobDescription: string | null;
  @Column({ type: 'text', nullable: true }) background: string | null;

  @Column({ type: 'text', nullable: true })
  corporateHrRemarks: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  insertedInQuotaChart: 'Yes' | 'No' | 'Not Applicable' | null;

  @Column({ type: 'uuid', nullable: true }) quotaChartSetById: string | null;
  @Column({ type: 'timestamptz', nullable: true }) quotaChartSetAt: Date | null;

  @Index()
  @Column({ type: 'varchar', length: 40, default: REQ_STATUS.DRAFT })
  status: RequisitionStatus;

  /** Increments on each (re)submission; approval actions are recorded per version. */
  @Column({ type: 'int', default: 0 })
  version: number;

  @Column({ type: 'int', nullable: true })
  currentStepOrder: number | null;

  @Column({ type: 'uuid', nullable: true })
  approvalRouteId: string | null;

  /** Approval-critical field values at last submission, to decide restart vs resume. */
  @Column({ type: 'jsonb', nullable: true })
  submittedSnapshot: Record<string, any> | null;

  @Column({ type: 'timestamptz', nullable: true }) submittedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) approvedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) sentToHrAt: Date | null;
  /** HR coordinator chosen in the HR Approved Queue; copied to (and kept in sync with) the vacancy created from it. */
  @Column({ type: 'uuid', nullable: true }) coordinatorId: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'coordinatorId' }) coordinator: User | null;
  @Column({ type: 'timestamptz', nullable: true }) cancelledAt: Date | null;
  @Column({ type: 'text', nullable: true }) cancelReason: string | null;

  @OneToMany(() => ApprovalAction, (a) => a.requisition)
  approvals: ApprovalAction[];

  @OneToMany(() => RequisitionAttachment, (a) => a.requisition)
  attachments: RequisitionAttachment[];
}

@Entity('requisition_attachments')
export class RequisitionAttachment extends BaseEntity {
  @Column('uuid')
  requisitionId: string;

  @ManyToOne(() => Requisition, (r) => r.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requisitionId' })
  requisition: Requisition;

  @Column({ length: 30, default: 'OTHER' })
  kind: 'TERMINATION_REQUEST' | 'SIGNATURE' | 'OTHER' | 'APPROVAL';

  /** Set for a document uploaded with an approval decision (kind APPROVAL); null for form attachments. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  approvalActionId: string | null;

  @Column({ length: 300 }) storageKey: string;
  @Column({ length: 300 }) originalName: string;
  @Column({ length: 120 }) mimeType: string;
  @Column('int') size: number;
  @Column('uuid') uploadedById: string;
}

@Entity('approval_routes')
export class ApprovalRoute extends BaseEntity {
  @Column({ length: 160 })
  name: string;

  /** Route applies to this department only; null = default route. */
  @Column({ type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => ApprovalRouteStep, (s) => s.route, { cascade: true })
  steps: ApprovalRouteStep[];
}

@Entity('approval_route_steps')
@Index(['routeId', 'stepOrder'], { unique: true })
export class ApprovalRouteStep extends BaseEntity {
  @Column('uuid')
  routeId: string;

  @ManyToOne(() => ApprovalRoute, (r) => r.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'routeId' })
  route: ApprovalRoute;

  @Column('int')
  stepOrder: number;

  /** Form sign-off label, e.g. "Concerned Director", "HOD-HR". */
  @Column({ length: 80 })
  label: string;

  /** Named approver account (no shared generic approver credentials). */
  @Column('uuid')
  approverUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'approverUserId' })
  approver: User;

  @Column({ default: true })
  required: boolean;
}

export const APPROVAL_STATUS = {
  WAITING: 'Waiting',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned',
  SUPERSEDED: 'Superseded',
} as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

@Entity('approval_actions')
@Index(['requisitionId', 'version', 'stepOrder'], { unique: true })
export class ApprovalAction extends BaseEntity {
  @Column('uuid')
  requisitionId: string;

  @ManyToOne(() => Requisition, (r) => r.approvals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requisitionId' })
  requisition: Requisition;

  @Column('int') version: number;
  @Column('int') stepOrder: number;
  @Column({ length: 80 }) stepLabel: string;

  @Index()
  @Column('uuid')
  approverUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'approverUserId' })
  approver: User;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  status: ApprovalStatus;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /** Who recorded the decision when it was not the named approver (Super Admin acting on their behalf). */
  @Column({ type: 'uuid', nullable: true })
  actedById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actedById' })
  actedBy: User | null;

  /** Approval carried forward from the previous version on a resume-type resubmission. */
  @Column({ default: false })
  carriedOver: boolean;
}
