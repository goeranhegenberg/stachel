// Registrierungen des Moduls tools: Slots, Dialoge, Kürzel, Kontext- und Board-Menü, Kontextleiste.
import { lazy, Suspense } from 'react';
import { defineContextAction, defineMenuItem, defineModal, defineShortcut, defineSlot, typeDef } from '../../editor/ext/registry';
import type { EditorApi, ShortcutDef } from '../../editor/ext/types';
import { BoardBackground } from './background';
import { installGridSnap } from './grid';
import { HiddenObjects, hiddenIds, showAll, toggleHidden, toggleShowHidden } from './hide';
import { copyStyle, hasCopiedStyle, painterActive, PainterLayer, pasteStyle, startPainter, stopPainter } from './formatPainter';
import { layerStepPatches } from './layers';
import { copyObjectLink, ObjectLinkFocus } from './objectLink';
import { getPrefs, setPrefs } from './prefs';
import { openSearch, SearchBar } from './search';
import { getSettings, toggleGrid } from './settings';
import { SettingsDialog } from './SettingsDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import type { ExportDialogProps } from './export/ExportDialog';
import { IconBrush } from './icons';
import { duplicateBoard } from './boardApi';
import { currentBoardId } from './util';
import { ApiError, errorText } from '../../api';
import { boardHref, navigate } from '../../router';
import { isTouch } from '../../ui/touch';
import { photoNotesAvailable } from '../../instance';

// ---- Slots & Dialoge -------------------------------------------------------------------------------------------------

defineSlot({ id: 'tools.background', slot: 'overlay', order: 1, Component: BoardBackground, presenting: true });
defineSlot({ id: 'tools.hidden', slot: 'world', order: 1, Component: HiddenObjects, presenting: true });
defineSlot({ id: 'tools.search', slot: 'overlay', order: 50, Component: SearchBar });
defineSlot({ id: 'tools.painter', slot: 'overlay', order: 60, Component: PainterLayer });
defineSlot({ id: 'tools.objectLink', slot: 'overlay', order: 2, Component: ObjectLinkFocus, presenting: true });

// Export (Renderer, PDF-Schreiber) erst beim Öffnen laden
const ExportDialog = lazy(() => import('./export/ExportDialog').then((m) => ({ default: m.ExportDialog })));
defineModal({
  id: 'tools.export',
  Component: (p) => (
    <Suspense fallback={null}>
      <ExportDialog {...p} />
    </Suspense>
  ),
});
defineModal({ id: 'tools.settings', Component: SettingsDialog });
// Zettel abfotografieren (P10): Dialog erst beim Öffnen laden
const PhotoNotesDialog = lazy(() => import('./PhotoNotesDialog').then((m) => ({ default: m.PhotoNotesDialog })));
defineModal({
  id: 'tools.photoNotes',
  Component: (p) => (
    <Suspense fallback={null}>
      <PhotoNotesDialog {...p} />
    </Suspense>
  ),
});
// Kern-Kürzelübersicht ersetzen (Filter, Tastenkappen)
defineModal({ id: 'shortcuts', Component: ({ onClose }) => <ShortcutsDialog onClose={onClose} /> });

export const openExport = (api: EditorApi, props: ExportDialogProps = {}) => api.openModal('tools.export', props);

// ---- Aktionen ------------------------------------------------------------------------------------------------------

/** Eine Ebene nach vorne/hinten (ein Undo-Schritt). */
export function stepLayer(api: EditorApi, dir: 1 | -1): boolean {
  const sel = new Set(api.selection());
  if (!sel.size) return false;
  const patches = layerStepPatches(api.snapshot().ordered, sel, dir);
  if (!Object.keys(patches).length) return true;
  api.store.stopCapturing();
  api.store.updateMany(patches);
  api.store.stopCapturing();
  return true;
}

/** Board kopieren und öffnen bzw. als Vorlage speichern (nur mit Server). */
export async function copyBoard(api: EditorApi, template: boolean) {
  const id = currentBoardId();
  if (!id) return api.toast('Im Offline-Modus nicht möglich.');
  try {
    const b = await duplicateBoard(id, { template });
    if (template) api.toast(`Als Vorlage gespeichert. Du findest sie in der Board-Übersicht.`);
    else navigate(boardHref(b.id));
  } catch (e) {
    api.toast(e instanceof ApiError ? errorText(e) : 'Das hat nicht geklappt. Bitte versuch es noch einmal.');
  }
}

