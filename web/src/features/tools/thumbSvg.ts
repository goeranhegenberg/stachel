// Vorschaubild der Board-Übersicht als SVG (P8, docs/features/tools.md „Vorschaubilder“): der Server rendert es aus dem
// Board-Dokument (server/src/thumbnails.ts, Rasterung mit sharp/libvips) – ohne React, ohne DOM, mit den Textmaßen des
// Browsers (`measureText`, auf dem Server aus den Schriftmaßen). Ziel ist eine *lesbare* Miniatur: Texte erscheinen
// mindestens in `MIN_TEXT_PX` Bildpunkten (auf die Objektfläche gekürzt), Rahmentitel immer, und große Boards zeigen den
// dichtesten Ausschnitt statt eines unlesbaren Gesamtbilds. Private Objekte (privater Modus) liegen nicht im Board-Dokument
// und kommen hier nie an; ausgeblendete Objekte (`hidden`) bleiben weg.
import type { BoardObject } from '../../protocol';
import { readableInk, textOn, userColor } from '../../board/colors';
import { arrowHeadAt, connectorGeometry, connectorPath, dashArray } from '../../board/connector';
import { objRect, unionRects, type Rect } from '../../board/geometry';
import { smoothPath } from '../../board/pen';
import { fitFontSize } from '../../board/textfit';
import { measureText } from '../../editor/measureText';
import { wrapText } from '../structure/text';

/** Pixelmaße (doppelte Auflösung der Karte 280 × 130 in der Übersicht) */
export const THUMB_PX_W = 560;
export const THUMB_PX_H = 260;
/** kleinste Schrift im Bild (Bildpunkte; in der Karte die Hälfte) – darunter wird Text zu einem Balken */
export const MIN_TEXT_PX = 13;
/** kleinster Maßstab; ist das Board größer, zeigt das Bild den dichtesten Ausschnitt */
export const MIN_SCALE = 0.3;
/** höchstens so viele Objekte zeichnen (die obersten gewinnen nicht – die Reihenfolge bleibt) */
export const MAX_OBJECTS = 1500;

export interface ThumbImage {
  /** Bild-ID (`imageId`) */
  imageId: string;
  /** gewünschte Breite in Bildpunkten */
  px: number;
}

export interface ThumbOptions {
  width?: number;
  height?: number;
  /** Board-Hintergrund (Einstellungen), Standard Hellgrau */
  background?: string;
  /** Bilder als data:-URI (vom Server vorher geladen); fehlt eins, zeichnet das Bild eine graue Fläche */
  images?: ReadonlyMap<string, string>;
}

export interface ThumbResult {
  svg: string;
  /** Ausschnitt in Board-Einheiten */
  view: Rect;
  /** Bilder im Ausschnitt, die der Aufrufer als data:-URI nachreichen kann */
  wantedImages: ThumbImage[];
}

type Obj = BoardObject & { [k: string]: unknown };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const HEX = /^#[0-9a-f]{6}$/i;
const color = (c: unknown, def: string) => (typeof c === 'string' && HEX.test(c) ? c : def);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const finite = (o: Obj) => [o.x, o.y, o.w, o.h].every((v) => typeof v === 'number' && Number.isFinite(v));

/** Grenzen eines Objekts (Verbinder über ihre Enden, Rahmen mit Titel darüber). */
function boundsOf(o: Obj, lookup: (id: string) => BoardObject | undefined): Rect | null {
  if (o.type === 'connector') {
    const g = connectorGeometry(o, lookup);
    return g ? unionRects([g.a, g.b, ...g.pts].map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))) : null;
  }
  if (!finite(o)) return null;
  const r = objRect(o);
  return o.type === 'frame' && o.title ? { ...r, y: r.y - Math.max(18, r.w / 36) * 1.6, h: r.h + Math.max(18, r.w / 36) * 1.6 } : r;
}

/**
 * Ausschnitt: alle Objekte mit Rand, aufs Seitenverhältnis erweitert. Braucht das einen kleineren Maßstab als
 * `MIN_SCALE`, wird ein Fenster in Mindestmaßstab um die Stelle gelegt, an der die meiste Objektfläche liegt
 * (Kandidaten an den Objektecken) – so bleibt das Wichtigste lesbar.
 */
