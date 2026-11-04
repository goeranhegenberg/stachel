// Kern-Tastenkürzel (die üblichen Whiteboard-Kürzel) und die reinen Hinweise der Kürzel-Übersicht.
// Leertaste, Entf, Esc, Enter, Pfeile, Tippen, Bild ↑/↓ und die Werkzeug-Tasten steuert der Editor selbst.
import { defineShortcut } from '../ext/registry';
import type { EditorApi, ShortcutDef } from '../ext/types';

const EDIT = 'Bearbeiten';
const VIEW = 'Ansicht';

const fmt = (k: 'bold' | 'italic' | 'strike') => (api: EditorApi) => {
  const id = api.editingId();
  api.toggleFormat(id ? [id] : api.selection(), k);
};

const list: ShortcutDef[] = [
  { id: 'edit.undo', keys: ['mod+z'], run: (api) => api.store.undo(), help: { group: EDIT, keys: 'Strg Z / Strg Y', label: 'Rückgängig / Wiederholen', order: 10 } },
  { id: 'edit.redo', keys: ['mod+shift+z', 'mod+y'], run: (api) => api.store.redo() },
  { id: 'edit.clipboard', help: { group: EDIT, keys: 'Strg C / V / X', label: 'Kopieren / Einfügen / Ausschneiden', order: 20 } },
  { id: 'edit.duplicate', keys: ['mod+d'], run: (api) => api.duplicate(), help: { group: EDIT, keys: 'Strg D', label: 'Duplizieren', order: 30 } },
  { id: 'edit.lasso', help: { group: EDIT, keys: 'Strg + Ziehen', label: 'Lasso-Auswahl', order: 35 } },
  { id: 'edit.altDrag', help: { group: EDIT, keys: 'Alt + Ziehen', label: 'Kopie ziehen', order: 40 } },
  { id: 'edit.selectAll', keys: ['mod+a'], run: (api) => api.setSelection(api.snapshot().ordered.map((o) => o.id)) },
  { id: 'edit.group', keys: ['mod+g'], run: (api) => api.group(), help: { group: EDIT, keys: 'Strg G', label: 'Gruppieren', order: 50 } },
  { id: 'edit.ungroup', keys: ['mod+shift+g'], run: (api) => api.ungroup(), help: { group: EDIT, keys: 'Strg Umschalt G', label: 'Gruppierung lösen', order: 60 } },
  { id: 'edit.delete', help: { group: EDIT, keys: 'Entf', label: 'Löschen', order: 70 } },
  { id: 'edit.type', help: { group: EDIT, keys: 'Enter / Tippen', label: 'Text bearbeiten', order: 80 } },
  { id: 'edit.tab', keys: ['Tab'], scope: 'editing', run: (api, e) => api.editNext(e.shiftKey), help: { group: EDIT, keys: 'Tab', label: 'Nächste Haftnotiz (beim Schreiben)', order: 90 } },
  { id: 'format.bold', keys: ['mod+b'], scope: 'both', run: fmt('bold'), help: { group: EDIT, keys: 'Strg B / I', label: 'Fett / Kursiv', order: 100 } },
  { id: 'format.italic', keys: ['mod+i'], scope: 'both', run: fmt('italic') },
  { id: 'format.strike', keys: ['mod+shift+s'], scope: 'both', run: fmt('strike'), help: { group: EDIT, keys: 'Strg Umschalt S', label: 'Durchgestrichen', order: 110 } },

  { id: 'view.pan', help: { group: VIEW, keys: 'Leertaste + Ziehen', label: 'Ansicht verschieben', order: 10 } },
  { id: 'view.rpan', help: { group: VIEW, keys: 'Rechtsklick + Ziehen', label: 'Ansicht verschieben', order: 20 } },
  { id: 'view.wheel', help: { group: VIEW, keys: 'Rad / Strg + Rad', label: 'Zoomen (Mausrad einstellbar)', order: 30 } },
  { id: 'view.wheelPan', help: { group: VIEW, keys: 'Umschalt + Rad', label: 'Seitlich verschieben', order: 31 } },
  { id: 'view.fit', keys: ['shift+Digit1', 'shift+!'], run: (api) => api.fitAll(), help: { group: VIEW, keys: 'Umschalt 1', label: 'Alles einpassen', order: 40 } },
  { id: 'view.zoomSelection', keys: ['shift+Digit2', 'shift+"', 'shift+@'], run: (api) => api.zoomToSelection(), help: { group: VIEW, keys: 'Umschalt 2', label: 'Auf Auswahl zoomen', order: 50 } },
  { id: 'view.zoomReset', keys: ['mod+0'], run: (api) => api.zoomReset(), help: { group: VIEW, keys: 'Strg 0 / Umschalt 0', label: 'Zoom 100 %', order: 60 } },
  // Umschalt 0 (100 %); „late“, damit Tippen auf einer ausgewählten Notiz Vorrang hat (Umschalt 0 = „=“)
  { id: 'view.zoomResetShift', keys: ['shift+Digit0'], late: true, run: (api) => api.zoomReset() },
  { id: 'view.zoomIn', keys: ['mod+plus', 'mod+='], run: (api) => api.zoomStep(1) },
  { id: 'view.zoomOut', keys: ['mod+-'], run: (api) => api.zoomStep(-1) },
  // + und − auch ohne Strg; „late“, damit Tippen auf einer ausgewählten Notiz Vorrang hat
  { id: 'view.zoomInKey', keys: ['plus', '='], late: true, run: (api) => api.zoomStep(1), help: { group: VIEW, keys: '+ / −', label: 'Vergrößern / Verkleinern', order: 55 } },
  { id: 'view.zoomOutKey', keys: ['-'], late: true, run: (api) => api.zoomStep(-1) },
  { id: 'view.noSnap', help: { group: VIEW, keys: 'Alt beim Ziehen', label: 'Einrasten aus', order: 70 } },
  { id: 'view.frames', help: { group: VIEW, keys: 'Bild ↑ / Bild ↓', label: 'Vorheriger / nächster Rahmen', order: 80 } },
  { id: 'view.help', keys: ['?'], late: true, run: (api) => api.openModal('shortcuts'), help: { group: VIEW, keys: '?', label: 'Diese Übersicht', order: 90 } },
  { id: 'view.helpMod', keys: ['mod+/', 'mod+Slash'], run: (api) => api.openModal('shortcuts') },
];

for (const s of list) defineShortcut(s);
