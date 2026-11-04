// Zeitleiste ohne React/Yjs: Datenmodell, Datumsrechnung, Raster, Einrasten und Zeilen-Packen.
// Vertrag: docs/features/timeline.md. Alle Felder optional – alte Boards laden unverändert.
//
// Geometrie: Die Zeitleiste rechnet in „inneren“ Einheiten (Spaltenbreite je Tag nach Zeitskala, feste Kopf- und
// Zeilenhöhen). Das Objekt (w × h) zeigt diese innere Fläche skaliert (kx = w / W0, ky = h / H0). So lässt sie sich
// wie andere Objekte an den Ecken skalieren, und eine nicht ganz passende Höhe (gleichzeitige Änderungen zweier
// Personen) verzerrt nur leicht statt etwas abzuschneiden.

export type TlUnit = 'day' | 'week' | 'month';

/** Eintrag (Balken bzw. Meilenstein). Tage als `YYYY-MM-DD`, `end` einschließlich. */
export interface TlItem {
  lane: string;
  start: string;
  end: string;
  title: string;
  color?: string;
  /** Meilenstein: ein Tag, als Raute gezeichnet */
  ms?: boolean;
}

/** Lesekopie des Felds `timeline` (im Y.Map: lanes = Y.Array, names = Y.Map<Y.Text>, items = Y.Map<Y.Map>). */
export interface TimelineData {
  /** Reihenfolge der Spuren (ids) */
  lanes: string[];
  /** Spurname je id */
  names: Record<string, string>;
  /** Einträge je id */
  items: Record<string, TlItem>;
}

declare module '../../../../../shared/protocol' {
  interface ObjectTypeMap {
    timeline: true;
  }
  interface BoardObject {
    /** Zeitleiste: Spuren und Einträge (im Y.Map ein Y.Map, siehe timeline/yjs.ts) */
    timeline?: TimelineData;
    /** Zeitleiste: erster sichtbarer Tag `YYYY-MM-DD` */
    tlStart?: string;
    /** Zeitleiste: letzter sichtbarer Tag (einschließlich) */
    tlEnd?: string;
    /** Zeitleiste: Zeitskala (fehlt = Woche) */
    tlUnit?: TlUnit;
  }
}

// ---- Datum (Tage als ganze Zahl seit 1970-01-01, ohne Zeitzonen) ----------------------------------------------------

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → Tagnummer; ungültig → null. */
export function parseDay(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = ISO.exec(s);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCMonth() !== mo - 1) return null; // 31.02. o. Ä.
  return Math.round(t / DAY_MS);
}

