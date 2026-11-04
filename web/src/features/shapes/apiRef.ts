// Editor-API für Darstellungen ohne api-Prop (Objekt-Views): setzt der Overlay-Slot des Moduls bei jedem Rendern.
import type { EditorApi } from '../../editor/ext/types';

let current: EditorApi | null = null;
export const setEditorApi = (api: EditorApi | null) => {
  current = api;
};
export const editorApi = () => current;
