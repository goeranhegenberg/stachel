// Rahmen-Liste (Navigation, Umsortieren per Ziehen, Vorschaubilder) und Präsentationsleiste (Vollbild,
// Mitlesende folgen lassen). Gehört zum Modul „structure“ (features/structure/frames/).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { BoardObject } from '../../protocol';
import { contains, objRect } from '../../board/geometry';
import { IconClose } from '../../ui/icons';
import { IconChevron, IconPlay } from './icons';
import { editorApi } from '../../features/structure/bridge';
import { framesInOrder, movePatches } from '../../features/structure/frames/order';
import { endPresentFullscreen, PRESENT_FIELD, startPresentFullscreen, takeManualExit, wantFullscreen } from '../../features/structure/frames/present';
import { BoardPreview } from '../../features/structure/preview';
import { IconBroadcast, IconFullscreen, IconGrip, IconNotes } from '../../features/structure/icons';
import { clearHandoverFrom, handoverFrom, PresentExtras } from '../../features/structure/frames/handover';
import { createPortal } from 'react-dom';

export { framesInOrder };

const noop = () => () => {};

/** Board-Schnappschuss über die Editor-API (für Vorschaubilder); ohne API leer. */
function useBoard() {
  const api = editorApi();
  const snap = useSyncExternalStore(api ? api.store.subscribe : noop, () => api?.store.getSnapshot() ?? null);
  return { api, snap };
}

function FrameThumb({ f, ordered }: { f: BoardObject; ordered: readonly BoardObject[] }) {
  const r = objRect(f);
  const inside = useMemo(() => ordered.filter((o) => o.id !== f.id && o.type !== 'frame' && contains(r, objRect(o))), [ordered, f, r.x, r.y, r.w, r.h]);
  return (
    <span className="frames-panel__thumb" aria-hidden="true">
      <BoardPreview objects={[{ ...f, title: undefined }, ...inside]} view={r} pad={0} className="frames-panel__svg" />
    </span>
  );
}

