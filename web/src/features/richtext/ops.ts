// Format aufs ganze Objekt (Kontextleiste ohne Bearbeitung, Strg U auf dem Board): je ein Undo-Schritt.
// Die Store-Varianten (`…In`, whole.ts) laufen ohne Editor – auch als Web-Aktion der App (native.ts).
import type { BoardObject } from '../../protocol';
import type { EditorApi } from '../../editor/ext/types';
import { typeDef } from '../../editor/ext/registry';
import { hasMarkAll, isWholeList, richDoc, type ListKind } from './doc';
import { listAllIn, markAllIn, toggleTaskIn } from './whole';

export { listAllIn, markAllIn, setTextColorIn, toggleTaskIn } from './whole';

/** Ausgewählte, nicht gesperrte Objekte mit Text (`textual` ohne Editor-Register: CORE_STYLE_TRAITS des Servers). */
export const textTargets = (objs: readonly BoardObject[], textual: (type: string) => boolean = (t) => !!typeDef(t).textual) =>
  objs.filter((o) => !o.locked && textual(o.type));

/** Trägt der ganze Text aller Objekte das Mark? */
export const allMarked = (objs: readonly BoardObject[], mark: string, match?: (a: Record<string, unknown> | undefined) => boolean) =>
  objs.length > 0 && objs.every((o) => hasMarkAll(richDoc(o), mark, match));

/** Mark auf den ganzen Text setzen (attrs) bzw. entfernen (null). */
export const markAll = (api: EditorApi, objs: readonly BoardObject[], mark: string, attrs: Record<string, unknown> | null) => markAllIn(api.store, objs, mark, attrs);

/** Ganzen Text zur Liste machen bzw. zurück zu Absätzen (alle gleich: Ziel richtet sich nach dem ersten). */
export function listAll(api: EditorApi, objs: readonly BoardObject[], kind: ListKind) {
  listAllIn(api.store, objs, kind);
  api.remeasure(objs.map((o) => o.id));
}

export const isAllList = (objs: readonly BoardObject[], kind: ListKind) => objs.length > 0 && objs.every((o) => isWholeList(richDoc(o), kind));

/** Kästchen `index` einer Checkliste abhaken bzw. zurücksetzen, ohne Bearbeitung (ein Undo-Schritt). */
export function toggleTaskAt(api: EditorApi, o: BoardObject, index: number) {
  toggleTaskIn(api.store, o, index);
}
