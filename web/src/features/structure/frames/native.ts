// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P4 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Rahmen-Liste umsortieren mit dem Code der Web-Liste (order.ts).
// Test: server/test/native-act-frames.test.ts, Doku: „Native-Aktionen“ in docs/features/structure.md.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import { A, parseArgs } from '../../../native/args';
import { defineNativeAction } from '../../../native/registry';
import { framesInOrder, movePatches } from './order';

/**
 * `frames.reorder`: Rahmen `id` an Platz `to` der Rahmen-Liste (0 = erster; zu groß = letzter) – wie Ziehen am Griff
 * in der Web-Liste (Feld `slide`, ein Rückgängig-Schritt). Die Reihenfolge rechnet der Server aus dem aktuellen Stand,
 * damit gleichzeitige Änderungen anderer nicht überschrieben werden. Ergebnis `data` = Rahmen-IDs in neuer Reihenfolge.
 */
defineNativeAction<{ id: string; to: number }>('frames.reorder', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, to: A.int(0, 100_000) }),
  run(store, { id, to }) {
    const frames = framesInOrder(store.getSnapshot().ordered);
    const from = frames.findIndex((f) => f.id === id);
    if (from < 0) return { skipped: true };
    const patches = movePatches(frames, from, Math.min(to, frames.length - 1));
    if (Object.keys(patches).length) store.updateMany(patches);
    return { data: framesInOrder(store.getSnapshot().ordered).map((f) => f.id) };
  },
});
