// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P3 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Vorlage einfügen, „Einfügen als …“, Karten (Titel, Beschreibung live, aus
// Haftnotizen). Derselbe React-freie Code wie im Browser (templates/catalog.ts, place.ts, paste-model.ts, card/model.ts).
// Test: server/test/native-act-structure.test.ts, Doku: Abschnitt „Native-Aktionen“ in docs/features/structure.md.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import * as Y from 'yjs';
import { STICKY_COLORS } from '../../protocol';
import type { BoardObject } from '../../protocol';
import type { BoardStore } from '../../board/store';
import { A, parseArgs } from '../../native/args';
import { defineNativeAction, textMerge, type NativeActionCtx } from '../../native/registry';
import { cardContentHeight, notesToCards, type CardMeasure } from './card/model';
import { notesCount, notesOf, pasteChoice, singleNote, tableObject, type NoteBase } from './paste-model';
import { previewBounds } from './templates/bounds';
import { TEMPLATES } from './templates/catalog';
import { insertAt, occupiedIn } from './templates/insert';
import { cleanTemplateObjects, MAX_OWN_ARGS_JSON, MAX_OWN_OBJECTS } from './templates/own';
import { freeSpot } from './templates/place';

const cardMeasure = (ctx: NativeActionCtx): CardMeasure => (text, fs, weight) => ctx.measure(text, fs, weight);

/**
 * Karte neu messen (wie `api.remeasure` im Browser): Höhe aus dem Inhalt `o` (schon mit der Änderung – der Schnappschuss
 * des Stores ist innerhalb der Transaktion noch der alte), nur bei Abweichung schreiben.
 */
function remeasureCard(store: BoardStore, o: BoardObject, ctx: NativeActionCtx) {
  const h = cardContentHeight(o, cardMeasure(ctx));
  if (h !== o.h) store.update(o.id, { h });
}

/** Ungesperrte Karte (sonst nichts zu tun). */
const cardOf = (store: BoardStore, id: string): BoardObject | null => {
  const o = store.get(id);
  return o && o.type === 'card' && !o.locked ? o : null;
};

// ---- Vorlage einfügen (I30) -------------------------------------------------------------------------------------------

defineNativeAction<{ template: string; x: number; y: number }>('structure.template', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { template: A.oneOf(...TEMPLATES.map((t) => t.id)), x: A.num(), y: A.num() }),
  cost: ({ template }) => Math.max(1, TEMPLATES.find((t) => t.id === template)?.build().length ?? 1),
  // wie insertAtFreeSpot (templates/gallery.tsx): Bildmitte, sonst nächster freier Platz daneben; ein Schritt
  run(store, { template, x, y }, ctx) {
    const objs = TEMPLATES.find((t) => t.id === template)!.build();
    const b = previewBounds(objs);
    const c0 = { x, y };
    const c = b ? freeSpot(b, c0, occupiedIn(store.getSnapshot())) : c0;
    const ids = insertAt(store, objs, c, (i) => ctx.id(i + 1));
    const rect = b ? { x: c.x - b.w / 2, y: c.y - b.h / 2, w: b.w, h: b.h } : null;
    // Kamera wie im Browser (nur herauszoomen bzw. hinschwenken) entscheidet die App mit ihrem Ausschnitt: data.rect
    return { select: ids, data: { rect } };
  },
});

// ---- Eigene Vorlage einfügen (Q2) -------------------------------------------------------------------------------------

/**
 * `structure.insert`: Objekte einer eigenen Vorlage (`GET /api/templates`, als JSON-Text `json` – Rich-Text ist tiefer
 * verschachtelt, als `args` erlauben) wie die Galerie einfügen: Bildmitte bzw. nächster freier Platz, neue IDs,
 * ein Schritt, danach gewählt; `data.rect` für die Kamera der App. Unbrauchbare Objekte fallen weg (own.ts).
 */
defineNativeAction<{ json: string; x: number; y: number }>('structure.insert', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { json: A.str(MAX_OWN_ARGS_JSON, 2), x: A.num(), y: A.num() }),
  cost: ({ json }) => {
    try {
      const v: unknown = JSON.parse(json);
      return Math.max(1, Math.min(MAX_OWN_OBJECTS, Array.isArray(v) ? v.length : 1));
    } catch {
      return 1;
    }
  },
  run(store, { json, x, y }, ctx) {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { skipped: true };
    }
    const objs = cleanTemplateObjects(raw);
    if (!objs.length) return { skipped: true };
    const b = previewBounds(objs);
    const c0 = { x, y };
    const c = b ? freeSpot(b, c0, occupiedIn(store.getSnapshot())) : c0;
    const ids = insertAt(store, objs, c, (i) => ctx.id(i + 1));
    const rect = b ? { x: c.x - b.w / 2, y: c.y - b.h / 2, w: b.w, h: b.h } : null;
    return { select: ids, data: { rect } };
  },
});

// ---- Einfügen als … (D23) --------------------------------------------------------------------------------------------

type PasteAs = 'table' | 'notes' | 'note';
/** Längster eingefügter Text (Tabellen bis 300 × 40 Zellen) */
const MAX_PASTE = 200_000;

