// Import aus anderen Whiteboards (docs/features/import.md): Texte, Fortschritt, Bericht, Fehler, Rückkehr von Miro.
// Ohne React, getestet in import.test.ts.
import { IMPORT_MAX_BOARDS_PER_REQUEST, type ImportJob, type ImportPhase, type ImportReport } from '../../../../shared/import';
import { ApiError, ERROR_TEXT } from '../../api';
import { relativeTime } from '../../ui/time';

export { IMPORT_MAX_BOARDS_PER_REQUEST };

/** Hinweis zur Marke, klein im Dialog (docs/features/import.md). */
export const BRAND_NOTE = 'Miro ist eine Marke der RealtimeBoard, Inc. Stachel steht in keiner Verbindung zu Miro.';

/** Seite in Miro, auf der man eine eigene App anlegt und das Token bekommt. */
export const MIRO_APPS_URL = 'https://miro.com/app/settings/user-profile/apps';

// ---- Fortschritt ----------------------------------------------------------------------------------------------

const PHASE_LABEL: Record<ImportPhase, string> = {
  queued: 'Wartet',
  read: 'Objekte lesen',
  images: 'Bilder laden',
  build: 'Board anlegen',
  done: 'Fertig',
};

export const isActive = (j: Pick<ImportJob, 'status'>) => j.status === 'queued' || j.status === 'running';

/** Was gerade passiert, z. B. „Bilder laden“; nach dem Ende der Status. */
export function phaseLabel(j: Pick<ImportJob, 'status' | 'phase'>): string {
  if (j.status === 'done') return 'Fertig';
  if (j.status === 'failed') return 'Fehlgeschlagen';
  if (j.status === 'canceled') return 'Abgebrochen';
  if (j.status === 'queued') return 'Wartet auf den Start';
  return PHASE_LABEL[j.phase] ?? 'Läuft';
}

/** Anteil der aktuellen Phase (0–1) oder null, wenn der Server noch keine Gesamtzahl kennt. */
export function progressOf(j: Pick<ImportJob, 'status' | 'done' | 'total'>): number | null {
  if (j.status === 'done') return 1;
  if (!isActive(j) || !(j.total > 0)) return null;
  return Math.min(1, Math.max(0, j.done / j.total));
}

/** „Objekte lesen · 3 von 12“ bzw. nur die Phase. */
export function progressText(j: Pick<ImportJob, 'status' | 'phase' | 'done' | 'total'>): string {
  const label = phaseLabel(j);
  if (!isActive(j) || j.status === 'queued' || !(j.total > 0)) return label;
  return `${label} · ${Math.min(j.done, j.total)} von ${j.total}`;
}

/** Kurzer Status für die Liste „Letzte Importe“. */
export function statusChip(j: ImportJob): { text: string; tone: 'run' | 'ok' | 'bad' | 'off' } {
  if (j.status === 'done') return { text: 'Fertig', tone: 'ok' };
  if (j.status === 'failed') return { text: 'Fehlgeschlagen', tone: 'bad' };
  if (j.status === 'canceled') return { text: 'Abgebrochen', tone: 'off' };
  const p = progressOf(j);
  return { text: p === null ? phaseLabel(j) : `${phaseLabel(j)} ${Math.round(p * 100)} %`, tone: 'run' };
}

/** Überschrift über dem Fortschritt bzw. Ergebnis. */
export function jobsHeading(jobs: readonly Pick<ImportJob, 'status'>[]): string {
  const many = jobs.length > 1;
  if (jobs.some(isActive)) return many ? 'Boards werden übernommen' : 'Board wird übernommen';
  if (jobs.every((j) => j.status === 'done')) return 'Import fertig';
  if (!many && jobs[0]?.status === 'failed') return 'Import fehlgeschlagen';
  if (!many && jobs[0]?.status === 'canceled') return 'Import abgebrochen';
  return 'Import beendet';
}

// ---- Bericht --------------------------------------------------------------------------------------------------

/** Deutsche Namen der Stachel-Typen im Bericht (Einzahl, Mehrzahl). */
const TYPE_NAMES: Record<string, [string, string]> = {
  sticky: ['Notiz', 'Notizen'],
  shape: ['Form', 'Formen'],
  text: ['Text', 'Texte'],
  connector: ['Verbinder', 'Verbinder'],
  frame: ['Rahmen', 'Rahmen'],
  image: ['Bild', 'Bilder'],
  document: ['Dokument', 'Dokumente'],
  card: ['Karte', 'Karten'],
  mindnode: ['Mindmap-Knoten', 'Mindmap-Knoten'],
  table: ['Tabelle', 'Tabellen'],
  pen: ['Zeichnung', 'Zeichnungen'],
  line: ['Linie', 'Linien'],
  timeline: ['Zeitleiste', 'Zeitleisten'],
};

/** „1 Notiz“, „12 Notizen“; unbekannter Typ: „3 × name“. */
export function typeCount(type: string, n: number): string {
  const names = TYPE_NAMES[type];
  if (!names) return `${n} × ${type}`;
  return `${n} ${n === 1 ? names[0] : names[1]}`;
}

/** Übernommene Objekte, größte Zahl zuerst (gleich viele: in der Reihenfolge der Namensliste). */
export function importedList(r: Pick<ImportReport, 'imported'> | undefined): { type: string; count: number; label: string }[] {
  const order = Object.keys(TYPE_NAMES);
  const rank = (t: string) => (order.includes(t) ? order.indexOf(t) : order.length);
  return Object.entries(r?.imported ?? {})
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))
    .map(([type, count]) => ({ type, count, label: typeCount(type, count) }));
}

const sum = (xs: readonly { count: number }[]) => xs.reduce((s, x) => s + (x.count > 0 ? x.count : 0), 0);