export function thumbView(rects: readonly Rect[], width = THUMB_PX_W, height = THUMB_PX_H): Rect | null {
  const all = unionRects([...rects]);
  if (!all) return null;
  const aspect = width / height;
  const pad = Math.max(24, Math.max(all.w, all.h) * 0.04);
  const fit = (r: Rect): Rect => {
    const p = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
    if (p.w / p.h > aspect) {
      const h = p.w / aspect;
      return { x: p.x, y: p.y - (h - p.h) / 2, w: p.w, h };
    }
    const w = p.h * aspect;
    return { x: p.x - (w - p.w) / 2, y: p.y, w, h: p.h };
  };
  const whole = fit(all);
  if (width / whole.w >= MIN_SCALE) return whole;
  // Fenster im Mindestmaßstab: Kandidaten = linke obere Ecken der Objekte (mit Rand), bestes = meiste Objektfläche,
  // bei (fast) Gleichstand das obere, dann das linke (Leserichtung)
  const ww = width / MIN_SCALE;
  const wh = height / MIN_SCALE;
  const m = Math.min(pad, ww * 0.04);
  const cands = rects.length > 400 ? rects.filter((_, i) => i % Math.ceil(rects.length / 400) === 0) : rects;
  let best = { x: all.x - m, y: all.y - m, score: -1 };
  for (const c of cands) {
    const x = c.x - m;
    const y = c.y - m;
    let score = 0;
    // nur ganz sichtbare Objekte zählen, ihre Fläche gedämpft: viele kleine Notizen schlagen einen großen leeren Rahmen
    for (const r of rects) if (r.x >= x && r.y >= y && r.x + r.w <= x + ww && r.y + r.h <= y + wh) score += Math.sqrt(r.w * r.h);
    const better = score > best.score * 1.02 || (score >= best.score * 0.98 && (y < best.y - 1 || (Math.abs(y - best.y) <= 1 && x < best.x)));
    if (better) best = { x, y, score: Math.max(score, best.score) };
  }
  // passt das Board in einer Richtung ganz hinein, dort mittig
  const x = all.w + 2 * m <= ww ? all.x + all.w / 2 - ww / 2 : best.x;
  const y = all.h + 2 * m <= wh ? all.y + all.h / 2 - wh / 2 : best.y;
  return { x, y, w: ww, h: wh };
}

/** Text in einem Kasten, mindestens `minFs` groß, auf die Höhe gekürzt (…); zu klein → grauer Balken. */
function textBox(
  out: string[],
  text: string,
  box: Rect,
  fs: number,
  minFs: number,
  ink: string,
  opts: { weight?: number; anchor?: 'start' | 'middle' | 'end'; family?: string; valign?: 'top' | 'middle'; upper?: boolean; maxLines?: number } = {},
) {
  const t = (opts.upper ? text.toUpperCase() : text).replace(/\s+\n/g, '\n').trim();
  if (!t || box.w <= 0 || box.h <= 0) return;
  const weight = opts.weight ?? 500;
  const fam0 = (opts.family ?? 'Barlow') === 'Barlow' ? undefined : opts.family;
  let size = Math.max(fs, minFs);
  // längstes Wort nicht mitten durchbrechen: lieber etwas kleiner (bis 70 % der Mindestgröße)
  const longest = t.split(/\s+/).reduce((m, wd) => Math.max(m, measureText(wd, size, weight, false, fam0)), 0);
  if (longest > box.w * 0.96 && size > fs) size = Math.max(minFs * 0.7, fs, (size * box.w * 0.96) / longest);
  const lh = 1.2;
  const family = opts.family ?? 'Barlow';
  let maxLines = Math.floor(box.h / (size * lh) + 0.15);
  if (opts.maxLines) maxLines = Math.min(maxLines, opts.maxLines);
  if (maxLines < 1 || box.w < size * 1.5) {
    // passt nicht lesbar: ein Balken wie die Detailstufe im Editor
    const bh = Math.min(box.h * 0.5, size * 0.6);
    out.push(`<rect x="${num(box.x + box.w * 0.12)}" y="${num(box.y + (box.h - bh) / 2)}" width="${num(box.w * 0.76)}" height="${num(bh)}" rx="${num(bh / 2)}" fill="${ink}" opacity=".22"/>`);
    return;
  }
  const measure = (s: string) => measureText(s, size, weight, false, family === 'Barlow' ? undefined : family);
  let lines = wrapText(t, Math.max(4, box.w), measure).filter((l, i, a) => l || (i > 0 && i < a.length - 1));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && measure(`${last}…`) > box.w) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  const total = lines.length * size * lh;
  const top = opts.valign === 'top' ? box.y : box.y + (box.h - total) / 2;
  const anchor = opts.anchor ?? 'middle';
  const x = anchor === 'middle' ? box.x + box.w / 2 : anchor === 'end' ? box.x + box.w : box.x;
  const fam = family === 'Barlow' ? 'Barlow' : `${family}, Barlow`;
  out.push(`<text font-family="${esc(fam)}" font-size="${num(size)}" font-weight="${weight}" fill="${ink}" text-anchor="${anchor}">`);
  lines.forEach((l, i) => out.push(`<tspan x="${num(x)}" y="${num(top + size * (i * lh + 0.92))}">${esc(l)}</tspan>`));
  out.push('</text>');
}

