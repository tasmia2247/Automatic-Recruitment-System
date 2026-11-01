import { IsOptional, IsString } from 'class-validator';
import { ListQuery } from '../common/pagination';

export class AuditQuery extends ListQuery {
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
