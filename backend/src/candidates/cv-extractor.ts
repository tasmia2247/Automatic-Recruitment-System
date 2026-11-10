import * as path from 'path';
import { docKind } from '../common/file-kind';
import { layoutPdf, readPdfPages } from './pdf-layout';

export const EXTRACTOR_VERSION = 'rules-2.2'; // 2.2 (2026-11-09): Word .doc files; name from the closing signature

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

/**
 * Text whose fonts carry no character map comes out as control codes ("\u001f\u001e..."), not letters: such a CV cannot be
 * read and must be reviewed by hand, rather than extracted as if it were empty.
 */
function assertReadable(t: CvText): CvText {
  const visible = t.text.replace(/\s+/g, '');
  const junk = (visible.match(/[\u0000-\u001f�]/g) ?? []).length;
  if (visible.length && junk / visible.length > 0.3) {
    throw new Error('The CV text cannot be read (the PDF fonts have no text mapping, or it is a scanned image). Please review it manually.');
  }
  return t;
}

/** Reads a stored CV: its text in reading order, plus layout hints. Throws on unreadable/unsupported content. */
export async function readCv(buffer: Buffer, fileName: string): Promise<CvText> {
  return assertReadable(await readCvText(buffer, fileName));
}

async function readCvText(buffer: Buffer, fileName: string): Promise<CvText> {
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
  if (ext === '.docx') return readDocx(buffer);
  if (ext === '.doc') return readDoc(buffer);
  throw new Error(`Text extraction is not supported for ${ext} files; please review manually or upload PDF, DOC or DOCX.`);
}

async function readDocx(buffer: Buffer): Promise<CvText> {
  const mammoth = await import('mammoth');
  const res = await mammoth.extractRawText({ buffer });
  return { text: res.value, nameHint: null };
}

/**
 * Old Word CVs (owner, 2026-11-09). Word 97-2003 files are read with `word-extractor` (body, headers, footnotes, text boxes);
 * a ".doc" that is really a DOCX, an RTF or a saved web page is read as what it is.
 */
async function readDoc(buffer: Buffer): Promise<CvText> {
  const kind = docKind(buffer);
  if (kind === 'docx') return readDocx(buffer);
  if (kind === 'rtf') return { text: rtfToText(buffer.toString('latin1')), nameHint: null };
  if (kind === 'html') return { text: htmlToText(buffer.toString('utf8')), nameHint: null };
  if (kind !== 'ole') throw new Error('This .doc file is not a Word document that can be read; open it in Word and save it as PDF or DOCX.');
  const WordExtractor = (await import('word-extractor')).default;
  const doc = await new WordExtractor().extract(buffer);
  const parts = [doc.getHeaders({ includeFooters: false }), doc.getBody(), doc.getTextboxes({ includeHeadersAndFooters: false }), doc.getFootnotes(), doc.getEndnotes()];
  // Word keeps paragraph marks as \r and table cells as \x07; tabs and non-breaking spaces become plain spaces.
  const text = parts.filter((p) => p?.trim()).join('\n')
    .replace(/\r\n?/g, '\n').replace(/\x07/g, '\t').replace(/[\x0b\x0c]/g, '\n').replace(/ /g, ' ').replace(/[\x00-\x08\x0e-\x1f]/g, '');
  return { text, nameHint: null };
}

/** Plain text of an RTF document: control words dropped, \par as line breaks, \'xx and \uN characters decoded. */
export function rtfToText(rtf: string): string {
  let out = '';
  let depth = 0;
  const skipAt: number[] = [];
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i];
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { if (skipAt.length && skipAt[skipAt.length - 1] === depth) skipAt.pop(); depth--; continue; }
    if (ch === '\\') {
      const m = /^\\(?:([a-zA-Z]+)(-?\d+)? ?|'([0-9a-fA-F]{2})|(.))/.exec(rtf.slice(i, i + 40));
      if (!m) continue;
      i += m[0].length - 1;
      if (skipAt.length) continue;
      const [, word, num, hex, sym] = m;
      if (word) {
        if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator'].includes(word)) skipAt.push(depth);
        else if (word === 'par' || word === 'line' || word === 'row') out += '\n';
        else if (word === 'tab' || word === 'cell') out += '\t';
        else if (word === 'u' && num) { out += String.fromCharCode((Number(num) + 65536) % 65536); if (rtf[i + 1] === '?') i++; }
      } else if (hex) out += String.fromCharCode(parseInt(hex, 16));
      else if (sym === '*') skipAt.push(depth);
      else if (sym === '~') out += ' ';
      else if (sym && '\\{}'.includes(sym)) out += sym;
      continue;
    }
    if (skipAt.length || ch === '\r' || ch === '\n') continue;
    out += ch;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text of a web page saved as .doc: block tags as line breaks, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n').replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Closing lines of a letter-style CV, never a name ("Thanking You", "Yours faithfully", "Signature"). */
const CLOSING = /\b(?:thank|sincere|yours|faithful|regards|signature|declar|truly|obedient)/i;

/** Converts a stored CV file to plain text. Throws on unreadable/unsupported content. */
export async function cvToText(buffer: Buffer, fileName: string): Promise<string> {
  return (await readCv(buffer, fileName)).text;
}

// ------------------------------------------------------------------ helpers

/**
 * Bullet marks CVs start a line with: the usual ones, emoji ticks, and the private-use symbols of Wingdings / Symbol fonts
 * (U+E000-U+F8FF), which PDFs of Word CVs often carry ("" before every skill).
 */
const BULLET_CHARS = '\\-*•▪●◦➢►➤✓✔✅❖■□◆◇○→⇒⮚\\uE000-\\uF8FF';
const LEAD_BULLETS = new RegExp(`^[\\s${BULLET_CHARS}]+`);
/** A line or cell that really starts with a bullet mark (not just with spaces). */
const BULLET_START = new RegExp(`^\\s*[${BULLET_CHARS}]`);
function clean(s: string | undefined | null, max = 2000) {
  const t = (s ?? '').replace(/\s+/g, ' ').replace(new RegExp(`^[\\s,;:|–—${BULLET_CHARS}]+|[\\s,;|\\-–—•▪●◦*\\uE000-\\uF8FF]+$`, 'g'), '').trim();
  return t ? t.slice(0, max) : null;
}
const bullet = (l: string) => l.replace(LEAD_BULLETS, '').replace(/^\d{1,2}[.)]\s*/, '').trim();
const decodeHtml = (s: string) => s.replace(/<\/?\s*[a-z]+[^>]*>?/gi, ' ').replace(/<\/?$/g, ' ').replace(/^\s*p>/i, ' ')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
};

