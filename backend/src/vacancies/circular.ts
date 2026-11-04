import PDFDocument from 'pdfkit';
import { config } from '../config';
import type { JobPost, Vacancy } from '../database/entities';

/** Everything printed on a hiring circular, derived from the job post and its vacancy. */
export interface Circular {
  jobNo: string;
  title: string;
  department: string;
  company: string;
  intro: string | null;
  facts: [string, string][];
  responsibilities: string[];
  skills: string[];
  education: string[];
  deadline: string | null;
  applyEmail: string;
  emailSubject: string;
  draft: boolean;
}

/** One item per line; leading bullets / numbering typed by users are dropped. */
const lines = (s?: string | null) =>
  (s ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•●▪]|\d+[.)])\s*/, '').trim()).filter(Boolean);
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

const defaultSubject = (title: string, department: string) =>
  (title.toLowerCase().includes(department.toLowerCase()) ? `Application for ${title}` : `Application for ${title} - ${department}`);

export function buildCircular(jp: JobPost, v: Vacancy & { department: { name: string }; company: { name: string } }): Circular {
  const facts: [string, string][] = [
    ['Company', v.company.name],
    ['Department', v.department.name],
    ['Location', jp.location || '—'],
    ['Employment Type', jp.employmentType || 'Full-time'],
    ...(jp.jobShift ? [['Job Shift', jp.jobShift] as [string, string]] : []),
    ['Experience', jp.experienceRequirement || '—'],
    ['Vacancy', String(v.headcount)],
    ['Salary', jp.salary || 'As per company policy'],
  ];
  const education = [
    jp.education && `Education: ${jp.education}`,
    jp.requiredDegree && `Degree / subject: ${jp.requiredDegree}`,
    jp.minCgpa !== null && jp.minCgpa !== undefined && `Minimum CGPA: ${Number(jp.minCgpa).toFixed(2)}`,
    jp.experienceRequirement && `Experience: ${jp.experienceRequirement}`,
  ].filter(Boolean) as string[];
  return {
    jobNo: jp.jobNo, title: jp.title, department: v.department.name, company: v.company.name,
    intro: jp.description?.trim() || null, facts,
    responsibilities: lines(jp.duties), skills: lines(jp.skills), education,
    deadline: jp.deadline ? fmtDate(jp.deadline) : null,
    applyEmail: jp.applyEmail || config.careerEmail,
    // The mail scan routes a CV by the position and department in the subject; the job ID separates identical jobs.
    emailSubject: jp.emailSubject?.includes(jp.jobNo) ? jp.emailSubject : `${jp.emailSubject || defaultSubject(jp.title, v.department.name)} (${jp.jobNo})`,
    draft: jp.status === 'Draft',
  };
}

/** Plain-text version for job portals, email bodies and social posts. */
export function circularText(c: Circular) {
  const section = (title: string, items: string[]) => (items.length ? [title.toUpperCase(), ...items.map((i) => `• ${i}`), ''] : []);
  return [
    ...(c.draft ? ['[DRAFT - not yet published]', ''] : []),
    "WE'RE HIRING!",
    c.title,
    `${c.department} | ${c.company}`,
    `Job ID: ${c.jobNo}`,
    '',
    ...(c.intro ? [c.intro, ''] : []),
    'VACANCY INFORMATION',
    ...c.facts.map(([k, v]) => `${k}: ${v}`),
    '',
    ...section('Key responsibilities', c.responsibilities),
    ...section('Required skills', c.skills),
    ...section('Education & experience', c.education),
    ...(c.deadline ? [`Application deadline: ${c.deadline}`, ''] : []),
    'HOW TO APPLY',
    `Send your CV to: ${c.applyEmail}`,
    `Email subject: ${c.emailSubject}`,
    '',
    'We look forward to welcoming a passionate individual to our team!',
    'ANANTA - A concern of Ananta Companies',
  ].join('\n');
}

// ------------------------------------------------------------------ PDF poster

const NAVY = '#16324f';
const ORANGE = '#f07a1a';
const BG = '#d9e8f0';
const PANEL = '#e9f2f7';
const INK = '#1f2d3a';
const MUTED = '#4b5d6e';


/**
 * A4 hiring poster in the style of Ananta's circulars: big HIRING headline, title bar, vacancy facts and sections.
 * Text shrinks a little (down to 80%) so a normal post fits on one page; longer posts continue on further pages.
 */
export async function circularPdf(c: Circular): Promise<Buffer> {
  for (const k of [1, 0.94, 0.88, 0.82]) {
    const doc = render(c, k);
    if (doc.bufferedPageRange().count === 1) return finish(doc);
  }
  return finish(render(c, 0.8));
}

function finish(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.end();
  return done;
}

