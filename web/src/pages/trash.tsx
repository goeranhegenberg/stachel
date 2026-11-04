// Papierkorb (docs/contract.md §3 „Papierkorb“): Bereich in der Board-Übersicht, Rückgängig-Hinweis nach dem Löschen
// und der Hinweis im Editor, wenn ein Board im Papierkorb liegt (Link, Kurzlink, „zuletzt geöffnet“, live gelöscht).
import { useEffect, useId, useRef, useState } from 'react';
import { TRASH_DAYS, type BoardInfo, type TrashedBoardInfo } from '../protocol';
import { ApiError, ERROR_TEXT, errorText, request } from '../api';
import { appHref, navigate } from '../router';
import { ConfirmDialog } from '../ui/Modal';
import { IconChevron, IconRetry, IconTrash } from '../ui/icons';
import { relativeTime } from '../ui/time';
import { useBoardEvents } from './boardsLive';
import { fullDate, purgeText } from './trashTime';
import './trash.css';

const OPEN_KEY = 'stachel:trash-open';
/** So lange steht „Board gelöscht · Rückgängig“ unten (einige Sekunden). */
export const UNDO_MS = 8_000;
const MANAGE_REASON = 'Nur wer es angelegt oder gelöscht hat oder die Orga.';

export const trashApi = {
  list: () => request<{ boards: TrashedBoardInfo[] }>('GET', '/api/trash').then((r) => r.boards),
  info: (id: string) => request<{ board: TrashedBoardInfo }>('GET', `/api/trash/${encodeURIComponent(id)}`).then((r) => r.board),
  restore: (id: string) => request<{ board: BoardInfo }>('POST', `/api/trash/${encodeURIComponent(id)}/restore`).then((r) => r.board),
  purge: (id: string) => request<{ ok: true }>('DELETE', `/api/trash/${encodeURIComponent(id)}`),
  empty: () => request<{ purged: number }>('DELETE', '/api/trash').then((r) => r.purged),
};

