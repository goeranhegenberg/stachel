// Anwesenheit: Avatare oben rechts (Klick = folgen), Liste mit Status, „Alle zu mir holen“, Folgen-Modus und Status-Erkennung.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { nanoid } from 'nanoid';
import { fitRect, MAX_ZOOM, viewRect, type Rect } from '../../board/geometry';
import type { Peer } from '../../board/session';
import { initials } from '../../board/colors';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { IconChevronDown, IconEye, IconSummon } from './icons';
import { flyTo } from './common';
import { AW_FOLLOW, AW_STATUS, AW_SUMMON, AW_VIEWPORT, type PresenceStatus } from './model';
import { uiOf, uniquePeers, useCell, usePeers } from './ui';
import { currentBoardId } from '../../instance';
import { PersonActions } from '../moderation/PersonActions';

const STATUS_TEXT: Record<PresenceStatus, string> = { active: 'aktiv', idle: 'inaktiv', away: 'gleich zurück' };
/** ohne Eingabe so lange bis „inaktiv“ */
export const IDLE_MS = 2 * 60_000;
/**
 * Gnadenfrist beim Folgen: Fehlt die geführte Person kurz (WLAN-Wackler, Server-Neustart, eigene Verbindung weg),
 * läuft das Folgen weiter, sobald sie wieder da ist. Erst nach so langer Abwesenheit (bei eigener Verbindung) endet es.
 */
export const FOLLOW_GRACE_MS = 12_000;

export const statusOf = (p: Peer): PresenceStatus => {
  const s = p.extra[AW_STATUS];
  return s === 'idle' || s === 'away' ? s : 'active';
};

const isRect = (v: unknown): v is Rect => {
  const r = v as Rect | null;
  return !!r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n)) && r.w > 0 && r.h > 0;
};

/** Kamera, die den Ausschnitt `r` vollständig zeigt. */
export const cameraFor = (r: Rect, w: number, h: number) => fitRect(r, w, h, 0, MAX_ZOOM);

/** Einer Person folgen (null = aufhören); springt sofort zu ihr. */
export function follow(api: EditorApi, key: string | null) {
  const ui = uiOf(api.store);
  ui.follow.set(key);
  if (!key) return;
  const p = api.session.getPeers().find((x) => x.user.key === key);
  const v = p?.extra[AW_VIEWPORT];
  if (isRect(v)) {
    const { w, h } = api.viewSize();
    api.animateCamera(cameraFor(v, w, h), 350);
  } else if (p?.cursor) flyTo(api, p.cursor, 0);
}

export function jumpTo(api: EditorApi, p: Peer) {
  const v = p.extra[AW_VIEWPORT];
  if (p.cursor) flyTo(api, p.cursor, 0);
  else if (isRect(v)) {
    const { w, h } = api.viewSize();
    api.animateCamera(cameraFor(v, w, h), 350);
  }
}

export function summonAll(api: EditorApi) {
  const c = api.camera();
  const { w, h } = api.viewSize();
  const r = viewRect(c, w, h);
  api.session.setLocalField(AW_SUMMON, { id: nanoid(8), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, ts: Date.now() });
  api.toast('Alle werden zu dir geholt.');
}

// ---- Avatare oben rechts (ersetzt die Kern-Anzeige) ------------------------------------------------------------------

