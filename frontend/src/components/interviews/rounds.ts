/** The three marks (owner, 2026-11-04): Written exam and Interview board (viva) for every shortlisted candidate, Optional exam only when held. */
export const ROUNDS = [['WRITTEN', 'Written exam'], ['INTERVIEW', 'Interview board (viva)'], ['OPTIONAL', 'Optional exam']] as const;
export type Round = (typeof ROUNDS)[number][0];
export const ROUND_LABEL: Record<string, string> = Object.fromEntries(ROUNDS);
export const DECISIONS = ['Pending', 'Selected', 'Not Selected', 'On Hold'];

/**
 * Written exam and Interview board are held together on one day: one slot (time, venue, panel, attendance) for both.
 * The API writes those fields to both rounds, so either row can be read.
 */
export type Kind = 'MAIN' | 'OPTIONAL';
export const KIND_LABEL: Record<Kind, string> = { MAIN: 'Written exam & interview board', OPTIONAL: 'Optional exam' };
/** The round a slot of this kind is saved through. */
export const KIND_ROUND: Record<Kind, Round> = { MAIN: 'INTERVIEW', OPTIONAL: 'OPTIONAL' };
export const slotStage = (row: any, kind: Kind) => (kind === 'MAIN' ? row.stages.INTERVIEW ?? row.stages.WRITTEN : row.stages.OPTIONAL);
export const markOf = (row: any, round: string) => row.marks.find((m: any) => m.stageType === round && m.component === 'Total');

/** Local calendar day, e.g. "2026-11-10", so slots group by the day HR sees. */
export const dayKey = (d: string | Date) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const time = (d: string | Date) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const shortDate = (d: string | Date) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
export const endTime = (d: string | Date, minutes?: number | null) => (minutes ? time(new Date(new Date(d).getTime() + minutes * 60000)) : null);
/** Value for <input type="datetime-local"> in the browser's time zone. */
export const toLocalInput = (d?: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  return `${dayKey(x)}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

export type Slot = { row: any; kind: Kind; stage: any };

/** Every scheduled slot of the given rows, earliest first. */
export function slotsOf(rows: any[], kind?: string): Slot[] {
  return rows.flatMap((row) => (['MAIN', 'OPTIONAL'] as Kind[]).filter((k) => !kind || k === kind).map((k) => ({ row, kind: k, stage: slotStage(row, k) })))
    .filter((s) => s.stage?.scheduledAt)
    .sort((a, b) => new Date(a.stage.scheduledAt).getTime() - new Date(b.stage.scheduledAt).getTime());
}

/** What HR has to do next for a shortlisted candidate. */
export function nextStep(row: any, now = new Date()): { label: string; tone: string } {
  if (row.joining?.status === 'Approved') return { label: 'Joined', tone: 'green' };
  if (row.joining?.status === 'Rejected') return { label: 'Rejected at joining', tone: 'red' };
  if (row.finalDecision === 'Selected') return { label: 'Selected: joining pending', tone: 'green' };
  if (row.finalDecision === 'Not Selected') return { label: 'Not selected', tone: 'slate' };
  if (row.finalDecision === 'On Hold') return { label: 'On hold: decide later', tone: 'amber' };
  const main = slotStage(row, 'MAIN');
  if (!main?.scheduledAt) return { label: 'Schedule written & interview', tone: 'orange' };
  for (const kind of ['MAIN', 'OPTIONAL'] as Kind[]) {
    const s = slotStage(row, kind);
    if (!s?.scheduledAt) continue;
    const when = new Date(s.scheduledAt);
    const name = kind === 'MAIN' ? 'Written & interview' : 'Optional exam';
    if (s.attendance === 'Not Recorded') {
      return when > now ? { label: `${name} on ${shortDate(when)} ${time(when)}`, tone: 'blue' } : { label: `Record attendance: ${name.toLowerCase()}`, tone: 'amber' };
    }
    if (s.attendance === 'Present') {
      const missing = (kind === 'MAIN' ? ['WRITTEN', 'INTERVIEW'] : ['OPTIONAL']).filter((r) => !markOf(row, r));
      if (missing.length) return { label: `Enter marks: ${missing.map((r) => ROUND_LABEL[r].replace(' (viva)', '').toLowerCase()).join(', ')}`, tone: 'amber' };
    }
  }
  return { label: 'Record final decision', tone: 'violet' };
}
