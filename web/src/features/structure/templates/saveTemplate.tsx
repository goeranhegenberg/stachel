// „Auswahl als Vorlage speichern …“ (Kontextmenü auf Objekten, Paket Q2): Name eingeben, die Auswahl (mit Rahmen-Inhalt
// und Verbindern dazwischen, own.ts) landet als eigene Vorlage auf dem Server und erscheint in der Galerie unter
// „Meine Vorlagen“ – auf allen Geräten, nur für mich.
import { useState } from 'react';
import { errorText } from '../../../api';
import { defineMenuItem, defineModal } from '../../../editor/ext/registry';
import type { EditorApi } from '../../../editor/ext/types';
import { Modal } from '../../../ui/Modal';
import type { BoardObject } from '../../../protocol';
import { cleanTemplateName, MAX_OWN_NAME, saveProblem, templateFromSelection } from './own';
import { saveOwnTemplate } from './ownApi';

export const SAVE_TEMPLATE_MODAL = 'structure.saveTemplate';

/** Vorschlag für den Namen: Titel des ersten Rahmens, sonst der erste Text, sonst „Meine Vorlage“. */
export function suggestName(objs: readonly BoardObject[]): string {
  const frame = objs.find((o) => o.type === 'frame' && o.title?.trim());
  const text = frame?.title ?? objs.map((o) => o.text?.split('\n')[0]?.trim()).find((t) => !!t);
  return (text ?? 'Meine Vorlage').slice(0, MAX_OWN_NAME);
}

function SaveDialog({ api, objects, onClose }: { api: EditorApi; objects: BoardObject[]; onClose: () => void }) {
  const [name, setName] = useState(() => suggestName(objects));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(saveProblem(objects));
  const clean = cleanTemplateName(name);
  const save = async () => {
    if (!clean || busy || saveProblem(objects)) return;
    setBusy(true);
    try {
      await saveOwnTemplate(clean, objects);
      onClose();
      api.toast(`Als Vorlage „${clean}“ gespeichert. Du findest sie unter Vorlagen → Meine Vorlagen.`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Als Vorlage speichern" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="structure-save__label" htmlFor="structure-save-name">
          Name der Vorlage
        </label>
        <input id="structure-save-name" className="structure-save__input" value={name} maxLength={MAX_OWN_NAME} onChange={(e) => setName(e.target.value)} data-autofocus />
        <p className="structure-save__hint">
          {objects.length} {objects.length === 1 ? 'Objekt' : 'Objekte'}. Nur du siehst die Vorlage, auf allen deinen Geräten.
        </p>
        {error && (
          <div className="alert structure-save__error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={!clean || busy || !!saveProblem(objects)}>
            Speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}

defineModal({
  id: SAVE_TEMPLATE_MODAL,
  Component: ({ api, props, onClose }) => <SaveDialog api={api} objects={(props as { objects?: BoardObject[] } | undefined)?.objects ?? []} onClose={onClose} />,
});

defineMenuItem({
  id: 'structure.saveTemplate',
  on: 'object',
  order: 80,
  item: (api) => {
    if (!api.selection().length) return null;
    return {
      label: 'Auswahl als Vorlage speichern …',
      onSelect: () => api.openModal(SAVE_TEMPLATE_MODAL, { objects: templateFromSelection(api.snapshot(), api.selection()) }),
    };
  },
});
