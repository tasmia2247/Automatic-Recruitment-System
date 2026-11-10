import { degreeRank, degreeToken, INCOMPLETE, subjectOf } from '../candidates/cv-extractor';
import type { CriterionResult, ScoreParts, ScreeningCriterion, ScreeningResult } from '../database/entities';
import { indexCv, matchLine, requirementLines } from './keywords';

/** degreeRank of a master's degree: 0 PhD, 1 MPhil, 2 master, 3 PGD, 4 bachelor, 5 diploma, 6 HSC, 7 SSC. */
const MASTERS = 2;

export type ScreeningInput = Partial<Record<
  'degree' | 'education' | 'specialization' | 'institution' | 'cgpa' | 'totalExperienceYears' | 'relevantExperienceYears' | 'skills' | 'expectedSalary' | 'age' | 'cvText',
  string | number | null
>>;

/** Lowercase words only, so "B.Sc.", "BSc" and "bsc" compare equal and "Full-Stack" matches "full stack". */
export const normalizeForMatch = (s: string) => ` ${s.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9+#]+/g, ' ').trim()} `;

/** Items of "Other requirements", split on commas, semicolons and new lines. */
export const specializationItems = (s: string | null | undefined) =>
  [...new Set((s ?? '').split(/[,;\n]/).map((x) => x.trim()).filter((x) => normalizeForMatch(x).trim()))];

/**
 * Criteria from the requisition: every item must be written in the CV. A missing item is never an automatic Fail,
 * because CVs word the same thing differently; it sends the CV to Review Required for HR to check.
 */
export const specializationCriteria = (s: string | null | undefined): Criterion[] =>
  specializationItems(s).map((item, i) => ({
    id: `specialization-${i + 1}`, label: item.slice(0, 120), field: 'cvText', operator: 'mentions', value: item, mandatory: true, missingPolicy: 'REVIEW' as const,
  }));

type Criterion = Pick<ScreeningCriterion, 'id' | 'label' | 'field' | 'operator' | 'value' | 'mandatory' | 'missingPolicy'>;

/**
 * The "Specialization required" fields of a requisition (or a Direct HR vacancy). `specialization` is "Other requirements";
 * `jobDescription` is the requisition's Key Responsibilities (a Direct HR vacancy has none).
 */
export interface Requirements {
  requiredEducation?: string | null;
  requiredSkills?: string | null;
  requiredExperienceYears?: number | string | null;
  specialization?: string | null;
  jobDescription?: string | null;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' or ').replace(/\s+/g, ' ').trim();
/** Education alternatives: one per line, or separated by ";" / " or " (any one is enough). */
export const educationAlternatives = (s: string | null | undefined) =>
  [...new Set((s ?? '').split(/\n|;|\s+or\s+/i).map((x) => x.trim()).filter((x) => normalizeForMatch(x).trim()))];

/**
 * The must-have criteria: education, minimum experience and each "Other requirement". Each is mandatory with policy REVIEW:
 * anything not found, or short of a stated minimum, sends the CV to Review Required with the reason; screening never fails a CV
 * on its own (owner, 2026-11-05). Required Skills and Key Responsibilities are not here: they make up the match score.
 */
export function requirementCriteria(r: Requirements): Criterion[] {
  const out: Criterion[] = [];
  const edu = educationAlternatives(r.requiredEducation);
  if (edu.length) {
    out.push({ id: 'education', label: `Education: ${oneLine(edu.join('\n'))}`.slice(0, 160), field: 'education', operator: 'education', value: edu.join('\n'), mandatory: true, missingPolicy: 'REVIEW' });
  }
  const years = r.requiredExperienceYears === null || r.requiredExperienceYears === undefined || r.requiredExperienceYears === '' ? null : Number(r.requiredExperienceYears);
  if (years !== null && Number.isFinite(years) && years > 0) {
    out.push({ id: 'experience', label: `Experience: at least ${years} year${years === 1 ? '' : 's'}`, field: 'totalExperienceYears', operator: 'min_years', value: String(years), mandatory: true, missingPolicy: 'REVIEW' });
  }
  return [...out, ...specializationCriteria(r.specialization)];
}

