// Feature-Modul „richtext“: Rich-Text in Haftnotiz, Text, Form und Verbinder-Beschriftung (Y.XmlFragment 'content', siehe docs/contract.md §4).
// Registriert sich beim Import (siehe docs/architecture.md, Tabelle „Feature-Modul → eigene Dateien“, Vertrag docs/features/richtext.md).
import './model';
import './fonts';
import './richtext.css';
import { RICH_TEXT_FIELD, RICH_TEXT_TYPES } from '../../protocol';
import { registerYField } from '../../board/store';
import { setTextEngine } from '../../editor/text/engine';
import { defineShortcut, defineSlot, shortcuts } from '../../editor/ext/registry';
import { getActive, requestLinkAll } from './active';
import { contentCodec } from './doc';
import { richEngine } from './engine';
import { FormatBarSlot } from './FormatBar';
import { WritingHints } from './Writing';
import { LinkConfirm } from './LinkConfirm';
import { allMarked, markAll, textTargets } from './ops';
import './contextActions';

setTextEngine(richEngine);
registerYField(RICH_TEXT_FIELD, contentCodec);

defineSlot({ id: 'richtext.bar', slot: 'overlay', order: 50, Component: FormatBarSlot });
defineSlot({ id: 'richtext.link', slot: 'overlay', order: 51, Component: LinkConfirm, presenting: true });
defineSlot({ id: 'richtext.writing', slot: 'overlay', order: 7, Component: WritingHints });

// Beim Schreiben übernimmt der Editor Strg B/I/U/Umschalt S (für die Textauswahl); auf dem Board gilt das Objekt.
for (const id of ['format.bold', 'format.italic', 'format.strike']) {
  const def = shortcuts.get(id);
  if (def) defineShortcut({ ...def, scope: 'board' });
}
defineShortcut({
  id: 'format.underline',
  keys: ['mod+u'],
  run: (api) => {
    const objs = textTargets(api.selected());
    if (!objs.length) return false;
    markAll(api, objs, 'underline', allMarked(objs, 'underline') ? null : {});
  },
  help: { group: 'Bearbeiten', keys: 'Strg U', label: 'Unterstrichen', order: 105 },
});
// Strg K: beim Schreiben Link für die Auswahl (ProseMirror), auf dem Board Link für den ganzen Text des Objekts
defineShortcut({
  id: 'format.link',
  keys: ['mod+k'],
  scope: 'board',
  run: (api) => {
    const sel = api.selected();
    const o = sel.length === 1 ? sel[0] : null;
    if (!o || o.locked || o.type === 'connector' || !RICH_TEXT_TYPES.includes(o.type) || !o.text?.trim()) return false;
    requestLinkAll(o.id);
    api.startEditing(o);
  },
  help: { group: 'Bearbeiten', keys: 'Strg K', label: 'Link einfügen', order: 112 },
});
defineShortcut({ id: 'format.lists', help: { group: 'Bearbeiten', keys: '- / 1. + Leertaste', label: 'Liste beginnen (beim Schreiben)', order: 114 } });
defineShortcut({ id: 'format.markdown', help: { group: 'Bearbeiten', keys: '# / > / ``` + Leertaste', label: 'Überschrift, Zitat, Code (beim Schreiben)', order: 115 } });

// Tab in einer Liste rückt ein (wie überall), sonst wie gehabt: nächste Haftnotiz
const tab = shortcuts.get('edit.tab');
if (tab?.run) {
  const base = tab.run;
  defineShortcut({
    ...tab,
    run: (api, e) => {
      const a = getActive();
      if (a && (a.editor.isActive('listItem') || a.editor.isActive('taskItem'))) return false;
      return base(api, e);
    },
  });
}
