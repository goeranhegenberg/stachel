// Web-Aktionen für die native App (docs/contract.md §8.12) – Q3 „Bedienung“:
// Clustern ohne KI (cluster.ts), Suchen & Ersetzen (replace.ts), Typ wechseln (convert.ts) – derselbe Code wie im
// Editor (organize.tsx, search.tsx), auf dem Store der App-Sitzung. Importiert von web/src/native/actions.ts.
// Test: server/test/native-act-organize.test.ts, Doku: docs/features/tools.md „Native-Aktionen“.
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';
import { adjustTextPatch } from '../../editor/interaction/textWidth';
import { A, parseArgs } from '../../native/args';
import { defineNativeAction, type NativeActionCtx } from '../../native/registry';
import { cardContentHeight } from '../structure/card/model';
import { clusterInStore, peopleNames, type ClusterBy } from './cluster';
import { CONVERT_TYPES, convertInStore, type ConvertType } from './convert';
import { REPLACE_MAX_IDS, REPLACE_MAX_LEN, replaceInStore, replaceToast } from './replace';

const cardHeight = (o: BoardObject, ctx: NativeActionCtx) => cardContentHeight(o, (text, fs, weight) => ctx.measure(text, fs, weight));

/**
 * Auswahl clustern nach `by` (color | tag | author): je Gruppe ein Raster mit Überschrift, Gruppen nebeneinander ab der
 * linken oberen Ecke der Auswahl. Überschriften bekommen die IDs `<key>-1` … Danach ist alles gewählt.
 */
defineNativeAction<{ ids: string[]; by: ClusterBy }>('tools.cluster', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(500), by: A.oneOf('color', 'tag', 'author') }),
  cost: ({ ids }) => ids.length,
  run(store, { ids, by }, ctx) {
    const names = peopleNames(store, ctx.user.key ? [[ctx.user.key, ctx.user.name]] : []);
    const r = clusterInStore(store, ids, by, names, (i) => ctx.id(i + 1));
    if (!r) return { skipped: true, toast: 'Zum Clustern mindestens zwei bewegliche Objekte wählen.' };
    return { select: r.select, data: { groups: r.groups, rect: r.rect } };
  },
});

/**
 * Suchen & Ersetzen: in den Objekten `ids` (Treffer der Suche, in Lesereihenfolge) `query` durch `replace` ersetzen;
 * `first` = nur die erste Fundstelle (Knopf „Ersetzen“). Gesperrtes bleibt (`data.locked`). `data.changed` = geänderte
 * Objekte (die App misst Text-Objekte neu).
 */
defineNativeAction<{ ids: string[]; query: string; replace: string; first?: boolean }>('tools.replace', {
  undo: 'undo',
  args: (raw) => {
    const r = parseArgs<{ ids: string[]; query: string; replace: string; first?: boolean }>(raw, {
      ids: A.ids(REPLACE_MAX_IDS),
      query: A.str(REPLACE_MAX_LEN, 1),
      replace: A.str(REPLACE_MAX_LEN),
      first: A.opt(A.bool),
    });
    if (r.ok && !r.args.query.trim()) return { ok: false, error: 'Suchbegriff fehlt.' };
    return r;
  },
  cost: ({ ids }) => ids.length,
  run(store, { ids, query, replace, first }, ctx) {
    const adjust = (o: BoardObject, p: Patch): Patch => {
      if (o.type === 'text') return adjustTextPatch(o, p);
      if (o.type === 'card') {
        const h = cardHeight(o, ctx);
        return h !== o.h ? { ...p, h } : p;
      }
      return p;
    };
    const r = replaceInStore(store, ids, query, replace, { first, adjust });
    // Hinweis wie im Web (search.tsx)
    return { ...(r.replaced ? {} : { skipped: true }), toast: replaceToast(r), data: { replaced: r.replaced, changed: r.changed, locked: r.locked } };
  },
});

/** Typ wechseln (sticky | shape | text | card): Text und Farbe bleiben, wo es passt; Karten bekommen ihre Höhe. */
defineNativeAction<{ ids: string[]; to: ConvertType }>('tools.convert', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(200), to: A.oneOf(...CONVERT_TYPES) }),
  cost: ({ ids }) => ids.length,
  run(store, { ids, to }, ctx) {
    const done = convertInStore(store, ids, to, (o) => (o.type === 'card' ? cardHeight(o, ctx) : undefined));
    if (!done.length) return { skipped: true };
    return { select: done, data: { changed: done } };
  },
});
