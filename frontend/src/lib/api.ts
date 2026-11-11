export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; form?: FormData; raw?: boolean };

/** Fetch wrapper for the ARS API. Errors carry the server's safe message and field-level errors. */
export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers: opts.form ? undefined : opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
  }
  if (!res.ok) {
    let body: any = {};
    try { body = await res.json(); } catch { /* non-JSON error */ }
    const msg = Array.isArray(body.message) ? body.message.join(' ') : body.message ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body.fieldErrors ?? {});
  }
  if (opts.raw) return res as any;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Downloads an authorized file response (Excel export, templates, CV pack). Pass `body` to POST a JSON payload. */
export async function download(path: string, body?: unknown) {
  const res: Response = await api(path, { raw: true, ...(body !== undefined ? { method: 'POST', body } : {}) });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = decodeURIComponent(cd.match(/filename="?([^";]+)"?/)?.[1] ?? 'download');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)])).toString()}` : '';
}

export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
/** Requisition status as users read it: in approval = Processing; fully approved (persisted "Sent to HR") = Approved. */
export const reqStatusLabel = (status: string) =>
  status === 'Pending Approval' ? 'Processing' : status === 'Sent to HR' || status === 'Approved' ? 'Approved' : status;

/** Remark the API writes on steps that a final approval closed (requisitions.service, final approval on behalf). */
const FINAL_CLOSED = /^Not required: approved by (.+) \(final approval\)$/;
/**
 * How an approval step reads (owner, 2026-11-04): once a final approver approves, the steps it closed show Approved,
 * credited to that approver. The stored step stays Superseded, so the record never claims the named approver acted.
 */
export function approvalStep(a: any, steps: any[]) {
  const m = a.status === 'Superseded' ? a.remarks?.match(FINAL_CLOSED) : null;
  if (!m) return { status: a.status as string, note: a.remarks as string | null, decidedAt: a.decidedAt as string | null };
  const final = steps.find((s) => s.version === a.version && s.status === 'Approved' && s.actedBy);
  return { status: 'Approved', note: `Approved by ${m[1]} (final approval)`, decidedAt: final?.decidedAt ?? null };
}

/** Most bytes one upload request carries; kept under the /api proxy limit in next.config.ts (100 MB). */
export const UPLOAD_BATCH_BYTES = 80 * 1024 * 1024;

/** Splits files into upload requests of at most `maxFiles` files and UPLOAD_BATCH_BYTES bytes (a bigger single file goes alone). */
export function uploadBatches<T extends { size: number }>(files: T[], maxFiles: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const f of files) {
    if (cur.length && (cur.length >= maxFiles || bytes + f.size > UPLOAD_BATCH_BYTES)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(f);
    bytes += f.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

export const show = (v: unknown, empty = '—') => (v === null || v === undefined || v === '' ? empty : String(v));

export function newKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
