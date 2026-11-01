import { Type } from 'class-transformer';
import {
  ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength,
  MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { ALL_PERMISSIONS } from '../common/permissions';

export class ScopeDto {
  @IsIn(['own', 'all', 'custom']) mode: 'own' | 'all' | 'custom';
  @ValidateIf((o) => o.mode === 'custom')
  @IsArray() @ArrayMinSize(1, { message: 'Choose at least one department for Custom Departments.' }) @IsUUID('all', { each: true })
  departmentIds?: string[];
}

/** Access Scope per department-owned module; a module left out follows the role default. */
export class DepartmentScopesDto {
  @IsOptional() @ValidateNested() @Type(() => ScopeDto) dashboard?: ScopeDto;
  @IsOptional() @ValidateNested() @Type(() => ScopeDto) quotas?: ScopeDto;
  @IsOptional() @ValidateNested() @Type(() => ScopeDto) requisitions?: ScopeDto;
  @IsOptional() @ValidateNested() @Type(() => ScopeDto) joining?: ScopeDto;
}

export class CreateUserDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsArray() @ArrayUnique() @IsString({ each: true }) roleCodes: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) roleCodes?: string[];
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true }) extraPermissions?: string[];
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true }) deniedPermissions?: string[];
  @IsOptional() @ValidateNested() @Type(() => DepartmentScopesDto) departmentScopes?: DepartmentScopesDto;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

export class CreateRoleDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,59}$/, { message: 'Code: capital letters, digits and _ (e.g. HR_ASSISTANT).' }) code: string;
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true }) permissions: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true }) permissions?: string[];
}

export class PermissionSettingDto {
  @IsOptional() @IsString() @MaxLength(120) label?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() disabled?: boolean;
}

export class TemplateDto {
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true }) permissions: string[];
  @IsOptional() @ValidateNested() @Type(() => DepartmentScopesDto) departmentScopes?: DepartmentScopesDto;
}
