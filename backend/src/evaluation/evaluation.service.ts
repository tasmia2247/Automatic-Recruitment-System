import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { DataSource, In } from 'typeorm';
import { AuthUser } from '../common/auth';
import { P } from '../common/permissions';
import { AuditService, diff, IdService, NotificationService } from '../common/services';
import {
  Application, CandidateStage, DecisionStatus, EvaluationMark, ImportBatch, ImportRow, JoiningRecord, StageType, Vacancy,
} from '../database/entities';

export const STAGE_LABEL: Record<StageType, string> = { WRITTEN: 'Written Exam', INTERVIEW: 'Interview', VIVA: 'Viva' };

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
        finalDecision: a.finalDecision, finalDecisionRemarks: a.finalDecisionRemarks,
        stages: Object.fromEntries(stages.filter((s) => s.applicationId === a.id).map((s) => [s.stageType, s])),
        marks: marks.filter((mk) => mk.applicationId === a.id).map((mk) => ({ ...mk, evaluator: { name: mk.evaluator.name } })),
        joining: joins.find((j) => j.applicationId === a.id) ?? null,
      })),
    };
  }

  async upsertStage(applicationId: string, stageType: StageType, dto: { scheduledAt?: string | null; location?: string | null; attendance?: CandidateStage['attendance']; result?: DecisionStatus }, me: AuthUser) {
    if (dto.attendance !== undefined && !me.permissions.has(P.ATTENDANCE)) throw new ForbiddenException('You cannot record attendance.');
    if ((dto.result !== undefined || dto.scheduledAt !== undefined || dto.location !== undefined) && !me.permissions.has(P.MARKS_ENTER) && !me.permissions.has(P.SHORTLIST)) {
      throw new ForbiddenException('You cannot update stage schedule/results.');
    }
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId } });
      if (!app) throw new NotFoundException();
      let st = await m.findOne(CandidateStage, { where: { applicationId, stageType }, lock: { mode: 'pessimistic_write' } });
      const before = st ? { ...st } : {};
      if (!st) st = m.create(CandidateStage, { applicationId, stageType });
      Object.assign(st, {
        ...(dto.scheduledAt !== undefined ? { scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.attendance !== undefined ? { attendance: dto.attendance } : {}),
        ...(dto.result !== undefined ? { result: dto.result } : {}),
        updatedById: me.id,
      });
      await m.save(st);
      const d = diff(before, st, ['scheduledAt', 'location', 'attendance', 'result']);
      if (d.changed.length) await this.audit.log(m, me, `stage.${stageType.toLowerCase()}.update`, 'Application', applicationId, { label: `${app.applicationNo} ${STAGE_LABEL[stageType]}`, old: d.old, new: d.new });
      return st;
    });
  }

  /** Bulk scheduling used by the shortlist/invitation screen. */
  async schedule(vacancyId: string, applicationIds: string[], stageType: StageType, scheduledAt: string, location: string | undefined, me: AuthUser) {
    const out = [];
    for (const id of applicationIds) {
      const app = await this.ds.getRepository(Application).findOne({ where: { id, vacancyId } });
      if (!app) { out.push({ applicationId: id, ok: false, error: 'Not part of this vacancy.' }); continue; }
      await this.upsertStage(id, stageType, { scheduledAt, location: location ?? null }, me);
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

  async template(vacancyId: string, stageType: StageType) {
    const board = await this.board(vacancyId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Marks');
    ws.columns = [
      { header: 'Application ID', key: 'app', width: 20 }, { header: 'Candidate ID', key: 'cand', width: 14 },
      { header: 'Candidate Name', key: 'name', width: 28 }, { header: 'Marks', key: 'marks', width: 10 }, { header: 'Remarks', key: 'remarks', width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of board.rows) ws.addRow({ app: r.applicationNo, cand: r.candidateNo, name: r.name ?? '' });
    return { fileName: `${board.vacancy.vacancyNo}_${stageType}_marks_template.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  /** Parses and validates; nothing is saved to marks until confirm() (SRS 13.4 / AC-20). */
  async preview(vacancyId: string, file: Express.Multer.File, stageType: StageType, component: string, maxMarks: number | null, me: AuthUser) {
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
    const colApp = find(/^application\s*(id|no)/i);
    const colCand = find(/^candidate\s*(id|no)/i);
    const colName = find(/name/i);
    const colMarks = find(/^marks?$|^score$|obtained/i);
    if (colMarks < 0) throw new BadRequestException(`No "Marks" column found. Detected columns: ${header.filter(Boolean).join(', ')}`);
    if (colApp < 0 && colCand < 0) throw new BadRequestException('The sheet needs an "Application ID" or "Candidate ID" column. Matching by name or row order is not allowed.');

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
    if (!rows.length) throw new BadRequestException('No data rows found below the header.');

    return this.ds.transaction(async (m) => {
      const batch = m.create(ImportBatch, {
        batchNo: await this.ids.next(m, 'IMP'), vacancyId, stageType, component, uploaderId: me.id, fileName: file.originalname,
        sheetName: ws.name, detectedColumns: header.filter(Boolean), maxMarks, rowsTotal: rows.length,
        rowsAccepted: rows.filter((r) => r.status !== 'Error').length, rowsRejected: rows.filter((r) => r.status === 'Error').length,
        rowsOverwrite: rows.filter((r) => r.status === 'Overwrite').length,
        rows: rows.map((r) => m.create(ImportRow, r)),
      });
      await m.save(batch);
      await this.audit.log(m, me, 'marks.import_preview', 'ImportBatch', batch.id, { label: batch.batchNo, new: { file: batch.fileName, rows: batch.rowsTotal, errors: batch.rowsRejected } });
      return this.getBatch(batch.id, m);
    });
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
      for (const r of rows.filter((x) => x.status !== 'Error')) {
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
      await this.notify.notify(m, [b.uploaderId], 'import.completed', `Marks import ${b.batchNo}: ${saved} saved, ${b.rowsRejected} rejected`, `/vacancies/${b.vacancyId}?tab=evaluation`);
      return { batch: b, saved, duplicate: false };
    });
  }

  async cancel(id: string, me: AuthUser) {
    const res = await this.ds.getRepository(ImportBatch).update({ id, status: 'Previewed' }, { status: 'Cancelled' });
    if (res.affected) await this.audit.log(this.ds.manager, me, 'marks.import_cancel', 'ImportBatch', id);
    return { cancelled: !!res.affected };
  }

  // ------------------------------------------------------------------ final decision

  /** Final HR decision (SRS 14.1). Earlier stage results are untouched; Selected => Joining Pending. */
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
