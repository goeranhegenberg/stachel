// Web-Aktionen der App für Notiz-Stapel (docs/contract.md §8.12, Quick Win Q2): derselbe React-freie Code wie im
// Browser (stack/model.ts). Test: server/test/native-act-stack.test.ts, Doku: docs/features/shapes.md „Notiz-Stapel“.
import { A, parseArgs } from '../../../native/args';
import { defineNativeAction } from '../../../native/registry';
import { cycleStack, dropNotes, spreadStack, STACK_MAX, takeFromStack } from './model';

/**
 * `shapes.stackDrop`: nach dem Verschieben von `ids` (gegriffen: `grabbed`) wie das Ablegen im Browser – mittig auf
 * einer anderen Haftnotiz → auf deren Stapel, aus einem Stapel herausgezogen → vom Stapel genommen. Die App ruft es nach
 * ihrer Bewegung auf (eigener Rückgängig-Schritt).
 */
defineNativeAction<{ ids: string[]; grabbed?: string }>('shapes.stackDrop', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(STACK_MAX), grabbed: A.opt(A.id) }),
  cost: ({ ids }) => ids.length,
  run(store, { ids, grabbed }, ctx) {
    const sel = dropNotes(store, ids, grabbed, () => ctx.id(1));
    return sel ? { select: sel } : { skipped: true };
  },
});

/** `shapes.stackCycle`: durchblättern (`dir` 1 = nächste Notiz nach oben, -1 = vorige); Auswahl bleibt der Stapel. */
defineNativeAction<{ id: string; dir: number }>('shapes.stackCycle', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, dir: (v) => v === 1 || v === -1 }),
  run(store, { id, dir }) {
    const top = cycleStack(store, id, dir === -1 ? -1 : 1);
    return top ? { data: { top } } : { skipped: true };
  },
});

/** `shapes.stackSpread`: auffächern (Raster neben der Stapel-Ecke, Stapel aufgelöst), danach alle gewählt. */
defineNativeAction<{ id: string }>('shapes.stackSpread', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id }),
  run(store, { id }) {
    const ids = spreadStack(store, id);
    return ids ? { select: ids } : { skipped: true };
  },
});

/** `shapes.stackTake`: eine Notiz (Standard: die oberste) rechts neben den Stapel legen, danach gewählt. */
defineNativeAction<{ id: string; which?: string }>('shapes.stackTake', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, which: A.opt(A.id) }),
  run(store, { id, which }) {
    const off = takeFromStack(store, id, which);
    return off ? { select: [off] } : { skipped: true };
  },
});
