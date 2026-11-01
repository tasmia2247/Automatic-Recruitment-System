import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { STAGE_TYPES, StageType } from '../database/entities';

export const DECISIONS = ['Pending', 'Selected', 'Not Selected', 'On Hold'];

export class StageDto {
  @IsOptional() @IsDateString() scheduledAt?: string | null;
  @IsOptional() @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @IsIn(['Present', 'Absent', 'Not Recorded']) attendance?: 'Present' | 'Absent' | 'Not Recorded';
  @IsOptional() @IsIn(DECISIONS) result?: any;
}

export class ScheduleDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) applicationIds: string[];
  @IsIn(STAGE_TYPES as unknown as string[]) stageType: StageType;
  @IsDateString() scheduledAt: string;
  @IsOptional() @IsString() location?: string;
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

export class ConfirmDto {
  @IsOptional() @IsBoolean() allowOverwrite?: boolean;
}

export class DecisionDto {
  @IsIn(DECISIONS) decision: any;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}
