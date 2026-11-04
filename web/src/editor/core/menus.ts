// Kern-Einträge des Kontextmenüs (Rechtsklick bzw. langes Drücken).
import { align, distribute, type AlignMode } from '../../board/ops/arrange';
import { isWholeGroup } from '../../board/ops/groups';
import { defineMenuItem } from '../ext/registry';
import type { EditorApi } from '../ext/types';
import { getWheelMode, setWheelMode } from '../interaction/wheel';
import { isTouch } from '../../ui/touch';

// leere Fläche
defineMenuItem({ id: 'canvas.paste', on: 'canvas', order: 10, item: (api, at) => ({ label: 'Einfügen', shortcut: 'Strg V', onSelect: () => void api.pasteAt(at) }) });
defineMenuItem({
  id: 'canvas.selectAll',
  on: 'canvas',
  order: 20,
  item: (api) => ({ label: 'Alles auswählen', shortcut: 'Strg A', onSelect: () => api.setSelection(api.snapshot().ordered.map((o) => o.id)) }),
});
defineMenuItem({ id: 'canvas.fit', on: 'canvas', order: 30, item: (api) => ({ label: 'Alles einpassen', shortcut: 'Umschalt 1', onSelect: api.fitAll }) });

// Objekte
const allLocked = (api: EditorApi) => api.selected().every((o) => o.locked);

defineMenuItem({ id: 'object.copy', on: 'object', order: 10, item: (api) => ({ label: 'Kopieren', shortcut: 'Strg C', onSelect: api.copySelection }) });
defineMenuItem({ id: 'object.paste', on: 'object', order: 20, item: (api, at) => ({ label: 'Einfügen', shortcut: 'Strg V', onSelect: () => void api.pasteAt(at) }) });
defineMenuItem({ id: 'object.duplicate', on: 'object', order: 30, item: (api) => ({ label: 'Duplizieren', shortcut: 'Strg D', onSelect: api.duplicate }) });
defineMenuItem({ id: 'object.front', on: 'object', order: 40, item: (api) => ({ label: 'Nach vorne', sep: true, disabled: allLocked(api), onSelect: api.bringToFront }) });
defineMenuItem({ id: 'object.back', on: 'object', order: 50, item: (api) => ({ label: 'Nach hinten', disabled: allLocked(api), onSelect: api.sendToBack }) });
defineMenuItem({ id: 'object.lock', on: 'object', order: 60, item: (api) => ({ label: allLocked(api) ? 'Entsperren' : 'Sperren', onSelect: api.toggleLock }) });
defineMenuItem({
  id: 'object.group',
  on: 'object',
  order: 70,
  item: (api) => {
    const snap = api.snapshot();
    if (isWholeGroup(api.selection(), snap.ordered, snap.byId)) return { label: 'Gruppierung lösen', shortcut: 'Strg Umschalt G', onSelect: api.ungroup };
    return { label: 'Gruppieren', shortcut: 'Strg G', disabled: api.selected().filter((o) => !o.locked).length < 2, onSelect: api.group };
  },
});
// Ausrichten (als Untermenü); ab zwei Einheiten, Verteilen ab drei
const ALIGN_ITEMS: [AlignMode, string][] = [
  ['left', 'Links'],
  ['hcenter', 'Horizontal zentriert'],
  ['right', 'Rechts'],
  ['top', 'Oben'],
  ['vcenter', 'Vertikal zentriert'],
  ['bottom', 'Unten'],
];
defineMenuItem({
  id: 'object.arrange',
  on: 'object',
  order: 75,
  item: (api) => {
    const units = api.arrangeUnits().size;
    if (units < 2) return null;
    return {
      label: 'Ausrichten',
      items: [
        ...ALIGN_ITEMS.map(([mode, label], i) => ({ label, sep: i === 3, onSelect: () => api.applyArrange((u) => align(u, mode)) })),
        { label: 'Horizontal verteilen', sep: true, disabled: units < 3, onSelect: () => api.applyArrange((u) => distribute(u, 'x')) },
        { label: 'Vertikal verteilen', disabled: units < 3, onSelect: () => api.applyArrange((u) => distribute(u, 'y')) },
      ],
    };
  },
});
defineMenuItem({ id: 'object.zoom', on: 'object', order: 80, item: (api) => ({ label: 'Auf Auswahl zoomen', shortcut: 'Umschalt 2', onSelect: api.zoomToSelection }) });
defineMenuItem({ id: 'object.delete', on: 'object', order: 100, item: (api) => ({ label: 'Löschen', shortcut: 'Entf', danger: true, sep: true, disabled: allLocked(api), onSelect: api.deleteSelection }) });

// Board-Menü: Mausrad zoomt oder schwenkt; am Touch-Gerät ohne Maus sinnlos
defineMenuItem({
  id: 'view.wheelMode',
  on: 'board',
  order: 55,
  item: () =>
    isTouch()
      ? null
      : {
          label: 'Mausrad',
          shortcut: getWheelMode() === 'zoom' ? 'Zoomen' : 'Schwenken',
          onSelect: () => setWheelMode(getWheelMode() === 'zoom' ? 'pan' : 'zoom'),
        },
});
