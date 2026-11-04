// Texte des Versionsverlaufs: Tage gruppieren, Zeiten und Beschreibungen (ohne React, getestet in versions.test.ts).
import type { BoardVersionInfo, BoardVersionPerson } from '../../protocol';

const pad = (n: number) => String(n).padStart(2, '0');

/** Kalendertag in Ortszeit, z. B. „2026-10-30“. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** „Heute“, „Gestern“, sonst „Mittwoch, 28. Oktober“ (mit Jahr, wenn nicht dieses Jahr). */
export function dayLabel(d: Date, now = new Date()): string {
  if (dayKey(d) === dayKey(now)) return 'Heute';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return 'Gestern';
  const s = `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? s : `${s} ${d.getFullYear()}`;
}

/** „14:20“ */
export const timeLabel = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** „28.10., 14:20“ (mit Jahr, wenn nicht dieses Jahr) */
export function stamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear() === now.getFullYear() ? '' : d.getFullYear()}`;
  return `${day}, ${timeLabel(d)}`;
}

/** „heute, 14:20“, „gestern, 9:05“ bzw. „28.10., 14:20“ – für Hinweise und den Vorschau-Balken. */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = dayLabel(d, now);
  if (day === 'Heute' || day === 'Gestern') return `${day.toLowerCase()}, ${timeLabel(d)}`;
  return stamp(iso, now);
}

export interface DayGroup {
  key: string;
  label: string;
  items: BoardVersionInfo[];
}

/** Versionen (neueste zuerst) nach Kalendertagen gruppieren. */
export function groupByDay(list: readonly BoardVersionInfo[], now = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const v of list) {
    const d = new Date(v.createdAt);
    const key = dayKey(d);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) groups.push((g = { key, label: dayLabel(d, now), items: [] }));
    g.items.push(v);
  }
  return groups;
}

const names = (people: readonly BoardVersionPerson[]) => {
  const n = people.map((p) => p.name.split(/\s+/)[0] || p.name);
  return n.length <= 2 ? n.join(' und ') : `${n.slice(0, 2).join(', ')} und ${n.length - 2} weitere`;
};

/** Zweite Zeile eines Eintrags: was diese Version ist. */
export function describe(v: BoardVersionInfo, now = new Date()): string {
  switch (v.kind) {
    case 'manual':
      return v.by ? `Gespeichert von ${v.by.name}` : 'Gespeichert';
    case 'backup':
      return 'Sicherung vor dem Wiederherstellen';
    case 'restored':
      return `${v.by?.name ?? 'Jemand'} hat ${v.restoredFrom ? `den Stand von ${whenLabel(v.restoredFrom, now)}` : 'eine Version'} wiederhergestellt`;
    default:
      return v.people.length ? `Bearbeitet von ${names(v.people)}` : 'Automatisch gesichert';
  }
}

/** Personen für die Avatare: wer geändert hat, dazu wer gespeichert/wiederhergestellt hat. */
export function peopleOf(v: BoardVersionInfo): BoardVersionPerson[] {
  const out = [...v.people];
  if (v.by && !out.some((p) => p.key === v.by!.key)) out.push(v.by);
  return out;
}

export const objectsLabel = (n: number) => (n === 1 ? '1 Objekt' : `${n} Objekte`);