defineNativeAction<{ text: string; as: PasteAs; x: number; y: number; color?: string; w?: number; h?: number }>('structure.paste', {
  undo: 'undo',
  args: (raw) =>
    parseArgs(raw, {
      text: A.str(MAX_PASTE, 1),
      as: A.oneOf('table', 'notes', 'note'),
      x: A.num(),
      y: A.num(),
      color: A.opt(A.color),
      w: A.opt(A.num(1, 4000)),
      h: A.opt(A.num(1, 4000)),
    }),
  cost: ({ text, as }) => {
    if (as !== 'notes') return 1;
    const c = pasteChoice(text);
    return c ? Math.max(1, notesCount(c)) : 1;
  },
  // wie der Dialog „Einfügen als …“ (paste.tsx): Objekte bauen, Mitte an die Einfüge-Stelle, danach gewählt
  run(store, { text, as, x, y, color, w, h }, ctx) {
    // Haftnotiz wie das Notiz-Werkzeug der App sie anlegt (Größe/Farbe der App, sonst Standard)
    const base: NoteBase = { type: 'sticky', x: 0, y: 0, w: w ?? 200, h: h ?? 200, color: color ?? STICKY_COLORS[0], text: '' };
    const choice = pasteChoice(text);
    let objs: BoardObject[];
    if (as === 'note') objs = [singleNote(base, text)];
    else if (as === 'table') {
      if (!choice?.table) return { skipped: true };
      objs = [tableObject(choice.table, { x, y })];
    } else {
      if (!choice) return { skipped: true };
      objs = notesOf(base, choice);
    }
    if (!objs.length) return { skipped: true };
    const ids = insertAt(store, objs, { x, y }, (i) => ctx.id(i + 1));
    return { select: ids };
  },
});

// ---- Karten (I03, I07, I08) --------------------------------------------------------------------------------------------

/** Beschreibung live (Y.Text, Dialog „Karte“): Eingabe der App mit dem aktuellen Stand zusammenführen, Höhe neu. */
defineNativeAction<{ id: string; base?: string; text: string }>('card.desc', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, base: A.opt(A.str()), text: A.str() }),
  run(store, { id, base, text }, ctx) {
    const o = cardOf(store, id);
    if (!o) return { skipped: true };
    let conflict = false;
    store.transact(() => {
      const m = store.objects.get(id);
      if (!m) return;
      let t = m.get('desc');
      if (!(t instanceof Y.Text)) {
        // alter String bzw. leer: als Y.Text anlegen, im selben Schritt wie die Eingabe (wie yTextSource)
        const y = new Y.Text(typeof t === 'string' ? t : '');
        m.set('desc', y);
        t = y;
      }
      const yt = t as Y.Text;
      const cur = yt.toString();
      const merged = base === undefined ? { text, conflict: cur !== text && cur !== '' } : textMerge(ctx).merge(base, text, cur);
      conflict = merged.conflict;
      textMerge(ctx).apply(yt, merged.text);
      remeasureCard(store, { ...o, desc: merged.text }, ctx);
    });
    return { data: { conflict } };
  },
});

/** Titel (Feld `text`, String): Drei-Wege-Abgleich auf den aktuellen Stand wie `stringFieldSource`, Höhe neu. */
defineNativeAction<{ id: string; base?: string; text: string }>('card.title', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, base: A.opt(A.str()), text: A.str() }),
  run(store, { id, base, text }, ctx) {
    const o = cardOf(store, id);
    if (!o) return { skipped: true };
    const cur = o.text ?? '';
    const merged = base === undefined ? { text, conflict: cur !== text && cur !== '' } : textMerge(ctx).merge(base, text, cur);
    store.transact(() => {
      if (merged.text !== cur) store.update(id, { text: merged.text });
      remeasureCard(store, { ...o, text: merged.text }, ctx);
    });
    return { data: { conflict: merged.conflict } };
  },
});

/** „In Karte(n) umwandeln“: nur ungesperrte Haftnotizen; Lage, Breite ≥ 300, Text bleibt; ein Schritt, danach gewählt. */
defineNativeAction<{ ids: string[] }>('structure.toCard', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(200) }),
  cost: ({ ids }) => ids.length,
  run(store, { ids }, ctx) {
    const notes = ids.map((id) => store.get(id)).filter((o): o is BoardObject => !!o && o.type === 'sticky' && !o.locked);
    if (!notes.length) return { skipped: true };
    const cards = notesToCards(store, notes, (i) => ctx.id(i + 1), (card) => cardContentHeight(card, cardMeasure(ctx)));
    return { select: cards };
  },
});

/**
 * Eigenen Namen im Board vermerken (Auswahl „Zuständig“ der Karten, wie `useRegisterMe` beim Öffnen im Browser): Y-Struktur
 * `structure.people` (Schlüssel = user key, Wert = Name), nur bei Änderung, ohne Rückgängig.
 */
defineNativeAction<Record<string, never>>('structure.people', {
  undo: 'none',
  args: (raw) => parseArgs(raw, {}),
  run(store, _args, ctx) {
    // Name der Struktur wie card/people.ts (PEOPLE; die Datei selbst braucht React)
    const map = store.extMap<string>('structure.people', { undo: false });
    if (!ctx.user.key || map.get(ctx.user.key) === ctx.user.name) return { skipped: true };
    store.transact(() => map.set(ctx.user.key, ctx.user.name));
  },
});
