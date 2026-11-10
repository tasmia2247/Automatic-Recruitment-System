import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity, numeric } from './base';
import { User } from './identity.entities';
import { Company, Department, Position } from './master.entities';
import { Requisition } from './requisition.entities';

export const VACANCY_STATUSES = ['Open', 'Posting', 'Screening', 'On Hold', 'Filled', 'Closed'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

@Entity('vacancies')
export class Vacancy extends BaseEntity {
  @Index({ unique: true })
  @Column({ length: 40 })
  vacancyNo: string;

  @Column({ length: 20 })
  source: 'REQUISITION' | 'DIRECT_HR';

  /** Unique => an approved requisition can never produce duplicate vacancies on retry/double-click. */
  @Index({ unique: true, where: '"requisitionId" IS NOT NULL' })
  @Column({ type: 'uuid', nullable: true })
  requisitionId: string | null;

  @ManyToOne(() => Requisition, { nullable: true })
  @JoinColumn({ name: 'requisitionId' })
  requisition: Requisition | null;

  @Column('uuid') departmentId: string;
  @ManyToOne(() => Department) @JoinColumn({ name: 'departmentId' }) department: Department;

  @Column('uuid') companyId: string;
  @ManyToOne(() => Company) @JoinColumn({ name: 'companyId' }) company: Company;

  @Column({ type: 'uuid', nullable: true }) positionId: string | null;
  @ManyToOne(() => Position, { nullable: true }) @JoinColumn({ name: 'positionId' }) position: Position | null;

  @Column({ length: 160 }) positionTitle: string;
  @Column('int') headcount: number;
  @Column({ length: 20, default: 'NEW' }) vacancyType: 'NEW' | 'REPLACEMENT';
  @Column({ type: 'varchar', length: 200, nullable: true }) replacementEmployee: string | null;
  /** Mandatory reason for a Direct HR Entry vacancy. */
  @Column({ type: 'text', nullable: true }) directReason: string | null;
  /**
   * Direct HR vacancies only: the "Specialization required" fields CVs are screened against (requisition vacancies use the
   * requisition's). `specialization` holds "Other requirements".
   */
  @Column({ type: 'text', nullable: true }) requiredEducation: string | null;
  @Column({ type: 'text', nullable: true }) requiredSkills: string | null;
  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true, transformer: numeric }) requiredExperienceYears: number | null;
  @Column({ type: 'text', nullable: true }) specialization: string | null;
  /** Goes up whenever any of the "Specialization required" fields changes; screening runs record it. */
  @Column({ type: 'int', default: 0 }) specializationVersion: number;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'Open' })
  status: VacancyStatus;

  @Column({ type: 'text', nullable: true }) remarks: string | null;
  @Column('uuid') createdById: string;
  @Column({ type: 'uuid', nullable: true }) updatedById: string | null;

  /** HR coordinator responsible for this vacancy's recruitment; HR users without RECRUITMENT_ALL only see their own. */
  @Index()
  @Column({ type: 'uuid', nullable: true }) coordinatorId: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'coordinatorId' }) coordinator: User | null;

  @OneToMany(() => JobPost, (j) => j.vacancy)
  jobPosts: JobPost[];
}

export const JOBPOST_STATUSES = ['Draft', 'Published', 'Closed', 'Cancelled'] as const;
export type JobPostStatus = (typeof JOBPOST_STATUSES)[number];

@Entity('job_posts')
export class JobPost extends BaseEntity {
  @Index({ unique: true }) @Column({ length: 40 }) jobNo: string;

  @Column('uuid') vacancyId: string;
  @ManyToOne(() => Vacancy, (v) => v.jobPosts) @JoinColumn({ name: 'vacancyId' }) vacancy: Vacancy;

