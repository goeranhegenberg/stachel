// Automatische Schriftgröße bei Rich-Text: Für schlichten Text in Barlow reicht die Canvas-Messung des Kerns.
// Bei Listen, Überschriften, breiteren Marks oder anderer Schriftart wird im DOM gemessen (mit Cache).
import { useLayoutEffect, useState, type RefObject } from 'react';
import type { BoardObject } from '../../protocol';
import type { TextVariant } from '../../editor/text/engine';
import * as Y from 'yjs';
import type { EditorApi } from '../../editor/ext/types';
import { stickyMaxFont } from '../../editor/textMeasure';
import { richDoc, type PMDoc, type PMNode } from './doc';

const WIDE_MARKS = new Set(['bold', 'italic', 'code']);

/** Weicht der Text so von schlichtem Barlow ab, dass die Canvas-Messung nicht mehr passt? */
export function needsDomFit(o: Pick<BoardObject, 'fontFamily'>, doc: PMDoc | null): boolean {
  if (o.fontFamily && o.fontFamily !== 'barlow') return true;
  if (!doc) return false;
  const odd = (n: PMNode): boolean => {
    if (n.type === 'text') return !!n.marks?.some((m) => WIDE_MARKS.has(m.type) || (m.type === 'textStyle' && !!m.attrs?.fontSize));
    if (n.type !== 'paragraph' && n.type !== 'hardBreak') return true;
    return !!n.content?.some(odd);
  };
  return doc.content.some(odd);
}

const px = (v: string) => parseFloat(v) || 0;

/**
 * Größte Schrift in [min, max] (Raster 0,5 px), bei der `el` in die Innenfläche seines Elternelements passt.
 * `hint` = bisheriges Ergebnis: Beim Tippen bleibt die Größe meist gleich, dann reichen zwei Messungen statt zehn
 * (jede Messung erzwingt ein Layout; bei 10000 Objekten kostete das ≈ 9 ms pro Tastendruck).
 */
export function domFit(el: HTMLElement, min: number, max: number, hint?: number): number {
  const box = el.parentElement;
  if (!box) return max;
  const cs = getComputedStyle(box);
  const availH = box.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
  const availW = box.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
  const prev = el.style.fontSize;
  const fits = (fs: number) => {
    el.style.fontSize = `${fs}px`;
    return el.scrollHeight <= availH + 1 && el.scrollWidth <= availW + 1;
  };
  const step = (v: number) => Math.floor(v * 2) / 2;
  let result: number | undefined;
  if (hint !== undefined && hint >= min && hint <= max && step(hint) === hint && fits(hint)) {
    if (hint + 0.5 > max || !fits(hint + 0.5)) result = hint;
  }
  if (result === undefined) {
    result = max;
    if (!fits(max)) {
      let lo = min;
      let hi = max;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      result = step(lo);
      // auf das 0,5-Raster genau (gleiches Ergebnis wie über `hint`, sonst springt die Größe nach dem Bearbeiten)
      if (result + 0.5 <= max && fits(result + 0.5)) result += 0.5;
    }
  }
  el.style.fontSize = prev;
  return result;
}

const cache = new Map<string, number>();

/**
 * Schriftgröße, die der Kern-Wert ersetzen soll (undefined = Kern-Wert gilt): Haftnotiz ohne feste Größe und Form,
 * jeweils nur, wenn needsDomFit. `fontsVersion` gehört in den Schlüssel (nachgeladene Schriften messen anders).
 */
export function useFit(ref: RefObject<HTMLElement | null>, o: BoardObject, variant: TextVariant, doc: PMDoc | null, fontsVersion: number, text: string): number | undefined {
  const [fs, setFs] = useState<number | undefined>(undefined);
  const on = (variant === 'sticky' ? o.fontSize === undefined : variant === 'shape') && needsDomFit(o, doc);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) {
      if (fs !== undefined) setFs(undefined);
      return;
    }
    const max = variant === 'sticky' ? stickyMaxFont(o.w, o.h) : (o.fontSize ?? 20);
    const key = `${variant}|${o.w}|${o.h}|${max}|${o.fontFamily}|${o.bold ? 1 : 0}${o.italic ? 1 : 0}|${o.shape}|${fontsVersion}|${doc ? JSON.stringify(doc.content) : text}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = domFit(el, 5, max, fs);
      if (cache.size > 3000) cache.clear();
      cache.set(key, v);
    }
    if (v !== fs) setFs(v);
  });
  return on ? fs : undefined;
}

/** Natürliche Breite eines Textelements (Weltpunkte), unabhängig von der aktuellen Breite. */
export function naturalWidth(el: HTMLElement): number {
  const prev = el.style.width;
  el.style.width = 'max-content';
  const w = Math.ceil(el.offsetWidth) + 2;
  el.style.width = prev;
  return w;
}

/** Text mit autoWidth nach einer Format-Änderung (Schriftart) auf die gerenderte Breite bringen. */
export function fitTextWidths(api: EditorApi, ids: readonly string[], endStep = true) {
  requestAnimationFrame(() => {
    const patches: Record<string, { w: number }> = {};
    for (const id of ids) {
      const o = api.store.get(id);
      if (!o || o.type !== 'text' || !o.autoWidth || (!endStep && !needsDomFit(o, richDoc(o)))) continue;
      const el = document.querySelector(`[data-id="${CSS.escape(id)}"] .text-content`) as HTMLElement | null;
      if (!el) continue;
      const w = naturalWidth(el);
      if (Math.abs(w - o.w) > 1) patches[id] = { w };
    }
    if (Object.keys(patches).length) api.store.updateMany(patches);
    api.remeasure(ids, endStep);
  });
}

/** Felder, nach deren Änderung die Kern-Breite (Canvas-Messung, schlichter Text) bei Rich-Text nicht mehr stimmt. */
const WIDTH_KEYS = ['fontSize', 'fontFamily', 'bold', 'italic', 'autoWidth'];
/** Inhalt bzw. Breite: nur nachmessen, wenn der Text anders misst als die Canvas-Messung (Listen, Marks …) */
const CONTENT_KEYS = ['text', 'w'];
const watched = new WeakSet<object>();

/**
 * Eigene Änderungen an Text mit autoWidth (Schriftgröße per Kontextleiste, Fett fürs Objekt, Tippen, Rückgängig …):
 * Breite aus dem DOM nachziehen, sobald der Rich-Text anders misst als die Kern-Messung. Der Kern setzt die Breite
 * bei jeder Textänderung per Canvas (ohne Listen-Einzug bzw. Kästchen); endet die Bearbeitung im selben Frame, bliebe
 * der Text sonst abgeschnitten. Nur eigene Änderungen (kein Schreib-Echo von anderen).
 */
export function watchTextWidths(api: EditorApi) {
  const store = api.store;
  if (watched.has(store)) return;
  watched.add(store);
  store.doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (!tr.local) return;
    const ids: string[] = [];
    tr.changed.forEach((keys, type) => {
      if (type.parent !== store.objects || !(type instanceof Y.Map)) return;
      const fmt = [...keys].some((k) => k !== null && WIDTH_KEYS.includes(k));
      if (!fmt && ![...keys].some((k) => k !== null && CONTENT_KEYS.includes(k))) return;
      const id = type._item?.parentSub;
      const o = id ? store.get(id) : undefined;
      if (id && o?.type === 'text' && o.autoWidth && (fmt || needsDomFit(o, richDoc(o)))) ids.push(id);
    });
    if (ids.length) fitTextWidths(api, ids, false);
  });
}
