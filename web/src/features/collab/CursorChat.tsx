// Cursor-Chat: „/“ öffnet ein Feld am eigenen Mauszeiger; der Text erscheint live am Zeiger bei allen
// (Awareness `collab.chat`, nicht gespeichert). Enter schickt ab (bleibt kurz stehen), Esc verwirft.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { worldToScreen, type Point } from '../../board/geometry';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { AW_CHAT } from './model';
import { usePeers } from './ui';

/** so lange bleibt eine abgeschickte Nachricht am Zeiger stehen (ms) */
export const CHAT_LINGER = 5000;
export const CHAT_MAX = 120;

export interface ChatMsg {
  text: string;
  /** noch am Tippen */
  typing?: boolean;
}

// eigener Zustand: offen? (ein Board zur Zeit)
let open = false;
let lingerTimer = 0;
const subs = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** Kürzel „/“: Cursor-Chat öffnen (nur mit der Maus sinnvoll). */
export function openCursorChat(api: EditorApi): boolean {
  if (api.presenting() || !api.pointerWorld()) return false;
  clearTimeout(lingerTimer);
  setOpen(true);
  return true;
}

/** Overlay-Slot: eigenes Eingabefeld und die Nachrichten der anderen an ihren Zeigern. */
export function CursorChatLayer({ api, cam, width, height }: SlotProps) {
  const isOpen = useSyncExternalStore(subscribe, () => open);
  const peers = usePeers(api);
  return (
    <>
      {peers.map((p) => {
        const msg = p.extra[AW_CHAT] as ChatMsg | null | undefined;
        if (!msg?.text || !p.cursor) return null;
        const s = worldToScreen(cam, p.cursor);
        if (s.x < -200 || s.y < -60 || s.x > width + 20 || s.y > height + 20) return null;
        return (
          <div key={p.clientId} className="collab-cchat" data-chat={p.user.name} style={{ transform: `translate(${Math.round(s.x + 15)}px, ${Math.round(s.y + 17)}px)`, background: p.user.color }} aria-live="polite">
            {/* ersetzt das Namensschild des Cursors */}
            <small className="collab-cchat__name">{p.user.name}</small>
            <span className="collab-cchat__text">{msg.text}</span>
            {msg.typing && <span className="collab-cchat__dots" aria-hidden="true" />}
          </div>
        );
      })}
      {isOpen && <OwnChat api={api} />}
    </>
  );
}

function OwnChat({ api }: { api: EditorApi }) {
  const [text, setText] = useState('');
  const [at, setAt] = useState<Point>(() => api.toScreen(api.pointerWorld() ?? api.viewCenter()));
  const ref = useRef<HTMLInputElement>(null);
  const color = api.session.user.color;

  // Feld folgt dem Zeiger (Bildschirmkoordinaten des Boards)
  useEffect(() => {
    const board = document.querySelector<HTMLElement>('[data-testid="board"]');
    const move = (e: PointerEvent) => {
      if (!board) return;
      const r = board.getBoundingClientRect();
      setAt({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    window.addEventListener('pointermove', move);
    ref.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);

  const done = useRef(false);
  const send = (msg: ChatMsg | null) => api.session.setLocalField(AW_CHAT, msg);
  const close = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    setOpen(false);
    const t = text.trim();
    if (keep && t) {
      send({ text: t });
      lingerTimer = window.setTimeout(() => send(null), CHAT_LINGER);
    } else send(null);
  };

  return (
    <div className="collab-cchat collab-cchat--own" style={{ transform: `translate(${Math.round(at.x + 15)}px, ${Math.round(at.y + 17)}px)`, background: color }} onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        className="collab-cchat__input"
        aria-label="Nachricht am Mauszeiger"
        placeholder="Sag was …"
        maxLength={CHAT_MAX}
        value={text}
        size={Math.max(8, Math.min(40, text.length + 1))}
        onChange={(e) => {
          setText(e.target.value);
          send(e.target.value ? { text: e.target.value, typing: true } : null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') close(true);
          if (e.key === 'Escape') close(false);
        }}
        onBlur={() => close(true)}
      />
    </div>
  );
}
