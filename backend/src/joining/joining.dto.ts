import {
  IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength,
} from 'class-validator';
import { ListQuery } from '../common/pagination';
import { JoiningRecord } from '../database/entities';

export class JoiningUpdateDto {
  @IsOptional() @IsDateString() joiningDate?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @IsOptional() @IsIn(['Not Prepared', 'Prepared', 'Sent']) letterStatus?: JoiningRecord['letterStatus'];
}

export class ApproveDto {
  @IsDateString({}, { message: 'Enter the verified actual joining date.' }) joiningDate: string;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

export class NotJoinedDto {
  @IsString() @MaxLength(2000) remarks: string;
}

export class JoinedQuery extends ListQuery {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