/** Ausschneiden (Strg X): kopieren, dann löschen (gesperrte bleiben). */
function cutSelection(api: EditorApi) {
  api.copySelection();
  api.deleteSelection();
}

const allLocked = (api: EditorApi) => api.selected().length > 0 && api.selected().every((o) => o.locked);
const anyHidden = (api: EditorApi) => api.selected().some((o) => o.hidden);

// ---- Tastenkürzel --------------------------------------------------------------------------------------------------

const onOff = (on: boolean) => (on ? 'An' : 'Aus');
const VIEW = 'Ansicht';
const EDIT = 'Bearbeiten';
const ARRANGE = 'Anordnen';
const withSelection = (fn: (api: EditorApi) => unknown) => (api: EditorApi) => (api.selection().length ? (fn(api), true) : false);

const SHORTCUTS: ShortcutDef[] = [
  { id: 'tools.search', keys: ['mod+f'], scope: 'board', run: () => openSearch(), help: { group: VIEW, keys: 'Strg F', label: 'Auf dem Board suchen', order: 5 } },
  { id: 'tools.grid', keys: ["mod+'", 'mod+Quote', 'mod+Backslash'], run: (api) => toggleGrid(api), help: { group: VIEW, keys: "Strg '", label: 'Raster ein/aus', order: 75 } },
  { id: 'tools.copyStyle', keys: ['mod+alt+c'], run: (api) => copyStyle(api), help: { group: EDIT, keys: 'Strg Alt C', label: 'Format kopieren', order: 120 } },
  { id: 'tools.pasteStyle', keys: ['mod+alt+v'], run: (api) => pasteStyle(api), help: { group: EDIT, keys: 'Strg Alt V', label: 'Format einfügen', order: 130 } },
  { id: 'tools.forward', keys: ['mod+]'], run: (api) => stepLayer(api, 1), help: { group: ARRANGE, keys: 'Strg ] / Strg [', label: 'Eine Ebene nach vorne / hinten', order: 10 } },
  { id: 'tools.backward', keys: ['mod+['], run: (api) => stepLayer(api, -1) },
  { id: 'tools.front', keys: ['mod+shift+]', 'mod+shift+}'], run: withSelection((api) => api.bringToFront()), help: { group: ARRANGE, keys: 'Strg Umschalt ] / [', label: 'Ganz nach vorne / hinten', order: 20 } },
  { id: 'tools.back', keys: ['mod+shift+[', 'mod+shift+{'], run: withSelection((api) => api.sendToBack()) },
  { id: 'tools.lock', keys: ['mod+shift+l'], run: withSelection((api) => api.toggleLock()), help: { group: ARRANGE, keys: 'Strg Umschalt L', label: 'Sperren / Entsperren', order: 30 } },
  { id: 'tools.hide', keys: ['mod+shift+h'], run: withSelection((api) => toggleHidden(api)), help: { group: ARRANGE, keys: 'Strg Umschalt H', label: 'Ausblenden / Einblenden', order: 40 } },
];
for (const s of SHORTCUTS) defineShortcut(s);

// ---- Kontextmenü: Objekt ---------------------------------------------------------------------------------------------
// Kern: Kopieren 10, Einfügen 20, Duplizieren 30, Nach vorne 40, Nach hinten 50, Sperren 60, Gruppieren 70, Zoomen 80, Löschen 100