  @Column({ length: 200 }) title: string;
  @Column({ type: 'date', nullable: true }) startDate: string | null;
  @Column({ type: 'date', nullable: true }) deadline: string | null;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'text', nullable: true }) duties: string | null;
  @Column({ type: 'text', nullable: true }) education: string | null;
  @Column({ type: 'text', nullable: true }) requiredDegree: string | null;
  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true, transformer: numeric }) minCgpa: number | null;
  @Column({ type: 'text', nullable: true }) experienceRequirement: string | null;
  /** Where/how CVs are collected (e.g. recruitment mailbox + subject reference code). */
  @Column({ type: 'text', nullable: true }) cvCollection: string | null;
  @Column({ type: 'text', nullable: true }) circularContent: string | null;
  // Shown on the generated hiring circular (PDF / text). Responsibilities come from duties, the intro from description.
  @Column({ type: 'varchar', length: 200, nullable: true }) location: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) employmentType: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) jobShift: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) salary: string | null;
  /** Required skills, one per line. */
  @Column({ type: 'text', nullable: true }) skills: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) applyEmail: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) emailSubject: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) circularAttachmentKey: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) circularAttachmentName: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'Draft' })
  status: JobPostStatus;

  @Column({ type: 'int', default: 0 }) currentCriteriaVersion: number;
  @Column('uuid') createdById: string;
}

export const CRITERION_FIELDS = [
  'degree', 'education', 'institution', 'cgpa', 'totalExperienceYears', 'relevantExperienceYears',
  'skills', 'expectedSalary', 'age', 'cvText',
] as const;
export type CriterionField = (typeof CRITERION_FIELDS)[number];
export const CRITERION_OPERATORS = ['gte', 'lte', 'eq', 'contains_any', 'contains_all', 'mentions', 'education', 'min_years'] as const;
export type CriterionOperator = (typeof CRITERION_OPERATORS)[number];

/** Immutable, versioned set of criteria for a job post (SRS 8.6 / AC-16). */
@Entity('screening_criteria_sets')
@Index(['jobPostId', 'version'], { unique: true })
export class ScreeningCriteriaSet extends BaseEntity {
  @Column('uuid') jobPostId: string;
  @ManyToOne(() => JobPost) @JoinColumn({ name: 'jobPostId' }) jobPost: JobPost;
  @Column('int') version: number;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @Column('uuid') createdById: string;

  @OneToMany(() => ScreeningCriterion, (c) => c.set, { cascade: true, eager: true })
  criteria: ScreeningCriterion[];
}

@Entity('screening_criteria')
export class ScreeningCriterion extends BaseEntity {
  @Column('uuid') setId: string;
  @ManyToOne(() => ScreeningCriteriaSet, (s) => s.criteria, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'setId' })
  set: ScreeningCriteriaSet;

  @Column('int', { default: 0 }) sortOrder: number;
  @Column({ length: 120 }) label: string;
  @Column({ type: 'varchar', length: 40 }) field: CriterionField;
  @Column({ type: 'varchar', length: 20 }) operator: CriterionOperator;
  /** Number for gte/lte, comma-separated keywords for contains_*. */
  @Column({ type: 'text' }) value: string;
  @Column({ default: true }) mandatory: boolean;
  /** How missing data is treated: REVIEW (default), FAIL, or IGNORE. */
  @Column({ type: 'varchar', length: 10, default: 'REVIEW' }) missingPolicy: 'REVIEW' | 'FAIL' | 'IGNORE';
}

@Entity('candidates')
export class Candidate extends BaseEntity {
  @Index({ unique: true }) @Column({ length: 40 }) candidateNo: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) name: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) email: string | null;
  @Index() @Column({ type: 'varchar', length: 200, nullable: true }) emailNormalized: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) phone: string | null;
  @Index() @Column({ type: 'varchar', length: 30, nullable: true }) phoneNormalized: string | null;
  /** Set when HR confirms this record is a duplicate of another person. */
  @Column({ type: 'uuid', nullable: true }) mergedIntoId: string | null;

  @OneToMany(() => Application, (a) => a.candidate)
  applications: Application[];
}

export const PROCESSING_STATUSES = ['Received', 'Unmatched', 'Queued', 'Processing', 'Completed', 'Partial', 'Failed'] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];
export type ScreeningResult = 'Pass' | 'Fail' | 'Review Required';
export type DecisionStatus = 'Pending' | 'Selected' | 'Not Selected' | 'On Hold';

@Entity('applications')
@Index(['candidateId', 'vacancyId'], { unique: true })
export class Application extends BaseEntity {
  @Index({ unique: true }) @Column({ length: 40 }) applicationNo: string;