export function PresenceBar({ api }: SlotProps) {
  const ui = uiOf(api.store);
  const me = api.session.user;
  const peers = uniquePeers(usePeers(api), me.key);
  const following = useCell(ui.follow);
  const away = useCell(ui.away);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const shown = peers.slice(0, 4);
  const more = peers.length - shown.length;

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  return (
    <div className="collab-presence-wrap" ref={wrap}>
      <div className="panel presence collab-presence" aria-label={`${peers.length + 1} anwesend`} data-testid="presence">
        {shown.map((p) => {
          const st = statusOf(p);
          const on = following === p.user.key;
          return (
            <button
              key={p.user.key}
              className={`presence__av collab-presence__av is-${st}${on ? ' is-following' : ''}`}
              style={{ background: p.user.color, ['--ring' as string]: p.user.color }}
              title={on ? `${p.user.name} – nicht mehr folgen` : `${p.user.name} – hinspringen und folgen`}
              aria-pressed={on}
              onClick={() => follow(api, on ? null : p.user.key)}
            >
              {initials(p.user.name)}
              <i className={`collab-dot collab-dot--${st}`} />
            </button>
          );
        })}
        {more > 0 && (
          <button className="presence__av presence__more" title="Alle Anwesenden" onClick={() => setOpen((v) => !v)}>
            +{more}
          </button>
        )}
        <button className={`presence__av presence__me collab-presence__av is-${away ? 'away' : 'active'}`} style={{ background: me.color }} title={`${me.name} (du) – Status und Anwesende`} onClick={() => setOpen((v) => !v)}>
          {initials(me.name)}
          <i className={`collab-dot collab-dot--${away ? 'away' : 'active'}`} />
        </button>
        <button className="collab-presence__more" aria-label="Anwesende" title="Anwesende" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <IconChevronDown size={16} />
        </button>
      </div>
      {open && <PeopleMenu api={api} peers={peers} onClose={() => setOpen(false)} />}
    </div>
  );
}