/** Match score weights (owner, 2026-11-08). A part with no requirement is left out and the others scale up to 100. */
export const SCORE_WEIGHTS = { skills: 50, responsibilities: 30, education: 10, experience: 10 } as const;
/** A CV needs this match score, as well as the education, experience and other requirements, to Pass. */
export const PASS_MARK = 70;

/** What a vacancy's CVs are checked against, as short lines for the screen. */
export function requirementSummary(r: Requirements): string[] {
  const must = requirementCriteria(r);
  const skills = requirementLines(r.requiredSkills).length;
  const duties = requirementLines(r.jobDescription).length;
  const scored = skills || duties || must.some((c) => c.id === 'education' || c.id === 'experience');
  return [
    ...must.map((c) => c.label),
    ...(skills ? [`Required Skills (${skills} point${skills === 1 ? '' : 's'})`] : []),
    ...(duties ? [`Key Responsibilities (${duties} point${duties === 1 ? '' : 's'})`] : []),
    ...(scored ? [`match score at least ${PASS_MARK}%`] : []),
  ];
}

const pct = (x: number) => Math.round(x * 1000) / 10;

/**
 * Screening against a requisition's (or Direct HR vacancy's) requirements (owner, 2026-11-08):
 *  - each Required Skills line and each Key Responsibilities line is cut into keywords and looked for in the CV;
 *  - the match score (0-100) weighs skills 50, responsibilities 30, education 10 (met or not) and experience 10 (CV years / required,
 *    at most 1); parts that are not set are left out and the rest scale up;
 *  - Pass needs a score of at least PASS_MARK and the education, experience and other requirements met; anything else is
 *    Review Required with the reasons. Never Fail.
 * Returns null when nothing is set, so the CV is not screened.
 */
