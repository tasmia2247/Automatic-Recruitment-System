import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength,
} from 'class-validator';
import { ListQuery } from '../common/pagination';

/**
 * Current status of an application, derived from the records each workflow step already owns
 * (processing/screening result, HR shortlist, stage records, final decision, joining approval).
 * It is not stored, so it can never disagree with those records.
 */
export const APPLICATION_STATUSES = [
  'Received', 'Screening', 'Pass', 'Fail', 'Review Required', 'Shortlisted', 'Interview', 'Selected', 'Not Selected', 'On Hold', 'Joined', 'Rejected',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export class CvBankQuery extends ListQuery {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() vacancyId?: string;
  @IsOptional() @IsIn(APPLICATION_STATUSES as unknown as string[]) status?: ApplicationStatus;
}

export class StatusChangeDto {
  @IsIn(APPLICATION_STATUSES as unknown as string[]) status: ApplicationStatus;
  /** The status the user saw; a mismatch means someone else changed it meanwhile. */
  @IsIn(APPLICATION_STATUSES as unknown as string[]) fromStatus: ApplicationStatus;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @IsOptional() @IsDateString() joiningDate?: string;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
}

export class BulkDeleteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique() @IsUUID('all', { each: true })
  ids: string[];
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
