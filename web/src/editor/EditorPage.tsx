import { createElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from '../protocol';
import { api, ApiError, errorText } from '../api';
import { appHref, navigate } from '../router';
import { LocalSession, SyncSession, type BoardSession, type ConnectionStatus, type Peer } from '../board/session';
import { initials } from '../board/colors';
import { StachelMark } from '../ui/Logo';
import { IconArrowLeft } from '../ui/icons';
import { ConnectionNotice } from '../ui/ConnectionNotice';
import { useThumbCapture } from '../ui/thumbs';
import { Editor, type EditorHandle } from './Editor';
import { seedDemo, seedMany } from './demo';
import * as registry from './ext/registry';
import { useSessionOverride } from './ext/sessionOverride';
import { textEngine } from './text/engine';
import { rememberInApp } from '../pages/inApp';
import { TrashNotice } from '../pages/trash';
import { isLocal } from '../instance';

/**
 * Wartet auf nachgeladenen Code der Text-Engine (Tiptap). Die Seite baut die Sync-Verbindung schon vorher auf, zeigt
 * den Editor aber erst danach: sonst ginge das erste Tippen in die statische Anzeige und Zeichen verloren.
 */
export const editorReady = (): Promise<unknown> => textEngine().ready ?? Promise.resolve();
let textLoaded = false;
void editorReady()
  .catch(() => {})
  .then(() => (textLoaded = true));

type Props = { offline: true; demo: boolean; user: User; boardId?: undefined; onLoggedOut?: undefined } | { offline?: false; demo?: undefined; boardId: string; user: User; onLoggedOut: () => void };

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Verbinde …',
  offline: 'Offline',
  local: 'Lokal',
  denied: 'Kein Zugriff',
};
const STATUS_TIP: Record<ConnectionStatus, string> = {
  connected: 'Verbunden – alle sehen Änderungen sofort.',
  connecting: 'Verbindung wird aufgebaut …',
  offline: 'Keine Verbindung. Du kannst weiterarbeiten, Änderungen werden nachgereicht.',
  local: 'Offline-Modus: nichts wird gespeichert oder geteilt.',
  denied: 'Der Server hat die Verbindung abgelehnt.',
};

export function EditorPage(props: Props) {
  const { user } = props;
  const [session, setSession] = useState<BoardSession | null>(null);
  const [textReady, setTextReady] = useState(textLoaded);
  useEffect(() => {
    if (textReady) return;
    let alive = true;
    void editorReady()
      .catch(() => {})
      .then(() => alive && setTextReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!props.offline) rememberInApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let s: BoardSession;
    if (props.offline) {
      const local = new LocalSession(user);
      if (props.demo) {
        seedDemo(local.store);
        local.setPeers(demoPeers());
      }
      s = local;
    } else s = new SyncSession(props.boardId, user);
    setSession(s);
    return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.offline, props.boardId, user.key]);
  if (!session || !textReady)
    return (
      <div className="splash" aria-busy="true">
        <StachelMark size={64} body="#fff" />
      </div>
    );
  return <EditorWithSession key={props.offline ? 'offline' : props.boardId} {...props} session={session} />;
}

