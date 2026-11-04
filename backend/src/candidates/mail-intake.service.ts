import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import * as fs from 'fs';
import { simpleParser } from 'mailparser';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth';
import { AuditService, StorageService, validateUpload } from '../common/services';
import { config } from '../config';
import { IntakeMessage, Vacancy } from '../database/entities';
import { CandidatesService } from './candidates.service';
import { matchSubject, OpenJob } from './subject-match';

const PROCESSED = 'processed';
const FAILED = 'failed';
const MAX_PER_SCAN = 200;
export const MAX_MAIL_BYTES = 50 * 1024 * 1024;
export const MAX_MAILS_PER_UPLOAD = 25;

const isMailFile = (name: string) => name.toLowerCase().endsWith('.eml');

export interface ScannedMail {
  file: string;
  subject: string | null;
  outcome: 'Added' | 'Unmatched' | 'Duplicate' | 'Failed';
  vacancyNo?: string;
  jobNo?: string;
  cvsAdded: number;
  reason?: string;
}

/** Reads saved .eml files and routes each one by its subject: from the server's mail folder, or a folder a user picks in the browser. */
@Injectable()
export class MailIntakeService {
  private scanning = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly candidates: CandidatesService,
  ) {
    fs.mkdirSync(config.mailIntakeDir, { recursive: true });
  }

  /** Files waiting in the folder. Only top-level files count; processed/ and failed/ hold finished mails. */
  private pending() {
    const files = fs.readdirSync(config.mailIntakeDir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort();
    return { mails: files.filter(isMailFile), others: files.filter((f) => !isMailFile(f)) };
  }

  folder() {
    const { mails, others } = this.pending();
    return { pending: mails.length, unsupported: others };
  }

  private openJobs(): Promise<OpenJob[]> {
    return this.ds.query(
      `SELECT jp.id AS "jobPostId", jp."jobNo", jp.title, jp."emailSubject", v.id AS "vacancyId", v."vacancyNo",
              d.name AS department, d.code AS "departmentCode", c.name AS company, c.code AS "companyCode"
         FROM job_posts jp
         JOIN vacancies v ON v.id = jp."vacancyId"
         JOIN departments d ON d.id = v."departmentId"
         JOIN companies c ON c.id = v."companyId"
        WHERE jp.status = 'Published' AND v.status NOT IN ('Closed', 'Filled')`);
  }

  /** Scans the server's mail folder; each finished file moves to processed/ or failed/. */
  scanFolder(me: AuthUser) {
    return this.run(me, 'server folder', async (jobs) => {
      const { mails, others } = this.pending();
      const batch = mails.slice(0, MAX_PER_SCAN);
      const items: ScannedMail[] = [];
      for (const file of batch) {
        // One bad mail must not stop the rest; it stays in the folder and shows in the result.
        items.push(await this.processFile(file, jobs, me).catch((e: any) => this.errored(file, e)));
      }
      return { items, remaining: mails.length - batch.length, unsupported: others };
    });
  }

  /** Scans mail files from a folder the user picked in the browser. Those files stay where they are on the user's PC. */
  scanFiles(files: Express.Multer.File[], me: AuthUser) {
    if (!files?.length) throw new BadRequestException('Select a folder that has .eml mail files.');
    return this.run(me, 'selected folder', async (jobs) => {
      const items: ScannedMail[] = [];
      for (const f of files.filter((x) => isMailFile(x.originalname))) {
        items.push(await this.processMail(f.originalname, f.buffer, new Date(), jobs, me).catch((e: any) => this.errored(f.originalname, e)));
      }
      return { items, remaining: 0, unsupported: files.filter((x) => !isMailFile(x.originalname)).map((x) => x.originalname) };
    });
  }

  private errored(file: string, e: any): ScannedMail {
    return { file, subject: null, outcome: 'Failed', cvsAdded: 0, reason: e?.message ?? 'Unknown error.' };
  }

  private async run(me: AuthUser, source: string, work: (jobs: OpenJob[]) => Promise<{ items: ScannedMail[]; remaining: number; unsupported: string[] }>) {
    if (this.scanning) throw new ConflictException('A mail scan is already running.');
    this.scanning = true;
    try {
      const { items, remaining, unsupported } = await work(await this.openJobs());
      const count = (o: ScannedMail['outcome']) => items.filter((i) => i.outcome === o).length;
      const summary = {
        scanned: items.length, added: count('Added'), unmatched: count('Unmatched'), duplicates: count('Duplicate'), failed: count('Failed'),
        cvsAdded: items.reduce((s, i) => s + i.cvsAdded, 0), remaining, unsupported,
      };
      await this.audit.log(this.ds.manager, me, 'intake.scan', 'IntakeMessage', null, { new: { ...summary, source, unsupported: unsupported.length } });
      return { ...summary, items };
    } finally {
      this.scanning = false;
    }
  }

  private async processFile(file: string, jobs: OpenJob[], me: AuthUser): Promise<ScannedMail> {
    const full = path.join(config.mailIntakeDir, file);
    const stat = fs.statSync(full);
    if (stat.size > MAX_MAIL_BYTES) {
      this.move(file, FAILED);
      return { file, subject: null, outcome: 'Failed', cvsAdded: 0, reason: `The mail file is larger than ${MAX_MAIL_BYTES / 1024 / 1024} MB.` };
    }
    const result = await this.processMail(file, fs.readFileSync(full), stat.mtime, jobs, me);
    this.move(file, result.subject === null && result.outcome === 'Failed' ? FAILED : PROCESSED);
    return result;
  }

  private async processMail(file: string, raw: Buffer, fileDate: Date, jobs: OpenJob[], me: AuthUser): Promise<ScannedMail> {
    const parsed = await simpleParser(raw).catch(() => null);
    if (!parsed || !['from', 'subject', 'message-id'].some((h) => parsed.headers.has(h))) {
      return { file, subject: null, outcome: 'Failed', cvsAdded: 0, reason: 'This file is not a readable mail.' };
    }

    const subject = parsed.subject?.trim() || '';
    // The sha256 fallback keeps a re-saved copy of a mail without a Message-ID from being imported twice.
    const messageId = (parsed.messageId?.trim() || `sha256:${createHash('sha256').update(raw).digest('hex')}`).slice(0, 300);
    const repo = this.ds.getRepository(IntakeMessage);
    if (await repo.exists({ where: { messageId } })) {
      return { file, subject, outcome: 'Duplicate', cvsAdded: 0, reason: 'This mail was already scanned.' };
    }

    const rejected: string[] = [];
    const attachments: IntakeMessage['attachments'] = [];
    for (const a of parsed.attachments ?? []) {
      const name = a.filename ?? '';
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!name || !config.allowedCvExtensions.includes(ext)) continue; // logos, photos and signatures are not CVs
      const err = validateUpload({ originalname: name, size: a.size ?? a.content.length, buffer: a.content } as Express.Multer.File);
      if (err) { rejected.push(`${name}: ${err}`); continue; }
      attachments.push(this.storage.save(a.content, name, a.contentType, 'intake'));
    }

    const msg = repo.create({
      messageId, subject: subject.slice(0, 500) || null, sender: parsed.from?.text?.slice(0, 200) ?? null, receivedAt: parsed.date ?? fileDate, status: 'Unmatched', vacancyId: null, attachments,
      error: rejected.length ? rejected.join(' ') : null,
    });

    if (!attachments.length) {
      msg.status = 'Failed';
      msg.error = msg.error ?? 'The mail has no CV attachment.';
      await repo.save(msg);
      return { file, subject, outcome: 'Failed', cvsAdded: 0, reason: msg.error };
    }

    const match = matchSubject(subject, jobs);
    if (!match.job) {
      msg.error = [match.reason, msg.error].filter(Boolean).join(' ');
      await repo.save(msg);
      return { file, subject, outcome: 'Unmatched', cvsAdded: 0, reason: match.reason };
    }

    await repo.save(msg);
    const vacancy = await this.ds.getRepository(Vacancy).findOneOrFail({ where: { id: match.job.vacancyId } });
    await this.candidates.assignAttachments(msg, vacancy, me);
    const cvsAdded = msg.attachments.filter((a) => a.applicationId).length;
    const problems = msg.attachments.filter((a) => a.error).map((a) => `${a.originalName}: ${a.error}`);
    return {
      file, subject, outcome: msg.status === 'Assigned' ? 'Added' : 'Failed', vacancyNo: match.job.vacancyNo, jobNo: match.job.jobNo, cvsAdded,
      reason: problems.length ? problems.join(' ') : undefined,
    };
  }

  /** Scanned mails are kept, never deleted, under processed/ or failed/ by month. */
  private move(file: string, folder: string) {
    const dir = path.join(config.mailIntakeDir, folder, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(path.join(config.mailIntakeDir, file), path.join(dir, `${Date.now()}-${file}`));
  }
}
