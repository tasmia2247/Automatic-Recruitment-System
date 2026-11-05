import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { config } from '../config';
import type { JobPost, Vacancy } from '../database/entities';

/** Everything printed on a hiring circular, derived from the job post and its vacancy. */
export interface Circular {
  jobNo: string;
  title: string;
  /** The title bar: "Executive – Administration Department". */
  headline: string;
  department: string;
  company: string;
  intro: string | null;
  facts: [string, string][];
  responsibilities: string[];
  skills: string[];
  education: string[];
  /** The education lines as label / value, so the poster can set the label in bold. */
  educationParts: { label: string; value: string; highlight?: boolean }[];
  deadline: string | null;
  applyEmail: string;
  emailSubject: string;
  draft: boolean;
}

/** One item per line; leading bullets / numbering typed by users are dropped. */
const lines = (s?: string | null) =>
  (s ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•●▪]|\d+[.)])\s*/, '').trim()).filter(Boolean);
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Application for Executive - Commercial": designation and department, which is what the mail scan matches on. */
export const defaultSubject = (title: string, department: string) =>
  (title.toLowerCase().includes(department.toLowerCase()) ? `Application for ${title}` : `Application for ${title} - ${department}`);

/** "2" or "2.5" alone reads as years. */
const years = (s?: string | null) => (s && /^\s*\d+(?:\.\d+)?\s*$/.test(s) ? `${s.trim()} ${Number(s) === 1 ? 'year' : 'years'}` : s);

/** "GM" + "Quality Control" → "GM – Quality Control Department"; a title that already names the department is kept. */
const headlineOf = (title: string, department: string) => {
  if (title.toLowerCase().includes(department.toLowerCase())) return title;
  return `${title} – ${department}${/\bdepartment$/i.test(department) ? '' : ' Department'}`;
};