/** Splits a line into its cells: tab gaps from the PDF layout and " | " separators ("AIUB | 2021 | CGPA: 3.79"). */
const cellsOf = (l: string) => l.split(/\t|\s+\|\s+/).map((c) => c.replace(/^\|\s*|\s*\|$/g, '').trim()).filter(Boolean);
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
  ['other', /^(?:leadership\s*(?:&|and)\s*)?extra\s*-?\s*curricul(?:ar|um)(?:\s+activities|\s+experiences?)?|^(?:career|job)\s+objectives?$|^objectives?$|^(?:career|professional|executive)\s+summary$|^summary(?:\s+of\s+(?:qualifications?|accomplish\s*ment))?$|^summery\s+of(?:\s+accomplish\s*ment)?$|^profile$|^(?:self|career|professional|personal|my)\s+profile$|^(?:personal\s+)?profile\s+summary$|^about\s+me$|^special\s+qualifications?$|^contact(?:\s+(?:me|details|info(?:rmation)?))?$|^languages?(?:\s+(?:proficiency|skills?))?$|^career\s+and\s+application\s+information$|^declaration$|^hobbies?$|^interests$|^projects?$|^achievements?$|^awards?(?:\s*(?:&|and)\s*achievements?)?$|^customers$|^(?:selected\s+)?(?:global\s+)?brands?(?:\s+exposure)?$|^buyers?(?:\s+handled)?$|^(?:key\s+)?clients$|^business\s+travel$|^responsibilit(?:y|ies)$|^key\s+responsibilities$|^signature$/i],
  ['experience', /^(?:(?:work|working|professional|employment|job|career|industrial|relevant|internship)\s+){0,2}(?:experiences?|history)$|^employment(?:\s+(?:history|record))?$|^career\s+history$|^experiences?\s+(?:details|summary)$/i],
  ['education', /^(?:education(?:al)?(?:\s+(?:qualifications?|background|details|summary))?|academic(?:\s+(?:qualifications?|background|profile|records?|credentials|details))?|academic\s*\/\s*education|educational\s+qualifications?)$/i],
  ['skills', /^(?:(?:core|key|technical|computer|it|professional|soft|software|application|relevant|digital)\s+)?skills?(?:\s*(?:&|and)(?:\s*(?:competencies|interests|expertise|abilities|tools))?)?$|^applicationskills?$|^(?:fields?\s+of\s+)?expertise$|^(?:core\s+|key\s+)?competencies$|^key\s+proficiencies$|^skills?\s+summary$|^(?:digital|software|design|technical)(?:\s*(?:&|and)\s*\w+)?\s+tools$/i],
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
const JOB_SUBHEADING = /^(?:key\s+|job\s+|main\s+)?(?:responsibilit(?:y|ies)|achievements?|duties(?:\s*\/\s*responsibilities)?)(?:\s*(?:&|and)\s*achievements?)?$/i;

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
    // "Key Responsibilities:" / "Key Achievements:" or "Selected brands: Zara, H&M" under a job belong to that job, not a section of their own.
    if (kind === 'other' && sections[sections.length - 1].kind === 'experience' && (rest || JOB_SUBHEADING.test(l.replace(/[:：]\s*$/, '').trim()))) kind = null;
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
  // "MS" is a master's, but "MS Office" / "MS Excel" in a skills list is software.
  [2, /^(?:masters?\b|e\.?\s?m\.?\s?b\.?\s?a\b|m\.?\s?b\.?\s?a\b|m\.?\s?sc\b|m\.?\s?s\.?\s?s\b|m\.?\s?b\.?\s?s\b|m\.?\s?com\b|m\.?\s?a\b|m\.?\s?eng\b|m\.?\s?s\b(?!\s*-?\s*(?:office|excel|word|power\s*point|powerpoint|outlook|project|access|teams|dynamics|sql|visio|windows|dos|paint))|ll\.?\s?m\b|m\.?\s?pharm\b|m\.?\s?ed\b|m\.?\s?tech\b)/i],
  [4, /^(?:bachelor|b\.?\s?sc\b|b\.?\s?b\.?\s?a\b|b\.?\s?b\.?\s?s\b|b\.?\s?s\.?\s?s\b|b\.?\s?com\b|b\.?\s?a\b|b\.?\s?eng\b|b\.?\s?tech\b|b\.?\s?pharm\b|b\.?\s?ed\b|b\.?\s?s\b|ll\.?\s?b\b|honou?rs\b|undergraduate\b|graduat(?:e|ion)\b|degree\s+pass\b|fazil\b|kamil\b)/i],
  [5, /^diploma\b/i],
  // Misspellings seen in real CVs ("Higher Secoundary Certificet"); P.U.C. and S.S.L.C. are the Indian HSC and SSC.
  [6, /^(?:h\.?\s?s\.?\s?c\b|higher\s+seco?u?ndary|alim\b|a\s*-?\s*levels?\b|intermediate\b|p\.?\s?u\.?\s?c\b)/i],
  [7, /^(?:s\.?\s?s\.?\s?c\b|s\.?\s?s\.?\s?l\.?\s?c\b|seco?u?ndary\s+school|dakhil\b|o\s*-?\s*levels?\b|matriculation\b)/i],
];
/** Drops what may stand before a degree: bullets, ticks, a year or a numbering ("2017| BBA", "• MBA", "✅ Master of Arts"). */
const degreeStart = (s: string) => s.replace(/^[^A-Za-z]+(?=[A-Za-z])/, '').trim();
/** 0 = PhD ... 4 = bachelor, 5 = diploma, 6 = HSC, 7 = SSC; -1 when the text does not start with a degree. */
export const degreeRank = (s: string) => {
  const t = degreeStart(s);
  for (const [r, re] of DEGREES) if (re.test(t)) return r;
  return -1;
};
/** The degree word(s) a text starts with ("BSc", "Bachelor", "MBA"), or null. */
export const degreeToken = (s: string) => {
  const t = degreeStart(s);
  for (const [, re] of DEGREES) { const m = t.match(re); if (m) return m[0]; }
  return null;
};
const INSTITUTION = /\b(?:university|college|institute|institution|polytechnic|school|academy|madrasa|madrasah|madrasha|coll?age|iut|buet|butex|buft|bift|nift|aiub|nsu|bracu?)\b/i;
const RESULT = /\b(?:c?gpa|cgpa|out\s+of|class|division|grade|marks?|first|second|third|distinction|passed|appeared|awarded|enrolled|running|result)\b|\d{1,3}(?:\.\d+)?\s*%/i;
export const INCOMPLETE = /\b(?:enrolled|appeared|running|pursuing|ongoing|continuing|current(?:ly)?|expected|in\s+progress|level\s*\d|semester|final\s+year|\d(?:st|nd|rd|th)\s+year)\b/i;
/** Labels written before an education value ("Name of the University : X", "Institute: X", "Major: Y"). */
const INSTITUTE_LABEL = /^(?:name\s+of\s+(?:the\s+)?(?:university|college|institut\w*|school|board)|institut(?:e|ion)(?:\s+name)?|university|college|school|board)\s*[:\-–]\s*/i;
const SUBJECT_LABEL = /^(?:subject|major|concentration(?:\s*\/\s*major)?|discipline|department|group|specialization)\s*[:\-–]\s*(.+)$/i;
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
    // "MBA (Accounting)", "M.Com (Finance)"; not the degree's own abbreviation "(M.B.A)", "(BSS)" or "(Hons.)".
    [title.match(/\(([A-Za-z][A-Za-z&/.\-' ]{2,70})\)/)?.[1]].find((v) => v && !/^[A-Z.\s'’]{1,9}$/.test(v) && !/\bhons?\b|honou?rs/i.test(v)),
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
    ?? s.match(/\b(\d\.\d{1,2})\s*\(?\s*(?:\/|out\s+of|on\s+a\s+scale\s+of)\s*(\d(?:\.\d{1,2})?)\s*\)?/i);
  if (!m) return null;
  // A closing bracket the match took without its opening one ("(CGPA 3.39/4.00)" read from "CGPA") is dropped.
  const raw = m[0].replace(/\s+/g, ' ').trim();
  return { raw: !raw.includes('(') ? raw.replace(/\s*\)$/, '') : raw, value: Number(m[1]), scale: m[2] ? Number(m[2]) : null };
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
      year: row['pass.year'] ?? row['pas.year'] ?? row['pass year'] ?? row['pass. year'] ?? row['passing year'] ?? row['year'] ?? null,
      incomplete: INCOMPLETE.test(result ?? ''),
    });
  }
  if (entries.length) return entries;

  // Free text: each degree line opens an entry; the lines under it (up to the next degree) hold its institute and result.
  // A labelled degree ("Graduation : BBA") counts by its value; "Dakhil Madrasha" is an institute, not a degree.
  const degreeCell = (c: string) => {
    const v = c.match(/^[A-Za-z .]{2,30}\s*:\s*(.+)$/)?.[1];
    const cell = v && degreeRank(v) >= 0 ? v : c;
    return degreeRank(cell) >= 0 && !/^\W*(?:dakhil|alim|fazil|kamil)\s+madras/i.test(cell) ? cell : null;
  };
  const starts = lines.map((l, i) => ({ i, cell: cellsOf(l).map(degreeCell).find(Boolean) })).filter((x) => x.cell);
  starts.forEach(({ i, cell }, n) => {
    const end = Math.min(n + 1 < starts.length ? starts[n + 1].i : lines.length, i + 7);
    const text = degreeStart(cell!);
    // "MBA in HRM from BRAC University with CGPA 2.74 out of 4 in 2019", "PGDHRM under AIUB 2025".
    const from = text.match(/\s(?:from|at|under)\s+(.+?)(?=\s+(?:with|in\s+(?:19|20)\d{2})\b|\s*[,(;]|\s+(?:19|20)\d{2}|\s*$)/i)?.[1];
    // "M.Com (Finance) – Gulbarga University", "BSc - Dhaka University": what follows a spaced dash is the institute.
    const [titleText, ...dashed] = text.split(/\s+[–—]\s+|\s+-\s+(?=(?:19|20)\d{2}|[^,]*\b(?:university|college|institute|school|madras\w*)\b)/i);
    const [titlePart, ...afterComma] = titleText.split(/,\s*/);
    const title = clean(titlePart.split(/\s+(?:from|at|under)\s+|\s*\(\s*c?gpa|\s+c?gpa\b/i)[0]
      .replace(/[\s,\-–(]*\(?(?:19|20)\d{2}\)?\s*$/, ''))!; // "Masters of Laws (LL.M) 2019", "MBA in Management -2018"
    const labelled: string[] = [];
    const pieces = [...afterComma, ...dashed, ...(from ? [from] : []), ...cellsOf(lines[i]).filter((c) => !c.includes(cell!)), ...lines.slice(i + 1, end).flatMap(cellsOf)]
      .filter((c) => !/^affiliated\b/i.test(c))
      .map((c) => { const s = c.match(SUBJECT_LABEL)?.[1]; if (s) labelled.push(s); return c.replace(INSTITUTE_LABEL, ''); });
    const insts = pieces.filter((c) => INSTITUTION.test(c) && !SUBJECT_LABEL.test(c));
    // Some CVs write the institute on the line above the degree.
    const above = i > 0 && (n === 0 || starts[n - 1].i < i - 1) ? cellsOf(lines[i - 1]).find((c) => INSTITUTION.test(c) && degreeRank(c) < 0) : undefined;
    // Without what follows the name on the same cell: "| 2021", "CGPA: 3.63( 2025)", a trailing year.
    let institute = clean((insts.find((c) => !/\bboard\b/i.test(c)) ?? above ?? insts[0])?.replace(/\s*\|.*$/, '').replace(/[\s,(]*\b(?:c?gpa|result)\b.*$/i, '').replace(/[\s,]*(?:19|20)\d{2}\s*$/, ''));
    // An institute name wrapped onto the next line ("BANGLADESH UNIVERSITY OF" / "TEXTILES").
    const at = institute ? pieces.findIndex((c) => clean(c) === institute) : -1;
    if (institute && at >= 0 && /\b(?:of|and|&|for|the)$/i.test(institute) && pieces[at + 1] && /^[A-Za-z&.' ]{3,40}$/.test(pieces[at + 1])) institute = clean(`${institute} ${pieces[at + 1]}`);
    const all = [text, ...pieces].join(' \n ');
    const g = gpaOf(all);
    const marks = all.match(/(?:first|second|third)\s+(?:class|division)[^\n]{0,20}|\d{1,3}(?:\.\d+)?\s*%/i)?.[0];
    const subjectLine = labelled.find((s) => !GENERIC_FIELD.test(s.trim())) ?? rankSubject(afterComma[0], pieces, institute);
    entries.push({
      title, rank: degreeRank(title), institute,
      // "PGDHRM", "PGDBA": the subject is written into the degree's own abbreviation.
      subject: subjectOf(title, subjectLine, labelled.length > 0) ?? title.match(/^\W*PGD([A-Z]{2,6})\b/)?.[1] ?? null,
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
const ORG_WORDS = /\b(?:ltd\.?|limited|plc|inc\.?|llc|group|company|co\.|(?<=&\s?)co|corporation|corp\.?|mills?|industries|industry|bank|textiles?|fashions?|apparels?|garments?|knit\w*|composite|washing|wash|denims?|dyeing|sweaters?|international|enterprises?|holdings|trading|solutions?|technologies|pharma\w*|university|college|school|foundation|associates|agency|factory|plant|organization|organisation|ngo|services)\b/i;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
// "May'25" / "Jan’25" (a two-digit year after an apostrophe) as well as full dates.
const DATE = `(?:${MONTH}\\s*['’‘]\\s*\\d{2}\\b|(?:\\d{1,2}(?:st|nd|rd|th)?[\\s/.\\-]+)?${MONTH},?\\s*(?:\\d{1,2},?\\s*)?(?:19|20)\\d{2}|(?:\\d{1,2}[/.\\-]){1,2}(?:19|20)\\d{2}|(?:19|20)\\d{2})`;
const END = `(?:present|current(?:ly)?|continu(?:e|ing)|running|till\\s*(?:now|date|today)|to\\s+date|now|ongoing|${DATE}|${MONTH}\\s*\\d{2}\\b)`;
const DATE_RANGE = new RegExp(`\\(?\\s*(?:${DATE}|${MONTH})\\s*(?:-|–|—|‐|‑|−|to|till|until)\\s*${END}\\s*\\)?|${MONTH}\\s*(?:-|–|—|‐|to)\\s*${MONTH}\\s*(?:19|20)\\d{2}`, 'i');

const TITLE_LABEL = /^(?:#\s*)?(?:(?:current|present|last|latest|previous|former)\s+)?(?:job\s+position|position(?:\s+held)?|designation(?:\s+held)?|job\s*title|job\s+role|role|post)\s*[:\-–]\s*(.{2,100})$/i;
const ORG_LABEL = /^(?:#\s*)?(?:(?:current|present|last|previous|former)\s+)?(?:company(?:\s+name)?|organi[sz]ation(?:\s+name)?|employer|institution\s+name|office)\s*[:\-–]\s*(.{2,120})$/i;

/** A job held: its title, organization and, when written, its start and end ("Feb 2024", "Present"). */
interface Job { title: string | null; org: string | null; from?: string | null; to?: string | null }
/** A date range split into its start and end. */
const RANGE_PARTS = new RegExp(`(${DATE}|${MONTH})\\s*(?:-|–|—|‐|‑|−|to|till|until)\\s*(${END})`, 'i');
const periodOf = (s: string | undefined): Pick<Job, 'from' | 'to'> => {
  const m = s?.match(RANGE_PARTS);
  return m ? { from: clean(m[1]), to: clean(m[2]) } : {};
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ONGOING = /present|current|continu|running|till|to\s+date|\bnow\b|ongoing/i;
/** A start or end date as a month count (year * 12 + month); a year alone counts from mid-year. */
function monthOf(s: string, today: Date): number | null {
  if (ONGOING.test(s)) return today.getUTCFullYear() * 12 + today.getUTCMonth();
  let year = s.match(/(?:19|20)\d{2}/)?.[0];
  if (!year) { const two = s.match(/['’‘]\s*(\d{2})\b|\b(\d{2})\s*$/); if (two) year = `20${two[1] ?? two[2]}`; }
  if (!year) return null;
  const word = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)?.[1];
  const num = s.match(/^\s*(?:\d{1,2}[/.\-])?(\d{1,2})[/.\-](?:19|20)\d{2}/)?.[1];
  const month = word ? MONTHS.indexOf(word.toLowerCase()) : num && +num >= 1 && +num <= 12 ? +num - 1 : 6;
  return +year * 12 + month;
}
/**
 * Years of experience worked out from the jobs' dates, for CVs that do not state a total: overlapping jobs count once,
 * internships do not count. Null when no job has a usable start date.
 */
export function yearsFromJobs(jobs: Job[], today: Date): number | null {
  const now = today.getUTCFullYear() * 12 + today.getUTCMonth();
  const spans = jobs.filter((j) => j.from && !/\bintern(?:ship)?\b/i.test(j.title ?? ''))
    .map((j) => [monthOf(j.from!, today), j.to ? monthOf(j.to, today) : null] as const)
    .filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null && x[0] >= 1970 * 12 && x[1] >= x[0] && x[0] <= now)
    .map(([a, b]) => [a, Math.min(b, now) + 1] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  if (!spans.length) return null;
  let months = 0;
  let [s, e] = spans[0];
  for (const [a, b] of spans.slice(1)) {
    if (a <= e) e = Math.max(e, b);
    else { months += e - s; [s, e] = [a, b]; }
  }
  months += e - s;
  const years = Math.round((months / 12) * 10) / 10;
  return years > 0 && years <= 50 ? years : null;
}
/** Cells of a job line that are neither title nor company. */
const NOT_JOB = /^(?:full[\s-]?time|part[\s-]?time|internship|contract(?:ual)?|remote|on-?site|onshore|offshore|hybrid|permanent|temporary|freelance)$/i;
/** Place words that, with BD_PLACE, make a cell a bare location ("Konabari", "Kerala | India" is not caught; "Dhaka, Bangladesh" is). */
const PLACE_WORD = /^(?:india|pakistan|sri\s*lanka|vietnam|china|konabari|ashulia|kaliakoir|chattogram|\d{4})$/i;
const isPlace = (c: string) => c.split(/[\s,]+/).filter(Boolean).every((w) => BD_PLACE.test(w) || PLACE_WORD.test(w));
const jobText = (j: Job) => [j.title, j.org].filter(Boolean).join(', ') + (j.from ? ` (${j.from} – ${j.to ?? '?'})` : '');
const stripDuration = (s: string) => s.replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:yrs?|years?|months?)\s*\)\s*$/i, '').trim();

/** Bdjobs entries: "1. Deputy Manager (9.1yrs)" / "(5 Oct 2017 - Continuing)" / "Soorty Textile (BD) Ltd.". */
function bdjobsJobs(lines: string[]): Job[] {
  const jobs: Job[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:\d{1,2}\.\s*)?(.{2,120}?)\s*\(\s*\d+(?:\.\d+)?\s*(?:yrs?|years?|months?)\s*\)$/i);
    const next = lines[i + 1] ?? '';
    if (!m || !/^\(.*(?:19|20)\d{2}.*\)$/.test(next)) return;
    const org = lines[i + 2] && !/^(?:area of expertise|duties)/i.test(lines[i + 2]) ? lines[i + 2] : null;
    jobs.push({ title: clean(m[1]), org: clean(org), ...periodOf(next) });
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
    // "CUTTING EDGE INDUSTRIES LTD. (MBM GROUP)" over "Designation: Asst. Manager": an unlabelled company line next to it.
    if (!near && firstOrg === -1) near = [lines[i - 1], lines[i + 1]].find((n) => n && ORG_WORDS.test(n) && !/[:•▪]/.test(n) && !BULLET_START.test(n) && n.length <= 90 && !DATE_RANGE.test(n));
    // The job's dates: the nearest date line after it ("Duration: 01 Feb 2024 – Till Date"), else before it, never past another job.
    let period: Pick<Job, 'from' | 'to'> = periodOf(t);
    for (const dir of [1, -1]) {
      for (let k = 1; !period.from && k <= 3; k++) {
        const n = lines[i + dir * k];
        if (!n || TITLE_LABEL.test(n)) break;
        period = periodOf(n);
      }
    }
    const [title, atOrg] = t.split(/\s+\|\s+/)[0].split(/\s+(?:at|@)\s+/);
    jobs.push({ title: clean(stripDuration(title)), org: clean(atOrg ?? near), ...period });
  });
  return jobs;
}

/** Splits "Title, Company", "Company | Title | Area", "Company ( Group | Title )", "Title at Company" into title and organization. */
function splitJob(pieces: string[]): Job {
  let title: string | null = null;
  let org: string | null = null;
  const at = pieces.join(' ').match(/^(.{2,80}?)\s+(?:at|@)\s+(.{2,100})$/);
  if (at && !ORG_WORDS.test(at[1])) return { title: clean(at[1]), org: clean(at[2]) };
  // Without numbering ("1.Chief Creative Coordinator") and bare places ("Dhaka", "Bangladesh.").
  const parts = pieces.flatMap((p) => p.split(/\s*\|\s*|\s*\(\s*|\s*\)\s*|,\s+(?=[A-Z])/)).map((p) => clean(p.replace(/^\s*\d{1,2}\.\s*(?=[A-Za-z])/, '')))
    .filter((p): p is string => !!p && p.length > 1 && !isPlace(p.replace(/\.$/, '')) && !/^\d+(?:\.\d+)?\s*(?:yrs?|years?|months?)$/i.test(p));
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
    // What is left of the date line, without "[Duration:", "Full-time" or a bare location ("Dhaka, Bangladesh").
    const rest = cellsOf(l.replace(DATE_RANGE, '\t'))
      .map((c) => c.replace(/\(\s*\)|[[\]]/g, '').replace(/^(?:duration|period|tenure|time|date)\s*:?\s*/i, '').replace(/[,;:\-–]\s*$/, '').trim())
      .filter((c) => c && !NOT_JOB.test(c) && !isPlace(c));
    const pieces = [...rest];
    let job = splitJob(pieces);
    for (let k = i + 1; k < Math.min(lines.length, i + 4) && (!job.title || !job.org); k++) {
      const n = lines[k];
      if (DATE_RANGE.test(n) || BULLET_START.test(n) || n.length > 70 || (n.match(/\b[a-z]{3,}\b/g) ?? []).length >= 3 || /[:•▪]/.test(n) || (/\.$/.test(n) && !ORG_WORDS.test(n)) || /^[a-z]/.test(n)) break;
      pieces.push(n);
      job = splitJob(pieces);
    }
    // Still missing: title and company on the line above the dates ("1. Florence Group (Golden Stitch Design Ltd.)\tSavar, Dhaka",
    // "Senior Executive – Finance & Accounts | Fast Corporation Pvt. Ltd.", "• Executive Accounts & Admin"). With a title already
    // found, only a line that names a company counts (not the last duty of the job before).
    const prev = lines[i - 1];
    const titleBullet = !!prev && BULLET_START.test(prev) && TITLE_WORDS.test(prev) && prev.split(/\s+/).length <= 8;
    if ((!job.org || !job.title) && prev && !DATE_RANGE.test(prev) && (!BULLET_START.test(prev) || titleBullet)
      && !/:$/.test(prev) && !(/\.$/.test(prev) && !ORG_WORDS.test(prev)) && prev.length <= 100) {
      const cells = cellsOf(bullet(prev)).map((c) => clean(c.replace(/^\d{1,2}\.\s*/, ''))).filter((c): c is string => !!c && !isPlace(c) && !NOT_JOB.test(c));
      const before = splitJob([...cells, ...pieces]);
      const useful = job.title ? !job.org && cells.some((c) => ORG_WORDS.test(c)) : !!(before.title || before.org);
      if (useful) job = before;
    }
    if (job.title || job.org) jobs.push({ ...job, ...periodOf(l) });
  });
  return jobs;
}

// ------------------------------------------------------------------ main

const BD_PLACE = /\b(?:road|rd\.?|house|flat|holding|sector|block|lane|village|vill\.?|para|upazila|upazilla|thana|union|district|dist\.?|post|p\.?\s?o\.?|dhaka|gazipur|chittagong|chattogram|narayanganj|savar|uttara|mirpur|tongi|ashulia|khulna|rajshahi|sylhet|barishal|barisal|rangpur|mymensingh|cumilla|comilla|bogura|bogra|tangail|kushtia|jessore|jashore|noakhali|feni|pabna|dinajpur|bangladesh|bagerhat|bandarban|barguna|bhola|brahmanbaria|chandpur|chapai\s*nawabganj|chuadanga|cox'?s\s*bazar|faridpur|gaibandha|gopalganj|habiganj|jamalpur|jhalokat?hi|jhenaidah|joypurhat|khagrachh?ari|kishoreganj|kurigram|la[kx]shmipur|lalmonirhat|madaripur|magura|manikganj|meherpur|moulvibazar|munshiganj|naogaon|narail|narsingdi|natore|netrokona|nilphamari|panchagarh|patuakhali|pirojpur|rajbari|rangamati|satkhira|shariatpur|sherpur|sirajganj|sunamganj|thakurgaon|keraniganj|jatrabari|mohammadpur|dhanmondi|gulshan|banani|badda|khilkhet|nikunja|rampura|motijheel|tejgaon|bashundhara|joydebpur|kashimpur|kaliakoir|konabari|valuka|bhaluka)\b/i;
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
  // Month and year only ("Date of Birth : Aug 1990"): the first of that month.
  m = s.match(/\b([A-Za-z]{3,9})\.?,?\s+((?:19|20)\d{2})\b/);
  if (m && mon(m[1]) >= 0) return new Date(Date.UTC(+m[2], mon(m[1]), 1));
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
    // Page footers: "-- 2 of 3 --", "Page 2 of 3", "Md. Razaul karim ‐3 | P a g e".
    .filter((l) => l && !/^-- \d+ of \d+ --$/.test(l) && !/^page \d+(?: of \d+)?$/i.test(l) && !/\|\s*p\s?a\s?g\s?e$/i.test(l));
  const { sections, kindOf } = sectionize(lines);
  const sectionLines = (...kinds: SectionKind[]) => sections.filter((s) => kinds.includes(s.kind)).flatMap((s) => s.lines);
  const own = lines.filter((_, i) => kindOf[i] !== 'references'); // the referees' contacts are not the candidate's
  const flat = own.join('\n');

  const email = clean(flat.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]);

  let phone: string | null = null;
  for (const l of own) if ((phone = phoneOf(l))) break;
  if (!phone) phone = clean(own.find((l) => /\b(?:mobile|phone|cell|contact|tel)\b/i.test(l))?.match(/\+?\d[\d\s-]{8,14}\d/)?.[0]);
  // No Bangladeshi number: an international one with its country code near the top ("+971545856049", "+91 88677 57600").
  if (!phone) {
    const intl = own.slice(0, 15).join('\n').match(/\+(?!88)\d{1,3}[\s\-]?\d[\d\s\-]{6,13}\d/)?.[0];
    if (intl && intl.replace(/\D/g, '').length >= 10) phone = `+${intl.replace(/\D/g, '')}`;
  }

  // Name: the biggest text on the first page, else a "Name:" label, else the first line that reads like a name.
  // Names are written in capitals or Title Case: a line with two or more words in lower case is a sentence ("A hard working person.").
  const nameLike = (s: string | null | undefined) => !!s && /^[A-Za-z][A-Za-z.\-' ]{2,60}$/.test(s) && s.split(/\s+/).length <= 6
    && s.split(/\s+/).filter((w) => /^[a-z]/.test(w)).length < 2
    && !/curriculum|vitae|resume|\bcv\b/i.test(s) && !headingKind(s) && !TITLE_WORDS.test(s.replace(/^md\.?\s/i, ''));
  // "Resume of Jumman Ahmed", "CV of Arijit Roy", "Imniaj Ferdous (Jyoti)": the name without the title or the nickname.
  const bare = (s: string | null | undefined) => s?.replace(/^(?:(?:curriculum\s+vitae|resume|résumé|cv|bio[\s-]?data)\s+(?:of\s+)?)/i, '')
    .replace(/\s*\([A-Za-z .]{2,20}\)\s*$/, '').trim();
  let name = nameLike(bare(hints.nameHint)) ? clean(bare(hints.nameHint)) : null;
  if (!name) {
    const label = own.map((l) => l.match(/^(?:full\s+|candidate'?s?\s+)?name\s*[:\-–]\s*([A-Za-z][A-Za-z.\-' ]{2,60})$/i)?.[1]).find(Boolean);
    name = clean(label) ?? clean(bare(own.slice(0, 10).find((l) => !/^job\s*title\b/i.test(l) && !/^(?:of|resume|cv)$/i.test(l) && !CLOSING.test(l) && nameLike(bare(l)))));
  }
  // Still none: some CVs (often old Word files) put the name only under the closing signature, "A.M. Haider ( Khokon )".
  if (!name) name = clean(bare([...own.slice(-8)].reverse().find((l) => !l.includes(':') && !CLOSING.test(l) && nameLike(bare(l)))));

  // ---- education
  const eduSection = sectionLines('education');
  let entries = educationEntries(eduSection.length ? eduSection : own.filter((l) => tableRow(l)?.['exam title']));
  if (!entries.length) entries = educationEntries(own.filter((_, i) => own.slice(Math.max(0, i - 5), i + 1).some((l) => cellsOf(l).some((c) => degreeRank(c) >= 0))));
  const best = bestDegree(entries);
  const degree = clean(best?.title);
  const specialization = clean(best?.subject?.replace(/\.$/, ''));
  const institution = clean(best?.institute ?? eduSection.flatMap(cellsOf).find((c) => INSTITUTION.test(c) && !/^affiliated/i.test(c) && !SUBJECT_LABEL.test(c))?.replace(INSTITUTE_LABEL, ''));
  const education = entries.length
    ? clean(entries.slice(0, 5).map((e) => [
      // The subject is added unless the title already has it as words ("PGDHRM" gets ", HRM"; "BSc in CSE" does not).
      [e.title, e.subject && !` ${e.title.toLowerCase().replace(/[^a-z0-9&]+/g, ' ')} `.includes(` ${e.subject.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()} `) ? e.subject : null].filter(Boolean).join(', '),
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
  const statedYears = expYears ? Number(expYears[1]) : null;

  const expLines = sectionLines('experience');
  const applied = own.slice(0, 5).filter((l) => /^job\s*title\s*:/i.test(l)); // Bdjobs: the post applied for, not a job held
  const labelSource = own.filter((l) => !applied.includes(l));
  let jobs = bdjobsJobs(expLines.length ? expLines : own);
  if (!jobs.length) jobs = labelledJobs(labelSource);
  if (!jobs.length && expLines.length) jobs = datedJobs(expLines);
  jobs = jobs.filter((j) => j.title || j.org).map((j) => ({ ...j, title: j.title && j.title.replace(/\s+,/g, ','), org: j.org && j.org.replace(/\s+,/g, ',') }));
  // A stated total wins; otherwise the years are added up from the jobs' dates (owner, 2026-11-08), like the age from a date of birth.
  const totalExperienceYears = statedYears ?? yearsFromJobs(jobs, hints.today ?? new Date());
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
  // Two bulleted columns side by side ("• HR Operations\t• Training") are two items; a plain second cell (Bdjobs years) is dropped.
  const skillLines = rawSkills.map((l) => decodeHtml(l)).flatMap((l) => l.split(/\s*[•-]\s*/))
    .flatMap((l) => { const cs = l.split('\t'); return cs.length > 1 && cs.slice(1).every((c) => BULLET_START.test(c)) ? cs : [cs[0]]; }).map((l) => bullet(l))
    .filter((l) => l && !/^(?:description|fields?\s+of\s+skills?|no description provided|competencies|interests|total\s+(?:years?\s+of\s+)?experience\b.*|\d{1,3}\s*%(?:\s+\d{1,3}\s*%)*)$/i.test(l));
  const skillItems: string[] = [];
  for (const l of skillLines) {
    const prev = skillItems[skillItems.length - 1];
    if (prev && (/[,&/(]$|\b(?:and|with|of|in)$/i.test(prev) || /^[a-z(]/.test(l))) skillItems[skillItems.length - 1] = `${prev} ${l}`;
    else skillItems.push(l);
  }
  const expertise = lines.flatMap((l, i) => (/^area\s+of\s+expertise\s*:?$/i.test(l) && lines[i + 1] ? lines[i + 1].split(/,\s*/) : []))
    .map((s) => s.replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:yrs?|years?|months?)\s*\)\s*/gi, '').trim()).filter(Boolean);
  const inlineSkills = skillItems.length ? [] : [flat.match(/\b(?<!of\s)(?:skills?|technical skills|key skills|expertise)[ \t]*[:\-][ \t]*([^.\n]{3,200})/i)?.[1] ?? ''];
  // The candidate's name printed after a sidebar skills list is not a skill.
  const skillList = uniq([...skillItems, ...inlineSkills, ...expertise].map((s) => clean(s.replace(/\s+\./g, '.'), 200))
    .filter((s): s is string => !!s && (!name || s.toLowerCase() !== name.toLowerCase())));
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
    // A degree beside a certificate is the education column next to it ("• Certified KPI Professional\t• MBA in Management -2018").
    const cells = l.split('\t');
    const v = bullet((cells.length > 1 ? cells.filter((c) => degreeRank(c) < 0) : cells).join(' '));
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
      if (between.length && between.some((l) => looksLikeAddress(l) || BD_PLACE.test(l))) return clean(between.join(' ').replace(/^(?:contact|address)\s*[:\-–]?\s*/i, ''), 400);
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
