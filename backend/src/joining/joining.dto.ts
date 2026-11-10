import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { ListQuery } from '../common/pagination';
import { JoiningRecord } from '../database/entities';

export class JoiningUpdateDto {
  @IsOptional() @IsDateString() joiningDate?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @IsOptional() @IsIn(['Not Prepared', 'Prepared', 'Sent']) letterStatus?: JoiningRecord['letterStatus'];
  /** Agreed salary (owner, 2026-11-09); an empty string clears it. */
  @IsOptional() @IsString() @MaxLength(100, { message: 'Salary can be at most 100 characters.' }) salary?: string | null;
}

export class ApproveDto {
  @IsDateString({}, { message: 'Enter the verified actual joining date.' }) joiningDate: string;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

/** Several candidates approved as joined on one date (owner, 2026-11-08). */
export class ApproveBatchDto extends ApproveDto {
  @IsArray() @ArrayMinSize(1, { message: 'Select at least one candidate.' }) @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[];
}

/** Rejecting a selected candidate at joining, or reopening a rejection made by mistake, needs a recorded reason. */
export class ReasonDto {
  @IsString() @MinLength(3, { message: 'Give a reason of at least 3 characters.' }) @MaxLength(2000) remarks: string;
}

export class JoinedQuery extends ListQuery {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
