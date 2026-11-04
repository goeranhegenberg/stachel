// Hinweise oben mittig (gestapelt) und die Leiste oben rechts mit Timer und Abstimmung.
import { useEffect } from 'react';
import type { SlotProps } from '../../editor/ext/types';
import { MentionNotice } from './CommentLayer';
import { FollowNotice } from './Presence';
import { TimerButton, timerView, useTimer, useTimerEnd } from './TimerViews';
import { VoteBar, useCanModerate, useNow, useSession } from './VoteViews';
import { IconTimer, IconVote } from './icons';
import { stopTimer } from './timer';
import { currentApi } from './ui';

export function Notices(p: SlotProps) {
  const { api } = p;
  // Symbole ohne api-Prop (Seitenleisten-Knopf) lesen die aktuelle Sitzung hierüber
  useEffect(() => {
    currentApi.set(api);
    return () => currentApi.set(null);
  }, [api]);
  return (
    // Klicks nicht an den Editor weitergeben (er würde den Zeiger einfangen)
    <div className="collab-notices" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <VoteBar api={api} />
      <FollowNotice api={api} />
      <TimerNotice {...p} />
      <MentionNotice {...p} />
    </div>
  );
}

function TimerNotice({ api, width }: SlotProps) {
  const end = useTimerEnd(api);
  const t = useTimer(api);
  const now = useNow(t.state === 'running', 500);
  if (end.over)
    return (
      <div className="collab-timesup panel" role="alert">
        <span className="collab-timesup__icon">
          <IconTimer size={22} />
        </span>
        <strong>Zeit ist um!</strong>
        <button className="btn btn--green btn--sm" onClick={() => stopTimer(api.store)}>
          OK
        </button>
      </div>
    );
  // am Handy und in der Präsentation ist oben rechts kein Platz bzw. nichts: Timer hier zeigen
  if ((width < 700 || api.presenting()) && timerView(t, now) !== 'idle')
    return (
      <div className="panel collab-bar collab-bar--chip">
        <TimerButton api={api} />
      </div>
    );
  return null;
}

/** Slot oben rechts: Timer und Abstimmung (nicht am Handy, dort Hinweise bzw. Board-Menü). */
export function CollabBar({ api, width }: SlotProps) {
  const session = useSession(api);
  const mod = useCanModerate(api, session);
  // am Handy: Timer in den Hinweisen, Abstimmung im Board-Menü
  if (width < 700) return null;
  return (
    <div className="panel collab-bar" role="group" aria-label="Zusammenarbeit">
      <TimerButton api={api} />
      <button
        className={`collab-bar-btn${session ? ' is-on' : ''}`}
        aria-label={session ? (session.ended ? 'Ergebnis der Abstimmung' : 'Abstimmung läuft') : 'Abstimmung starten'}
        title={session ? (session.ended ? 'Ergebnis der Abstimmung' : 'Abstimmung läuft') : 'Abstimmung starten'}
        onClick={() => {
          if (!session) api.openModal('collab.voteStart');
          else if (session.ended) api.openModal('collab.voteResults', { id: session.id });
          else if (mod.can) api.toast('Es läuft schon eine Abstimmung – beenden über die Leiste oben.');
          else api.toast(`Es läuft schon eine Abstimmung – ${session.startedByName} beendet sie.`);
        }}
      >
        <IconVote size={20} />
      </button>
    </div>
  );
}