export function screenRequirements(r: Requirements, input: ScreeningInput): { overall: ScreeningResult; results: CriterionResult[]; score: number | null; scoreParts: ScoreParts | null } | null {
  const must = requirementCriteria(r);
  const skillLines = requirementLines(r.requiredSkills);
  const dutyLines = requirementLines(r.jobDescription);
  if (!must.length && !skillLines.length && !dutyLines.length) return null;

  const { results } = screen(must, input);
  const text = String(input.cvText ?? '');
  const cv = indexCv(text, normalizeForMatch(text));
  const lineResults = (lines: string[], kind: 'skill' | 'duty') => lines.flatMap((item, i): (CriterionResult & { share: number })[] => {
    const m = matchLine(item, cv, normalizeForMatch);
    if (!m) return [];
    const what = kind === 'skill' ? 'Skill' : 'Responsibility';
    const all = !m.missing.length;
    return [{
      criterionId: `${kind}-${i + 1}`, label: `${what}: ${item}`.slice(0, 160), field: 'cvText', operator: 'keywords', expected: m.keywords.join(', '),
      actual: m.found.length ? m.found.join(', ') : null, mandatory: false, outcome: all ? 'Pass' : 'Missing', share: m.found.length / m.keywords.length,
      reason: all ? `${what}: ${item} - all keywords found.`
        : `${what}: ${item} - ${m.found.length} of ${m.keywords.length} keywords found (not in CV: ${m.missing.join(', ')}).`,
    }];
  });
  const skills = lineResults(skillLines, 'skill');
  const duties = lineResults(dutyLines, 'duty');
  const mean = (xs: { share: number }[]) => xs.reduce((s, x) => s + x.share, 0) / xs.length;

  const edu = results.find((x) => x.criterionId === 'education');
  const exp = must.find((c) => c.id === 'experience');
  const years = parseNumber(input.relevantExperienceYears ?? input.totalExperienceYears);
  const raw = [
    skills.length ? { key: 'skills' as const, label: 'Required Skills', weight: SCORE_WEIGHTS.skills, earned: mean(skills) } : null,
    duties.length ? { key: 'responsibilities' as const, label: 'Key Responsibilities', weight: SCORE_WEIGHTS.responsibilities, earned: mean(duties) } : null,
    edu ? { key: 'education' as const, label: 'Education', weight: SCORE_WEIGHTS.education, earned: edu.outcome === 'Pass' ? 1 : 0 } : null,
    exp ? { key: 'experience' as const, label: 'Experience', weight: SCORE_WEIGHTS.experience, earned: years === null ? 0 : Math.min(years / Number(exp.value), 1) } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  const total = raw.reduce((s, p) => s + p.weight, 0);

  let score: number | null = null;
  let scoreParts: ScoreParts | null = null;
  const all: CriterionResult[] = [];
  if (raw.length) {
    const parts = raw.map((p) => ({ ...p, weight: pct(p.weight / total), earned: Math.round(p.earned * 1000) / 1000 }));
    score = pct(raw.reduce((s, p) => s + (p.weight / total) * p.earned, 0));
    scoreParts = { parts, passMark: PASS_MARK };
    const made = parts.map((p) => `${p.label} ${pct(p.earned)}% of ${p.weight}`).join(', ');
    all.push({
      criterionId: 'match-score', label: `Match score: ${score}%`, field: 'cvText', operator: 'score', expected: String(PASS_MARK), actual: score, mandatory: true,
      outcome: score >= PASS_MARK ? 'Pass' : 'Missing',
      reason: score >= PASS_MARK ? `Match score ${score}% (pass mark ${PASS_MARK}%; ${made}).`
        : `Match score ${score}% is below the pass mark of ${PASS_MARK}% (${made}) - needs review.`,
    });
  }
  all.push(...results, ...[...skills, ...duties].map(({ share: _share, ...x }) => x));
  const review = all.some((x) => x.mandatory && x.outcome !== 'Pass');
  return { overall: review ? 'Review Required' : 'Pass', results: all, score, scoreParts };
}


/** Full names written for common degree abbreviations, so "BSc" in a requirement also matches "Bachelor of Science". */
const DEGREE_NAMES: Record<string, string[]> = {
  bsc: ['bachelor of science'], msc: ['master of science', 'masters of science'], ba: ['bachelor of arts'], ma: ['master of arts', 'masters of arts'],
  bba: ['bachelor of business administration'], mba: ['master of business administration', 'masters of business administration'], emba: ['executive mba'],
  bss: ['bachelor of social science'], mss: ['master of social science'], bbs: ['bachelor of business studies'], mbs: ['master of business studies'],
  bcom: ['bachelor of commerce'], mcom: ['master of commerce'], llb: ['bachelor of laws'], llm: ['master of laws'],
  beng: ['bachelor of engineering'], meng: ['master of engineering'], btech: ['bachelor of technology'], mtech: ['master of technology'],
};

/** Highest degree on the CV (lowest rank number) from the degree field or the education list; -1 when none. */
function cvDegreeRank(input: ScreeningInput) {
  const ranks = [input.degree, ...String(input.education ?? '').split(/;\s*/)].filter((x): x is string => typeof x === 'string' && !!x.trim()).map(degreeRank).filter((r) => r >= 0);
  return ranks.length ? Math.min(...ranks) : -1;
}

/**
 * The CV's degrees, one entry each: the degree field with its subject, then every education entry ("Degree, Subject - Institute (...)").
 * Fields HR corrected arrive here the same way, so a correction re-screens on the corrected values.
 */
function educationEntries(input: ScreeningInput) {
  const main = [input.degree, input.specialization].filter((x): x is string => typeof x === 'string' && !!x.trim()).join(', ');
  const list = String(input.education ?? '').split(/;\s*/).map((x) => x.trim()).filter(Boolean);
  return [main, ...list].filter(Boolean);
}

/** A subject word matches at the start of a word, so "Textile" also matches "Textiles"; never in the middle of another word. */
/**
 * Common subject abbreviations in Bangladeshi CVs and job posts (owner, 2026-11-08): "MBA in HRM" meets "MBA in Human Resource
 * Management" and the other way round. "and" / "&" are ignored when comparing.
 */
const SUBJECT_ALIASES: [string, string][] = [
  ['hrm', 'human resource management'], ['hrm', 'human resources management'], ['cse', 'computer science engineering'], ['eee', 'electrical electronic engineering'],
  ['ece', 'electronics communication engineering'], ['ais', 'accounting information systems'], ['ais', 'accounting information system'], ['mis', 'management information systems'],
  ['ipe', 'industrial production engineering'], ['fdt', 'fashion design technology'], ['ict', 'information communication technology'], ['ce', 'civil engineering'],
  ['me', 'mechanical engineering'],
];
const withoutAnd = (s: string) => s.replace(/ and /g, ' ').replace(/\s+/g, ' ');
const plainWords = (hay: string, words: string) => withoutAnd(hay).includes(withoutAnd(normalizeForMatch(words)).replace(/ $/, ''));
/** The subject as written, or its abbreviation / full form. */
const hasWords = (hay: string, words: string) => {
  if (plainWords(hay, words)) return true;
  const w = withoutAnd(normalizeForMatch(words)).trim();
  return SUBJECT_ALIASES.some(([abbr, full]) => (w === abbr && plainWords(hay, full)) || (w === full && plainWords(hay, abbr)));
};

/**
 * Education requirement (owner, 2026-11-08): an alternative such as "BSc in Textile" is met only when ONE education entry of the CV
 * has the level (or higher), the named degree (unless that entry is a higher degree) and the subject together. The rest of the CV
 * (jobs, companies, training) does not count: "textile" in a job at a textile mill is not a textile degree.
 */
function evaluateEducation(c: Criterion, input: ScreeningInput): Pick<CriterionResult, 'actual' | 'outcome' | 'reason'> {
  const cvRank = cvDegreeRank(input);
  const shown = String(input.degree ?? '').trim() || null;
  const entries = educationEntries(input);
  const notes: string[] = [];
  for (const alt of c.value.split('\n')) {
    const need = degreeRank(alt);
    const token = degreeToken(alt);
    const subject = subjectOf(alt, need < 0 ? alt : null);
    let subjects = subject && !/^any\b/i.test(subject) ? subject.split(/\s*\/\s*|\s*,\s*|\s+or\s+/i).filter(Boolean) : [];
    if (need < 0 && !subjects.length) subjects = [alt]; // no degree named: the text itself must be in the CV's education
    const key = token ? normalizeForMatch(token).replace(/\s/g, '') : '';
    const named = DEGREE_NAMES[key];
    const subjectIn = (e: string) => !subjects.length || subjects.some((s) => hasWords(normalizeForMatch(e), s));
    // No degree level named ("Textile background"): the words must be in the education, or in the CV when no education was read.
    if (need < 0) {
      const hay = entries.length ? entries.join(' ; ') : String(input.cvText ?? '');
      if (subjectIn(hay)) return { actual: shown ?? 'found', outcome: 'Pass', reason: `Education: ${alt} - satisfied${shown ? ` (CV: ${shown})` : ''}.` };
      notes.push(`${subjects.join(' / ')} not found in the CV's education`);
      continue;
    }
    const finished = entries.filter((e) => !INCOMPLETE.test(e));
    const match = finished.find((e) => {
      const r = degreeRank(e);
      if (r < 0 || r > need) return false; // no degree, or a lower one
      const n = normalizeForMatch(e);
      // Only a master's or above stands in for a named bachelor ("MSc in Textile" for "BSc in Textile"); a PGD or diploma does not.
      const tokenOk = !named || (r < need && r <= MASTERS) || [key, ...named].some((x) => n.includes(normalizeForMatch(x)));
      return tokenOk && subjectIn(e);
    });
    const unfinished = !match && entries.find((e) => INCOMPLETE.test(e) && degreeRank(e) >= 0 && subjectIn(e));
    if (match) return { actual: match, outcome: 'Pass', reason: `Education: ${alt} - satisfied (CV: ${match.replace(/\s+-\s+.*$/, '')}).` };
    if (unfinished) notes.push(`${unfinished.replace(/\s+-\s+.*$/, '')} is not finished`);
    if (cvRank < 0) notes.push('no degree found in CV');
    else if (cvRank > need) notes.push(`a lower degree in CV (${shown ?? 'see education'})`);
    else if (subjects.length) notes.push(`no ${token ?? 'degree'} in ${subjects.join(' / ')} in the CV's education (CV: ${shown ?? 'see education'})`);
    else notes.push(`${token} not found in the CV's education (CV: ${shown ?? 'see education'})`);
  }
  return { actual: shown, outcome: 'Missing', reason: `Education: needs ${oneLine(c.value)}; ${[...new Set(notes)].join('; ')} - needs manual verification.` };
}

const isMissing = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim());