function PeopleMenu({ api, peers, onClose }: { api: EditorApi; peers: Peer[]; onClose: () => void }) {
  const ui = uiOf(api.store);
  const me = api.session.user;
  const following = useCell(ui.follow);
  const away = useCell(ui.away);
  const followers = peers.filter((p) => p.extra[AW_FOLLOW] === me.key);
  return (
    <div className="collab-pop collab-people panel" role="dialog" aria-label="Anwesende">
      <div className="collab-people__head">
        <strong>Auf dem Board</strong>
        <span>{peers.length + 1}</span>
      </div>
      <div className="collab-people__me">
        <span className="collab-av collab-av--m" style={{ background: me.color }}>
          {initials(me.name)}
          <i className={`collab-dot collab-dot--${away ? 'away' : 'active'}`} />
        </span>
        <div className="collab-people__who">
          <strong>{/^du\b/i.test(me.name) ? me.name : `${me.name} (du)`}</strong>
          <span>{followers.length ? `${followers.map((f) => f.user.name.split(' ')[0]).join(', ')} ${followers.length === 1 ? 'folgt' : 'folgen'} dir` : away ? 'gleich zurück' : 'aktiv'}</span>
        </div>
        <div className="collab-seg collab-seg--dark" role="radiogroup" aria-label="Mein Status">
          <button role="radio" aria-checked={!away} className={!away ? 'is-active' : ''} onClick={() => ui.away.set(false)}>
            Da
          </button>
          <button role="radio" aria-checked={away} className={away ? 'is-active' : ''} onClick={() => ui.away.set(true)}>
            Gleich zurück
          </button>
        </div>
      </div>
      <button
        className="btn btn--green btn--sm collab-wide"
        disabled={!peers.length}
        onClick={() => {
          summonAll(api);
          onClose();
        }}
      >
        <IconSummon size={18} /> Alle zu mir holen
      </button>
      {peers.length === 0 ? (
        <p className="collab-people__empty">Gerade ist niemand sonst hier.</p>
      ) : (
        <ul className="collab-people__list">
          {peers.map((p) => {
            const st = statusOf(p);
            const on = following === p.user.key;
            const theirs = p.extra[AW_FOLLOW];
            const leader = typeof theirs === 'string' ? (theirs === me.key ? 'dir' : peers.find((x) => x.user.key === theirs)?.user.name.split(' ')[0]) : undefined;
            return (
              <li key={p.user.key}>
                <span className="collab-av collab-av--m" style={{ background: p.user.color }}>
                  {initials(p.user.name)}
                  <i className={`collab-dot collab-dot--${st}`} />
                </span>
                <div className="collab-people__who">
                  <strong>{p.user.name}</strong>
                  <span>{leader ? `folgt ${leader}` : STATUS_TEXT[st]}</span>
                  {/* Melden/Blockieren (Feature-Modul moderation); offline ohne Server nicht */}
                  {!api.session.isLocal && <PersonActions person={{ key: p.user.key, name: p.user.name }} boardId={currentBoardId()} me={me.key} onError={(m) => api.toast(m)} />}
                </div>
                <button className="collab-icon-btn" aria-label={`Zu ${p.user.name} springen`} title="Hinspringen" onClick={() => jumpTo(api, p)}>
                  <IconEye size={18} />
                </button>
                <button className={`collab-pill${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => follow(api, on ? null : p.user.key)}>
                  {on ? 'Folge ich' : 'Folgen'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---- unsichtbare Logik: Folgen, Ausschnitt senden, Herholen empfangen, Status ------------------------------------------

/** Slot (overlay, auch in der Präsentation): Folgen-Rahmen und die Awareness-Logik des Moduls. */
export function FollowLayer({ api, cam, width, height }: SlotProps) {
  const ui = uiOf(api.store);
  const me = api.session.user;
  const allPeers = usePeers(api);
  const following = useCell(ui.follow);
  const away = useCell(ui.away);
  const leader = following ? allPeers.find((p) => p.user.key === following) : undefined;
  const followers = allPeers.filter((p) => p.extra[AW_FOLLOW] === me.key);
  const lastView = useRef('');

  // eigenes Folgen in der Awareness
  useEffect(() => {
    api.session.setLocalField(AW_FOLLOW, following);
  }, [api.session, following]);

  // geführte Person ist weg → nach der Gnadenfrist aufhören (solange ich selbst verbunden bin)
  const conn = useSyncExternalStore(api.session.subscribe, api.session.getStatus);
  const online = conn === 'connected' || conn === 'local';
  const leaderName = useRef('');
  if (leader) leaderName.current = leader.user.name;
  useEffect(() => {
    if (leader) ui.followName.set(leader.user.name);
  }, [leader?.user.name, ui]);
  useEffect(() => {
    if (!following || leader || !online) return;
    const t = setTimeout(() => {
      ui.follow.set(null);
      api.toast(`${leaderName.current || 'Die Person'} ist nicht mehr auf dem Board – Folgen beendet.`);
    }, FOLLOW_GRACE_MS);
    return () => clearTimeout(t);
  }, [following, !!leader, online, ui, api]);

  // ihrem Ausschnitt folgen
  const lv = leader?.extra[AW_VIEWPORT];
  const lvKey = isRect(lv) ? `${lv.x},${lv.y},${lv.w},${lv.h}` : '';
  useEffect(() => {
    if (!following || !isRect(lv) || lvKey === lastView.current) return;
    lastView.current = lvKey;
    api.animateCamera(cameraFor(lv, width, height), 160);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, lvKey, width, height]);
  useEffect(() => {
    if (!following) lastView.current = '';
  }, [following]);

  // eigene Eingabe auf dem Board beendet das Folgen
  useEffect(() => {
    if (!following) return;
    const stop = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.board') || t.closest('.collab-layer, .collab-follow')) return;
      ui.follow.set(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.startsWith('Arrow') || e.key === ' ') ui.follow.set(null);
    };
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('wheel', stop, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', stop, true);
      window.removeEventListener('wheel', stop, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [following, ui]);

  // eigenen Ausschnitt senden, solange mir jemand folgt
  const followed = followers.length > 0;
  const sendAt = useRef(0);
  const pending = useRef(0);
  useEffect(() => {
    if (!followed) {
      api.session.setLocalField(AW_VIEWPORT, null);
      return;
    }
    const send = () => {
      sendAt.current = Date.now();
      const r = viewRect(cam, width, height);
      api.session.setLocalField(AW_VIEWPORT, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
    };
    clearTimeout(pending.current);
    const wait = 80 - (Date.now() - sendAt.current);
    if (wait <= 0) send();
    else pending.current = window.setTimeout(send, wait);
  }, [api.session, followed, cam, width, height]);
  useEffect(() => () => clearTimeout(pending.current), []);

  // „Alle zu mir holen“ von anderen
  const seen = useRef(new Map<number, string>());
  useEffect(() => {
    for (const p of allPeers) {
      const s = p.extra[AW_SUMMON] as { id?: unknown; rect?: unknown; ts?: unknown } | null | undefined;
      if (!s || typeof s.id !== 'string' || !isRect(s.rect)) continue;
      const before = seen.current.get(p.clientId);
      seen.current.set(p.clientId, s.id);
      if (before === s.id) continue;
      // erste Sicht: nur frische Aufrufe (Uhrzeiten können leicht abweichen)
      if (before === undefined && !(typeof s.ts === 'number' && Math.abs(Date.now() - s.ts) < 8000)) continue;
      ui.follow.set(null);
      api.animateCamera(cameraFor(s.rect, width, height), 450);
      api.toast(`${p.user.name} hat dich zu sich geholt.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPeers]);

  // Status: aktiv / inaktiv (keine Eingabe, Tab im Hintergrund) / gleich zurück
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let last = Date.now();
    const poke = () => {
      last = Date.now();
      setIdle(false);
    };
    const check = () => setIdle(document.hidden || Date.now() - last > IDLE_MS);
    const t = setInterval(check, 10_000);
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(ev, poke, { passive: true });
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(t);
      for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) window.removeEventListener(ev, poke);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  const status: PresenceStatus = away ? 'away' : idle ? 'idle' : 'active';
  useEffect(() => {
    api.session.setLocalField(AW_STATUS, status);
  }, [api.session, status]);

  if (!leader) return null;
  return <div className="collab-follow-frame" style={{ ['--ring' as string]: leader.user.color }} aria-hidden="true" />;
}

/** Leiste „Du folgst …“ bzw. „… folgt dir“ (in den Hinweisen oben). */
export function FollowNotice({ api }: { api: EditorApi }) {
  const ui = uiOf(api.store);
  const me = api.session.user;
  const peers = uniquePeers(usePeers(api), me.key);
  const following = useCell(ui.follow);
  const leader = following ? peers.find((p) => p.user.key === following) : undefined;
  const followers = peers.filter((p) => p.extra[AW_FOLLOW] === me.key);
  const waitingFor = useCell(ui.followName);
  // geführte Person gerade nicht erreichbar (Gnadenfrist, FOLLOW_GRACE_MS): Folgen bleibt aktiv
  if (following && !leader)
    return (
      <div className="collab-follow panel is-waiting" role="status">
        <span>
          Verbindung zu <strong>{waitingFor || 'der Person'}</strong> kurz weg – Folgen geht gleich weiter
        </span>
        <button className="btn btn--sm collab-ghost" onClick={() => ui.follow.set(null)}>
          Beenden
        </button>
      </div>
    );
  if (leader)
    return (
      <div className="collab-follow panel" role="status" style={{ ['--ring' as string]: leader.user.color }}>
        <span className="collab-av collab-av--s" style={{ background: leader.user.color }}>
          {initials(leader.user.name)}
        </span>
        <span>
          Du folgst <strong>{leader.user.name}</strong>
        </span>
        <button className="btn btn--sm collab-ghost" onClick={() => ui.follow.set(null)}>
          Beenden
        </button>
      </div>
    );
  if (!followers.length) return null;
  return (
    <div className="collab-follow collab-follow--me panel" role="status">
      <IconEye size={16} />
      <span>
        {followers.length === 1 ? (
          <>
            <strong>{followers[0].user.name}</strong> folgt dir
          </>
        ) : (
          <>
            <strong>{followers.length} Personen</strong> folgen dir
          </>
        )}
      </span>
    </div>
  );
}
