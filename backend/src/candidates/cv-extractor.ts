import * as path from 'path';
import { layoutPdf, readPdfPages } from './pdf-layout';

export const EXTRACTOR_VERSION = 'rules-2.0';

export interface ExtractedCv {
  name: string | null;
  email: string | null;
  phone: string | null;
  degree: string | null;
  specialization: string | null;
  education: string | null;
  institution: string | null;
  cgpaRaw: string | null;
  cgpa: number | null;
  totalExperienceYears: number | null;
  lastPosition: string | null;
  workplace: string | null;
  skills: string | null;
  address: string | null;
  certifications: string | null;
  previousJobs: string | null;
  expectedSalary: string | null;
  age: number | null;
}

export const EXTRACTED_FIELDS: (keyof ExtractedCv)[] = [
  'name', 'email', 'phone', 'degree', 'specialization', 'education', 'institution', 'cgpa', 'totalExperienceYears', 'lastPosition', 'workplace', 'skills', 'address', 'certifications', 'previousJobs', 'expectedSalary', 'age',
];
/** Fields whose absence makes extraction "Partial" rather than "Completed". */
export const CORE_FIELDS: (keyof ExtractedCv)[] = ['name', 'email', 'phone', 'degree', 'cgpa', 'totalExperienceYears'];

export interface ExtractHints {
  /** The biggest text at the top of a PDF's first page (see pdf-layout). */
  nameHint?: string | null;
  /** The date the age is worked out on; today when not given. */
  today?: Date;
}

export interface CvText { text: string; nameHint: string | null }

/** Reads a stored CV: its text in reading order, plus layout hints. Throws on unreadable/unsupported content. */
export async function readCv(buffer: Buffer, fileName: string): Promise<CvText> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.txt') return { text: buffer.toString('utf8'), nameHint: null };
  if (ext === '.pdf') {
    // Positioned text first (columns and tables in reading order); plain text when that is not available.
    const pages = await readPdfPages(buffer).catch(() => null);
    if (pages?.some((p) => p.items.length)) {
      const lay = layoutPdf(pages);
      if (lay.text.trim()) return lay;
    }
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      return { text: (await parser.getText()).text, nameHint: null };
    } finally {
      await parser.destroy();
    }
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const res = await mammoth.extractRawText({ buffer });
    return { text: res.value, nameHint: null };
  }
  throw new Error(`Text extraction is not supported for ${ext} files; please review manually or upload PDF/DOCX.`);
}

/** Converts a stored CV file to plain text. Throws on unreadable/unsupported content. */
export async function cvToText(buffer: Buffer, fileName: string): Promise<string> {
  return (await readCv(buffer, fileName)).text;
}

// ------------------------------------------------------------------ helpers

function clean(s: string | undefined | null, max = 2000) {
  const t = (s ?? '').replace(/\s+/g, ' ').replace(/^[\s,;:|\-–—•▪●◦*]+|[\s,;|\-–—•▪●◦*]+$/g, '').trim();
  return t ? t.slice(0, max) : null;
}
const bullet = (l: string) => l.replace(/^(?:[-*•▪●◦➢►✓✔]|\d{1,2}[.)])\s*/, '').trim();
const decodeHtml = (s: string) => s.replace(/<\/?\s*[a-z]+[^>]*>?/gi, ' ').replace(/<\/?$/g, ' ').replace(/^\s*p>/i, ' ')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
};

/** Splits a line into its cells: tab gaps from the PDF layout and " | " separators of rebuilt table rows. */
const cellsOf = (l: string) => l.split(/\t/).map((c) => c.trim()).filter(Boolean);
/** Cells of a rebuilt table row ("Exam Title: BSc | Institute: X") by label. */
function tableRow(l: string): Record<string, string> | null {
  if (!/^(?:exam title|training title|training|certification|language)\s*:/i.test(l) || !l.includes(' | ')) return null;
  const row: Record<string, string> = {};
  for (const part of l.split(' | ')) {
    const m = part.match(/^([^:]{2,30}):\s*(.*)$/);
    if (m) row[m[1].trim().toLowerCase().replace(/\s+/g, ' ')] = m[2].trim();
  }
  return row;
}

// ------------------------------------------------------------------ sections

type SectionKind = 'experience' | 'education' | 'skills' | 'training' | 'certifications' | 'references' | 'personal' | 'other';

