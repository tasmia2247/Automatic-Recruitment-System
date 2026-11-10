import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { config } from '../config';
import { JobType, ProcessingJob } from '../database/entities';

export type JobOutcome = { status: 'Completed' | 'Partial'; note?: string } | void;
type Handler = (job: ProcessingJob) => Promise<JobOutcome>;

const MAX_AUTO_ATTEMPTS = 3;

/**
 * DB-backed background queue (SRS 15.1/15.2). Jobs are claimed with FOR UPDATE SKIP LOCKED so
 * several API instances can run workers safely; handlers must be idempotent.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Worker');
  private readonly handlers = new Map<JobType, Handler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  register(type: JobType, handler: Handler) {
    this.handlers.set(type, handler);
  }

  /** Enqueue inside the caller's transaction so the job exists only if the record does. */
  async enqueue(m: EntityManager, type: JobType, refId: string, refLabel?: string | null, payload?: Record<string, unknown>) {
    const active = await m.findOne(ProcessingJob, { where: [{ type, refId, status: 'Queued' }, { type, refId, status: 'Processing' }] });
    if (active) return active;
    return m.save(ProcessingJob, m.create(ProcessingJob, { type, refId, refLabel: refLabel ?? null, payload: payload ?? null, status: 'Queued' }));
  }

  onApplicationBootstrap() {
    if (config.workerEnabled) this.timer = setInterval(() => this.tick().catch((e) => this.logger.error(e)), config.workerIntervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Process queued jobs until none are ready. Exposed for tests and the "process now" admin action. */
  async drain(limit = 100) {
    let n = 0;
    while (n < limit && (await this.runOne())) n++;
    return n;
  }

  /**
   * One tick works until the queue is empty instead of stopping after a few jobs and waiting for the next interval, with
   * `WORKER_CONCURRENCY` lanes claiming jobs side by side (SKIP LOCKED keeps them apart). Load test, 2026-11-09: 3,000 CVs
   * uploaded at once used to take about 20 minutes, mostly in the pauses between ticks.
   */
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all(Array.from({ length: config.workerConcurrency }, () => this.drain(1000)));
    } finally {
      this.running = false;
    }
  }

  private async runOne(): Promise<boolean> {
    const claimed: ProcessingJob[] = await this.ds.query(
      `UPDATE processing_jobs SET status = 'Processing', "startedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
        WHERE id = (SELECT id FROM processing_jobs WHERE status = 'Queued' AND "runAfter" <= now()
                    ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`,
    ).then((r) => r[0]);
    const job = claimed[0];
    if (!job) return false;
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler registered for ${job.type}`);
      const out = await handler(job);
      await this.ds.getRepository(ProcessingJob).update(job.id, { status: out?.status ?? 'Completed', error: out?.note ?? null, completedAt: new Date() });
    } catch (e: any) {
      const message = String(e?.message ?? e).slice(0, 2000);
      this.logger.warn(`${job.type} ${job.refLabel ?? job.refId} failed (attempt ${job.attempts}): ${message}`);
      // Transient failures retry automatically with backoff; permanent ones wait for an explicit retry.
      const retry = e?.retryable === true && job.attempts < MAX_AUTO_ATTEMPTS;
      await this.ds.getRepository(ProcessingJob).update(job.id, {
        status: retry ? 'Queued' : 'Failed', error: message, completedAt: retry ? null : new Date(),
        runAfter: new Date(Date.now() + 30_000 * job.attempts),
      });
    }
    return true;
  }

  /** Explicit, safe retry of a failed job (Processing Monitor). Handlers are idempotent. */
  async retry(id: string) {
    const res = await this.ds.getRepository(ProcessingJob).update({ id, status: 'Failed' }, { status: 'Queued', error: null, runAfter: new Date(), completedAt: null });
    return res.affected === 1;
  }
}

export class RetryableError extends Error {
  readonly retryable = true;
}
