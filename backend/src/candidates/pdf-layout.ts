/**
 * Turns the positioned text of a PDF into reading-order text that the rule-based extractor can read.
 *
 * Plain PDF text comes out in drawing order, which scrambles the common CV layouts:
 * - two-column CVs (a sidebar with contact / skills next to the main column) mix both columns line by line;
 * - Bdjobs-style tables (Academic Qualification, Training Summary, ...) come out cell fragment by cell fragment.
 * Here the columns are read one after the other, and each table row becomes one line of labelled cells,
 * e.g. "Exam Title: Bachelor of Arts (BA) | Institute: National University | Result: CGPA 3.10 (out of 4) | Pass.Year: 2015".
 */

export interface PdfItem { str: string; x: number; y: number; w: number; h: number }
export interface PdfPage { width: number; height: number; items: PdfItem[] }

interface Line { page: number; top: number; y: number; h: number; items: PdfItem[]; text: string }

export interface PdfLayout {
  text: string;
  /** The biggest text near the top of the first page, which on almost every CV is the candidate's name. */
  nameHint: string | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function joinItems(items: PdfItem[]): string {
  let out = '';
  let prev: PdfItem | null = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const h = Math.max(prev.h, it.h, 1);
      if (gap > Math.max(14, 1.6 * h)) out = out.trimEnd() + '\t';
      else if (gap > 0.12 * h && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
    }
    out += it.str;
    prev = it;
  }
  return out.replace(/[  ]+/g, ' ').replace(/ ?\t ?/g, '\t').trim();
}

/** Groups items that share a baseline into lines, top to bottom, each line left to right. */
function toLines(items: PdfItem[], page: number, pageHeight: number): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; h: number; items: PdfItem[] }[] = [];
  for (const it of sorted) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.y - it.y) <= Math.max(2, 0.45 * Math.min(l.h, it.h || l.h))) {
      l.items.push(it);
      l.h = Math.max(l.h, it.h);
    } else lines.push({ y: it.y, h: it.h || 10, items: [it] });
  }
  return lines.map((l) => {
    const its = l.items.sort((a, b) => a.x - b.x);
    return { page, y: l.y, top: page * 100000 + (pageHeight - l.y), h: l.h, items: its, text: joinItems(its) };
  }).filter((l) => l.text);
}

/**
 * Splits a page into a left and a right column when a vertical gutter runs down the page and the two sides
 * are written independently (their lines do not share baselines, unlike a "Label : value" list or a table).
 * Text that crosses the gutter (a full-width header, for example) is kept where it is.
 */
function readingOrder(page: PdfPage, pageNo: number): Line[] {
  const items = page.items;
  const all = toLines(items, pageNo, page.height);
  if (items.length < 12) return all;

  let best = { g: 0, crossing: Infinity, run: 0 };
  let run = 0;
  let lastCount = -1;
  for (let g = page.width * 0.22; g <= page.width * 0.78; g += 2) {
    // Only a gap with text on both sides is a gutter (not the empty right margin of a short page).
    if (items.filter((i) => i.x + i.w <= g + 1).length < 6 || items.filter((i) => i.x >= g - 1).length < 6) { lastCount = -1; continue; }
    const crossing = items.filter((i) => i.x < g - 1 && i.x + i.w > g + 1).length;
    run = crossing === lastCount ? run + 1 : 1;
    lastCount = crossing;
    if (crossing < best.crossing || (crossing === best.crossing && run > best.run)) best = { g: g - (run - 1), crossing, run };
  }
  const g = best.g;
  const left = items.filter((i) => i.x + i.w <= g + 1);
  const right = items.filter((i) => i.x >= g - 1);
  const crossing = items.filter((i) => !left.includes(i) && !right.includes(i));
  if (crossing.length > Math.max(2, items.length * 0.06) || left.length < 6 || right.length < 6) return all;
  // A narrow strip of side headings ("Education", "Personal Information") belongs to the lines beside it, not a column of its own.
  const span = (xs: PdfItem[]) => Math.max(...xs.map((i) => i.x + i.w)) - Math.min(...xs.map((i) => i.x));
  if (Math.min(span(left), span(right)) < page.width * 0.22) return all;

  const L = toLines(left, pageNo, page.height);
  const R = toLines(right, pageNo, page.height);
  const shared = R.filter((r) => L.some((l) => Math.abs(l.y - r.y) <= 1.5)).length;
  if (shared / Math.min(L.length, R.length) >= 0.4) return all;

  // Full-width text splits the page into bands; inside each band the left column is read before the right one.
  const bands = toLines(crossing, pageNo, page.height);
  const out: Line[] = [];
  let from = -Infinity;
  for (const b of [...bands, null]) {
    const to = b ? b.top : Infinity;
    const inBand = (l: Line) => l.top > from && l.top < to;
    out.push(...L.filter(inBand), ...R.filter(inBand));
    if (b) out.push(b);
    from = to;
  }
  return out;
}

