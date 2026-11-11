import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, IsNull } from 'typeorm';
import { config } from '../config';
import { AuthUser } from '../common/auth';
import { paged, skipTake } from '../common/pagination';
import { P } from '../common/permissions';
import { assertDepartmentAccess, computeVacancy, departmentScope, inScope, resolveScope } from '../common/scope';
import { AuditService, diff, IdService, NotificationService, StorageService, today, validateUpload } from '../common/services';
import {
  APPROVAL_STATUS, ApprovalAction, ApprovalRoute, Department, ManpowerQuota, REQ_STATUS, Requisition, RequisitionAttachment,
} from '../database/entities';
import { CorporateHrDto, RequisitionDto, RequisitionListQuery } from './requisitions.dto';

/** Changing any of these after submission forces the approval route to restart (SRS 7.6). */
export const APPROVAL_CRITICAL_FIELDS = [
  'departmentId', 'companyId', 'positionId', 'rank', 'headcount', 'replacePlan', 'replacementEmployeeName',
  'replacementEmployeeId', 'terminationReference', 'salaryPresent', 'salaryProposed', 'currentQuotaDept',
  'currentQuotaDesig', 'revisedQuotaDept', 'revisedQuotaDesig',
] as const;

const EDITABLE_STATUSES = [REQ_STATUS.DRAFT, REQ_STATUS.RETURNED] as string[];

/** Supporting document types accepted with an approval decision. */
export const APPROVAL_DOC_EXTENSIONS = ['pdf', 'docx', 'doc', 'jpg', 'jpeg', 'png'];

/** Optional parts of an approve / return / reject decision. */
export type Decision = { remarks?: string; actionId?: string; file?: Express.Multer.File };

export type FieldErrors = Record<string, string>;

/** Submit-time validation for Form No. 01 (SRS 6.1). */
export function validateForSubmit(r: Requisition, attachments: RequisitionAttachment[]): FieldErrors {
  const e: FieldErrors = {};
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim());
  if (blank(r.rank)) e.rank = 'Rank / position is required.';
  if (!r.headcount || r.headcount < 1) e.headcount = 'How many must be a whole number greater than zero.';
  if (blank(r.background)) e.background = 'Background of the requirement is required before submission.';
  if (r.seatsAvailable === null || r.seatsAvailable === undefined) e.seatsAvailable = 'Please select whether seats are available.';
  if (![30, 60].includes(r.deadlineDays ?? 0)) e.deadlineDays = 'Select a deadline of 30 or 60 days.';
  if (!r.gender) e.gender = 'Select Male, Female or Any.';
  for (const f of ['currentQuotaDept', 'currentQuotaDesig', 'presentManpowerDept', 'presentManpowerDesig'] as const) {
    if (r[f] === null || r[f] === undefined) e[f] = 'Required (enter 0 if none).';
  }
  if (r.replacePlan) {
    if (blank(r.replacementEmployeeName)) e.replacementEmployeeName = 'Name of the employee being replaced is required.';
    const hasTermination = !blank(r.terminationReference) || attachments.some((a) => a.kind === 'TERMINATION_REQUEST');
    if (!hasTermination) e.terminationReference = 'Attach the termination request or enter its reference.';
  }
  const calcDept = computeVacancy(r.currentQuotaDept, r.presentManpowerDept).value;
  const calcDesig = computeVacancy(r.currentQuotaDesig, r.presentManpowerDesig).value;
  if (((r.vacancyDept ?? calcDept) !== calcDept || (r.vacancyDesig ?? calcDesig) !== calcDesig) && blank(r.vacancyOverrideReason)) {
    e.vacancyOverrideReason = 'Explain why the vacancy differs from quota minus present manpower.';
  }
  return e;
}

function snapshot(r: Requisition) {
  return Object.fromEntries(APPROVAL_CRITICAL_FIELDS.map((k) => [k, (r as any)[k] ?? null]));
}