/** Parses "45,000 BDT" / "45k" style salary strings; returns null when ambiguous. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

const keywords = (s: string) => s.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);

function evaluate(c: Criterion, actual: unknown, input: ScreeningInput): CriterionResult {
  const base = { criterionId: c.id, label: c.label, field: c.field, operator: c.operator, expected: c.value, actual: actual ?? null, mandatory: c.mandatory };
  if (c.operator === 'education') return { ...base, ...evaluateEducation(c, input) };
  if (c.operator === 'min_years') {
    // Relevant experience entered by HR counts first; otherwise the total read from the CV.
    const a = parseNumber(input.relevantExperienceYears ?? input.totalExperienceYears);
    const e = Number(c.value);
    if (a === null) return { ...base, actual: null, outcome: 'Missing', reason: `${c.label}: years of experience not found in CV - needs manual verification.` };
    return a >= e
      ? { ...base, actual: a, outcome: 'Pass', reason: `${c.label}: satisfied (CV shows ${a} years).` }
      : { ...base, actual: a, outcome: 'Missing', reason: `${c.label}: CV shows ${a} years - needs review.` };
  }
  if (c.operator === 'mentions') {
    // The whole CV is the input: record only whether the item was found, not the CV text.
    const found = !isMissing(actual) && normalizeForMatch(String(actual)).includes(normalizeForMatch(c.value));
    return found
      ? { ...base, actual: 'found', outcome: 'Pass', reason: `${c.label}: found in CV.` }
      : { ...base, actual: null, outcome: 'Missing', reason: `${c.label}: not found in CV - needs manual verification.` };
  }
  if (isMissing(actual)) {
    return { ...base, outcome: 'Missing', reason: `${c.label}: not found in CV - needs manual verification.` };
  }
  let ok: boolean;
  let detail: string;
  switch (c.operator) {
    case 'gte':
    case 'lte':
    case 'eq': {
      const a = parseNumber(actual);
      const e = Number(c.value);
      if (a === null) return { ...base, outcome: 'Missing', reason: `${c.label}: value "${actual}" could not be read as a number - needs review.` };
      ok = c.operator === 'gte' ? a >= e : c.operator === 'lte' ? a <= e : a === e;
      detail = `found ${a}, required ${c.operator === 'gte' ? '≥' : c.operator === 'lte' ? '≤' : '='} ${e}`;
      break;
    }
    case 'contains_any':
    case 'contains_all': {
      const text = String(actual).toLowerCase();
      const ks = keywords(c.value);
      const hits = ks.filter((k) => text.includes(k));
      ok = c.operator === 'contains_any' ? hits.length > 0 : hits.length === ks.length;
      detail = hits.length ? `matched ${hits.join(', ')}` : `none of ${ks.join(', ')} found`;
      break;
    }
    default:
      return { ...base, outcome: 'Missing', reason: `${c.label}: unsupported operator ${c.operator}.` };
  }
  return { ...base, outcome: ok ? 'Pass' : 'Fail', reason: `${c.label}: ${ok ? 'satisfied' : 'not satisfied'} (${detail}).` };
}

/**
 * Rule-based screening (SRS 10.3):
 *  - Fail if any mandatory criterion is confirmed not satisfied (even if other data is missing)
 *  - otherwise Review Required if any mandatory criterion is missing/uncertain (missingPolicy REVIEW)
 *  - otherwise Pass. Preferred (non-mandatory) criteria are reported but never decide the outcome.
 */
export function screen(criteria: Criterion[], input: ScreeningInput): { overall: ScreeningResult; results: CriterionResult[] } {
  const results = criteria.map((c) => evaluate(c, input[c.field as keyof ScreeningInput], input));
  let fail = false;
  let review = false;
  results.forEach((r, i) => {
    const c = criteria[i];
    if (!c.mandatory) return;
    if (r.outcome === 'Fail') fail = true;
    if (r.outcome === 'Missing') {
      if (c.missingPolicy === 'FAIL') { fail = true; r.reason += ' Treated as fail by policy.'; }
      else if (c.missingPolicy === 'REVIEW') review = true;
    }
  });
  return { overall: fail ? 'Fail' : review ? 'Review Required' : 'Pass', results };
}