function EditorWithSession(props: Props & { session: BoardSession }) {
  const { session } = props;
  const status = useSyncExternalStore(session.subscribe, session.getStatus);
  const peers = useSyncExternalStore(session.subscribe, session.getPeers);
  // Titel live: Umbenennungen anderer kommen über den Sync-Server (board.renamed), die höchste Nummer gewinnt
  const remoteTitle = useSyncExternalStore(session.subscribe, session.getRemoteTitle);
  const [title, setTitle] = useState(props.offline ? 'Offline-Board' : '');
  const [isTemplate, setIsTemplate] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const handle = useRef<EditorHandle | null>(null);
  // Vorschaubild für die Board-Übersicht (erst nach der ersten Synchronisierung)
  useThumbCapture(props.offline ? undefined : props.boardId, session);

  // Titel laden (Vertrag kennt nur die Liste)
  useEffect(() => {
    if (props.offline) return;
    let alive = true;
    api
      .boards(isLocal() ? props.boardId : undefined)
      .then((list) => {
        if (!alive) return;
        const b = list.find((x) => x.id === props.boardId);
        if (b) {
          setTitle(b.title);
          setIsTemplate(!!b.template);
          document.title = `${b.title} · Stachel`;
        } else setLoadError('Dieses Board gibt es nicht (mehr).');
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'not_logged_in') props.onLoggedOut?.();
        else if (!alive) return;
        // nur „gibt es nicht" sperrt das Board; Netz-/Serverfehler: Hinweis, Titel bleibt leer
        else if (e instanceof ApiError && e.code === 'not_found') setLoadError(errorText(e));
        else setToast(errorText(e));
      });
    return () => {
      alive = false;
      document.title = 'Stachel';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.boardId, props.offline]);

  // Offline: Demo-Inhalt + Test-Zugriff
  useEffect(() => {
    if (!(session instanceof LocalSession)) return;
    (window as any).__stachel = {
      store: session.store,
      session,
      seedMany: (n: number) => seedMany(session.store, n),
      getCamera: () => handle.current?.getCamera(),
      setCamera: (c: any) => handle.current?.setCamera(c),
      getSelection: () => handle.current?.getSelection(),
      api: () => handle.current?.api,
      // Register und React für E2E-Tests der Erweiterungspunkte
      ext: registry,
      h: createElement,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!remoteTitle) return;
    setTitle(remoteTitle.title);
    document.title = `${remoteTitle.title} · Stachel`;
  }, [remoteTitle]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const rename = async (t: string) => {
    const prev = title;
    setTitle(t);
    if (props.offline) return;
    try {
      const b = await api.renameBoard(props.boardId, t);
      // Antwort und Live-Meldung können sich überholen: nur übernehmen, wenn nichts Neueres gemeldet wurde
      if (typeof b.titleSeq === 'number') session.noteTitle({ title: b.title, seq: b.titleSeq });
      else document.title = `${t} · Stachel`;
    } catch (e) {
      setTitle(prev);
      setToast(errorText(e));
    }
  };

  const ready = props.offline || status === 'connected';
  // Feature-Module können vorübergehend ein anderes Dokument zeigen (Versions-Vorschau); die Live-Sitzung bleibt verbunden
  const override = useSessionOverride(session);
  const deleted = status === 'denied' && session.deniedReason === 'board_deleted';

  return (
    <>
      <Editor
        key={override?.key ?? 'live'}
        session={override?.session ?? session}
        ready={override ? true : ready}
        onToast={setToast}
        handleRef={handle}
        topLeft={
          <div className="panel tl-panel">
            <button className="tl-back" aria-label="Zur Übersicht" title="Zur Übersicht" onClick={() => navigate(appHref())}>
              <IconArrowLeft size={20} />
            </button>
            <span className="tl-mark" aria-hidden="true">
              <StachelMark size={24} body="#fff" />
            </span>
            <BoardTitle title={title} onRename={rename} />
            {isTemplate && (
              <span className="tl-badge" title="Du bearbeitest eine Vorlage – neue Boards aus dieser Vorlage übernehmen die Änderungen." data-testid="template-badge">
                Vorlage
              </span>
            )}
          </div>
        }
        topRight={
          <>
            {/* Feature-Module ersetzen die Anwesenheit per Slot 'core.presence' (collab) */}
            {!registry.slots.get('core.presence') && <Presence me={session.user} peers={peers} onJump={(p) => p.cursor && handle.current && centerCamera(handle.current, p.cursor)} />}
            <div className={`panel status status--${status}`} title={deleted ? 'Das Board liegt im Papierkorb.' : STATUS_TIP[status]} data-testid="status" role="status">
              <span className="status__dot" />
              <span className="status__text">{deleted ? 'Gelöscht' : STATUS_TEXT[status]}</span>
            </div>
          </>
        }
      />
      <ConnectionNotice session={session} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {(status === 'denied' || loadError) && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-labelledby="err-title">
            {status === 'denied' && session.deniedReason === 'no_access' ? (
              // Modus local: Board nicht (mehr) mit mir geteilt (docs/contract.md §6)
              <>
                <h2 id="err-title">Kein Zugriff</h2>
                <p>Dieses Board ist nicht (mehr) mit dir geteilt. Bitte die Person, der es gehört, dich einzuladen.</p>
                <div className="modal-actions">
                  <button className="btn btn--primary btn--sm" onClick={() => navigate(appHref())}>
                    Zur Übersicht
                  </button>
                </div>
              </>
            ) : status === 'denied' && session.deniedReason !== 'board_deleted' && session.deniedReason !== 'unknown_board' ? (
              <>
                <h2 id="err-title">Kein Zugriff</h2>
                <p>Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.</p>
                <div className="modal-actions">
                  <button className="btn btn--primary btn--sm" onClick={() => location.reload()}>
                    Neu anmelden
                  </button>
                </div>
              </>
            ) : (
              // im Papierkorb (mit Wiederherstellen), live gelöscht oder gibt es nicht (pages/trash.tsx)
              <TrashNotice boardId={props.boardId} by={session.deletedBy} me={session.user.key} fallback={loadError} />
            )}
          </div>
        </div>
      )}
    </>
  );
}


