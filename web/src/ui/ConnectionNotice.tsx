// Ladezustand und Verbindungshinweise im Editor:
// - bis zur ersten Synchronisierung „Board wird geladen …" (sperrt das Anlegen, statt „Leeres Board" zu zeigen)
// - nach einer Verbindung, die abreißt: Band oben mittig, beim Wiederverbinden „Wieder verbunden"
// - ungesicherte Änderungen: Rückfrage beim Schließen des Tabs
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import type { ConnectionStatus } from '../board/session';
import { LOCAL_ORIGIN } from '../board/store';

export interface NoticeState {
  everSynced: boolean;
  /** Verbindung nach erfolgreicher Synchronisierung verloren */
  lost: boolean;
  /** „Wieder verbunden" kurz zeigen */
  back: boolean;
}

export const INITIAL_NOTICE: NoticeState = { everSynced: false, lost: false, back: false };

export function noticeReducer(s: NoticeState, a: ConnectionStatus | 'hide-back'): NoticeState {
  if (a === 'hide-back') return s.back ? { ...s, back: false } : s;
  if (a === 'connected') return { everSynced: true, lost: false, back: s.lost };
  if (a === 'connecting' || a === 'offline') return s.everSynced && !s.lost ? { ...s, lost: true, back: false } : s;
  return { ...s, lost: false, back: false }; // local, denied
}

/** Bildschirmzustand: Laden (vor der ersten Synchronisierung), Band (Verbindung weg) oder nichts. */
export function noticeView(s: NoticeState, status: ConnectionStatus): 'loading' | 'lost' | 'back' | null {
  if (status === 'local' || status === 'denied') return null;
  if (!s.everSynced) return 'loading';
  if (s.lost) return 'lost';
  return s.back ? 'back' : null;
}

interface SessionLike {
  subscribe(fn: () => void): () => void;
  getStatus(): ConnectionStatus;
  store: { doc: Y.Doc };
  /** optional (SyncSession): echte Zahl ungesendeter Änderungen des Providers */
  hasUnsyncedChanges?: () => boolean;
}

const LOST_DELAY_MS = 1500;
const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

export function ConnectionNotice({ session }: { session: SessionLike }) {
  const status = useSyncExternalStore(session.subscribe, session.getStatus);
  const [state, dispatch] = useReducer(noticeReducer, INITIAL_NOTICE);
  useEffect(() => dispatch(status), [status]);

  // kurze Aussetzer nicht anzeigen; „Wieder verbunden" nur, wenn das Band zu sehen war
  const [showLost, setShowLost] = useState(false);
  const bannerShown = useRef(false);
  useEffect(() => {
    if (!state.lost) return setShowLost(false);
    const t = setTimeout(() => {
      bannerShown.current = true;
      setShowLost(true);
    }, LOST_DELAY_MS);
    return () => clearTimeout(t);
  }, [state.lost]);
  useEffect(() => {
    if (!state.back) return;
    if (!bannerShown.current) return dispatch('hide-back');
    bannerShown.current = false;
    const t = setTimeout(() => dispatch('hide-back'), 3200);
    return () => clearTimeout(t);
  }, [state.back]);

  // eigene Änderungen ohne Verbindung merken (Fallback, falls die Sitzung keinen Zähler hat)
  const dirty = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (status === 'connected') dirty.current = false;
  }, [status]);
  useEffect(() => {
    const doc = session.store.doc;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN && statusRef.current !== 'connected' && statusRef.current !== 'local') dirty.current = true;
    };
    doc.on('update', onUpdate);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const unsynced = session.hasUnsyncedChanges ? session.hasUnsyncedChanges() || dirty.current : dirty.current;
      if (!unsynced) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      doc.off('update', onUpdate);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [session]);

  const view = noticeView(state, status);

  // Während des Ladens keine Tastenkürzel/Einfügen aufs Board (sonst entstehen Doppelungen)
  useEffect(() => {
    if (view !== 'loading') return;
    const block = (e: Event) => {
      if (isEditable(e.target)) return;
      if (e instanceof KeyboardEvent && (e.key === 'Tab' || e.key === 'Escape')) return;
      e.stopPropagation();
      if (e.type !== 'keydown') e.preventDefault();
    };
    for (const t of ['keydown', 'paste', 'drop'] as const) window.addEventListener(t, block, true);
    return () => {
      for (const t of ['keydown', 'paste', 'drop'] as const) window.removeEventListener(t, block, true);
    };
  }, [view]);

  // nach einigen Sekunden ohne Server erklären, warum es dauert
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (view !== 'loading') return setSlow(false);
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [view]);

  if (view === 'loading')
    return (
      <div className="board-loading" data-testid="board-loading" onPointerDown={(e) => e.preventDefault()} onDoubleClick={(e) => e.preventDefault()}>
        <div className="board-loading__card" role="status" aria-live="polite">
          <span className="board-loading__spin" aria-hidden="true" />
          <span className="board-loading__text">Board wird geladen …</span>
          {(slow || status === 'offline') && <span className="board-loading__sub">Der Server antwortet noch nicht. Wir versuchen es weiter.</span>}
        </div>
      </div>
    );
  return (
    <div className="conn-notices" aria-live="polite">
      {view === 'lost' && showLost && (
        <div className="conn-banner" role="status" data-testid="conn-banner">
          <span className="conn-banner__dot" aria-hidden="true" />
          <span>
            <b>Keine Verbindung</b> – deine Änderungen werden gespeichert, sobald du wieder online bist.
          </span>
        </div>
      )}
      {view === 'back' && (
        <div className="conn-toast" role="status" data-testid="conn-back">
          Wieder verbunden
        </div>
      )}
    </div>
  );
}