  @Column('uuid') candidateId: string;
  @ManyToOne(() => Candidate, (c) => c.applications) @JoinColumn({ name: 'candidateId' }) candidate: Candidate;

  @Index() @Column('uuid') vacancyId: string;
  @ManyToOne(() => Vacancy) @JoinColumn({ name: 'vacancyId' }) vacancy: Vacancy;

  @Column({ type: 'uuid', nullable: true }) jobPostId: string | null;
  @ManyToOne(() => JobPost, { nullable: true }) @JoinColumn({ name: 'jobPostId' }) jobPost: JobPost | null;

  @Column({ length: 20 }) source: 'MANUAL' | 'EMAIL';
  @Column({ type: 'timestamptz' }) receivedAt: Date;

  @Index() @Column({ type: 'varchar', length: 20, default: 'Received' }) processingStatus: ProcessingStatus;
  @Column({ type: 'text', nullable: true }) processingError: string | null;

  @Column({ type: 'varchar', length: 20, default: 'NONE' })
  duplicateReview: 'NONE' | 'PENDING' | 'MERGED' | 'SEPARATE';
  @Column({ type: 'uuid', nullable: true }) suspectedDuplicateCandidateId: string | null;
  @Column({ type: 'text', nullable: true }) duplicateEvidence: string | null;

  // ---- Extracted / corrected CV fields (never fabricated; null = missing) ----
  @Column({ type: 'text', nullable: true }) education: string | null;
  @Column({ type: 'text', nullable: true }) degree: string | null;
  @Column({ type: 'text', nullable: true }) specialization: string | null;
  @Column({ type: 'text', nullable: true }) institution: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) cgpaRaw: string | null;
  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true, transformer: numeric }) cgpa: number | null;
  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true, transformer: numeric }) totalExperienceYears: number | null;
  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true, transformer: numeric }) relevantExperienceYears: number | null;
  @Column({ type: 'text', nullable: true }) lastPosition: string | null;
  @Column({ type: 'text', nullable: true }) workplace: string | null;
  @Column({ type: 'text', nullable: true }) skills: string | null;
  @Column({ type: 'text', nullable: true }) address: string | null;
  @Column({ type: 'text', nullable: true }) certifications: string | null;
  /** Earlier jobs as "Designation, Organization", one per line. */
  @Column({ type: 'text', nullable: true }) previousJobs: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) expectedSalary: string | null;
  @Column({ type: 'int', nullable: true }) age: number | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) extractionStatus: 'Success' | 'Partial' | 'Failed' | 'Review Required' | null;
  /** Field names an authorized user has corrected (prior values are in the audit log). */
  @Column({ type: 'text', array: true, default: '{}' }) correctedFields: string[];

  // ---- Screening (automated) ----
  @Column({ type: 'varchar', length: 20, nullable: true }) screeningResult: ScreeningResult | null;
  @Column({ type: 'uuid', nullable: true }) latestScreeningRunId: string | null;
  /** Keyword match score (0-100) of the latest run; null for runs without one. Used for ranking. */
  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true, transformer: numeric }) screeningScore: number | null;

  // ---- HR shortlist decision (separate from screening result, SRS 10.6) ----
  @Column({ default: false }) shortlisted: boolean;
  @Column({ type: 'text', nullable: true }) shortlistReason: string | null;
  @Column({ type: 'uuid', nullable: true }) shortlistedById: string | null;
  @Column({ type: 'timestamptz', nullable: true }) shortlistedAt: Date | null;

  // ---- Final decision (separate from stage results) ----
  @Index() @Column({ type: 'varchar', length: 20, default: 'Pending' }) finalDecision: DecisionStatus;
  @Column({ type: 'text', nullable: true }) finalDecisionRemarks: string | null;
  @Column({ type: 'uuid', nullable: true }) finalDecisionById: string | null;
  @Column({ type: 'timestamptz', nullable: true }) finalDecisionAt: Date | null;
}

