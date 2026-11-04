import * as path from 'path';

export const EXTRACTOR_VERSION = 'rules-1.2';

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

/** Converts a stored CV file to plain text. Throws on unreadable/unsupported content. */
export async function cvToText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.txt') return buffer.toString('utf8');
  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const res = await parser.getText();
      return res.text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const res = await mammoth.extractRawText({ buffer });
    return res.value;
  }
  throw new Error(`Text extraction is not supported for ${ext} files; please review manually or upload PDF/DOCX.`);
}

const DEGREE_RE = /\b(Ph\.?\s?D|M\.?\s?Phil|MBA|EMBA|M\.?\s?Sc|M\.?\s?S\.?S|M\.?\s?Com|M\.?\s?A\b|M\.?\s?Eng|B\.?\s?Sc|BBA|B\.?\s?Com|B\.?\s?A\b|B\.?\s?S\.?S|B\.?\s?Eng|B\.?\s?Tech|LL\.?B|MBBS|Diploma|HSC|SSC|Masters?|Bachelor(?:'s)?)\b[^\n]{0,80}/i;
const DEGREE_RANK = ['phd', 'mphil', 'mba', 'emba', 'msc', 'mss', 'mcom', 'ma', 'meng', 'master', 'mbbs', 'bsc', 'bba', 'bcom', 'ba', 'bss', 'beng', 'btech', 'llb', 'bachelor', 'diploma', 'hsc', 'ssc'];

function clean(s: string | undefined | null) {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t || null;
}

/** A line that is only a CV section heading, e.g. "Education", "Work Experience:". */
const HEADING_RE = /^(?:(?:work|professional|employment|job|career)\s+)?(?:experience|history|employment(?:\s+history)?|education(?:al\s+qualifications?)?|academic\s+qualifications?|skills?|technical\s+skills|key\s+skills|certifications?|certificates?|trainings?|courses?|references?|personal\s+(?:details|information|info)|languages?|projects?|achievements?|awards?|interests?|hobbies|declaration|career\s+objective|objective|summary|profile)\s*:?$/i;
const bullet = (l: string) => l.replace(/^[-*•▪●◦]\s*/, '').trim();

/** Lines under the first heading matching `re`, up to the next heading; or the text after the heading on the same line. */
function section(lines: string[], re: RegExp, max = 8): string[] {
  const i = lines.findIndex((l) => re.test(l));
  if (i === -1) return [];
  const inline = lines[i].replace(re, '').replace(/^\s*[:\-–]\s*/, '').trim();
  if (inline) return [inline];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (HEADING_RE.test(l) || out.length >= max) break;
    out.push(bullet(l));
  }
  return out.filter(Boolean);
}

const TITLE_RE = /^(?:[-*•]\s*)?(?:(?:current|present|last|latest|previous|former)\s+)?(?:position|designation|job\s*title|role)\s*[:\-–]\s*(.{2,80})$/i;
const ORG_RE = /^(?:[-*•]\s*)?(?:(?:current|present|last|previous|former)\s+)?(?:company(?:\s+name)?|organi[sz]ation(?:\s+name)?|employer)\s*[:\-–]\s*(.{2,100})$/i;

/** Earlier jobs, newest first as written: labelled Designation / Company pairs, or "Title at Company" lines under the experience heading. */
function previousJobsFrom(lines: string[]): string | null {
  const jobs: string[] = [];
  // A CV writes each organization either just before or just after its designation; the first pair shows which.
  const firstOrg = lines.findIndex((l) => ORG_RE.test(l));
  const orgFirst = firstOrg !== -1 && firstOrg < lines.findIndex((l) => TITLE_RE.test(l));
  const offsets = orgFirst ? [-1, -2] : [1, 2];
  lines.forEach((l, i) => {
    const t = l.match(TITLE_RE)?.[1];
    if (!t) return;
    let near: string | undefined;
    for (const o of offsets) {
      const n = lines[i + o];
      if (!n || TITLE_RE.test(n)) break; // another job's designation: stop looking
      near = n.match(ORG_RE)?.[1];
      if (near) break;
    }
    const [title, atOrg] = t.split(/\s+\|\s+/)[0].split(/\s+(?:at|@)\s+/);
    const org = clean(atOrg ?? near);
    jobs.push(org ? `${clean(title)}, ${org}` : clean(title)!);
  });
  if (!jobs.length) {
    for (const l of section(lines, /^(?:(?:work|professional|employment|job|career)\s+)?(?:experience|history|employment(?:\s+history)?)\s*:?$/i, 30)) {
      const m = l.match(/^(.{2,60}?)\s+(?:at|@)\s+([A-Z][\w&.,'\- ]{1,80}?)(?:\s*[(,|]\s*[\w\s\-–]*\d{4}.*)?$/);
      if (m) jobs.push(`${clean(m[1])}, ${clean(m[2])}`);
    }
  }
  return jobs.length ? [...new Set(jobs)].slice(0, 10).join('\n') : null;
}

/**
 * Deterministic, rule-based extraction. It only returns values literally present in the text;
 * anything not found stays null so downstream screening marks it "Review Required" (SRS 10.2).
 */
export function extractFromText(text: string): ExtractedCv {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flat = text.replace(/\s+/g, ' ');

  const email = clean(flat.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]);

  const phoneMatch = flat.match(/(?:\+?88[\s-]?)?0?1[3-9]\d{2}[\s-]?\d{3}[\s-]?\d{3}/) ?? flat.match(/\+?\d[\d\s-]{8,14}\d/);
  const phone = clean(phoneMatch?.[0]);

  // Name: explicit "Name:" label, else first short line made of letters only (typical CV header).
  let name = clean(flat.match(/\bName\s*[:\-]\s*([A-Z][A-Za-z.\s]{2,60}?)(?=\s{2,}|\s+(?:Father|Mother|Email|E-mail|Phone|Mobile|Date|Address)\b|$)/i)?.[1]);
  if (!name) {
    const candidate = lines.slice(0, 5).find((l) => /^[A-Za-z][A-Za-z.\s]{2,50}$/.test(l) && l.split(/\s+/).length <= 6 && !/curriculum|vitae|resume|cv\b/i.test(l));
    name = clean(candidate);
  }

  // CGPA/GPA: "CGPA: 3.45", "CGPA 3.45 out of 4.00", "GPA 4.50/5.00"
  const cg = flat.match(/\bC?GPA\s*[:\-]?\s*(\d(?:\.\d{1,2})?)(?:\s*(?:\/|out of)\s*(\d(?:\.\d{1,2})?))?/i);
  const cgpaRaw = clean(cg?.[0]);
  let cgpa: number | null = null;
  if (cg) {
    const v = Number(cg[1]);
    const scale = cg[2] ? Number(cg[2]) : null;
    // Only normalize when unambiguous: explicit /4 scale, or no scale and value within 0-4.
    if (scale === 4 || (scale === null && v <= 4)) cgpa = v;
  }

  // Degrees: pick the highest-ranked degree mention.
  const degreeLines = lines.filter((l) => DEGREE_RE.test(l));
  let degree: string | null = null;
  let degreeLine = '';
  let best = Infinity;
  for (const l of degreeLines) {
    const m = l.match(DEGREE_RE);
    if (!m) continue;
    const key = m[1].toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '').replace(/bachelor.*/, 'bachelor');
    const rank = DEGREE_RANK.findIndex((d) => key.startsWith(d));
    // Keep the degree itself; the institution after a comma / "from" / "at" is extracted separately.
    if (rank !== -1 && rank < best) { best = rank; degreeLine = l; degree = clean(m[0].split(/,|\s+(?:from|at)\s+|\s+-\s+|\s+\|\s+/i)[0]); }
  }
  const education = degreeLines.length ? clean(degreeLines.slice(0, 4).join('; ')) : null;

  // Specialization: the subject written beside the highest degree, e.g. "BBA in Marketing", "Major: Accounting".
  const spec = (degreeLine.match(/\b(?:major(?:ing)?(?:\s+in)?|specializ(?:ation|ed)(?:\s+in)?|department\s+of|dept\.?\s+of|in)\s*[:\-]?\s+([A-Za-z][A-Za-z&/.\- ]{1,60})/i)?.[1] ?? '')
    .split(/\s+(?:from|at|with|CGPA|GPA|University|College|Institute|Passing|Year)\b|\s+-\s+/i)[0];
  const specialization = clean(spec);

  // Last position: only a labelled line such as "Designation: Sr. Executive"; "Position Applied For" has no match here.
  const positionLine = lines.map((l) => l.match(/^(?:[-*•]\s*)?(?:(?:current|present|last|latest)\s+)?(?:position|designation|job\s*title)\s*[:\-–]\s*(.{2,80})$/i)).find(Boolean);
  const lastPosition = clean(positionLine?.[1].split(/\s+(?:at|in|from)\s+|,|\s+\|\s+/i)[0]);

  const instLine = lines.find((l) => /\b(University|College|Institute|Polytechnic|School)\b/i.test(l));
  const institution = clean(instLine?.match(/(?:[A-Z][\w&.'\-]*\s+){0,6}(?:University|College|Institute|Polytechnic)(?:\s+of\s+[A-Z][\w&.'\- ]*)?/)?.[0] ?? instLine);

  // Experience: explicit "N years of experience" / "Experience: N years".
  const exp = flat.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:\w+\s+){0,3}experience/i)
    ?? flat.match(/experience\s*[:\-]?\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/i);
  const totalExperienceYears = exp ? Number(exp[1]) : null;

  // Checked line by line so the name stops at the end of its line instead of running into the next one.
  const work = lines.map((l) => l.match(/(?:Current(?:ly)?\s+(?:working\s+)?(?:at|with)|Present\s+Employer|Company\s+Name|(?:Last\s+)?Organi[sz]ation(?:\s+Name)?|Employer)\s*[:\-]?\s*([A-Z][\w&.,'\- ]{2,80}?(?:Ltd\.?|Limited|PLC|Inc\.?|Group|Company|Bank|Corporation)?)(?=\s{2,}|\s+(?:as|Designation|Position|From)\b|[.;]|$)/i)).find(Boolean);
  const workplace = clean(work?.[1]);

  const sk = flat.match(/\b(?:Skills?|Technical Skills|Key Skills|Expertise)\s*[:\-]\s*([^.]{3,200})/i);
  const skills = clean(sk?.[1]);

  const sal = flat.match(/expected\s+salary\s*[:\-]?\s*((?:BDT|Tk\.?|৳)?\s*[\d,]+(?:\s*k)?(?:\s*(?:BDT|Tk|taka))?)/i);
  const expectedSalary = clean(sal?.[1]);

  const ag = flat.match(/\bAge\s*[:\-]\s*(\d{2})\b/i);
  const age = ag ? Number(ag[1]) : null;

  // Address: a labelled line; the present / mailing address is preferred over the permanent one.
  const addressOf = (re: RegExp) => {
    const i = lines.findIndex((l) => re.test(l));
    if (i === -1) return null;
    return clean(lines[i].replace(re, '') || lines[i + 1]);
  };
  const address = addressOf(/^(?:present|current|mailing|contact)\s+address\s*[:\-–]?\s*/i) ?? addressOf(/^address\s*[:\-–]\s*|^address$/i)
    ?? addressOf(/^permanent\s+address\s*[:\-–]?\s*/i);

  const certs = section(lines, /^(?:professional\s+)?(?:certifications?|certificates?|trainings?(?:\s*(?:&|and)\s*certifications?)?|courses?)\b(?=\s*[:\-–]|\s*$)/i);
  const certifications = certs.length ? certs.join('; ') : null;

  const previousJobs = previousJobsFrom(lines);

  return { name, email, phone, degree, specialization, education, institution, cgpaRaw, cgpa, totalExperienceYears, lastPosition, workplace, skills, address, certifications, previousJobs, expectedSalary, age };
}
