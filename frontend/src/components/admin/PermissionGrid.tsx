'use client';

import { useState } from 'react';
import { cx } from '@/components/ui';

export type ScopeMode = 'own' | 'all' | 'custom';
export type ScopeValue = { mode: ScopeMode; departmentIds?: string[] };
export type DepartmentScopes = Record<string, ScopeValue | undefined>;

export interface Matrix {
  actions: { key: string; label: string }[];
  modules: {
    key: string;
    label: string;
    defaultLabel?: string;
    description?: string | null;
    actions: Record<string, string[] | undefined>;
    extras?: { code: string; label: string }[];
    scope?: { module: string; note: string };
  }[];
  scopeModules: string[];
  scopeDefaults: Record<string, string>;
  /** Administrator label / description overrides and the system-wide off switch, by permission code. */
  permissions?: Record<string, { label: string | null; description: string | null; disabled: boolean } | undefined>;
}

/**
 * Module-wise permission editor. `base` is what the user's roles grant (empty for roles and templates);
 * `allow` adds codes on top and `deny` removes them. With `allowDeny` off only Allow is shown (roles, templates).
 */
export function PermissionGrid({ matrix, base, allow, deny, allowDeny, onChange, scopes, onScopes, departments, readOnly }: {
  matrix: Matrix;
  base: string[];
  allow: string[];
  deny: string[];
  allowDeny: boolean;
  onChange: (allow: string[], deny: string[]) => void;
  scopes?: DepartmentScopes;
  onScopes?: (s: DepartmentScopes) => void;
  departments?: { id: string; name: string }[];
  readOnly?: boolean;
}) {
  const [active, setActive] = useState(matrix.modules[0]?.key);
  const mod = matrix.modules.find((m) => m.key === active) ?? matrix.modules[0];
  const role = new Set(base);
  const allowed = new Set([...base, ...allow].filter((c) => !deny.includes(c)));
  const has = (codes: string[]) => codes.every((c) => allowed.has(c));
  const denied = (codes: string[]) => codes.every((c) => deny.includes(c));
  const fromRole = (codes: string[]) => codes.every((c) => role.has(c));

  const setAllow = (codes: string[], on: boolean) => {
    let a = allow.filter((c) => !codes.includes(c));
    let d = deny.filter((c) => !codes.includes(c));
    for (const c of codes) {
      if (on && !role.has(c)) a = [...a, c];
      if (!on && role.has(c)) d = [...d, c];
    }
    onChange(a, d);
  };
  const setDeny = (codes: string[], on: boolean) => {
    const a = allow.filter((c) => !codes.includes(c));
    const d = deny.filter((c) => !codes.includes(c));
    onChange(on ? a : allow, on ? [...d, ...codes] : d);
  };
  const count = (m: Matrix['modules'][number]) => {
    const codes = new Set([...Object.values(m.actions).flat(), ...(m.extras ?? []).map((e) => e.code)].filter(Boolean) as string[]);
    return [...codes].filter((c) => allowed.has(c)).length;
  };

  const rows: { key: string; label: string; codes: string[]; note?: string }[] = [
    ...matrix.actions.map((a) => ({ key: a.key, label: a.label, codes: mod.actions[a.key] ?? [] })),
    ...(mod.extras ?? []).map((e) => ({ key: e.code, label: matrix.permissions?.[e.code]?.label || e.label, codes: [e.code] })),
  ];
  const setting = (codes: string[]) => codes.map((c) => matrix.permissions?.[c]).find(Boolean);
  const off = (codes: string[]) => codes.some((c) => matrix.permissions?.[c]?.disabled);
  const shared = mod.actions.approve && mod.actions.reject && mod.actions.approve.join() === mod.actions.reject.join();

  return (
    <div className="grid gap-3 md:grid-cols-[13rem_1fr]">
      <nav className="flex flex-row flex-wrap gap-1 md:flex-col md:flex-nowrap" aria-label="Modules">
        {matrix.modules.map((m) => (
          <button key={m.key} type="button" onClick={() => setActive(m.key)}
            className={cx('flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
              m.key === mod.key ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-200' : 'text-ink hover:bg-slate-50')}>
            <span>{m.label}</span>
            {count(m) > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] tabular-nums text-muted">{count(m)}</span>}
          </button>
        ))}
      </nav>

      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="border-b border-line bg-slate-50 px-3 py-2 text-sm font-semibold">{mod.label} permissions
            {mod.description && <div className="text-xs font-normal text-muted">{mod.description}</div>}</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-1.5 text-left font-medium">Permission</th>
                <th className="w-20 px-3 py-1.5 font-medium">Allow</th>
                {allowDeny && <th className="w-20 px-3 py-1.5 font-medium">Deny</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cx('border-b border-line last:border-0', !r.codes.length && 'text-muted')}>
                  <td className="px-3 py-1.5">
                    {r.label}
                    {r.codes.length > 0 && <span className="ml-2 text-[11px] text-muted">{r.codes.join(', ')}</span>}
                    {r.codes.length > 0 && off(r.codes) && <span className="ml-2 rounded bg-red-50 px-1 text-[11px] text-red-700">switched off system-wide</span>}
                    {setting(r.codes)?.description && <div className="text-[11px] text-muted">{setting(r.codes)!.description}</div>}
                    {allowDeny && r.codes.length > 0 && fromRole(r.codes) && <span className="ml-2 rounded bg-slate-100 px-1 text-[11px] text-muted">from role</span>}
                  </td>
                  {r.codes.length ? (
                    <>
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" aria-label={`Allow ${mod.label}: ${r.label}`} className="h-4 w-4 accent-brand-600" disabled={readOnly}
                          checked={has(r.codes)} onChange={(e) => setAllow(r.codes, e.target.checked)} />
                      </td>
                      {allowDeny && (
                        <td className="px-3 py-1.5 text-center">
                          <input type="checkbox" aria-label={`Deny ${mod.label}: ${r.label}`} className="h-4 w-4 accent-red-600" disabled={readOnly}
                            checked={denied(r.codes)} onChange={(e) => setDeny(r.codes, e.target.checked)} />
                        </td>
                      )}
                    </>
                  ) : <td colSpan={allowDeny ? 2 : 1} className="px-3 py-1.5 text-center text-xs">—</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {shared && <div className="border-t border-line px-3 py-1.5 text-xs text-muted">Approve and Reject / Return use the same permission.</div>}
        </div>

        {mod.scope && scopes && onScopes && (
          <ScopeEditor module={mod.scope.module} note={mod.scope.note} label={mod.label} value={scopes[mod.scope.module]}
            defaultAll={allowed.has(matrix.scopeDefaults[mod.scope.module])} departments={departments ?? []} readOnly={readOnly}
            onChange={(v) => onScopes({ ...scopes, [mod.scope!.module]: v })} />
        )}
      </div>
    </div>
  );
}

function ScopeEditor({ module, note, label, value, defaultAll, departments, onChange, readOnly }: {
  module: string; note: string; label: string; value: ScopeValue | undefined; defaultAll: boolean;
  departments: { id: string; name: string }[]; onChange: (v: ScopeValue | undefined) => void; readOnly?: boolean;
}) {
  const mode = value?.mode ?? 'default';
  const ids = value?.departmentIds ?? [];
  const options: { key: ScopeMode | 'default'; label: string }[] = [
    { key: 'default', label: `Role default (${defaultAll ? 'all departments' : 'own department'})` },
    { key: 'own', label: 'Own Department Only' }, { key: 'all', label: 'All Departments' }, { key: 'custom', label: 'Custom Departments' },
  ];
  return (
    <div className="rounded-lg border border-line bg-slate-50 p-3">
      <div className="text-sm font-semibold">Access Scope <span className="font-normal text-muted">(for {label})</span></div>
      <div className="mb-2 text-xs text-muted">{note}. Enforced by the API.</div>
      <div className="space-y-1.5">
        {options.map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`scope-${module}`} className="accent-brand-600" disabled={readOnly} checked={mode === o.key}
              onChange={() => onChange(o.key === 'default' ? undefined : { mode: o.key, departmentIds: o.key === 'custom' ? ids : undefined })} />
            {o.label}
          </label>
        ))}
      </div>
      {mode === 'custom' && (
        <div className="mt-2 max-h-48 overflow-auto rounded-md border border-line bg-white p-2">
          <div className="grid gap-1 sm:grid-cols-2">
            {departments.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-brand-600" disabled={readOnly} checked={ids.includes(d.id)}
                  onChange={(e) => onChange({ mode: 'custom', departmentIds: e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id) })} />
                {d.name}
              </label>
            ))}
          </div>
          {!ids.length && <div className="mt-1 text-xs text-red-700">Choose at least one department.</div>}
        </div>
      )}
    </div>
  );
}

/** Drops "role default" entries so only real choices are sent to the API. */
export const cleanScopes = (s: DepartmentScopes) => Object.fromEntries(Object.entries(s).filter(([, v]) => v)) as Record<string, ScopeValue>;
