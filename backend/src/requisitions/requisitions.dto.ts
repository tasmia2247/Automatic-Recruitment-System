import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsNumber, Max, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { ListQuery } from '../common/pagination';

/** Form No. 01 fields. Everything is optional for a draft; submit-time rules live in validateForSubmit(). */
export class RequisitionDto {
  @IsUUID() departmentId: string;
  @IsUUID() companyId: string;
  @IsOptional() @IsDateString() requestDate?: string;
  @IsOptional() @IsUUID() positionId?: string | null;
  @IsOptional() @IsString() @MaxLength(160) rank?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1, { message: 'How many must be greater than zero.' }) headcount?: number | null;
  @IsOptional() @IsBoolean() replacePlan?: boolean;
  @IsOptional() @IsString() @MaxLength(160) replacementEmployeeName?: string | null;
  @IsOptional() @IsString() @MaxLength(60) replacementEmployeeId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) terminationReference?: string | null;
  @IsOptional() @IsString() minEducation?: string | null;
  @IsOptional() @IsString() experience?: string | null;
  @IsOptional() @IsString() @MaxLength(100) salaryPresent?: string | null;
  @IsOptional() @IsString() @MaxLength(100) salaryProposed?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) currentQuotaDept?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) currentQuotaDesig?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) revisedQuotaDept?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) revisedQuotaDesig?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) presentManpowerDept?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) presentManpowerDesig?: number | null;
  /** Manual vacancy values are only accepted together with an override reason. */
  @IsOptional() @Type(() => Number) @IsInt() vacancyDept?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() vacancyDesig?: number | null;
  @IsOptional() @IsString() vacancyOverrideReason?: string | null;
  @IsOptional() @IsBoolean() seatsAvailable?: boolean | null;
  @IsOptional() @Type(() => Number) @IsIn([30, 60], { message: 'Deadline must be 30 or 60 days.' }) deadlineDays?: number | null;
  @IsOptional() @IsIn(['Male', 'Female', 'Any']) gender?: 'Male' | 'Female' | 'Any' | null;
  /** "Specialization required" (what CVs are screened against); `specialization` is "Other requirements". */
  @IsOptional() @IsString() requiredEducation?: string | null;
  @IsOptional() @IsString() requiredSkills?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }, { message: 'Minimum experience must be a number of years.' }) @Min(0) @Max(60) requiredExperienceYears?: number | null;
  @IsOptional() @IsString() specialization?: string | null;
  @IsOptional() @IsString() jobDescription?: string | null;
  @IsOptional() @IsString() background?: string | null;
}

export class RequisitionListQuery extends ListQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsIn(['mine', 'all']) view?: 'mine' | 'all';
}

export class DecisionDto {
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  /** The approval step being decided; makes a repeated click a no-op even when the next step is the same user's. */
  @IsOptional() @IsUUID() actionId?: string;
}

export class ReasonDto {
  @IsString() @MinLength(3, { message: 'A reason/comment of at least 3 characters is required.' }) @MaxLength(2000)
  reason: string;
}

export class StepReasonDto extends ReasonDto {
  @IsOptional() @IsUUID() actionId?: string;
}

export class CorporateHrDto {
  @IsOptional() @IsString() corporateHrRemarks?: string;
  @IsOptional() @IsIn(['Yes', 'No', 'Not Applicable']) insertedInQuotaChart?: 'Yes' | 'No' | 'Not Applicable';
}

export class RouteStepDto {
  @Type(() => Number) @IsInt() @Min(1) stepOrder: number;
  @IsString() @Length(1, 80) label: string;
  @IsUUID() approverUserId: string;
  @IsOptional() @IsBoolean() required?: boolean;
}

export class ApprovalRouteDto {
  @IsString() @Length(1, 160) name: string;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RouteStepDto) steps: RouteStepDto[];
}

export class AttachmentQuery {
  @IsOptional() @IsIn(['TERMINATION_REQUEST', 'SIGNATURE', 'OTHER']) kind?: 'TERMINATION_REQUEST' | 'SIGNATURE' | 'OTHER';
}
