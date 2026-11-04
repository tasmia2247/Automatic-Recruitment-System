/** A published job post of an open vacancy, as printed on its circular. */
export interface OpenJob {
  jobPostId: string;
  jobNo: string;
  title: string;
  emailSubject: string | null;
  vacancyId: string;
  vacancyNo: string;
  department: string;
  departmentCode: string;
  company: string;
  companyCode: string;
}

export type SubjectMatch = { job: OpenJob; reason?: undefined } | { job: null; reason: string };

/** Lowercase words with one space between them and around them, so contains-checks match whole words only. */
const norm = (s: string | null | undefined) => {
  const t = (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return t ? ` ${t} ` : '';
};
const has = (haystack: string, needle: string) => !!needle && haystack.includes(needle);

/** The position name without the department, e.g. "Executive - Administration Department" -> "executive". */
function positionName(title: string, department: string) {
  const full = norm(title);
  const core = norm(full.replace(norm(department), ' ').replace(/ (?:department|dept) /g, ' '));
  return core || full;
}

/**
 * Finds the one open job a mail subject belongs to: the circular's position name plus its department, or the
 * circular's own custom subject. The most specific position wins ("Sr. Executive" over "Executive"). Company name
 * and Job ID only separate jobs that tie. Anything still unclear is not guessed: the mail goes to Unmatched CVs.
 */
export function matchSubject(subject: string | null | undefined, jobs: OpenJob[]): SubjectMatch {
  const s = norm(subject);
  if (!s) return { job: null, reason: 'The mail has no subject.' };

  const scored: { job: OpenJob; score: number }[] = [];
  for (const job of jobs) {
    const custom = norm(job.emailSubject);
    const position = positionName(job.title, job.department);
    if (has(s, custom)) scored.push({ job, score: custom.length });
    else if (has(s, position) && (has(s, norm(job.department)) || has(s, norm(job.departmentCode)))) scored.push({ job, score: position.length });
  }
  if (!scored.length) return { job: null, reason: 'The subject does not name the position and department of an open circular.' };

  const best = Math.max(...scored.map((x) => x.score));
  let tied = scored.filter((x) => x.score === best).map((x) => x.job);
  for (const narrow of [
    (j: OpenJob) => has(s, norm(j.company)) || has(s, norm(j.companyCode)),
    (j: OpenJob) => has(s, norm(j.jobNo)),
  ]) {
    if (tied.length < 2) break;
    const kept = tied.filter(narrow);
    if (kept.length) tied = kept;
  }
  if (tied.length === 1) return { job: tied[0] };
  return { job: null, reason: `The subject fits ${tied.length} open jobs: ${tied.map((j) => j.jobNo).join(', ')}.` };
}
