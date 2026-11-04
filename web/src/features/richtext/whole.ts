// Format aufs ganze Objekt ohne Editor (Store-Varianten der Kontextleiste, ops.ts): auch als Web-Aktion der App
// (native.ts) – daher ohne Editor-Register und ohne React (der Server baut diese Datei mit).
import type * as Y from 'yjs';
import { RICH_TEXT_FIELD, type BoardObject } from '../../protocol';
import type { BoardStore } from '../../board/store';
import { ensureContent, fragmentToJson, isWholeList, patchMarkAll, replaceFragment, richDoc, setMarkAll, toggleListDoc, toggleTask, type ListKind } from './doc';

function richIn(store: BoardStore, objs: readonly BoardObject[], fn: (f: ReturnType<typeof ensureContent> & object) => void) {
  store.stopCapturing();
  store.transact(() => {
    for (const o of objs) {
      // Migration im selben Undo-Schritt wie die Änderung (Vertrag)
      const f = ensureContent(store, o.id, null);
      if (f) fn(f);
    }
  });
  store.stopCapturing();
}

/** Mark auf den ganzen Text setzen (attrs) bzw. entfernen (null) – ohne Editor. */
export const markAllIn = (store: BoardStore, objs: readonly BoardObject[], mark: string, attrs: Record<string, unknown> | null) =>
  richIn(store, objs, (f) => setMarkAll(f, mark, attrs));

/**
 * Ganzen Text zur Liste machen bzw. zurück zu Absätzen – ohne Editor. `on` fehlt: wie die Leiste (alle schon diese
 * Liste → zurück). Liefert die geänderten Objekte (die Höhe von Text-Objekten misst der Aufrufer nach).
 */
export function listAllIn(store: BoardStore, objs: readonly BoardObject[], kind: ListKind, on?: boolean): string[] {
  const off = on === undefined ? objs.every((o) => isWholeList(richDoc(o), kind)) : !on;
  const changed: string[] = [];
  store.stopCapturing();
  store.transact(() => {
    for (const o of objs) {
      const f = ensureContent(store, o.id, null);
      if (!f) continue;
      const doc = fragmentToJson(f);
      if (isWholeList(doc, kind) !== off) continue;
      replaceFragment(f, toggleListDoc(doc, kind));
      changed.push(o.id);
    }
  });
  store.stopCapturing();
  return changed;
}

/**
 * Textfarbe fürs ganze Objekt (`null` = Automatisch): Text-Objekte ändern ihre Objektfarbe (= Textfarbe) und verlieren
 * eigene Farben im Text, alle anderen bekommen das Mark `textStyle.color` (Teil-Größen bleiben). Ein Undo-Schritt.
 */
export function setTextColorIn(store: BoardStore, targets: readonly BoardObject[], c: string | null) {
  store.stopCapturing();
  store.transact(() => {
    for (const o of targets) {
      if (o.type === 'text') store.update(o.id, { color: c ?? '#0a0a0a' });
      const f = o.type === 'text' ? store.yField<Y.XmlFragment>(o.id, RICH_TEXT_FIELD) : ensureContent(store, o.id, null);
      if (f) patchMarkAll(f, 'textStyle', { color: o.type !== 'text' && c ? c : null });
    }
  });
  store.stopCapturing();
}

/** Kästchen `index` einer Checkliste abhaken bzw. zurücksetzen, ohne Bearbeitung (ein Undo-Schritt) – ohne Editor. */
export function toggleTaskIn(store: BoardStore, o: BoardObject, index: number): boolean | null {
  if (o.locked || index < 0) return null;
  let next: boolean | null = null;
  richIn(store, [o], (f) => {
    next = toggleTask(f, index);
  });
  return next;
}

