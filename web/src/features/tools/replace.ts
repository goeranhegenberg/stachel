// Suchen & Ersetzen (Q3): Fundstellen wie die Suche (ui/search.ts `fold`: ohne Groß/Klein, Umlaut-tolerant),
// ersetzt wird im Text von Haftnotiz, Text, Form, Verbinder-Beschriftung (Rich-Text: Formatierung der Fundstelle
// bleibt), Rahmentitel und Karte (Titel, Beschreibung). Gesperrtes bleibt, ein Rückgängig-Schritt.
// React-frei: Web (search.tsx), App (Web-Aktion `tools.replace`, native-organize.ts) und Server rechnen hiermit.
import * as Y from 'yjs';
import { RICH_TEXT_TYPES, type BoardObject } from '../../protocol';
import type { BoardStore, Patch } from '../../board/store';
import { fold, foldQuery } from '../../ui/search';
import { ensureContent, fragmentToJson, plainOf } from '../richtext/doc';

/** Höchstens so viele Objekte je Aufruf (die App schickt die Treffer-IDs mit). */
export const REPLACE_MAX_IDS = 2000;
/** längster Such- bzw. Ersatztext */
export const REPLACE_MAX_LEN = 500;

/** Felder mit ersetzbarem Text eines Objekts: `rich` = Rich-Text (`content` + Klartext `text`), sonst Klartext. */
export function replaceFields(o: BoardObject): { field: string; text: string; rich?: boolean }[] {
  if ((RICH_TEXT_TYPES as readonly string[]).includes(o.type)) return [{ field: 'text', text: o.text ?? '', rich: true }];
  if (o.type === 'frame') return [{ field: 'title', text: o.title ?? '' }];
  if (o.type === 'card') {
    const desc = (o as { desc?: unknown }).desc;
    return [
      { field: 'text', text: o.text ?? '' },
      { field: 'desc', text: typeof desc === 'string' ? desc : '' },
    ];
  }
  return [];
}

/** Alle Fundstellen (ohne Überlappung) als [von, bis) im Original; leere Anfrage = keine. */
export function findAll(text: string, query: string): [number, number][] {
  const q = foldQuery(query);
  if (!q || !text) return [];
  const f = fold(text);
  const out: [number, number][] = [];
  let at = f.text.indexOf(q);
  while (at >= 0) {
    out.push([f.start[at]!, f.end[at + q.length - 1]!]);
    at = f.text.indexOf(q, at + q.length);
  }
  return out;
}

/** Anzahl ersetzbarer Fundstellen eines Objekts. */
export const replaceCount = (o: BoardObject, query: string) => replaceFields(o).reduce((n, f) => n + findAll(f.text, query).length, 0);

/** Vorschau: Fundstellen und Objekte, davon gesperrt (die werden nicht ersetzt). */
export function replacePreview(objs: readonly BoardObject[], query: string): { total: number; objects: number; locked: number } {
  let total = 0;
  let objects = 0;
  let locked = 0;
  for (const o of objs) {
    const n = replaceCount(o, query);
    if (!n) continue;
    if (o.locked) locked += n;
    else {
      total += n;
      objects++;
    }
  }
  return { total, objects, locked };
}

/** Text mit ersetzten Fundstellen (`first` = nur die erste). */
export function replaceText(text: string, query: string, replacement: string, first = false): { text: string; n: number } {
  const hits = findAll(text, query);
  const use = first ? hits.slice(0, 1) : hits;
  let out = text;
  for (let i = use.length - 1; i >= 0; i--) out = out.slice(0, use[i]![0]) + replacement + out.slice(use[i]![1]);
  return { text: out, n: use.length };
}

/** Ergebnis von „Ersetzen“ als Hinweis (Web und App). */
export function replaceToast(r: { replaced: number; locked: number }): string {
  if (!r.replaced) return r.locked ? 'Nur in gesperrten Objekten gefunden.' : 'Nichts gefunden.';
  const done = r.replaced === 1 ? '1 Stelle ersetzt.' : `${r.replaced} Stellen ersetzt.`;
  return r.locked ? `${done} ${r.locked} in gesperrten Objekten nicht ersetzt.` : done;
}

// ---- Rich-Text ------------------------------------------------------------------------------------------------------

/** Alle Y.XmlText eines Fragments in Dokument-Reihenfolge (auch in Code-Blöcken). */
function allTexts(f: Y.XmlFragment | Y.XmlElement): Y.XmlText[] {
  const out: Y.XmlText[] = [];
  for (const c of f.toArray()) {
    if (c instanceof Y.XmlText) out.push(c);
    else if (c instanceof Y.XmlElement) out.push(...allTexts(c));
  }
  return out;
}

type Delta = { insert: unknown; attributes?: Record<string, unknown> }[];

const textOfDelta = (d: Delta) => d.map((x) => (typeof x.insert === 'string' ? x.insert : '￼')).join('');