/** Umriss einer Form (die häufigen genau, alle anderen als abgerundetes Rechteck). */
function shapeD(kind: string, x: number, y: number, w: number, h: number): string {
  switch (kind) {
    case 'ellipse':
    case 'circle':
      return `M${num(x)} ${num(y + h / 2)}a${num(w / 2)} ${num(h / 2)} 0 1 0 ${num(w)} 0a${num(w / 2)} ${num(h / 2)} 0 1 0 ${num(-w)} 0Z`;
    case 'diamond':
      return `M${num(x + w / 2)} ${num(y)}L${num(x + w)} ${num(y + h / 2)}L${num(x + w / 2)} ${num(y + h)}L${num(x)} ${num(y + h / 2)}Z`;
    case 'triangle':
      return `M${num(x + w / 2)} ${num(y)}L${num(x + w)} ${num(y + h)}L${num(x)} ${num(y + h)}Z`;
    default: {
      const r = Math.min(kind === 'roundrect' ? Math.min(w, h) * 0.2 : 6, w / 4, h / 4);
      return `M${num(x + r)} ${num(y)}H${num(x + w - r)}Q${num(x + w)} ${num(y)} ${num(x + w)} ${num(y + r)}V${num(y + h - r)}Q${num(x + w)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)}H${num(x + r)}Q${num(x)} ${num(y + h)} ${num(x)} ${num(y + h - r)}V${num(y + r)}Q${num(x)} ${num(y)} ${num(x + r)} ${num(y)}Z`;
    }
  }
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Vorschaubild als SVG-Text. `objects` von unten nach oben (Rahmen zuerst wie im Editor); null = nichts zu zeigen.
 * Rahmen- und Board-Inhalte erscheinen wie im Editor, nur vereinfacht (Formen-Umrisse, Karten, Tabellen als Kästen).
 */
export function thumbnailSvg(objects: readonly BoardObject[], opts: ThumbOptions = {}): ThumbResult | null {
  const width = opts.width ?? THUMB_PX_W;
  const height = opts.height ?? THUMB_PX_H;
  const list = (objects as Obj[]).filter((o) => o && typeof o.type === 'string' && !o.hidden && !(o.mind as { hidden?: boolean } | undefined)?.hidden).slice(0, MAX_OBJECTS);
  const byId = new Map(list.map((o) => [o.id, o as BoardObject]));
  const lookup = (id: string) => byId.get(id);
  const rects = new Map<string, Rect>();
  for (const o of list) {
    const r = boundsOf(o, lookup);
    if (r && r.w >= 0 && r.h >= 0) rects.set(o.id, r);
  }
  const view = thumbView([...rects.values()], width, height);
  if (!view) return null;
  const scale = width / view.w;
  const minFs = MIN_TEXT_PX / scale;
  const bg = color(opts.background, '#f3f3ef');
  const out: string[] = [];
  const wantedImages: ThumbImage[] = [];
  const frames = list.filter((o) => o.type === 'frame');
  const rest = list.filter((o) => o.type !== 'frame');
  const titles: string[] = [];

  const draw = (o: Obj) => {
    const r = rects.get(o.id);
    if (!r || !overlaps(r, view)) return;
    const { x, y, w, h } = o;
    const rot = typeof o.rotation === 'number' && o.rotation ? ` transform="rotate(${num(o.rotation)} ${num(x + w / 2)} ${num(y + h / 2)})"` : '';
    const text = str(o.text);
    switch (o.type) {
      case 'frame': {
        out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${color(o.color, '#ffffff')}" stroke="#d6d6cf" stroke-width="${num(Math.max(1.5, 1.2 / scale))}"/>`);
        const title = str(o.title);
        if (title) {
          // Rahmentitel immer lesbar, über dem Rahmen (nach den Objekten gezeichnet, damit nichts sie verdeckt)
          const fs = Math.max(Math.max(18, w / 36), (MIN_TEXT_PX + 2) / scale);
          const box = { x, y: y - fs * 1.35, w: Math.max(w, fs * 6), h: fs * 1.3 };
          textBox(titles, title, box, fs, 0, '#3a3a36', { weight: 700, anchor: 'start', family: 'Barlow Condensed', upper: true, maxLines: 1, valign: 'top' });
        }
        return;
      }
      case 'sticky': {
        const fill = color(o.color, '#fff27a');
        const pad = Math.round(Math.min(w, h) * 0.09);
        out.push(`<g${rot}><rect x="${num(x)}" y="${num(y + 2 / scale)}" width="${num(w)}" height="${num(h)}" fill="rgba(0,0,0,.08)"/><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${fill}"/>`);
        // Auto-Größe wie im Editor (textMeasure.ts stickyFontSize), lesbar mindestens minFs
        const weight = o.bold ? 700 : 500;
        const fs =
          typeof o.fontSize === 'number'
            ? o.fontSize
            : fitFontSize(text, Math.max(10, w - 2 * pad) * 0.96, Math.max(10, h - 2 * pad), (s, f) => measureText(s, f, weight, !!o.italic), { min: 5, max: Math.max(8, (Math.min(w, h) * 0.82) / 4.6) });
        textBox(out, text, { x: x + pad, y: y + pad, w: w - 2 * pad, h: h - 2 * pad }, fs, minFs, readableInk(fill), { weight });
        out.push('</g>');
        return;
      }
      case 'shape': {
        const fill = color(o.color, '#ffffff');
        const alpha = typeof o.fillOpacity === 'number' ? o.fillOpacity : 1;
        const sw = typeof o.strokeWidth === 'number' ? o.strokeWidth : 2;
        const stroke = color(o.stroke, '#0a0a0a');
        out.push(`<g${rot}><path d="${shapeD(str(o.shape) || 'rect', x, y, w, h)}" fill="${fill}" fill-opacity="${num(alpha)}"${sw > 0 ? ` stroke="${stroke}" stroke-width="${num(Math.max(sw, 1 / scale))}"` : ''}/>`);
        const ink = alpha < 0.5 ? '#0a0a0a' : textOn(fill);
        const inset = str(o.shape) === 'ellipse' || str(o.shape) === 'diamond' ? 0.18 : 0.08;
        textBox(out, text, { x: x + w * inset, y: y + h * inset, w: w * (1 - 2 * inset), h: h * (1 - 2 * inset) }, typeof o.fontSize === 'number' ? o.fontSize : 20, minFs, ink, { weight: o.bold ? 700 : 600 });
        out.push('</g>');
        return;
      }
      case 'text': {
        const fs = typeof o.fontSize === 'number' ? o.fontSize : 24;
        const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
        // freier Text: lesbar, darf über seine Breite nicht hinaus (rechts abgeschnitten wie im Kasten)
        textBox(out, text, { x, y, w: Math.max(w, fs * 2), h: Math.max(h, Math.max(fs, minFs) * 1.25) }, fs, minFs, color(o.color, '#0a0a0a'), { weight: o.bold || fs >= 40 ? 700 : 500, anchor, valign: 'top' });
        return;
      }
      case 'connector': {
        const g = connectorGeometry(o, lookup);
        if (!g) return;
        const sw = Math.max(typeof o.strokeWidth === 'number' ? o.strokeWidth : 2, 1.2 / scale);
        const c = color(o.color, '#0a0a0a');
        const dash = dashArray(str(o.dash) || undefined, sw);
        out.push(`<path d="${connectorPath(g)}" fill="none" stroke="${c}" stroke-width="${num(sw)}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`);
        const size = 8 + sw * 3;
        if (o.arrowEnd !== false) out.push(`<polygon points="${arrowHeadAt(g.b, g.dirB, size).map((q) => `${num(q.x)},${num(q.y)}`).join(' ')}" fill="${c}"/>`);
        if (o.arrowStart) out.push(`<polygon points="${arrowHeadAt(g.a, g.dirA, size).map((q) => `${num(q.x)},${num(q.y)}`).join(' ')}" fill="${c}"/>`);
        return;
      }
      case 'pen': {
        const pts = Array.isArray(o.points) ? (o.points as number[]) : [];
        const sw = Math.max(typeof o.strokeWidth === 'number' ? o.strokeWidth : 4, 1 / scale);
        out.push(`<path d="${smoothPath(pts)}" transform="translate(${num(x)} ${num(y)})" fill="none" stroke="${color(o.color, '#0a0a0a')}" stroke-width="${num(sw)}" stroke-linecap="round" stroke-linejoin="round"${o.marker ? ' opacity=".4"' : ''}/>`);
        return;
      }
      case 'image': {
        const id = str(o.imageId);
        const href = id ? opts.images?.get(id) : undefined;
        if (id) wantedImages.push({ imageId: id, px: Math.max(8, Math.min(512, Math.ceil(w * scale))) });
        if (href) out.push(`<image href="${esc(href)}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="xMidYMid slice"${rot}/>`);
        else out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="#d9d9d3"${rot}/>`);
        return;
      }
      case 'card': {
        const c = color(o.color, '#1763b5');
        out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="10" fill="#ffffff" stroke="#e2e2dc"/><rect x="${num(x)}" y="${num(y)}" width="6" height="${num(h)}" rx="3" fill="${c}"/>`);
        textBox(out, text, { x: x + 18, y: y + 12, w: w - 34, h: h - 24 }, 17, minFs, '#0a0a0a', { weight: 600, anchor: 'start', valign: 'top' });
        const who = o.assignee as { key?: unknown } | undefined;
        if (who && typeof who.key === 'string') out.push(`<circle cx="${num(x + w - 26)}" cy="${num(y + h - 24)}" r="13" fill="${userColor(who.key)}"/>`);
        return;
      }
      case 'mindnode': {
        const level = typeof (o.mind as { level?: unknown } | undefined)?.level === 'number' ? ((o.mind as { level: number }).level) : (o.mind as { parent?: unknown } | undefined)?.parent ? 1 : 0;
        const c = color(o.color, '#ec4e92');
        const parent = (o.mind as { parent?: unknown } | undefined)?.parent;
        const p = typeof parent === 'string' ? byId.get(parent) : undefined;
        if (p) out.push(`<path d="M${num(p.x + p.w)} ${num(p.y + p.h / 2)}C${num(p.x + p.w + 30)} ${num(p.y + p.h / 2)} ${num(x - 30)} ${num(y + h / 2)} ${num(x)} ${num(y + h / 2)}" fill="none" stroke="${c}" stroke-width="${num(Math.max(2.5, 1 / scale))}"/>`);
        if (level === 0) out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(Math.min(h / 2, 26))}" fill="${c}"/>`);
        else if (level === 1) out.push(`<rect x="${num(x + 1.25)}" y="${num(y + 1.25)}" width="${num(w - 2.5)}" height="${num(h - 2.5)}" rx="${num(Math.min(h / 2, 26))}" fill="#ffffff" stroke="${c}" stroke-width="2.5"/>`);
        else out.push(`<line x1="${num(x)}" y1="${num(y + h - 1.5)}" x2="${num(x + w)}" y2="${num(y + h - 1.5)}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`);
        textBox(out, text, { x: x + 8, y, w: w - 16, h }, level === 0 ? 22 : 18, minFs, level === 0 ? textOn(c) : '#0a0a0a', { weight: level === 0 ? 700 : 600, anchor: level === 0 ? 'middle' : 'start' });
        return;
      }
      default: {
        // Tabellen, Zeitleisten, Dokumente, Sticker und Typen anderer Module: Fläche mit Titel
        if (!finite(o)) return;
        const fill = o.type === 'table' || o.type === 'timeline' || o.type === 'document' ? '#ffffff' : color(o.color, '#e9e9e4');
        out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="6" fill="${fill}" stroke="#cfcfc8" stroke-width="${num(Math.max(1.5, 1 / scale))}"${rot}/>`);
        if (o.type === 'table' || o.type === 'timeline') out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(Math.min(h, 40))}" fill="${color(o.color, '#0a0a0a')}"/>`);
        const label = text || str(o.title) || str(o.name);
        if (label) textBox(out, label, { x: x + 10, y: y + 6, w: w - 20, h: h - 12 }, 18, minFs, '#0a0a0a', { weight: 600, anchor: 'start', valign: 'top' });
      }
    }
  };
  for (const o of frames) draw(o);
  for (const o of rest) draw(o);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${num(view.x)} ${num(view.y)} ${num(view.w)} ${num(view.h)}" preserveAspectRatio="xMidYMid slice">` +
    `<rect x="${num(view.x)}" y="${num(view.y)}" width="${num(view.w)}" height="${num(view.h)}" fill="${bg}"/>` +
    out.join('') +
    titles.join('') +
    '</svg>';
  return { svg, view, wantedImages };
}
