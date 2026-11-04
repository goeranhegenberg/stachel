// Kommentare auf dem Board: Pins (ziehbar), Thread-Popover mit Antworten, neuer Kommentar, Hinweis auf Erwähnungen.
import { useEffect, useRef, useState } from 'react';
import { worldToScreen, type Point } from '../../board/geometry';
import { isInvisible } from '../../board/types';
import type { SlotProps, EditorApi } from '../../editor/ext/types';
import { relativeTime } from '../../ui/time';
import { currentBoardId } from '../../instance';
import { userColor, initials } from '../../board/colors';
import { useY } from '../../editor/ext/hooks';
import { Avatar, Floating, flyTo, usePlacement } from './common';
import { IconClose } from '../../ui/icons';
import { IconCheck, IconCheckCircle, IconDots, IconSend } from './icons';
import { MentionInput } from './MentionInput';
import { extractMentions, splitMentions, type Person } from './mentions';
import { addReply, anchorAt, createThread, deleteMessage, deleteThread, editMessage, moveThread, setResolved, threadPos, unreadMentions, type Anchor, type CommentMsg, type Thread } from './comments';
import { readsMap, uiOf, useCell, usePeople, useThreads, type CollabUi } from './ui';

const PIN = 34;

/** Kommentar an einer Stelle beginnen (Werkzeug, Kontextmenü). */
export function startComment(api: EditorApi, at: Anchor) {
  const ui = uiOf(api.store);
  ui.openThread.set(null);
  ui.showComments.set(true);
  ui.composer.set(at);
}

/** Thread öffnen und ins Bild holen. */
export function focusThread(api: EditorApi, t: Thread) {
  const ui = uiOf(api.store);
  ui.composer.set(null);
  ui.showComments.set(true);
  if (t.resolved && ui.filter.get() === 'open') ui.filter.set('all');
  ui.openThread.set(t.id);
  const sw = api.viewSize().w;
  flyTo(api, threadPos(t, api.snapshot()), 0.4, sw > 900 ? -170 : 0);
}

/** Gelesen-Stand der Erwähnungen auf „jetzt“ setzen. */
export function markMentionsRead(api: EditorApi) {
  readsMap(api.store).set(api.session.user.key, new Date().toISOString());
}

export function useUnreadMentions(api: EditorApi, threads: readonly Thread[]) {
  const reads = useY(readsMap(api.store), (m) => m.get(api.session.user.key));
  return unreadMentions(threads, api.session.user.key, reads);
}

// ---- Slot: Pins + Popover ------------------------------------------------------------------------------------------

export function CommentLayer(p: SlotProps) {
  const { api, cam, width, height } = p;
  const ui = uiOf(api.store);
  const threads = useThreads(api);
  const people = usePeople(api, threads);
  const show = useCell(ui.showComments);
  const filter = useCell(ui.filter);
  const openId = useCell(ui.openThread);
  const composer = useCell(ui.composer);
  const unread = useUnreadMentions(api, threads);
  const unreadThreads = new Set(unread.map((u) => u.thread.id));
  const open = openId ? threads.find((t) => t.id === openId) : undefined;
  const [drag, setDrag] = useState<{ id: string; at: Point } | null>(null);

  // Stelle des offenen Threads merken (für den Entwurf, falls er gelöscht wird)
  const lastAnchor = useRef<{ id: string; at: Anchor } | null>(null);
  if (open) lastAnchor.current = { id: open.id, at: { ...threadPos(open, p.snap), objectId: open.objectId, dx: open.dx, dy: open.dy } };

  // Thread gelöscht (auch von anderen) → Popover zu; ein angefangener Antwort-Entwurf geht nicht verloren
  useEffect(() => {
    if (!openId || open) return;
    ui.openThread.set(null);
    const draft = ui.replyDraft.get();
    ui.replyDraft.set(null);
    const at = lastAnchor.current?.id === openId ? lastAnchor.current.at : null;
    if (!draft || draft.threadId !== openId || !draft.text.trim() || !at) return;
    rescueDraft(api, at, draft.text);
  }, [openId, open, ui, api]);

  // Esc und Klick daneben schließen Popover
  useEffect(() => {
    if (!openId && !composer) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal')) return;
      // im Eingabefeld entscheidet MentionInput: Esc schließt zuerst die Vorschlagsliste, nicht den ganzen Entwurf
      if ((e.target as HTMLElement | null)?.closest?.('.collab-input')) return;
      e.stopPropagation();
      ui.openThread.set(null);
      ui.composer.set(null);
    };
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('.collab-pop, .collab-pin, .collab-panel, .sidebar')) return;
      ui.openThread.set(null);
      ui.composer.set(null);
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', down, true);
    };
  }, [openId, composer, ui]);

  if (api.presenting()) return null;
  const snap = p.snap;
  const visible = threads.filter((t) => t.id === openId || (show && (filter === 'open' ? !t.resolved : filter === 'resolved' ? t.resolved : true)));

  return (
    <div className="collab-layer">
      {visible.map((t) => {
        const anchor = t.objectId ? snap.byId.get(t.objectId) : undefined;
        if (anchor && isInvisible(anchor) && t.id !== openId) return null;
        const w = drag?.id === t.id ? drag.at : threadPos(t, snap);
        const s = worldToScreen(cam, w);
        if (s.x < -PIN || s.y < -PIN * 2 || s.x > width + PIN || s.y > height + PIN) return null;
        return <Pin key={t.id} api={api} t={t} s={s} open={t.id === openId} mention={unreadThreads.has(t.id)} onDrag={(at) => setDrag(at ? { id: t.id, at } : null)} />;
      })}
      {composer && <ComposerPop api={api} at={composer} cam={cam} width={width} height={height} people={people} />}
      {open && !drag && <ThreadPop key={open.id} api={api} t={open} at={worldToScreen(cam, threadPos(open, snap))} width={width} height={height} people={people} ui={ui} />}
    </div>
  );
}

