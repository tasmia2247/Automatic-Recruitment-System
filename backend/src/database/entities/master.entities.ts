import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base';

@Entity('companies')
export class Company extends BaseEntity {
  @Index({ unique: true })
  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ default: true })
  active: boolean;
}

@Entity('departments')
export class Department extends BaseEntity {
  @Index({ unique: true })
  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ default: true })
  active: boolean;

  /**
   * Department-level total manpower quota (owner, 2026-11-10). Edited only on Master Data → Departments; the
   * requisition form reads it from here as "Current quota (Dept.)". The department's current manpower is derived
   * as the sum of its designation rows' `presentManpower` on `manpower_quotas`, so no caching here.
   */
  @Column({ type: 'int', nullable: true })
  totalQuota: number | null;
}

@Entity('positions')
export class Position extends BaseEntity {
  @Index({ unique: true })
  @Column({ length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  code: string | null;

  @Column({ default: true })
  active: boolean;
}

/**
 * Approved quota and present manpower for a (department, position). The company dimension was dropped on
 * 2026-11-10 (owner) — a department's designation quota is a master figure that does not depend on which
 * attached company a requisition names (see migration `1793300000023`). Department-level totals live on
 * `departments.totalQuota` (migration `1793300000022`).
 * Values may be null => UI shows "Not available" instead of a misleading number (SRS 5.2).
 */
@Entity('manpower_quotas')
@Index(['departmentId', 'positionId'], { unique: true })
export class ManpowerQuota extends BaseEntity {
  @Column('uuid')
  departmentId: string;

  @ManyToOne(() => Department)
  @JoinColumn({ name: 'departmentId' })
  department: Department;

  @Column('uuid')
  positionId: string;

  @ManyToOne(() => Position)
  @JoinColumn({ name: 'positionId' })
  position: Position;

  @Column({ type: 'int', nullable: true })
  approvedQuota: number | null;

  @Column({ type: 'int', nullable: true })
  presentManpower: number | null;

  @Column({ type: 'date', nullable: true })
  effectiveDate: string | null;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedById: string | null;
}