const HEADER_WORD = /^(?:exam\s*title|exam|degree|concentration\/?|major|concentration\s*\/\s*major|institute|institution|board|result|grade|pass\.?\s*year|pas\.?\s*year|passing\s+year|year|duration|achievement|training(?:\s+title)?|title|topic|country|location|certification|from|to|language|reading|writing|speaking)$/i;
/** Header labels made of two words, which must stay one column. */
const COMPOUND = /^(?:exam title|training title|pass\.? ?year|pas\.? ?year|passing year|concentration ?\/ ?major|concentration\/)$/i;

interface Col { label: string; x0: number; x1: number; cx: number }

/** Header cells of a table header line, or null when the line is not one. */
function headerCols(line: Line): Col[] | null {
  // Split every item into words with estimated positions: one item may hold several labels ("Concentration/Major Institute").
  const words: { label: string; x0: number; x1: number; h: number }[] = [];
  for (const it of line.items) {
    const len = it.str.length || 1;
    for (const m of it.str.matchAll(/\S+/g)) {
      words.push({ label: m[0], x0: it.x + (it.w * m.index!) / len, x1: it.x + (it.w * (m.index! + m[0].length)) / len, h: it.h });
    }
  }
  const cells: { label: string; x0: number; x1: number }[] = [];
  for (const w of words) {
    const c = cells[cells.length - 1];
    const joined = c ? (c.label.endsWith('/') ? c.label + w.label : `${c.label} ${w.label}`) : '';
    if (c && w.x0 - c.x1 < Math.max(6, 0.9 * w.h) && (COMPOUND.test(joined) || /^(?:concentration\/major|concentration\/)$/i.test(joined.replace(/\s+/g, ''))
      || (!HEADER_WORD.test(c.label) && !HEADER_WORD.test(w.label)))) {
      c.label = joined;
      c.x1 = w.x1;
    } else cells.push({ label: w.label, x0: w.x0, x1: w.x1 });
  }
  const known = cells.filter((c) => HEADER_WORD.test(c.label.replace(/\s+/g, ' ')));
  if (cells.length < 3 || known.length < 3 || known.length < cells.length * 0.7) return null;
  return cells.map((c) => ({ ...c, cx: (c.x0 + c.x1) / 2 }));
}

/** Section headings that end a table even when they are written at the table's left edge. */
const SECTION_END = /^(?:training(?:\s+summa?e?ry)?|trainings?|professional\s+qualifications?|skills?|fields?\s+of\s+skills?|language(?:\s+proficiency)?|personal\s+(?:details|information)|references?(?:\s*\(s\))?|career\s+and\s+application\s+information|extra\s*-?\s*curricular\s+activities|specialization|employment\s+history|experience|academic\s+qualifications?|education)\s*:?$/i;

const isHeading = (l: Line, firstCol: Col) =>
  SECTION_END.test(l.text) || (l.items[0].x < firstCol.x0 - 20 && (l.items.length === 1 || /:\s*$/.test(l.items[0].str)));

