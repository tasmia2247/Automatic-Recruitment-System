import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { DataSource, In } from 'typeorm';
import { AuthUser } from '../common/auth';
import { P } from '../common/permissions';
import { coordinatorScope } from '../common/scope';
import { AuditService, diff, IdService, NotificationService } from '../common/services';
import {
  Application, CandidateStage, DecisionStatus, EvaluationMark, ImportBatch, ImportRow, JoiningRecord, StageType, Vacancy,
} from '../database/entities';

export const STAGE_LABEL: Record<StageType, string> = { WRITTEN: 'Written Exam', INTERVIEW: 'Interview Board', OPTIONAL: 'Optional Exam' };
/** One slot for both: the same date, time, venue, panel, duration and attendance; marks and results stay per exam. */
export const MAIN_DAY: StageType[] = ['WRITTEN', 'INTERVIEW'];
const SHARED = ['scheduledAt', 'location', 'panel', 'durationMinutes', 'attendance'] as const;

@Injectable()
export class EvaluationService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ids: IdService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
  ) {}

  /** Vacancy-wise interview/exam list (SRS 13.2): shortlisted applications plus any with stage records. */
  async board(vacancyId: string) {
    const vacancy = await this.ds.getRepository(Vacancy).findOne({ where: { id: vacancyId }, relations: { department: true } });
    if (!vacancy) throw new NotFoundException('Vacancy not found.');
    const apps = await this.ds.getRepository(Application).createQueryBuilder('a').innerJoinAndSelect('a.candidate', 'c')
      .where('a.vacancyId = :v', { v: vacancyId })
      .andWhere('(a.shortlisted = true OR EXISTS (SELECT 1 FROM candidate_stages s WHERE s."applicationId" = a.id))')
      .orderBy('c.name', 'ASC').getMany();
    const ids = apps.map((a) => a.id);
    const [stages, marks, joins] = ids.length ? await Promise.all([
      this.ds.getRepository(CandidateStage).find({ where: { applicationId: In(ids) } }),
      this.ds.getRepository(EvaluationMark).find({ where: { applicationId: In(ids) }, relations: { evaluator: true } }),
      this.ds.getRepository(JoiningRecord).find({ where: { applicationId: In(ids) } }),
    ]) : [[], [], []];
    return {
      vacancy: { id: vacancy.id, vacancyNo: vacancy.vacancyNo, positionTitle: vacancy.positionTitle, department: vacancy.department?.name, headcount: vacancy.headcount },
      rows: apps.map((a) => ({
        applicationId: a.id, applicationNo: a.applicationNo, candidateNo: a.candidate.candidateNo, name: a.candidate.name,
        email: a.candidate.email, phone: a.candidate.phone, screeningResult: a.screeningResult, shortlisted: a.shortlisted,
        finalDecision: a.finalDecision, finalDecisionRemarks: a.finalDecisionRemarks, expectedSalary: a.expectedSalary,
        stages: Object.fromEntries(stages.filter((s) => s.applicationId === a.id).map((s) => [s.stageType, s])),
        marks: marks.filter((mk) => mk.applicationId === a.id).map((mk) => ({ ...mk, evaluator: { name: mk.evaluator.name } })),
        joining: joins.find((j) => j.applicationId === a.id) ?? null,
      })),
    };
  }

  /**
   * Interview Board (owner, 2026-11-04): shortlisted applications, plus any with a round on record, across every vacancy the
   * user coordinates (all vacancies with recruitment.view_all), ordered by department, designation and name.
   */
  async interviewBoard(q: { departmentId?: string; vacancyId?: string; q?: string }, me: AuthUser) {
    const qb = this.ds.getRepository(Application).createQueryBuilder('a').innerJoinAndSelect('a.candidate', 'c')
      .innerJoinAndSelect('a.vacancy', 'v').innerJoinAndSelect('v.department', 'd').innerJoinAndSelect('v.company', 'co')
      .where('(a.shortlisted = true OR EXISTS (SELECT 1 FROM candidate_stages s WHERE s."applicationId" = a.id))');
    const scope = coordinatorScope(me);
    if (scope) qb.andWhere('v.coordinatorId = :me', { me: scope });
    if (q.departmentId) qb.andWhere('v.departmentId = :d', { d: q.departmentId });
    if (q.vacancyId) qb.andWhere('v.id = :v', { v: q.vacancyId });
    if (q.q) qb.andWhere('(c.name ILIKE :q OR c.candidateNo ILIKE :q OR a.applicationNo ILIKE :q)', { q: `%${q.q}%` });
    const apps = await qb.orderBy('d.name', 'ASC').addOrderBy('v.positionTitle', 'ASC').addOrderBy('c.name', 'ASC', 'NULLS LAST').getMany();
    const ids = apps.map((a) => a.id);
    const [stages, marks, joins] = ids.length ? await Promise.all([
      this.ds.getRepository(CandidateStage).find({ where: { applicationId: In(ids) } }),
      this.ds.getRepository(EvaluationMark).find({ where: { applicationId: In(ids) }, relations: { evaluator: true } }),
      this.ds.getRepository(JoiningRecord).find({ where: { applicationId: In(ids) } }),
    ]) : [[], [], []];
    return {
      allVacancies: !scope,
      rows: apps.map((a) => ({
        applicationId: a.id, applicationNo: a.applicationNo, candidateNo: a.candidate.candidateNo, name: a.candidate.name,
        email: a.candidate.email, phone: a.candidate.phone, screeningResult: a.screeningResult, shortlisted: a.shortlisted,
        finalDecision: a.finalDecision, finalDecisionRemarks: a.finalDecisionRemarks, expectedSalary: a.expectedSalary,
        vacancy: { id: a.vacancy.id, vacancyNo: a.vacancy.vacancyNo, positionTitle: a.vacancy.positionTitle, status: a.vacancy.status,
          departmentId: a.vacancy.departmentId, department: a.vacancy.department.name, company: a.vacancy.company.code },
        stages: Object.fromEntries(stages.filter((s) => s.applicationId === a.id).map((s) => [s.stageType, s])),
        marks: marks.filter((mk) => mk.applicationId === a.id).map((mk) => ({ ...mk, evaluator: { name: mk.evaluator.name } })),
        joining: joins.find((j) => j.applicationId === a.id) ?? null,
      })),
    };
  }

  async upsertStage(applicationId: string, stageType: StageType, dto: { scheduledAt?: string | null; location?: string | null; panel?: string | null; durationMinutes?: number | null; attendance?: CandidateStage['attendance']; result?: DecisionStatus }, me: AuthUser) {
    if (dto.attendance !== undefined && !me.permissions.has(P.ATTENDANCE)) throw new ForbiddenException('You cannot record attendance.');
    if ((dto.result !== undefined || dto.scheduledAt !== undefined || dto.location !== undefined || dto.panel !== undefined || dto.durationMinutes !== undefined) && !me.permissions.has(P.MARKS_ENTER) && !me.permissions.has(P.SHORTLIST)) {
      throw new ForbiddenException('You cannot update stage schedule/results.');
    }
    const shared = {
      ...(dto.scheduledAt !== undefined ? { scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null } : {}),
      ...(dto.location !== undefined ? { location: dto.location } : {}),
      ...(dto.panel !== undefined ? { panel: dto.panel?.trim() || null } : {}),
      ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
      ...(dto.attendance !== undefined ? { attendance: dto.attendance } : {}),
    };
    // Written exam and Interview board share one slot: its time, venue, panel and attendance go to both rows; a result only to its own exam.
    const targets = MAIN_DAY.includes(stageType) && SHARED.some((k) => k in shared) ? MAIN_DAY : [stageType];
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId } });
      if (!app) throw new NotFoundException();
      let requested: CandidateStage | null = null;
      for (const t of targets) {
        let st = await m.findOne(CandidateStage, { where: { applicationId, stageType: t }, lock: { mode: 'pessimistic_write' } });
        const before = st ? { ...st } : {};
        // A round starts only with a date, an attendance or a result. A venue, panel or duration alone (an empty slot dialog
        // saved) creates nothing, because any round on record turns the candidate's status into Interview.
        const starts = !!shared.scheduledAt || (shared.attendance !== undefined && shared.attendance !== 'Not Recorded')
          || (t === stageType && dto.result !== undefined && dto.result !== 'Pending');
        if (!st && !starts) continue;
        if (!st) st = m.create(CandidateStage, { applicationId, stageType: t });
        Object.assign(st, shared, t === stageType && dto.result !== undefined ? { result: dto.result } : {}, { updatedById: me.id });
        await m.save(st);
        const d = diff(before, st, ['scheduledAt', 'location', 'panel', 'durationMinutes', 'attendance', 'result']);
        if (d.changed.length) await this.audit.log(m, me, `stage.${t.toLowerCase()}.update`, 'Application', applicationId, { label: `${app.applicationNo} ${STAGE_LABEL[t]}`, old: d.old, new: d.new });
        if (t === stageType) requested = st;
      }
      return requested;
    });
  }

  /** Bulk scheduling; `vacancyId` null = applications of any vacancy (the Interview Board), access checked by the caller. */
  async schedule(vacancyId: string | null, applicationIds: string[], stageType: StageType, scheduledAt: string, slot: { location?: string; panel?: string; durationMinutes?: number }, me: AuthUser) {
    const out = [];
    for (const id of applicationIds) {
      const app = await this.ds.getRepository(Application).findOne({ where: vacancyId ? { id, vacancyId } : { id } });
      if (!app) { out.push({ applicationId: id, ok: false, error: vacancyId ? 'Not part of this vacancy.' : 'Application not found.' }); continue; }
      if (!app.shortlisted) { out.push({ applicationId: id, applicationNo: app.applicationNo, ok: false, error: 'Shortlist the candidate before scheduling.' }); continue; }
      await this.upsertStage(id, stageType, { scheduledAt, location: slot.location ?? null, panel: slot.panel ?? null, durationMinutes: slot.durationMinutes ?? null }, me);
      out.push({ applicationId: id, applicationNo: app.applicationNo, ok: true });
    }
    return out;
  }

  async saveMark(applicationId: string, dto: { stageType: StageType; component?: string; marks: number; maxMarks?: number | null; remarks?: string }, me: AuthUser) {
    if (dto.maxMarks !== undefined && dto.maxMarks !== null && dto.marks > dto.maxMarks) throw new BadRequestException(`Marks cannot exceed maximum (${dto.maxMarks}).`);
    if (dto.marks < 0) throw new BadRequestException('Marks cannot be negative.');
    const component = dto.component?.trim() || 'Total';
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId } });
      if (!app) throw new NotFoundException();
      let mark = await m.findOne(EvaluationMark, { where: { applicationId, stageType: dto.stageType, component }, lock: { mode: 'pessimistic_write' } });
      const old = mark ? { marks: mark.marks, maxMarks: mark.maxMarks, evaluatorId: mark.evaluatorId } : null;
      if (mark && mark.evaluatorId !== me.id && mark.marks !== dto.marks && !me.permissions.has(P.MARKS_OVERWRITE)) {
        throw new ForbiddenException('Marks were entered by another evaluator; overwrite permission is required.');
      }
      if (!mark) mark = m.create(EvaluationMark, { applicationId, stageType: dto.stageType, component });
      Object.assign(mark, { marks: dto.marks, maxMarks: dto.maxMarks ?? mark.maxMarks ?? null, remarks: dto.remarks ?? mark.remarks ?? null, evaluatorId: me.id, importBatchId: null });
      await m.save(mark);
      await this.audit.log(m, me, old ? 'marks.edit' : 'marks.enter', 'Application', applicationId, {
        label: `${app.applicationNo} ${STAGE_LABEL[dto.stageType]}/${component}`, old, new: { marks: mark.marks, maxMarks: mark.maxMarks },
      });
      return mark;
    });
  }

  // ------------------------------------------------------------------ Excel marks import

  /**
   * Marks template of a vacancy, filled with its shortlisted candidates. `MAIN` (owner, 2026-11-05) is the written exam and
   * interview board in one sheet, a column each, since both are held on the same day; any other stage has one Marks column.
   */
  async template(vacancyId: string, stageType: StageType | 'MAIN') {
    const board = await this.board(vacancyId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Marks');
    const marks = stageType === 'MAIN'
      ? [{ header: 'Written Marks', key: 'written', width: 15 }, { header: 'Interview Marks', key: 'interview', width: 16 }]
      : [{ header: 'Marks', key: 'marks', width: 10 }];
    ws.columns = [
      { header: 'Application ID', key: 'app', width: 20 }, { header: 'Candidate ID', key: 'cand', width: 14 },
      { header: 'Candidate Name', key: 'name', width: 32 }, ...marks, { header: 'Remarks', key: 'remarks', width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    // Marks already entered are filled in (owner, 2026-11-09), so the sheet works as an export to correct and upload again.
    const mark = (r: (typeof board.rows)[number], s: StageType) => r.marks.find((x) => x.stageType === s && x.component === 'Total')?.marks ?? null;
    for (const r of board.rows) {
      ws.addRow({
        app: r.applicationNo, cand: r.candidateNo, name: r.name ?? '',
        ...(stageType === 'MAIN' ? { written: mark(r, 'WRITTEN'), interview: mark(r, 'INTERVIEW') } : { marks: mark(r, stageType) }),
      });
    }
    const safe = (s?: string) => (s ?? '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    const kind = stageType === 'MAIN' ? 'written_interview' : stageType.toLowerCase();
    return { fileName: `${board.vacancy.vacancyNo}_${safe(board.vacancy.department)}_${safe(board.vacancy.positionTitle)}_${kind}_marks.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  private async readSheet(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Upload an .xlsx file.');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Only .xlsx files are supported.');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('The file could not be read as an Excel workbook.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The workbook has no sheets.');
    const header = (ws.getRow(1).values as any[]).map((v) => String(v ?? '').trim());
    const find = (re: RegExp) => header.findIndex((h) => re.test(h));
    const cols = { app: find(/^application\s*(id|no)/i), cand: find(/^candidate\s*(id|no)/i), name: find(/name/i), find };
    if (cols.app < 0 && cols.cand < 0) throw new BadRequestException('The sheet needs an "Application ID" or "Candidate ID" column. Matching by name or row order is not allowed.');
    return { ws, header, cols };
  }

  /** Parses and validates; nothing is saved to marks until confirm() (SRS 13.4 / AC-20). */
  async preview(vacancyId: string, file: Express.Multer.File, stageType: StageType, component: string, maxMarks: number | null, me: AuthUser) {
    const { ws, header, cols } = await this.readSheet(file);
    const colMarks = cols.find(/^marks?$|^score$|obtained/i);
    if (colMarks < 0) throw new BadRequestException(`No "Marks" column found. Detected columns: ${header.filter(Boolean).join(', ')}`);
    const rows = await this.parseRows(vacancyId, ws, cols, colMarks, stageType, component, maxMarks, false);
    if (!rows.length) throw new BadRequestException('No data rows found below the header.');
    return this.saveBatch(vacancyId, file, ws, header, rows, stageType, component, maxMarks, me);
  }

  /**
   * The written & interview sheet (owner, 2026-11-05): one file, two previews (one per exam), confirmed together. A blank cell
   * means the mark is not entered yet and is left out, not an error; rows are still matched by ID only.
   */
  async previewMain(vacancyId: string, file: Express.Multer.File, max: { WRITTEN: number | null; INTERVIEW: number | null }, me: AuthUser) {
    const { ws, header, cols } = await this.readSheet(file);
    const columns = { WRITTEN: cols.find(/written/i), INTERVIEW: cols.find(/interview|viva/i) } as const;
    if (columns.WRITTEN < 0 && columns.INTERVIEW < 0) {
      throw new BadRequestException(`No "Written Marks" or "Interview Marks" column found. Download the written & interview template. Detected columns: ${header.filter(Boolean).join(', ')}`);
    }
    const batches = [];
    for (const stage of ['WRITTEN', 'INTERVIEW'] as const) {
      if (columns[stage] < 0) continue;
      const rows = await this.parseRows(vacancyId, ws, cols, columns[stage], stage, 'Total', max[stage], true);
      if (rows.length) batches.push(await this.saveBatch(vacancyId, file, ws, header, rows, stage, 'Total', max[stage], me));
    }
    if (!batches.length) throw new BadRequestException('No marks found in the Written Marks or Interview Marks column.');
    return { batches };
  }

  private async saveBatch(vacancyId: string, file: Express.Multer.File, ws: ExcelJS.Worksheet, header: string[], rows: Partial<ImportRow>[], stageType: StageType, component: string, maxMarks: number | null, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const batch = m.create(ImportBatch, {
        batchNo: await this.ids.next(m, 'IMP'), vacancyId, stageType, component, uploaderId: me.id, fileName: file.originalname,
        sheetName: ws.name, detectedColumns: header.filter(Boolean), maxMarks, rowsTotal: rows.length,
        rowsAccepted: rows.filter((r) => r.status !== 'Error').length, rowsRejected: rows.filter((r) => r.status === 'Error').length,
        rowsOverwrite: rows.filter((r) => r.status === 'Overwrite').length,
        rows: rows.map((r) => m.create(ImportRow, r)),
      });
      await m.save(batch);
      await this.audit.log(m, me, 'marks.import_preview', 'ImportBatch', batch.id, { label: batch.batchNo, new: { file: batch.fileName, stage: stageType, rows: batch.rowsTotal, errors: batch.rowsRejected } });
      return this.getBatch(batch.id, m);
    });
  }

  private async parseRows(vacancyId: string, ws: ExcelJS.Worksheet, cols: { app: number; cand: number; name: number }, colMarks: number, stageType: StageType, component: string, maxMarks: number | null, skipBlank: boolean) {
    const { app: colApp, cand: colCand, name: colName } = cols;
    const apps = await this.ds.getRepository(Application).find({ where: { vacancyId }, relations: { candidate: true } });
    const byApp = new Map(apps.map((a) => [a.applicationNo.toUpperCase(), a]));
    const byCand = new Map(apps.map((a) => [a.candidate.candidateNo.toUpperCase(), a]));
    const existing = await this.ds.getRepository(EvaluationMark).find({ where: { applicationId: In(apps.map((a) => a.id).concat(['00000000-0000-0000-0000-000000000000'])), stageType, component } });

    const cell = (row: ExcelJS.Row, col: number) => {
      if (col < 0) return '';
      const v: any = row.getCell(col).value;
      return String(v && typeof v === 'object' ? (v.result ?? v.text ?? '') : v ?? '').trim();
    };
    const rows: Partial<ImportRow>[] = [];
    const seen = new Set<string>();
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const appNo = cell(row, colApp).toUpperCase();
      const candNo = cell(row, colCand).toUpperCase();
      const name = cell(row, colName);
      const raw = cell(row, colMarks);
      if (!appNo && !candNo && !raw && !name) return; // blank line
      if (skipBlank && !raw) return; // this exam's mark not entered yet
      const errors: string[] = [];
      const app = appNo ? byApp.get(appNo) : candNo ? byCand.get(candNo) : undefined;
      if (!appNo && !candNo) errors.push('Missing Application ID / Candidate ID.');
      else if (!app) errors.push(`${appNo || candNo} does not belong to this vacancy.`);
      else if (appNo && candNo && app.candidate.candidateNo.toUpperCase() !== candNo) errors.push('Application ID and Candidate ID refer to different people.');
      const marks = raw === '' ? null : Number(raw);
      if (raw === '') errors.push('Marks are blank.');
      else if (Number.isNaN(marks)) errors.push(`Marks "${raw}" is not a number.`);
      else if (marks! < 0) errors.push('Marks cannot be negative.');
      else if (maxMarks !== null && marks! > maxMarks) errors.push(`Marks exceed maximum of ${maxMarks}.`);
      if (app) {
        if (seen.has(app.id)) errors.push('Duplicate row for the same application.');
        seen.add(app.id);
      }
      const prev = app ? existing.find((e) => e.applicationId === app.id) : undefined;
      rows.push({
        rowNumber: n, applicationNo: appNo || null, candidateNo: candNo || null, candidateName: name || null, applicationId: app?.id ?? null,
        marks: Number.isNaN(marks) ? null : marks, previousMarks: prev?.marks ?? null,
        status: errors.length ? 'Error' : prev && prev.marks !== marks ? 'Overwrite' : 'Valid', errors,
      });
    });
    return rows;
  }

  async getBatch(id: string, m = this.ds.manager) {
    const b = await m.findOne(ImportBatch, { where: { id }, relations: { rows: true }, order: { rows: { rowNumber: 'ASC' } } });
    if (!b) throw new NotFoundException('Import batch not found.');
    return b;
  }

  /** Saves valid rows; idempotent (a confirmed batch cannot be applied twice). */
  async confirm(id: string, allowOverwrite: boolean, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const b = await m.findOne(ImportBatch, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!b) throw new NotFoundException();
      if (b.status === 'Confirmed') return { batch: b, duplicate: true };
      if (b.status !== 'Previewed') throw new ConflictException(`Batch is ${b.status}.`);
      const rows = await m.find(ImportRow, { where: { batchId: id } });
      const overwrites = rows.filter((r) => r.status === 'Overwrite');
      if (overwrites.length && (!allowOverwrite || !me.permissions.has(P.MARKS_OVERWRITE))) {
        throw new ForbiddenException(`${overwrites.length} row(s) would replace existing marks. Confirm overwrite (requires overwrite permission) or remove them from the file.`);
      }
      let saved = 0;
      // A mark the sheet repeats unchanged (the downloaded Excel carries the marks already entered) is left as it is.
      for (const r of rows.filter((x) => x.status !== 'Error' && !(x.previousMarks !== null && Number(x.previousMarks) === Number(x.marks)))) {
        const existing = await m.findOne(EvaluationMark, { where: { applicationId: r.applicationId!, stageType: b.stageType, component: b.component } });
        if (existing) {
          await m.update(EvaluationMark, existing.id, { marks: r.marks!, maxMarks: b.maxMarks ?? existing.maxMarks, evaluatorId: me.id, importBatchId: b.id });
        } else {
          await m.insert(EvaluationMark, { applicationId: r.applicationId!, stageType: b.stageType, component: b.component, marks: r.marks!, maxMarks: b.maxMarks, evaluatorId: me.id, importBatchId: b.id });
        }
        saved++;
      }
      b.status = 'Confirmed';
      b.confirmedAt = new Date();
      await m.save(b);
      await this.audit.log(m, me, 'marks.import_confirm', 'ImportBatch', id, { label: b.batchNo, new: { saved, rejected: b.rowsRejected, overwritten: overwrites.length, stage: b.stageType } });
      await this.notify.notify(m, [b.uploaderId], 'import.completed', `Marks import ${b.batchNo}: ${saved} saved, ${b.rowsRejected} rejected`, `/interviews`);
      return { batch: b, saved, duplicate: false };
    });
  }

  async cancel(id: string, me: AuthUser) {
    const res = await this.ds.getRepository(ImportBatch).update({ id, status: 'Previewed' }, { status: 'Cancelled' });
    if (res.affected) await this.audit.log(this.ds.manager, me, 'marks.import_cancel', 'ImportBatch', id);
    return { cancelled: !!res.affected };
  }

  // ------------------------------------------------------------------ final decision

  /**
   * "Remove" on the Interview page (owner, 2026-11-09): a candidate brought in by mistake goes back one stage. Their interview record
   * goes (every round's date, venue, attendance and result, and their marks), kept in the audit entry; `screening` also takes them
   * off the shortlist, so they leave the Interview page and are back on the vacancy's Candidates tab. A final decision must be
   * undone first (step 3), and a candidate who has joined cannot be moved.
   */
  async moveBack(applicationId: string, to: 'schedule' | 'screening', me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!app) throw new NotFoundException('Application not found.');
      const joining = await m.findOne(JoiningRecord, { where: { applicationId } });
      if (joining?.status === 'Approved') throw new ConflictException('Already joined; cannot be moved back.');
      if (!['Pending', 'On Hold'].includes(app.finalDecision)) {
        throw new ConflictException(`The final decision is ${app.finalDecision}. Remove it from step 3 (Select for joining) first.`);
      }
      const stages = await m.find(CandidateStage, { where: { applicationId } });
      const marks = await m.find(EvaluationMark, { where: { applicationId } });
      if (to === 'screening' && !app.shortlisted && !stages.length) return { applicationId, changed: false };
      if (to === 'schedule' && !stages.length && !marks.length) return { applicationId, changed: false };
      await m.delete(EvaluationMark, { applicationId });
      await m.delete(CandidateStage, { applicationId });
      if (to === 'screening') await m.update(Application, applicationId, { shortlisted: false, shortlistReason: null, shortlistedById: me.id, shortlistedAt: new Date() });
      await this.audit.log(m, me, to === 'screening' ? 'interview.remove_to_screening' : 'interview.remove_to_schedule', 'Application', applicationId, {
        label: app.applicationNo,
        old: {
          shortlisted: app.shortlisted,
          stages: stages.map((s) => ({ stage: s.stageType, scheduledAt: s.scheduledAt, location: s.location, attendance: s.attendance, result: s.result })),
          marks: marks.map((k) => ({ stage: k.stageType, component: k.component, marks: k.marks, maxMarks: k.maxMarks })),
        },
        new: { stage: to === 'screening' ? 'Candidates & screening' : 'Interview step 1 (Schedule)' },
      });
      return { applicationId, changed: true };
    });
  }

  /** Final HR decision (SRS 14.1). Earlier stage results are untouched; Selected => Joining Pending. */
  /** One candidate of the board's "Send to joining": final decision Selected (kept as is when already Selected), then the planned joining date. */
  async sendToJoining(applicationId: string, joiningDate: string, me: AuthUser) {
    const app = await this.ds.getRepository(Application).findOne({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Application not found.');
    const existing = await this.ds.getRepository(JoiningRecord).findOne({ where: { applicationId } });
    if (existing?.status === 'Approved') throw new ConflictException('Already joined.');
    if (existing?.status === 'Rejected') throw new ConflictException('Rejected at joining; move them back to pending on the Joining page first.');
    if (app.finalDecision !== 'Selected') await this.finalDecision(applicationId, 'Selected', app.finalDecisionRemarks ?? undefined, me);
    return this.ds.transaction(async (m) => {
      const j = await m.findOne(JoiningRecord, { where: { applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!j || j.status !== 'Pending') throw new ConflictException('The joining record is not pending.');
      if (j.joiningDate !== joiningDate) {
        const old = j.joiningDate;
        j.joiningDate = joiningDate;
        await m.save(j);
        await this.audit.log(m, me, 'joining.update', 'Application', applicationId, { label: app.applicationNo, old: { joiningDate: old }, new: { joiningDate } });
      }
      return j;
    });
  }

  async finalDecision(applicationId: string, decision: DecisionStatus, remarks: string | undefined, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!app) throw new NotFoundException();
      if (app.finalDecision === decision && (app.finalDecisionRemarks ?? '') === (remarks ?? '')) return app;
      // A final decision follows HR shortlisting; it cannot be recorded straight from screening.
      if (decision !== 'Pending' && !app.shortlisted) throw new ConflictException('Shortlist the candidate before recording a final decision.');
      const joining = await m.findOne(JoiningRecord, { where: { applicationId } });
      if (joining?.status === 'Approved' && decision !== 'Selected') throw new ConflictException('Joining is already approved; the final decision can no longer change.');
      const old = { finalDecision: app.finalDecision, remarks: app.finalDecisionRemarks };
      Object.assign(app, { finalDecision: decision, finalDecisionRemarks: remarks ?? null, finalDecisionById: me.id, finalDecisionAt: new Date() });
      await m.save(app);
      if (decision === 'Selected' && !joining) await m.insert(JoiningRecord, { applicationId, status: 'Pending' });
      if (decision !== 'Selected' && joining?.status === 'Pending') await m.delete(JoiningRecord, { id: joining.id });
      await this.audit.log(m, me, 'selection.final_decision', 'Application', applicationId, { label: app.applicationNo, old, new: { finalDecision: decision, remarks } });
      if (decision === 'Selected') {
        await this.notify.notify(m, await this.notify.usersWithPermission(m, P.JOINING_APPROVE), 'joining.pending', `${app.applicationNo} selected - joining follow-up needed`, `/joining`);
      }
      return app;
    });
  }
}
