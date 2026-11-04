import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager } from 'typeorm';
import { config } from '../config';
import { AuthUser } from '../common/auth';
import { paged, skipTake } from '../common/pagination';
import { COORDINATOR_ROLES, P } from '../common/permissions';
import { assertJobPostAccess, assertVacancyAccess, coordinatorScope } from '../common/scope';
import {
  AuditService, diff, IdService, NotificationService, StorageService, validateUpload,
} from '../common/services';
import {
  JobPost, REQ_STATUS, Requisition, User, Vacancy,
} from '../database/entities';
import { DirectVacancyDto, HrQueueQuery, JobPostDto, VacancyListQuery, VacancyUpdateDto } from './vacancies.dto';
import { buildCircular, circularPdf, circularText } from './circular';
import { specializationItems } from '../screening/screening.engine';

/** What CVs of a vacancy are screened against: the requisition's "Specialization required", or a Direct HR vacancy's own. */
const screeningBasis = (v: Pick<Vacancy, 'specialization'>, r: Requisition | null) => {
  const specialization = r ? r.specialization : v.specialization;
  return { source: r ? 'REQUISITION' : 'VACANCY', reqNo: r?.reqNo ?? null, specialization: specialization ?? null, items: specializationItems(specialization) };
};

@Injectable()
export class VacancyService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ids: IdService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
    private readonly storage: StorageService,
  ) {}

  /** HR approved-requisition queue (SRS 8.1): only fully approved requisitions (AC-05). */
  async hrQueue(q: HrQueueQuery) {
    const qb = this.ds.getRepository(Requisition).createQueryBuilder('r')
      .leftJoinAndSelect('r.department', 'd').leftJoinAndSelect('r.company', 'c').leftJoinAndSelect('r.requester', 'u')
      .leftJoinAndSelect('r.coordinator', 'co')
      .leftJoin(Vacancy, 'v', 'v.requisitionId = r.id').addSelect(['v.id', 'v.vacancyNo', 'v.status'])
      .where('r.status = :st', { st: REQ_STATUS.SENT_TO_HR })
      .orderBy('r.approvedAt', 'ASC');
    if (q.view !== 'all') qb.andWhere('v.id IS NULL');
    if (q.departmentId) qb.andWhere('r.departmentId = :d', { d: q.departmentId });
    if (q.companyId) qb.andWhere('r.companyId = :c', { c: q.companyId });
    if (q.q) qb.andWhere(new Brackets((w) => w.where('r.reqNo ILIKE :q').orWhere('r.rank ILIKE :q')), { q: `%${q.q}%` });
    const { skip, take } = skipTake(q);
    const total = await qb.getCount();
    const { entities, raw } = await qb.offset(skip).limit(take).getRawAndEntities();
    const items = entities.map((r) => {
      const row = raw.find((x) => x.r_id === r.id);
      return {
        id: r.id, reqNo: r.reqNo, rank: r.rank, headcount: r.headcount, replacePlan: r.replacePlan,
        replacementEmployeeName: r.replacementEmployeeName, department: r.department, company: r.company,
        requester: { name: r.requester.name }, submittedAt: r.submittedAt, approvedAt: r.approvedAt, status: r.status,
        background: r.background,
        coordinator: r.coordinator ? { id: r.coordinator.id, name: r.coordinator.name } : null,
        vacancy: row?.v_id ? { id: row.v_id, vacancyNo: row.v_vacancyNo, status: row.v_status } : null,
      };
    });
    return paged(items, total, q);
  }

  /** Active users holding an active HR coordinator role: new HR accounts appear here automatically. */
  async coordinators() {
    return this.ds.query(
      `SELECT DISTINCT u.id, u.name, u.designation, u.email FROM users u
         JOIN user_roles ur ON ur."userId" = u.id JOIN roles ro ON ro.id = ur."roleId"
        WHERE u.active AND ro.active AND ro.code = ANY($1) ORDER BY u.name`, [COORDINATOR_ROLES]);
  }

  /**
   * Assigns (or reassigns / clears) the HR coordinator of an approved requisition and its vacancy, kept in sync.
   * Access follows the vacancy's coordinator, so the previous coordinator loses access at once. Audited.
   */
  async assignCoordinator(target: { requisitionId?: string; vacancyId?: string }, coordinatorId: string | null, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      let v = target.vacancyId ? await m.findOne(Vacancy, { where: { id: target.vacancyId }, lock: { mode: 'pessimistic_write' } }) : null;
      if (target.vacancyId && !v) throw new NotFoundException('Vacancy not found.');
      const requisitionId = target.requisitionId ?? v?.requisitionId ?? null;
      const r = requisitionId ? await m.findOne(Requisition, { where: { id: requisitionId }, lock: { mode: 'pessimistic_write' } }) : null;
      if (target.requisitionId) {
        if (!r) throw new NotFoundException('Requisition not found.');
        if (r.status !== REQ_STATUS.SENT_TO_HR) throw new ConflictException('A coordinator can only be assigned to a fully approved requisition.');
        v = await m.findOne(Vacancy, { where: { requisitionId: r.id }, lock: { mode: 'pessimistic_write' } });
      }
      const next = coordinatorId ? await this.eligibleCoordinator(m, coordinatorId) : null;
      const previousId = v?.coordinatorId ?? r?.coordinatorId ?? null;
      if (previousId === coordinatorId) return { coordinator: next ? { id: next.id, name: next.name } : null, changed: false };
      const previous = previousId ? await m.findOneBy(User, { id: previousId }) : null;
      if (r) await m.update(Requisition, r.id, { coordinatorId });
      if (v) await m.update(Vacancy, v.id, { coordinatorId, updatedById: me.id });
      const label = [r?.reqNo, v?.vacancyNo].filter(Boolean).join(' / ');
      await this.audit.log(m, me, previousId ? 'coordinator.reassign' : 'coordinator.assign', v ? 'Vacancy' : 'Requisition', (v ?? r)!.id, {
        label,
        old: { coordinator: previous?.name ?? null, coordinatorId: previousId },
        new: { coordinator: next?.name ?? null, coordinatorId },
      });
      if (next) await this.notify.notify(m, [next.id], 'coordinator.assigned', `You are the coordinator of ${label}`, v ? `/vacancies/${v.id}` : '/vacancies');
      return { coordinator: next ? { id: next.id, name: next.name } : null, changed: true };
    });
  }

  private async eligibleCoordinator(m: EntityManager, id: string) {
    const ok = (await this.coordinators()).some((u: any) => u.id === id);
    if (!ok) throw new BadRequestException({ message: 'Only an active HR user can be selected as coordinator.', fieldErrors: { coordinatorId: 'Choose an active HR user.' } });
    return m.findOneByOrFail(User, { id });
  }

  /** Idempotent: the unique index on vacancies.requisitionId guarantees one vacancy per requisition (AC-09). */
  async createFromRequisition(requisitionId: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const r = await m.findOne(Requisition, { where: { id: requisitionId }, lock: { mode: 'pessimistic_write' } });
      if (!r) throw new NotFoundException('Requisition not found.');
      const existing = await m.findOne(Vacancy, { where: { requisitionId } });
      if (existing) return { vacancy: existing, duplicate: true };
      if (r.status !== REQ_STATUS.SENT_TO_HR) {
        throw new ConflictException(`Only fully approved requisitions can become vacancies (current status: ${r.status}).`);
      }
      const v = m.create(Vacancy, {
        vacancyNo: await this.ids.next(m, 'VAC'), source: 'REQUISITION', requisitionId, departmentId: r.departmentId,
        companyId: r.companyId, positionId: r.positionId, positionTitle: r.rank!, headcount: r.headcount!,
        vacancyType: r.replacePlan ? 'REPLACEMENT' : 'NEW', replacementEmployee: r.replacePlan ? [r.replacementEmployeeName, r.replacementEmployeeId].filter(Boolean).join(' / ') : null,
        status: 'Open', createdById: me.id, coordinatorId: r.coordinatorId,
      });
      await m.save(v);
      await this.audit.log(m, me, 'vacancy.create_from_requisition', 'Vacancy', v.id, { label: v.vacancyNo, new: { requisition: r.reqNo, headcount: v.headcount } });
      return { vacancy: v, duplicate: false };
    });
  }

  async createDirect(dto: DirectVacancyDto, me: AuthUser) {
    if (!config.allowDirectHrVacancy) throw new ForbiddenException('Direct HR vacancies are disabled by configuration.');
    if (dto.coordinatorId && !me.permissions.has(P.COORDINATOR_ASSIGN)) throw new ForbiddenException('You do not have permission to assign a coordinator.');
    return this.ds.transaction(async (m) => {
      const coordinator = dto.coordinatorId ? await this.eligibleCoordinator(m, dto.coordinatorId) : null;
      const specialization = dto.specialization?.trim() || null;
      const v = m.create(Vacancy, { ...dto, specialization, specializationVersion: specialization ? 1 : 0, coordinatorId: coordinator?.id ?? null, positionId: dto.positionId ?? null, source: 'DIRECT_HR', requisitionId: null, vacancyNo: await this.ids.next(m, 'VAC'), status: 'Open', createdById: me.id });
      await m.save(v);
      await this.audit.log(m, me, 'vacancy.create_direct', 'Vacancy', v.id, { label: v.vacancyNo, new: { ...dto } });
      if (coordinator) {
        await this.audit.log(m, me, 'coordinator.assign', 'Vacancy', v.id, { label: v.vacancyNo, old: { coordinator: null, coordinatorId: null }, new: { coordinator: coordinator.name, coordinatorId: coordinator.id } });
        await this.notify.notify(m, [coordinator.id], 'coordinator.assigned', `You are the coordinator of ${v.vacancyNo}`, `/vacancies/${v.id}`);
      }
      return v;
    });
  }

  async list(q: VacancyListQuery, me: AuthUser) {
    const qb = this.ds.getRepository(Vacancy).createQueryBuilder('v')
      .leftJoinAndSelect('v.department', 'd').leftJoinAndSelect('v.company', 'c').leftJoinAndSelect('v.requisition', 'r')
      .leftJoinAndSelect('v.coordinator', 'co')
      .orderBy('v.createdAt', 'DESC');
    const scope = coordinatorScope(me);
    if (scope) qb.andWhere('v.coordinatorId = :me', { me: scope });
    if (q.status) qb.andWhere('v.status = :s', { s: q.status });
    if (q.departmentId) qb.andWhere('v.departmentId = :d', { d: q.departmentId });
    if (q.q) qb.andWhere(new Brackets((w) => w.where('v.vacancyNo ILIKE :q').orWhere('v.positionTitle ILIKE :q')), { q: `%${q.q}%` });
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    const counts = items.length ? await this.ds.query(
      `SELECT "vacancyId", count(*)::int AS total,
              count(*) FILTER (WHERE "screeningResult" = 'Pass')::int AS pass,
              count(*) FILTER (WHERE shortlisted)::int AS shortlisted,
              count(*) FILTER (WHERE "finalDecision" = 'Selected')::int AS selected
         FROM applications WHERE "vacancyId" = ANY($1) GROUP BY "vacancyId"`, [items.map((i) => i.id)]) : [];
    return paged(items.map((v) => ({
      ...v, requisition: v.requisition ? { id: v.requisition.id, reqNo: v.requisition.reqNo } : null,
      coordinator: v.coordinator ? { id: v.coordinator.id, name: v.coordinator.name } : null,
      stats: counts.find((c: any) => c.vacancyId === v.id) ?? { total: 0, pass: 0, shortlisted: 0, selected: 0 },
    })), total, q);
  }

  async detail(id: string, me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    const v = await this.ds.getRepository(Vacancy).findOne({
      where: { id }, relations: { department: true, company: true, requisition: true, jobPosts: true, coordinator: true },
      order: { jobPosts: { createdAt: 'DESC' } },
    });
    if (!v) throw new NotFoundException('Vacancy not found.');
    return {
      ...v, requisition: v.requisition ? { id: v.requisition.id, reqNo: v.requisition.reqNo, status: v.requisition.status } : null,
      coordinator: v.coordinator ? { id: v.coordinator.id, name: v.coordinator.name } : null,
      screening: screeningBasis(v, v.requisition),
    };
  }

  async update(id: string, body: VacancyUpdateDto, me: AuthUser) {
    // Only the fields the request sent: a validated DTO also carries the others as undefined, which would read as cleared.
    const dto = Object.fromEntries(Object.entries(body).filter(([, val]) => val !== undefined)) as VacancyUpdateDto;
    await assertVacancyAccess(this.ds, me, id);
    return this.ds.transaction(async (m) => {
      const v = await m.findOne(Vacancy, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!v) throw new NotFoundException();
      if (dto.specialization !== undefined) {
        if (v.source !== 'DIRECT_HR') throw new BadRequestException('This vacancy is screened against the Specialization required of its approved requisition, which cannot be changed here.');
        dto.specialization = dto.specialization?.trim() || null;
        if (dto.specialization !== v.specialization) v.specializationVersion += 1;
      }
      const d = diff(v, { ...v, ...dto }, ['status', 'remarks', 'specialization']);
      Object.assign(v, dto, { updatedById: me.id });
      await m.save(v);
      if (d.changed.length) await this.audit.log(m, me, d.changed.includes('status') ? 'vacancy.status_change' : 'vacancy.update', 'Vacancy', id, { label: v.vacancyNo, ...d });
      return v;
    });
  }

  // ------------------------------------------------------------------ job posts

  async createJobPost(vacancyId: string, dto: JobPostDto, me: AuthUser) {
    await assertVacancyAccess(this.ds, me, vacancyId);
    return this.ds.transaction(async (m) => {
      const v = await m.findOne(Vacancy, { where: { id: vacancyId } });
      if (!v) throw new NotFoundException('Vacancy not found.');
      if (['Closed', 'Filled'].includes(v.status)) throw new ConflictException(`Vacancy is ${v.status}.`);
      this.checkDates(dto);
      const jobNo = await this.ids.next(m, 'JOB');
      const jp = m.create(JobPost, {
        ...dto, vacancyId, jobNo, status: 'Draft', createdById: me.id,
        cvCollection: dto.cvCollection ?? `Email CV with subject containing "${jobNo}"`,
      });
      await m.save(jp);
      if (v.status === 'Open') { v.status = 'Posting'; await m.save(v); }
      await this.audit.log(m, me, 'jobpost.create', 'JobPost', jp.id, { label: jobNo, new: { vacancy: v.vacancyNo, title: jp.title } });
      return jp;
    });
  }

  private checkDates(dto: JobPostDto) {
    if (dto.startDate && dto.deadline && dto.deadline < dto.startDate) throw new BadRequestException({ message: 'Deadline must be on or after the start date.', fieldErrors: { deadline: 'Deadline must be on or after the start date.' } });
  }

  async getJobPost(id: string, me: AuthUser) {
    await assertJobPostAccess(this.ds, me, id);
    const jp = await this.ds.getRepository(JobPost).findOne({ where: { id }, relations: { vacancy: { department: true, company: true, requisition: true } } });
    if (!jp) throw new NotFoundException('Job post not found.');
    const { requisition, ...vacancy } = jp.vacancy;
    return { ...jp, vacancy, screening: screeningBasis(vacancy, requisition) };
  }

  async updateJobPost(id: string, dto: JobPostDto, me: AuthUser) {
    await assertJobPostAccess(this.ds, me, id);
    this.checkDates(dto);
    return this.ds.transaction(async (m) => {
      const jp = await m.findOne(JobPost, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!jp) throw new NotFoundException();
      if (['Closed', 'Cancelled'].includes(jp.status)) throw new ConflictException(`Job post is ${jp.status}.`);
      const d = diff(jp, { ...jp, ...dto }, Object.keys(dto));
      Object.assign(jp, dto);
      await m.save(jp);
      if (d.changed.length) await this.audit.log(m, me, 'jobpost.update', 'JobPost', id, { label: jp.jobNo, ...d });
      return jp;
    });
  }

  async setJobPostStatus(id: string, status: JobPost['status'], me: AuthUser) {
    await assertJobPostAccess(this.ds, me, id);
    return this.ds.transaction(async (m) => {
      const jp = await m.findOne(JobPost, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!jp) throw new NotFoundException();
      const allowed: Record<string, string[]> = { Draft: ['Published', 'Cancelled'], Published: ['Closed', 'Cancelled'], Closed: ['Published'], Cancelled: [] };
      if (jp.status === status) return jp;
      if (!allowed[jp.status].includes(status)) throw new ConflictException(`Cannot change job post from ${jp.status} to ${status}.`);
      const old = jp.status;
      jp.status = status;
      await m.save(jp);
      await this.audit.log(m, me, 'jobpost.status_change', 'JobPost', id, { label: jp.jobNo, old: { status: old }, new: { status } });
      return jp;
    });
  }

  async attachCircular(id: string, file: Express.Multer.File, me: AuthUser) {
    await assertJobPostAccess(this.ds, me, id);
    if (!file) throw new BadRequestException('No file uploaded.');
    const err = validateUpload(file, ['pdf', 'jpg', 'jpeg', 'png']);
    if (err) throw new BadRequestException(err);
    return this.ds.transaction(async (m) => {
      const jp = await m.findOne(JobPost, { where: { id } });
      if (!jp) throw new NotFoundException();
      const stored = this.storage.save(file.buffer, file.originalname, file.mimetype, 'circulars');
      jp.circularAttachmentKey = stored.storageKey;
      jp.circularAttachmentName = stored.originalName;
      await m.save(jp);
      await this.audit.log(m, me, 'jobpost.circular_attach', 'JobPost', id, { label: jp.jobNo, new: { file: stored.originalName } });
      return jp;
    });
  }

  async circular(id: string, me: AuthUser) {
    await assertJobPostAccess(this.ds, me, id);
    const jp = await this.ds.getRepository(JobPost).findOne({ where: { id } });
    if (!jp?.circularAttachmentKey) throw new NotFoundException('No circular attachment.');
    return { name: jp.circularAttachmentName!, buffer: this.storage.read(jp.circularAttachmentKey) };
  }

  /** The hiring circular generated from the job post's current details, as a poster PDF or plain text. */
  async generatedCircular(id: string, format: 'pdf' | 'txt', me: AuthUser) {
    await assertJobPostAccess(this.ds, me, id);
    const jp = await this.ds.getRepository(JobPost).findOne({ where: { id }, relations: { vacancy: { department: true, company: true } } });
    if (!jp) throw new NotFoundException('Job post not found.');
    const c = buildCircular(jp, jp.vacancy);
    const base = `${jp.jobNo} ${jp.title}`.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return format === 'pdf'
      ? { name: `${base}.pdf`, type: 'application/pdf', buffer: await circularPdf(c) }
      : { name: `${base}.txt`, type: 'text/plain; charset=utf-8', buffer: Buffer.from(circularText(c), 'utf8') };
  }
}
