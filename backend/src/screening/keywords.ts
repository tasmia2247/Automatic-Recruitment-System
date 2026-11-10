/**
 * Keyword matching for Required Skills and Key Responsibilities (owner, 2026-11-08). Plain rules, no AI model or paid service:
 * each requirement line is cut into its specific words (filler such as "good", "knowledge", "ensure" is dropped), and each word is
 * looked for in the CV, with word endings ignored ("networking" matches "network", "troubleshoot" matches "troubleshooting").
 */

/** Words that say nothing specific about the job, so they are never searched for. */
const FILLER = new Set(`
a an the and or nor of in on at to for with by from as into onto within across via per than then also both either
is are be been being was were will shall must should can could may might would do does did has have had
our your their its his her this that these those such any all each every other others etc eg ie
able ability abilities including include includes included various related relevant proper properly well good strong excellent
basic sound solid fair high higher highly advanced deep working work works worked knowledge understanding familiarity familiar
skill skills skilled experience experienced expertise year years minimum least plus preferred preferably required requirement requirements
field fields area areas task tasks duty duties responsibility responsibilities responsible assigned department company organization organisation
perform performing performs provide providing provides assist assisting assists ensure ensuring ensures maintain maintaining maintains
help helping handle handling carry carrying out day daily new internal external user users issue issues activity activities
willingness willing learn learning eager fast paced pace dynamic environment etc candidate candidates person must need needs
bachelor bachelors master masters degree degrees diploma graduate graduation equivalent similar discipline subject subjects
`.split(/\s+/).filter(Boolean));

/** Upper-case acronyms that are also everyday words; these must be written in capitals in the CV ("IT", not "it"). */
const WORD_ACRONYMS = new Set(['it', 'as', 'us', 'or', 'on', 'in', 'is', 'at', 'an', 'am', 'be', 'do', 'go', 'me', 'my', 'no', 'so', 'to', 'up', 'we', 'of', 'if', 'pr', 'ad', 'id']);

const splitWords = (s: string) => s.replace(/['’]s\b/g, '').split(/[^A-Za-z0-9+#]+/).filter(Boolean);

/**
 * Requirement lines: one per line (bullets and numbers stripped). A line of short comma items ("MS Excel, AutoCAD, Power BI")
 * becomes one item each; a sentence ("Basic knowledge of programming, networking, and IT") stays one item.
 */
export function requirementLines(s: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (s ?? '').split(/\n|;/)) {
    const line = raw.replace(/^\s*(?:[-*•●▪◦·–>]+|\d+[.)])\s*/, '').replace(/[.\s]+$/, '').trim();
    if (!/[A-Za-z0-9]/.test(line)) continue;
    const parts = line.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => p.split(/\s+/).length <= 3)) out.push(...parts);
    else out.push(line);
  }
  return [...new Set(out)];
}

/** The specific words of a requirement line: acronyms kept as written (IT, ICT, ERP), everything else in lower case, filler removed. */
export function keywordsOf(item: string): string[] {
  const out: string[] = [];
  for (const w of splitWords(item)) {
    if (/^[A-Z][A-Z0-9+#&]{1,5}$/.test(w)) { out.push(w); continue; }
    const k = w.toLowerCase();
    if (k.length < 2 || /^\d+$/.test(k) || FILLER.has(k)) continue;
    out.push(k);
  }
  return [...new Set(out)];
}

export interface CvIndex { lower: Set<string>; exact: Set<string>; byStart: Map<string, string[]>; norm: string }

/** Words of the CV for fast lookups, built once per CV. Two words written apart also count joined ("team work" = "teamwork"). */
export function indexCv(text: string, norm: string): CvIndex {
  const words = splitWords(text);
  const lower = new Set<string>();
  const byStart = new Map<string, string[]>();
  words.forEach((w, i) => {
    const l = w.toLowerCase();
    if (!lower.has(l) && l.length >= 4) byStart.set(l.slice(0, 4), [...(byStart.get(l.slice(0, 4)) ?? []), l]);
    lower.add(l);
    if (i + 1 < words.length) lower.add(l + words[i + 1].toLowerCase());
  });
  return { lower, exact: new Set(words), byStart, norm };
}

const sharedStart = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

/**
 * One keyword in the CV. Short words and words with "+" or "#" must be exact (SQL, C++); longer ones may differ in their ending
 * as long as most of the word is shared ("programming" ~ "program", "configuration" ~ "configure", but "software" is not "soft").
 */
export function hasKeyword(k: string, cv: CvIndex): boolean {
  if (/^[A-Z]/.test(k) && k === k.toUpperCase()) return WORD_ACRONYMS.has(k.toLowerCase()) ? cv.exact.has(k) : cv.lower.has(k.toLowerCase());
  if (cv.lower.has(k)) return true;
  if (k.length < 4 || /[+#]/.test(k)) return false;
  return (cv.byStart.get(k.slice(0, 4)) ?? []).some((w) => {
    const n = sharedStart(k, w);
    return n >= 4 && n >= Math.ceil(0.6 * Math.max(k.length, w.length));
  });
}

/** How much of one requirement line the CV covers; null when the line has nothing specific to look for. */
export function matchLine(item: string, cv: CvIndex, normalize: (s: string) => string): { keywords: string[]; found: string[]; missing: string[] } | null {
  const keywords = keywordsOf(item);
  if (!keywords.length) return null;
  // A short item written exactly ("MS Excel") is fully met even if a word of it is filler.
  if (keywords.length <= 3 && cv.norm.includes(normalize(item))) return { keywords, found: keywords, missing: [] };
  const found = keywords.filter((k) => hasKeyword(k, cv));
  return { keywords, found, missing: keywords.filter((k) => !found.includes(k)) };
}
