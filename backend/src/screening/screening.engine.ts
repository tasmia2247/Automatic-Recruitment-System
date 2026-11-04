import type { CriterionResult, ScreeningCriterion, ScreeningResult } from '../database/entities';

export type ScreeningInput = Partial<Record<
  'degree' | 'education' | 'institution' | 'cgpa' | 'totalExperienceYears' | 'relevantExperienceYears' | 'skills' | 'expectedSalary' | 'age' | 'cvText',
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

function evaluate(c: Criterion, actual: unknown): CriterionResult {
  const base = { criterionId: c.id, label: c.label, field: c.field, operator: c.operator, expected: c.value, actual: actual ?? null, mandatory: c.mandatory };
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
  const results = criteria.map((c) => evaluate(c, input[c.field as keyof ScreeningInput]));
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
