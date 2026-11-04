// Karten ohne React: Farben, Fälligkeit, Höhe aus dem Inhalt. Die Höhe rechnet das Layout der Ansicht
// (structure.css `.structure-card__inner`) mit einer Textmessung nach – so legt der Server (Web-Aktionen der App,
// docs/contract.md §8.12) Karten mit derselben Höhe an, die ein Browser beim Messen schreibt.
import type { BoardObject } from '../../../protocol';
import type { BoardStore, NewObject } from '../../../board/store';
import { wrapText } from '../text';
import { statusOf } from './status';

export const CARD_COLORS = ['#1763b5', '#ec4e92', '#c9e14a', '#e8590c', '#7048e8', '#0c8599', '#0a0a0a', '#8a8a85'];
export const TAG_COLORS = ['#c9e14a', '#ec4e92', '#1763b5', '#ffd08a', '#9fd3ff', '#e2d5ff', '#ffb3d1', '#0a0a0a'];
export const CARD_W = 300;
/** schmalste Karte (Seitengriffe) */
export const CARD_MIN_W = 160;
/** längster Tag-Name */
export const TAG_MAX = 40;
export const CARD_PLACEHOLDER = 'Titel der Karte';

/** Datum `YYYY-MM-DD` → „12. Juni“ (mit Jahr, wenn nicht dieses Jahr). */
export function formatDue(due: string, now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!m) return due;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('de-DE', opts);
}

/** Überfällig: Datum vor heute und nicht erledigt. */
export function isOverdue(o: Pick<BoardObject, 'due' | 'status'>, now = new Date()): boolean {
  if (!o.due || o.status === 'done') return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return o.due < today;
}

/** Textbreite (Barlow) wie `measureText`. */
export type CardMeasure = (text: string, fs: number, weight: number) => number;

// Maße aus structure.css (.structure-card__inner, __title, __desc, __foot, .structure-chip, Avatar 26)
const PAD_T = 14;
const PAD_B = 14;
const PAD_L = 22;
const PAD_R = 16;
const TITLE_FS = 17;
const TITLE_LH = TITLE_FS * 1.3;
const DESC_FS = 14;
const DESC_LH = DESC_FS * 1.45;
const DESC_MAX_LINES = 4;
const FOOT_GAP = 6;
const CHIP_H = 24;
const CHIP_PAD = 8;
const CHIP_FS = 12.5;
const CHIP_ICON = 13;
const CHIP_DOT = 7;
const CHIP_ICON_GAP = 5;
const AVATAR = 26;

/** Breiten der Fußzeilen-Elemente in Reihenfolge der Ansicht (Status, Fällig, Tags, Person); Person zuletzt. */
function footItems(o: BoardObject, measure: CardMeasure, now: Date, inner: number): { w: number; h: number }[] {
  const chip = (label: string, lead: number) => ({ w: Math.min(inner, CHIP_PAD * 2 + (lead ? lead + CHIP_ICON_GAP : 0) + measure(label, CHIP_FS, 600)), h: CHIP_H });
  const items: { w: number; h: number }[] = [];
  const st = statusOf(o.status);
  if (st) items.push(chip(st.label, CHIP_DOT));
  if (o.due) items.push(chip(formatDue(o.due, now), CHIP_ICON));
  for (const t of o.tags ?? []) items.push(chip(t.label, 0));
  if (o.assignee) items.push({ w: AVATAR, h: AVATAR });
  return items;
}

/** Höhe der Fußzeile (Flex mit Umbruch, Lücke 6, Zeilenhöhe = höchstes Element der Zeile). */
function footHeight(items: { w: number; h: number }[], inner: number): number {
  if (!items.length) return 0;
  let total = 0;
  let rowW = 0;
  let rowH = 0;
  for (const it of items) {
    if (rowW > 0 && rowW + FOOT_GAP + it.w > inner + 0.01) {
      total += rowH + FOOT_GAP;
      rowW = 0;
      rowH = 0;
    }
    rowW += (rowW > 0 ? FOOT_GAP : 0) + it.w;
    rowH = Math.max(rowH, it.h);
  }
  return total + rowH;
}

/**
 * Höhe einer Karte aus ihrem Inhalt, wie die Ansicht sie misst (`offsetHeight` von `.structure-card__inner`):
 * Titel (umbrochen, leer = Platzhalter), Beschreibung (höchstens 4 Zeilen), Fußzeile mit Status, Datum, Tags, Person.
 */
export function cardContentHeight(o: BoardObject, measure: CardMeasure, now = new Date()): number {
  const inner = Math.max(8, o.w - PAD_L - PAD_R);
  const title = o.text || CARD_PLACEHOLDER;
  const tl = wrapText(title, inner, (s) => measure(s, TITLE_FS, 600)).length;
  let h = PAD_T + tl * TITLE_LH;
  if (o.desc) h += 6 + Math.min(DESC_MAX_LINES, wrapText(o.desc, inner, (s) => measure(s, DESC_FS, 500)).length) * DESC_LH;
  const foot = footHeight(footItems(o, measure, now, inner), inner);
  if (foot) h += 12 + foot;
  return Math.max(40, Math.round(h + PAD_B));
}

/**
 * Haftnotizen in Karten umwandeln (Menü „In Karte(n) umwandeln“): gleiche Lage, Breite mindestens 300, Text bleibt;
 * die Notizen verschwinden – ein Rückgängig-Schritt. `newId(i)` = ID der i-ten Karte, `height` = Höhe der neuen Karte
 * (fehlt = 96, der Browser misst danach nach). Liefert die IDs der Karten.
 */
export function notesToCards(store: BoardStore, notes: readonly BoardObject[], newId: (i: number) => string, height?: (card: BoardObject) => number): string[] {
  const ids: string[] = [];
  store.stopCapturing();
  store.transact(() => {
    notes.forEach((n, i) => {
      const card: NewObject = { type: 'card', x: n.x, y: n.y, w: Math.max(CARD_W, n.w), h: 96, text: n.text ?? '', color: CARD_COLORS[0], id: newId(i) };
      if (height) card.h = height({ ...card, z: '', createdBy: '', updatedAt: '' } as BoardObject);
      ids.push(store.create(card));
    });
    store.remove(notes.map((n) => n.id));
  });
  store.stopCapturing();
  return ids;
}