defineMenuItem({ id: 'tools.cut', on: 'object', order: 15, item: (api) => ({ label: 'Ausschneiden', shortcut: 'Strg X', disabled: allLocked(api), onSelect: () => cutSelection(api) }) });
// Ebenen als Untermenü (ersetzt „Nach vorne“/„Nach hinten“ des Kerns)
defineMenuItem({
  id: 'object.front',
  on: 'object',
  order: 40,
  item: (api) => ({
    label: 'Ebene',
    sep: true,
    disabled: allLocked(api),
    items: [
      { label: 'Ganz nach vorne', shortcut: 'Strg Umschalt ]', onSelect: api.bringToFront },
      { label: 'Eine Ebene nach vorne', shortcut: 'Strg ]', onSelect: () => stepLayer(api, 1) },
      { label: 'Eine Ebene nach hinten', shortcut: 'Strg [', onSelect: () => stepLayer(api, -1) },
      { label: 'Ganz nach hinten', shortcut: 'Strg Umschalt [', onSelect: api.sendToBack },
    ],
  }),
});
defineMenuItem({ id: 'object.back', on: 'object', order: 50, item: () => null });
defineMenuItem({
  id: 'tools.hide',
  on: 'object',
  order: 62,
  item: (api) => ({ label: anyHidden(api) ? 'Einblenden' : 'Ausblenden', shortcut: 'Strg Umschalt H', disabled: allLocked(api), onSelect: () => toggleHidden(api) }),
});
defineMenuItem({ id: 'tools.copyStyle', on: 'object', order: 72, item: (api) => ({ label: 'Format kopieren', shortcut: 'Strg Alt C', sep: true, onSelect: () => copyStyle(api) }) });
defineMenuItem({
  id: 'tools.pasteStyle',
  on: 'object',
  order: 73,
  item: (api) => ({ label: 'Format einfügen', shortcut: 'Strg Alt V', disabled: !hasCopiedStyle() || allLocked(api), onSelect: () => pasteStyle(api) }),
});
defineMenuItem({ id: 'tools.copyLink', on: 'object', order: 85, item: (api) => ({ label: 'Link kopieren', sep: true, onSelect: () => void copyObjectLink(api) }) });
defineMenuItem({
  id: 'tools.exportSelection',
  on: 'object',
  order: 86,
  item: (api) => {
    const sel = api.selected();
    const frame = sel.length === 1 && typeDef(sel[0]).container;
    return { label: frame ? 'Rahmen exportieren …' : 'Als Bild exportieren …', onSelect: () => openExport(api, frame ? { area: { kind: 'frame', id: sel[0].id } } : { area: { kind: 'selection' } }) };
  },
});

// ---- Kontextmenü: leere Fläche -------------------------------------------------------------------------------------

defineMenuItem({ id: 'tools.canvasSearch', on: 'canvas', order: 40, item: () => ({ label: 'Auf dem Board suchen', shortcut: 'Strg F', sep: true, onSelect: openSearch }) });
defineMenuItem({ id: 'tools.canvasExport', on: 'canvas', order: 50, item: (api) => ({ label: 'Board exportieren …', onSelect: () => openExport(api, { area: { kind: 'board' } }) }) });
defineMenuItem({
  id: 'tools.canvasGrid',
  on: 'canvas',
  order: 60,
  item: (api) => ({ label: getSettings(api).pattern === 'none' ? 'Raster einblenden' : 'Raster ausblenden', shortcut: "Strg '", onSelect: () => toggleGrid(api) }),
});

defineMenuItem({ id: 'tools.canvasSettings', on: 'canvas', order: 65, item: (api) => ({ label: 'Hintergrund & Raster …', onSelect: () => api.openModal('tools.settings') }) });
defineMenuItem({
  id: 'tools.canvasShowHidden',
  on: 'canvas',
  order: 66,
  item: (api) => (hiddenIds(api.snapshot()).length || getPrefs().showHidden ? { label: 'Ausgeblendete zeigen', shortcut: onOff(getPrefs().showHidden), onSelect: toggleShowHidden } : null),
});
defineMenuItem({
  id: 'tools.canvasUndo',
  on: 'canvas',
  order: 70,
  item: (api) => ({ label: 'Rückgängig', shortcut: 'Strg Z', sep: true, disabled: !api.store.getHistory().canUndo, onSelect: () => api.store.undo() }),
});
defineMenuItem({ id: 'tools.canvasRedo', on: 'canvas', order: 71, item: (api) => ({ label: 'Wiederholen', shortcut: 'Strg Y', disabled: !api.store.getHistory().canRedo, onSelect: () => api.store.redo() }) });

// ---- Board-Menü („···“ neben dem Titel) --------------------------------------------------------------------------

