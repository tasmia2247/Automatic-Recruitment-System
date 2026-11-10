import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth';
import { coordinatorScope } from '../common/scope';
import { ReportsQuery } from './reports.dto';

type Filters = { from?: string; to?: string; departmentId?: string; vacancyId?: string };

/**
 * Reports & Analytics (owner, 2026-11-09): read-only aggregates over live recruitment data.
 * Every query is scoped by `coordinatorScope(me)`: a plain HR user sees only the vacancies they coordinate,
 * HR Manager / Super Admin see everything. Date range (`from`, `to`) is inclusive by application creation date
 * unless named otherwise. All numbers are int counts; durations are in whole days (postgres `EXTRACT(DAY ...)`).
 */
@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** `vacancyWhere` + bound params: the filters plus the coordinator scope, applied to the `vacancies v` alias. */
  private scope(me: AuthUser, f: Filters) {
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = coordinatorScope(me);
    if (scope) { params.push(scope); where.push(`v."coordinatorId" = $${params.length}`); }
    if (f.departmentId) { params.push(f.departmentId); where.push(`v."departmentId" = $${params.length}`); }
    if (f.vacancyId) { params.push(f.vacancyId); where.push(`v.id = $${params.length}`); }
    return { where: where.length ? where.join(' AND ') : 'TRUE', params, scope };
  }

  /** Append `AND <alias>.<col> BETWEEN ...` to a base WHERE, growing `params` in place. */
  private period(where: string, params: unknown[], f: Filters, col: string) {
    let w = where;
    if (f.from) { params.push(f.from); w += ` AND ${col} >= $${params.length}::date`; }
    if (f.to) { params.push(f.to); w += ` AND ${col} < ($${params.length}::date + 1)`; }
    return w;
  }

  /** The high-level dashboard: recruitment funnel + core KPIs + top vacancies. */
  async overview(q: ReportsQuery, me: AuthUser) {
    const { where, params, scope } = this.scope(me, q);
    const one = async <T = any>(sql: string, p: unknown[]): Promise<T> => (await this.ds.query(sql, p))[0];

    // Funnel: CVs received -> screened -> shortlisted -> interviewed -> selected -> joined, inside the period.
    const appWhere = this.period(where, [...params], q, 'a."createdAt"');
    const appParams = params.slice();
    if (q.from) appParams.push(q.from);
    if (q.to) appParams.push(q.to);
    const funnel = await one(
      `SELECT
         count(*)::int AS cvs,
         count(*) FILTER (WHERE a."screeningResult" IS NOT NULL)::int AS screened,
         count(*) FILTER (WHERE a."screeningResult" = 'Pass')::int AS pass,
         count(*) FILTER (WHERE a.shortlisted)::int AS shortlisted,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM candidate_stages s WHERE s."applicationId" = a.id))::int AS interviewed,
         count(*) FILTER (WHERE a."finalDecision" = 'Selected')::int AS selected,
         count(*) FILTER (WHERE a."finalDecision" = 'On Hold')::int AS waiting,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM joining_records j WHERE j."applicationId" = a.id AND j.status = 'Approved'))::int AS joined
         FROM applications a JOIN vacancies v ON v.id = a."vacancyId" WHERE ${appWhere}`, appParams);

    const vacancies = await one(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE v.status NOT IN ('Filled', 'Closed'))::int AS active,
              count(*) FILTER (WHERE v.status = 'Filled')::int AS filled,
              count(*) FILTER (WHERE v.status = 'Closed')::int AS closed,
              count(*) FILTER (WHERE v."coordinatorId" IS NULL AND v.status NOT IN ('Filled', 'Closed'))::int AS unassigned
         FROM vacancies v WHERE ${where}`, params);

    // Requisitions in period (by submittedAt, which is when the form left Draft).
    const reqWhere = this.period(
      scope ? `r."coordinatorId" = $1` : 'TRUE',
      scope ? [scope] : [],
      q, 'r."submittedAt"',
    );
    const reqParams: unknown[] = scope ? [scope] : [];
    if (q.from) reqParams.push(q.from);
    if (q.to) reqParams.push(q.to);
    const requisitions = await one(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE r.status = 'Pending Approval')::int AS pending,
              count(*) FILTER (WHERE r.status = 'Sent to HR')::int AS approved,
              count(*) FILTER (WHERE r.status = 'Returned for Clarification')::int AS returned,
              count(*) FILTER (WHERE r.status = 'Rejected')::int AS rejected,
              count(*) FILTER (WHERE r.status = 'Cancelled')::int AS cancelled
         FROM requisitions r WHERE ${reqWhere}`, reqParams);

    // Conversion rates (percent, one decimal; null safe).
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
    const conversion = {
      passRate: pct(funnel.pass, funnel.screened),
      shortlistRate: pct(funnel.shortlisted, funnel.cvs),
      interviewRate: pct(funnel.interviewed, funnel.shortlisted),
      selectRate: pct(funnel.selected, funnel.interviewed),
      joinRate: pct(funnel.joined, funnel.selected),
      overall: pct(funnel.joined, funnel.cvs),
    };

    // Top five active vacancies by CV count.
    const topParams = params.slice();
    const topWhere = this.period(where, topParams, q, 'a."createdAt"');
    const topVacancies = await this.ds.query(
      `SELECT v.id, v."vacancyNo", v."positionTitle", v.status, v.headcount,
              count(a.id)::int AS cvs,
              count(a.id) FILTER (WHERE a.shortlisted)::int AS shortlisted,
              count(a.id) FILTER (WHERE a."finalDecision" = 'Selected')::int AS selected,
              count(a.id) FILTER (WHERE EXISTS (SELECT 1 FROM joining_records j WHERE j."applicationId" = a.id AND j.status = 'Approved'))::int AS joined
         FROM vacancies v LEFT JOIN applications a ON a."vacancyId" = v.id AND ${topWhere}
         WHERE ${where}
         GROUP BY v.id ORDER BY cvs DESC NULLS LAST, v."createdAt" DESC LIMIT 5`, topParams);

    return { funnel, conversion, vacancies, requisitions, topVacancies, period: { from: q.from ?? null, to: q.to ?? null } };
  }

  /** Per-vacancy pipeline report: one row per vacancy with the funnel counts and days-open. */
  async vacancyReport(q: ReportsQuery, me: AuthUser) {
    const { where, params } = this.scope(me, q);
    const p = params.slice();
    const whereCreated = this.period(where, p, q, 'v."createdAt"');
    const rows = await this.ds.query(
      `SELECT v.id, v."vacancyNo", v."positionTitle", v.status, v.headcount,
              d.name AS department, co.code AS company, u.name AS coordinator,
              EXTRACT(DAY FROM (COALESCE(
                (SELECT max(j."approvedAt") FROM joining_records j
                   JOIN applications a2 ON a2.id = j."applicationId" WHERE a2."vacancyId" = v.id AND j.status = 'Approved'),
                now()) - v."createdAt"))::int AS days_open,
              (SELECT count(*)::int FROM applications a WHERE a."vacancyId" = v.id) AS cvs,
              (SELECT count(*)::int FROM applications a WHERE a."vacancyId" = v.id AND a."screeningResult" = 'Pass') AS pass,
              (SELECT count(*)::int FROM applications a WHERE a."vacancyId" = v.id AND a.shortlisted) AS shortlisted,
              (SELECT count(*)::int FROM applications a WHERE a."vacancyId" = v.id AND a."finalDecision" = 'Selected') AS selected,
              (SELECT count(*)::int FROM applications a WHERE a."vacancyId" = v.id AND a."finalDecision" = 'On Hold') AS waiting,
              (SELECT count(*)::int FROM joining_records j
                 JOIN applications a2 ON a2.id = j."applicationId"
                WHERE a2."vacancyId" = v.id AND j.status = 'Approved') AS joined
         FROM vacancies v
         JOIN departments d ON d.id = v."departmentId"
         JOIN companies co ON co.id = v."companyId"
         LEFT JOIN users u ON u.id = v."coordinatorId"
         WHERE ${whereCreated}
         ORDER BY v."createdAt" DESC`, p);
    return { rows, period: { from: q.from ?? null, to: q.to ?? null } };
  }

  /**
   * Trends: a bucketed monthly (default) or weekly series of CVs received, shortlisted, selected, joined,
   * and requisitions submitted in the same period. Buckets are generated so empty months still appear.
   */
  async trends(q: ReportsQuery, me: AuthUser) {
    const { where, params, scope } = this.scope(me, q);
    const bucket = q.bucket ?? 'month';
    const trunc = bucket === 'day' ? 'day' : bucket === 'week' ? 'week' : 'month';
    const p = params.slice();
    const whereCreated = this.period(where, p, q, 'a."createdAt"');
    const apps = await this.ds.query(
      `SELECT date_trunc('${trunc}', a."createdAt")::date AS bucket,
              count(*)::int AS cvs,
              count(*) FILTER (WHERE a.shortlisted)::int AS shortlisted,
              count(*) FILTER (WHERE a."finalDecision" = 'Selected')::int AS selected,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM joining_records j WHERE j."applicationId" = a.id AND j.status = 'Approved'))::int AS joined
         FROM applications a JOIN vacancies v ON v.id = a."vacancyId" WHERE ${whereCreated}
        GROUP BY 1 ORDER BY 1`, p);
    const rp: unknown[] = scope ? [scope] : [];
    const reqWhere = this.period(scope ? `r."coordinatorId" = $1` : 'TRUE', rp, q, 'r."submittedAt"');
    const reqs = await this.ds.query(
      `SELECT date_trunc('${trunc}', r."submittedAt")::date AS bucket, count(*)::int AS requisitions
         FROM requisitions r WHERE r."submittedAt" IS NOT NULL AND ${reqWhere}
        GROUP BY 1 ORDER BY 1`, rp);
    return { bucket, apps, requisitions: reqs };
  }

  /** CV source effectiveness: how many CVs came from each intake path and how many ended up hired. */
  async sources(q: ReportsQuery, me: AuthUser) {
    const { where, params } = this.scope(me, q);
    const p = params.slice();
    const w = this.period(where, p, q, 'a."createdAt"');
    const rows = await this.ds.query(
      `SELECT coalesce(a.source, 'UNKNOWN') AS source,
              count(*)::int AS cvs,
              count(*) FILTER (WHERE a.shortlisted)::int AS shortlisted,
              count(*) FILTER (WHERE a."finalDecision" = 'Selected')::int AS selected,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM joining_records j WHERE j."applicationId" = a.id AND j.status = 'Approved'))::int AS joined
         FROM applications a JOIN vacancies v ON v.id = a."vacancyId" WHERE ${w}
        GROUP BY 1 ORDER BY cvs DESC`, p);
    return { rows };
  }

  /** Requisition approval turnaround: average decision time per step, with the most-returned step highlighted. */
  async approvalTat(q: ReportsQuery, me: AuthUser) {
    const scope = coordinatorScope(me);
    const p: unknown[] = scope ? [scope] : [];
    const base = scope ? `r."coordinatorId" = $1` : 'TRUE';
    const w = this.period(base, p, q, 'aa."decidedAt"');
    const perStep = await this.ds.query(
      `SELECT u.name AS approver,
              aa."stepLabel" AS step,
              count(*) FILTER (WHERE aa.status = 'Approved')::int AS approved,
              count(*) FILTER (WHERE aa.status = 'Returned')::int AS returned,
              count(*) FILTER (WHERE aa.status = 'Rejected')::int AS rejected,
              round(avg(EXTRACT(EPOCH FROM (aa."decidedAt" - aa."createdAt")) / 3600)::numeric, 1) AS avg_hours
         FROM approval_actions aa
         JOIN requisitions r ON r.id = aa."requisitionId"
         LEFT JOIN users u ON u.id = aa."approverUserId"
        WHERE aa."decidedAt" IS NOT NULL AND aa.status IN ('Approved', 'Returned', 'Rejected') AND ${w}
        GROUP BY u.name, aa."stepLabel" ORDER BY avg_hours DESC NULLS LAST`, p);
    const pending = await this.ds.query(
      `SELECT u.name AS approver, aa."stepLabel" AS step, count(*)::int AS pending,
              round(avg(EXTRACT(DAY FROM (now() - aa."createdAt")))::numeric, 1) AS avg_days_waiting
         FROM approval_actions aa
         JOIN requisitions r ON r.id = aa."requisitionId"
         LEFT JOIN users u ON u.id = aa."approverUserId"
        WHERE aa.status = 'Pending' AND aa.version = r.version AND ${scope ? `r."coordinatorId" = $1` : 'TRUE'}
        GROUP BY u.name, aa."stepLabel" ORDER BY pending DESC`, scope ? [scope] : []);
    return { perStep, pending };
  }

  /** Screening quality: pass/fail/review breakdown and the top-cited screening failure reasons. */
  async screeningQuality(q: ReportsQuery, me: AuthUser) {
    const { where, params } = this.scope(me, q);
    const p = params.slice();
    const w = this.period(where, p, q, 'a."createdAt"');
    const overall = (await this.ds.query(
      `SELECT count(*)::int AS screened,
              count(*) FILTER (WHERE a."screeningResult" = 'Pass')::int AS pass,
              count(*) FILTER (WHERE a."screeningResult" = 'Fail')::int AS fail,
              count(*) FILTER (WHERE a."screeningResult" = 'Review Required')::int AS review,
              count(*) FILTER (WHERE a.shortlisted AND a."screeningResult" <> 'Pass')::int AS overrides
         FROM applications a JOIN vacancies v ON v.id = a."vacancyId" WHERE ${w} AND a."screeningResult" IS NOT NULL`, p))[0];
    return { overall };
  }
}
