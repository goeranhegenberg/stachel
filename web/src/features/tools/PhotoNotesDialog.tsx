// „Zettel abfotografieren“ (P10, docs/features/photo-notes.md): Foto wählen (am Handy direkt die Kamera), der eigene
// Server erkennt Zettel, Farben und Text, hier abwählen und korrigieren, dann als Haftnotizen in der Anordnung wie auf
// dem Foto einfügen (ein Rückgängig-Schritt). Das Foto bleibt nur im Speicher – auch der Server legt es nicht ab.
import { useRef, useState } from 'react';
import { CSRF_HEADER, STICKY_COLORS } from '../../protocol';
import type { EditorApi } from '../../editor/ext/types';
import { Modal } from '../../ui/Modal';
import { colorName } from '../../ui/a11y';
import { isTouch } from '../../ui/touch';
import { readableInk } from '../../board/colors';
import { insertAtFreeSpot } from '../structure/templates/gallery';
import { photoNoteObjects, type PhotoNotesResult } from './photoNotes';
import { currentBoardId } from './util';

export const PHOTO_NOTES_MODAL = 'tools.photoNotes';

type Row = { on: boolean; color: string; text: string };
type Step = { kind: 'pick'; error?: string } | { kind: 'busy' } | { kind: 'review'; result: PhotoNotesResult; rows: Row[] };

/** Foto an den Server (Rohdaten); Fehlertexte kommen vom Server. */
export async function analyzePhoto(boardId: string, file: Blob): Promise<PhotoNotesResult> {
  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/photo-notes`, {
    method: 'POST',
    headers: { 'Content-Type': file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg', [CSRF_HEADER]: '1' },
    body: file,
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => null)) as (PhotoNotesResult & { ok?: boolean; message?: string }) | null;
  if (!res.ok || !data?.ok) {
    if (res.status === 413) throw new Error('Das Foto ist zu groß. Bitte ein kleineres Foto wählen.');
    throw new Error(data?.message ?? 'Das hat nicht geklappt. Bitte versuch es noch einmal.');
  }
  return data;
}

export function PhotoNotesDialog({ api, onClose }: { api: EditorApi; props: unknown; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const touch = isTouch();

  const onFile = async (file: File | undefined) => {
    const boardId = currentBoardId();
    if (!file || !boardId) return;
    setStep({ kind: 'busy' });
    try {
      const result = await analyzePhoto(boardId, file);
      setStep({ kind: 'review', result, rows: result.notes.map((n) => ({ on: true, color: n.color, text: n.text })) });
    } catch (e) {
      setStep({ kind: 'pick', error: e instanceof Error ? e.message : String(e) });
    }
  };

  const create = () => {
    if (step.kind !== 'review') return;
    const notes = step.result.notes.map((n, i) => ({ ...n, ...step.rows[i]! })).filter((n) => n.on);
    const objs = photoNoteObjects(notes);
    if (!objs.length) return;
    // wie Vorlagen: Bildmitte bzw. nächster freier Platz daneben, bei Bedarf herauszoomen
    insertAtFreeSpot(api, objs);
    api.toast(`${objs.length} ${objs.length === 1 ? 'Notiz' : 'Notizen'} angelegt.`);
    onClose();
  };

  const fileInputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden data-testid="photo-camera" onChange={(e) => void onFile(e.target.files?.[0])} />
      <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="photo-file" onChange={(e) => void onFile(e.target.files?.[0])} />
    </>
  );

  if (step.kind === 'review') {
    const { result, rows } = step;
    const chosen = rows.filter((r) => r.on).length;
    const update = (i: number, patch: Partial<Row>) => setStep({ ...step, rows: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
    return (
      <Modal title="Zettel übernehmen" onClose={onClose} labelledBy="photo-notes-title">
        <div className="photo-notes" data-testid="photo-notes-review">
          {!result.notes.length ? (
            <p className="photo-notes__hint">Keine Zettel erkannt. Am besten klappt es mit farbigen Zetteln auf heller Wand, gerade von vorn und gut beleuchtet.</p>
          ) : (
            <p className="photo-notes__hint">
              {result.notes.length} {result.notes.length === 1 ? 'Zettel' : 'Zettel'} erkannt. Abwählen, was nicht aufs Board soll, und den Text bei Bedarf korrigieren.
              {!result.ocr && ' Texterkennung ist auf diesem Server nicht verfügbar – nur Zettel und Farben.'}
            </p>
          )}
          <div className="photo-notes__photo">
            <img src={result.preview} alt="Dein Foto mit den erkannten Zetteln" />
            {result.notes.map((n, i) => (
              <span
                key={i}
                className={`photo-notes__box${rows[i]!.on ? '' : ' is-off'}`}
                style={{ left: `${(n.x / result.width) * 100}%`, top: `${(n.y / result.height) * 100}%`, width: `${(n.w / result.width) * 100}%`, height: `${(n.h / result.height) * 100}%` }}
              >
                <b>{i + 1}</b>
              </span>
            ))}
          </div>
          <ol className="photo-notes__list">
            {rows.map((r, i) => (
              <li key={i} className={r.on ? '' : 'is-off'}>
                <input type="checkbox" checked={r.on} aria-label={`Zettel ${i + 1} übernehmen`} onChange={(e) => update(i, { on: e.target.checked })} />
                <select className="photo-notes__color" value={r.color} aria-label={`Farbe von Zettel ${i + 1}`} style={{ background: r.color, color: readableInk(r.color) }} onChange={(e) => update(i, { color: e.target.value })}>
                  {[...new Set([r.color, ...STICKY_COLORS])].map((c) => (
                    <option key={c} value={c}>
                      {colorName(c)}
                    </option>
                  ))}
                </select>
                <textarea rows={2} value={r.text} placeholder="(ohne Text)" aria-label={`Text von Zettel ${i + 1}`} onChange={(e) => update(i, { text: e.target.value })} />
              </li>
            ))}
          </ol>
          <div className="modal-actions">
            <button className="btn btn--ghost" onClick={() => setStep({ kind: 'pick' })}>
              Anderes Foto
            </button>
            <button className="btn btn--primary" disabled={!chosen} onClick={create} data-testid="photo-create">
              {chosen === 1 ? '1 Notiz anlegen' : `${chosen} Notizen anlegen`}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Zettel abfotografieren" onClose={onClose} labelledBy="photo-notes-title">
      <div className="photo-notes" data-testid="photo-notes-pick">
        {fileInputs}
        {step.kind === 'busy' ? (
          <p className="photo-notes__busy" role="status">
            Zettel werden erkannt …
          </p>
        ) : (
          <>
            <p className="photo-notes__hint">
              Fotografiere eine Wand mit Klebezetteln. Stachel erkennt die einzelnen Zettel, ihre Farbe und ihren Text und legt daraus Haftnotizen an – du kannst vorher noch auswählen und korrigieren.
            </p>
            <p className="photo-notes__note">Das Foto wird nur auf unserem Server ausgewertet und danach sofort verworfen.</p>
            {step.kind === 'pick' && step.error && (
              <p className="photo-notes__error" role="alert">
                {step.error}
              </p>
            )}
            <div className="modal-actions">
              <button className="btn btn--ghost" onClick={onClose}>
                Abbrechen
              </button>
              {touch && (
                <button className="btn btn--ghost" onClick={() => gallery.current?.click()}>
                  Aus der Galerie
                </button>
              )}
              <button className="btn btn--primary" data-autofocus onClick={() => (touch ? camera.current : gallery.current)?.click()}>
                {touch ? 'Foto aufnehmen' : 'Foto auswählen'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