export function FramesPanel({ frames, onPick, onPresent, onClose }: { frames: BoardObject[]; onPick: (f: BoardObject) => void; onPresent: (index: number) => void; onClose: () => void }) {
  const { api, snap } = useBoard();
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  // Sprechernotizen eines Rahmens bearbeiten (Feld `notes`, nur die präsentierende Person sieht sie beim Zeigen)
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const notesFrame = notesFor ? frames.find((f) => f.id === notesFor) : undefined;
  const reorder = (from: number, to: number) => {
    if (!api) return;
    const p = movePatches(frames, from, to);
    if (!Object.keys(p).length) return;
    api.store.stopCapturing();
    api.store.updateMany(p);
    api.store.stopCapturing();
  };
  const present = (i: number) => {
    if (wantFullscreen()) startPresentFullscreen();
    onPresent(i);
  };

  /** Ziehen am Griff: Zielplatz aus der Zeigerhöhe gegenüber den Listeneinträgen. */
  const onGrip = (i: number) => (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.frames-panel__row') ?? [])];
    const mids = items.map((it) => {
      const b = it.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    const y0 = e.clientY;
    setDrag({ from: i, to: i, dy: 0 });
    const move = (ev: PointerEvent) => {
      const y = ev.clientY;
      // Platz in der Liste ohne den gezogenen Eintrag
      let to = mids.filter((m, j) => j !== i && m < y).length;
      to = Math.max(0, Math.min(frames.length - 1, to));
      setDrag({ from: i, to, dy: y - y0 });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const y = ev.clientY;
      const to = Math.max(0, Math.min(frames.length - 1, mids.filter((m, j) => j !== i && m < y).length));
      setDrag(null);
      if (ev.type === 'pointerup') reorder(i, to);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const onItemKey = (i: number) => (e: RKeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const to = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= frames.length) return;
    reorder(i, to);
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>('.frames-panel__item')[to]?.focus());
  };

  // Verschiebung der Einträge während des Ziehens (Platz für den gezogenen machen)
  const shift = (j: number) => {
    if (!drag || j === drag.from) return 0;
    if (drag.from < j && j <= drag.to) return -1;
    if (drag.to <= j && j < drag.from) return 1;
    return 0;
  };

  return (
    <div className="frames-panel panel" role="dialog" aria-label="Rahmen" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="frames-panel__head">
        <span>
          Rahmen{frames.length > 0 && <span className="frames-panel__count">{frames.length}</span>}
        </span>
        <button className="frames-panel__close" aria-label="Schließen" onClick={onClose}>
          <IconClose size={18} />
        </button>
      </div>
      {frames.length === 0 ? (
        <p className="frames-panel__empty">Noch keine Rahmen. Mit F einen Rahmen aufziehen.</p>
      ) : (
        <>
          <ol className={`frames-panel__list${drag ? ' is-dragging' : ''}`} ref={listRef}>
            {frames.map((f, i) => (
              <li
                key={f.id}
                className={`frames-panel__row${drag?.from === i ? ' is-drag' : ''}`}
                style={drag ? { transform: `translateY(${drag.from === i ? drag.dy : shift(i) * 100}${drag.from === i ? 'px' : '%'})` } : undefined}
              >
                <button className="frames-panel__grip" aria-label="Verschieben" title="Ziehen zum Umsortieren (Alt ↑/↓)" onPointerDown={onGrip(i)}>
                  <IconGrip size={16} />
                </button>
                <button className="frames-panel__item" onClick={() => onPick(f)} onKeyDown={onItemKey(i)} aria-label={`${i + 1}. ${f.title || 'Rahmen'}`}>
                  <span className="frames-panel__num">{i + 1}</span>
                  {snap && <FrameThumb f={f} ordered={snap.ordered} />}
                  <span className="frames-panel__title">{f.title || 'Rahmen'}</span>
                </button>
                <button
                  className={`frames-panel__notes${f.notes?.trim() ? ' has-notes' : ''}`}
                  aria-label={`Sprechernotizen zu ${f.title || 'Rahmen'}`}
                  aria-pressed={notesFor === f.id}
                  title="Sprechernotizen"
                  onClick={() => setNotesFor((cur) => (cur === f.id ? null : f.id))}
                >
                  <IconNotes size={16} />
                </button>
                <button className="frames-panel__play" aria-label="Ab hier zeigen" title="Ab hier präsentieren" onClick={() => present(i)}>
                  <IconPlay size={15} />
                </button>
              </li>
            ))}
          </ol>
          {notesFrame && api && (
            <label className="frames-panel__notes-label">
              Sprechernotizen · {notesFrame.title || 'Rahmen'}
              <textarea
                className="frames-panel__notes-edit"
                data-testid="frame-notes"
                placeholder="Was du zu diesem Rahmen sagen willst (sieht beim Präsentieren nur du)"
                value={notesFrame.notes ?? ''}
                maxLength={20000}
                onChange={(e) => api.store.update(notesFrame.id, { notes: e.target.value ? e.target.value : undefined })}
              />
            </label>
          )}
          <button className="frames-panel__present" onClick={() => present(0)}>
            <IconPlay size={18} /> Präsentieren
          </button>
        </>
      )}
    </div>
  );
}

export function PresentBar({ index, frames, onGo, onExit }: { index: number; frames: BoardObject[]; onGo: (i: number) => void; onExit: () => void }) {
  const f = frames[index];
  const api = editorApi();
  const [share, setShare] = useState(true);
  // übernommen von (Übergabe): clientId der vorigen Person, einmal beim Start
  const [from] = useState(() => handoverFrom());
  useEffect(() => clearHandoverFrom(), []);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const goRef = useRef(() => onGo(index));
  goRef.current = () => onGo(index);

  // Vollbild: Verlassen (z. B. Esc im Browser) beendet auch die Präsentation; Größenwechsel passt den Rahmen neu ein
  useEffect(() => {
    let was = !!document.fullscreenElement;
    const onChange = () => {
      const now = !!document.fullscreenElement;
      setFull(now);
      if (was && !now && !takeManualExit()) exitRef.current();
      was = now;
    };
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(() => goRef.current(), 120);
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('resize', onResize);
      clearTimeout(t);
      endPresentFullscreen();
    };
  }, []);

  // Andere sehen, welcher Rahmen gerade gezeigt wird, und können folgen
  useEffect(() => {
    api?.session.setLocalField(
      PRESENT_FIELD,
      share && f ? { frameId: f.id, index, total: frames.length, title: f.title || 'Rahmen', ...(from !== null ? { from } : {}) } : null,
    );
  }, [api, share, f, index, frames.length, from]);
  useEffect(() => () => api?.session.setLocalField(PRESENT_FIELD, null), [api]);

  return (
    <div className="present-bar panel" role="toolbar" aria-label="Präsentation" onPointerDown={(e) => e.stopPropagation()}>
      <button className="ctx-btn" aria-label="Vorheriger Rahmen" disabled={index <= 0} onClick={() => onGo(index - 1)}>
        <IconChevron dir="left" />
      </button>
      <span className="present-bar__pos" data-testid="present-pos">
        {index + 1} / {frames.length}
      </span>
      <span className="present-bar__title">{f?.title || 'Rahmen'}</span>
      <button className="ctx-btn" aria-label="Nächster Rahmen" disabled={index >= frames.length - 1} onClick={() => onGo(index + 1)}>
        <IconChevron dir="right" />
      </button>
      <span className="present-bar__sep" />
      <button className={`ctx-btn${share ? ' is-active' : ''}`} aria-label="Andere folgen lassen" aria-pressed={share} title={share ? 'Andere können folgen' : 'Nur für mich'} onClick={() => setShare((v) => !v)}>
        <IconBroadcast />
      </button>
      <button
        className={`ctx-btn${full ? ' is-active' : ''}`}
        aria-label="Vollbild"
        aria-pressed={full}
        title="Vollbild"
        onClick={() => (document.fullscreenElement ? endPresentFullscreen(true) : startPresentFullscreen(true))}
      >
        <IconFullscreen />
      </button>
      {api && <PresentExtras api={api} frame={f} index={index} onExit={onExit} portal={(node) => createPortal(node, document.body)} />}
      <button className="ctx-btn" aria-label="Präsentation beenden" title="Beenden (Esc)" onClick={onExit}>
        <IconClose size={18} />
      </button>
      <div className="present-bar__progress" aria-hidden="true">
        <span style={{ width: `${((index + 1) / Math.max(1, frames.length)) * 100}%` }} />
      </div>
    </div>
  );
}
