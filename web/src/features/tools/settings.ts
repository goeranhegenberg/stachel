// Board-Einstellungen (für alle, im Yjs-Dokument unter 'tools.settings', ohne Rückgängig): Hintergrund-Muster und -Farbe.
// Das Modell ohne React liegt in settingsModel.ts (auch für die Web-Aktion `tools.settings` der App, native-view.ts).
import { useY } from '../../editor/ext/hooks';
import type { EditorApi } from '../../editor/ext/types';
import { readSettings, settingsMapOf, toggleGridOf, writeSettingsTo, type BoardSettings, type Pattern } from './settingsModel';

export * from './settingsModel';

export const settingsMap = (api: EditorApi) => settingsMapOf(api.store);

export const getSettings = (api: EditorApi) => readSettings(settingsMap(api));

export function useBoardSettings(api: EditorApi): BoardSettings {
  return useY(settingsMap(api), readSettings);
}

export function writeSettings(api: EditorApi, patch: Partial<BoardSettings & { lastPattern: Pattern }>) {
  writeSettingsTo(api.store, patch);
}

/** Raster ein/aus (Strg '): zwischen „Leer“ und dem zuletzt gewählten Muster wechseln. */
export const toggleGrid = (api: EditorApi) => toggleGridOf(api.store);
