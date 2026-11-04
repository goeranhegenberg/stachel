// Privater Modus: Platzhalter fremder verdeckter Objekte und Schloss an eigenen (Welt-Ebene), Hinweisband mit Aufdecken
// und Countdown (Overlay), Start-Dialog. Docs: docs/features/private.md.
import { useEffect, useState, type CSSProperties } from 'react';
import { errorText } from '../../api';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { currentBoardId } from '../../instance';
import { Modal } from '../../ui/Modal';
import { usePeople } from '../collab/ui';
import { canModerate, countdownLeft, privateApi, useHidden, usePrivateMode, type ControlInput } from './model';
import { privateRoute } from './route';

export const START_MODAL = 'private.start';

/** Steuern mit Hinweis bei Fehlern (Server-Text). */
export async function control(api: EditorApi, input: ControlInput): Promise<boolean> {
  const boardId = currentBoardId();
  if (!boardId) return false;
  try {
    await privateApi.control(boardId, input);
    return true;
  } catch (e) {
    api.toast(errorText(e));
    return false;
  }
}

/**
 * Läuft der Modus, die eigene Ablage verbinden und die Anlege-Regel setzen (bleibt bis zum Schließen; die Regel prüft
 * den Modus selbst). Vor dem Aufdecken die Bearbeitung eines privaten Objekts beenden (sonst gingen Zeichen verloren).
 */
function useRuntime(api: EditorApi) {
  const mode = usePrivateMode(api);
  useEffect(() => {
    if (!mode.on || !api.session.openPrivate) return;
    api.session.openPrivate();
    api.store.setCreateRoute(privateRoute(api.store.doc));
  }, [api, mode.on]);
  const left = countdownLeft(mode);
  useEffect(() => {
    if (left === null || left > 1) return;
    const id = api.editingId();
    // Bearbeitung endet beim Verlassen des Textfelds (RichEdit/Text-Engine)
    if (id && api.store.isPrivate(id)) (document.activeElement as HTMLElement | null)?.blur();
  }, [api, left]);
  return mode;
}

/** Sekundentakt, solange ein Countdown läuft. */
function useTick(active: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [active]);
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Platzhalter (fremde verdeckte Objekte) und Schloss-Chips an eigenen privaten Objekten, in Weltkoordinaten. */
export function PrivateLayer({ api, cam, snap }: SlotProps) {
  const mode = usePrivateMode(api);
  const hidden = useHidden(api);
  const people = usePeople(api, []);
  if (!hidden.length && !api.store.privateIds().size) return null;
  const nameOf = (key?: string) =>
    key ? (people.find((p) => p.key === key)?.name ?? api.session.getPeers().find((p) => p.user.key === key)?.user.name) : undefined;
  const s = 1 / cam.z;
  const mine = [...api.store.privateIds()].map((id) => snap.byId.get(id)).filter((o) => !!o);
  return (
    <div className="private-layer" aria-hidden="true">
      {/* das Board ist für mich nicht leer, nur verdeckt: kein „Leeres Board“-Hinweis über den Platzhaltern */}
      {hidden.length > 0 && <style>{'.empty-hint{display:none}'}</style>}
      {hidden.map((p) => {
        const who = mode.anonymous ? undefined : nameOf(p.by);
        const style: CSSProperties = {
          transform: `translate(${p.x}px, ${p.y}px)${p.rotation ? ` rotate(${p.rotation}deg)` : ''}`,
          width: p.w,
          height: p.h,
          borderRadius: p.type === 'sticky' ? 4 : 10,
        };
        return (
          <div key={p.id} className="private-ph" data-testid="private-placeholder" data-id={p.id} style={style}>
            <span className="private-ph__label" style={{ transform: `scale(${Math.min(s, 4)})` }}>
              🔒{who ? ` ${first(who)}` : ''}
            </span>
          </div>
        );
      })}
      {mine.map((o) => (
        <span
          key={o.id}
          className="private-mine"
          data-testid="private-mine"
          style={{
            transform: `translate(${o.x + o.w}px, ${o.y}px) scale(${s}) translate(-100%, -115%)`,
          }}
        >
          🔒 Nur für dich
        </span>
      ))}
    </div>
  );
}

