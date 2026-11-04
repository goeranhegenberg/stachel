// Einrasten am Raster (lokale Einstellung): beim Ziehen mit dem Zeiger landen Objekte mit der linken oberen Ecke
// auf dem 24er-Raster des Boards. Umgesetzt über die Verschiebe-Regel je Typ (board/types `move`), damit der Editor
// unverändert bleibt; Pfeiltasten, Ausrichten und Einfügen (ohne gedrückte Maus) bleiben pixelgenau.
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';
import { registerTypeInfo, typeInfo, type TypeInfo } from '../../board/types';
import { objectTypes } from '../../editor/ext/registry';
import { getPrefs } from './prefs';

/** Rasterweite des Boards (wie das Punktraster im Editor) */
export const GRID = 24;

export const snapToGrid = (v: number, g = GRID) => Math.round(v / g) * g;

let pointerDown = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (pointerDown = e.button === 0), true);
  for (const ev of ['pointerup', 'pointercancel', 'blur'] as const) window.addEventListener(ev, () => (pointerDown = false), true);
}

/** Verschiebe-Regel mit Einrasten (`active` = Einrasten an und Zeiger gedrückt). */
export function gridMove(prev: TypeInfo['move'], active: () => boolean): NonNullable<TypeInfo['move']> {
  return (o: BoardObject, dx: number, dy: number): Patch => {
    const p = prev ? prev(o, dx, dy) : { x: o.x + dx, y: o.y + dy };
    if (!active() || typeof p.x !== 'number' || typeof p.y !== 'number') return p;
    return { ...p, x: snapToGrid(p.x), y: snapToGrid(p.y) };
  };
}

const installed = new Set<string>();

/** Alle bekannten Typen (außer abgeleiteten wie Verbindern) mit Einrasten versehen. */
export function installGridSnap() {
  const active = () => pointerDown && getPrefs().snap;
  for (const def of objectTypes.list()) {
    if (installed.has(def.type) || def.derive || def.dependent) continue;
    installed.add(def.type);
    registerTypeInfo(def.type, { move: gridMove(typeInfo(def.type).move, active) });
  }
}
