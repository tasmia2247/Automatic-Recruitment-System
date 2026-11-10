import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * Reports query: date range (YYYY-MM-DD, inclusive), optional department / vacancy filter.
 * The reports service always clamps results to the caller's coordinator scope.
 */
export class ReportsQuery {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' }) from?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' }) to?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() vacancyId?: string;
  @IsOptional() @IsIn(['day', 'week', 'month']) bucket?: 'day' | 'week' | 'month';
}
