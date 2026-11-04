// Papierkorb: Fristen und Datumstexte (ohne DOM, damit per Vitest prüfbar). Oberfläche: pages/trash.tsx.
import { TRASH_DAYS } from '../protocol';

const DAY_MS = 86_400_000;

/** Ganze Tage bis zum endgültigen Löschen (aufgerundet, nie negativ). */
export function daysLeft(purgeAt: string, now = Date.now()): number {
  const t = Date.parse(purgeAt);
  if (!Number.isFinite(t)) return TRASH_DAYS;
  return Math.max(0, Math.ceil((t - now) / DAY_MS));
}

/** „Wird endgültig gelöscht in 29 Tagen“ */
export function purgeText(purgeAt: string, now = Date.now()): string {
  const n = daysLeft(purgeAt, now);
  if (n === 0) return 'Wird heute endgültig gelöscht';
  return `Wird endgültig gelöscht in ${n} ${n === 1 ? 'Tag' : 'Tagen'}`;
}

/** „30. Okt. 2026, 14:05“ */
export const fullDate = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

