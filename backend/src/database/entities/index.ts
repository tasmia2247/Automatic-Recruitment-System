import { PermissionSetting, PermissionTemplate, Role, User } from './identity.entities';
import { Company, Department, ManpowerQuota, Position } from './master.entities';
import { ApprovalAction, ApprovalRoute, ApprovalRouteStep, Requisition, RequisitionAttachment } from './requisition.entities';
import {
  Application, Candidate, CandidateDocument, CandidateRemark, CandidateStage, EmailBatch, EmailEvent, EmailTemplate,
  EmailTemplateVersion, EvaluationMark, ExtractionRun, ImportBatch, ImportRow, IntakeMessage, JobPost, JoiningRecord,
  ScreeningCriteriaSet, ScreeningCriterion, ScreeningRun, Vacancy,
} from './recruitment.entities';
import { AuditEvent, IdCounter, Notification, ProcessingJob } from './system.entities';

export * from './identity.entities';
export * from './master.entities';
export * from './requisition.entities';
export * from './recruitment.entities';
export * from './system.entities';

export const ENTITIES = [
  Role, User, PermissionTemplate, PermissionSetting, Company, Department, Position, ManpowerQuota,
  Requisition, RequisitionAttachment, ApprovalRoute, ApprovalRouteStep, ApprovalAction,
  Vacancy, JobPost, ScreeningCriteriaSet, ScreeningCriterion, Candidate, Application, CandidateDocument,
  ExtractionRun, ScreeningRun, CandidateRemark, CandidateStage, EvaluationMark, ImportBatch, ImportRow,
  EmailTemplate, EmailTemplateVersion, EmailBatch, EmailEvent, JoiningRecord, IntakeMessage,
  Notification, AuditEvent, ProcessingJob, IdCounter,
];