const SECTION_RES: [SectionKind, RegExp][] = [
  // Checked first: these name "experience" or "skills" but are not the work history or skill list.
  ['other', /^(?:leadership\s*(?:&|and)\s*)?extra\s*-?\s*curricul(?:ar|um)(?:\s+activities|\s+experiences?)?|^(?:career|job)\s+objectives?$|^objectives?$|^(?:career|professional|executive)\s+summary$|^summary(?:\s+of\s+(?:qualifications?|accomplish\s*ment))?$|^summery\s+of(?:\s+accomplish\s*ment)?$|^profile$|^(?:personal\s+)?profile\s+summary$|^about\s+me$|^special\s+qualifications?$|^contact(?:\s+(?:me|details|info(?:rmation)?))?$|^languages?(?:\s+(?:proficiency|skills?))?$|^career\s+and\s+application\s+information$|^declaration$|^hobbies?$|^interests$|^projects?$|^achievements?$|^awards?(?:\s*(?:&|and)\s*achievements?)?$|^customers$|^business\s+travel$|^responsibilit(?:y|ies)$|^key\s+responsibilities$|^signature$/i],
  ['experience', /^(?:(?:work|working|professional|employment|job|career|industrial|relevant|internship)\s+)?(?:experiences?|history)$|^employment(?:\s+(?:history|record))?$|^career\s+history$|^experiences?\s+(?:details|summary)$/i],
  ['education', /^(?:education(?:al)?(?:\s+(?:qualifications?|background|details|summary))?|academic(?:\s+(?:qualifications?|background|profile|records?|credentials|details))?|academic\s*\/\s*education|educational\s+qualifications?)$/i],
  ['skills', /^(?:(?:core|key|technical|computer|it|professional|soft|application|relevant)\s+)?skills?(?:\s*(?:&|and)(?:\s*(?:competencies|interests|expertise|abilities|tools))?)?$|^applicationskills?$|^(?:fields?\s+of\s+)?expertise$|^competencies$|^skills?\s+summary$/i],
  ['training', /^(?:professional\s+)?trainings?(?:\s+(?:summa?e?ry|attended|programs?|details))?$|^trainings?\s*(?:&|and)\s*(?:certifications?|courses?)$|^courses?(?:\s*(?:&|and)\s*trainings?)?$|^workshops?$/i],
  ['certifications', /^(?:professional\s+)?(?:certifications?|certificates?)$|^professional\s+qualifications?$|^licen[sc]es?(?:\s*(?:&|and)\s*certifications?)?$/i],
  ['references', /^references?(?:\s*\(s\))?$|^referees?$/i],
  ['personal', /^personal\s+(?:details|information|info|profile|data|particulars)$/i],
];

function headingKind(s: string): SectionKind | null {
  const t = s.replace(/[:：]\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 50) return null;
  for (const [k, re] of SECTION_RES) if (re.test(t)) return k;
  return null;
}

interface Section { kind: SectionKind; lines: string[] }

/** Cuts the CV into sections at its headings. A heading may carry text after a colon, a tab or a bullet. */
function sectionize(lines: string[]): { sections: Section[]; kindOf: SectionKind[] } {
  const sections: Section[] = [{ kind: 'other', lines: [] }];
  const kindOf: SectionKind[] = [];
  for (const l of lines) {
    let kind = tableRow(l) ? null : headingKind(l);
    let rest = '';
    if (!kind && !tableRow(l)) {
      const m = l.match(/^(.{3,45}?)\s*(?::\s+|\t|\s(?=•))(.+)$/);
      if (m && (kind = headingKind(m[1]))) rest = m[2];
    }
    if (kind) {
      sections.push({ kind, lines: rest ? [rest] : [] });
      kindOf.push(kind);
    } else {
      sections[sections.length - 1].lines.push(l);
      kindOf.push(sections[sections.length - 1].kind);
    }
  }
  return { sections, kindOf };
}

// ------------------------------------------------------------------ education

interface EduEntry { title: string; rank: number; subject: string | null; institute: string | null; result: string | null; year: string | null; incomplete: boolean }

const DEGREES: [number, RegExp][] = [
  [0, /^(?:ph\.?\s?d|doctor(?:ate)?\s+of)\b/i],
  [1, /^m\.?\s?phil\b/i],
  [3, /^(?:pgd\w*|post\s*-?\s*graduate\s+diploma)\b/i],
  [4, /^(?:mbbs|bds)\b/i],
  [2, /^(?:masters?\b|e\.?\s?m\.?\s?b\.?\s?a\b|m\.?\s?b\.?\s?a\b|m\.?\s?sc\b|m\.?\s?s\.?\s?s\b|m\.?\s?b\.?\s?s\b|m\.?\s?com\b|m\.?\s?a\b|m\.?\s?eng\b|m\.?\s?s\b|ll\.?\s?m\b|m\.?\s?pharm\b|m\.?\s?ed\b|m\.?\s?tech\b)/i],
  [4, /^(?:bachelor|b\.?\s?sc\b|b\.?\s?b\.?\s?a\b|b\.?\s?b\.?\s?s\b|b\.?\s?s\.?\s?s\b|b\.?\s?com\b|b\.?\s?a\b|b\.?\s?eng\b|b\.?\s?tech\b|b\.?\s?pharm\b|b\.?\s?ed\b|b\.?\s?s\b|ll\.?\s?b\b|honou?rs\b|undergraduate\b|graduat(?:e|ion)\b|degree\s+pass\b|fazil\b|kamil\b)/i],
  [5, /^diploma\b/i],
  [6, /^(?:h\.?\s?s\.?\s?c\b|higher\s+secondary|alim\b|a\s*-?\s*levels?\b|intermediate\b)/i],
  [7, /^(?:s\.?\s?s\.?\s?c\b|secondary\s+school|dakhil\b|o\s*-?\s*levels?\b|matriculation\b)/i],
];
/** 0 = PhD ... 4 = bachelor, 5 = diploma, 6 = HSC, 7 = SSC; -1 when the text does not start with a degree. */
export const degreeRank = (s: string) => {
  const t = s.replace(/^[\s\d/.\-–]+(?=[A-Za-z])/, '').trim(); // a leading year: "2019 - 2024 Undergraduate"
  for (const [r, re] of DEGREES) if (re.test(t)) return r;
  return -1;
};
/** The degree word(s) a text starts with ("BSc", "Bachelor", "MBA"), or null. */
export const degreeToken = (s: string) => {
  const t = s.replace(/^[\s\d/.\-–]+(?=[A-Za-z])/, '').trim();
  for (const [, re] of DEGREES) { const m = t.match(re); if (m) return m[0]; }
  return null;
};
const INSTITUTION = /\b(?:university|college|institute|institution|polytechnic|school|academy|madrasa|madrasah|iut|buet|butex|aiub|nsu|bracu?)\b/i;
const RESULT = /\b(?:c?gpa|cgpa|out\s+of|class|division|grade|marks?|first|second|third|distinction|passed|appeared|awarded|enrolled|running|result)\b|\d{1,3}(?:\.\d+)?\s*%/i;
const INCOMPLETE = /\b(?:enrolled|appeared|running|pursuing|ongoing|continuing|current(?:ly)?|expected|level\s*\d|semester|final\s+year|\d(?:st|nd|rd|th)\s+year)\b/i;
const GENERIC_FIELD = /^(?:arts?|science|sciences|commerce|business(?:\s+(?:studies|administration))?|social\s+sciences?|engineering|laws?|philosophy|education|fine\s+arts?|honou?rs|degree|pass|madrasa|madrasah|general|n\/?a|none)$/i;

