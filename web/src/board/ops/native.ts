// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P1 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Gruppieren/Lösen, Ausrichten, Verteilen – derselbe Code wie im Editor
// (board/ops/groups.ts, board/ops/arrange.ts), auf dem Store der App-Sitzung. Ein Rückgängig-Schritt je Aktion.
// Test: server/test/native-act-core.test.ts, Doku: docs/features/tools.md „Native-Aktionen“.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import type { BoardObject } from '../../protocol';
import { A, parseArgs } from '../../native/args';
import { defineNativeAction } from '../../native/registry';
import type { BoardStore } from '../store';
import { isBelow } from '../types';
import { align, arrangePatches, distribute, type AlignMode } from './arrange';
import { groupPatches, ungroupPatches } from './groups';

/** Ausgewählte Objekte im Live-Stand (unbekannte IDs fallen weg, Reihenfolge der App). */
const objectsOf = (store: BoardStore, ids: readonly string[]): BoardObject[] => ids.map((id) => store.get(id)).filter((o): o is BoardObject => !!o);

/** Rahmen nehmen ihren Inhalt mit – im Editor `typeDef(o).container`; ohne Editor-Register: die Typen „unten“ (Rahmen). */
const isContainer = (o: BoardObject) => isBelow(o);

/** Schreiben wie der Editor (ein Schritt; die Grenzen des Rückgängig-Schritts setzt die Nachricht der App). */
const write = (store: BoardStore, patches: Record<string, unknown>) => store.updateMany(patches as Parameters<BoardStore['updateMany']>[0]);

/** Gruppieren (Strg G): ≥ 2 ungesperrte bekommen eine neue `groupId`. */
defineNativeAction<{ ids: string[] }>('core.group', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids() }),
  run(store, { ids }) {
    const p = groupPatches(objectsOf(store, ids));
    if (!p) return { skipped: true };
    write(store, p);
    return { select: Object.keys(p) };
  },
});

/** Gruppierung lösen (Strg Umschalt G). */
defineNativeAction<{ ids: string[] }>('core.ungroup', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids() }),
  run(store, { ids }) {
    const p = ungroupPatches(objectsOf(store, ids));
    if (!p) return { skipped: true };
    write(store, p);
    return { select: ids.filter((id) => store.get(id)) };
  },
});

const ALIGN_MODES: AlignMode[] = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];

/** Ausrichten der Auswahl (Gruppen als Einheit, ohne Verbinder/Gesperrte, Rahmen mit Inhalt). */
defineNativeAction<{ ids: string[]; mode: AlignMode }>('core.align', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(), mode: A.oneOf(...ALIGN_MODES) }),
  run(store, { ids, mode }) {
    const p = arrangePatches(objectsOf(store, ids), store.getSnapshot(), (u) => align(u, mode), isContainer);
    if (!Object.keys(p).length) return { skipped: true };
    write(store, p);
    return {};
  },
});

/** Gleichmäßig verteilen (≥ 3 Einheiten, äußere bleiben stehen). */
defineNativeAction<{ ids: string[]; axis: 'x' | 'y' }>('core.distribute', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(), axis: A.oneOf('x', 'y') }),
  run(store, { ids, axis }) {
    const p = arrangePatches(objectsOf(store, ids), store.getSnapshot(), (u) => distribute(u, axis), isContainer);
    if (!Object.keys(p).length) return { skipped: true };
    write(store, p);
    return {};
  },
});
