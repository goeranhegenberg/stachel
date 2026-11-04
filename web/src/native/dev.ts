// Sandbox-Aktion `dev.note` (docs/contract.md §8.12): legt eine Haftnotiz an, damit die App den Weg über `act`
// (Warteschlange, ack.results, Auswahl/Kamera/Hinweis) testen kann, bevor es echte Aktionen gibt. Nur mit
// Env STACHEL_NATIVE_DEV_ACTIONS=1 (tools/sandbox.mts) verfügbar.
import { STICKY_COLORS } from '../protocol';
import { A, parseArgs } from './args';
import { defineNativeAction } from './registry';

const SIZE = 200;

defineNativeAction<{ x: number; y: number; text?: string }>('dev.note', {
  dev: true,
  undo: 'undo',
  args: (raw) => parseArgs(raw, { x: A.num(), y: A.num(), text: A.opt(A.str(500)) }),
  run(store, { x, y, text }, ctx) {
    const id = ctx.id(1);
    if (!ctx.exists(id)) store.createMany([{ id, type: 'sticky', x: Math.round(x - SIZE / 2), y: Math.round(y - SIZE / 2), w: SIZE, h: SIZE, color: STICKY_COLORS[0], text: text ?? '' }]);
    return { select: [id], focus: [id], edit: id, toast: 'Notiz angelegt.' };
  },
});
