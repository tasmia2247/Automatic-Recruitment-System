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
 * Approved quota and present manpower. `positionId = null` is the department-level total.
 * Values may be null => UI shows "Not available" instead of a misleading number (SRS 5.2).
 */
@Entity('manpower_quotas')
@Index(['companyId', 'departmentId', 'positionId'], { unique: true })
export class ManpowerQuota extends BaseEntity {
  @Column('uuid')
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column('uuid')
  departmentId: string;

  @ManyToOne(() => Department)
  @JoinColumn({ name: 'departmentId' })
  department: Department;

  @Column({ type: 'uuid', nullable: true })
  positionId: string | null;

  @ManyToOne(() => Position, { nullable: true })
  @JoinColumn({ name: 'positionId' })
  position: Position | null;

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