const thumbUrl = (b: TrashedBoardInfo) => (b.thumbnailAt ? `/api/trash/${encodeURIComponent(b.id)}/thumbnail?v=${encodeURIComponent(b.thumbnailAt)}` : null);

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function TrashThumb({ board }: { board: TrashedBoardInfo }) {
  const url = thumbUrl(board);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="board-card__thumb trash-card__thumb" aria-hidden="true" />;
  return <img className="board-card__thumb board-card__thumb--img trash-card__thumb" src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

/**
 * Bereich „Papierkorb“ unter den Boards: aufklappbar (Zustand je Gerät), Karten mit Vorschaubild, wer wann gelöscht hat
 * und wann es endgültig verschwindet; „Wiederherstellen“, „Endgültig löschen“ (mit Bestätigung) und „Papierkorb leeren“.
 */
export function TrashSection({
  items,
  onChanged,
  onError,
}: {
  items: TrashedBoardInfo[] | null;
  /** Listen neu laden (Übersicht und Papierkorb) */
  onChanged: () => void;
  /** Fehler anzeigen bzw. Abmeldung behandeln */
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(readOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'one'; board: TrashedBoardInfo } | { kind: 'all' } | null>(null);
  const headId = useId();
  const listId = useId();
  if (!items) return null;
  const manageable = items.filter((b) => b.canManage);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      /* egal */
    }
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
      setConfirm(null);
      onChanged();
    }
  };

  return (
    <section className={`trash${open ? ' is-open' : ''}`} aria-labelledby={headId} data-testid="trash">
      <div className="trash__head">
        <h2 id={headId} className="trash__title">
          <button className="trash__toggle" aria-expanded={open} aria-controls={listId} onClick={toggle}>
            <IconTrash size={20} />
            <span>Papierkorb</span>
            <span className="trash__count" data-testid="trash-count">
              {items.length}
            </span>
            <IconChevron size={18} className="trash__chevron" />
          </button>
        </h2>
        {open && manageable.length > 0 && (
          <button className="btn btn--ghost btn--sm trash__empty-btn" onClick={() => setConfirm({ kind: 'all' })} disabled={!!busy}>
            Papierkorb leeren
          </button>
        )}
      </div>
      {open && (
        <div id={listId}>
          <p className="trash__hint">Gelöschte Boards bleiben {TRASH_DAYS} Tage hier, danach werden sie endgültig gelöscht – samt Bildern.</p>
          {items.length === 0 ? (
            <p className="trash__none">Der Papierkorb ist leer.</p>
          ) : (
            <ul className="trash__grid">
              {items.map((b) => (
                <li key={b.id} className="trash-card" data-testid="trash-card">
                  <TrashThumb board={b} />
                  <span className="trash-card__title">{b.title}</span>
                  <span className="trash-card__meta" title={`Gelöscht am ${fullDate(b.deletedAt)}`}>
                    Gelöscht von {b.deletedByName || 'jemandem'} · {relativeTime(b.deletedAt)}
                  </span>
                  <span className="trash-card__purge" data-testid="trash-purge" title={`Endgültig am ${fullDate(b.purgeAt)}`}>
                    {purgeText(b.purgeAt)}
                  </span>
                  <div className="trash-card__actions">
                    <button
                      className="btn btn--primary btn--sm"
                      disabled={!b.canManage || !!busy}
                      aria-label={`„${b.title}“ wiederherstellen`}
                      onClick={() => void run(b.id, () => trashApi.restore(b.id))}
                    >
                      <IconRetry size={16} className={busy === b.id ? 'is-spinning' : undefined} /> Wiederherstellen
                    </button>
                    <button
                      className="btn btn--ghost btn--sm trash-card__purge-btn"
                      disabled={!b.canManage || !!busy}
                      aria-label={`„${b.title}“ endgültig löschen`}
                      onClick={() => setConfirm({ kind: 'one', board: b })}
                    >
                      Endgültig löschen
                    </button>
                  </div>
                  {!b.canManage && <small className="trash-card__reason">{MANAGE_REASON}</small>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {confirm?.kind === 'one' && (
        <ConfirmDialog
          title="Endgültig löschen?"
          text={<>„{confirm.board.title}“ wird mit allen Inhalten und Bildern für alle gelöscht. Das lässt sich nicht rückgängig machen.</>}
          confirmLabel="Endgültig löschen"
          danger
          busy={!!busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(`purge:${confirm.board.id}`, () => trashApi.purge(confirm.board.id))}
        />
      )}
      {confirm?.kind === 'all' && (
        <ConfirmDialog
          title="Papierkorb leeren?"
          text={
            manageable.length === items.length ? (
              <>{items.length === 1 ? 'Das Board im Papierkorb wird' : `Alle ${items.length} Boards im Papierkorb werden`} für alle endgültig gelöscht. Das lässt sich nicht rückgängig machen.</>
            ) : (
              <>
                {manageable.length === 1 ? 'Ein Board' : `${manageable.length} Boards`}, die du löschen darfst, {manageable.length === 1 ? 'wird' : 'werden'} endgültig gelöscht. Die übrigen bleiben liegen. Das
                lässt sich nicht rückgängig machen.
              </>
            )
          }
          confirmLabel="Endgültig löschen"
          danger
          busy={!!busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run('all', () => trashApi.empty())}
        />
      )}
    </section>
  );
}

/** „Board gelöscht · Rückgängig“ unten in der Übersicht, verschwindet nach UNDO_MS (bei Maus darüber erst danach). */
export function UndoToast({ board, onUndo, onClose }: { board: BoardInfo; onUndo: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const hover = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let left = UNDO_MS;
    const t = setInterval(() => {
      if (hover.current) return;
      left -= 250;
      if (left <= 0) closeRef.current();
    }, 250);
    return () => clearInterval(t);
  }, [board.id]);
  return (
    <div
      className="trash-toast"
      role="status"
      data-testid="undo-toast"
      onPointerEnter={() => (hover.current = true)}
      onPointerLeave={() => (hover.current = false)}
      onFocus={() => (hover.current = true)}
      onBlur={() => (hover.current = false)}
    >
      <span className="trash-toast__text">
        Board gelöscht<span className="sr-only">: „{board.title}“ liegt im Papierkorb</span>
      </span>
      <button
        className="trash-toast__undo"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onUndo();
          } finally {
            setBusy(false);
          }
        }}
      >
        Rückgängig
      </button>
      <button className="trash-toast__close" aria-label="Hinweis schließen" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

type NoticeState = { kind: 'loading' } | { kind: 'trash'; board: TrashedBoardInfo } | { kind: 'gone' } | { kind: 'restored'; by: string | null };

/**
 * Inhalt des Hinweis-Dialogs im Editor, wenn das Board nicht (mehr) offen ist: liegt es im Papierkorb, steht dort wer
 * es wann gelöscht hat, wann es endgültig verschwindet und – für Berechtigte – „Wiederherstellen“. Stellt jemand
 * anderes es wieder her, wird daraus „Board öffnen“. Sonst: „Board nicht verfügbar“.
 */
export function TrashNotice({
  boardId,
  by,
  me,
  fallback,
}: {
  boardId?: string;
  /** wer es gelöscht hat, solange das Board offen war (Stateless `board.deleted`) */
  by: { name: string; key: string } | null;
  me: string;
  /** Text für „gibt es nicht“ */
  fallback: string | null;
}) {
  const [state, setState] = useState<NoticeState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!boardId) return setState({ kind: 'gone' });
    let alive = true;
    trashApi
      .info(boardId)
      .then((board) => alive && setState({ kind: 'trash', board }))
      .catch(() => alive && setState({ kind: 'gone' }));
    return () => {
      alive = false;
    };
  }, [boardId]);

  // live: jemand stellt es wieder her bzw. löscht es endgültig
  useBoardEvents({
    reload: () => {},
    renamed: () => {},
    deleted: () => {},
    restored: (id, name) => {
      if (id === boardId) setState({ kind: 'restored', by: name || null });
    },
    purged: (id) => {
      if (id === boardId) setState({ kind: 'gone' });
    },
  });

  const mine = !!by?.key && by.key === me;
  const toList = (
    <button className={`btn btn--sm ${state.kind === 'trash' && state.board.canManage ? 'btn--ghost' : 'btn--primary'}`} autoFocus={!(state.kind === 'trash' && state.board.canManage)} onClick={() => navigate(appHref())}>
      Zur Übersicht
    </button>
  );

  if (state.kind === 'restored') {
    return (
      <div data-testid="board-restored">
        <h2 id="err-title">Board ist wieder da</h2>
        <p>{state.by ? `${state.by} hat das Board wiederhergestellt.` : 'Das Board wurde wiederhergestellt.'}</p>
        <div className="modal-actions">
          <button className="btn btn--primary btn--sm" autoFocus onClick={() => location.reload()}>
            Board öffnen
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'gone') {
    return (
      <div data-testid={by ? 'board-deleted' : 'board-missing'}>
        <h2 id="err-title">{by ? (mine ? 'Du hast dieses Board gelöscht' : `Board wurde von ${by.name} gelöscht`) : 'Board nicht verfügbar'}</h2>
        <p>{by ? 'Hier ist nichts mehr zu bearbeiten. Deine anderen Boards findest du in der Übersicht.' : (fallback ?? ERROR_TEXT.unknown_board)}</p>
        <div className="modal-actions">{toList}</div>
      </div>
    );
  }

  const heading = mine
    ? 'Du hast dieses Board in den Papierkorb verschoben'
    : by
      ? `Board wurde von ${by.name || 'jemandem'} in den Papierkorb verschoben`
      : 'Dieses Board liegt im Papierkorb';

  if (state.kind === 'loading') {
    return (
      <div data-testid="board-deleted" aria-busy="true">
        <h2 id="err-title">{by ? heading : 'Board wird geprüft …'}</h2>
        <p className="trash-notice__wait">Einen Moment …</p>
      </div>
    );
  }

  const b = state.board;
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await trashApi.restore(b.id);
      // frisch verbinden: einfachste und sicherste Art, das Board mit allem neu zu laden
      location.reload();
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError && e.code === 'forbidden' ? MANAGE_REASON : errorText(e));
    }
  };
  return (
    <div data-testid="board-deleted" className="trash-notice">
      <h2 id="err-title">{heading}</h2>
      <p>
        {mine ? 'Das ging in einem anderen Fenster. ' : ''}„{b.title}“ wurde am {fullDate(b.deletedAt)} von {b.deletedByName || 'jemandem'} gelöscht.{' '}
        <b>{purgeText(b.purgeAt)}.</b>
      </p>
      <p className="trash-notice__more">
        {b.canManage ? 'Du kannst es wiederherstellen – mit allen Inhalten, Bildern und Kommentaren.' : `Wiederherstellen kann, wer es angelegt oder gelöscht hat, oder die Orga.`}
      </p>
      {error && <div className="alert">{error}</div>}
      <div className="modal-actions">
        {toList}
        {b.canManage && (
          <button className="btn btn--primary btn--sm" autoFocus disabled={busy} onClick={() => void restore()}>
            <IconRetry size={16} className={busy ? 'is-spinning' : undefined} /> Wiederherstellen
          </button>
        )}
      </div>
    </div>
  );
}
