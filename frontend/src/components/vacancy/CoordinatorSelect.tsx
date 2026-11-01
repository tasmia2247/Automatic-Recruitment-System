'use client';

import { useState } from 'react';
import { Select } from '@/components/ui';
import { api } from '@/lib/api';

export type Coordinator = { id: string; name: string; designation?: string | null };

/**
 * HR coordinator picker: the list comes from active HR users, so new HR accounts appear automatically.
 * `path` is the assignment endpoint (requisition in the HR queue, or a vacancy). Empty = Unassigned.
 */
export function CoordinatorSelect({ path, value, options, onSaved, onError }: {
  path: string;
  value: Coordinator | null;
  options: Coordinator[];
  onSaved?: (c: Coordinator | null) => void;
  onError?: (message: string) => void;
}) {
  const [current, setCurrent] = useState<Coordinator | null>(value);
  const [busy, setBusy] = useState(false);

  const change = async (id: string) => {
    setBusy(true);
    try {
      const r = await api<{ coordinator: Coordinator | null }>(path, { method: 'PUT', body: { coordinatorId: id || null } });
      setCurrent(r.coordinator);
      onSaved?.(r.coordinator);
    } catch (e: any) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  // A coordinator who is no longer an active HR user stays visible until someone else is chosen.
  const list = current && !options.some((o) => o.id === current.id) ? [current, ...options] : options;
  return (
    <div className="min-w-[11rem]">
      <Select aria-label="Coordinator" value={current?.id ?? ''} disabled={busy} onChange={(e) => change(e.target.value)}
        className={current ? '' : 'border-amber-300 text-amber-800'} placeholder="Unassigned"
        options={list.map((o) => ({ value: o.id, label: o.designation ? `${o.name} (${o.designation})` : o.name }))} />
    </div>
  );
}
