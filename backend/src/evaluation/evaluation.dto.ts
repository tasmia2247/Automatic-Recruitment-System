import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { STAGE_TYPES, StageType } from '../database/entities';

export const DECISIONS = ['Pending', 'Selected', 'Not Selected', 'On Hold'];

export class StageDto {
  @IsOptional() @IsDateString() scheduledAt?: string | null;
  @IsOptional() @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @IsString() @MaxLength(500) panel?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(600) durationMinutes?: number | null;
  @IsOptional() @IsIn(['Present', 'Absent', 'Not Recorded']) attendance?: 'Present' | 'Absent' | 'Not Recorded';
  @IsOptional() @IsIn(DECISIONS) result?: any;
}

export class ScheduleDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) applicationIds: string[];
  @IsIn(STAGE_TYPES as unknown as string[]) stageType: StageType;
  @IsDateString() scheduledAt: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(500) panel?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(600) durationMinutes?: number;
}

/** Interview Board filters; every list is limited to the user's coordinated vacancies unless they see all. */
export class InterviewBoardQuery {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() vacancyId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class MarkDto {
  @IsIn(STAGE_TYPES as unknown as string[]) stageType: StageType;
  @IsOptional() @IsString() @MaxLength(60) component?: string;
  @Type(() => Number) @IsNumber() @Min(0) marks: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxMarks?: number | null;
  @IsOptional() @IsString() remarks?: string;
}

export class ImportQuery {
  @IsIn(STAGE_TYPES as unknown as string[]) stageType: StageType;
  @IsOptional() @IsString() component?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxMarks?: number;
}

/** `MAIN` = the written exam and interview board in one sheet. */
export class TemplateQuery {
  @IsIn([...STAGE_TYPES, 'MAIN']) stageType: StageType | 'MAIN';
}

export class MainImportQuery {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) writtenMaxMarks?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) interviewMaxMarks?: number;
}

export class ConfirmDto {
  @IsOptional() @IsBoolean() allowOverwrite?: boolean;
}

/**
 * Interview page "Remove" (owner, 2026-11-09): back one stage. `schedule` = the interview is cleared (date, attendance, marks), back to
 * step 1; `screening` = also off the shortlist, back to the vacancy's Candidates & screening.
 */
export class MoveBackDto {
  @IsArray() @ArrayMinSize(1, { message: 'Select at least one candidate.' }) @IsUUID('all', { each: true }) applicationIds: string[];
  @IsIn(['schedule', 'screening']) to: 'schedule' | 'screening';
}

/** Interview Board: several candidates sent to Joining Pending with one planned joining date (owner, 2026-11-08). */
export class SendToJoiningDto {
  @IsArray() @ArrayMinSize(1, { message: 'Select at least one candidate.' }) @IsUUID('all', { each: true }) applicationIds: string[];
  @IsDateString({ strict: true }, { message: 'Choose the planned joining date.' }) joiningDate: string;
}

export class DecisionDto {
  @IsIn(DECISIONS) decision: any;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}
