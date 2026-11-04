// Format übertragen („Stil kopieren/einfügen“, Strg Alt C / Strg Alt V) und Format-Pinsel:
// Pinsel an → jedes angeklickte Objekt bekommt das Format, bis Esc oder Klick ins Leere.
// Positivliste und Patch React-frei in style.ts (auch für die Web-Aktion `tools.pasteStyle` der App).
import { useEffect, useSyncExternalStore } from 'react';
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';
import { typeDef } from '../../editor/ext/registry';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { IconBrush } from './icons';
import { extractStyle, stylePatch as stylePatchWith, stylePatches, type Style, type StyleTraits } from './style';

export { extractStyle, type Style };

/** Eigenschaften der Typen aus dem Editor-Register (Module können Typen ergänzen). */
export const editorStyleTraits: StyleTraits = { textual: (t) => !!typeDef(t).textual, valign: (t) => !!typeDef(t).valign };

/** Patch, der das Format `s` auf `o` überträgt; null = nichts Passendes. */
export function stylePatch(s: Style, o: BoardObject): Patch | null {
  return stylePatchWith(s, o, editorStyleTraits);
}

/** Format auf Objekte anwenden (ein Undo-Schritt, gesperrte bleiben). Liefert die Anzahl geänderter Objekte. */
export function applyStyle(api: EditorApi, s: Style, objs: readonly BoardObject[]): number {
  const patches: Record<string, Patch> = stylePatches(s, objs, editorStyleTraits, api.adjustPatch);
  const ids = Object.keys(patches);
  if (!ids.length) return 0;
  api.store.stopCapturing();
  api.store.updateMany(patches);
  api.remeasure(ids);
  return ids.length;
}

// ---- gemerktes Format und Pinsel-Modus --------------------------------------------------------------------------

let copied: Style | null = null;
let painter: Style | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const usePainter = () => useSyncExternalStore(subscribe, () => painter);
export const painterActive = () => painter !== null;

export function copyStyle(api: EditorApi): boolean {
  const o = api.selected()[0];
  if (!o) return false;
  copied = extractStyle(o);
  api.toast('Format kopiert. Einfügen mit Strg Alt V.');
  return true;
}

export function pasteStyle(api: EditorApi): boolean {
  if (!copied || !api.selection().length) return false;
  if (!applyStyle(api, copied, api.selected())) api.toast('Das Format passt nicht zu dieser Auswahl.');
  return true;
}

export const hasCopiedStyle = () => copied !== null;

export function startPainter(api: EditorApi, from: BoardObject | undefined = api.selected()[0]) {
  if (!from) return;
  painter = extractStyle(from);
  copied = painter;
  api.setSelection([]);
  emit();
}

export function stopPainter() {
  if (!painter) return;
  painter = null;
  emit();
}

/** Objekt unter dem Bildschirmpunkt (auch Stiftstriche/Verbinder, die nur per DOM getroffen werden). */
function objectUnder(api: EditorApi, clientX: number, clientY: number, board: HTMLElement): BoardObject | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const hit = (el as HTMLElement).closest?.('.world [data-id]') as HTMLElement | null;
    if (hit && board.contains(hit)) {
      const o = api.snapshot().byId.get(hit.dataset.id!);
      if (o && !o.hidden) return o;
    }
  }
  const r = board.getBoundingClientRect();
  return api.hitTest(api.toWorld({ x: clientX - r.left, y: clientY - r.top }), (o) => !!o.hidden);
}

/** Overlay-Slot: fängt Klicks ab, solange der Pinsel aktiv ist. */
export function PainterLayer({ api }: SlotProps) {
  const style = usePainter();
  useEffect(() => {
    if (!style) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stopPainter();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [style]);
  if (!style) return null;
  return (
    <>
      <div
        className="tools-painter-catch"
        data-testid="painter-layer"
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          const board = e.currentTarget.closest<HTMLElement>('.board')!;
          const o = objectUnder(api, e.clientX, e.clientY, board);
          if (!o) return stopPainter();
          // ganze Gruppe wie beim Anklicken
          const objs = o.groupId ? api.snapshot().ordered.filter((x) => x.groupId === o.groupId) : [o];
          if (!applyStyle(api, style, objs)) api.toast('Das Format passt nicht zu diesem Objekt.');
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          stopPainter();
        }}
      />
      <div className="tools-painter-pill panel" role="status" onPointerDown={(e) => e.stopPropagation()}>
        <IconBrush size={18} />
        <span>Format übertragen: Objekte anklicken</span>
        <button className="tools-painter-pill__done" onClick={stopPainter}>
          Fertig
        </button>
      </div>
    </>
  );
}
