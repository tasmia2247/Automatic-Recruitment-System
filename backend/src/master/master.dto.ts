import { Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Min,
} from 'class-validator';

export class MasterDto {
  @IsString() @Length(1, 30) code: string;
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Department-level total quota (Departments tab only, owner, 2026-11-10). Ignored for non-department records. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) totalQuota?: number | null;
}

export class MasterUpdateDto {
  @IsOptional() @IsString() @Length(1, 30) code?: string;
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) totalQuota?: number | null;
}

export class PositionDto {
  @IsString() @Length(1, 160) title: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class QuotaDto {
  @IsUUID() departmentId: string;
  /** Required since 2026-11-10 (owner): dept-level totals live on `departments.totalQuota`, not here. */
  @IsUUID() positionId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) approvedQuota?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) presentManpower?: number | null;
  @IsOptional() @IsDateString() effectiveDate?: string;
  @IsOptional() @IsString() remarks?: string;
}

export class QuotaUpdateDto {
  /** Approved quota changes only through Corporate HR / quota-chart permission (SRS 5.3). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) approvedQuota?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) presentManpower?: number | null;
  @IsOptional() @IsString() remarks?: string;
}

export class QuotaQuery {
  @IsOptional() @IsUUID() departmentId?: string;
}
