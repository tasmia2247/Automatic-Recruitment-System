import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { ALL_PERMISSIONS, P } from '../common/permissions';
import {
  CreateRoleDto, CreateUserDto, PermissionSettingDto, TemplateDto, UpdateRoleDto, UpdateUserDto,
} from './roles-permissions.dto';
import { RolesPermissionsService } from './roles-permissions.service';

enum SettingKind { permission = 'permission', module = 'module' }

/** Users & Roles administration (Super Admin): users, roles, the permission grid and permission templates. */
@Controller('admin')
@RequirePerm(P.USER_MANAGE)
export class RolesPermissionsController {
  constructor(private readonly svc: RolesPermissionsService) {}

  @Get('permissions')
  permissions() {
    return ALL_PERMISSIONS;
  }

  @Get('permission-matrix')
  matrix() {
    return this.svc.matrix();
  }

  @Get('users')
  users(@Query('deleted') deleted?: string) {
    return this.svc.users(deleted === 'true');
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto, @CurrentUser() me: AuthUser) {
    return this.svc.createUser(dto, me);
  }

  @Patch('users/:id')
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: AuthUser) {
    return this.svc.updateUser(id, dto, me);
  }

  @Delete('users/:id')
  deleteUser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.deleteUser(id, me);
  }

  @Post('users/:id/restore')
  @HttpCode(200)
  restoreUser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.restoreUser(id, me);
  }

  @Get('roles')
  roles() {
    return this.svc.rolesList();
  }

  @Post('roles')
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() me: AuthUser) {
    return this.svc.createRole(dto, me);
  }

  @Patch('roles/:id')
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto, @CurrentUser() me: AuthUser) {
    return this.svc.updateRole(id, dto, me);
  }

  @Delete('roles/:id')
  deleteRole(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.deleteRole(id, me);
  }

  @Put('permission-settings/:kind/:key')
  saveSetting(@Param('kind', new ParseEnumPipe(SettingKind)) kind: SettingKind, @Param('key') key: string, @Body() dto: PermissionSettingDto, @CurrentUser() me: AuthUser) {
    return this.svc.saveSetting(kind, key, dto, me);
  }

  @Delete('permission-settings/:kind/:key')
  resetSetting(@Param('kind', new ParseEnumPipe(SettingKind)) kind: SettingKind, @Param('key') key: string, @CurrentUser() me: AuthUser) {
    return this.svc.resetSetting(kind, key, me);
  }

  @Get('permission-templates')
  templates() {
    return this.svc.templates();
  }

  @Post('permission-templates')
  createTemplate(@Body() dto: TemplateDto, @CurrentUser() me: AuthUser) {
    return this.svc.saveTemplate(null, dto, me);
  }

  @Put('permission-templates/:id')
  updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TemplateDto, @CurrentUser() me: AuthUser) {
    return this.svc.saveTemplate(id, dto, me);
  }

  @Delete('permission-templates/:id')
  deleteTemplate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.deleteTemplate(id, me);
  }
}
