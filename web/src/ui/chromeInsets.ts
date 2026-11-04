// Ränder für „Alles einpassen“ & Co. aus der tatsächlichen Lage der Leisten (x-text B15: die Übersichtskarte
// verdeckte nach dem Einpassen Inhalt). Gemessen statt fester Werte, weil sich die Leisten je nach Displaygröße
// verschieben (Handy hochkant: Rückgängig/Zoom oben, quer: Werkzeuge unten, Seitenleiste rechts …).
import type { Insets, Rect } from '../board/geometry';

/** Feste Leisten über dem Board */
const CHROME = '.topbar--left > *, .topbar--right > *, .toolbar, .history, .bottom-right > *, .sidebar, .frames-panel';
/** Abstand zwischen Inhalt und Leiste */
const GAP = 16;
/** Mindestrand, auch wenn auf einer Seite keine Leiste liegt */
const MIN = 24;

type Side = keyof Insets;
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** Zoom, mit dem `r` in die freie Fläche passt (wie fitRect, ohne Grenzen). */
const zoomFor = (r: Rect, w: number, h: number, p: Insets) => Math.min(Math.max(1, w - p.left - p.right) / Math.max(r.w, 1), Math.max(1, h - p.top - p.bottom) / Math.max(r.h, 1));

/**
 * Ränder je Seite, sodass der eingepasste Inhalt unter keiner Leiste liegt. Jede Leiste zählt zu der Seite, an der sie
 * am wenigsten Platz kostet; Eck-Elemente (Übersichtskarte) wahlweise rechts oder unten – je nachdem, was bei `r`
 * den größeren Zoom ergibt (höchstens `maxZoom`; bei Gleichstand die Seite, die den Inhalt weniger aus der Mitte schiebt).
 * `null`, wenn es kein Board gibt.
 */
export function chromeInsets(board: HTMLElement | null, r?: Rect, maxZoom = Infinity): Insets | null {
  if (!board) return null;
  const root = board.closest('.editor') ?? board.parentElement;
  if (!root) return null;
  const b = board.getBoundingClientRect();
  const W = b.width;
  const H = b.height;
  const base: Insets = { top: MIN, right: MIN, bottom: MIN, left: MIN };
  const corners: [Insets, Insets][] = [];
  for (const el of root.querySelectorAll(CHROME)) {
    const e = el.getBoundingClientRect();
    if (e.width < 1 || e.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
    // benötigter Rand, wenn die Leiste dieser Seite zugeschlagen wird
    const need: Insets = { top: e.bottom - b.top + GAP, bottom: b.bottom - e.top + GAP, left: e.right - b.left + GAP, right: b.right - e.left + GAP };
    const order = [...SIDES].sort((x, y) => need[x] - need[y]);
    const [best, second] = order;
    // Ecke: zweite Seite kostet kaum mehr (z. B. Übersichtskarte unten rechts)
    if (r && need[second] < need[best] * 1.6 && need[second] < Math.min(W, H) / 2) {
      corners.push([{ ...zero(), [best]: need[best] }, { ...zero(), [second]: need[second] }]);
    } else base[best] = Math.max(base[best], need[best]);
  }
  if (!r || !corners.length) {
    for (const [a] of corners) for (const s of SIDES) base[s] = Math.max(base[s], a[s]);
    return base;
  }
  // Ecken nacheinander der Seite zuschlagen, die den Zoom am wenigsten drückt
  const z = (p: Insets) => Math.min(zoomFor(r, W, H, p), maxZoom);
  const skew = (p: Insets) => Math.abs(p.left - p.right) + Math.abs(p.top - p.bottom);
  let cur = base;
  for (const [a, c] of corners) {
    const withA = merge(cur, a);
    const withC = merge(cur, c);
    const za = z(withA);
    const zc = z(withC);
    cur = Math.abs(za - zc) <= 0.01 * Math.max(za, zc) ? (skew(withC) < skew(withA) ? withC : withA) : zc > za ? withC : withA;
  }
  return symmetric(cur, z);
}

/** Ränder je Achse angleichen, solange das den Zoom nicht drückt: Inhalt bleibt dann in der Bildmitte (wie bisher),
 *  nur wo es eng ist, rückt er von den Leisten weg. */
function symmetric(p: Insets, z: (p: Insets) => number): Insets {
  const h = Math.max(p.left, p.right);
  const v = Math.max(p.top, p.bottom);
  const best = z(p);
  const ok = (q: Insets) => z(q) >= best * 0.99;
  const both = { top: v, bottom: v, left: h, right: h };
  if (ok(both)) return both;
  const hor = { ...p, left: h, right: h };
  if (ok(hor)) return hor;
  const ver = { ...p, top: v, bottom: v };
  return ok(ver) ? ver : p;
}

const zero = (): Insets => ({ top: 0, right: 0, bottom: 0, left: 0 });
const merge = (p: Insets, q: Insets): Insets => ({ top: Math.max(p.top, q.top), right: Math.max(p.right, q.right), bottom: Math.max(p.bottom, q.bottom), left: Math.max(p.left, q.left) });