/**
 * Entwurf eines gelöschten Threads retten: als neuer Kommentar an derselben Stelle öffnen und zusätzlich in die
 * Zwischenablage legen (falls man ihn doch woanders braucht).
 */
function rescueDraft(api: EditorApi, at: Anchor, text: string) {
  const ui = uiOf(api.store);
  ui.composerText.set(text);
  ui.composer.set(at);
  ui.showComments.set(true);
  let copied = false;
  try {
    void navigator.clipboard?.writeText(text).catch(() => {});
    copied = !!navigator.clipboard;
  } catch {
    // ohne Zwischenablage bleibt der Entwurf im neuen Kommentar
  }
  api.toast(`Der Kommentar wurde gelöscht. Deine Antwort bleibt als neuer Kommentar offen${copied ? ' und liegt in der Zwischenablage' : ''}.`);
}

function Pin({ api, t, s, open, mention, onDrag }: { api: EditorApi; t: Thread; s: Point; open: boolean; mention: boolean; onDrag: (at: Point | null) => void }) {
  const ui = uiOf(api.store);
  const first = t.messages[0];
  const start = useRef<{ x: number; y: number; moved: boolean; rect: DOMRect } | null>(null);
  const replies = t.messages.length - 1;
  const label = `Kommentar von ${first.name}${replies ? `, ${replies} ${replies === 1 ? 'Antwort' : 'Antworten'}` : ''}${t.resolved ? ', erledigt' : ''}`;
  return (
    <button
      className={`collab-pin${open ? ' is-open' : ''}${t.resolved ? ' is-resolved' : ''}${mention ? ' has-mention' : ''}`}
      style={{ transform: `translate(${Math.round(s.x)}px, ${Math.round(s.y - PIN)}px)`, ['--pin' as string]: userColor(first.by) }}
      data-thread={t.id}
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, moved: false, rect: e.currentTarget.closest('.board')!.getBoundingClientRect() };
      }}
      onPointerMove={(e) => {
        const st = start.current;
        if (!st) return;
        if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 5) return;
        st.moved = true;
        onDrag(api.toWorld({ x: e.clientX - st.rect.left, y: e.clientY - st.rect.top }));
      }}
      onPointerUp={(e) => {
        const st = start.current;
        start.current = null;
        if (!st) return;
        if (st.moved) {
          const w = api.toWorld({ x: e.clientX - st.rect.left, y: e.clientY - st.rect.top });
          moveThread(api.store, t.id, anchorAt(w, api.hitTest(w)));
          onDrag(null);
          return;
        }
        ui.composer.set(null);
        ui.openThread.set(open ? null : t.id);
      }}
      onPointerCancel={() => {
        start.current = null;
        onDrag(null);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {t.resolved ? <IconCheck size={16} /> : <span>{initials(first.name)}</span>}
      {replies > 0 && !t.resolved && <i className="collab-pin__count">{replies + 1}</i>}
    </button>
  );
}

// ---- neuer Kommentar ------------------------------------------------------------------------------------------------

