import {
  Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { AuthUser, CurrentUser, Public, RequirePerm } from '../common/auth';
import { paged, skipTake } from '../common/pagination';
import { P } from '../common/permissions';
import { coordinatorScope, resolveScope } from '../common/scope';
import { AuditEvent, Notification } from '../database/entities';
import { AuditQuery } from './system.dto';

/** Submitted requisitions (drafts excluded): all, in approval, fully approved. Append ` AND ...` to filter. */
export const REQ_COUNTS = `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status = 'Pending Approval')::int AS pending,
         count(*) FILTER (WHERE status = 'Sent to HR')::int AS approved,
         count(*) FILTER (WHERE status = 'Rejected')::int AS rejected
    FROM requisitions WHERE status <> 'Draft'`;

@Controller()
export class SystemController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Role-based dashboard: every count comes from live DB records and only permitted metrics are returned (AC-27). */
  @Get('dashboard')
  async dashboard(@CurrentUser() me: AuthUser) {
    const out: Record<string, unknown> = {};
    const one = async (sql: string, params: unknown[] = []) => (await this.ds.query(sql, params))[0];

    // Department dashboard: the departments in the user's Dashboard access scope (all for the Super Admin).
    const deptScope = resolveScope(me, 'dashboard');
    if (me.permissions.has(P.DASHBOARD_DEPT) && deptScope !== undefined) {
      const scope = deptScope;
      const p = scope ? [scope] : [];
      const quota = await one(
        `SELECT coalesce(sum("approvedQuota"),0)::int AS "approvedQuota", coalesce(sum("presentManpower"),0)::int AS "presentManpower",
                coalesce(sum(GREATEST("approvedQuota" - "presentManpower", 0)),0)::int AS vacant,
                count(*) FILTER (WHERE "approvedQuota" IS NULL OR "presentManpower" IS NULL)::int AS "needsReview",
                count(*)::int AS positions
           FROM manpower_quotas WHERE "positionId" IS NOT NULL ${scope ? `AND "departmentId" = ANY($1)` : ''}`, p);
      out.department = {
        name: scope ? (await one(`SELECT string_agg(name, ', ' ORDER BY name) AS name FROM departments WHERE id = ANY($1)`, p))?.name ?? '—' : null,
        quota,
        requisitions: await one(REQ_COUNTS + (scope ? ` AND "departmentId" = ANY($1)` : ''), p),
        joined: (await one(
          `SELECT count(*)::int AS n FROM joining_records j JOIN applications a ON a.id = j."applicationId" JOIN vacancies v ON v.id = a."vacancyId"
            WHERE j.status = 'Approved' ${scope ? `AND v."departmentId" = ANY($1)` : ''}`, p)).n,
      };
    }
    // HR dashboard: the vacancies I coordinate (every vacancy for HR Manager / Super Admin).
    if (me.permissions.has(P.DASHBOARD_HR)) {
      const scope = coordinatorScope(me);
      const p = scope ? [scope] : [];
      const v = scope ? `v."coordinatorId" = $1` : 'TRUE';
      out.hr = {
        assignedOnly: !!scope,
        activeVacancies: (await one(`SELECT count(*)::int AS n FROM vacancies v WHERE v.status NOT IN ('Filled', 'Closed') AND ${v}`, p)).n,
        cvs: await one(
          `SELECT count(*)::int AS received,
                  count(*) FILTER (WHERE a."screeningResult" IS NULL)::int AS pending,
                  count(*) FILTER (WHERE a."screeningResult" = 'Pass')::int AS pass,
                  count(*) FILTER (WHERE a."screeningResult" = 'Fail')::int AS fail,
                  count(*) FILTER (WHERE a."screeningResult" = 'Review Required')::int AS review,
                  count(*) FILTER (WHERE a.shortlisted)::int AS shortlisted
             FROM applications a JOIN vacancies v ON v.id = a."vacancyId" WHERE ${v}`, p),
        stages: await this.ds.query(
          `SELECT s."stageType" AS stage, count(*)::int AS scheduled,
                  count(*) FILTER (WHERE s.attendance <> 'Not Recorded')::int AS attended,
                  count(*) FILTER (WHERE s.result <> 'Pending')::int AS completed
             FROM candidate_stages s JOIN applications a ON a.id = s."applicationId" JOIN vacancies v ON v.id = a."vacancyId"
            WHERE ${v} GROUP BY 1 ORDER BY 1`, p),
        joining: await one(
          `SELECT count(*) FILTER (WHERE j.status = 'Pending')::int AS pending, count(*) FILTER (WHERE j.status = 'Approved')::int AS joined
             FROM joining_records j JOIN applications a ON a.id = j."applicationId" JOIN vacancies v ON v.id = a."vacancyId" WHERE ${v}`, p),
      };
      if (me.permissions.has(P.HR_QUEUE)) {
        out.hr = { ...(out.hr as object), queue: (await one(
          `SELECT count(*)::int AS n FROM requisitions r WHERE r.status = 'Sent to HR' AND NOT EXISTS (SELECT 1 FROM vacancies v WHERE v."requisitionId" = r.id)`)).n,
          unassigned: (await one(`SELECT count(*)::int AS n FROM vacancies WHERE "coordinatorId" IS NULL AND status NOT IN ('Filled', 'Closed')`)).n };
      }
    }
    // Admin dashboard: every department's requisitions.
    if (me.permissions.has(P.DASHBOARD_ADMIN) && me.permissions.has(P.REQ_VIEW_ALL)) {
      out.admin = { requisitions: await one(REQ_COUNTS) };
    }
    if (me.permissions.has(P.APPROVAL_ACT)) {
      out.myApprovals = (await one(
        `SELECT count(*)::int AS n FROM approval_actions a JOIN requisitions r ON r.id = a."requisitionId"
          WHERE a."approverUserId" = $1 AND a.status = 'Pending' AND a.version = r.version`, [me.id])).n;
    }
    if (me.permissions.has(P.MONITOR_VIEW)) {
      out.failedJobs = (await one(`SELECT count(*)::int AS n FROM processing_jobs WHERE status = 'Failed'`)).n;
      out.failedEmails = (await one(`SELECT count(*)::int AS n FROM email_events WHERE status = 'Failed'`)).n;
    }
    out.recentActivity = await this.ds.getRepository(AuditEvent).find({ where: { actorId: me.id }, order: { createdAt: 'DESC' }, take: 10 });
    return out;
  }

  @Get('notifications')
  async notifications(@CurrentUser() me: AuthUser) {
    const items = await this.ds.getRepository(Notification).find({ where: { userId: me.id }, order: { createdAt: 'DESC' }, take: 50 });
    const unread = await this.ds.getRepository(Notification).count({ where: { userId: me.id, readAt: IsNull() } });
    return { items, unread };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await this.ds.getRepository(Notification).update({ id, userId: me.id }, { readAt: new Date() });
    return { ok: true };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() me: AuthUser) {
    await this.ds.getRepository(Notification).update({ userId: me.id, readAt: IsNull() }, { readAt: new Date() });
    return { ok: true };
  }

  /** Read-only audit search (SRS 23). */
  @Get('audit')
  @RequirePerm(P.AUDIT_VIEW)
  async audit(@Query() q: AuditQuery) {
    const qb = this.ds.getRepository(AuditEvent).createQueryBuilder('e').orderBy('e.createdAt', 'DESC');
    if (q.entityType) qb.andWhere('e.entityType = :t', { t: q.entityType });
    if (q.entityId) qb.andWhere('e.entityId = :i', { i: q.entityId });
    if (q.action) qb.andWhere('e.action ILIKE :a', { a: `%${q.action}%` });
    if (q.actorId) qb.andWhere('e.actorId = :u', { u: q.actorId });
    if (q.from) qb.andWhere('e.createdAt >= :f', { f: q.from });
    if (q.to) qb.andWhere(`e.createdAt < (:to::date + 1)`, { to: q.to });
    if (q.q) qb.andWhere('(e.entityLabel ILIKE :q OR e.actorName ILIKE :q OR e.action ILIKE :q)', { q: `%${q.q}%` });
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paged(items, total, q);
  }

  @Public()
  @Get('health')
  async health() {
    await this.ds.query('SELECT 1');
    return { ok: true, time: new Date().toISOString() };
  }
}
