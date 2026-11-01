import { IsIn, IsOptional, IsString } from 'class-validator';
import { ListQuery } from '../common/pagination';

export class JobQuery extends ListQuery {
  @IsOptional() @IsIn(['EXTRACTION', 'SCREENING', 'EMAIL_SEND']) type?: string;
  @IsOptional() @IsIn(['Queued', 'Processing', 'Completed', 'Partial', 'Failed']) status?: string;
  @IsOptional() @IsString() from?: string;
}
