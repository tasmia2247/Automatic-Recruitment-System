import {
  Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { paged, skipTake } from '../common/pagination';
import { P } from '../common/permissions';
import { AuditService } from '../common/services';
import { ProcessingJob } from '../database/entities';
import { JobsService } from './jobs.service';
import { JobQuery } from './processing.dto';

/** Processing Monitor (SRS 22): filter by job type/status/date/source; explicit retry. */
@Controller('monitor')
export class MonitorController {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly jobs: JobsService, private readonly audit: AuditService) {}

  @Get('jobs')
  @RequirePerm(P.MONITOR_VIEW)
  async list(@Query() q: JobQuery) {
    const qb = this.ds.getRepository(ProcessingJob).createQueryBuilder('j').orderBy('j.createdAt', 'DESC');
    if (q.type) qb.andWhere('j.type = :t', { t: q.type });
    if (q.status) qb.andWhere('j.status = :s', { s: q.status });
    if (q.from) qb.andWhere('j.createdAt >= :f', { f: q.from });
    if (q.q) qb.andWhere('(j.refLabel ILIKE :q OR j.error ILIKE :q)', { q: `%${q.q}%` });
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    const summary = await this.ds.query(`SELECT type, status, count(*)::int AS n FROM processing_jobs GROUP BY type, status`);
    return { ...paged(items, total, q), summary };
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  @RequirePerm(P.MONITOR_RETRY)
  async retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    const job = await this.ds.getRepository(ProcessingJob).findOne({ where: { id } });
    if (!job) throw new NotFoundException();
    const ok = await this.jobs.retry(id);
    if (ok) await this.audit.log(this.ds.manager, me, 'job.retry', 'ProcessingJob', id, { label: `${job.type} ${job.refLabel ?? ''}`.trim() });
    return { retried: ok, message: ok ? 'Job queued for retry.' : 'Only failed jobs can be retried.' };
  }
}