/** Rebuilds the rows of every positioned table as single lines of "Label: value" cells. */
function rebuildTables(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = headerCols(lines[i]);
    if (!cols) { out.push(lines[i]); continue; }
    const h = lines[i].h;
    // Header labels that wrap onto the line just above or below ("Concentration/" over "Major", "Training" over "Title").
    for (const j of [i - 1, i + 1]) {
      const l = lines[j];
      if (!l || Math.abs(l.top - lines[i].top) > 1.8 * h || l.page !== lines[i].page) continue;
      const fits = l.items.every((it) => HEADER_WORD.test(it.str.trim()) || /^(?:major|title)$/i.test(it.str.trim()));
      if (!fits || !l.items.every((it) => cols.some((c) => it.x + it.w > c.x0 - 6 && it.x < c.x1 + 6))) continue;
      for (const it of l.items) {
        const c = cols.find((k) => it.x + it.w > k.x0 - 6 && it.x < k.x1 + 6)!;
        c.label = j < i ? `${it.str.trim()} ${c.label}` : `${c.label} ${it.str.trim()}`;
      }
      if (j < i) { if (out[out.length - 1] === l) out.pop(); } else i++;
    }
    for (const c of cols) c.label = c.label.replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ');

    const body: Line[] = [];
    const side: Line[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (/^page \d+(?: of \d+)?$/i.test(l.text)) continue;
      if (headerCols(l)) break;
      // Text left of the table: the next section's heading once rows have started, or a side heading beside the table.
      const inside = l.items.filter((it) => it.x + it.w > cols[0].x0 - 15);
      const outside = l.items.filter((it) => !inside.includes(it));
      if (!inside.length || SECTION_END.test(l.text)) {
        if (body.length && isHeading(l, cols[0])) break;
        if (!body.length) { side.push(l); continue; }
        if (!inside.length) break;
      }
      if (outside.length) side.push({ ...l, items: outside, text: joinItems(outside) });
      body.push(outside.length ? { ...l, items: inside, text: joinItems(inside) } : l);
    }
    i = j - 1;

    const colOf = (it: PdfItem) => {
      const cx = it.x + it.w / 2;
      let k = 0;
      cols.forEach((c, n) => { if (Math.abs(c.cx - cx) < Math.abs(cols[k].cx - cx)) k = n; });
      return k;
    };
    const anchorCol = cols.findIndex((c) => /year/i.test(c.label)) >= 0 ? cols.findIndex((c) => /year/i.test(c.label)) : cols.findIndex((c) => /^from$/i.test(c.label));
    const cells = body.flatMap((l) => l.items.map((it) => ({ it, top: l.top, col: colOf(it), h: l.h })));
    // Each row starts at its year (tables are written one row per year); without one, every full line is a row.
    let anchors = anchorCol >= 0
      ? [...new Set(cells.filter((c) => c.col === anchorCol && /\d{4}/.test(c.it.str)).map((c) => c.top))]
      : body.filter((l) => new Set(l.items.map(colOf)).size >= Math.max(2, cols.length - 1)).map((l) => l.top);
    if (!anchors.length) anchors = body.length ? [body[0].top] : [];
    anchors.sort((a, b) => a - b);

    const rows: string[][][] = anchors.map(() => cols.map(() => []));
    cols.forEach((_, k) => {
      const inCol = cells.filter((c) => c.col === k).sort((a, b) => a.top - b.top || a.it.x - b.it.x);
      // Lines of one cell sit close together; a bigger gap starts the next row's cell.
      const blocks: (typeof inCol)[] = [];
      const step = Math.min(...inCol.slice(1).map((c, n) => c.top - inCol[n].top).filter((d) => d > 1), 1.35 * h);
      for (const c of inCol) {
        const b = blocks[blocks.length - 1];
        if (b && c.top - b[b.length - 1].top <= Math.max(1.5, step * 1.22)) b.push(c); else blocks.push([c]);
      }
      for (const b of blocks) {
        const lo = b[0].top - 0.6 * h;
        const hi = b[b.length - 1].top + 0.6 * h;
        const inside = anchors.map((a, n) => ({ a, n })).filter(({ a }) => a >= lo && a <= hi);
        if (inside.length > 1) {
          // One block over several rows: split it at the rows' starts.
          for (const c of b) {
            const n = Math.max(0, anchors.findIndex((a, m) => c.top >= a - 0.6 * h && (m === anchors.length - 1 || c.top < anchors[m + 1] - 0.6 * h)));
            rows[n][k].push(c.it.str);
          }
          continue;
        }
        const mid = (b[0].top + b[b.length - 1].top) / 2;
        const n = inside.length ? inside[0].n : anchors.reduce((best, a, m) => (Math.abs(a - mid) < Math.abs(anchors[best] - mid) ? m : best), 0);
        rows[n][k].push(...b.map((c) => c.it.str));
      }
    });
    const first = body[0] ?? lines[i];
    const rowLines: Line[] = [];
    rows.forEach((r, n) => {
      const text = r.map((parts, k) => {
        const v = parts.join(' ').replace(/\s+/g, ' ').trim();
        return v ? `${cols[k].label}: ${v}` : '';
      }).filter(Boolean).join(' | ');
      if (text) rowLines.push({ ...first, top: anchors[n], items: [], text });
    });
    // Side headings keep their place among the rows (a heading level with the last row comes after it).
    const merged = [...rowLines.map((l) => ({ l, o: 0 })), ...side.map((l) => ({ l, o: 1 }))].sort((a, b) => a.l.top - b.l.top || a.o - b.o);
    out.push(...merged.map((m) => m.l));
  }
  return out;
}

