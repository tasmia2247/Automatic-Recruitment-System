import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource } from 'typeorm';
import { AuthUser } from '../common/auth';
import { paged, skipTake } from '../common/pagination';
import { P } from '../common/permissions';
import { coordinatorScope, departmentScope } from '../common/scope';
import { AuditService, diff, NotificationService } from '../common/services';
import { Application, JoiningRecord, Vacancy } from '../database/entities';
import { ApproveDto, JoinedQuery, JoiningUpdateDto } from './joining.dto';

@Injectable()
export class JoiningService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly audit: AuditService, private readonly notify: NotificationService) {}

  private base(status: JoiningRecord['status']) {
    return this.ds.getRepository(JoiningRecord).createQueryBuilder('j')
      .innerJoinAndSelect('j.application', 'a').innerJoinAndSelect('a.candidate', 'c')
      .innerJoinAndSelect('a.vacancy', 'v').leftJoinAndSelect('v.department', 'd').leftJoinAndSelect('v.company', 'co')
      .where('j.status = :st', { st: status });
  }

  /** Who sees which joining records: every vacancy, the vacancies I coordinate, or (department users) their Joining access scope. */
  private scope(qb: ReturnType<JoiningService['base']>, me: AuthUser) {
    const coordinator = coordinatorScope(me);
    if (!coordinator) return;
    if (me.permissions.has(P.VACANCY_VIEW)) { qb.andWhere('v.coordinatorId = :me', { me: coordinator }); return; }
    const departments = departmentScope(me, 'joining');
    if (departments) qb.andWhere('v.departmentId = ANY(:departments)', { departments });
  }

  async pending(me: AuthUser) {
    const qb = this.base('Pending').orderBy('a.finalDecisionAt', 'ASC');
    this.scope(qb, me);
    const rows = await qb.getMany();
    return rows.map((j) => this.view(j));
  }

  async rejected(me: AuthUser) {
    const qb = this.base('Rejected').orderBy('j.updatedAt', 'DESC');
    this.scope(qb, me);
    return (await qb.getMany()).map((j) => this.view(j));
  }

  async joined(q: JoinedQuery, me: AuthUser) {
    const qb = this.base('Approved').leftJoin('users', 'u', 'u.id = j.approvedById').addSelect('u.name', 'approver').orderBy('j.joiningDate', 'DESC');
    this.scope(qb, me);
    // Candidate contact details stay with recruitment users; department users see who joined, not how to reach them.
    const contacts = me.permissions.has(P.CANDIDATE_VIEW);
    if (q.departmentId) qb.andWhere('v.departmentId = :d', { d: q.departmentId });
    if (q.position) qb.andWhere('v.positionTitle ILIKE :p', { p: `%${q.position}%` });
    if (q.from) qb.andWhere('j.joiningDate >= :f', { f: q.from });
    if (q.to) qb.andWhere('j.joiningDate <= :t', { t: q.to });
    if (q.q) qb.andWhere(new Brackets((w) => w.where('c.name ILIKE :q').orWhere('c.candidateNo ILIKE :q').orWhere('a.applicationNo ILIKE :q').orWhere('v.vacancyNo ILIKE :q')), { q: `%${q.q}%` });
    const total = await qb.getCount();
    const { skip, take } = skipTake(q);
    const { entities, raw } = await qb.offset(skip).limit(take).getRawAndEntities();
    return paged(entities.map((j) => {
      const row = { ...this.view(j), approvedBy: raw.find((r) => r.j_id === j.id)?.approver ?? null };
      return contacts ? row : { ...row, email: null, phone: null };
    }), total, q);
  }

  private view(j: JoiningRecord) {
    const a = j.application;
    return {
      id: j.id, joiningDate: j.joiningDate, status: j.status, letterStatus: j.letterStatus, remarks: j.remarks, approvedAt: j.approvedAt, updatedAt: j.updatedAt,
      applicationId: a.id, applicationNo: a.applicationNo, candidateNo: a.candidate.candidateNo, name: a.candidate.name,
      email: a.candidate.email, phone: a.candidate.phone, finalDecision: a.finalDecision, finalDecisionAt: a.finalDecisionAt,
      vacancyId: a.vacancy.id, vacancyNo: a.vacancy.vacancyNo, position: a.vacancy.positionTitle,
      department: a.vacancy.department?.name, company: a.vacancy.company?.name,
    };
  }

  async update(id: string, dto: JoiningUpdateDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const j = await m.findOne(JoiningRecord, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!j) throw new NotFoundException();
      if (j.status !== 'Pending') throw new ConflictException(`Joining record is ${j.status}.`);
      const d = diff(j, { ...j, ...dto }, Object.keys(dto));
      Object.assign(j, dto);
      await m.save(j);
      if (d.changed.length) await this.audit.log(m, me, 'joining.update', 'Application', j.applicationId, d);
      return j;
    });
  }

  /** Manual HR approval of actual joining; repeated clicks never duplicate (SRS 14.3 / AC-23). */
  async approve(id: string, dto: ApproveDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const j = await m.findOne(JoiningRecord, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!j) throw new NotFoundException();
      if (j.status === 'Approved') return { joining: j, duplicate: true };
      if (j.status !== 'Pending') throw new ConflictException(`Joining record is ${j.status}.`);
      const app = await m.findOneOrFail(Application, { where: { id: j.applicationId } });
      if (app.finalDecision !== 'Selected') throw new ConflictException('Only final-selected candidates can be approved as joined.');
      Object.assign(j, { status: 'Approved', joiningDate: dto.joiningDate, remarks: dto.remarks ?? j.remarks, approvedById: me.id, approvedAt: new Date() });
      await m.save(j);
      await this.audit.log(m, me, 'joining.approve', 'Application', j.applicationId, { label: app.applicationNo, old: { status: 'Pending' }, new: { status: 'Approved', joiningDate: dto.joiningDate } });

      // Mark the vacancy Filled once approved joinings reach its headcount.
      const v = await m.findOneOrFail(Vacancy, { where: { id: app.vacancyId }, lock: { mode: 'pessimistic_write' } });
      const joinedCount = await m.createQueryBuilder(JoiningRecord, 'jr').innerJoin(Application, 'a', 'a.id = jr.applicationId')
        .where(`a.vacancyId = :v AND jr.status = 'Approved'`, { v: v.id }).getCount();
      if (joinedCount >= v.headcount && v.status !== 'Filled') {
        const old = v.status;
        v.status = 'Filled';
        await m.save(v);
        await this.audit.log(m, me, 'vacancy.status_change', 'Vacancy', v.id, { label: v.vacancyNo, old: { status: old }, new: { status: 'Filled', joined: joinedCount } });
      }
      await this.notify.notify(m, [v.createdById], 'joining.approved', `${app.applicationNo} joined ${v.positionTitle} (${v.vacancyNo})`, `/joined`);
      return { joining: j, duplicate: false };
    });
  }

  /** A selected candidate turned down at joining stays listed as Rejected (owner, 2026-11-04); the final decision is untouched. */
  async reject(id: string, remarks: string, me: AuthUser) {
    return this.move(id, 'Pending', 'Rejected', remarks, 'joining.reject', me);
  }

  /** Undoes a rejection made by mistake: back to Joining Pending, while the final decision is still Selected. */
  async reopen(id: string, remarks: string, me: AuthUser) {
    return this.move(id, 'Rejected', 'Pending', remarks, 'joining.reopen', me);
  }

  private async move(id: string, from: JoiningRecord['status'], to: JoiningRecord['status'], remarks: string, action: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const j = await m.findOne(JoiningRecord, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!j) throw new NotFoundException();
      if (j.status === to) return j;
      if (j.status !== from) throw new ConflictException(`Joining record is ${j.status}.`);
      const app = await m.findOneOrFail(Application, { where: { id: j.applicationId } });
      if (to === 'Pending' && app.finalDecision !== 'Selected') throw new ConflictException('The final decision is no longer Selected, so the candidate cannot return to Joining Pending.');
      const old = { status: j.status, remarks: j.remarks };
      Object.assign(j, { status: to, remarks });
      await m.save(j);
      await this.audit.log(m, me, action, 'Application', j.applicationId, { label: app.applicationNo, old, new: { status: to, remarks } });
      return j;
    });
  }
}