export function buildCircular(post: JobPost, v: Vacancy & { department: { name: string }; company: { name: string } }): Circular {
  const jp = { ...post, experienceRequirement: years(post.experienceRequirement) ?? null };
  const facts: [string, string][] = [
    ['Department', v.department.name],
    ['Job Location', jp.location || '—'],
    ['Employment Type', jp.employmentType || 'Full-time'],
    ...(jp.jobShift ? [['Job Shift', jp.jobShift] as [string, string]] : []),
    ['Experience', jp.experienceRequirement || '—'],
    ...(v.headcount > 1 ? [['Vacancy', String(v.headcount)] as [string, string]] : []),
    ['Salary', jp.salary || 'As per company policy'],
  ];
  const educationParts = [
    jp.education ? { label: 'Education', value: jp.education, highlight: true } : null,
    jp.requiredDegree ? { label: 'Degree / subject', value: jp.requiredDegree, highlight: true } : null,
    jp.minCgpa !== null && jp.minCgpa !== undefined ? { label: 'Minimum CGPA', value: Number(jp.minCgpa).toFixed(2) } : null,
    jp.experienceRequirement ? { label: 'Experience', value: jp.experienceRequirement } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  return {
    jobNo: jp.jobNo, title: jp.title, headline: headlineOf(jp.title, v.department.name), department: v.department.name, company: v.company.name,
    intro: jp.description?.trim() || null, facts,
    responsibilities: lines(jp.duties), skills: lines(jp.skills),
    education: educationParts.map((p) => `${p.label}: ${p.value}`), educationParts,
    deadline: jp.deadline ? fmtDate(jp.deadline) : null,
    applyEmail: jp.applyEmail || config.careerEmail,
    // The mail scan routes a CV by the designation and department in the subject (owner, 2026-11-05: no job ID in the subject).
    emailSubject: jp.emailSubject?.trim() || defaultSubject(jp.title, v.department.name),
    draft: jp.status === 'Draft',
  };
}

/** Plain-text version for job portals, email bodies and social posts. Drafts are not marked: the page says a post is a draft. */
export function circularText(c: Circular) {
  const section = (title: string, items: string[]) => (items.length ? [title.toUpperCase(), ...items.map((i) => `• ${i}`), ''] : []);
  return [
    "WE'RE HIRING!",
    c.headline,
    `(${c.company})`,
    '',
    ...(c.intro ? [c.intro, ''] : []),
    'VACANCY INFORMATION',
    ...c.facts.map(([k, v]) => `${k}: ${v}`),
    '',
    ...section('Key responsibilities', c.responsibilities),
    ...section('Required skills', c.skills),
    ...section('Education & experience', c.education),
    'EMAIL SUBJECT',
    c.emailSubject,
    '',
    'HOW TO APPLY',
    `Send your CV to: ${c.applyEmail}`,
    `Email subject: ${c.emailSubject}`,
    ...(c.deadline ? [`Application deadline: ${c.deadline}`] : []),
    `Job ID: ${c.jobNo}`,
    '',
    'We look forward to welcoming a passionate individual to our team!',
    'ANANTA - A concern of Ananta Companies',
  ].join('\n');
}

// ------------------------------------------------------------------ PDF poster

const NAVY = '#13304d';
const ORANGE = '#f07a1a';
const INK = '#1f2d3a';
const MUTED = '#4b5d6e';
const ICON_BG = '#c5d5e1';

/** The logo printed at the foot of the poster, when the file is there (PNG or JPEG); otherwise the ANANTA wordmark. */
const LOGO_FILES = ['circular-logo.png', 'circular-logo.jpg', 'circular-logo.jpeg'].map((n) => path.join(__dirname, '..', '..', 'assets', n));
const logoFile = () => LOGO_FILES.find((f) => fs.existsSync(f)) ?? null;

type Doc = PDFKit.PDFDocument;
type Icon = 'building' | 'pin' | 'briefcase' | 'clock' | 'person' | 'money' | 'users' | 'clipboard' | 'cap' | 'mail' | 'plane';
const FACT_ICON: Record<string, Icon> = {
  Department: 'building', 'Job Location': 'pin', 'Employment Type': 'briefcase', 'Job Shift': 'clock', Experience: 'person', Vacancy: 'users', Salary: 'money',
};

/** Small line icons drawn with vector paths, centred on (cx, cy), about 2r across. */
function icon(doc: Doc, kind: Icon, cx: number, cy: number, r: number, color: string) {
  doc.save().lineWidth(Math.max(1, r * 0.13)).strokeColor(color).fillColor(color).lineJoin('round').lineCap('round');
  const u = r / 10;
  switch (kind) {
    case 'building':
      doc.rect(cx - 5 * u, cy - 8 * u, 10 * u, 16 * u).stroke();
      for (const dx of [-2.5, 2.5]) for (const dy of [-5, -1, 3]) doc.rect(cx + dx * u - 1.2 * u, cy + dy * u - 1.2 * u, 2.4 * u, 2.4 * u).fill();
      doc.moveTo(cx - 8 * u, cy + 8 * u).lineTo(cx + 8 * u, cy + 8 * u).stroke();
      break;
    case 'pin':
      doc.path(`M ${cx} ${cy + 9 * u} C ${cx - 9 * u} ${cy - 1 * u} ${cx - 7 * u} ${cy - 9 * u} ${cx} ${cy - 9 * u} C ${cx + 7 * u} ${cy - 9 * u} ${cx + 9 * u} ${cy - 1 * u} ${cx} ${cy + 9 * u} Z`).fill();
      doc.circle(cx, cy - 3 * u, 2.8 * u).fill('#ffffff');
      break;
    case 'briefcase':
      doc.roundedRect(cx - 8 * u, cy - 4 * u, 16 * u, 11 * u, 1.5 * u).fill();
      doc.roundedRect(cx - 3.5 * u, cy - 7.5 * u, 7 * u, 4 * u, 1 * u).stroke();
      doc.moveTo(cx - 8 * u, cy + 1 * u).lineTo(cx + 8 * u, cy + 1 * u).stroke('#ffffff');
      break;
    case 'clock':
      doc.circle(cx, cy, 8 * u).stroke();
      doc.moveTo(cx, cy).lineTo(cx, cy - 5 * u).moveTo(cx, cy).lineTo(cx + 4 * u, cy + 2 * u).stroke();
      break;
    case 'person':
      doc.circle(cx, cy - 4 * u, 3.6 * u).fill();
      doc.path(`M ${cx - 7 * u} ${cy + 8 * u} C ${cx - 7 * u} ${cy + 1 * u} ${cx + 7 * u} ${cy + 1 * u} ${cx + 7 * u} ${cy + 8 * u} Z`).fill();
      break;
    case 'users':
      for (const dx of [-3.5, 3.5]) {
        doc.circle(cx + dx * u, cy - 3.5 * u, 2.8 * u).fill();
        doc.path(`M ${cx + (dx - 5) * u} ${cy + 7 * u} C ${cx + (dx - 5) * u} ${cy + 1 * u} ${cx + (dx + 5) * u} ${cy + 1 * u} ${cx + (dx + 5) * u} ${cy + 7 * u} Z`).fill();
      }
      break;
    case 'money':
      doc.circle(cx, cy, 8 * u).stroke();
      doc.font('Helvetica-Bold').fontSize(11 * u).fillColor(color).text('$', cx - 4 * u, cy - 6.4 * u, { width: 8 * u, align: 'center', lineBreak: false });
      break;
    case 'clipboard':
      doc.roundedRect(cx - 6 * u, cy - 7 * u, 12 * u, 15 * u, 1.5 * u).stroke();
      doc.rect(cx - 3 * u, cy - 8.5 * u, 6 * u, 3 * u).fill();
      for (const dy of [-1.5, 2, 5.5]) doc.moveTo(cx - 3 * u, cy + dy * u).lineTo(cx + 3.5 * u, cy + dy * u).stroke();
      break;
    case 'cap':
      doc.path(`M ${cx - 10 * u} ${cy - 2 * u} L ${cx} ${cy - 7 * u} L ${cx + 10 * u} ${cy - 2 * u} L ${cx} ${cy + 3 * u} Z`).fill();
      doc.path(`M ${cx - 6 * u} ${cy + 1 * u} L ${cx - 6 * u} ${cy + 5 * u} C ${cx - 3 * u} ${cy + 8 * u} ${cx + 3 * u} ${cy + 8 * u} ${cx + 6 * u} ${cy + 5 * u} L ${cx + 6 * u} ${cy + 1 * u}`).stroke();
      doc.moveTo(cx + 8.5 * u, cy - 1.5 * u).lineTo(cx + 8.5 * u, cy + 5 * u).stroke();
      break;
    case 'mail':
      doc.roundedRect(cx - 8 * u, cy - 5.5 * u, 16 * u, 11 * u, 1.2 * u).stroke();
      doc.moveTo(cx - 8 * u, cy - 5 * u).lineTo(cx, cy + 1 * u).lineTo(cx + 8 * u, cy - 5 * u).stroke();
      break;
    case 'plane':
      doc.path(`M ${cx - 8 * u} ${cy - 1 * u} L ${cx + 8 * u} ${cy - 7 * u} L ${cx + 3 * u} ${cy + 8 * u} L ${cx - 0.5 * u} ${cy + 2 * u} Z`).fill();
      doc.moveTo(cx - 0.5 * u, cy + 2 * u).lineTo(cx + 8 * u, cy - 7 * u).stroke('#ffffff');
      break;
  }
  doc.restore();
}

/**
 * A4 hiring poster in the layout of Ananta's circulars: "We're Hiring!", the title bar, vacancy information with icons,
 * key responsibilities beside required skills and the email subject, education & experience, and the "Send your CV" bar.
 * Text shrinks (down to 70%) so a normal post fits on one page; responsibilities that still do not fit continue on page 2.
 */
export async function circularPdf(c: Circular): Promise<Buffer> {
  for (const k of [1, 0.94, 0.88, 0.82, 0.76, 0.7]) {
    const doc = render(c, k, false);
    if (doc) return finish(doc);
  }
  return finish(render(c, 0.7, true)!);
}

function finish(doc: Doc): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.end();
  return done;
}