/** The candidate's name as printed in the biggest letters near the top of page 1 (one or two lines). */
function nameHintOf(page: PdfPage | undefined): string | null {
  if (!page) return null;
  const items = page.items.filter((i) => i.str.trim());
  const body = median(items.map((i) => i.h));
  const top = items.filter((i) => i.y > page.height * 0.55 && /[A-Za-z]/.test(i.str));
  const maxH = Math.max(0, ...top.map((i) => i.h));
  if (!maxH || maxH < body * 1.25) return null;
  const big = toLines(top.filter((i) => i.h >= maxH * 0.92), 0, page.height);
  if (!big.length) return null;
  const parts = [big[0].text];
  if (big[1] && big[1].top - big[0].top <= maxH * 1.8 && big[1].text.split(/\s+/).length <= 2) parts.push(big[1].text);
  const name = parts.join(' ').replace(/\s+/g, ' ').trim();
  return /^[A-Za-z][A-Za-z.\-' ]{2,60}$/.test(name) && name.split(' ').length <= 6 ? name : null;
}

export function layoutPdf(pages: PdfPage[]): PdfLayout {
  const lines = pages.flatMap((p, n) => readingOrder(p, n));
  const text = rebuildTables(lines)
    .filter((l) => !/^page \d+(?: of \d+)?$/i.test(l.text))
    .map((l) => l.text)
    .join('\n');
  return { text, nameHint: nameHintOf(pages[0]) };
}

/** Reads the positioned text of every page with the PDF engine bundled in pdf-parse. */
export async function readPdfPages(buffer: Buffer): Promise<PdfPage[] | null> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const load = (parser as any).load;
    if (typeof load !== 'function') return null;
    const doc = await load.call(parser);
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of tc.items as any[]) {
        if (typeof it.str !== 'string' || !it.str.trim()) continue;
        const [a, b, , d, e, f] = it.transform as number[];
        const h = Math.abs(it.height) || Math.hypot(a, b) || Math.abs(d) || 10;
        items.push({ str: it.str, x: e, y: f, w: Math.abs(it.width) || it.str.length * h * 0.5, h });
      }
      pages.push({ width: vp.width, height: vp.height, items });
      page.cleanup();
    }
    return pages;
  } finally {
    await parser.destroy();
  }
}
