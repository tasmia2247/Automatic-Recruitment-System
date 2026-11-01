import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { BaseEntity } from './base';
import { Department } from './master.entities';

export type ScopeMode = 'own' | 'all' | 'custom';
/** Per-module department access chosen for a user (or a template); a missing module uses the role default. */
export type DepartmentScopes = Partial<Record<'dashboard' | 'quotas' | 'requisitions' | 'joining', { mode: ScopeMode; departmentIds?: string[] }>>;

@Entity('roles')
export class Role extends BaseEntity {
  @Index({ unique: true })
  @Column({ length: 60 })
  code: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Permission codes such as `requisition.create` (see common/permissions.ts). */
  @Column({ type: 'text', array: true, default: '{}' })
  permissions: string[];

  @Column({ default: true })
  active: boolean;
}

@Entity('users')
export class User extends BaseEntity {
  @Column({ length: 160 })
  name: string;

  /** Unique among accounts that are not deleted, so a deleted user's email can be reused. */
  @Index({ unique: true, where: '"deletedAt" IS NULL' })
  @Column({ length: 200 })
  email: string;

  @Column({ length: 200, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  designation: string | null;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'departmentId' })
  department: Department | null;

  @ManyToMany(() => Role, { eager: true })
  @JoinTable({ name: 'user_roles', joinColumn: { name: 'userId' }, inverseJoinColumn: { name: 'roleId' } })
  roles: Role[];

  /** Optional per-user overrides on top of role permissions. */
  @Column({ type: 'text', array: true, default: '{}' })
  extraPermissions: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  deniedPermissions: string[];

  /** Access Scope per department-owned module (Own / All / Custom departments), enforced by the API. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  departmentScopes: DepartmentScopes;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  /**
   * Set when an administrator deletes the account: it is hidden and can never sign in, but stays referenced by
   * requisitions, approvals and the audit log so history keeps the person's name. Cleared on restore.
   */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}

/** A saved permission set (permissions + access scopes) that can be copied onto a user. */
@Entity('permission_templates')
export class PermissionTemplate extends BaseEntity {
  @Index({ unique: true })
  @Column({ length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  permissions: string[];

  @Column({ type: 'jsonb', default: () => "'{}'" })
  departmentScopes: DepartmentScopes;
}

/**
 * Administrator overrides for how a permission or module (group) is shown, and a system-wide off switch for a
 * permission. Codes themselves are fixed: the API checks them in code. Deleting the row restores the defaults.
 */
@Entity('permission_settings')
@Index(['kind', 'key'], { unique: true })
export class PermissionSetting extends BaseEntity {
  @Column({ type: 'varchar', length: 20 }) kind: 'permission' | 'module';
  @Column({ length: 80 }) key: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) label: string | null;
  @Column({ type: 'text', nullable: true }) description: string | null;
  /** Permission only: nobody holds it while disabled, whatever their roles say. */
  @Column({ default: false }) disabled: boolean;
}
