'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ------------------------------------------------------------------ data loading

/** Loads data and exposes loading/error/empty states (SRS 17.1). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fnRef.current());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { data, error, loading, reload, setData };
}

/** Wraps a mutation: tracks busy state, field errors and a result message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setMessage(null);
    try {
      const r = await fn();
      if (success) setMessage(typeof success === 'function' ? success(r) : success);
      return r;
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, fieldErrors, message, run, setError, setMessage };
}

// ------------------------------------------------------------------ primitives

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; busy?: boolean };

export function Button({ variant = 'primary', size = 'md', busy, className, children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 border-brand-600',
    secondary: 'bg-white text-ink hover:bg-slate-50 border-line',
    danger: 'bg-white text-red-700 hover:bg-red-50 border-red-200',
    ghost: 'bg-transparent text-brand-700 hover:bg-brand-50 border-transparent',
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm', styles, className)}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = 'secondary' }: { href: string; children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Link href={href} className={cx('inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-sm font-medium',
      variant === 'primary' ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700' : 'border-line bg-white hover:bg-slate-50')}>
      {children}
    </Link>
  );
}

const STATUS_TONE: Record<string, string> = {
  // requisition
  Draft: 'slate', 'Pending Approval': 'amber', 'Returned for Clarification': 'orange', Rejected: 'red', Approved: 'green', 'Sent to HR': 'green', Cancelled: 'slate',
  // approvals
  Waiting: 'slate', Pending: 'amber', Returned: 'orange', Superseded: 'slate',
  // vacancy / job post
  Open: 'blue', Posting: 'blue', Screening: 'violet', 'On Hold': 'orange', Filled: 'green', Closed: 'slate', Published: 'green',
  // processing / screening
  Received: 'slate', Unmatched: 'orange', Queued: 'slate', Processing: 'blue', Completed: 'green', Partial: 'amber', Failed: 'red',
  Pass: 'green', Fail: 'red', 'Review Required': 'amber', Success: 'green', 'Not screened': 'slate',
  // decisions / email / joining
  Shortlisted: 'violet', Interview: 'blue', Joined: 'green', Selected: 'green', 'Not Selected': 'red', Sent: 'green', Skipped: 'orange', 'Not Recorded': 'slate', Present: 'green', Absent: 'red',
  PENDING: 'amber', MERGED: 'green', SEPARATE: 'slate', DIRECT_HR: 'violet', REQUISITION: 'blue',
};
const TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', orange: 'bg-orange-50 text-orange-800 ring-orange-200',
  red: 'bg-red-50 text-red-700 ring-red-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const t = tone ?? STATUS_TONE[String(children)] ?? 'slate';
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[t])}>{children}</span>;
}

export function Card({ title, actions, children, className, pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-lg border border-line bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && <Link href={back.href} className="text-xs text-brand-700 hover:underline">&larr; {back.label}</Link>}
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info' | 'warning'; children: React.ReactNode }) {
  if (!children) return null;
  const s = { error: 'border-red-200 bg-red-50 text-red-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-800', info: 'border-brand-200 bg-brand-50 text-brand-900', warning: 'border-amber-200 bg-amber-50 text-amber-900' }[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-md border px-3 py-2 text-sm', s)}>{children}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center gap-2 py-8 text-sm text-muted"><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />{label}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-line py-10 text-center text-sm text-muted">{children}</div>;
}

/** Standard loading / error / empty wrapper for a loaded resource. */
export function Loaded<T>({ state, empty, children }: { state: { data: T | null; error: string | null; loading: boolean }; empty?: (d: T) => React.ReactNode | false; children: (d: T) => React.ReactNode }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <Alert>{state.error}</Alert>;
  if (!state.data) return null;
  const e = empty?.(state.data);
  if (e) return <Empty>{e}</Empty>;
  return <>{children(state.data)}</>;
}

// ------------------------------------------------------------------ form fields

const inputCls = 'w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-muted';

export function Field({ label, error, hint, required, children, className }: { label: React.ReactNode; error?: string; hint?: React.ReactNode; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return <input {...rest} className={cx(inputCls, invalid && 'border-red-400', className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return <textarea rows={3} {...rest} className={cx(inputCls, invalid && 'border-red-400', className)} />;
}

export function Select({ options, placeholder, invalid, className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string; invalid?: boolean }) {
  return (
    <select {...rest} className={cx(inputCls, invalid && 'border-red-400', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Radio<T extends string | number | boolean>({ name, value, options, onChange, disabled }: { name: string; value: T | null | undefined; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-3 py-1">
      {options.map((o) => (
        <label key={String(o.value)} className="inline-flex items-center gap-1.5 text-sm">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} disabled={disabled} className="accent-brand-600" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ table, tabs, modal, pager

export function Table({ head, children, className }: { head: React.ReactNode[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => <td className={cx('px-3 py-2 align-top', className)}>{children}</td>;

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: React.ReactNode }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={cx('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', active === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-4xl' : 'max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
      <span>{total} record{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Stat({ label, value, tone = 'brand', href, hint }: { label: string; value: React.ReactNode; tone?: 'brand' | 'green' | 'amber' | 'red' | 'violet' | 'slate'; href?: string; hint?: string }) {
  const c = { brand: 'text-brand-700', green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-700', violet: 'text-violet-700', slate: 'text-ink' }[tone];
  const body = (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm transition hover:border-brand-200">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', c)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function DL({ items, cols = 2 }: { items: [React.ReactNode, React.ReactNode][]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3 text-sm', { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols])}>
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Confirmation dialog for irreversible actions (SRS 17.1), optionally requiring a reason. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, requireReason, reasonLabel = 'Reason', busy, error, onConfirm, onClose }: {
  open: boolean; title: string; message?: React.ReactNode; confirmLabel?: string; danger?: boolean; requireReason?: boolean; reasonLabel?: string;
  busy?: boolean; error?: string | null; onConfirm: (reason: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal open={open} title={title} onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Back</Button>
      <Button variant={danger ? 'danger' : 'primary'} busy={busy} disabled={requireReason && reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
    </>}>
      <div className="space-y-3">
        {message && <div className="text-sm text-ink">{message}</div>}
        {requireReason !== undefined && (
          <Field label={reasonLabel} required={requireReason}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        )}
        <Alert>{error}</Alert>
      </div>
    </Modal>
  );
}
