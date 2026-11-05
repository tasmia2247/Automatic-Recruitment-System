import { degreeRank, degreeToken, subjectOf } from '../candidates/cv-extractor';
import type { CriterionResult, ScreeningCriterion, ScreeningResult } from '../database/entities';

export type ScreeningInput = Partial<Record<
  'degree' | 'education' | 'specialization' | 'institution' | 'cgpa' | 'totalExperienceYears' | 'relevantExperienceYears' | 'skills' | 'expectedSalary' | 'age' | 'cvText',
  string | number | null
>>;

/** Lowercase words only, so "B.Sc.", "BSc" and "bsc" compare equal and "Full-Stack" matches "full stack". */
export const normalizeForMatch = (s: string) => ` ${s.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9+#]+/g, ' ').trim()} `;

/** Items of a requisition's "Specialization required", split on commas, semicolons and new lines. */
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

/** The "Specialization required" fields of a requisition (or a Direct HR vacancy). `specialization` is "Other requirements". */
export interface Requirements {
  requiredEducation?: string | null;
  requiredSkills?: string | null;
  requiredExperienceYears?: number | string | null;
  specialization?: string | null;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' or ').replace(/\s+/g, ' ').trim();
/** Education alternatives: one per line, or separated by ";" / " or " (any one is enough). */
export const educationAlternatives = (s: string | null | undefined) =>
  [...new Set((s ?? '').split(/\n|;|\s+or\s+/i).map((x) => x.trim()).filter((x) => normalizeForMatch(x).trim()))];

/**
 * Criteria from the "Specialization required" fields. Each is mandatory with policy REVIEW: anything not found, or short of
 * a stated minimum, sends the CV to Review Required with the reason; screening never fails a CV on its own (owner, 2026-11-05).
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
  specializationItems(r.requiredSkills).forEach((item, i) => out.push({
    id: `skill-${i + 1}`, label: `Skill: ${item}`.slice(0, 120), field: 'cvText', operator: 'mentions', value: item, mandatory: true, missingPolicy: 'REVIEW',
  }));
  return [...out, ...specializationCriteria(r.specialization)];
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

function evaluateEducation(c: Criterion, input: ScreeningInput): Pick<CriterionResult, 'actual' | 'outcome' | 'reason'> {
  const cvRank = cvDegreeRank(input);
  const shown = String(input.degree ?? '').trim() || null;
  const hay = normalizeForMatch([input.degree, input.specialization, input.education, input.cvText].filter((x) => typeof x === 'string').join(' \n '));
  const notes: string[] = [];
  for (const alt of c.value.split('\n')) {
    const need = degreeRank(alt);
    const token = degreeToken(alt);
    const subject = subjectOf(alt, need < 0 ? alt : null);
    let subjects = subject && !/^any\b/i.test(subject) ? subject.split(/\s*\/\s*|\s*,\s*|\s+or\s+/i).filter(Boolean) : [];
    if (need < 0 && !subjects.length) subjects = [alt]; // no degree named: the text itself must be in the CV
    const levelOk = need < 0 || (cvRank >= 0 && cvRank <= need);
    // A named degree ("BSc", "MBA") must be on the CV, unless the CV holds a higher one.
    const key = token ? normalizeForMatch(token).replace(/\s/g, '') : '';
    const named = DEGREE_NAMES[key];
    const tokenOk = !named || cvRank < need || [key, ...named].some((n) => hay.includes(normalizeForMatch(n)));
    const subjectOk = !subjects.length || subjects.some((s) => hay.includes(normalizeForMatch(s)));
    if (levelOk && tokenOk && subjectOk) return { actual: shown ?? 'found', outcome: 'Pass', reason: `Education: ${alt} - satisfied${shown ? ` (CV: ${shown})` : ''}.` };
    if (!levelOk) notes.push(cvRank < 0 ? 'no degree found in CV' : `a lower degree in CV (${shown ?? 'see education'})`);
    else if (!tokenOk) notes.push(`${token} not found in CV`);
    else notes.push(`${subjects.join(' / ')} not found in CV`);
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