/** Hinweisband oben (Modus läuft) mit Aufdecken, und der Countdown für alle. Hängt die Ablage ein. */
export function PrivateBar({ api }: SlotProps) {
  const mode = useRuntime(api);
  const hidden = useHidden(api);
  useTick(mode.revealAt !== undefined); // nur neu zeichnen; die Zeit selbst frisch (sonst stimmt die erste Zahl nicht)
  const [busy, setBusy] = useState(false);
  if (!mode.on) return null;
  const left = countdownLeft(mode, Date.now());
  const mod = canModerate(api, mode);
  const mineCount = api.store.privateIds().size;
  const me = api.session.user.key === mode.by;
  const run = async (input: ControlInput) => {
    setBusy(true);
    await control(api, input);
    setBusy(false);
  };
  return (
    <>
      <div className="private-bar" role="status" data-testid="private-bar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="private-bar__icon" aria-hidden="true">
          🔒
        </span>
        <span className="private-bar__text">
          <strong>Privater Modus</strong>
          <span className="private-bar__sub">
            {me ? 'Du moderierst' : `${mode.byName ?? 'Jemand'} moderiert`} · Deine neuen Notizen sieht nur du
            {hidden.length ? ` · ${hidden.length} verdeckt` : ''}
            {mode.anonymous ? ' · anonym' : ''}
          </span>
        </span>
        {mode.ownReveal && mineCount > 0 && left === null && !mod && (
          <button className="private-bar__btn" disabled={busy} onClick={() => run({ action: 'revealOwn' })}>
            Meine aufdecken
          </button>
        )}
        {mod && left === null && (
          <>
            <button
              className="private-bar__btn private-bar__btn--main"
              data-testid="private-reveal"
              disabled={busy}
              onClick={() => run({ action: 'reveal', countdown: 3 })}
            >
              Aufdecken
            </button>
            <button className="private-bar__btn" disabled={busy} title="Ohne Countdown" onClick={() => run({ action: 'reveal', countdown: 0 })}>
              Sofort
            </button>
          </>
        )}
        {mod && left !== null && (
          <button className="private-bar__btn" disabled={busy} onClick={() => run({ action: 'cancel' })}>
            Abbrechen
          </button>
        )}
      </div>
      {left !== null && (
        <div className="private-countdown" role="timer" aria-live="assertive" data-testid="private-countdown">
          <span className="private-countdown__num">{left > 0 ? left : '✓'}</span>
          <span className="private-countdown__text">Gleich wird aufgedeckt</span>
        </div>
      )}
    </>
  );
}

/** Start-Dialog: Optionen „Namen anonym“, „Jede:r darf eigene aufdecken“. */
export function StartDialog({ api, onClose }: { api: EditorApi; onClose: () => void }) {
  const [anonymous, setAnonymous] = useState(false);
  const [ownReveal, setOwnReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    if (await control(api, { action: 'start', anonymous, ownReveal })) onClose();
    setBusy(false);
  };
  return (
    <Modal title="Privater Modus" onClose={onClose}>
      <div className="private-start">
        <p>
          Alle schreiben verdeckt: Neue Haftnotizen, Texte und Formen sieht nur, wer sie anlegt. Die anderen sehen nur, dass an einer Stelle etwas entsteht. Du
          deckst am Ende alles auf einmal auf.
        </p>
        <label className="private-start__opt">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Namen anonym (auch nach dem Aufdecken)
        </label>
        <label className="private-start__opt">
          <input type="checkbox" checked={ownReveal} onChange={(e) => setOwnReveal(e.target.checked)} /> Jede:r darf eigene Notizen vorher aufdecken
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn--primary" data-testid="private-start" disabled={busy} onClick={start}>
            Starten
          </button>
        </div>
      </div>
    </Modal>
  );
}