@Injectable()
export class RequisitionService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ids: IdService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------ queries

  async list(q: RequisitionListQuery, me: AuthUser) {
    const qb = this.ds.getRepository(Requisition).createQueryBuilder('r')
      .leftJoinAndSelect('r.department', 'd').leftJoinAndSelect('r.company', 'c')
      .leftJoinAndSelect('r.requester', 'u')
      .orderBy('r.updatedAt', 'DESC');
    const scope = departmentScope(me, 'requisitions');
    if (scope) qb.andWhere('r.departmentId = ANY(:scope)', { scope });
    if (q.view === 'mine') qb.andWhere('r.requesterId = :me', { me: me.id });
    if (q.status) qb.andWhere('r.status = :status', { status: q.status });
    if (q.departmentId) qb.andWhere('r.departmentId = :dep', { dep: q.departmentId });
    if (q.companyId) qb.andWhere('r.companyId = :co', { co: q.companyId });
    if (q.q) qb.andWhere(new Brackets((w) => w.where('r.reqNo ILIKE :q').orWhere('r.rank ILIKE :q')), { q: `%${q.q}%` });
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    const pending = await this.currentApprovers(items.map((i) => i.id));
    // For the Super Admin's Delete dialog: what else goes with the requisition.
    const made: Record<string, { vacancyNo: string; applications: number }> = {};
    if (me.permissions.has(P.REQ_MANAGE_ALL) && items.length) {
      const rows = await this.ds.query(
        `SELECT v."requisitionId" AS id, v."vacancyNo", (SELECT count(*)::int FROM applications a WHERE a."vacancyId" = v.id) AS applications
         FROM vacancies v WHERE v."requisitionId" = ANY($1::uuid[])`, [items.map((i) => i.id)]);
      for (const x of rows) made[x.id] = { vacancyNo: x.vacancyNo, applications: x.applications };
    }
    return paged(items.map((r) => ({ ...this.view(r), currentApprover: pending[r.id] ?? null, vacancy: made[r.id] ?? null })), total, q);
  }

  private async currentApprovers(ids: string[]) {
    if (!ids.length) return {} as Record<string, { name: string; step: string }>;
    const acts = await this.ds.getRepository(ApprovalAction).find({
      where: { requisitionId: In(ids), status: APPROVAL_STATUS.PENDING }, relations: { approver: true },
    });
    return Object.fromEntries(acts.map((a) => [a.requisitionId, { name: a.approver.name, step: a.stepLabel }]));
  }

  async detail(id: string, me: AuthUser) {
    const r = await this.ds.getRepository(Requisition).findOne({
      where: { id },
      relations: { department: true, company: true, position: true, requester: true, attachments: true },
    });
    if (!r) throw new NotFoundException('Requisition not found.');
    await this.assertCanView(r, me);
    const approvals = await this.ds.getRepository(ApprovalAction).find({
      where: { requisitionId: id }, relations: { approver: true, actedBy: true }, order: { version: 'DESC', stepOrder: 'ASC' },
    });
    const current = r.status === REQ_STATUS.PENDING
      ? approvals.find((a) => a.status === APPROVAL_STATUS.PENDING && a.version === r.version) : undefined;
    const canAct = !!current && (current.approverUserId === me.id || me.permissions.has(P.ACT_ON_BEHALF));
    const docs = (actionId: string) => r.attachments.filter((x) => x.approvalActionId === actionId);
    return {
      ...this.view(r),
      attachments: r.attachments.filter((x) => !x.approvalActionId),
      approvals: approvals.map((a) => ({
        id: a.id, version: a.version, stepOrder: a.stepOrder, stepLabel: a.stepLabel, status: a.status, remarks: a.remarks,
        decidedAt: a.decidedAt, carriedOver: a.carriedOver, approver: { id: a.approver.id, name: a.approver.name, designation: a.approver.designation },
        actedBy: a.actedBy ? { id: a.actedBy.id, name: a.actedBy.name } : null,
        documents: docs(a.id).map((x) => ({ id: x.id, originalName: x.originalName })),
      })),
      // The vacancy made from it is no longer shown on the requisition or the HR Approved Queue (owner, 2026-11-08); it is opened from Vacancies.
      canEdit: EDITABLE_STATUSES.includes(r.status) && this.actsAsRequester(r, me) && me.permissions.has(P.REQ_EDIT),
      canAct,
      currentAction: canAct
        ? {
          id: current!.id, stepOrder: current!.stepOrder, stepLabel: current!.stepLabel, onBehalf: current!.approverUserId !== me.id,
          totalSteps: approvals.filter((a) => a.version === r.version).length,
          approver: { name: current!.approver.name, designation: current!.approver.designation },
        }
        : null,
      submitErrors: EDITABLE_STATUSES.includes(r.status) ? validateForSubmit(r, r.attachments) : {},
    };
  }

  private view(r: Requisition) {
    const calcDept = computeVacancy(r.currentQuotaDept, r.presentManpowerDept);
    const calcDesig = computeVacancy(r.currentQuotaDesig, r.presentManpowerDesig);
    return {
      ...r,
      requester: r.requester ? { id: r.requester.id, name: r.requester.name, designation: r.requester.designation } : undefined,
      calculated: {
        vacancyDept: calcDept.value, vacancyDeptFlag: calcDept.flag,
        vacancyDesig: calcDesig.value, vacancyDesigFlag: calcDesig.flag,
        overridden: (r.vacancyDept !== null && r.vacancyDept !== calcDept.value) || (r.vacancyDesig !== null && r.vacancyDesig !== calcDesig.value),
      },
    };
  }

  /** The requester, or the Super Admin acting for them. */
  private actsAsRequester(r: Requisition, me: AuthUser) {
    return r.requesterId === me.id || me.permissions.has(P.REQ_MANAGE_ALL);
  }

  private async assertCanView(r: Requisition, me: AuthUser) {
    if (me.permissions.has(P.REQ_VIEW) && inScope(resolveScope(me, 'requisitions'), r.departmentId)) return;
    // HR works the approved queue for every department, so it can open the requisitions in it.
    if (me.permissions.has(P.HR_QUEUE) && r.status === REQ_STATUS.SENT_TO_HR) return;
    const isApprover = await this.ds.getRepository(ApprovalAction).exists({ where: { requisitionId: r.id, approverUserId: me.id } });
    if (isApprover) return;
    throw new ForbiddenException('You do not have access to this requisition.');
  }

  /**
   * Approver inbox (AC-03): tasks currently assigned to me, my later steps on requisitions still in approval
   * (view only until it is my turn) and, for final approvers (Admin, Super Admin), every requisition pending approval.
   */
  async inbox(me: AuthUser, decisionOrder: 'ASC' | 'DESC' = 'DESC') {
    const open = (status: string) => this.ds.getRepository(ApprovalAction).createQueryBuilder('a')
      .innerJoinAndSelect('a.requisition', 'r').innerJoinAndSelect('a.approver', 'ap')
      .leftJoinAndSelect('r.department', 'd').leftJoinAndSelect('r.company', 'c').leftJoinAndSelect('r.requester', 'u')
      .where('a.status = :st AND a.version = r.version AND r.status = :pending', { st: status, pending: REQ_STATUS.PENDING })
      .orderBy('r.submittedAt', 'ASC');
    const acts = await open(APPROVAL_STATUS.PENDING).andWhere('a.approverUserId = :me', { me: me.id }).getMany();
    const upcoming = await open(APPROVAL_STATUS.WAITING).andWhere('a.approverUserId = :me', { me: me.id }).getMany();
    const all = me.permissions.has(P.ACT_ON_BEHALF) ? await open(APPROVAL_STATUS.PENDING).getMany() : null;
    const stepCounts: { requisitionId: string; n: number }[] = all?.length
      ? await this.ds.query(
        `SELECT a."requisitionId", count(*)::int AS n FROM approval_actions a JOIN requisitions r ON r.id = a."requisitionId" AND a.version = r.version
          WHERE a."requisitionId" = ANY($1) GROUP BY 1`, [all.map((a) => a.requisitionId)])
      : [];
    const current = await this.currentApprovers(upcoming.map((a) => a.requisitionId));
    const decided = await this.ds.getRepository(ApprovalAction).createQueryBuilder('a')
      .innerJoinAndSelect('a.requisition', 'r').leftJoinAndSelect('r.department', 'd')
      .where('(a.approverUserId = :me OR a.actedById = :me) AND a.decidedAt IS NOT NULL AND a.carriedOver = false', { me: me.id })
      .orderBy('a.decidedAt', decisionOrder).take(50).getMany();
    return {
      pending: acts.map((a) => ({ actionId: a.id, stepLabel: a.stepLabel, stepOrder: a.stepOrder, requisition: this.view(a.requisition) })),
      upcoming: upcoming.map((a) => ({
        actionId: a.id, stepLabel: a.stepLabel, stepOrder: a.stepOrder, requisition: this.view(a.requisition), currentApprover: current[a.requisitionId] ?? null,
      })),
      all: all?.map((a) => ({
        actionId: a.id, stepLabel: a.stepLabel, stepOrder: a.stepOrder, requisition: this.view(a.requisition),
        totalSteps: stepCounts.find((c) => c.requisitionId === a.requisitionId)?.n ?? null,
        approver: { name: a.approver.name, designation: a.approver.designation },
      })) ?? null,
      history: decided.map((a) => ({
        actionId: a.id, stepLabel: a.stepLabel, status: a.status, remarks: a.remarks, decidedAt: a.decidedAt,
        requisition: { id: a.requisition.id, reqNo: a.requisition.reqNo, rank: a.requisition.rank, status: a.requisition.status, department: a.requisition.department },
      })),
    };
  }

  // ------------------------------------------------------------------ draft lifecycle

  async create(dto: RequisitionDto, me: AuthUser) {
    assertDepartmentAccess(me, dto.departmentId, 'requisitions');
    return this.ds.transaction(async (m) => {
      const r = m.create(Requisition, {
        ...dto,
        requestDate: dto.requestDate ?? today(),
        requesterId: me.id,
        status: REQ_STATUS.DRAFT,
        reqNo: config.requisitionIdOn === 'draft' ? await this.ids.next(m, 'REQ') : null,
      });
      this.applyVacancy(r, dto);
      await m.save(r);
      await this.audit.log(m, me, 'requisition.create', 'Requisition', r.id, { label: r.reqNo, new: { ...dto } });
      return r;
    });
  }

  async update(id: string, dto: RequisitionDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const r = await this.lock(m, id);
      if (!this.actsAsRequester(r, me)) throw new ForbiddenException('Only the requester can edit this requisition.');
      if (!EDITABLE_STATUSES.includes(r.status)) throw new ConflictException(`A requisition in status "${r.status}" cannot be edited.`);
      assertDepartmentAccess(me, dto.departmentId, 'requisitions');
      const before = { ...r };
      Object.assign(r, dto);
      this.applyVacancy(r, dto);
      await m.save(r);
      const d = diff(before, r, Object.keys(dto).concat(['vacancyDept', 'vacancyDesig']));
      if (d.changed.length) await this.audit.log(m, me, 'requisition.edit', 'Requisition', r.id, { label: r.reqNo, old: d.old, new: d.new });
      return r;
    });
  }

  /** Vacancy defaults to quota - present; a manual figure is kept only when it differs (and needs a reason at submit). */
  private applyVacancy(r: Requisition, dto: RequisitionDto) {
    const calcDept = computeVacancy(r.currentQuotaDept, r.presentManpowerDept).value;
    const calcDesig = computeVacancy(r.currentQuotaDesig, r.presentManpowerDesig).value;
    r.vacancyDept = dto.vacancyDept !== undefined && dto.vacancyDept !== null ? dto.vacancyDept : calcDept;
    r.vacancyDesig = dto.vacancyDesig !== undefined && dto.vacancyDesig !== null ? dto.vacancyDesig : calcDesig;
  }

  private async lock(m: EntityManager, id: string) {
    const r = await m.findOne(Requisition, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!r) throw new NotFoundException('Requisition not found.');
    return r;
  }

  // ------------------------------------------------------------------ submission & approval

  async submit(id: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const r = await this.lock(m, id);
      if (!this.actsAsRequester(r, me)) throw new ForbiddenException('Only the requester can submit this requisition.');
      if (!EDITABLE_STATUSES.includes(r.status)) {
        if (r.status === REQ_STATUS.PENDING) return r; // idempotent double-click
        throw new ConflictException(`A requisition in status "${r.status}" cannot be submitted.`);
      }
      const attachments = await m.find(RequisitionAttachment, { where: { requisitionId: id } });
      const errors = validateForSubmit(r, attachments);
      if (Object.keys(errors).length) {
        throw new BadRequestException({ message: 'Please correct the highlighted fields before submitting.', fieldErrors: errors });
      }

      const route = await this.findRoute(m, r.departmentId);
      const steps = route.steps.sort((a, b) => a.stepOrder - b.stepOrder).filter((s) => s.required);
      if (!steps.length) throw new BadRequestException('The approval route has no required steps. Ask the system administrator to configure it.');

      const isResubmit = r.status === REQ_STATUS.RETURNED;
      const prevVersion = r.version;
      // Field-by-field: jsonb does not preserve key order, so whole-object string comparison is unreliable.
      const now = snapshot(r);
      const criticalChanged = isResubmit && APPROVAL_CRITICAL_FIELDS.some((k) => (r.submittedSnapshot?.[k] ?? null) !== now[k]);

      // On a resume (no approval-critical change) steps approved before the return are carried forward.
      let carried = new Set<number>();
      let resumeAt = steps[0].stepOrder;
      if (isResubmit && !criticalChanged && r.approvalRouteId === route.id) {
        const prev = await m.find(ApprovalAction, { where: { requisitionId: id, version: prevVersion } });
        const returned = prev.find((a) => a.status === APPROVAL_STATUS.RETURNED);
        if (returned) {
          carried = new Set(prev.filter((a) => a.status === APPROVAL_STATUS.APPROVED && a.stepOrder < returned.stepOrder).map((a) => a.stepOrder));
          resumeAt = returned.stepOrder;
        }
      }

      r.version = prevVersion + 1;
      r.status = REQ_STATUS.PENDING;
      r.approvalRouteId = route.id;
      r.currentStepOrder = resumeAt;
      r.submittedAt = new Date();
      r.submittedSnapshot = snapshot(r);
      if (!r.reqNo) r.reqNo = await this.ids.next(m, 'REQ');
      await m.save(r);

      const prevActs = carried.size ? await m.find(ApprovalAction, { where: { requisitionId: id, version: prevVersion } }) : [];
      for (const s of steps) {
        const carriedAct = carried.has(s.stepOrder) ? prevActs.find((a) => a.stepOrder === s.stepOrder) : undefined;
        await m.insert(ApprovalAction, {
          requisitionId: id, version: r.version, stepOrder: s.stepOrder, stepLabel: s.label, approverUserId: s.approverUserId,
          status: carriedAct ? APPROVAL_STATUS.APPROVED : s.stepOrder === resumeAt ? APPROVAL_STATUS.PENDING : APPROVAL_STATUS.WAITING,
          carriedOver: !!carriedAct, remarks: carriedAct?.remarks ?? null, decidedAt: carriedAct?.decidedAt ?? null,
        });
      }
      const first = steps.find((s) => s.stepOrder === resumeAt)!;
      await this.audit.log(m, me, isResubmit ? 'requisition.resubmit' : 'requisition.submit', 'Requisition', id, {
        label: r.reqNo,
        new: { version: r.version, route: route.name, restartedRoute: isResubmit ? criticalChanged || !carried.size : undefined, firstStep: first.label },
      });
      await this.notify.notify(m, [first.approverUserId], 'approval.pending', `Approval needed: ${r.reqNo} (${r.rank})`, `/approvals`);
      // Final approvers (Admin, Super Admin) hear about every submission from every department.
      const overseers = (await this.notify.usersWithPermission(m, P.ACT_ON_BEHALF)).filter((u) => u !== first.approverUserId);
      await this.notify.notify(m, overseers, 'approval.submitted', `New requisition in approval: ${r.reqNo} (${r.rank})`, `/approvals`, `Now with ${first.label}`);
      return r;
    });
  }

  private async findRoute(m: EntityManager, departmentId: string) {
    const route =
      (await m.findOne(ApprovalRoute, { where: { departmentId, active: true }, relations: { steps: true } })) ??
      (await m.findOne(ApprovalRoute, { where: { departmentId: IsNull(), active: true }, relations: { steps: true } }));
    if (!route) throw new BadRequestException('No active approval route is configured. Ask the system administrator to set one up.');
    return route;
  }

  /** Locks the requisition and returns the pending action of its current version/step (with its named approver). */
  private async myPendingAction(m: EntityManager, id: string, me: AuthUser) {
    const r = await this.lock(m, id);
    const act = await m.findOne(ApprovalAction, {
      where: { requisitionId: id, version: r.version, stepOrder: r.currentStepOrder ?? -1 }, relations: { approver: true },
    });
    return { r, act };
  }

  /**
   * Who may decide this step: its named approver, or a final approver (Admin / Super Admin) on their behalf. Acting on behalf must name
   * the step (actionId) so a repeated click cannot fall through to the next step. Returns true when on behalf.
   */
  private assertMayDecide(act: ApprovalAction, me: AuthUser, actionId?: string) {
    if (act.approverUserId === me.id) return false;
    if (!me.permissions.has(P.ACT_ON_BEHALF)) throw new ForbiddenException('This approval step is assigned to another approver.');
    if (!actionId) throw new BadRequestException('Choose the approval step you are deciding on behalf of its approver.');
    return true;
  }

  private checkDocument(file?: Express.Multer.File) {
    if (!file) return;
    const err = validateUpload(file, APPROVAL_DOC_EXTENSIONS);
    if (err) throw new BadRequestException(err);
  }

  /** Optional supporting document stored with one approval decision (signed note, email, minutes...). */
  private async saveDecisionDocument(m: EntityManager, act: ApprovalAction, me: AuthUser, file?: Express.Multer.File) {
    if (!file) return undefined;
    const stored = this.storage.save(file.buffer, file.originalname, file.mimetype, 'approvals');
    await m.insert(RequisitionAttachment, {
      requisitionId: act.requisitionId, approvalActionId: act.id, kind: 'APPROVAL', storageKey: stored.storageKey,
      originalName: stored.originalName, mimeType: stored.mimeType, size: stored.size, uploadedById: me.id,
    });
    return stored.originalName;
  }

  async approve(id: string, me: AuthUser, d: Decision = {}) {
    this.checkDocument(d.file);
    return this.ds.transaction(async (m) => {
      const { r, act } = await this.myPendingAction(m, id, me);
      // Idempotency: the step this click was for has already been approved -> no-op (AC-09).
      if (d.actionId && act?.id !== d.actionId) {
        const target = await m.findOne(ApprovalAction, { where: { id: d.actionId, requisitionId: id } });
        if (target?.status === APPROVAL_STATUS.APPROVED) return { requisition: r, duplicate: true };
        throw new ConflictException(target ? `This approval step is "${target.status}" and is not awaiting a decision.` : 'Approval step not found.');
      }
      if (r.status !== REQ_STATUS.PENDING || !act) {
        // Idempotency: a repeated click after my own approval is a no-op, not a second action (AC-09).
        const mine = await m.findOne(ApprovalAction, { where: { requisitionId: id, version: r.version, approverUserId: me.id, status: APPROVAL_STATUS.APPROVED, carriedOver: false } });
        if (mine) return { requisition: r, duplicate: true };
        throw new ConflictException(`This requisition is "${r.status}" and is not awaiting approval.`);
      }
      if (act.approverUserId !== me.id && !me.permissions.has(P.ACT_ON_BEHALF)) {
        const mine = await m.findOne(ApprovalAction, { where: { requisitionId: id, version: r.version, approverUserId: me.id, status: APPROVAL_STATUS.APPROVED } });
        if (mine) return { requisition: r, duplicate: true };
      }
      const onBehalf = this.assertMayDecide(act, me, d.actionId);
      act.status = APPROVAL_STATUS.APPROVED;
      act.remarks = d.remarks ?? null;
      act.decidedAt = new Date();
      act.actedById = onBehalf ? me.id : null;
      await m.save(act);
      const document = await this.saveDecisionDocument(m, act, me, d.file);
      const by = onBehalf ? { onBehalfOf: act.approver.name } : {};

      // A final approver's (Admin / Super Admin) approval is sufficient: the remaining steps are closed as not required and the route completes.
      let skippedSteps: string[] | undefined;
      if (onBehalf) {
        const rest = await m.find(ApprovalAction, { where: { requisitionId: id, version: r.version, status: APPROVAL_STATUS.WAITING }, order: { stepOrder: 'ASC' } });
        skippedSteps = rest.map((a) => a.stepLabel);
        if (rest.length) {
          await m.update(ApprovalAction, { id: In(rest.map((a) => a.id)) }, { status: APPROVAL_STATUS.SUPERSEDED, remarks: `Not required: approved by ${me.name} (final approval)` });
        }
      }

      const next = onBehalf ? null : await m.findOne(ApprovalAction, {
        where: { requisitionId: id, version: r.version, status: APPROVAL_STATUS.WAITING }, order: { stepOrder: 'ASC' },
      });
      if (next) {
        next.status = APPROVAL_STATUS.PENDING;
        await m.save(next);
        r.currentStepOrder = next.stepOrder;
        await m.save(r);
        await this.audit.log(m, me, 'requisition.approve_step', 'Requisition', id, { label: r.reqNo, new: { step: act.stepLabel, remarks: d.remarks, document, ...by, nextStep: next.stepLabel } });
        await this.notify.notify(m, [next.approverUserId], 'approval.pending', `Approval needed: ${r.reqNo} (${r.rank})`, `/approvals`);
      } else {
        // All mandatory approvals complete -> Approved and placed in the HR queue (SRS 7.4).
        const now = new Date();
        r.status = REQ_STATUS.SENT_TO_HR;
        r.approvedAt = now;
        r.sentToHrAt = now;
        r.currentStepOrder = null;
        await m.save(r);
        await this.audit.log(m, me, 'requisition.approve_final', 'Requisition', id, { label: r.reqNo, old: { status: REQ_STATUS.PENDING }, new: { status: REQ_STATUS.APPROVED, step: act.stepLabel, remarks: d.remarks, document, ...by, skippedSteps } });
        await this.audit.log(m, null, 'requisition.sent_to_hr', 'Requisition', id, { label: r.reqNo, new: { status: REQ_STATUS.SENT_TO_HR } });
        await this.notify.notify(m, [r.requesterId], 'requisition.approved', `${r.reqNo} fully approved and sent to HR`, `/requisitions/${id}`);
        await this.notify.notify(m, await this.notify.usersWithPermission(m, P.HR_QUEUE), 'hr.queue', `New approved requisition ${r.reqNo}: ${r.rank} x${r.headcount}`, `/hr-queue`);
      }
      return { requisition: r, duplicate: false };
    });
  }

  async reject(id: string, me: AuthUser, reason: string, d: Decision = {}) {
    return this.closeStep(id, me, reason, APPROVAL_STATUS.REJECTED, REQ_STATUS.REJECTED, d);
  }

  async returnForClarification(id: string, me: AuthUser, comment: string, d: Decision = {}) {
    return this.closeStep(id, me, comment, APPROVAL_STATUS.RETURNED, REQ_STATUS.RETURNED, d);
  }

  private async closeStep(id: string, me: AuthUser, reason: string, actStatus: string, reqStatus: string, d: Decision) {
    this.checkDocument(d.file);
    return this.ds.transaction(async (m) => {
      const { r, act } = await this.myPendingAction(m, id, me);
      if (r.status !== REQ_STATUS.PENDING || !act || act.status !== APPROVAL_STATUS.PENDING || (d.actionId && act.id !== d.actionId)) {
        throw new ConflictException(`This requisition is "${r.status}" and is not awaiting your decision.`);
      }
      const onBehalf = this.assertMayDecide(act, me, d.actionId);
      act.status = actStatus as any;
      act.remarks = reason;
      act.decidedAt = new Date();
      act.actedById = onBehalf ? me.id : null;
      await m.save(act);
      const document = await this.saveDecisionDocument(m, act, me, d.file);
      await m.update(ApprovalAction, { requisitionId: id, version: r.version, status: APPROVAL_STATUS.WAITING }, { status: APPROVAL_STATUS.SUPERSEDED });
      const old = r.status;
      r.status = reqStatus as any;
      r.currentStepOrder = null;
      await m.save(r);
      const verb = reqStatus === REQ_STATUS.REJECTED ? 'rejected' : 'returned for clarification';
      await this.audit.log(m, me, reqStatus === REQ_STATUS.REJECTED ? 'requisition.reject' : 'requisition.return', 'Requisition', id, {
        label: r.reqNo, old: { status: old }, new: { status: r.status, step: act.stepLabel, reason, document, ...(onBehalf ? { onBehalfOf: act.approver.name } : {}) },
      });
      await this.notify.notify(m, [r.requesterId], `requisition.${reqStatus === REQ_STATUS.REJECTED ? 'rejected' : 'returned'}`,
        `${r.reqNo} was ${verb} by ${me.name}`, `/requisitions/${id}`, reason);
      return r;
    });
  }

  async cancel(id: string, me: AuthUser, reason: string) {
    return this.ds.transaction(async (m) => {
      const r = await this.lock(m, id);
      const isOwner = r.requesterId === me.id && me.permissions.has(P.REQ_CANCEL);
      const isAdmin = me.permissions.has(P.APPROVAL_ROUTE_CONFIGURE);
      if (!isOwner && !isAdmin) throw new ForbiddenException('You cannot cancel this requisition.');
      const cancellable: string[] = [REQ_STATUS.DRAFT, REQ_STATUS.RETURNED, REQ_STATUS.PENDING];
      if (!cancellable.includes(r.status)) throw new ConflictException(`A requisition in status "${r.status}" cannot be cancelled.`);
      await m.update(ApprovalAction, { requisitionId: id, version: r.version, status: In([APPROVAL_STATUS.WAITING, APPROVAL_STATUS.PENDING]) }, { status: APPROVAL_STATUS.SUPERSEDED });
      const old = r.status;
      Object.assign(r, { status: REQ_STATUS.CANCELLED, cancelledAt: new Date(), cancelReason: reason, currentStepOrder: null });
      await m.save(r);
      await this.audit.log(m, me, 'requisition.cancel', 'Requisition', id, { label: r.reqNo, old: { status: old }, new: { status: r.status, reason } });
      return r;
    });
  }

  /** Corporate HR remarks + "Inserted in quota chart?" (applies approved revised quotas on Yes). */
  async corporateHr(id: string, dto: CorporateHrDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const r = await this.lock(m, id);
      const before = { corporateHrRemarks: r.corporateHrRemarks, insertedInQuotaChart: r.insertedInQuotaChart };
      if (dto.corporateHrRemarks !== undefined) {
        if (!me.permissions.has(P.REQ_CORPORATE_HR)) throw new ForbiddenException('Only Corporate HR can edit these remarks.');
        r.corporateHrRemarks = dto.corporateHrRemarks;
      }
      if (dto.insertedInQuotaChart !== undefined) {
        if (!me.permissions.has(P.REQ_QUOTA_CHART)) throw new ForbiddenException('You cannot set the quota-chart status.');
        if (r.status !== REQ_STATUS.SENT_TO_HR && dto.insertedInQuotaChart === 'Yes') {
          throw new ConflictException('Revised quotas can only be inserted into the quota chart after all approvals are complete.');
        }
        if (dto.insertedInQuotaChart === 'Yes' && r.insertedInQuotaChart !== 'Yes') await this.applyRevisedQuota(m, r, me);
        r.insertedInQuotaChart = dto.insertedInQuotaChart;
        r.quotaChartSetById = me.id;
        r.quotaChartSetAt = new Date();
      }
      await m.save(r);
      await this.audit.log(m, me, 'requisition.corporate_hr', 'Requisition', id, { label: r.reqNo, old: before, new: { ...dto } });
      return r;
    });
  }

  private async applyRevisedQuota(m: EntityManager, r: Requisition, me: AuthUser) {
    // Dept total is on the department master (owner, 2026-11-10); only designation goes to `manpower_quotas`.
    if (r.revisedQuotaDept !== null && r.revisedQuotaDept !== undefined) {
      const dept = await m.findOne(Department, { where: { id: r.departmentId } });
      if (dept) {
        const old = dept.totalQuota ?? null;
        dept.totalQuota = r.revisedQuotaDept;
        await m.save(dept);
        await this.audit.log(m, me, 'quota.revise_from_requisition', 'Department', dept.id, {
          label: r.reqNo, old: { totalQuota: old }, new: { totalQuota: r.revisedQuotaDept },
        });
      }
    }
    if (r.positionId && r.revisedQuotaDesig !== null && r.revisedQuotaDesig !== undefined) {
      const positionId = r.positionId;
      let q = await m.findOne(ManpowerQuota, { where: { departmentId: r.departmentId, positionId } });
      const old = q?.approvedQuota ?? null;
      if (!q) q = m.create(ManpowerQuota, { departmentId: r.departmentId, positionId, presentManpower: null });
      q.approvedQuota = r.revisedQuotaDesig;
      q.updatedById = me.id;
      q.remarks = `Revised via ${r.reqNo}`;
      await m.save(q);
      await this.audit.log(m, me, 'quota.revise_from_requisition', 'ManpowerQuota', q.id, {
        label: r.reqNo, old: { approvedQuota: old }, new: { approvedQuota: r.revisedQuotaDesig },
      });
    }
  }

  // ------------------------------------------------------------------ attachments

  async addAttachment(id: string, file: Express.Multer.File, kind: RequisitionAttachment['kind'], me: AuthUser) {
    if (!file) throw new BadRequestException('No file uploaded.');
    const err = validateUpload(file, ['pdf', 'docx', 'doc', 'jpg', 'jpeg', 'png']);
    if (err) throw new BadRequestException(err);
    return this.ds.transaction(async (m) => {
      const r = await this.lock(m, id);
      if (!this.actsAsRequester(r, me) || !EDITABLE_STATUSES.includes(r.status)) throw new ForbiddenException('Attachments can only be added by the requester while editable.');
      const stored = this.storage.save(file.buffer, file.originalname, file.mimetype, 'requisitions');
      const att = await m.save(RequisitionAttachment, m.create(RequisitionAttachment, {
        requisitionId: id, kind, storageKey: stored.storageKey, originalName: stored.originalName, mimeType: stored.mimeType, size: stored.size, uploadedById: me.id,
      }));
      await this.audit.log(m, me, 'requisition.attachment_add', 'Requisition', id, { label: r.reqNo, new: { kind, file: stored.originalName } });
      return att;
    });
  }

  async getAttachment(id: string, attId: string, me: AuthUser) {
    const r = await this.ds.getRepository(Requisition).findOneOrFail({ where: { id } });
    await this.assertCanView(r, me);
    const att = await this.ds.getRepository(RequisitionAttachment).findOne({ where: { id: attId, requisitionId: id } });
    if (!att) throw new NotFoundException();
    return { att, buffer: this.storage.read(att.storageKey) };
  }

  /**
   * Super Admin delete (owner, 2026-11-08: "Delete everything"). Removes the requisition with its approval history and attachments
   * and, when a vacancy was made from it, that vacancy with everything under it: job posts and criteria, applications, CV
   * documents and text, extraction and screening runs, remarks, stages, marks, imports, emails and batches, the vacancy's own
   * email templates, joining records, intake mails filed to it, background jobs and notifications that point at them.
   * Candidates left with no other application are deleted too; a candidate who also applied elsewhere is kept. Stored files
   * are erased after the commit. The Audit Log keeps its past entries and gets one `requisition.delete` entry with the counts.
   */
  async remove(id: string, me: AuthUser, reason: string) {
    const files: string[] = [];
    const result = await this.ds.transaction(async (m) => {
      const r = await m.findOne(Requisition, { where: { id }, relations: { department: true } });
      if (!r) throw new NotFoundException();
      const q = async (sql: string, params: unknown[]) => m.query(sql, params) as Promise<any[]>;
      const ids = async (sql: string, params: unknown[]) => (await q(sql, params)).map((x) => x.id as string);
      const del = async (sql: string, params: unknown[]) => Number((await m.query(sql, params))[1] ?? 0);
      const counts: Record<string, number> = {};
      const [vacancy] = await q(`SELECT id, "vacancyNo" FROM vacancies WHERE "requisitionId" = $1`, [id]);
      if (vacancy) {
        const v = [vacancy.id];
        const apps = await ids(`SELECT id FROM applications WHERE "vacancyId" = $1`, v);
        const cands = (await q(`SELECT DISTINCT "candidateId" AS id FROM applications WHERE "vacancyId" = $1`, v)).map((x) => x.id as string);
        const posts = await ids(`SELECT id FROM job_posts WHERE "vacancyId" = $1`, v);
        const events = await ids(`SELECT id FROM email_events WHERE "applicationId" = ANY($1::uuid[])`, [apps]);
        const intake = await q(`SELECT id, attachments FROM intake_messages WHERE "vacancyId" = $1`, v);
        files.push(...(await q(`SELECT "storageKey" FROM candidate_documents WHERE "applicationId" = ANY($1::uuid[]) AND "storageKey" IS NOT NULL`, [apps])).map((x) => x.storageKey));
        files.push(...(await q(`SELECT "circularAttachmentKey" AS k FROM job_posts WHERE "vacancyId" = $1 AND "circularAttachmentKey" IS NOT NULL`, v)).map((x) => x.k));
        for (const msg of intake) for (const a of msg.attachments ?? []) if (a.storageKey) files.push(a.storageKey);

        const refs = [...apps, ...events, ...intake.map((x: any) => x.id), vacancy.id];
        await del(`DELETE FROM processing_jobs WHERE "refId" = ANY($1::uuid[])`, [refs]);
        await del(`DELETE FROM notifications WHERE link LIKE $1 OR link = ANY($2::text[])`, [`/vacancies/${vacancy.id}%`, apps.map((a) => `/applications/${a}`)]);
        const batches = (await q(`SELECT DISTINCT "batchId" AS id FROM email_events WHERE id = ANY($1::uuid[])`, [events])).map((x) => x.id as string);
        counts.emails = await del(`DELETE FROM email_events WHERE id = ANY($1::uuid[])`, [events]);
        // The vacancy's batches, and any other batch these emails were the last ones of.
        await del(`DELETE FROM email_batches b WHERE (b."vacancyId" = $1 OR b.id = ANY($2::uuid[])) AND NOT EXISTS (SELECT 1 FROM email_events e WHERE e."batchId" = b.id)`, [vacancy.id, batches]);
        const templates = await ids(`SELECT id FROM email_templates WHERE "vacancyId" = $1`, v);
        await del(`DELETE FROM email_template_versions WHERE "templateId" = ANY($1::uuid[])`, [templates]);
        await del(`DELETE FROM email_templates WHERE id = ANY($1::uuid[])`, [templates]);
        await del(`DELETE FROM import_batches WHERE "vacancyId" = $1`, v); // rows cascade
        counts.intakeMails = await del(`DELETE FROM intake_messages WHERE "vacancyId" = $1`, v);
        counts.joining = await del(`DELETE FROM joining_records WHERE "applicationId" = ANY($1::uuid[])`, [apps]);
        counts.marks = await del(`DELETE FROM evaluation_marks WHERE "applicationId" = ANY($1::uuid[])`, [apps]);
        for (const t of ['candidate_stages', 'candidate_remarks', 'screening_runs', 'extraction_runs', 'candidate_documents']) {
          await del(`DELETE FROM ${t} WHERE "applicationId" = ANY($1::uuid[])`, [apps]);
        }
        counts.applications = await del(`DELETE FROM applications WHERE id = ANY($1::uuid[])`, [apps]);
        const orphans = await ids(`SELECT c.id FROM candidates c WHERE c.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM applications a WHERE a."candidateId" = c.id)`, [cands]);
        await m.query(`UPDATE applications SET "suspectedDuplicateCandidateId" = NULL, "duplicateReview" = CASE WHEN "duplicateReview" = 'PENDING' THEN 'NONE' ELSE "duplicateReview" END WHERE "suspectedDuplicateCandidateId" = ANY($1::uuid[])`, [orphans]);
        counts.candidates = await del(`DELETE FROM candidates WHERE id = ANY($1::uuid[])`, [orphans]);
        await del(`DELETE FROM screening_criteria_sets WHERE "jobPostId" = ANY($1::uuid[])`, [posts]); // criteria cascade
        counts.jobPosts = await del(`DELETE FROM job_posts WHERE id = ANY($1::uuid[])`, [posts]);
        await del(`DELETE FROM vacancies WHERE id = $1`, v);
      }
      files.push(...(await q(`SELECT "storageKey" FROM requisition_attachments WHERE "requisitionId" = $1`, [id])).map((x) => x.storageKey));
      counts.approvals = Number((await q(`SELECT count(*)::int AS n FROM approval_actions WHERE "requisitionId" = $1`, [id]))[0].n);
      await del(`DELETE FROM notifications WHERE link LIKE $1 OR link LIKE $2`, [`/requisitions/${id}%`, `/approvals/${id}%`]);
      await del(`DELETE FROM requisitions WHERE id = $1`, [id]); // approval actions and attachments cascade
      const label = r.reqNo ?? 'Draft requisition';
      await this.audit.log(m, me, 'requisition.delete', 'Requisition', id, {
        label,
        old: { reqNo: r.reqNo, status: r.status, department: r.department?.name, rank: r.rank, headcount: r.headcount, vacancyNo: vacancy?.vacancyNo ?? null },
        new: { reason, deleted: counts },
      });
      return { deleted: true, reqNo: r.reqNo, vacancyNo: vacancy?.vacancyNo ?? null, counts };
    });
    for (const key of files) this.storage.remove(key);
    return result;
  }
}
