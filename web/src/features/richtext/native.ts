// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P8 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Format fürs ganze Objekt aus der Kontextleiste (contextActions.tsx `core.format`:
// Unterstrichen, Textfarbe, Markierung, Liste; Strg K auf dem Objekt = Link für den ganzen Text) und Kästchen auf dem
// Board abhaken (RichView.tsx) – derselbe Code wie im Browser (whole.ts, doc.ts) auf dem Store der App-Sitzung.
// Test: server/test/native-act-richtext.test.ts, Doku: docs/features/richtext.md „Native-Aktionen“.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import type { BoardObject } from '../../protocol';
import type { BoardStore } from '../../board/store';
import { A, parseArgs } from '../../native/args';
import { defineNativeAction } from '../../native/registry';
import { CORE_STYLE_TRAITS } from '../tools/style';
import type { ListKind } from './doc';
import { normalizeHref } from './links';
import { listAllIn, markAllIn, setTextColorIn, toggleTaskIn } from './whole';

/** Mark-Attribute eines Links wie Tiptap sie schreibt (extensions.ts: `HTMLAttributes` der Link-Erweiterung). */
export const linkAttrs = (href: string) => ({ href, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'rt-link', title: null });

type WholeArgs =
  | { ids: string[]; op: 'underline'; value: boolean }
  | { ids: string[]; op: 'color' | 'highlight'; value: string | null }
  | { ids: string[]; op: 'list'; value: ListKind; on?: boolean }
  | { ids: string[]; op: 'link'; value: string | null };

const colorOrNull = (v: unknown) => v === null || A.color(v);

/** Ausgewählte Objekte (live), davon die mit Text und ohne Sperre – wie `textTargets` der Kontextleiste (Server ohne Editor-Register). */
const targetsOf = (store: BoardStore, ids: string[]): BoardObject[] =>
  ids.map((id) => store.get(id)).filter((o): o is BoardObject => !!o && !o.locked && CORE_STYLE_TRAITS.textual(o.type));

/**
 * Format fürs ganze Objekt (Kontextleiste ohne Bearbeitung): `underline` an/aus, `color` Textfarbe (`null` =
 * Automatisch; Text-Objekte ändern ihre Objektfarbe), `highlight` Markierung (`null` = Ohne), `list` Aufzählung/
 * Nummern/Checkliste (`on` fehlt = wie die Leiste: alle schon so → zurück zu Absätzen), `link` Link über den ganzen Text
 * (Eingabe wie im Link-Feld, `null` = entfernen). Ein Rückgängig-Schritt.
 */
defineNativeAction<WholeArgs>('richtext.whole', {
  undo: 'undo',
  args: (raw) => {
    const base = { ids: A.ids(), op: A.oneOf('underline', 'color', 'highlight', 'list', 'link') };
    switch (raw.op) {
      case 'underline':
        return parseArgs(raw, { ...base, value: A.bool });
      case 'color':
      case 'highlight':
        return parseArgs(raw, { ...base, value: colorOrNull });
      case 'list':
        return parseArgs(raw, { ...base, value: A.oneOf('bulletList', 'orderedList', 'taskList'), on: A.opt(A.bool) });
      case 'link':
        return parseArgs(raw, { ...base, value: (v) => v === null || A.str(2000, 1)(v) });
      default:
        return parseArgs(raw, base);
    }
  },
  cost: (a) => a.ids.length,
  run(store, a) {
    const targets = targetsOf(store, a.ids);
    if (!targets.length) return { skipped: true };
    switch (a.op) {
      case 'underline':
        markAllIn(store, targets, 'underline', a.value ? {} : null);
        return {};
      case 'color':
        setTextColorIn(store, targets, a.value);
        return {};
      case 'highlight':
        markAllIn(store, targets, 'highlight', a.value ? { color: a.value } : null);
        return {};
      case 'list':
        // Höhe von Text-Objekten misst die App nach (das Web misst im DOM, `api.remeasure`)
        return { data: { changed: listAllIn(store, targets, a.value, a.on) } };
      case 'link': {
        if (a.value === null) {
          markAllIn(store, targets, 'link', null);
          return {};
        }
        const href = normalizeHref(a.value);
        if (!href) return { skipped: true, toast: 'Das ist kein gültiger Link.' };
        markAllIn(store, targets, 'link', linkAttrs(href));
        return { data: { href } };
      }
    }
  },
});

/** Kästchen Nummer `index` (Dokument-Reihenfolge) einer Checkliste abhaken bzw. zurücksetzen – ohne Bearbeitung. */
defineNativeAction<{ id: string; index: number }>('richtext.toggleTask', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, index: A.int(0, 10_000) }),
  run(store, { id, index }) {
    const o = store.get(id);
    if (!o || o.locked) return { skipped: true };
    const next = toggleTaskIn(store, o, index);
    return next === null ? { skipped: true } : { data: { checked: next } };
  },
});
