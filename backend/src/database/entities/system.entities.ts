import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from './base';

@Entity('notifications')
export class Notification extends BaseEntity {
  @Index() @Column('uuid') userId: string;
  @Column({ length: 60 }) event: string;
  @Column({ length: 300 }) title: string;
  @Column({ type: 'text', nullable: true }) body: string | null;
  /** Frontend route of the linked record, e.g. /requisitions/<id>. */
  @Column({ type: 'varchar', length: 300, nullable: true }) link: string | null;
  @Column({ type: 'timestamptz', nullable: true }) readAt: Date | null;
}

/** Append-only audit trail (SRS section 23). */
@Entity('audit_events')
@Index(['entityType', 'entityId'])
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid', nullable: true }) actorId: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) actorName: string | null;
  @Index() @Column({ length: 80 }) action: string;
  @Column({ length: 60 }) entityType: string;
  @Column({ type: 'varchar', length: 60, nullable: true }) entityId: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) entityLabel: string | null;
  @Column({ type: 'jsonb', nullable: true }) oldValues: Record<string, any> | null;
  @Column({ type: 'jsonb', nullable: true }) newValues: Record<string, any> | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) ip: string | null;
  @Index() @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export type JobType = 'EXTRACTION' | 'SCREENING' | 'EMAIL_SEND';
export type JobStatus = 'Queued' | 'Processing' | 'Completed' | 'Partial' | 'Failed';

/** DB-backed work queue, processed by the in-process worker with SKIP LOCKED. */
@Entity('processing_jobs')
@Index(['status', 'runAfter'])
@Index(['type', 'refId'])
export class ProcessingJob extends BaseEntity {
  @Column({ type: 'varchar', length: 20 }) type: JobType;
  @Column('uuid') refId: string;
  @Column({ type: 'varchar', length: 60, nullable: true }) refLabel: string | null;
  @Column({ type: 'varchar', length: 20, default: 'Queued' }) status: JobStatus;
  @Column('int', { default: 0 }) attempts: number;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'jsonb', nullable: true }) payload: Record<string, any> | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) runAfter: Date;
  @Column({ type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
}

/** Counters for human-readable display IDs. */
@Entity('id_counters')
export class IdCounter {
  @PrimaryColumn({ length: 40 }) key: string;
  @Column('int') value: number;
}