function ComposerPop({ api, at, cam, width, height, people }: { api: EditorApi; at: Anchor; cam: SlotProps['cam']; width: number; height: number; people: Person[] }) {
  const ui = uiOf(api.store);
  // geretteter Entwurf (rescueDraft) einmal übernehmen
  const [text, setText] = useState(() => {
    const t = ui.composerText.get();
    ui.composerText.set('');
    return t;
  });
  const pos = worldToScreen(cam, threadPos(at, api.snapshot()));
  const place = usePlacement(pos, width, height, 320);
  const me = api.session.user;
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    const id = createThread(api.store, at, me, v, extractMentions(v, people));
    ui.composer.set(null);
    ui.openThread.set(id);
  };
  return (
    <>
      <span className="collab-pin collab-pin--draft" style={{ transform: `translate(${Math.round(pos.x)}px, ${Math.round(pos.y - PIN)}px)`, ['--pin' as string]: me.color }} aria-hidden="true">
        <span>{initials(me.name)}</span>
      </span>
      <Floating className="collab-pop panel" label="Neuer Kommentar" boxRef={place.ref} style={place.style}>
        <div className="collab-compose">
          <Avatar k={me.key} name={me.name} />
          <MentionInput value={text} onChange={setText} onSubmit={submit} onCancel={() => ui.composer.set(null)} people={people} placeholder="Kommentar schreiben … @ erwähnt jemanden" label="Kommentar" autoFocus />
          <button className="collab-send" aria-label="Senden" title="Senden (Enter)" disabled={!text.trim()} onClick={submit}>
            <IconSend size={18} />
          </button>
        </div>
      </Floating>
    </>
  );
}

// ---- Thread ---------------------------------------------------------------------------------------------------------

