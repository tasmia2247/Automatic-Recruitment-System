import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { ComposeDto, HistoryQuery, SendDto, TemplateDto } from './email.dto';
import { EmailService, PLACEHOLDERS } from './email.service';

@Controller('email')
export class EmailController {
  constructor(private readonly svc: EmailService) {}

  @Get('placeholders')
  placeholders() {
    return { placeholders: PLACEHOLDERS, transport: this.svc.transportName };
  }

  @Get('templates')
  @RequirePerm(P.EMAIL_SEND)
  templates(@Query('kind') kind?: string) {
    return this.svc.templates(kind);
  }

  @Post('templates')
  @RequirePerm(P.TEMPLATE_MANAGE)
  create(@Body() dto: TemplateDto, @CurrentUser() me: AuthUser) {
    return this.svc.saveTemplate(null, dto, me);
  }

  @Put('templates/:id')
  @RequirePerm(P.TEMPLATE_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TemplateDto, @CurrentUser() me: AuthUser) {
    return this.svc.saveTemplate(id, dto, me);
  }

  @Delete('templates/:id')
  @RequirePerm(P.TEMPLATE_MANAGE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.deleteTemplate(id, me);
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePerm(P.EMAIL_SEND)
  async preview(@Body() dto: ComposeDto, @CurrentUser() me: AuthUser) {
    await this.svc.assertRecipients(dto.applicationIds, me);
    return this.svc.preview(dto);
  }

  @Post('send')
  @HttpCode(200)
  @RequirePerm(P.EMAIL_SEND)
  async send(@Body() dto: SendDto, @CurrentUser() me: AuthUser) {
    await this.svc.assertRecipients(dto.applicationIds, me);
    return this.svc.send(dto, me);
  }

  @Post('events/:id/retry')
  @HttpCode(200)
  @RequirePerm(P.EMAIL_SEND)
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.retry(id, me);
  }

  @Get('history')
  @RequirePerm(P.EMAIL_SEND)
  history(@Query() q: HistoryQuery, @CurrentUser() me: AuthUser) {
    return this.svc.history(q, me);
  }
}
