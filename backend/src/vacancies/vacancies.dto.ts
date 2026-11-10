import { Type } from 'class-transformer';
import {
  IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { ListQuery } from '../common/pagination';
import {
  JOBPOST_STATUSES, JobPost, VACANCY_STATUSES, Vacancy,
} from '../database/entities';

export class HrQueueQuery extends ListQuery {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsIn(['pending', 'all']) view?: 'pending' | 'all';
  /** Only requisitions whose final approval fell on this day (Bangladesh time), YYYY-MM-DD (owner, 2026-11-08). */
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10, { message: 'approvedOn must be a date (YYYY-MM-DD).' }) approvedOn?: string;
}

export class CoordinatorDto {
  /** null clears the assignment (shown as Unassigned). */
  @IsOptional() @IsUUID() coordinatorId: string | null;
}

export class VacancyListQuery extends ListQuery {
  @IsOptional() @IsIn(VACANCY_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

export class DirectVacancyDto {
  @IsUUID() departmentId: string;
  @IsUUID() companyId: string;
  @IsOptional() @IsUUID() positionId?: string;
  @IsString() @Length(1, 160) positionTitle: string;
  @Type(() => Number) @IsInt() @Min(1) headcount: number;
  @IsIn(['NEW', 'REPLACEMENT']) vacancyType: 'NEW' | 'REPLACEMENT';
  @IsOptional() @IsString() replacementEmployee?: string;
  @IsString() @MinLength(5, { message: 'A reason is required for a Direct HR Entry vacancy.' }) directReason: string;
  /** "Specialization required": what CVs are screened against. `specialization` is "Other requirements". */
  @IsOptional() @IsString() requiredEducation?: string | null;
  @IsOptional() @IsString() requiredSkills?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }, { message: 'Minimum experience must be a number of years.' }) @Min(0) @Max(60) requiredExperienceYears?: number | null;
  @IsOptional() @IsString() specialization?: string | null;
  @IsOptional() @IsString() remarks?: string;
  /** Optional HR coordinator; needs hr.assign_coordinator. Left out = Unassigned. */
  @IsOptional() @IsUUID() coordinatorId?: string | null;
}

export class VacancyUpdateDto {
  @IsOptional() @IsIn(VACANCY_STATUSES as unknown as string[]) status?: Vacancy['status'];
  @IsOptional() @IsString() remarks?: string;
  /** "Specialization required", Direct HR vacancies only; a requisition vacancy uses its approved requisition's. */
  @IsOptional() @IsString() requiredEducation?: string | null;
  @IsOptional() @IsString() requiredSkills?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }, { message: 'Minimum experience must be a number of years.' }) @Min(0) @Max(60) requiredExperienceYears?: number | null;
  @IsOptional() @IsString() specialization?: string | null;
}

export class JobPostDto {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() deadline?: string | null;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() duties?: string;
  @IsOptional() @IsString() education?: string;
  @IsOptional() @IsString() requiredDegree?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5) minCgpa?: number | null;
  @IsOptional() @IsString() experienceRequirement?: string;
  @IsOptional() @IsString() cvCollection?: string;
  @IsOptional() @IsString() circularContent?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @IsString() @MaxLength(60) employmentType?: string | null;
  @IsOptional() @IsString() @MaxLength(100) jobShift?: string | null;
  @IsOptional() @IsString() @MaxLength(200) salary?: string | null;
  @IsOptional() @IsString() skills?: string | null;
  @IsOptional() @ValidateIf((o) => !!o.applyEmail) @IsEmail() applyEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(300) emailSubject?: string | null;
}

export class CircularFileQuery {
  @IsOptional() @IsIn(['pdf', 'txt']) format?: 'pdf' | 'txt';
  @IsOptional() @IsIn(['1']) download?: string;
}

export class JobPostStatusDto {
  @IsIn(JOBPOST_STATUSES as unknown as string[]) status: JobPost['status'];
}