function ThreadPop({ api, t, at, width, height, people, ui }: { api: EditorApi; t: Thread; at: Point; width: number; height: number; people: Person[]; ui: CollabUi }) {
  // Entwurf liegt im Modul-Zustand, damit er das Löschen des Threads durch andere überlebt (rescueDraft)
  const draft = useCell(ui.replyDraft);
  const reply = draft?.threadId === t.id ? draft.text : '';
  const setReply = (text: string) => ui.replyDraft.set({ threadId: t.id, text });
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const place = usePlacement(at, width, height, 340);
  const me = api.session.user;
  const listRef = useRef<HTMLDivElement>(null);
  const all: Person[] = [...people, { key: me.key, name: me.name }];
  const count = useRef(t.messages.length);

  // Erwähnungen in diesem Thread gelten als gelesen
  useEffect(() => {
    if (t.messages.some((m) => m.by !== me.key && m.mentions?.includes(me.key))) markMentionsRead(api);
  }, [api, me.key, t.messages]);
  // neue Antworten: nach unten scrollen
  useEffect(() => {
    const el = listRef.current;
    if (el && t.messages.length >= count.current) el.scrollTop = el.scrollHeight;
    count.current = t.messages.length;
  }, [t.messages.length]);

  const send = () => {
    const v = reply.trim();
    if (!v) return;
    addReply(api.store, t.id, me, v, extractMentions(v, people));
    setReply('');
  };
  const canDelete = t.createdBy === me.key;

  return (
    <Floating className="collab-pop collab-thread panel" label="Kommentar" boxRef={place.ref} style={place.style}>
      <div className="collab-thread__head">
        <span className="collab-thread__title">{t.resolved ? 'Erledigt' : 'Kommentar'}</span>
        <button
          className={`collab-icon-btn${t.resolved ? ' is-on' : ''}`}
          aria-label={t.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'}
          title={t.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'}
          aria-pressed={t.resolved}
          onClick={() => {
            setResolved(api.store, t.id, !t.resolved, me.key);
            if (!t.resolved && ui.filter.get() === 'open') ui.openThread.set(null);
          }}
        >
          <IconCheckCircle size={19} />
        </button>
        {canDelete && (
          <div className="collab-menu-wrap">
            <button className="collab-icon-btn" aria-label="Weitere Aktionen" title="Weitere Aktionen" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <IconDots size={19} />
            </button>
            {menu && (
              <div className="collab-menu" role="menu">
                <button
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    ui.replyDraft.set(null); // selbst gelöscht: nichts zu retten
                    deleteThread(api.store, t.id);
                  }}
                >
                  Thread löschen
                </button>
              </div>
            )}
          </div>
        )}
        <button className="collab-icon-btn" aria-label="Schließen" title="Schließen (Esc)" onClick={() => ui.openThread.set(null)}>
          <IconClose size={18} />
        </button>
      </div>
      <div className="collab-thread__list" ref={listRef}>
        {t.messages.map((m, i) => (
          <Message
            key={m.id}
            m={m}
            first={i === 0}
            mine={m.by === me.key}
            me={me.key}
            people={all}
            editing={editing === m.id}
            onEdit={() => setEditing(m.id)}
            onSave={(v) => {
              editMessage(api.store, t.id, m.id, v, extractMentions(v, people));
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
            onDelete={() => {
              if (i === 0) ui.replyDraft.set(null);
              deleteMessage(api.store, t.id, m.id);
            }}
            // Melden (Feature-Modul moderation, DSA Art. 16); offline ohne Server nicht
            onReport={
              api.session.isLocal || !currentBoardId()
                ? undefined
                : () => api.openModal('moderation.report', { kind: 'comment', boardId: currentBoardId(), commentId: t.id, messageId: m.id, userKey: m.by, name: m.name })
            }
          />
        ))}
      </div>
      <div className="collab-compose collab-compose--reply">
        <MentionInput value={reply} onChange={setReply} onSubmit={send} onCancel={() => ui.openThread.set(null)} people={people} placeholder={t.resolved ? 'Antworten öffnet wieder …' : 'Antworten … @ erwähnt jemanden'} label="Antwort" autoFocus />
        <button className="collab-send" aria-label="Antwort senden" title="Senden (Enter)" disabled={!reply.trim()} onClick={send}>
          <IconSend size={18} />
        </button>
      </div>
    </Floating>
  );
}

function Message(p: {
  m: CommentMsg;
  first: boolean;
  mine: boolean;
  me: string;
  people: Person[];
  editing: boolean;
  onEdit: () => void;
  onSave: (v: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  onReport?: () => void;
}) {
  const { m } = p;
  const [draft, setDraft] = useState(m.text);
  useEffect(() => setDraft(m.text), [m.text, p.editing]);
  return (
    <article className="collab-msg" data-msg={m.id}>
      <Avatar k={m.by} name={m.name} />
      <div className="collab-msg__body">
        <header>
          <strong>{m.name}</strong>
          <time dateTime={m.at} title={new Date(m.at).toLocaleString('de-DE')}>
            {relativeTime(m.at)}
            {m.edited ? ' · bearbeitet' : ''}
          </time>
        </header>
        {p.editing ? (
          <div className="collab-edit">
            <MentionInput value={draft} onChange={setDraft} onSubmit={() => draft.trim() && p.onSave(draft.trim())} onCancel={p.onCancel} people={p.people.filter((x) => x.key !== p.me)} placeholder="Text" label="Kommentar bearbeiten" autoFocus />
            <div className="collab-edit__actions">
              <button className="collab-link" onClick={p.onCancel}>
                Abbrechen
              </button>
              <button className="collab-link collab-link--strong" disabled={!draft.trim()} onClick={() => p.onSave(draft.trim())}>
                Speichern
              </button>
            </div>
          </div>
        ) : (
          <MessageText text={m.text} mentions={m.mentions} people={p.people} me={p.me} />
        )}
        {p.mine && !p.editing && (
          <div className="collab-msg__actions">
            <button className="collab-link" onClick={p.onEdit}>
              Bearbeiten
            </button>
            <button className="collab-link" onClick={p.onDelete}>
              {p.first ? 'Thread löschen' : 'Löschen'}
            </button>
          </div>
        )}
        {!p.mine && !p.editing && p.onReport && (
          <div className="collab-msg__actions">
            <button className="collab-link" onClick={p.onReport} aria-label={`Kommentar von ${m.name} melden`}>
              Melden …
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function MessageText({ text, mentions, people, me }: { text: string; mentions?: string[]; people: readonly Person[]; me: string }) {
  const keys = new Set(mentions ?? []);
  const parts = keys.size ? splitMentions(text, people.filter((x) => keys.has(x.key))) : [{ text }];
  return (
    <p className="collab-msg__text">
      {parts.map((s, i) =>
        s.key ? (
          <mark key={i} className={`collab-mention${s.key === me ? ' is-me' : ''}`}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

// ---- Hinweis „Du wurdest erwähnt“ -------------------------------------------------------------------------------------

export function MentionNotice({ api }: SlotProps) {
  const threads = useThreads(api);
  const unread = useUnreadMentions(api, threads);
  if (!unread.length || api.presenting()) return null;
  const { thread, msg } = unread[0];
  const from = [...new Set(unread.map((u) => u.msg.name))];
  return (
    <Floating className="collab-notice panel" role="status" label="Du wurdest erwähnt">
      <span className="collab-notice__icon" style={{ background: userColor(msg.by) }}>
        @
      </span>
      <div className="collab-notice__text">
        <strong>{unread.length === 1 ? 'Du wurdest erwähnt' : `Du wurdest ${unread.length}× erwähnt`}</strong>
        <span>
          {from.length === 1 ? from[0] : `${from.slice(0, -1).join(', ')} und ${from[from.length - 1]}`}: „{msg.text.length > 60 ? `${msg.text.slice(0, 59)}…` : msg.text}“
        </span>
      </div>
      <button
        className="btn btn--green btn--sm"
        onClick={() => {
          markMentionsRead(api);
          focusThread(api, thread);
        }}
      >
        Ansehen
      </button>
      <button className="collab-icon-btn" aria-label="Hinweis schließen" title="Schließen" onClick={() => markMentionsRead(api)}>
        <IconClose size={18} />
      </button>
    </Floating>
  );
}
