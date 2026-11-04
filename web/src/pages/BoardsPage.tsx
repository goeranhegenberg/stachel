import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TRASH_DAYS, type BoardInfo, type TrashedBoardInfo, type User } from '../protocol';
import { api, ApiError, errorText } from '../api';
import { appHref, boardHref, navigate } from '../router';
import { Wordmark } from '../ui/Logo';
import { ConfirmDialog, Modal } from '../ui/Modal';
import { IconLogout, IconMore, IconPencilSmall, IconPlus, IconRetry, IconSearch, IconTrash } from '../ui/icons';
import { relativeTime } from '../ui/time';
import { findMatch } from '../ui/search';
import { clearThumbs, loadThumb } from '../ui/thumbs';
import { initials, userColor } from '../board/colors';
import { boardActions, duplicateBoard, NewBoardDialog, ServerThumb, TemplatesSection, useThumbnailUpdates, type CardAction } from '../features/tools/overview/overview';
import { forgetInApp, rememberInApp } from './inApp';
import { FavoriteButton, setFavorite, useBoardEvents } from './boardsLive';
import { TrashSection, trashApi, UndoToast } from './trash';
import './boards.css';
import './boards-live.css';
// Modus local: Filter, Teilen, Rolle, Konto-Link, Impressum (pages/account/)
import { BoardShareDialog, OwnerFilterBar, RoleTag, shareAction, useLocalBoards } from './account/boardsLocal';
import { LegalFooter } from './account/Footer';

/** Vorschaubild: vom Server (Modul tools), sonst zuletzt gesehener Inhalt (lokal), sonst leer (Punktraster). */
function BoardThumb({ board }: { board: BoardInfo }) {
  return <ServerThumb board={board} fallback={<LocalThumb id={board.id} version={board.updatedAt} />} />;
}

function LocalThumb({ id, version }: { id: string; version: string }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => loadThumb(id), [id, version]);
  if (saved) return <img className="board-card__thumb board-card__thumb--img" src={saved} alt="" data-testid="board-thumb-img" />;
  // ohne Vorschau: leere Fläche wie ein leeres Board (keine erfundenen Notizen, die nach Inhalt aussehen)
  return <div className="board-card__thumb" aria-hidden="true" data-testid="board-thumb-empty" />;
}

const DELETE_REASON = 'Nur wer es angelegt hat oder zur Orga gehört.';