export const objectCount = (n: number) => (n === 1 ? '1 Objekt' : `${n} Objekte`);

/** Eine Zeile über den Bericht: „128 Objekte übernommen · 12 angepasst · 3 nicht übernommen“. */
export function reportSummary(r: ImportReport | undefined): string {
  if (!r) return '';
  const parts = [`${objectCount(sum(importedList(r)))} übernommen`];
  const adj = sum(r.adjusted ?? []);
  const skip = sum(r.skipped ?? []);
  if (adj) parts.push(`${adj} angepasst`);
  if (skip) parts.push(`${skip} nicht übernommen`);
  return parts.join(' · ');
}

/** Eintrag „angepasst“/„nicht übernommen“ mit Zahl davor, wenn der Text sie nicht schon nennt. */
export function entryText(e: { text: string; count: number }): string {
  if (!(e.count > 1) || /\d/.test(e.text)) return e.text;
  return `${e.count} × ${e.text}`;
}

// ---- Auswahl --------------------------------------------------------------------------------------------------

/** Board an- oder abwählen; höchstens `max` (Standard 10) gleichzeitig. */
export function toggleSelection(sel: readonly string[], id: string, max = IMPORT_MAX_BOARDS_PER_REQUEST): string[] {
  if (sel.includes(id)) return sel.filter((x) => x !== id);
  if (sel.length >= max) return [...sel];
  return [...sel, id];
}

/** Neue Seite der Board-Liste anhängen (ohne Doppelte, falls sich die Liste zwischendurch verschoben hat). */
export function appendBoards<T extends { id: string }>(list: readonly T[], more: readonly T[]): T[] {
  const seen = new Set(list.map((b) => b.id));
  return [...list, ...more.filter((b) => !seen.has(b.id))];
}

/** Frische Job-Stände übernehmen (nach ID), Reihenfolge bleibt. */
export function mergeJobs(current: readonly ImportJob[], fresh: readonly ImportJob[]): ImportJob[] {
  const byId = new Map(fresh.map((j) => [j.id, j]));
  return current.map((j) => byId.get(j.id) ?? j);
}

// ---- Fehler ---------------------------------------------------------------------------------------------------

/** Ersatztexte, falls der Server keinen `message` mitschickt (docs/features/import.md §2). */
export const IMPORT_ERROR_TEXT: Record<string, string> = {
  miro_token_invalid:
    'Miro hat das Token abgelehnt. Prüfe, ob du es vollständig kopiert hast, oder hol dir in Miro unter „Your apps“ ein neues.',
  miro_conn_expired: 'Die Verbindung zu Miro ist abgelaufen. Bitte verbinde dich noch einmal.',
  import_limit: 'Für heute sind genug Boards importiert. Versuch es morgen wieder.',
  board_limit: 'Du hast zu viele Boards. Lösche alte Boards und leere den Papierkorb, dann klappt der Import.',
  oauth_disabled: 'Diese Stachel-Instanz kann sich nicht direkt mit Miro verbinden. Füge stattdessen ein Zugriffstoken ein.',
  import_disabled: 'Der Import ist auf dieser Stachel-Instanz ausgeschaltet. Frag die Person, die Stachel betreibt.',
  miro_unavailable: 'Miro antwortet gerade nicht. Versuch es in ein paar Minuten noch einmal.',
  // Rückkehr von der Miro-Freigabeseite (`?import=miro&error=…`)
  access_denied: 'Du hast den Zugriff in Miro nicht erlaubt. Versuch es noch einmal und bestätige die Freigabe in Miro.',
  state_expired: 'Der Freigabe-Link ist abgelaufen oder wurde schon benutzt. Klick noch einmal auf „Mit Miro verbinden“.',
  oauth_failed: 'Miro hat die Freigabe nicht bestätigt. Klick noch einmal auf „Mit Miro verbinden“.',
};

/** Fehler, nach denen man sich neu verbinden muss. */
export const RECONNECT_CODES = new Set(['miro_conn_expired', 'miro_token_invalid']);

/** Text zu einem Fehler aus der Import-API: der Server-Text, sonst unser Ersatztext, sonst der allgemeine. */
export function importErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return ERROR_TEXT.server;
  const fallback = IMPORT_ERROR_TEXT[e.code];
  if (fallback && (e.message === ERROR_TEXT.server || e.message === ERROR_TEXT[e.code] || !e.message)) return fallback;
  return e.message;
}

/** Fehler-Code von der Rückkehr aus Miro in einen Satz mit nächstem Schritt. */
export function oauthErrorText(code: string): string {
  return IMPORT_ERROR_TEXT[code] ?? 'Die Verbindung mit Miro hat nicht geklappt. Bitte versuch es noch einmal.';
}

// ---- Rückkehr von Miro ----------------------------------------------------------------------------------------

/**
 * `?import=miro[&error=<code>]` aus der Adresse lesen. `rest` = übrige Parameter (für `history.replaceState`),
 * leer oder mit `?` davor.
 */
export function parseImportReturn(search: string): { open: false } | { open: true; error: string | null; rest: string } {
  const q = new URLSearchParams(search);
  if (q.get('import') !== 'miro') return { open: false };
  const error = q.get('error');
  q.delete('import');
  q.delete('error');
  const rest = q.toString();
  return { open: true, error: error ? error.slice(0, 64) : null, rest: rest ? `?${rest}` : '' };
}

// ---- Zeiten ---------------------------------------------------------------------------------------------------

/** „Geändert vor 5 Min.“ für die Board-Liste aus Miro (leer ohne Angabe). */
export const modifiedLabel = (iso: string | undefined, now = Date.now()) => {
  const rel = iso ? relativeTime(iso, now) : '';
  return rel ? `Geändert ${rel}` : '';
};