function render(c: Circular, k: number) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `${c.title} - ${c.jobNo}`, Author: c.company, Subject: 'Hiring circular' } });
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 38;
  const inner = W - 2 * M;
  const bottom = H - 66;
  const fs = (n: number) => n * k;
  const BODY = fs(10);
  let y = 0;

  const background = () => {
    doc.rect(0, 0, W, H).fill(BG);
    // Dot grids in the corners, as on the printed circulars.
    for (const [ox, oy] of [[M - 10, 22], [W - M - 28, 22]]) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) doc.circle(ox + i * 9, oy + j * 9, 1.6).fill(NAVY);
    }
    if (c.draft) doc.font('Helvetica-Bold').fontSize(9).fillColor('#b42318').text('DRAFT - NOT YET PUBLISHED', M, 10, { width: inner, align: 'center' });
  };
  const newPage = () => { doc.addPage({ size: 'A4', margin: 0 }); background(); y = 64; };
  const ensure = (h: number) => { if (y + h > bottom) newPage(); };
  const pill = (label: string, x: number, at: number) => {
    doc.font('Helvetica-Bold').fontSize(fs(10));
    const w = doc.widthOfString(label) + 28;
    doc.roundedRect(x, at, w, fs(20), fs(10)).fill(NAVY);
    doc.fillColor('#ffffff').text(label, x, at + fs(5.5), { width: w, align: 'center' });
  };
  const listHeight = (items: string[], width: number) =>
    items.reduce((s, i) => s + doc.font('Helvetica').fontSize(BODY).heightOfString(i, { width, lineGap: 1 }) + fs(4), 0);
  const list = (items: string[], x: number, top: number, width: number) => {
    let iy = top;
    for (const i of items) {
      doc.circle(x + 4, iy + fs(5), 2.3).fill(NAVY);
      doc.font('Helvetica').fontSize(BODY).fillColor(INK).text(i, x + 13, iy, { width, lineGap: 1 });
      iy += doc.heightOfString(i, { width, lineGap: 1 }) + fs(4);
    }
  };
  /** A framed box with its label on the top edge; draws the frame first so the label sits on top of it. */
  const box = (label: string, x: number, top: number, w: number, h: number) => {
    doc.roundedRect(x, top + fs(10), w, h, 10).lineWidth(1.1).fillAndStroke(PANEL, NAVY);
    pill(label, x + 18, top);
  };

  // Headline
  background();
  doc.font('Helvetica-Bold').fontSize(fs(20)).fillColor(NAVY);
  const we = 'WE ARE';
  const weW = doc.widthOfString(we);
  const weY = 30;
  doc.text(we, (W - weW) / 2, weY);
  doc.moveTo((W - weW) / 2 - 70, weY + fs(11)).lineTo((W - weW) / 2 - 14, weY + fs(11)).lineWidth(1.5).stroke(NAVY);
  doc.moveTo((W + weW) / 2 + 14, weY + fs(11)).lineTo((W + weW) / 2 + 70, weY + fs(11)).stroke(NAVY);
  doc.font('Helvetica-Bold').fontSize(fs(66)).fillColor(ORANGE).text('HIRING!', M, weY + fs(20), { width: inner, align: 'center' });
  y = weY + fs(20) + fs(66) + 6;

  // Title bar
  doc.font('Helvetica-Bold').fontSize(fs(19));
  const titleH = doc.heightOfString(c.title, { width: inner - 60 }) + fs(18);
  doc.roundedRect(M + 10, y, inner - 20, titleH, 10).fill(NAVY);
  doc.fillColor('#ffffff').text(c.title, M + 30, y + fs(9), { width: inner - 60, align: 'center' });
  y += titleH + 6;
  doc.font('Helvetica-Bold').fontSize(fs(12.5)).fillColor(NAVY).text(`${c.department}  |  ${c.company}`.toUpperCase(), M, y, { width: inner, align: 'center' });
  y += fs(16);
  doc.font('Helvetica').fontSize(fs(9)).fillColor(MUTED).text(`Job ID: ${c.jobNo}`, M, y, { width: inner, align: 'center' });
  y += fs(16);

  if (c.intro) {
    doc.font('Helvetica').fontSize(BODY);
    const h = doc.heightOfString(c.intro, { width: inner - 40, align: 'center', lineGap: 1.5 });
    doc.fillColor(INK).text(c.intro, M + 20, y, { width: inner - 40, align: 'center', lineGap: 1.5 });
    y += h + fs(12);
  }

  // Vacancy information: facts in rows of four with dividers.
  const perRow = 4;
  const colW = (inner - 24) / perRow;
  const rows: [string, string][][] = [];
  for (let i = 0; i < c.facts.length; i += perRow) rows.push(c.facts.slice(i, i + perRow));
  const rowH = (row: [string, string][]) => Math.max(...row.map(([, v]) => doc.font('Helvetica').fontSize(fs(9.5)).heightOfString(v, { width: colW - 12 }))) + fs(32);
  const factsH = rows.reduce((s, r) => s + rowH(r), 0) + fs(20);
  ensure(factsH + 20);
  box('VACANCY INFORMATION', M, y, inner, factsH);
  let ry = y + fs(30);
  for (const row of rows) {
    const h = rowH(row);
    row.forEach(([key, v], i) => {
      const x = M + 12 + i * colW;
      doc.circle(x + colW / 2 - 6, ry + fs(4), fs(4.5)).fill(ORANGE);
      doc.font('Helvetica-Bold').fontSize(fs(9.5)).fillColor(NAVY).text(key, x, ry + fs(12), { width: colW - 12, align: 'center' });
      doc.font('Helvetica').fontSize(fs(9.5)).fillColor(INK).text(v, x, ry + fs(24), { width: colW - 12, align: 'center' });
      if (i < row.length - 1) doc.moveTo(x + colW - 6, ry - 2).lineTo(x + colW - 6, ry + h - fs(12)).lineWidth(0.6).stroke('#9db4c6');
    });
    ry += h;
  }
  y += factsH + fs(22);

  // Key responsibilities (full width; long lists continue on the next page).
  const wide = inner - 46;
  let rest = c.responsibilities;
  let first = true;
  while (rest.length) {
    let n = rest.length;
    while (n > 1 && y + fs(40) + listHeight(rest.slice(0, n), wide) > bottom) n--;
    if (y + fs(40) + listHeight(rest.slice(0, n), wide) > bottom) { newPage(); continue; }
    const h = listHeight(rest.slice(0, n), wide) + fs(26);
    box(first ? 'KEY RESPONSIBILITIES' : 'KEY RESPONSIBILITIES (CONTINUED)', M, y, inner, h);
    list(rest.slice(0, n), M + 18, y + fs(30), wide);
    y += h + fs(22);
    rest = rest.slice(n);
    first = false;
    if (rest.length) newPage();
  }

  // Skills and education side by side (or full width when only one exists).
  const pair = [['REQUIRED SKILLS', c.skills], ['EDUCATION & EXPERIENCE', c.education]].filter(([, items]) => items.length) as [string, string[]][];
  if (pair.length) {
    const gap = 14;
    const w = pair.length === 2 ? (inner - gap) / 2 : inner;
    const h = Math.max(...pair.map(([, items]) => listHeight(items, w - 46))) + fs(26);
    ensure(h + 20);
    pair.forEach(([label, items], i) => {
      const x = M + i * (w + gap);
      box(label, x, y, w, h);
      list(items, x + 18, y + fs(30), w - 46);
    });
    y += h + fs(22);
  }

  // How to apply
  const applyLines = [...(c.deadline ? [`Application deadline: ${c.deadline}`] : []), `Email subject: ${c.emailSubject}`];
  doc.font('Helvetica').fontSize(fs(9.5));
  const applyH = fs(44) + applyLines.reduce((s, l) => s + doc.heightOfString(l, { width: inner - 80 }) + 3, 0);
  ensure(applyH + 30);
  doc.roundedRect(M + 30, y, inner - 60, applyH, 12).fill(NAVY);
  doc.font('Helvetica').fontSize(fs(10.5)).fillColor('#cfe0ec').text('Send your CV to:', M + 50, y + fs(10), { width: inner - 100, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(fs(16)).fillColor('#ffffff').text(c.applyEmail, M + 50, y + fs(23), { width: inner - 100, align: 'center' });
  let ay = y + fs(44);
  for (const l of applyLines) {
    doc.font('Helvetica').fontSize(fs(9.5)).fillColor('#ffd2ad').text(l, M + 40, ay - fs(2), { width: inner - 80, align: 'center' });
    ay += doc.heightOfString(l, { width: inner - 80 }) + 3;
  }
  y += applyH + 8;
  doc.font('Helvetica-Oblique').fontSize(fs(9.5)).fillColor(INK).text('We look forward to welcoming a passionate individual to our team!', M, y, { width: inner, align: 'center' });

  // Footer wordmark on every page.
  const pages = doc.bufferedPageRange();
  for (let p = pages.start; p < pages.start + pages.count; p++) {
    doc.switchToPage(p);
    doc.moveTo(M, H - 44).lineTo(W / 2 - 70, H - 44).lineWidth(1).stroke(NAVY);
    doc.moveTo(W / 2 + 70, H - 44).lineTo(W - M, H - 44).stroke(NAVY);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('A N A N T A', M, H - 54, { width: inner, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('A CONCERN OF ANANTA COMPANIES', M, H - 32, { width: inner, align: 'center', lineBreak: false });
  }
  return doc;
}