function centerCamera(h: EditorHandle, p: { x: number; y: number }) {
  const c = h.getCamera();
  h.setCamera({ ...c, x: window.innerWidth / 2 - p.x * c.z, y: window.innerHeight / 2 - p.y * c.z });
}

function BoardTitle({ title, onRename }: { title: string; onRename: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  if (!editing)
    return (
      <button className="tl-title" title="Umbenennen" data-testid="board-title" onClick={() => setEditing(true)}>
        {title || ' '}
      </button>
    );
  const commit = () => {
    setEditing(false);
    const t = value.trim().slice(0, 120);
    if (t && t !== title) onRename(t);
    else setValue(title);
  };
  return (
    <input
      className="tl-title tl-title--edit"
      autoFocus
      value={value}
      aria-label="Board-Titel"
      maxLength={120}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setValue(title);
          setEditing(false);
        }
      }}
    />
  );
}

function Presence({ me, peers, onJump }: { me: Peer['user']; peers: readonly Peer[]; onJump: (p: Peer) => void }) {
  // gleiche Person in mehreren Tabs nur einmal zeigen
  const byUser = new Map<string, Peer>();
  for (const p of peers) if (p.user.key !== me.key && !byUser.has(p.user.key)) byUser.set(p.user.key, p);
  const others = [...byUser.values()];
  const shown = others.slice(0, 4);
  const more = others.length - shown.length;
  return (
    <div className="panel presence" aria-label={`${others.length + 1} anwesend`} data-testid="presence">
      {shown.map((p) => (
        <button key={p.user.key} className="presence__av" style={{ background: p.user.color }} title={`${p.user.name} – hinspringen`} onClick={() => onJump(p)}>
          {initials(p.user.name)}
        </button>
      ))}
      {more > 0 && <span className="presence__av presence__more">+{more}</span>}
      <span className="presence__av presence__me" style={{ background: me.color }} title={`${me.name} (du)`}>
        {initials(me.name)}
      </span>
    </div>
  );
}

function demoPeers(): Peer[] {
  return [
    { clientId: 101, user: { key: 'm:12', name: 'Mara Lindner', color: '#ec4e92' }, cursor: { x: 520, y: 210 }, selection: ['demo-s4'], extra: {} },
    { clientId: 102, user: { key: 'm:31', name: 'Jonas Keller', color: '#1763b5' }, cursor: { x: 1180, y: 520 }, selection: [], extra: {} },
    { clientId: 103, user: { key: 'm:7', name: 'Ida Wolff', color: '#7aa21b' }, cursor: null, selection: [], extra: {} },
  ];
}