defineMenuItem({ id: 'tools.boardSearch', on: 'board', order: 10, item: () => ({ label: 'Auf dem Board suchen', shortcut: 'Strg F', onSelect: openSearch }) });
defineMenuItem({ id: 'tools.boardExport', on: 'board', order: 20, item: (api) => ({ label: 'Exportieren …', onSelect: () => openExport(api) }) });
// Zettel abfotografieren: nur mit Server, der es anbietet (STACHEL_PHOTO_NOTES, /api/instance `photoNotes`)
defineMenuItem({
  id: 'tools.photoNotes',
  on: 'board',
  order: 22,
  item: (api) => (photoNotesAvailable() && currentBoardId() && !api.session.isLocal ? { label: 'Zettel abfotografieren …', onSelect: () => api.openModal('tools.photoNotes') } : null),
});
defineMenuItem({ id: 'tools.boardLink', on: 'board', order: 30, item: (api) => ({ label: 'Link zum Board kopieren', onSelect: () => void copyObjectLink(api, '') }) });
defineMenuItem({ id: 'tools.boardDuplicate', on: 'board', order: 32, item: (api) => (currentBoardId() ? { label: 'Board duplizieren', onSelect: () => void copyBoard(api, false) } : null) });
defineMenuItem({ id: 'tools.boardTemplate', on: 'board', order: 34, item: (api) => (currentBoardId() ? { label: 'Als Vorlage speichern', onSelect: () => void copyBoard(api, true) } : null) });
defineMenuItem({
  id: 'tools.boardGrid',
  on: 'board',
  order: 40,
  item: (api) => ({ label: 'Raster anzeigen', shortcut: onOff(getSettings(api).pattern !== 'none'), sep: true, onSelect: () => toggleGrid(api) }),
});
defineMenuItem({ id: 'tools.boardSnap', on: 'board', order: 50, item: () => ({ label: 'Am Raster einrasten', shortcut: onOff(getPrefs().snap), onSelect: () => setPrefs({ snap: !getPrefs().snap }) }) });
defineMenuItem({
  id: 'tools.boardShowHidden',
  on: 'board',
  order: 60,
  item: (api) => {
    const n = hiddenIds(api.snapshot()).length;
    if (!n && !getPrefs().showHidden) return null;
    return { label: `Ausgeblendete zeigen (${n})`, shortcut: onOff(getPrefs().showHidden), onSelect: toggleShowHidden };
  },
});
defineMenuItem({
  id: 'tools.boardShowAll',
  on: 'board',
  order: 65,
  item: (api) => (hiddenIds(api.snapshot()).length ? { label: 'Alle einblenden', onSelect: () => showAll(api) } : null),
});
defineMenuItem({ id: 'tools.boardSettings', on: 'board', order: 80, item: (api) => ({ label: 'Board-Einstellungen …', sep: true, onSelect: () => api.openModal('tools.settings') }) });
// Touch ohne Tastatur: Kürzel helfen nicht (x-mobile N1)
defineMenuItem({ id: 'tools.boardKeys', on: 'board', order: 90, item: (api) => (isTouch() ? null : { label: 'Tastenkürzel', shortcut: '?', onSelect: () => api.openModal('shortcuts') }) });

// ---- Kontextleiste: Format übertragen ------------------------------------------------------------------------------

defineContextAction({
  id: 'tools.painter',
  order: 85,
  when: (c) => !!c.single && !c.locked,
  Bar: ({ api, single }) => (
    <div className="ctx-group">
      <button
        className={`ctx-btn${painterActive() ? ' is-active' : ''}`}
        aria-label="Format übertragen"
        title="Format übertragen: danach Objekte anklicken (Strg Alt C / V)"
        onClick={() => (painterActive() ? stopPainter() : startPainter(api, single ?? undefined))}
      >
        <IconBrush size={20} />
      </button>
    </div>
  ),
});

// Einrasten am Raster: nach allen Typen (Kern und Module) einhängen
installGridSnap();

// Test-Zugriff im Entwicklungsmodus (E2E)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  void import('./export/render').then((m) => ((window as unknown as Record<string, unknown>).__stachelTools = { renderToSvg: m.renderToSvg, renderToCanvas: m.renderToCanvas }));
}
