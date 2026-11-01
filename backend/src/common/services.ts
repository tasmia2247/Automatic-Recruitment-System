import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EntityManager } from 'typeorm';
import { config } from '../config';
import { AuditEvent, Notification } from '../database/entities';
import { AuthUser } from './auth';

/** Generates human-readable display IDs from configurable formats (SRS 2.1). */
@Injectable()
export class IdService {
  async next(manager: EntityManager, kind: keyof typeof config.idFormats | string): Promise<string> {
    const format = config.idFormats[kind];
    if (!format) throw new Error(`No ID format configured for ${kind}`);
    const year = String(new Date().getFullYear());
    const key = format.includes('{YYYY}') ? `${kind}:${year}` : kind;
    const rows: { value: number }[] = await manager.query(
      `INSERT INTO id_counters ("key", "value") VALUES ($1, 1)
       ON CONFLICT ("key") DO UPDATE SET "value" = id_counters."value" + 1 RETURNING "value"`,
      [key],
    );
    const seq = rows[0].value;
    return format.replace('{YYYY}', year).replace(/\{SEQ:(\d+)\}/, (_, n) => String(seq).padStart(Number(n), '0'));
  }
}

/** Append-only audit trail. Always call with the transaction's manager so audit and change commit together. */
@Injectable()
export class AuditService {
  async log(
    manager: EntityManager,
    actor: AuthUser | null,
    action: string,
    entityType: string,
    entityId: string | null,
    opts: { label?: string | null; old?: Record<string, unknown> | null; new?: Record<string, unknown> | null } = {},
  ) {
    await manager.insert(AuditEvent, {
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? 'System',
      action, entityType, entityId,
      entityLabel: opts.label ?? null,
      oldValues: (opts.old ?? null) as any,
      newValues: (opts.new ?? null) as any,
    });
  }
}

/** Return only the keys whose values differ, for compact old/new audit payloads. */
export function diff(before: Record<string, any>, after: Record<string, any>, keys?: string[]) {
  const old: Record<string, unknown> = {};
  const neu: Record<string, unknown> = {};
  for (const k of keys ?? Object.keys(after)) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) { old[k] = a; neu[k] = b; }
  }
  return { old, new: neu, changed: Object.keys(neu) };
}

@Injectable()
export class NotificationService {
  async notify(manager: EntityManager, userIds: (string | null | undefined)[], event: string, title: string, link?: string, body?: string) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    await manager.insert(Notification, ids.map((userId) => ({ userId, event, title, link: link ?? null, body: body ?? null })));
  }

  /** Users holding a permission (via role or override), e.g. all HR users for "new approved requisition". */
  async usersWithPermission(manager: EntityManager, perm: string): Promise<string[]> {
    const rows: { id: string }[] = await manager.query(
      `SELECT DISTINCT u.id FROM users u
         LEFT JOIN user_roles ur ON ur."userId" = u.id
         LEFT JOIN roles r ON r.id = ur."roleId" AND r.active
        WHERE u.active AND NOT ($1 = ANY(u."deniedPermissions"))
          AND ($1 = ANY(r.permissions) OR $1 = ANY(u."extraPermissions"))`,
      [perm],
    );
    return rows.map((r) => r.id);
  }
}

export interface StoredFile { storageKey: string; originalName: string; mimeType: string; size: number; sha256: string }

/** Private file storage on local disk; files are only served through authorized endpoints (NFR-03). */
@Injectable()
export class StorageService {
  constructor() {
    fs.mkdirSync(config.storageDir, { recursive: true });
  }

  save(buffer: Buffer, originalName: string, mimeType: string, folder: string): StoredFile {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const storageKey = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
    const full = this.resolve(storageKey);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return { storageKey, originalName: path.basename(originalName), mimeType: mimeType || 'application/octet-stream', size: buffer.length, sha256 };
  }

  read(storageKey: string): Buffer {
    const full = this.resolve(storageKey);
    if (!fs.existsSync(full)) throw new NotFoundException('Stored file not found.');
    return fs.readFileSync(full);
  }

  resolve(storageKey: string) {
    const full = path.resolve(config.storageDir, storageKey);
    if (!full.startsWith(path.resolve(config.storageDir))) throw new BadRequestException('Invalid storage key.');
    return full;
  }
}

/** Validates an uploaded file's extension, size and basic content signature (NFR-04). */
export function validateUpload(file: Express.Multer.File, allowed = config.allowedCvExtensions): string | null {
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!allowed.includes(ext)) return `Unsupported file type ".${ext}". Allowed: ${allowed.join(', ')}.`;
  if (file.size === 0) return 'File is empty.';
  if (file.size > config.maxUploadBytes) return `File exceeds ${config.maxUploadBytes / 1024 / 1024} MB limit.`;
  const head = file.buffer.subarray(0, 4);
  if (ext === 'pdf' && head.toString('latin1') !== '%PDF') return 'File content is not a valid PDF.';
  if ((ext === 'docx' || ext === 'xlsx') && !(head[0] === 0x50 && head[1] === 0x4b)) return `File content is not a valid .${ext} document.`;
  return null;
}

export function normalizeEmail(e?: string | null) {
  return e ? e.trim().toLowerCase() : null;
}

/** Bangladesh-friendly phone normalization: keep the last 10 national digits (01XXXXXXXXX -> 1XXXXXXXXX). */
export function normalizePhone(p?: string | null) {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d || null;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
