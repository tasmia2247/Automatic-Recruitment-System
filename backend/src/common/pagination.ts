import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Shared list query: server-side paging + free-text search (NFR-11). */
export class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  pageSize?: number = 25;

  @IsOptional() @IsString()
  q?: string;
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export function paged<T>(items: T[], total: number, q: ListQuery): Page<T> {
  return { items, total, page: q.page ?? 1, pageSize: q.pageSize ?? 25 };
}

export function skipTake(q: ListQuery) {
  const pageSize = q.pageSize ?? 25;
  return { skip: ((q.page ?? 1) - 1) * pageSize, take: pageSize };
}