/** Renders the poster at text scale `k`; returns null when it does not fit one page and `split` is off. */
function render(c: Circular, k: number, split: boolean): Doc | null {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `${c.title} - ${c.jobNo}`, Author: c.company, Subject: 'Hiring circular' } });
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const inner = W - 2 * M;
  const footerTop = H - 76;
  const f = (n: number) => n * k;
  const BODY = f(9.6);
  const LG = 1.2;
  let y = 0;

  const background = () => {
    const g = doc.linearGradient(0, 0, 0, H);
    g.stop(0, '#cfe2ee').stop(0.55, '#dcebf3').stop(1, '#e8f1f6');
    doc.rect(0, 0, W, H).fill(g);
    // Halftone dots in two corners.
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9 - i; j++) {
      doc.circle(W - 14 - i * 9, 14 + j * 9, 1.9 - (i + j) * 0.17).fill('#b8cfdf');
      doc.circle(14 + i * 9, H - 14 - j * 9, 1.9 - (i + j) * 0.17).fill('#b8cfdf');
    }
  };
  const bulletsHeight = (items: string[], width: number) =>
    items.reduce((s, i) => s + doc.font('Helvetica').fontSize(BODY).heightOfString(i, { width, lineGap: LG }) + f(5), 0);
  const bullets = (items: string[], x: number, top: number, width: number) => {
    let iy = top;
    for (const i of items) {
      doc.circle(x + 3, iy + BODY * 0.55, f(2.2)).fill(INK);
      doc.font('Helvetica').fontSize(BODY).fillColor(INK).text(i, x + f(12), iy, { width, lineGap: LG });
      iy += doc.heightOfString(i, { width, lineGap: LG }) + f(5);
    }
    return iy;
  };
  /** Round icon badge plus a section title with a short orange rule under it. Returns the y below it. */
  const heading = (label: string, kind: Icon, badge: string, x: number, top: number, width: number) => {
    const r = f(15);
    doc.circle(x + r, top + r, r).fill(badge);
    icon(doc, kind, x + r, top + r, r * 0.62, '#ffffff');
    doc.font('Helvetica-Bold').fontSize(f(15)).fillColor(NAVY).text(label, x + 2 * r + f(9), top + r - f(8), { width: width - 2 * r - f(9), lineBreak: false });
    doc.moveTo(x + 2 * r + f(9), top + r + f(10)).lineTo(x + 2 * r + f(37), top + r + f(10)).lineWidth(2).stroke(ORANGE);
    return top + 2 * r + f(10);
  };

  background();

  // "We're Hiring!"
  y = 22;
  doc.font('Times-Bold').fontSize(f(64)).fillColor(ORANGE).text('We’re Hiring!', M, y, { width: inner, align: 'center', lineBreak: false });
  y += f(70);

  // Title bar: designation – department, then the company in light blue.
  const barW = inner - 30;
  const barX = M + 15;
  doc.font('Helvetica-Bold').fontSize(f(22));
  const headH = doc.heightOfString(c.headline, { width: barW - 40, align: 'center' });
  const subtitle = `(${c.company})`;
  doc.font('Helvetica-Bold').fontSize(f(14));
  const subH = doc.heightOfString(subtitle, { width: barW - 40 });
  const barH = headH + subH + f(18);
  doc.roundedRect(barX, y, barW, barH, 12).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(f(22)).fillColor('#ffffff').text(c.headline, barX + 20, y + f(8), { width: barW - 40, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(f(14)).fillColor('#9cc3e5').text(subtitle, barX + 20, y + f(8) + headH + f(1), { width: barW - 40, align: 'center' });
  y += barH + f(12);

  if (c.intro) {
    doc.font('Helvetica').fontSize(f(10.8));
    const h = doc.heightOfString(c.intro, { width: inner - 50, align: 'center', lineGap: 2 });
    doc.fillColor(INK).text(c.intro, M + 25, y, { width: inner - 50, align: 'center', lineGap: 2 });
    y += h + f(14);
  }

  // Vacancy information: one row of up to six facts with icons and dividers.
  const perRow = c.facts.length > 6 ? Math.ceil(c.facts.length / 2) : c.facts.length;
  const rows: [string, string][][] = [];
  for (let i = 0; i < c.facts.length; i += perRow) rows.push(c.facts.slice(i, i + perRow));
  const colW = (inner - 16) / perRow;
  // A label may wrap in a narrow column ("Employment / Type"): every value in the row starts below the tallest label.
  const labelH = (row: [string, string][]) => Math.max(...row.map(([l]) => doc.font('Helvetica-Bold').fontSize(f(9.6)).heightOfString(l, { width: colW - 6, align: 'center' })));
  const valueH = (row: [string, string][]) => Math.max(...row.map(([, v]) => doc.font('Helvetica').fontSize(f(9.4)).heightOfString(v, { width: colW - 10, align: 'center' })));
  const rowH = (row: [string, string][]) => f(38) + labelH(row) + f(3) + valueH(row) + f(8);
  const boxTop = y + f(11);
  const boxH = rows.reduce((s, r) => s + rowH(r), 0) + f(22);
  doc.roundedRect(M, boxTop, inner, boxH, 12).lineWidth(1.3).fillOpacity(0.35).fillAndStroke('#f3f8fb', NAVY).fillOpacity(1);
  doc.font('Helvetica-Bold').fontSize(f(11.5));
  const pillW = doc.widthOfString('VACANCY INFORMATION') + f(34);
  doc.roundedRect((W - pillW) / 2, y, pillW, f(22), f(11)).fill(NAVY);
  doc.fillColor('#ffffff').text('VACANCY INFORMATION', (W - pillW) / 2, y + f(6), { width: pillW, align: 'center', lineBreak: false });
  let ry = boxTop + f(20);
  for (const row of rows) {
    const h = rowH(row);
    const valueTop = ry + f(38) + labelH(row) + f(3);
    const x0 = M + 8 + (inner - 16 - row.length * colW) / 2;
    row.forEach(([label, value], i) => {
      const x = x0 + i * colW;
      const cx = x + colW / 2;
      doc.circle(cx, ry + f(16), f(16)).fill(ICON_BG);
      icon(doc, FACT_ICON[label] ?? 'briefcase', cx, ry + f(16), f(10), NAVY);
      doc.font('Helvetica-Bold').fontSize(f(9.6)).fillColor(NAVY).text(label, x + 3, ry + f(38), { width: colW - 6, align: 'center' });
      doc.font('Helvetica').fontSize(f(9.4)).fillColor(INK).text(value, x + 5, valueTop, { width: colW - 10, align: 'center' });
      if (i < row.length - 1) doc.moveTo(x + colW, ry).lineTo(x + colW, ry + h - f(6)).lineWidth(0.7).stroke('#7d97ab');
    });
    ry += h;
  }
  y = boxTop + boxH + f(20);

  // Footer block heights, so the two columns know how much room they have.
  doc.font('Helvetica-Bold').fontSize(f(15));
  const applyH = f(46);
  const tailH = applyH + f(10) + f(14) + (c.deadline ? f(14) : 0) + f(10);
  const limit = footerTop - tailH;

  // Two columns: key responsibilities (then education & experience) on the left; required skills and the email subject on the right.
  const gap = f(22);
  const leftW = inner * 0.57;
  const rightW = inner - leftW - gap;
  const leftX = M;
  const rightX = M + leftW + gap;
  const textW = (w: number) => w - f(14);

  const eduItems = c.educationParts;
  const eduHeight = (w: number) => eduItems.reduce((s, p) => s + doc.font('Helvetica').fontSize(BODY).heightOfString(`${p.label}: ${p.value}`, { width: textW(w), lineGap: LG }) + f(5), 0);
  const sectionHead = f(40);
  const eduBlockH = eduItems.length ? f(14) + sectionHead + eduHeight(leftW) : 0;
  const respAll = c.responsibilities;
  const respBlockH = (items: string[]) => (items.length ? sectionHead + bulletsHeight(items, textW(leftW)) : 0);

  doc.font('Helvetica').fontSize(BODY);
  const subjectH = doc.heightOfString(c.emailSubject, { width: rightW - f(28), lineGap: LG });
  const mailBoxH = f(16) + f(30) + f(16) + subjectH + f(14);
  const rightH = (c.skills.length ? sectionHead + bulletsHeight(c.skills, textW(rightW)) + f(18) : 0) + mailBoxH;

  let resp = respAll;
  let rest: string[] = [];
  const fits = () => y + Math.max(respBlockH(resp) + eduBlockH, rightH) <= limit;
  if (!fits()) {
    if (!split) return null;
    while (resp.length > 1 && !fits()) resp = resp.slice(0, -1);
    rest = respAll.slice(resp.length);
  }

  const colTop = y;
  let ly = colTop;
  if (resp.length) {
    ly = heading('KEY RESPONSIBILITIES', 'clipboard', ORANGE, leftX, ly, leftW) + f(6);
    ly = bullets(resp, leftX + f(2), ly, textW(leftW));
    if (rest.length) {
      doc.font('Helvetica-Oblique').fontSize(f(8.5)).fillColor(MUTED).text('Continued on the next page.', leftX + f(14), ly, { width: textW(leftW) });
      ly += f(12);
    }
  }
  if (eduItems.length) {
    if (resp.length) {
      ly += f(4);
      doc.save().moveTo(leftX, ly).lineTo(leftX + leftW, ly).lineWidth(0.8).dash(3, { space: 3 }).stroke('#7d97ab').undash().restore();
      ly += f(10);
    }
    ly = heading('EDUCATION & EXPERIENCE', 'cap', NAVY, leftX, ly, leftW) + f(6);
    for (const p of eduItems) {
      const x = leftX + f(2);
      doc.circle(x + 3, ly + BODY * 0.55, f(2.2)).fill(INK);
      doc.font('Helvetica-Bold').fontSize(BODY).fillColor(INK).text(`${p.label}: `, x + f(12), ly, { width: textW(leftW), lineGap: LG, continued: true });
      doc.font('Helvetica').fillColor(p.highlight ? ORANGE : INK).text(p.value, { lineGap: LG });
      ly += doc.font('Helvetica').fontSize(BODY).heightOfString(`${p.label}: ${p.value}`, { width: textW(leftW), lineGap: LG }) + f(5);
    }
  }

  let rY = colTop;
  if (c.skills.length) {
    rY = heading('REQUIRED SKILLS', 'person', ORANGE, rightX, rY, rightW) + f(6);
    rY = bullets(c.skills, rightX + f(4), rY, textW(rightW) - f(4)) + f(14);
  }
  // Email subject box (dashed), as on the printed circulars.
  doc.save().roundedRect(rightX, rY, rightW, mailBoxH, 8).lineWidth(0.9).dash(3, { space: 3 }).stroke('#7d97ab').undash().restore();
  const mr = f(15);
  doc.circle(rightX + f(12) + mr, rY + f(16) + mr, mr).fill(NAVY);
  icon(doc, 'mail', rightX + f(12) + mr, rY + f(16) + mr, mr * 0.62, '#ffffff');
  doc.font('Helvetica-Bold').fontSize(f(13)).fillColor(NAVY).text('EMAIL SUBJECT', rightX + f(12) + 2 * mr + f(8), rY + f(16) + mr - f(12), { width: rightW - 2 * mr - f(30), lineBreak: false });
  doc.font('Helvetica').fontSize(f(9)).fillColor(INK).text('Email Subject:', rightX + f(12) + 2 * mr + f(8), rY + f(16) + mr + f(3), { width: rightW - 2 * mr - f(30), lineBreak: false });
  doc.font('Helvetica').fontSize(BODY).fillColor(ORANGE).text(c.emailSubject, rightX + f(14), rY + f(16) + 2 * mr + f(12), { width: rightW - f(28), lineGap: LG });
  rY += mailBoxH;

  const colBottom = Math.max(ly, rY);
  doc.moveTo(M + leftW + gap / 2, colTop).lineTo(M + leftW + gap / 2, colBottom).lineWidth(0.7).stroke('#7d97ab');
  y = colBottom + f(16);

  // Send your CV to
  const drawApply = (top: number) => {
    doc.font('Helvetica-Bold').fontSize(f(15));
    const emailW = doc.widthOfString(c.applyEmail);
    const pillW2 = Math.min(inner, Math.max(f(300), emailW + f(120)));
    const px = (W - pillW2) / 2;
    doc.roundedRect(px, top, pillW2, applyH, applyH / 2).fill(NAVY);
    const cr = applyH / 2 - f(6);
    doc.circle(px + f(8) + cr, top + applyH / 2, cr).fill('#ffffff');
    icon(doc, 'plane', px + f(8) + cr, top + applyH / 2, cr * 0.62, NAVY);
    const tx = px + f(8) + 2 * cr + f(22);
    doc.moveTo(tx - f(10), top + f(9)).lineTo(tx - f(10), top + applyH - f(9)).lineWidth(0.8).stroke('#5f7d97');
    doc.font('Helvetica').fontSize(f(11)).fillColor('#ffffff').text('Send your CV to:', tx, top + f(8), { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(f(15)).fillColor('#ffffff').text(c.applyEmail, tx, top + f(22), { lineBreak: false });
    let ty = top + applyH + f(8);
    if (c.deadline) {
      doc.font('Helvetica-Bold').fontSize(f(9.5)).fillColor(NAVY).text(`Application deadline: ${c.deadline}`, M, ty, { width: inner, align: 'center', lineBreak: false });
      ty += f(14);
    }
    doc.font('Helvetica').fontSize(f(10.5)).fillColor(INK).text('We look forward to welcoming a passionate individual to our team!', M, ty, { width: inner, align: 'center', lineBreak: false });
  };
  drawApply(y);

  // Responsibilities that did not fit continue on a second page.
  if (rest.length) {
    doc.addPage({ size: 'A4', margin: 0 });
    background();
    let py = heading('KEY RESPONSIBILITIES (CONTINUED)', 'clipboard', ORANGE, M, 40, inner) + f(8);
    py = bullets(rest, M + f(2), py, inner - f(14));
  }

  // Footer on every page: the logo (or the ANANTA wordmark) between two rules.
  const logo = logoFile();
  const pages = doc.bufferedPageRange();
  for (let p = pages.start; p < pages.start + pages.count; p++) {
    doc.switchToPage(p);
    // As on the printed circulars: a rule ending in a dot on each side of the logo.
    const fy = H - 44;
    const half = logo ? 96 : 80;
    doc.moveTo(M, fy).lineTo(W / 2 - half, fy).lineWidth(0.9).stroke(NAVY);
    doc.moveTo(W / 2 + half, fy).lineTo(W - M, fy).stroke(NAVY);
    doc.circle(M, fy, 2.6).fill(NAVY);
    doc.circle(W - M, fy, 2.6).fill(NAVY);
    if (logo) {
      try { doc.image(logo, W / 2 - 85, fy - 25, { fit: [170, 50], align: 'center', valign: 'center' }); continue; } catch { /* unreadable image: fall back to the wordmark */ }
    }
    doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text('ANANTA', M, fy - 12, { width: inner, align: 'center', characterSpacing: 6, lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text('A CONCERN OF ANANTA COMPANIES', M, fy + 10, { width: inner, align: 'center', lineBreak: false });
  }
  return doc;
}
