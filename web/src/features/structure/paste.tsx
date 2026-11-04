// Einfügen auf dem Board: Tabellendaten (Excel, Google Tabellen, TSV) werden zur Tabelle bzw. zu
// Haftnotizen je Zelle, mehrzeiliger Text zu einer Haftnotiz je Zeile – nach kurzer Abfrage.
// Erweiterungspunkt ohne Kern-Änderung: ein Overlay-Slot hört `paste` am Dokument in der Capture-Phase (vor dem
// Editor) und übernimmt nur fremden Text mit mehreren Zeilen bzw. Tabs; alles andere (Bilder, Stachel-Objekte, eine
// Zeile) bleibt beim Editor.
import { useEffect } from 'react';
import type { BoardObject } from '../../protocol';
import type { Point } from '../../board/geometry';
import { parseClipboard } from '../../board/clipboard';
import { defineModal, defineSlot, typeDef } from '../../editor/ext/registry';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { Modal } from '../../ui/Modal';
import { notesCount, notesOf, pasteChoice, singleNote, tableObject, type NoteBase } from './paste-model';

export { MAX_COLS, MAX_NOTES, MAX_ROWS, notesGrid, parseTsv, pasteChoice, pasteLines, singleNote, tableObject, type PasteChoice } from './paste-model';

export const PASTE_MODAL = 'structure.paste';

// ---- Abfrage ------------------------------------------------------------------------------------------------------

interface PasteProps {
  text: string;
  at: Point;
}

function PasteDialog({ api, props, onClose }: { api: EditorApi; props: PasteProps; onClose: () => void }) {
  const choice = pasteChoice(props.text);
  if (!choice) return null;
  const { table, lines } = choice;
  const base = typeDef('sticky').create!(props.at, api) as NoteBase;
  const insert = (objs: BoardObject[]) => {
    onClose();
    if (objs.length) api.insertObjects(objs, props.at);
  };
  const nNotes = notesCount(choice);
  const asNotes = () => insert(notesOf(base, choice));
  return (
    <Modal title="Einfügen als …" onClose={onClose}>
      <p className="structure-paste__hint">
        {table ? `Tabellendaten mit ${table.length} ${table.length === 1 ? 'Zeile' : 'Zeilen'} und ${table[0].length} Spalten.` : `Text mit ${lines.length} Zeilen.`}
      </p>
      <div className="structure-paste__choices">
        {table && (
          <button className="btn btn--primary" data-autofocus onClick={() => insert([tableObject(table, props.at)])}>
            Tabelle
          </button>
        )}
        <button className={table ? 'btn btn--ghost' : 'btn btn--primary'} data-autofocus={table ? undefined : true} onClick={asNotes}>
          {nNotes} Haftnotizen
        </button>
        <button className="btn btn--ghost" onClick={() => insert([singleNote(base, props.text)])}>
          Eine Haftnotiz
        </button>
      </div>
    </Modal>
  );
}

defineModal({ id: PASTE_MODAL, Component: ({ api, props, onClose }) => <PasteDialog api={api} props={props as PasteProps} onClose={onClose} /> });

// ---- Einfügen abfangen ------------------------------------------------------------------------------------------------

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

function PasteCatcher({ api }: SlotProps) {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || isEditable(document.activeElement) || api.presenting()) return;
      const dt = e.clipboardData;
      if (!dt || [...dt.files].some((f) => f.type.startsWith('image/'))) return;
      const text = dt.getData('text/plain');
      if (!text || parseClipboard(dt.getData('text/html'), text) || !pasteChoice(text)) return;
      e.preventDefault();
      e.stopPropagation();
      api.openModal(PASTE_MODAL, { text, at: api.pointerWorld() ?? api.viewCenter() } satisfies PasteProps);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [api]);
  return null;
}

defineSlot({ id: 'structure.paste', slot: 'overlay', order: 3, Component: PasteCatcher });
