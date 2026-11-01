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

/** Downloads an authorized file response (Excel export, templates). */
export async function download(path: string) {
  const res: Response = await api(path, { raw: true });
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

export const show = (v: unknown, empty = '—') => (v === null || v === undefined || v === '' ? empty : String(v));

export function newKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
