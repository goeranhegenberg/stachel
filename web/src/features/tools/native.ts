// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P1 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Ebene schrittweise (layers.ts) und Format übertragen (style.ts) – derselbe Code
// wie im Editor, auf dem Store der App-Sitzung.
// Test: server/test/native-act-tools.test.ts, Doku: docs/features/tools.md „Native-Aktionen“.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';
import { adjustTextPatch } from '../../editor/interaction/textWidth';
import { A, parseArgs } from '../../native/args';
import { defineNativeAction } from '../../native/registry';
import { layerStepPatches } from './layers';
import { CORE_STYLE_TRAITS, extractStyle, styleKeys, stylePatches, type Style } from './style';

/** Eine Ebene nach vorne (1) bzw. hinten (-1), wie Strg ] / Strg [. */
defineNativeAction<{ ids: string[]; dir: 1 | -1 }>('tools.layerStep', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(), dir: (v) => v === 1 || v === -1 }),
  run(store, { ids, dir }) {
    const sel = new Set(ids.filter((id) => store.get(id)));
    if (!sel.size) return { skipped: true };
    const patches = layerStepPatches(store.getSnapshot().ordered, sel, dir);
    if (!Object.keys(patches).length) return { skipped: true };
    store.updateMany(patches);
    return {};
  },
});

/** „Format kopieren“: das Format des Objekts (Positivliste je Typ) als `data` – die App merkt es sich wie das Web. */
defineNativeAction<{ id: string }>('tools.copyStyle', {
  undo: 'none',
  args: (raw) => parseArgs(raw, { id: A.id }),
  run(store, { id }) {
    const o = store.get(id);
    if (!o) return { skipped: true };
    return { data: extractStyle(o), toast: 'Format kopiert.' };
  },
});

const isStyle = (v: unknown): v is Style => {
  const s = v as { type?: unknown; fields?: unknown } | null;
  return !!s && typeof s === 'object' && A.str(40, 1)(s.type) && A.obj(s.fields);
};

/** Nur Felder der Positivliste des Vorbild-Typs (sonst könnte `style` beliebige Felder setzen). */
const cleanStyle = (s: Style): Style => {
  const keys = styleKeys(s.type);
  return { type: s.type, fields: Object.fromEntries(Object.entries(s.fields).filter(([k]) => keys.includes(k))) };
};

/** Textbreite bei autoWidth wie `typeDef('text').adjustPatch` im Editor. */
const adjust = (o: BoardObject, p: Patch): Patch => (o.type === 'text' ? adjustTextPatch(o, p) : p);

/**
 * „Format einfügen“ bzw. Format-Pinsel: Format `style` (aus `tools.copyStyle`) oder das des Objekts `from` auf `ids`
 * übertragen (gesperrte bleiben). Passt nichts: Hinweis wie im Web (`painter` = Pinsel, ein Objekt angeklickt).
 */
defineNativeAction<{ ids: string[]; style?: Style; from?: string; painter?: boolean }>('tools.pasteStyle', {
  undo: 'undo',
  args: (raw) => {
    const r = parseArgs<{ ids: string[]; style?: Style; from?: string; painter?: boolean }>(raw, {
      ids: A.ids(),
      style: A.opt(isStyle),
      from: A.opt(A.id),
      painter: A.opt(A.bool),
    });
    if (r.ok && !r.args.style === !r.args.from) return { ok: false, error: 'Genau eins von „style“ und „from“ angeben.' };
    return r;
  },
  run(store, { ids, style, from, painter }) {
    const src = from ? store.get(from) : undefined;
    const s = style ? cleanStyle(style) : src ? extractStyle(src) : null;
    if (!s) return { skipped: true, toast: 'Das Vorbild gibt es nicht mehr.' };
    const objs = ids.map((id) => store.get(id)).filter((o): o is BoardObject => !!o);
    const patches = stylePatches(s, objs, CORE_STYLE_TRAITS, adjust);
    if (!Object.keys(patches).length) return { toast: painter ? 'Das Format passt nicht zu diesem Objekt.' : 'Das Format passt nicht zu dieser Auswahl.' };
    store.updateMany(patches);
    return {};
  },
});
