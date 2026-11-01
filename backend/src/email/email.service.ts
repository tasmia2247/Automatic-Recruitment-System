import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as nodemailer from 'nodemailer';
import * as path from 'path';
import { DataSource, In } from 'typeorm';
import { config } from '../config';
import { AuthUser } from '../common/auth';
import { assertApplicationsAccess, coordinatorScope } from '../common/scope';
import { AuditService, diff } from '../common/services';
import {
  Application, CandidateStage, EmailBatch, EmailEvent, EmailTemplate, EmailTemplateVersion, JoiningRecord, TemplateKind,
} from '../database/entities';
import { JobsService, RetryableError } from '../processing/jobs.service';
import { ComposeDto, HistoryQuery, SendDto, TemplateDto } from './email.dto';

/** Placeholders available in templates. Values come from ARS records or the sender's per-send variables. */
export const PLACEHOLDERS = [
  'candidateName', 'candidateId', 'applicationId', 'position', 'department', 'company', 'vacancyId',
  'interviewDate', 'interviewTime', 'location', 'instructions', 'result', 'joiningDate', 'reportingTime', 'contactPerson',
] as const;

export const TOKEN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export function placeholdersIn(text: string) {
  return [...text.matchAll(TOKEN)].map((m) => m[1]);
}

export function render(text: string, vars: Record<string, string | null | undefined>) {
  const missing = new Set<string>();
  const out = text.replace(TOKEN, (_, k) => {
    const v = vars[k];
    if (v === null || v === undefined || v === '') { missing.add(k); return `{{${k}}}`; }
    return v;
  });
  return { out, missing: [...missing] };
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger('Email');
  private transporter: nodemailer.Transporter | null = config.smtp.host
    ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
    : null;

  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly audit: AuditService, private readonly jobs: JobsService) {}

  onModuleInit() {
    this.jobs.register('EMAIL_SEND', (job) => this.deliver(job.refId));
    if (!this.transporter) this.logger.warn('SMTP_HOST not set: emails go to the dev outbox (storage/outbox) and are NOT delivered.');
  }

  get transportName() {
    return this.transporter ? 'smtp' : 'dev-outbox';
  }

  // ------------------------------------------------------------------ templates

  async templates(kind?: string) {
    return this.ds.getRepository(EmailTemplate).find({ where: kind ? { kind: kind as TemplateKind } : {}, order: { kind: 'ASC', name: 'ASC' } });
  }

  private checkPlaceholders(dto: { subject: string; body: string }) {
    const unknown = [...new Set(placeholdersIn(dto.subject + dto.body))].filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
    if (unknown.length) throw new BadRequestException(`Unknown placeholder(s): ${unknown.map((u) => `{{${u}}}`).join(', ')}. Allowed: ${PLACEHOLDERS.join(', ')}`);
  }

  async saveTemplate(id: string | null, dto: TemplateDto, me: AuthUser) {
    this.checkPlaceholders(dto);
    return this.ds.transaction(async (m) => {
      let t = id ? await m.findOne(EmailTemplate, { where: { id }, lock: { mode: 'pessimistic_write' } }) : null;
      if (id && !t) throw new NotFoundException();
      const before = t ? { ...t } : {};
      if (!t) t = m.create(EmailTemplate, { ...dto, version: 1, updatedById: me.id });
      else {
        const contentChanged = t.subject !== dto.subject || t.body !== dto.body;
        Object.assign(t, dto, { updatedById: me.id });
        if (contentChanged) t.version += 1;
      }
      await m.save(t);
      if (!(await m.exists(EmailTemplateVersion, { where: { templateId: t.id, version: t.version } }))) {
        await m.insert(EmailTemplateVersion, { templateId: t.id, version: t.version, subject: t.subject, body: t.body, createdById: me.id });
      }
      const d = diff(before, t, ['name', 'kind', 'subject', 'body', 'active', 'version']);
      await this.audit.log(m, me, id ? 'template.update' : 'template.create', 'EmailTemplate', t.id, { label: t.name, old: d.old, new: d.new });
      return t;
    });
  }

  // ------------------------------------------------------------------ compose / preview / send

  private async contexts(applicationIds: string[], extra: Record<string, string> = {}) {
    const apps = await this.ds.getRepository(Application).find({
      where: { id: In(applicationIds) }, relations: { candidate: true, vacancy: { department: true, company: true } },
    });
    const stages = await this.ds.getRepository(CandidateStage).find({ where: { applicationId: In(applicationIds) } });
    const joins = await this.ds.getRepository(JoiningRecord).find({ where: { applicationId: In(applicationIds) } });
    return applicationIds.map((id) => {
      const a = apps.find((x) => x.id === id);
      if (!a) return { applicationId: id, app: null, vars: {} as Record<string, string> };
      const st = stages.filter((s) => s.applicationId === id && s.scheduledAt).sort((x, y) => +y.updatedAt - +x.updatedAt)[0];
      const j = joins.find((x) => x.applicationId === id);
      const when = st?.scheduledAt ? new Date(st.scheduledAt) : null;
      const vars: Record<string, string> = {
        candidateName: a.candidate.name ?? '', candidateId: a.candidate.candidateNo, applicationId: a.applicationNo,
        position: a.vacancy.positionTitle, department: a.vacancy.department?.name ?? '', company: a.vacancy.company?.name ?? '',
        vacancyId: a.vacancy.vacancyNo, result: a.finalDecision !== 'Pending' ? a.finalDecision : '',
        interviewDate: when ? when.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '',
        interviewTime: when ? when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka' }) : '',
        location: st?.location ?? '', joiningDate: j?.joiningDate ? new Date(j.joiningDate).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '',
        // Per-send variables entered by HR override record defaults only where provided.
        ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== '')),
      };
      return { applicationId: id, app: a, vars };
    });
  }

  async preview(dto: ComposeDto) {
    this.checkPlaceholders(dto);
    const ctx = await this.contexts(dto.applicationIds, dto.variables);
    return ctx.map(({ applicationId, app, vars }) => {
      const errors: string[] = [];
      if (!app) errors.push('Application not found.');
      const email = app?.candidate.email ?? null;
      if (app && !email) errors.push('Candidate has no usable email address.');
      else if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`Email "${email}" is not valid.`);
      const s = render(dto.subject, vars);
      const b = render(dto.body, vars);
      const missing = [...new Set([...s.missing, ...b.missing])];
      if (missing.length) errors.push(`Missing value for: ${missing.join(', ')}`);
      return { applicationId, applicationNo: app?.applicationNo, candidateName: app?.candidate.name, recipient: email, subject: s.out, body: b.out, ok: !errors.length, errors };
    });
  }

  /** One separate email per candidate (never shared To/CC). Recipients with errors are skipped and reported. */
  async send(dto: SendDto, me: AuthUser) {
    const existing = await this.ds.getRepository(EmailBatch).findOne({ where: { clientKey: dto.clientKey } });
    if (existing) return { batchId: existing.id, duplicate: true, results: await this.batchResults(existing.id) };
    const previews = await this.preview(dto);
    const valid = previews.filter((p) => p.ok);
    const template = dto.templateId ? await this.ds.getRepository(EmailTemplate).findOne({ where: { id: dto.templateId } }) : null;
    const batchId = await this.ds.transaction(async (m) => {
      const first = valid[0] ?? previews[0];
      const vacancyId = first ? (await m.findOne(Application, { where: { id: first.applicationId } }))?.vacancyId ?? null : null;
      const batch = await m.save(EmailBatch, m.create(EmailBatch, {
        clientKey: dto.clientKey, kind: dto.kind, templateId: template?.id ?? null, templateVersion: template?.version ?? null,
        vacancyId, createdById: me.id, total: valid.length,
      }));
      for (const p of valid) {
        const ev = await m.save(EmailEvent, m.create(EmailEvent, {
          batchId: batch.id, applicationId: p.applicationId, kind: dto.kind, recipient: p.recipient!, subject: p.subject, body: p.body,
          templateId: template?.id ?? null, templateVersion: template?.version ?? null, status: 'Queued', createdById: me.id,
        }));
        await this.jobs.enqueue(m, 'EMAIL_SEND', ev.id, `${p.applicationNo} ${dto.kind}`);
      }
      await this.audit.log(m, me, 'email.send_batch', 'EmailBatch', batch.id, { new: { kind: dto.kind, queued: valid.length, skipped: previews.length - valid.length, template: template?.name } });
      return batch.id;
    });
    const results = previews.map((p) => ({ applicationId: p.applicationId, applicationNo: p.applicationNo, recipient: p.recipient, status: p.ok ? 'Queued' : 'Skipped', errors: p.errors }));
    return { batchId, duplicate: false, transport: this.transportName, results };
  }

  private async batchResults(batchId: string) {
    const evs = await this.ds.getRepository(EmailEvent).find({ where: { batchId } });
    return evs.map((e) => ({ applicationId: e.applicationId, recipient: e.recipient, status: e.status, errors: e.error ? [e.error] : [] }));
  }

  /** Worker handler. Idempotent: an already-sent event is never sent again (SRS 12.4). */
  async deliver(eventId: string) {
    const ev = await this.ds.getRepository(EmailEvent).findOne({ where: { id: eventId } });
    if (!ev) throw new Error('Email event not found.');
    if (ev.status === 'Sent') return { status: 'Completed' as const, note: 'Already sent; skipped.' };
    await this.ds.getRepository(EmailEvent).update(ev.id, { attempts: ev.attempts + 1 });
    try {
      let providerRef: string;
      if (this.transporter) {
        const info = await this.transporter.sendMail({ from: config.smtp.from, to: ev.recipient, subject: ev.subject, text: ev.body });
        providerRef = info.messageId;
      } else {
        const dir = path.join(config.storageDir, 'outbox');
        fs.mkdirSync(dir, { recursive: true });
        providerRef = `${ev.id}.eml`;
        fs.writeFileSync(path.join(dir, providerRef), `From: ${config.smtp.from}\r\nTo: ${ev.recipient}\r\nSubject: ${ev.subject}\r\nX-ARS-Event: ${ev.id}\r\n\r\n${ev.body}`);
      }
      await this.ds.transaction(async (m) => {
        await m.update(EmailEvent, ev.id, { status: 'Sent', transport: this.transportName, providerRef, error: null, sentAt: new Date() });
        // A sent joining letter updates only the letter status, never the joining approval (SRS 14.2).
        if (ev.kind === 'JOINING_LETTER') await m.update(JoiningRecord, { applicationId: ev.applicationId }, { letterStatus: 'Sent' });
        await this.audit.log(m, null, 'email.sent', 'Application', ev.applicationId, { new: { kind: ev.kind, recipient: ev.recipient, transport: this.transportName } });
      });
      return undefined;
    } catch (e: any) {
      await this.ds.getRepository(EmailEvent).update(ev.id, { status: 'Failed', error: String(e.message).slice(0, 1000) });
      await this.audit.log(this.ds.manager, null, 'email.failed', 'Application', ev.applicationId, { new: { kind: ev.kind, recipient: ev.recipient, error: e.message } });
      const transient = /ECONN|ETIMEDOUT|EAI_AGAIN|421|450|451/.test(String(e.code ?? e.message));
      throw transient ? new RetryableError(e.message) : e;
    }
  }

  /** Coordinators may only email candidates of the vacancies they coordinate. */
  assertRecipients(applicationIds: string[], me: AuthUser) {
    return assertApplicationsAccess(this.ds, me, applicationIds);
  }

  /** Retry only failed sends (SRS 12.4). */
  async retry(eventId: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const ev = await m.findOne(EmailEvent, { where: { id: eventId }, lock: { mode: 'pessimistic_write' } });
      if (!ev) throw new NotFoundException();
      await assertApplicationsAccess(m, me, [ev.applicationId]);
      if (ev.status !== 'Failed') throw new ConflictException(`Only failed emails can be retried (this one is ${ev.status}).`);
      ev.status = 'Queued';
      await m.save(ev);
      await this.jobs.enqueue(m, 'EMAIL_SEND', ev.id, `retry ${ev.kind}`);
      await this.audit.log(m, me, 'email.retry', 'Application', ev.applicationId, { new: { recipient: ev.recipient } });
      return ev;
    });
  }

  async history(q: HistoryQuery, me: AuthUser) {
    const qb = this.ds.getRepository(EmailEvent).createQueryBuilder('e')
      .leftJoin(Application, 'a', 'a.id = e.applicationId').leftJoin('a.candidate', 'c')
      .addSelect(['a.applicationNo', 'c.name']).orderBy('e.createdAt', 'DESC').take(500);
    const scope = coordinatorScope(me);
    if (scope) qb.innerJoin('vacancies', 'v', 'v.id = a.vacancyId AND v.coordinatorId = :me', { me: scope });
    if (q.vacancyId) qb.andWhere('a.vacancyId = :v', { v: q.vacancyId });
    if (q.status) qb.andWhere('e.status = :s', { s: q.status });
    if (q.kind) qb.andWhere('e.kind = :k', { k: q.kind });
    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((e, i) => {
      const { body, ...rest } = e;
      return { ...rest, applicationNo: raw[i]?.a_applicationNo, candidateName: raw[i]?.c_name };
    });
  }
}