export const ymd = (n: number) => {
  const d = new Date(n * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Tagnummer → `YYYY-MM-DD`. */
export function fmtDay(n: number): string {
  const { y, m, d } = ymd(n);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Heute (lokales Datum) als Tagnummer. */
export const todayNum = (now = new Date()) => Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);

/** Wochentag, Montag = 0 … Sonntag = 6 (1970-01-01 war ein Donnerstag). */
export const weekday = (n: number) => (((n + 3) % 7) + 7) % 7;
export const isWeekend = (n: number) => weekday(n) >= 5;
/** Montag der Woche */
export const mondayOf = (n: number) => n - weekday(n);

/** ISO-Kalenderwoche */
export function isoWeek(n: number): number {
  const thu = n - weekday(n) + 3; // Donnerstag derselben Woche bestimmt das Jahr
  const { y } = ymd(thu);
  const jan1 = Math.round(Date.UTC(y, 0, 1) / DAY_MS);
  return Math.floor((thu - jan1) / 7) + 1;
}

/** Erster Tag des Monats von `n` bzw. `k` Monate später. */
export function monthStart(n: number, k = 0): number {
  const { y, m } = ymd(n);
  return Math.round(Date.UTC(y, m - 1 + k, 1) / DAY_MS);
}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** „Mo 3.11.“ bzw. mit Jahr */
export function dayLabel(n: number, year = false): string {
  const { y, m, d } = ymd(n);
  return `${WEEKDAYS[weekday(n)]} ${d}.${m}.${year ? y : ''}`;
}

/** Zeitraum eines Eintrags für Menschen: „3.11.–9.11.2026“ bzw. ein Tag. */
export function spanLabel(a: number, b: number): string {
  const x = ymd(a);
  const z = ymd(b);
  if (a === b) return `${x.d}.${x.m}.${x.y}`;
  return `${x.d}.${x.m}.${x.y === z.y ? '' : x.y}–${z.d}.${z.m}.${z.y}`;
}

// ---- Maße (innere Einheiten) ------------------------------------------------------------------------------------------

/** Breite der Namensspalte links */
export const LABEL_W = 168;
/** Kopf mit zwei Zeilen (grob: Monat/Jahr, fein: Tag/KW/Monat) */
export const HEAD_TOP = 24;
export const HEAD_H = 58;
export const BAR_H = 30;
export const ROW_H = 38;
export const LANE_PAD = 10;
export const MIN_LANE_H = 54;
/** Spaltenbreite je Tag */
export const DAY_PX: Record<TlUnit, number> = { day: 40, week: 18, month: 5 };
/** Länge neuer Einträge (Doppelklick) je Zeitskala */
export const NEW_LEN: Record<TlUnit, number> = { day: 1, week: 7, month: 14 };
export const MIN_DAYS = 3;
export const MAX_DAYS = 1100;
export const MAX_LANES = 40;
export const DIAMOND = 22;
export const UNITS: { unit: TlUnit; label: string }[] = [
  { unit: 'day', label: 'Tag' },
  { unit: 'week', label: 'Woche' },
  { unit: 'month', label: 'Monat' },
];

export const TL_COLORS = ['#1763b5', '#ec4e92', '#c9e14a', '#7aa21b', '#fff27a', '#ffd08a', '#9fd3ff', '#e2d5ff', '#8a8a85', '#0a0a0a'];
export const DEFAULT_ITEM_COLOR = TL_COLORS[0];

export const unitOf = (o: { tlUnit?: unknown }): TlUnit => (o.tlUnit === 'day' || o.tlUnit === 'month' ? o.tlUnit : 'week');

// ---- Lesekopie absichern ----------------------------------------------------------------------------------------------

const FALLBACK_LANE = 'l';

/** Gültige Lesekopie: Spuren ohne Doppelte (mindestens eine), Einträge mit gültigen Tagen (Ende ≥ Anfang). */
export function safeTimeline(raw: unknown): TimelineData {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Partial<TimelineData>;
  const seen = new Set<string>();
  const lanes = (Array.isArray(t.lanes) ? t.lanes : []).filter((x): x is string => typeof x === 'string' && !seen.has(x) && !!seen.add(x));
  if (!lanes.length) lanes.push(FALLBACK_LANE);
  const names: Record<string, string> = {};
  const rawNames = t.names && typeof t.names === 'object' ? (t.names as Record<string, unknown>) : {};
  for (const l of lanes) names[l] = typeof rawNames[l] === 'string' ? (rawNames[l] as string) : '';
  const items: Record<string, TlItem> = {};
  const rawItems = t.items && typeof t.items === 'object' ? (t.items as Record<string, Partial<TlItem>>) : {};
  for (const [id, it] of Object.entries(rawItems)) {
    if (!it || typeof it !== 'object') continue;
    let a = parseDay(it.start);
    let b = parseDay(it.end) ?? a;
    if (a === null || b === null) continue;
    if (b < a) [a, b] = [b, a];
    const ms = it.ms === true;
    items[id] = {
      // Spur gelöscht (z. B. gleichzeitig von jemand anderem): Eintrag in die erste Spur
      lane: typeof it.lane === 'string' && seen.has(it.lane) ? it.lane : lanes[0],
      start: fmtDay(a),
      end: fmtDay(ms ? a : b),
      title: typeof it.title === 'string' ? it.title : '',
      ...(typeof it.color === 'string' ? { color: it.color } : {}),
      ...(ms ? { ms: true } : {}),
    };
  }
  return { lanes, names, items };
}

export interface Range {
  start: number;
  end: number;
  days: number;
}

/** Sichtbarer Zeitraum (fehlend/kaputt: 8 Wochen ab dem Montag dieser Woche). */
export function rangeOf(o: { tlStart?: unknown; tlEnd?: unknown }, today = todayNum()): Range {
  let a = parseDay(o.tlStart);
  let b = parseDay(o.tlEnd);
  if (a === null && b === null) a = mondayOf(today);
  if (a === null) a = b! - 55;
  if (b === null) b = a + 55;
  if (b < a) [a, b] = [b, a];
  b = Math.min(b, a + MAX_DAYS - 1);
  return { start: a, end: b, days: b - a + 1 };
}

// ---- Packen: Einträge einer Spur auf Zeilen verteilen (keine Überlappung) ----------------------------------------------

/** Geschätzte Breite eines Meilenstein-Titels (innere Einheiten) */
export const msLabelW = (title: string) => 16 + Math.min(Math.max(title.length, 4), 36) * 7.4;

/** Belegte Tage eines Eintrags fürs Packen: Meilensteine samt Titel rechts daneben. */
export function extentOf(it: TlItem, dayPx: number): [number, number] {
  const a = parseDay(it.start)!;
  if (!it.ms) return [a, parseDay(it.end)!];
  const px = dayPx / 2 + DIAMOND / 2 + msLabelW(it.title);
  return [a, a + Math.max(0, Math.ceil(px / dayPx) - 1)];
}

/**
 * Zeilen je Eintrag (gierig wie Gantt-Diagramme): nach Anfang sortiert, jeweils in die erste Zeile, deren letzter
 * Eintrag vorher endet. Liefert Zeile je id und Zeilenzahl (mindestens 1).
 */
export function packRows(list: { id: string; a: number; b: number }[]): { row: Map<string, number>; rows: number } {
  const sorted = [...list].sort((x, y) => x.a - y.a || x.b - y.b || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const ends: number[] = [];
  const row = new Map<string, number>();
  for (const it of sorted) {
    let r = ends.findIndex((e) => e < it.a);
    if (r < 0) {
      r = ends.length;
      ends.push(it.b);
    } else ends[r] = it.b;
    row.set(it.id, r);
  }
  return { row, rows: Math.max(1, ends.length) };
}

export const laneHeight = (rows: number) => Math.max(MIN_LANE_H, 2 * LANE_PAD + rows * ROW_H - (ROW_H - BAR_H));

// ---- Layout -------------------------------------------------------------------------------------------------------------

export interface LaneBox {
  id: string;
  name: string;
  y: number;
  h: number;
  rows: number;
}

export interface ItemBox {
  id: string;
  it: TlItem;
  a: number;
  b: number;
  lane: string;
  row: number;
  /** Balken bzw. Raute (innere Einheiten); Meilenstein: Raute + Titel */
  x: number;
  y: number;
  w: number;
  h: number;
  /** am Rand des Zeitraums abgeschnitten */
  cutL: boolean;
  cutR: boolean;
}

export interface Layout extends Range {
  unit: TlUnit;
  dayPx: number;
  /** innere Breite/Höhe */
  W0: number;
  H0: number;
  lanes: LaneBox[];
  items: ItemBox[];
  /** Einträge ganz außerhalb des Zeitraums */
  before: number;
  after: number;
}

/** Layout für Daten, Zeitraum und Skala. */
export function layoutOf(d: TimelineData, r: Range, unit: TlUnit): Layout {
  const dayPx = DAY_PX[unit];
  const perLane = new Map<string, { id: string; a: number; b: number }[]>(d.lanes.map((l) => [l, []]));
  let before = 0;
  let after = 0;
  for (const [id, it] of Object.entries(d.items)) {
    const a = parseDay(it.start)!;
    const b = parseDay(it.end)!;
    if (b < r.start) {
      before++;
      continue;
    }
    if (a > r.end) {
      after++;
      continue;
    }
    const [ea, eb] = extentOf(it, dayPx);
    perLane.get(it.lane)?.push({ id, a: Math.max(ea, r.start), b: eb });
  }
  const lanes: LaneBox[] = [];
  const rowOf = new Map<string, number>();
  let y = HEAD_H;
  for (const l of d.lanes) {
    const p = packRows(perLane.get(l) ?? []);
    p.row.forEach((v, k) => rowOf.set(k, v));
    const h = laneHeight(p.rows);
    lanes.push({ id: l, name: d.names[l] ?? '', y, h, rows: p.rows });
    y += h;
  }
  const laneY = new Map(lanes.map((l) => [l.id, l.y]));
  const items: ItemBox[] = [];
  for (const [id, it] of Object.entries(d.items)) {
    const row = rowOf.get(id);
    if (row === undefined) continue;
    const a = parseDay(it.start)!;
    const b = parseDay(it.end)!;
    const top = laneY.get(it.lane)! + LANE_PAD + row * ROW_H;
    if (it.ms) {
      const cx = LABEL_W + (a - r.start + 0.5) * dayPx;
      items.push({ id, it, a, b, lane: it.lane, row, x: cx - DIAMOND / 2, y: top, w: DIAMOND + 6 + msLabelW(it.title), h: BAR_H, cutL: false, cutR: false });
      continue;
    }
    const va = Math.max(a, r.start);
    const vb = Math.min(b, r.end);
    items.push({ id, it, a, b, lane: it.lane, row, x: LABEL_W + (va - r.start) * dayPx, y: top, w: (vb - va + 1) * dayPx, h: BAR_H, cutL: a < r.start, cutR: b > r.end });
  }
  return { ...r, unit, dayPx, W0: LABEL_W + r.days * dayPx, H0: y, lanes, items, before, after };
}

/** Layout eines Objekts */
export const layoutFor = (o: { timeline?: unknown; tlStart?: unknown; tlEnd?: unknown; tlUnit?: unknown }, today = todayNum()) =>
  layoutOf(safeTimeline(o.timeline), rangeOf(o, today), unitOf(o));

// ---- Treffer (innere Einheiten) ------------------------------------------------------------------------------------------

export type TlHit =
  | { kind: 'header'; day: number | null }
  | { kind: 'label'; lane: string }
  | { kind: 'lane'; lane: string; day: number }
  | { kind: 'item'; id: string; lane: string; day: number };

/** Tag unter der x-Position (auf den Zeitraum begrenzt) */
export const dayAt = (L: Layout, lx: number) => Math.max(L.start, Math.min(L.end, L.start + Math.floor((lx - LABEL_W) / L.dayPx)));

/** Spur unter der y-Position; über bzw. unter den Spuren die erste bzw. letzte. */
export function laneAt(L: Layout, ly: number): LaneBox {
  for (const l of L.lanes) if (ly < l.y + l.h) return l;
  return L.lanes[L.lanes.length - 1];
}

export function hitLocal(L: Layout, lx: number, ly: number): TlHit | null {
  if (lx < 0 || ly < 0 || lx > L.W0 || ly > L.H0) return null;
  if (ly < HEAD_H) return { kind: 'header', day: lx >= LABEL_W ? dayAt(L, lx) : null };
  const lane = laneAt(L, ly);
  if (lx < LABEL_W) return { kind: 'label', lane: lane.id };
  const day = dayAt(L, lx);
  for (let i = L.items.length - 1; i >= 0; i--) {
    const b = L.items[i];
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) return { kind: 'item', id: b.id, lane: b.lane, day };
  }
  return { kind: 'lane', lane: lane.id, day };
}

/** Weltpunkt → innere Einheiten (Zeitleisten werden nicht gedreht). */
export function toLocal(o: { x: number; y: number; w: number; h: number }, L: Layout, p: { x: number; y: number }) {
  return { lx: ((p.x - o.x) * L.W0) / o.w, ly: ((p.y - o.y) * L.H0) / o.h };
}

/** Innere Einheiten → Weltrechteck */
export function toWorldRect(o: { x: number; y: number; w: number; h: number }, L: Layout, r: { x: number; y: number; w: number; h: number }) {
  const kx = o.w / L.W0;
  const ky = o.h / L.H0;
  return { x: o.x + r.x * kx, y: o.y + r.y * ky, w: r.w * kx, h: r.h * ky };
}

// ---- Verschieben / Länge ändern (auf Tage gerastet) ----------------------------------------------------------------------

export type DragMode = 'move' | 'start' | 'end';

/**
 * Neuer Zeitraum eines Eintrags nach einer Verschiebung um `dd` Tage. Verschieben bleibt im sichtbaren Zeitraum
 * (mindestens teilweise), Länge ändern lässt mindestens einen Tag übrig.
 */
export function dragDays(a: number, b: number, mode: DragMode, dd: number, r: Range): [number, number] {
  if (mode === 'move') {
    const d = Math.max(r.start - b, Math.min(r.end - a, dd));
    return [a + d, b + d];
  }
  if (mode === 'start') return [Math.min(b, Math.max(r.start, a + dd)), b];
  return [a, Math.max(a, Math.min(r.end, b + dd))];
}

/** Verschiebung in Tagen aus der Zeigerbewegung (innere Einheiten), gerundet = Einrasten auf Tage. */
export const snapDays = (dx: number, dayPx: number) => Math.round(dx / dayPx) || 0;

// ---- Kopf: Beschriftung -------------------------------------------------------------------------------------------------

export interface Tick {
  /** x relativ zum Anfang des Zeitraums (innere Einheiten) */
  x: number;
  w: number;
  label: string;
  sub?: string;
  weekend?: boolean;
  today?: boolean;
}

/** Abschnitte von `from` bis `to` (einschließlich), begrenzt durch `next(n)` = Anfang des nächsten Abschnitts. */
function segments(r: Range, dayPx: number, next: (n: number) => number, label: (n: number, a: number, b: number) => Pick<Tick, 'label' | 'sub'>): Tick[] {
  const out: Tick[] = [];
  let a = r.start;
  while (a <= r.end && out.length < 2000) {
    const b = Math.min(r.end, next(a) - 1);
    out.push({ x: (a - r.start) * dayPx, w: (b - a + 1) * dayPx, ...label(a, a, b) });
    a = b + 1;
  }
  return out;
}

/** Obere (grobe) und untere (feine) Zeile des Kopfs. */
export function ticks(r: Range, unit: TlUnit, today = todayNum()): { top: Tick[]; bottom: Tick[] } {
  const dayPx = DAY_PX[unit];
  const months = (short: boolean) =>
    segments(
      r,
      dayPx,
      (n) => monthStart(n, 1),
      (n) => {
        const { y, m } = ymd(n);
        return { label: short ? MONTHS_SHORT[m - 1] : `${MONTHS[m - 1]} ${y}` };
      },
    );
  if (unit === 'month') {
    const years = segments(
      r,
      dayPx,
      (n) => Math.round(Date.UTC(ymd(n).y + 1, 0, 1) / DAY_MS),
      (n) => ({ label: String(ymd(n).y) }),
    );
    return { top: years, bottom: months(true).map((t) => ({ ...t, today: today >= r.start + t.x / dayPx && today < r.start + (t.x + t.w) / dayPx })) };
  }
  if (unit === 'week') {
    const weeks = segments(
      r,
      dayPx,
      (n) => mondayOf(n) + 7,
      (n, a) => ({ label: `KW ${isoWeek(n)}`, sub: `${ymd(a).d}.${ymd(a).m}.` }),
    );
    return { top: months(false), bottom: weeks.map((t) => ({ ...t, today: today >= r.start + t.x / dayPx && today < r.start + (t.x + t.w) / dayPx })) };
  }
  const days: Tick[] = [];
  for (let n = r.start; n <= r.end; n++) days.push({ x: (n - r.start) * dayPx, w: dayPx, label: String(ymd(n).d), sub: WEEKDAYS[weekday(n)], weekend: isWeekend(n), today: n === today });
  return { top: months(false), bottom: days };
}

// ---- Größe ------------------------------------------------------------------------------------------------------------

/** Maßstab des Objekts (innere Einheiten → Welt), aus der Breite. */
export const scaleOf = (o: { w: number }, L: Layout) => (L.W0 > 0 ? o.w / L.W0 : 1);

/** Objektgröße für ein neues Layout bei gleichem Maßstab. */
export function sizeFor(k: number, L: Layout): { w: number; h: number } {
  return { w: Math.max(8, Math.round(L.W0 * k)), h: Math.max(8, Math.round(L.H0 * k)) };
}

/**
 * Zeitraum über die Seitengriffe ändern (Ränder ziehen = mehr/weniger Tage). `west`: linker Rand.
 * Liefert den neuen Zeitraum (ganze Tage, mindestens MIN_DAYS).
 */
export function resizeRange(r: Range, k: number, unit: TlUnit, newW: number, west: boolean): Range {
  const dayPx = DAY_PX[unit];
  const days = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round((newW / k - LABEL_W) / dayPx)));
  return west ? { start: r.end - days + 1, end: r.end, days } : { start: r.start, end: r.start + days - 1, days };
}