/** Attribute (Marks) an Stelle `at` eines Deltas. */
function attrsAt(d: Delta, at: number): Record<string, unknown> {
  let i = 0;
  for (const x of d) {
    const len = typeof x.insert === 'string' ? x.insert.length : 1;
    if (at < i + len) return x.attributes ?? {};
    i += len;
  }
  return {};
}

/**
 * Fundstellen in einem Y.XmlText ersetzen, rückwärts; der Ersatz trägt die Marks des ersten Zeichens der Fundstelle
 * (Yjs erbt sonst die des linken Nachbarn). `limit` = höchstens so viele. Liefert die Anzahl.
 */
function replaceInXmlText(t: Y.XmlText, query: string, replacement: string, limit: number): number {
  const d = t.toDelta() as Delta;
  const hits = findAll(textOfDelta(d), query).slice(0, limit);
  for (let i = hits.length - 1; i >= 0; i--) {
    const [from, to] = hits[i]!;
    const want = attrsAt(d, from);
    t.delete(from, to - from);
    if (!replacement) continue;
    t.insert(from, replacement);
    const got = attrsAt(t.toDelta() as Delta, from);
    const fix: Record<string, unknown> = {};
    for (const k of Object.keys(got)) if (!(k in want)) fix[k] = null;
    for (const [k, v] of Object.entries(want)) if (JSON.stringify(got[k]) !== JSON.stringify(v)) fix[k] = v;
    if (Object.keys(fix).length) t.format(from, replacement.length, fix);
  }
  return hits.length;
}

// ---- Ausführen ------------------------------------------------------------------------------------------------------

export interface ReplaceResult {
  /** ersetzte Fundstellen */
  replaced: number;
  /** geänderte Objekte (Text-Objekte und Karten messen danach ihre Höhe neu) */
  changed: string[];
  /** Fundstellen in gesperrten Objekten (bleiben) */
  locked: number;
}

/**
 * In den Objekten `ids` ersetzen (Reihenfolge = Reihenfolge der Treffer; `first` = nur die erste Fundstelle im
 * ersten Objekt, das eine hat). `adjust` passt den Patch eines Objekts an (Textbreite bei autoWidth, Kartenhöhe).
 * Ein Rückgängig-Schritt.
 */
export function replaceInStore(
  store: BoardStore,
  ids: readonly string[],
  query: string,
  replacement: string,
  opts: { first?: boolean; adjust?: (o: BoardObject, p: Patch) => Patch } = {},
): ReplaceResult {
  const res: ReplaceResult = { replaced: 0, changed: [], locked: 0 };
  if (!foldQuery(query)) return res;
  const objs = [...new Set(ids)].map((id) => store.get(id)).filter((o): o is BoardObject => !!o);
  store.stopCapturing();
  store.transact(() => {
    for (const o of objs) {
      if (opts.first && res.replaced) break;
      const n0 = replaceCount(o, query);
      if (!n0) continue;
      if (o.locked) {
        res.locked += n0;
        continue;
      }
      const limit = opts.first ? 1 : Infinity;
      let n = 0;
      const patch: Patch = {};
      /** neuer Text auch der Y.Text-Felder (für `adjust`, der Schnappschuss ist in der Transaktion noch alt) */
      const view: Record<string, unknown> = {};
      for (const f of replaceFields(o)) {
        if (n >= limit) break;
        if (!findAll(f.text, query).length) continue;
        if (f.rich) {
          const frag = ensureContent(store, o.id, null);
          if (!frag) continue;
          for (const t of allTexts(frag)) {
            if (n >= limit) break;
            n += replaceInXmlText(t, query, replacement, limit - n);
          }
          (patch as Record<string, unknown>)[f.field] = plainOf(fragmentToJson(frag));
        } else {
          const r = replaceText(f.text, query, replacement, opts.first);
          n += r.n;
          view[f.field] = r.text;
          const y = store.yField<Y.Text>(o.id, f.field);
          if (y instanceof Y.Text) {
            // nur die Fundstellen ändern (gleichzeitiges Tippen anderswo im Text bleibt)
            const hits = findAll(y.toString(), query).slice(0, opts.first ? 1 : undefined);
            for (let i = hits.length - 1; i >= 0; i--) {
              y.delete(hits[i]![0], hits[i]![1] - hits[i]![0]);
              if (replacement) y.insert(hits[i]![0], replacement);
            }
          } else (patch as Record<string, unknown>)[f.field] = r.text;
        }
      }
      if (!n) continue;
      res.replaced += n;
      res.changed.push(o.id);
      const p = opts.adjust ? opts.adjust({ ...o, ...view, ...patch } as BoardObject, patch) : patch;
      if (Object.keys(p).length) store.update(o.id, p);
    }
  });
  store.stopCapturing();
  return res;
}