@Entity('candidate_documents')
export class CandidateDocument extends BaseEntity {
  @Index() @Column('uuid') applicationId: string;
  @ManyToOne(() => Application, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'applicationId' }) application: Application;
  @Column('uuid') candidateId: string;
  /** The stored file; null once it has been read and removed (owner, 2026-11-08: CV files are not kept). */
  @Column({ type: 'varchar', length: 300, nullable: true }) storageKey: string | null;
  /** The CV's text as read (reading order), kept instead of the file; screening and "Re-read CVs" use it. */
  @Column({ type: 'text', nullable: true }) textContent: string | null;
  /** The biggest text at the top of the PDF's first page, kept with the text for re-reading. */
  @Column({ type: 'varchar', length: 200, nullable: true }) nameHint: string | null;
  @Column({ type: 'timestamptz', nullable: true }) fileRemovedAt: Date | null;
  @Column({ length: 300 }) originalName: string;
  @Column({ length: 120 }) mimeType: string;
  @Column('int') size: number;
  @Index() @Column({ length: 64 }) sha256: string;
  @Column({ length: 20 }) source: 'MANUAL' | 'EMAIL';
  @Column({ type: 'uuid', nullable: true }) uploadedById: string | null;
}

@Entity('extraction_runs')
export class ExtractionRun extends BaseEntity {
  @Index() @Column('uuid') applicationId: string;
  @Column('uuid') documentId: string;
  @Column({ length: 20 }) status: 'Processing' | 'Completed' | 'Partial' | 'Failed';
  @Column({ type: 'jsonb', nullable: true }) extracted: Record<string, any> | null;
  @Column({ type: 'text', array: true, default: '{}' }) missingFields: string[];
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ length: 40 }) processorVersion: string;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
}

export interface CriterionResult {
  criterionId: string;
  label: string;
  field: string;
  operator: string;
  expected: string;
  actual: unknown;
  mandatory: boolean;
  outcome: 'Pass' | 'Fail' | 'Missing';
  reason: string;
}

/** One part of the match score: its weight (after leaving out parts with no requirement) and what share of it the CV earned (0-1). */
export interface ScorePart { key: 'skills' | 'responsibilities' | 'education' | 'experience'; label: string; weight: number; earned: number }
export interface ScoreParts { parts: ScorePart[]; passMark: number }

@Entity('screening_runs')
export class ScreeningRun extends BaseEntity {
  @Index() @Column('uuid') applicationId: string;
  /** JOB_POST: an older run against job post criteria. REQUISITION / VACANCY: the requisition's or Direct HR vacancy's "Specialization required", no criteria set. */
  @Column({ type: 'varchar', length: 20, default: 'JOB_POST' }) basis: 'JOB_POST' | 'REQUISITION' | 'VACANCY';
  @Column({ type: 'uuid', nullable: true }) criteriaSetId: string | null;
  /** Criteria set version; the requisition version for REQUISITION runs; the vacancy's specializationVersion for VACANCY runs. */
  @Column('int') criteriaVersion: number;
  @Column({ type: 'varchar', length: 20 }) overallResult: ScreeningResult;
  @Column({ type: 'jsonb' }) results: CriterionResult[];
  @Column({ type: 'jsonb', nullable: true }) inputs: Record<string, any> | null;
  @Column({ type: 'uuid', nullable: true }) runById: string | null;
  /** Keyword match score 0-100 (null on runs from before 2026-11-08) and how it was made up. */
  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true, transformer: numeric }) score: number | null;
  @Column({ type: 'jsonb', nullable: true }) scoreParts: ScoreParts | null;
}

@Entity('candidate_remarks')
export class CandidateRemark extends BaseEntity {
  @Index() @Column('uuid') applicationId: string;
  @Column('uuid') candidateId: string;
  @Column('text') text: string;
  @Column('uuid') authorId: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'authorId' }) author: User;
}

/** Written exam and Interview board (viva) are held together on one day for every shortlisted candidate; the Optional exam only when used. */
export const STAGE_TYPES = ['WRITTEN', 'INTERVIEW', 'OPTIONAL'] as const;
export type StageType = (typeof STAGE_TYPES)[number];