/** Neue Zeitleiste: Zeitraum je Skala um `today` herum (Woche: 8 Wochen ab Montag). */
export function defaultRange(unit: TlUnit, today = todayNum()): Range {
  if (unit === 'day') {
    const start = mondayOf(today);
    return { start, end: start + 20, days: 21 };
  }
  if (unit === 'month') {
    const start = monthStart(today);
    const end = monthStart(today, 6) - 1;
    return { start, end, days: end - start + 1 };
  }
  const start = mondayOf(today);
  return { start, end: start + 55, days: 56 };
}

// ---- Bedienung ohne React (Kontextleiste, Dialog, Knöpfe – auch auf dem Server für die Web-Aktionen der App) ----------

/** Balken ↔ Meilenstein (Balken bekommt wieder die Standardlänge der Skala); `undefined` entfernt das Feld. */
export const toggleMsPatch = (it: TlItem, unit: TlUnit): { ms?: true; end: string } =>
  it.ms ? { ms: undefined, end: fmtDay(parseDay(it.start)! + NEW_LEN[unit] - 1) } : { ms: true, end: it.start };

/**
 * Dialog „Eintrag“: Beginn bzw. Ende auf Tag `n` setzen. Anfang nach dem Ende: das Ende zieht mit (die Länge bleibt),
 * Ende vor dem Anfang: das Ende bleibt am Anfang; Meilenstein: beide Tage.
 */