/** Aktionen-Menü einer Karte: per Maus, Touch und Tastatur (Pfeile, Pos1/Ende, Esc, Tab). */
function BoardMenu({ title, onRename, onDelete, canDelete, extra = [] }: { title: string; onRename: () => void; onDelete: () => void; canDelete: boolean; extra?: CardAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const reasonId = useId();
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const closeToButton = () => {
    setOpen(false);
    btnRef.current?.focus();
  };
  const run = (fn: () => void) => {
    // Fokus erst auf den Knopf, damit er nach dem Dialog dorthin zurückkehrt
    closeToButton();
    fn();
  };
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      closeToButton();
    }
  };

  return (
    <div className="board-menu" ref={ref}>
      <button
        ref={btnRef}
        className="board-menu__btn"
        aria-label="Board-Aktionen"
        title={`Aktionen für „${title}“`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <IconMore size={20} />
      </button>
      {open && (
        <div className="board-menu__pop" role="menu" id={menuId} aria-label={`Aktionen für „${title}“`} onKeyDown={onMenuKey}>
          <button role="menuitem" tabIndex={-1} onClick={() => run(onRename)}>
            <IconPencilSmall size={18} /> Umbenennen
          </button>
          {extra.map((a) => (
            <button key={a.label} role="menuitem" tabIndex={-1} onClick={() => run(a.onSelect)}>
              {a.icon} {a.label}
            </button>
          ))}
          <button
            role="menuitem"
            tabIndex={-1}
            className={`danger${canDelete ? '' : ' is-disabled'}`}
            aria-disabled={!canDelete || undefined}
            aria-label="Löschen"
            aria-describedby={canDelete ? undefined : reasonId}
            onClick={() => canDelete && run(onDelete)}
          >
            <IconTrash size={18} />
            <span className="board-menu__label">
              Löschen
              {!canDelete && (
                <small id={reasonId} className="board-menu__reason">
                  {DELETE_REASON}
                </small>
              )}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function TitleDialog({
  title,
  initial,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (t: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (!t) {
      setError('Bitte gib einen Namen ein.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(t.slice(0, 120));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onCancel}>
      <form onSubmit={submit} className="title-form">
        <div className="field">
          <label htmlFor="board-title">Name</label>
          <input
            id="board-title"
            className="input"
            value={value}
            maxLength={120}
            data-autofocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {error && <div className="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Text mit hervorgehobener Fundstelle. */
function Hit({ text, query }: { text: string; query: string }) {
  const m = query ? findMatch(text, query) : null;
  if (!m) return <>{text}</>;
  return (
    <>
      {text.slice(0, m[0])}
      <mark>{text.slice(m[0], m[1])}</mark>
      {text.slice(m[1])}
    </>
  );
}

type SortMode = 'recent' | 'opened' | 'name' | 'mine';
// kurz, damit vier Knöpfe auch am Handy (390 px) in eine Zeile passen; ausführlich als Name und Tooltip
const SORT_LABELS: Record<SortMode, string> = { recent: 'Geändert', opened: 'Geöffnet', name: 'Name', mine: 'Von mir' };
const SORT_NAMES: Partial<Record<SortMode, string>> = { recent: 'Zuletzt geändert', opened: 'Zuletzt geöffnet' };
const SORT_KEY = 'stachel:boards-sort';

function readSort(): SortMode {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'name' || v === 'mine' || v === 'opened' ? v : 'recent';
  } catch {
    return 'recent';
  }
}

const byName = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function arrange(list: readonly BoardInfo[], mode: SortMode, userKey: string): BoardInfo[] {
  const sorted = order(list, mode, userKey);
  // Favoriten (Stern) stehen immer oben, in der gewählten Reihenfolge
  return [...sorted.filter((b) => b.favorite), ...sorted.filter((b) => !b.favorite)];
}

function order(list: readonly BoardInfo[], mode: SortMode, userKey: string): BoardInfo[] {
  const recent = sortBoards(list);
  if (mode === 'name') return recent.sort((a, b) => byName.compare(a.title, b.title));
  if (mode === 'mine') return [...recent.filter((b) => b.createdBy === userKey), ...recent.filter((b) => b.createdBy !== userKey)];
  if (mode === 'opened') {
    const opened = recent.filter((b) => b.openedAt).sort((a, b) => (a.openedAt! < b.openedAt! ? 1 : a.openedAt! > b.openedAt! ? -1 : 0));
    return [...opened, ...recent.filter((b) => !b.openedAt)];
  }
  return recent;
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const RETRY_MS = 10_000;

type Dialog = { kind: 'create'; template?: BoardInfo } | { kind: 'rename'; board: BoardInfo } | { kind: 'delete'; board: BoardInfo } | null;

export function BoardsPage({ user, onLoggedOut }: { user: User; onLoggedOut: () => void }) {
  // angemeldet im WebView der App (Modus org)? Für den Hinweis bei abgelaufener Sitzung merken
  useEffect(() => rememberInApp(), []);
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>(readSort);
  const localMode = useLocalBoards();
  // Papierkorb (pages/trash.tsx) und „Board gelöscht · Rückgängig“
  const [trash, setTrash] = useState<TrashedBoardInfo[] | null>(null);
  const [undo, setUndo] = useState<BoardInfo | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  useThumbnailUpdates(setBoards);

  const handleAuth = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.code === 'not_logged_in') {
        onLoggedOut();
        return true;
      }
      return false;
    },
    [onLoggedOut],
  );

  const loadTrash = useCallback(() => {
    trashApi
      .list()
      .then(setTrash)
      .catch((e) => handleAuth(e));
  }, [handleAuth]);

  const load = useCallback(() => {
    loadTrash();
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    api
      .boards()
      .then((b) => {
        setBoards(sortBoards(b));
        setLoadError(null);
      })
      .catch((e) => {
        if (!handleAuth(e)) setLoadError(e instanceof ApiError ? e : new ApiError('server', 0));
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, [handleAuth, loadTrash]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [load]);

  // Live: neue, umbenannte und gelöschte Boards anderer erscheinen ohne Neuladen (Server-Sent Events)
  useBoardEvents({
    reload: load,
    renamed: (id, title) => setBoards((list) => list?.map((b) => (b.id === id ? { ...b, title } : b)) ?? null),
    deleted: (id, by, byKey) => {
      setBoards((list) => list?.filter((b) => b.id !== id) ?? null);
      setDialog((d) => {
        // eigenes Löschen: die Meldung kommt oft vor der Antwort an, dafür gibt es den Rückgängig-Hinweis
        if (d?.kind === 'delete' && byKey === user.key) return d;
        if (d && d.kind !== 'create' && d.board.id === id) {
          setActionError(`„${d.board.title}“ wurde gerade${by ? ` von ${by}` : ''} in den Papierkorb verschoben.`);
          return null;
        }
        return d;
      });
    },
  });

  // Netzfehler: alle 10 s still neu versuchen, solange das Fenster sichtbar ist
  const errorCode = loadError?.code;
  useEffect(() => {
    if (errorCode !== 'network') return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, RETRY_MS);
    return () => clearInterval(t);
  }, [errorCode, load]);

  // Strg+K oder „/" springt in die Suche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      if (ctrlK || (e.key === '/' && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        if (!searchRef.current) return;
        e.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  const chooseSort = (m: SortMode) => {
    setSort(m);
    try {
      localStorage.setItem(SORT_KEY, m);
    } catch {
      /* egal */
    }
  };

  const visible = useMemo(() => {
    if (!boards) return [];
    const q = query.trim();
    const list = q ? boards.filter((b) => findMatch(b.title, q) || findMatch(b.createdByName, q)) : boards;
    return arrange(
      localMode.apply(
        list.filter((b) => !b.template),
        user.key,
      ),
      sort,
      user.key,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, query, sort, user.key, localMode.filter]);
  const templates = useMemo(() => (boards ?? []).filter((b) => b.template).sort((a, b) => byName.compare(a.title, b.title)), [boards]);

  /** Duplizieren / als Vorlage speichern (Modul tools): Kopie erscheint oben in der Liste. */
  const copyBoard = async (b: BoardInfo, template: boolean) => {
    try {
      const copy = await duplicateBoard(b.id, { template });
      setBoards((list) => (list ? sortBoards([copy, ...list]) : list));
    } catch (e) {
      if (!handleAuth(e)) setActionError(errorText(e));
    }
  };
  const cardMenu = (b: BoardInfo) => (
    <BoardMenu
      title={b.title}
      canDelete={user.isOrga || b.createdBy === user.key}
      onRename={() => setDialog({ kind: 'rename', board: b })}
      onDelete={() => setDialog({ kind: 'delete', board: b })}
      extra={[
        ...(localMode.local ? [shareAction(() => localMode.setSharing(b))] : []),
        ...boardActions(b, {
          duplicate: () => void copyBoard(b, false),
          saveTemplate: () => void copyBoard(b, true),
          useTemplate: () => setDialog({ kind: 'create', template: b }),
          open: () => navigate(boardHref(b.id)),
        }),
      ]}
    />
  );

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* egal – lokal trotzdem abmelden */
    }
    clearThumbs();
    forgetInApp();
    onLoggedOut();
  };

  const toggleFavorite = async (b: BoardInfo) => {
    const on = !b.favorite;
    const flip = (v: boolean) => setBoards((list) => list?.map((x) => (x.id === b.id ? { ...x, favorite: v || undefined } : x)) ?? null);
    flip(on);
    try {
      await setFavorite(b.id, on);
    } catch (e) {
      flip(!on);
      if (!handleAuth(e)) setActionError(errorText(e));
    }
  };

  const confirmDelete = async (b: BoardInfo) => {
    setBusy(true);
    try {
      await api.deleteBoard(b.id);
      setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
      setDialog(null);
      setUndo(b);
      loadTrash();
    } catch (e) {
      setDialog(null);
      if (!handleAuth(e)) setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const retryBtn = (cls: string) => (
    <button className={cls} onClick={load} disabled={loading} data-testid="retry">
      <IconRetry size={18} className={loading ? 'is-spinning' : undefined} /> {loading ? 'Lädt …' : 'Nochmal versuchen'}
    </button>
  );
  const q = query.trim();

  return (
    <div className="boards">
      <header className="boards-top">
        <Wordmark size={26} inverted />
        <div className="boards-top__user">
          {!localMode.local && (
            <span className="avatar" style={{ background: userColor(user.key) }} aria-hidden="true">
              {initials(user.name)}
            </span>
          )}
          {localMode.local ? (
            <a
              className="boards-top__account"
              href={appHref('?konto=1')}
              title="Dein Konto"
              aria-label={`Dein Konto (${user.name})`}
              data-testid="account-link"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.button !== 0) return;
                e.preventDefault();
                navigate(appHref('?konto=1'));
              }}
            >
              <span className="avatar" style={{ background: userColor(user.key) }} aria-hidden="true">
                {initials(user.name)}
              </span>
              <span className="boards-top__name" data-testid="user-name">
                {user.name}
              </span>
            </a>
          ) : (
            <a
              className="boards-top__name"
              data-testid="user-name"
              href={appHref('?konto=1')}
              title="Meine Daten"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.button !== 0) return;
                e.preventDefault();
                navigate(appHref('?konto=1'));
              }}
            >
              {user.name}
              {user.isOrga && <span className="badge">Orga</span>}
            </a>
          )}
          <button className="btn btn--sm boards-top__logout" onClick={logout} aria-label="Abmelden">
            <IconLogout size={18} /> <span>Abmelden</span>
          </button>
        </div>
      </header>

      <main className="boards-main">
        <div className="boards-head">
          <div>
            <span className="boards-head__kicker">{localMode.local ? localMode.brand : (localMode.orgName ?? localMode.brand)}</span>
            <h1>Boards</h1>
          </div>
          <button className="btn btn--green boards-head__new" onClick={() => setDialog({ kind: 'create' })}>
            <IconPlus size={20} /> Neues Board
          </button>
        </div>

        {actionError && (
          <div className="alert boards-error" role="alert">
            <span>{actionError}</span>
            <button className="alert__close" onClick={() => setActionError(null)} aria-label="Hinweis schließen">
              ×
            </button>
          </div>
        )}

        {loadError && boards === null && (
          <div className="alert boards-error boards-error--load" role="alert">
            <span>
              {loadError.message}
              {loadError.code === 'network' && <small> Wir versuchen es alle 10 Sekunden von selbst.</small>}
            </span>
            {retryBtn('btn btn--sm btn--primary')}
          </div>
        )}

        {boards === null && !loadError && (
          <ul className="board-grid" aria-busy="true" aria-label="Boards werden geladen">
            {[0, 1, 2].map((i) => (
              <li key={i} className="board-card board-card--skeleton" />
            ))}
          </ul>
        )}

        {boards && boards.length === 0 && (
          <div className="boards-empty">
            <p>Noch keine Boards. Leg das erste an – zum Beispiel für die Festivalplanung.</p>
            <button className="btn btn--primary" onClick={() => setDialog({ kind: 'create' })}>
              <IconPlus size={20} /> Erstes Board anlegen
            </button>
          </div>
        )}

        {boards && boards.length > 0 && (
          <>
            <TemplatesSection templates={templates} onUse={(t) => setDialog({ kind: 'create', template: t })} menu={cardMenu} />
            <div className="boards-tools">
              <label className="boards-search">
                <IconSearch size={20} />
                <span className="sr-only">Boards durchsuchen</span>
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="Boards durchsuchen"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && query) {
                      e.preventDefault();
                      setQuery('');
                    }
                  }}
                  enterKeyHint="search"
                  autoComplete="off"
                  spellCheck={false}
                />
                <kbd className="boards-search__kbd" aria-hidden="true">
                  Strg K
                </kbd>
              </label>
              {localMode.local && <OwnerFilterBar value={localMode.filter} onChange={localMode.setFilter} />}
              <div className="seg" role="radiogroup" aria-label="Reihenfolge">
                {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                  <button key={m} role="radio" aria-checked={sort === m} aria-label={SORT_NAMES[m]} title={SORT_NAMES[m]} className={`seg__btn${sort === m ? ' is-active' : ''}`} onClick={() => chooseSort(m)}>
                    {SORT_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            {loadError && (
              <p className="boards-stale" role="status">
                Liste gerade nicht aktuell: {loadError.message} {retryBtn('boards-stale__retry')}
              </p>
            )}

            <p className="sr-only" role="status">
              {q ? `${visible.length} von ${boards.length} Boards` : ''}
            </p>

            {visible.length === 0 && !q ? (
              <p className="boards-stale">
                {localMode.filter === 'shared'
                  ? 'Noch hat niemand ein Board mit dir geteilt.'
                  : localMode.filter === 'favorites'
                    ? 'Noch keine Favoriten – markiere Boards mit dem Stern.'
                    : 'Noch keine Boards – leg eins an oder starte mit einer Vorlage.'}
              </p>
            ) : visible.length === 0 ? (
              <div className="boards-nohit" data-testid="no-hit">
                <p>
                  Kein Board passt zu „<b>{q}</b>“.
                </p>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  Suche löschen
                </button>
              </div>
            ) : (
              <ul className="board-grid">
                {visible.map((b, i) => (
                  <li key={b.id} className="board-card" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
                    <a
                      className="board-card__link"
                      href={boardHref(b.id)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
                        e.preventDefault();
                        navigate(boardHref(b.id));
                      }}
                    >
                      <BoardThumb board={b} />
                      <span className="board-card__title">
                        <Hit text={b.title} query={q} />
                      </span>
                      <span className="board-card__meta">
                        {sort === 'opened' && b.openedAt ? `Geöffnet ${relativeTime(b.openedAt)}` : `Geändert ${relativeTime(b.updatedAt)}`} · von <Hit text={b.createdByName} query={q} />
                        <RoleTag board={b} />
                      </span>
                    </a>
                    <FavoriteButton board={b} onToggle={() => void toggleFavorite(b)} />
                    {cardMenu(b)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {boards && (
          <TrashSection
            items={trash}
            onChanged={load}
            onError={(e) => {
              if (!handleAuth(e)) setActionError(errorText(e));
            }}
          />
        )}
      </main>
      <LegalFooter />
      {localMode.sharing && <BoardShareDialog board={localMode.sharing} me={user.key} onClose={() => localMode.setSharing(null)} onChanged={load} />}

      {dialog?.kind === 'create' && (
        <NewBoardDialog
          templates={templates}
          initialTemplate={dialog.template}
          onCancel={() => setDialog(null)}
          onCreate={async (t, templateId) => {
            const b = templateId ? await duplicateBoard(templateId, { title: t }) : await api.createBoard(t);
            navigate(boardHref(b.id));
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <TitleDialog
          title="Umbenennen"
          initial={dialog.board.title}
          confirmLabel="Speichern"
          onCancel={() => setDialog(null)}
          onSubmit={async (t) => {
            const { titleSeq: _seq, ...b } = await api.renameBoard(dialog.board.id, t);
            setBoards((list) => sortBoards(list?.map((x) => (x.id === b.id ? { ...x, ...b } : x)) ?? []));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Board löschen?"
          text={<>„{dialog.board.title}“ kommt für alle in den Papierkorb. Dort lässt es sich {TRASH_DAYS} Tage lang wiederherstellen, danach wird es endgültig gelöscht.</>}
          confirmLabel="In den Papierkorb"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => confirmDelete(dialog.board)}
        />
      )}
      {undo && (
        <UndoToast
          key={undo.id}
          board={undo}
          onClose={() => setUndo(null)}
          onUndo={async () => {
            try {
              await trashApi.restore(undo.id);
            } catch (e) {
              if (!handleAuth(e)) setActionError(errorText(e));
            }
            setUndo(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function sortBoards(b: readonly BoardInfo[]) {
  return [...b].sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0));
}