@Entity('candidate_stages')
@Index(['applicationId', 'stageType'], { unique: true })
export class CandidateStage extends BaseEntity {
  @Column('uuid') applicationId: string;
  @Column({ type: 'varchar', length: 20 }) stageType: StageType;
  @Column({ type: 'timestamptz', nullable: true }) scheduledAt: Date | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) location: string | null;
  /** Interview panel members, free text. */
  @Column({ type: 'text', nullable: true }) panel: string | null;
  @Column({ type: 'int', nullable: true }) durationMinutes: number | null;
  /** Missing attendance is "Not Recorded", never assumed Present (SRS 13.3). */
  @Column({ type: 'varchar', length: 20, default: 'Not Recorded' }) attendance: 'Present' | 'Absent' | 'Not Recorded';
  @Column({ type: 'varchar', length: 20, default: 'Pending' }) result: DecisionStatus;
  @Column({ type: 'uuid', nullable: true }) updatedById: string | null;
}

@Entity('evaluation_marks')
@Index(['applicationId', 'stageType', 'component'], { unique: true })
export class EvaluationMark extends BaseEntity {
  @Column('uuid') applicationId: string;
  @Column({ type: 'varchar', length: 20 }) stageType: StageType;
  @Column({ length: 60, default: 'Total' }) component: string;
  @Column({ type: 'numeric', precision: 7, scale: 2, transformer: numeric }) marks: number;
  @Column({ type: 'numeric', precision: 7, scale: 2, nullable: true, transformer: numeric }) maxMarks: number | null;
  @Column('uuid') evaluatorId: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'evaluatorId' }) evaluator: User;
  @Column({ type: 'text', nullable: true }) remarks: string | null;
  @Column({ type: 'uuid', nullable: true }) importBatchId: string | null;
}

@Entity('import_batches')
export class ImportBatch extends BaseEntity {
  @Index({ unique: true }) @Column({ length: 40 }) batchNo: string;
  @Column('uuid') vacancyId: string;
  @Column({ type: 'varchar', length: 20 }) stageType: StageType;
  @Column({ length: 60, default: 'Total' }) component: string;
  @Column('uuid') uploaderId: string;
  @Column({ length: 300 }) fileName: string;
  @Column({ type: 'varchar', length: 20, default: 'Previewed' }) status: 'Previewed' | 'Confirmed' | 'Cancelled';
  @Column({ type: 'varchar', length: 120, nullable: true }) sheetName: string | null;
  @Column({ type: 'text', array: true, default: '{}' }) detectedColumns: string[];
  @Column('int', { default: 0 }) rowsTotal: number;
  @Column('int', { default: 0 }) rowsAccepted: number;
  @Column('int', { default: 0 }) rowsRejected: number;
  @Column('int', { default: 0 }) rowsOverwrite: number;
  @Column({ type: 'numeric', precision: 7, scale: 2, nullable: true, transformer: numeric }) maxMarks: number | null;
  @Column({ type: 'timestamptz', nullable: true }) confirmedAt: Date | null;

  @OneToMany(() => ImportRow, (r) => r.batch, { cascade: true })
  rows: ImportRow[];
}

@Entity('import_rows')
export class ImportRow extends BaseEntity {
  @Index() @Column('uuid') batchId: string;
  @ManyToOne(() => ImportBatch, (b) => b.rows, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'batchId' }) batch: ImportBatch;
  @Column('int') rowNumber: number;
  @Column({ type: 'varchar', length: 40, nullable: true }) applicationNo: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) candidateNo: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) candidateName: string | null;
  @Column({ type: 'uuid', nullable: true }) applicationId: string | null;
  @Column({ type: 'numeric', precision: 7, scale: 2, nullable: true, transformer: numeric }) marks: number | null;
  @Column({ type: 'numeric', precision: 7, scale: 2, nullable: true, transformer: numeric }) previousMarks: number | null;
  @Column({ type: 'varchar', length: 20 }) status: 'Valid' | 'Overwrite' | 'Error';
  @Column({ type: 'text', array: true, default: '{}' }) errors: string[];
}

export const TEMPLATE_KINDS = ['INTERVIEW_INVITE', 'RESULT', 'JOINING_LETTER', 'GENERAL'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

@Entity('email_templates')
export class EmailTemplate extends BaseEntity {
  @Column({ length: 160 }) name: string;
  @Column({ type: 'varchar', length: 30 }) kind: TemplateKind;
  @Column({ type: 'uuid', nullable: true }) vacancyId: string | null;
  @Column({ length: 300 }) subject: string;
  @Column('text') body: string;
  @Column('int', { default: 1 }) version: number;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'uuid', nullable: true }) updatedById: string | null;
}

