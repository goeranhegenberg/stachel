// Seitenleiste „Kommentare“: alle Threads mit Filter offen/erledigt/alle, nur Erwähnungen, Pins ein/aus. Knopf mit Zähler.
import { useSyncExternalStore } from 'react';
import type { SlotProps } from '../../editor/ext/types';
import { useY } from '../../editor/ext/hooks';
import { relativeTime } from '../../ui/time';
import { Avatar, typeLabel } from './common';
import { IconComment, IconCheckCircle } from './icons';
import { commentsMap, lastActivity, objectLabel, readThreads, setResolved, unreadMentions, type Thread } from './comments';
import { focusThread, MessageText } from './CommentLayer';
import { currentApi, readsMap, uiOf, useCell, usePeople, useThreads, type CommentFilter } from './ui';
import { byPointer } from '../../ui/touch';

const FILTERS: { id: CommentFilter; label: string }[] = [
  { id: 'open', label: 'Offen' },
  { id: 'resolved', label: 'Erledigt' },
  { id: 'all', label: 'Alle' },
];

export function CommentsPanel({ api, snap }: SlotProps & { onClose: () => void }) {
  const ui = uiOf(api.store);
  const threads = useThreads(api);
  const people = usePeople(api, threads);
  const filter = useCell(ui.filter);
  const show = useCell(ui.showComments);
  const openId = useCell(ui.openThread);
  const me = api.session.user;
  const all = [...people, { key: me.key, name: me.name }];
  const counts = { open: threads.filter((t) => !t.resolved).length, resolved: threads.filter((t) => t.resolved).length, all: threads.length };
  const list = threads
    .filter((t) => (filter === 'open' ? !t.resolved : filter === 'resolved' ? t.resolved : true))
    .sort((a, b) => (lastActivity(a) < lastActivity(b) ? 1 : -1));
  const mentioned = new Set(unreadMentions(threads, me.key, undefined).map((u) => u.thread.id));

  return (
    <div className="collab-panel">
      <div className="collab-seg" role="radiogroup" aria-label="Kommentare filtern">
        {FILTERS.map((f) => (
          <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? 'is-active' : ''} onClick={() => ui.filter.set(f.id)}>
            {f.label}
            <span className="collab-seg__n">{counts[f.id]}</span>
          </button>
        ))}
      </div>
      <label className="collab-switch">
        <input type="checkbox" checked={show} onChange={(e) => ui.showComments.set(e.target.checked)} />
        <span aria-hidden="true" />
        Kommentare auf dem Board zeigen
      </label>
      {list.length === 0 ? (
        <div className="collab-empty">
          <IconComment size={34} />
          <strong>{filter === 'resolved' ? 'Nichts erledigt' : 'Keine Kommentare'}</strong>
          <span>{filter === 'resolved' ? 'Erledigte Kommentare erscheinen hier.' : byPointer('Taste C oder Rechtsklick → Kommentieren.', 'Lange auf ein Objekt drücken → Kommentieren.')}</span>
        </div>
      ) : (
        <ul className="collab-list" aria-label="Kommentare">
          {list.map((t) => (
            <ThreadCard
              key={t.id}
              t={t}
              active={t.id === openId}
              label={t.objectId ? objectLabel(snap.byId.get(t.objectId), typeLabel) : 'Auf dem Board'}
              mention={mentioned.has(t.id)}
              me={me.key}
              people={all}
              onOpen={() => focusThread(api, t)}
              onResolve={() => setResolved(api.store, t.id, !t.resolved, me.key)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ThreadCard(p: { t: Thread; active: boolean; label: string; mention: boolean; me: string; people: { key: string; name: string }[]; onOpen: () => void; onResolve: () => void }) {
  const { t } = p;
  const first = t.messages[0];
  const last = t.messages[t.messages.length - 1];
  const replies = t.messages.length - 1;
  const others = [...new Map(t.messages.slice(1).map((m) => [m.by, m])).values()].slice(0, 3);
  return (
    <li className={`collab-card${p.active ? ' is-active' : ''}${t.resolved ? ' is-resolved' : ''}`}>
      <button className="collab-card__main" onClick={p.onOpen} aria-label={`Kommentar von ${first.name} öffnen`}>
        <header>
          <Avatar k={first.by} name={first.name} />
          <strong>{first.name}</strong>
          <time dateTime={last.at}>{relativeTime(lastActivity(t))}</time>
        </header>
        <MessageText text={first.text} mentions={first.mentions} people={p.people} me={p.me} />
        <footer>
          <span className="collab-card__where">{p.label}</span>
          {p.mention && <span className="collab-tag collab-tag--pink">@ du</span>}
          {replies > 0 && (
            <span className="collab-card__replies">
              <span className="collab-stack">
                {others.map((m) => (
                  <Avatar key={m.by} k={m.by} name={m.name} size="s" />
                ))}
              </span>
              {replies} {replies === 1 ? 'Antwort' : 'Antworten'}
            </span>
          )}
        </footer>
      </button>
      <button className={`collab-icon-btn collab-card__check${t.resolved ? ' is-on' : ''}`} aria-label={t.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'} title={t.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'} aria-pressed={t.resolved} onClick={p.onResolve}>
        <IconCheckCircle size={20} />
      </button>
    </li>
  );
}

/** Symbol des Seitenleisten-Knopfs mit Zähler (offene Threads; pink bei ungelesener Erwähnung). */
export function CommentsIcon({ size = 20 }: { size?: number }) {
  const api = useSyncExternalStore(currentApi.subscribe, currentApi.get);
  return (
    <span className="collab-badge-wrap">
      <IconComment size={size} />
      {api && <CommentCount api={api} />}
    </span>
  );
}

function CommentCount({ api }: { api: NonNullable<ReturnType<typeof currentApi.get>> }) {
  const open = useY(commentsMap(api.store), (m) => readThreads(m).filter((t) => !t.resolved).length);
  const threads = useThreads(api);
  const reads = useY(readsMap(api.store), (m) => m.get(api.session.user.key));
  const unread = unreadMentions(threads, api.session.user.key, reads).length;
  if (!open && !unread) return null;
  return (
    <i className={`collab-badge${unread ? ' collab-badge--pink' : ''}`} data-testid="comment-count">
      {unread ? `@${unread > 1 ? unread : ''}` : open > 99 ? '99+' : open}
    </i>
  );
}