export function dayPatch(it: TlItem, which: 'start' | 'end', n: number): { start?: string; end: string } {
  const a = parseDay(it.start)!;
  const b = parseDay(it.end)!;
  if (which === 'start') return it.ms ? { start: fmtDay(n), end: fmtDay(n) } : { start: fmtDay(n), end: fmtDay(Math.max(n, n + (b - a))) };
  return { end: fmtDay(Math.max(a, n)) };
}

/** Knopf „‹ n“ bzw. „n ›“: Zeitraum bis zu den Einträgen davor bzw. danach erweitern (höchstens MAX_DAYS). */
export function extendRange(o: { timeline?: unknown; tlStart?: unknown; tlEnd?: unknown }, side: 'before' | 'after', today = todayNum()): { start: number; end: number } {
  const days = Object.values(safeTimeline(o.timeline).items).flatMap((it) => [parseDay(it.start)!, parseDay(it.end)!]);
  const r = rangeOf(o, today);
  const start = side === 'before' ? Math.min(r.start, ...days) : r.start;
  const end = side === 'after' ? Math.max(r.end, ...days) : r.end;
  return { start, end: Math.min(end, start + MAX_DAYS - 1) };
}

/** Neuer Eintrag mit Standardlänge ab Tag `day` (bzw. heute, sonst Anfang des Zeitraums), höchstens bis zum Ende. */
export function newItemSpan(L: Layout, day: number | null, today = todayNum()): [number, number] {
  const a = day ?? (today >= L.start && today <= L.end ? today : L.start);
  const b = Math.min(L.end, a + NEW_LEN[L.unit] - 1);
  return [a, Math.max(a, b)];
}

/** Haftnotiz/Karte als Eintrag am Tag `day` der Spur (Text, Farbe, Standardlänge der Skala). */
export function droppedItem(o: { color?: string }, text: string, L: Layout, lane: string, day: number): TlItem {
  const end = Math.min(L.end, day + NEW_LEN[L.unit] - 1);
  return { lane, start: fmtDay(day), end: fmtDay(end), title: text.replace(/\s+/g, ' ').trim().slice(0, 200), ...(o.color ? { color: o.color } : {}) };
}

/** Klartext (Zwischenablage, Suche): Spuren mit ihren Einträgen. */
export function timelineText(d: TimelineData): string {
  const lines: string[] = [];
  for (const l of d.lanes) {
    const its = Object.values(d.items)
      .filter((it) => it.lane === l)
      .sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
    lines.push(d.names[l] || 'Spur');
    for (const it of its) lines.push(`\t${it.title || 'Ohne Titel'}\t${spanLabel(parseDay(it.start)!, parseDay(it.end)!)}`);
  }
  return lines.join('\n');
}