/** Bdjobs fills the major column with these when there is no subject. */
const JUNK_FIELD = /^(?:degree|pass|madrasa|madrasah|general|n\/?a|none|-|honou?rs)$/i;

/**
 * The subject of a degree as written: an explicit major column, "BSc in X", "MBA (X)", "Master of X",
 * "Bachelor of Arts, X". A subject read from the degree name skips generic words ("Bachelor of Science").
 */
export function subjectOf(title: string, rest: string | null, restFirst = false): string | null {
  const stop = (s: string) => s.split(/\s+(?:from|at|with|cgpa|gpa|university|college|institute|passing|session|year)\b|\s+-\s+|\s*\(\s*c?gpa|[,;|\t]/i)[0];
  const ok = (v: string | null, generic: boolean): v is string =>
    !!v && !(generic ? GENERIC_FIELD : JUNK_FIELD).test(v) && !INSTITUTION.test(v) && !RESULT.test(v) && !/\d{4}/.test(v);
  const own = clean(rest ? stop(rest) : null);
  if (restFirst && ok(own, false)) return own;
  const fromTitle = [
    title.match(/(?:\s|-)(?:in|on)(?:\s|-)+([A-Za-z][A-Za-z&/.\-' ]{1,70})/i)?.[1],
    title.match(/\(([A-Za-z][A-Za-z&/.\-' ]*\s[A-Za-z&/.\-' ]+)\)/)?.[1],
    title.match(/^(?:bachelor|master|doctor)s?\s+of\s+([A-Za-z][A-Za-z&/.\-' ]{1,70})/i)?.[1]?.replace(/^(?:science|arts?|commerce|business)\s+in\s+/i, ''),
  ];
  for (const t of fromTitle) {
    const v = clean(t ? stop(t) : null);
    if (ok(v, true)) return v;
  }
  return ok(own, true) ? own : null;
}

/** "CGPA: 3.45 out of 4.00", "CGPA : 2.68 (out of 4)", "3.62 out of 4", "CGPA – 3.50 (-A)". */
function gpaOf(s: string): { raw: string; value: number; scale: number | null } | null {
  const m = s.match(/\bc?gpa\b\s*[:\-–—]?\s*(\d(?:\.\d{1,2})?)(?:\s*\(?\s*(?:\/|out\s+of)\s*(\d(?:\.\d{1,2})?)\s*\)?)?/i)
    ?? s.match(/\b(\d\.\d{1,2})\s*\(?\s*(?:\/|out\s+of)\s*(\d(?:\.\d{1,2})?)\s*\)?/i);
  if (!m) return null;
  return { raw: m[0].replace(/\s+/g, ' ').trim(), value: Number(m[1]), scale: m[2] ? Number(m[2]) : null };
}

function educationEntries(lines: string[]): EduEntry[] {
  const entries: EduEntry[] = [];
  // Rebuilt Bdjobs table rows.
  for (const l of lines) {
    const row = tableRow(l);
    if (!row || !row['exam title']) continue;
    const title = row['exam title'];
    const result = row['result'] ?? null;
    entries.push({
      title, rank: degreeRank(title), result: result ? result.replace(/\s+/g, ' ') : null,
      subject: subjectOf(title, row['concentration/major'] ?? row['major'] ?? row['concentration'] ?? null, true),
      institute: clean(row['institute'] ?? row['institution'] ?? row['board']),
      year: row['pass.year'] ?? row['pas.year'] ?? row['passing year'] ?? row['year'] ?? null,
      incomplete: INCOMPLETE.test(result ?? ''),
    });
  }
  if (entries.length) return entries;

  // Free text: each degree line opens an entry; the lines under it (up to the next degree) hold its institute and result.
  const starts = lines.map((l, i) => ({ i, cell: cellsOf(l).find((c) => degreeRank(c) >= 0) })).filter((x) => x.cell);
  starts.forEach(({ i, cell }, n) => {
    const end = Math.min(n + 1 < starts.length ? starts[n + 1].i : lines.length, i + 6);
    const titleText = cell!.replace(/^[\s\d/.\-–]+(?=[A-Za-z])/, '');
    const [titlePart, ...afterComma] = titleText.split(/,\s*/);
    const title = clean(titlePart.split(/\s+(?:from|at)\s+|\s+-\s+(?=\d{4}|[A-Z][a-z]+\s+(?:University|College))|\s*\(\s*c?gpa|\s+c?gpa\b/i)[0].replace(/\s*[-–]\s*\d{4}\s*$/, ''))!;
    const pieces = [...afterComma, ...cellsOf(lines[i]).filter((c) => c !== cell), ...lines.slice(i + 1, end).flatMap(cellsOf)]
      .filter((c) => !/^affiliated\b/i.test(c));
    const insts = pieces.filter((c) => INSTITUTION.test(c));
    // Some CVs write the institute on the line above the degree.
    const above = i > 0 && (n === 0 || starts[n - 1].i < i - 1) ? cellsOf(lines[i - 1]).find((c) => INSTITUTION.test(c) && degreeRank(c) < 0) : undefined;
    const institute = clean(insts.find((c) => !/\bboard\b/i.test(c)) ?? above ?? insts[0]);
    const all = [titleText, ...pieces].join(' \n ');
    const g = gpaOf(all);
    const marks = all.match(/(?:first|second|third)\s+(?:class|division)[^\n]{0,20}|\d{1,3}(?:\.\d+)?\s*%/i)?.[0];
    const subjectLine = rankSubject(afterComma[0], pieces, institute);
    entries.push({
      title, rank: degreeRank(title), institute,
      subject: subjectOf(title, subjectLine),
      result: g ? g.raw : clean(marks, 40),
      year: all.match(/\b(?:19|20)\d{2}\b(?!.*\b(?:19|20)\d{2}\b)/)?.[0] ?? null,
      incomplete: INCOMPLETE.test(all),
    });
  });
  return entries;
}

/** A plain subject line under a degree ("Apparel Manufacturing Management & Technology"), when the degree line has none. */
function rankSubject(afterComma: string | undefined, pieces: string[], institute: string | null): string | null {
  if (afterComma) return afterComma;
  return pieces.find((c) => c !== institute && !INSTITUTION.test(c) && !RESULT.test(c) && !/\d/.test(c) && !/:/.test(c)
    && /^[A-Z][A-Za-z&/.\-' ]{3,70}$/.test(c) && c.split(/\s+/).length >= 2) ?? null;
}

function bestDegree(entries: EduEntry[]): EduEntry | null {
  const ranked = entries.filter((e) => e.rank >= 0);
  if (!ranked.length) return null;
  const done = ranked.filter((e) => !e.incomplete);
  // An enrolled / appeared higher degree does not replace a finished one, but a student's running bachelor counts.
  const pool = done.length && Math.min(...done.map((e) => e.rank)) <= 4 ? done : ranked;
  return pool.reduce((a, b) => (b.rank < a.rank ? b : a));
}

// ------------------------------------------------------------------ experience

const TITLE_WORDS = /\b(?:officer|manager|executive|engineer|assistant|asst\.?|director|head|supervisor|in-?charge|incharge|developer|merchandiser|designer|operator|coordinator|co-ordinator|specialist|analyst|intern(?:ship)?|trainee|lead|leader|consultant|administrator|accountant|president|secretary|chief|ceo|cfo|coo|cto|gm|agm|dgm|associate|technician|controller|planner|programmer|auditor|inspector|cutter|tailor|helper|chemist|worker|representative|clerk|teacher|lecturer|professor|instructor|advisor|adviser|architect|deputy|member|admin)\b/i;
const ORG_WORDS = /\b(?:ltd\.?|limited|plc|inc\.?|llc|group|company|co\.|corporation|corp\.?|mills?|industries|industry|bank|textiles?|fashions?|apparels?|garments?|knit\w*|composite|washing|wash|denims?|dyeing|sweaters?|international|enterprises?|holdings|trading|solutions?|technologies|pharma\w*|university|college|school|foundation|associates|agency|factory|plant|organization|organisation|ngo|services)\b/i;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE = `(?:(?:\\d{1,2}(?:st|nd|rd|th)?[\\s/.\\-]+)?${MONTH},?\\s*(?:\\d{1,2},?\\s*)?(?:19|20)\\d{2}|(?:\\d{1,2}[/.\\-]){1,2}(?:19|20)\\d{2}|(?:19|20)\\d{2})`;
const END = `(?:present|current(?:ly)?|continuing|running|till\\s*(?:now|date|today)|to\\s+date|now|ongoing|${DATE})`;
const DATE_RANGE = new RegExp(`\\(?\\s*(?:${DATE}|${MONTH})\\s*(?:-|–|—|to|till|until)\\s*${END}\\s*\\)?|${MONTH}\\s*(?:-|–|—|to)\\s*${MONTH}\\s*(?:19|20)\\d{2}`, 'i');

const TITLE_LABEL = /^(?:#\s*)?(?:(?:current|present|last|latest|previous|former)\s+)?(?:job\s+position|position|designation|job\s*title|role|post)\s*[:\-–]\s*(.{2,100})$/i;
const ORG_LABEL = /^(?:#\s*)?(?:(?:current|present|last|previous|former)\s+)?(?:company(?:\s+name)?|organi[sz]ation(?:\s+name)?|employer|institution\s+name|office)\s*[:\-–]\s*(.{2,120})$/i;

interface Job { title: string | null; org: string | null }
const jobText = (j: Job) => [j.title, j.org].filter(Boolean).join(', ');
const stripDuration = (s: string) => s.replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:yrs?|years?|months?)\s*\)\s*$/i, '').trim();

/** Bdjobs entries: "1. Deputy Manager (9.1yrs)" / "(5 Oct 2017 - Continuing)" / "Soorty Textile (BD) Ltd.". */
function bdjobsJobs(lines: string[]): Job[] {
  const jobs: Job[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:\d{1,2}\.\s*)?(.{2,120}?)\s*\(\s*\d+(?:\.\d+)?\s*(?:yrs?|years?|months?)\s*\)$/i);
    const next = lines[i + 1] ?? '';
    if (!m || !/^\(.*(?:19|20)\d{2}.*\)$/.test(next)) return;
    const org = lines[i + 2] && !/^(?:area of expertise|duties)/i.test(lines[i + 2]) ? lines[i + 2] : null;
    jobs.push({ title: clean(m[1]), org: clean(org) });
  });
  return jobs;
}

/** Labelled pairs: "Designation: X" with the nearest "Company Name: Y" written just before or after it. */
function labelledJobs(lines: string[]): Job[] {
  const jobs: Job[] = [];
  const firstOrg = lines.findIndex((l) => ORG_LABEL.test(l));
  const firstTitle = lines.findIndex((l) => TITLE_LABEL.test(l));
  const orgFirst = firstOrg !== -1 && firstOrg < firstTitle;
  const offsets = orgFirst ? [-1, -2, -3] : [1, 2, 3];
  lines.forEach((l, i) => {
    const t = l.match(TITLE_LABEL)?.[1];
    if (!t) return;
    let near: string | undefined;
    for (const o of offsets) {
      const n = lines[i + o];
      if (!n || TITLE_LABEL.test(n)) break; // another job's designation: stop looking
      near = n.match(ORG_LABEL)?.[1];
      if (near) break;
    }
    const [title, atOrg] = t.split(/\s+\|\s+/)[0].split(/\s+(?:at|@)\s+/);
    jobs.push({ title: clean(stripDuration(title)), org: clean(atOrg ?? near) });
  });
  return jobs;
}

/** Splits "Title, Company", "Company | Title | Area", "Company ( Group | Title )", "Title at Company" into title and organization. */
function splitJob(pieces: string[]): Job {
  let title: string | null = null;
  let org: string | null = null;
  const at = pieces.join(' ').match(/^(.{2,80}?)\s+(?:at|@)\s+(.{2,100})$/);
  if (at && !ORG_WORDS.test(at[1])) return { title: clean(at[1]), org: clean(at[2]) };
  const parts = pieces.flatMap((p) => p.split(/\s*\|\s*|\s*\(\s*|\s*\)\s*|,\s+(?=[A-Z])/)).map((p) => clean(p)).filter((p): p is string => !!p && p.length > 1);
  const orgs = parts.filter((p) => ORG_WORDS.test(p) && !(TITLE_WORDS.test(p) && !/\b(?:ltd|limited|group|plc|inc)\b/i.test(p)));
  const others = parts.filter((p) => !orgs.includes(p));
  // "BEXIMCO | MANAGER | DESIGN & PD": a short leading name before the title is the organization.
  if (!orgs.length && others.length > 1 && !TITLE_WORDS.test(others[0]) && others[0].split(/\s+/).length <= 5 && others.slice(1).some((p) => TITLE_WORDS.test(p))) {
    orgs.push(others.shift()!);
  }
  if (others.some((p) => TITLE_WORDS.test(p))) title = others.join(' | ');
  if (orgs.length) org = orgs.length > 1 ? `${orgs[0]} (${orgs.slice(1).join(', ')})` : orgs[0];
  return { title, org };
}

/** Free-form entries in the experience section, each opened by a line with a date range. */
function datedJobs(lines: string[]): Job[] {
  const jobs: Job[] = [];
  lines.forEach((l, i) => {
    if (!DATE_RANGE.test(l)) return;
    const rest = cellsOf(l.replace(DATE_RANGE, '\t')).map((c) => c.replace(/\(\s*\)/g, '').replace(/[,;:\-–]\s*$/, '').trim()).filter(Boolean);
    const pieces = [...rest];
    let job = splitJob(pieces);
    for (let k = i + 1; k < Math.min(lines.length, i + 4) && (!job.title || !job.org); k++) {
      const n = lines[k];
      if (DATE_RANGE.test(n) || n.length > 70 || (n.match(/\b[a-z]{3,}\b/g) ?? []).length >= 3 || /[:•▪]/.test(n) || /\.$/.test(n) || /^[a-z]/.test(n)) break;
      pieces.push(n);
      job = splitJob(pieces);
    }
    if (job.title || job.org) jobs.push(job);
  });
  return jobs;
}

// ------------------------------------------------------------------ main

const BD_PLACE = /\b(?:road|rd\.?|house|flat|holding|sector|block|lane|village|vill\.?|para|upazila|upazilla|thana|union|district|dist\.?|post|p\.?\s?o\.?|dhaka|gazipur|chittagong|chattogram|narayanganj|savar|uttara|mirpur|tongi|ashulia|khulna|rajshahi|sylhet|barishal|barisal|rangpur|mymensingh|cumilla|comilla|bogura|bogra|tangail|kushtia|jessore|jashore|noakhali|feni|pabna|dinajpur|bangladesh)\b/i;
const looksLikeAddress = (s: string) => /,/.test(s) && (BD_PLACE.test(s) || /\b\d{4}\b/.test(s)) && !/@|https?:|www\./i.test(s) && !phoneOf(s);

function phoneOf(s: string): string | null {
  for (const m of s.matchAll(/\+?\d[\d\s\-().]{7,18}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    const bd = digits.match(/^(?:880|88)?0?(1[3-9]\d{8})$/);
    if (bd) return `0${bd[1]}`;
  }
  return null;
}

function parseDate(s: string): Date | null {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mon = (t: string) => months.indexOf(t.slice(0, 3).toLowerCase());
  let m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+([A-Za-z]{3,9})\.?[\s\-/.,]+((?:19|20)\d{2})\b/);
  if (m && mon(m[2]) >= 0) return new Date(Date.UTC(+m[3], mon(m[2]), +m[1]));
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/);
  if (m && mon(m[1]) >= 0) return new Date(Date.UTC(+m[3], mon(m[1]), +m[2]));
  m = s.match(/\b(\d{1,2})[\-/.](\d{1,2})[\-/.]((?:19|20)\d{2})\b/);
  if (m && +m[2] <= 12) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/\b((?:19|20)\d{2})[\-/.](\d{1,2})[\-/.](\d{1,2})\b/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

/**
 * Deterministic, rule-based extraction. It only returns values literally present in the text (the age is worked out
 * from a written date of birth); anything not found stays null so downstream screening marks it "Review Required" (SRS 10.2).
 */
export function extractFromText(text: string, hints: ExtractHints = {}): ExtractedCv {
  const lines = text.split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' ').replace(/[ \f\v]+/g, ' ').replace(/ *\t[\t ]*/g, '\t').replace(/\t(?=:)/g, ' ').trim())
    .map((l) => l.replace(/^(?:[A-Za-z] ){2,}[A-Za-z](?=\t|$)/, (m) => m.replace(/ /g, ''))) // "S K I L L S"
    .filter((l) => l && !/^-- \d+ of \d+ --$/.test(l) && !/^page \d+(?: of \d+)?$/i.test(l));
  const { sections, kindOf } = sectionize(lines);
  const sectionLines = (...kinds: SectionKind[]) => sections.filter((s) => kinds.includes(s.kind)).flatMap((s) => s.lines);
  const own = lines.filter((_, i) => kindOf[i] !== 'references'); // the referees' contacts are not the candidate's
  const flat = own.join('\n');

  const email = clean(flat.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]);

  let phone: string | null = null;
  for (const l of own) if ((phone = phoneOf(l))) break;
  if (!phone) phone = clean(own.find((l) => /\b(?:mobile|phone|cell|contact|tel)\b/i.test(l))?.match(/\+?\d[\d\s-]{8,14}\d/)?.[0]);

  // Name: the biggest text on the first page, else a "Name:" label, else the first line that reads like a name.
  const nameLike = (s: string | null | undefined) => !!s && /^[A-Za-z][A-Za-z.\-' ]{2,60}$/.test(s) && s.split(/\s+/).length <= 6
    && !/curriculum|vitae|resume|\bcv\b/i.test(s) && !headingKind(s) && !TITLE_WORDS.test(s.replace(/^md\.?\s/i, ''));
  let name = nameLike(hints.nameHint) ? clean(hints.nameHint) : null;
  if (!name) {
    const label = own.map((l) => l.match(/^(?:full\s+|candidate'?s?\s+)?name\s*[:\-–]\s*([A-Za-z][A-Za-z.\-' ]{2,60})$/i)?.[1]).find(Boolean);
    name = clean(label) ?? clean(own.slice(0, 10).find((l) => !/^job\s*title\b/i.test(l) && nameLike(l)));
  }

  // ---- education
  const eduSection = sectionLines('education');
  let entries = educationEntries(eduSection.length ? eduSection : own.filter((l) => tableRow(l)?.['exam title']));
  if (!entries.length) entries = educationEntries(own.filter((_, i) => own.slice(Math.max(0, i - 5), i + 1).some((l) => cellsOf(l).some((c) => degreeRank(c) >= 0))));
  const best = bestDegree(entries);
  const degree = clean(best?.title);
  const specialization = clean(best?.subject);
  const institution = clean(best?.institute ?? eduSection.flatMap(cellsOf).find((c) => INSTITUTION.test(c) && !/^affiliated/i.test(c)));
  const education = entries.length
    ? clean(entries.slice(0, 5).map((e) => [
      [e.title, e.subject && !e.title.includes(e.subject) ? e.subject : null].filter(Boolean).join(', '),
      e.institute ? ` - ${e.institute}` : '',
      e.result || e.year ? ` (${[e.result, e.year].filter(Boolean).join(', ')})` : '',
    ].join('')).join('; '))
    : null;
  const g = best ? gpaOf(best.result ?? '') : gpaOf(flat);
  const cgpaRaw = clean(g?.raw ?? best?.result, 40);
  // Only normalize when unambiguous: explicit /4 scale, or no scale and value within 0-4.
  const cgpa = g && (g.scale === 4 || (g.scale === null && g.value <= 4)) ? g.value : null;

  // ---- experience
  const expYears = flat.match(/total\s+(?:years?\s+of\s+)?(?:job\s+)?experience\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)/i)
    ?? flat.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:\w+\s+){0,3}experience/i)
    ?? flat.match(/experience\s*[:\-]?\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/i);
  const totalExperienceYears = expYears ? Number(expYears[1]) : null;

  const expLines = sectionLines('experience');
  const applied = own.slice(0, 5).filter((l) => /^job\s*title\s*:/i.test(l)); // Bdjobs: the post applied for, not a job held
  const labelSource = own.filter((l) => !applied.includes(l));
  let jobs = bdjobsJobs(expLines.length ? expLines : own);
  if (!jobs.length) jobs = labelledJobs(labelSource);
  if (!jobs.length && expLines.length) jobs = datedJobs(expLines);
  jobs = jobs.filter((j) => j.title || j.org).map((j) => ({ title: j.title && j.title.replace(/\s+,/g, ','), org: j.org && j.org.replace(/\s+,/g, ',') }));
  const lastPosition = clean(jobs[0]?.title, 300);
  const workplace = clean(jobs[0]?.org ?? labelSource.map((l) => l.match(ORG_LABEL)?.[1]).find(Boolean), 300);
  const previousJobs = jobs.length ? uniq(jobs.map(jobText)).slice(0, 10).join('\n') : null;

  // ---- skills: the skills section, plus Bdjobs "Area of Expertise" lines under each job
  let rawSkills = sectionLines('skills');
  // Bdjobs repeats the bullet list as HTML under "Description"; keep the list.
  const firstBullet = rawSkills.findIndex((l) => /^[•▪●◦]/.test(l));
  if (firstBullet !== -1 && rawSkills.some((l) => /<\/?p>|<\/$|^p>/i.test(l))) {
    rawSkills = rawSkills.filter((l, i) => i < firstBullet || /^[•▪●◦]/.test(l));
  }
  const skillLines = rawSkills.map((l) => decodeHtml(l)).flatMap((l) => l.split(/\s*•\s*/)).map((l) => bullet(l.split('\t')[0]))
    .filter((l) => l && !/^(?:description|fields?\s+of\s+skills?|no description provided|competencies|interests|total\s+(?:years?\s+of\s+)?experience\b.*)$/i.test(l));
  const skillItems: string[] = [];
  for (const l of skillLines) {
    const prev = skillItems[skillItems.length - 1];
    if (prev && (/[,&/(]$|\b(?:and|with|of|in)$/i.test(prev) || /^[a-z(]/.test(l))) skillItems[skillItems.length - 1] = `${prev} ${l}`;
    else skillItems.push(l);
  }
  const expertise = lines.flatMap((l, i) => (/^area\s+of\s+expertise\s*:?$/i.test(l) && lines[i + 1] ? lines[i + 1].split(/,\s*/) : []))
    .map((s) => s.replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:yrs?|years?|months?)\s*\)\s*/gi, '').trim()).filter(Boolean);
  const inlineSkills = skillItems.length ? [] : [flat.match(/\b(?<!of\s)(?:skills?|technical skills|key skills|expertise)[ \t]*[:\-][ \t]*([^.\n]{3,200})/i)?.[1] ?? ''];
  const skillList = uniq([...skillItems, ...inlineSkills, ...expertise].map((s) => clean(s.replace(/\s+\./g, '.'), 200)).filter((s): s is string => !!s));
  const skills = skillList.length ? clean(skillList.slice(0, 30).join(', '), 1500) : null;

  // ---- trainings and certifications
  const certItems: string[] = [];
  const certLines = sectionLines('training', 'certifications');
  const hasRows = certLines.some((l) => tableRow(l));
  for (const l of certLines) {
    const row = tableRow(l);
    if (!row && hasRows) continue; // side headings and leftovers next to a table
    if (row) {
      const t = row['training title'] ?? row['training'] ?? row['certification'] ?? row['title'];
      if (!t) continue;
      const extra = [row['institute'], row['year'] ?? row['from']?.match(/(?:19|20)\d{2}/)?.[0]].filter(Boolean).join(', ');
      certItems.push(extra ? `${t} (${extra})` : t);
      continue;
    }
    const v = bullet(l.replace(/\t/g, ' '));
    if (!v || /^(?:training\s+title|certification\s+institute|title\s+topic)/i.test(v)) continue;
    const prev = certItems[certItems.length - 1];
    if (prev && !/^[•\-*▪]/.test(l) && (/[,&(—–\-]$|\b(?:and|of|in|on|for)$/i.test(prev) || /^[a-z(]/.test(v))) certItems[certItems.length - 1] = `${prev} ${v}`;
    else certItems.push(v);
  }
  const certifications = certItems.length ? clean(uniq(certItems.map((c) => clean(c.replace(/\s+\./g, '.'))!).filter(Boolean)).slice(0, 15).join('; '), 2000) : null;

  // ---- salary, age, address
  const sal = flat.match(/expected\s+salary\s*[:\-]?\s*((?:BDT|Tk\.?|৳)?\s*[\d,]+(?:\s*k)?(?:\s*(?:BDT|Tk|taka))?)/i);
  const expectedSalary = clean(sal?.[1], 60);

  let age: number | null = null;
  const ag = flat.match(/\bAge\s*[:\-]\s*(\d{2})\b/i);
  if (ag) age = Number(ag[1]);
  else {
    const dobLine = own.find((l) => /\b(?:date\s+of\s+birth|d\.?\s?o\.?\s?b|birth\s+date)\b/i.test(l));
    const idx = dobLine ? own.indexOf(dobLine) : -1;
    const dob = dobLine ? parseDate(dobLine) ?? (own[idx + 1] ? parseDate(own[idx + 1]) : null) : null;
    if (dob) {
      const today = hints.today ?? new Date();
      let years = today.getUTCFullYear() - dob.getUTCFullYear();
      if (today.getUTCMonth() < dob.getUTCMonth() || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())) years--;
      if (years >= 14 && years <= 80) age = years;
    }
  }

  // Address: a labelled present / mailing address, else the unlabelled address in the CV header, else the permanent one.
  const LABEL_LINE = /^[A-Za-z’'. ]{2,30}\s*[:\-–]\s/;
  const addressAt = (re: RegExp) => {
    const i = own.findIndex((l) => re.test(l));
    if (i === -1) return null;
    let v = own[i].replace(re, '').trim();
    let k = i + 1;
    if (!v && own[k] && !LABEL_LINE.test(own[k]) && !headingKind(own[k])) v = own[k++];
    if (!v) return null;
    // Address lines that wrap: a trailing comma, or a next line that is clearly part of an address.
    for (let n = 0; n < 2 && own[k] && !LABEL_LINE.test(own[k]) && !headingKind(own[k]) && !phoneOf(own[k]) && !/@/.test(own[k]); n++, k++) {
      if (/[,\-]$/.test(v) || (own[k].length <= 60 && BD_PLACE.test(own[k]) && !/:/.test(own[k]))) v = `${v} ${own[k]}`; else break;
    }
    return clean(v.split('\t')[0], 400);
  };
  const header = () => {
    const ni = name ? own.findIndex((l) => l.replace(/\s+/g, ' ').toLowerCase().includes(name!.toLowerCase())) : -1;
    const pi = own.findIndex((l) => !!phoneOf(l) || /@/.test(l));
    // Bdjobs and many plain CVs: the address sits between the name and the phone / email lines.
    if (ni !== -1 && pi > ni && pi - ni <= 4) {
      const between = own.slice(ni + 1, pi).filter((l) => !TITLE_WORDS.test(l) || looksLikeAddress(l));
      if (between.length && between.some((l) => looksLikeAddress(l) || BD_PLACE.test(l))) return clean(between.join(' '), 400);
    }
    // A contact block: consecutive address-like lines (or first cells) near the top.
    const top = own.slice(0, 14).map((l) => cellsOf(l)[0] ?? '');
    const start = top.findIndex((c) => looksLikeAddress(c) || (/^(?:house|flat|holding|vill(?:age)?|road)\b/i.test(c) && BD_PLACE.test(c)));
    if (start === -1) return null;
    const parts = [top[start]];
    for (let k = start + 1; k < top.length && parts.length < 3 && (looksLikeAddress(top[k]) || (/[,]$/.test(parts[parts.length - 1]) && !phoneOf(top[k]) && !/@/.test(top[k]))); k++) parts.push(top[k]);
    return clean(parts.join(' '), 400);
  };
  const address = addressAt(/^(?:present|current|mailing|contact)\s+add?ress\s*[:\-–]?\s*/i) ?? addressAt(/^present\s*:\s*/i)
    ?? addressAt(/^add?ress\s*[:\-–]\s*|^add?ress$/i) ?? header() ?? addressAt(/^permanent\s+add?ress\s*[:\-–]?\s*/i);

  return {
    name: clean(name, 200), email: clean(email, 200), phone: clean(phone, 60), degree: clean(degree, 300), specialization: clean(specialization, 300),
    education, institution: clean(institution, 300), cgpaRaw, cgpa, totalExperienceYears, lastPosition, workplace, skills, address, certifications,
    previousJobs, expectedSalary, age,
  };
}