@Entity('email_template_versions')
@Index(['templateId', 'version'], { unique: true })
export class EmailTemplateVersion extends BaseEntity {
  @Column('uuid') templateId: string;
  @Column('int') version: number;
  @Column({ length: 300 }) subject: string;
  @Column('text') body: string;
  @Column({ type: 'uuid', nullable: true }) createdById: string | null;
}

@Entity('email_batches')
export class EmailBatch extends BaseEntity {
  /** Client-generated key: re-posting the same send request cannot create a second batch. */
  @Index({ unique: true }) @Column({ length: 80 }) clientKey: string;
  @Column({ type: 'varchar', length: 30 }) kind: TemplateKind;
  @Column({ type: 'uuid', nullable: true }) templateId: string | null;
  @Column('int', { nullable: true }) templateVersion: number | null;
  @Column({ type: 'uuid', nullable: true }) vacancyId: string | null;
  @Column('uuid') createdById: string;
  @Column('int') total: number;
}

export type EmailStatus = 'Draft' | 'Queued' | 'Sent' | 'Failed';

@Entity('email_events')
@Index(['batchId', 'applicationId'], { unique: true })
export class EmailEvent extends BaseEntity {
  @Column('uuid') batchId: string;
  @Index() @Column('uuid') applicationId: string;
  @Column({ type: 'varchar', length: 30 }) kind: TemplateKind;
  @Column({ length: 200 }) recipient: string;
  @Column({ length: 300 }) subject: string;
  @Column('text') body: string;
  @Column({ type: 'uuid', nullable: true }) templateId: string | null;
  @Column('int', { nullable: true }) templateVersion: number | null;
  @Index() @Column({ type: 'varchar', length: 20, default: 'Queued' }) status: EmailStatus;
  /** 'smtp' or 'dev-outbox' (dev outbox = written to disk, NOT delivered). */
  @Column({ type: 'varchar', length: 20, nullable: true }) transport: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) providerRef: string | null;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column('int', { default: 0 }) attempts: number;
  @Column({ type: 'timestamptz', nullable: true }) sentAt: Date | null;
  @Column('uuid') createdById: string;
}

@Entity('joining_records')
export class JoiningRecord extends BaseEntity {
  @Index({ unique: true }) @Column('uuid') applicationId: string;
  @ManyToOne(() => Application) @JoinColumn({ name: 'applicationId' }) application: Application;
  @Column({ type: 'date', nullable: true }) joiningDate: string | null;
  @Index() @Column({ type: 'varchar', length: 20, default: 'Pending' }) status: 'Pending' | 'Approved' | 'Rejected';
  @Column({ type: 'varchar', length: 20, default: 'Not Prepared' }) letterStatus: 'Not Prepared' | 'Prepared' | 'Sent';
  /** Agreed salary, entered on Joining Pending (owner, 2026-11-09). */
  @Column({ type: 'varchar', length: 100, nullable: true }) salary: string | null;
  @Column({ type: 'text', nullable: true }) remarks: string | null;
  @Column({ type: 'uuid', nullable: true }) approvedById: string | null;
  @Column({ type: 'timestamptz', nullable: true }) approvedAt: Date | null;
}

/** Mails read from the mail folder; unmatched ones wait for manual assignment. */
@Entity('intake_messages')
export class IntakeMessage extends BaseEntity {
  @Index({ unique: true }) @Column({ length: 300 }) messageId: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) sender: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) subject: string | null;
  @Column({ type: 'timestamptz', nullable: true }) receivedAt: Date | null;
  @Index() @Column({ type: 'varchar', length: 20 }) status: 'Matched' | 'Unmatched' | 'Assigned' | 'Failed';
  @Column({ type: 'uuid', nullable: true }) vacancyId: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) attachments: { storageKey: string; originalName: string; mimeType: string; size: number; sha256: string; applicationId?: string; error?: string }[];
  @Column({ type: 'text', nullable: true }) error: string | null;
}
