import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { ListQuery } from '../common/pagination';

export class ApplicationListQuery extends ListQuery {
  @IsOptional() @IsIn(['Pass', 'Fail', 'Review Required']) result?: string;
  @IsOptional() @IsIn(['score', 'cgpa', 'experience', 'name', 'institution', 'degree', 'received']) sort?: string;
  @IsOptional() @IsIn(['ASC', 'DESC']) dir?: 'ASC' | 'DESC';
  @IsOptional() @IsIn(['true', 'false']) shortlisted?: string;
  @IsOptional() @IsIn(['Pending', 'Selected', 'Not Selected', 'On Hold']) finalDecision?: string;
  @IsOptional() @IsIn(['true']) duplicate?: string;
}

export class ExportQuery {
  @IsOptional() @IsIn(['Pass', 'Fail', 'Review Required']) result?: string;
}

/** Corrections to extracted data. Empty string clears a value back to "missing". */
export class CorrectionDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @ValidateIf((o) => o.email !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsString() education?: string | null;
  @IsOptional() @IsString() degree?: string | null;
  @IsOptional() @IsString() specialization?: string | null;
  @IsOptional() @IsString() institution?: string | null;
  @IsOptional() @IsString() cgpaRaw?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5) cgpa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(60) totalExperienceYears?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(60) relevantExperienceYears?: number | null;
  @IsOptional() @IsString() lastPosition?: string | null;
  @IsOptional() @IsString() workplace?: string | null;
  @IsOptional() @IsString() skills?: string | null;
  @IsOptional() @IsString() address?: string | null;
  @IsOptional() @IsString() certifications?: string | null;
  @IsOptional() @IsString() previousJobs?: string | null;
  @IsOptional() @IsString() @MaxLength(60, { message: 'Expected salary can be at most 60 characters.' }) expectedSalary?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(14) @Max(80) age?: number | null;
}

export class RemarkDto {
  @IsString() @MinLength(1) @MaxLength(4000) text: string;
}

export class DuplicateDto {
  @IsIn(['MERGE', 'SEPARATE']) action: 'MERGE' | 'SEPARATE';
}

export class ShortlistDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) applicationIds: string[];
  @IsBoolean() shortlisted: boolean;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class DocumentQuery {
  @IsOptional() @IsIn(['1']) download?: string;
}

export class AssignDto {
  @IsUUID() vacancyId: string;
}

/** Bulk CV pack: merge the original CVs of the given applications into one PDF (owner, 2026-11-10). */
export class CvPackDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) applicationIds: string[];
}
