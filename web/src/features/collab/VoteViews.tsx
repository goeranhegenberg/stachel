// Abstimmung: Start-Dialog, Leiste während der Abstimmung, Klickflächen auf den Objekten, Ergebnis mit Rangfolge.
import { useEffect, useState } from 'react';
import { worldToScreen } from '../../board/geometry';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { useY } from '../../editor/ext/hooks';
import { Modal } from '../../ui/Modal';
import { formatMs } from './timer';
import { IconTrophy, IconVote } from './icons';
import { flyTo, typeLabel, Floating } from './common';
import { objectLabel } from './comments';
import { castVote, closeVote, endVote, historyArray, isRunning, myVotes, readHistory, readSession, startVote, tally, used, votable, voteMap, voterCount, voterNames, voterOf, votesMap, type VoteResult, type VoteSession } from './voting';
import { uiOf, useCell, usePeers } from './ui';
import { byPointer } from '../../ui/touch';

/** Sekundentakt, solange `on` (für Restzeiten). */
export function useNow(on: boolean, ms = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return on ? Date.now() : now;
}

export const useSession = (api: EditorApi) => useY(voteMap(api.store), readSession);

/**
 * Darf ich die Abstimmung beenden bzw. schließen? Moderieren darf, wer sie gestartet hat. Ist diese Person
 * nicht mehr auf dem Board, übernimmt jede:r Anwesende (sonst hinge eine Abstimmung ohne Zeitlimit für immer).
 */
export function useCanModerate(api: EditorApi, session: VoteSession | null): { can: boolean; takeover: boolean } {
  const peers = usePeers(api);
  if (!session) return { can: false, takeover: false };
  const me = api.session.user.key;
  if (session.startedBy === me) return { can: true, takeover: false };
  const hostHere = peers.some((p) => p.user.key === session.startedBy);
  return { can: !hostHere, takeover: !hostHere };
}

// ---- Start ----------------------------------------------------------------------------------------------------------

const DURATIONS: { min: number | null; label: string }[] = [
  { min: 1, label: '1 Min.' },
  { min: 3, label: '3 Min.' },
  { min: 5, label: '5 Min.' },
  { min: 10, label: '10 Min.' },
  { min: null, label: 'Ohne' },
];

export function VoteStartDialog({ api, onClose }: { api: EditorApi; props: unknown; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [per, setPer] = useState(3);
  const [minutes, setMinutes] = useState<number | null>(5);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const submit = () => {
    startVote(api.store, { title, perPerson: per, multi, minutes, anonymous }, api.session.user);
    api.setSelection([]);
    api.setTool('select');
    onClose();
  };
  return (
    <Modal title="Abstimmung starten" onClose={onClose}>
      <form
        className="collab-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="collab-form__lead">Alle auf dem Board stimmen gleichzeitig ab, indem sie Objekte {byPointer('anklicken', 'antippen')}.</p>
        <label className="collab-field">
          <span>Worum geht es?</span>
          <input data-autofocus value={title} maxLength={80} placeholder="z. B. Welche Bühne zuerst?" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="collab-field">
          <span id="vote-per">Stimmen pro Person</span>
          <div className="collab-stepper" role="group" aria-labelledby="vote-per">
            <button type="button" aria-label="Weniger Stimmen" disabled={per <= 1} onClick={() => setPer((v) => Math.max(1, v - 1))}>
              −
            </button>
            <output aria-live="polite">{per}</output>
            <button type="button" aria-label="Mehr Stimmen" disabled={per >= 20} onClick={() => setPer((v) => Math.min(20, v + 1))}>
              +
            </button>
          </div>
        </div>
        <div className="collab-field">
          <span id="vote-dur">Dauer</span>
          <div className="collab-chips" role="radiogroup" aria-labelledby="vote-dur">
            {DURATIONS.map((d) => (
              <button type="button" key={d.label} role="radio" aria-checked={minutes === d.min} className={minutes === d.min ? 'is-active' : ''} onClick={() => setMinutes(d.min)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <label className="collab-check">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          Mehrere Stimmen auf ein Objekt erlauben
        </label>
        <label className="collab-check">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          Anonym (im Ergebnis stehen keine Namen)
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary btn--sm">
            Abstimmung starten
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- während der Abstimmung -------------------------------------------------------------------------------------------

/** Slot (overlay): Leiste oben + Klickflächen bzw. Ergebnis-Zahlen auf den Objekten. */
export function VoteLayer({ api, cam, snap, width, height }: SlotProps) {
  const session = useSession(api);
  // neues Objekt je Änderung, damit neu gezeichnet wird
  const { m: votes } = useY(votesMap(api.store), (m) => ({ m }));
  const running = !!session && !session.ended;
  const now = useNow(running);
  const ui = uiOf(api.store);
  const dismissed = useCell(ui.resultsDismissed);
  const me = api.session.user;

  // Zeit abgelaufen → beenden (jeder Client darf, das Ergebnis ist dasselbe)
  useEffect(() => {
    if (session && !session.ended && session.endsAt !== null && now >= session.endsAt) endVote(api.store);
  }, [api.store, session, now]);
  // Ergebnis automatisch zeigen (einmal je Abstimmung)
  useEffect(() => {
    if (session?.ended && dismissed !== session.id) api.openModal('collab.voteResults', { id: session.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.ended, session?.id]);

  if (!session) return null;
  const live = isRunning(session, now);
  const mine = myVotes(votes, session.id, voterOf(session, me.key));
  const totals = session.ended ? new Map(tally(votes, session.id, (id) => snap.byId.has(id)).ranking.map((r) => [r.objectId, r])) : null;

  const targets: React.ReactNode[] = [];
  for (const o of snap.ordered) {
    if (!votable(o)) continue;
    const r = api.bounds(o);
    if (!r) continue;
    const a = worldToScreen(cam, { x: r.x, y: r.y });
    const w = r.w * cam.z;
    const h = r.h * cam.z;
    if (a.x > width || a.y > height || a.x + w < 0 || a.y + h < 0) continue;
    const n = mine.get(o.id) ?? 0;
    if (live) {
      if (w < 6 || h < 6) continue;
      targets.push(
        <button
          key={o.id}
          className={`collab-vote-target${n ? ' has-vote' : ''}`}
          data-vote={o.id}
          style={{ transform: `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`, width: Math.round(w), height: Math.round(h) }}
          aria-label={`${objectLabel(o, typeLabel)}: ${n ? `${n} Stimme${n > 1 ? 'n' : ''} von dir` : 'abstimmen'}`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (n) castVote(api.store, session, me, o.id, -1);
          }}
          onClick={() => {
            const res = castVote(api.store, session, me, o.id, 1);
            if (res === 'none-left') api.toast(`Keine Stimmen mehr übrig – klick auf eine vergebene Stimme, um sie zurückzunehmen.`);
          }}
        >
          {n > 0 && (
            <span className="collab-vote-badge">
              {session.multi && (
                <span
                  className="collab-vote-minus"
                  role="button"
                  aria-label="Stimme zurücknehmen"
                  title="Stimme zurücknehmen"
                  onClick={(e) => {
                    e.stopPropagation();
                    castVote(api.store, session, me, o.id, -1);
                  }}
                >
                  −
                </span>
              )}
              <span>{n}</span>
            </span>
          )}
        </button>,
      );
    } else if (totals?.has(o.id)) {
      const t = totals.get(o.id)!;
      targets.push(
        <span key={o.id} className={`collab-vote-total${t.rank === 1 ? ' is-top' : ''}`} style={{ transform: `translate(${Math.round(a.x + w)}px, ${Math.round(a.y)}px)` }} title={`Platz ${t.rank}`}>
          {t.votes}
        </span>,
      );
    }
  }

  return <div className="collab-layer">{targets}</div>;
}

/** Leiste oben während bzw. nach der Abstimmung (in den Hinweisen). */
export function VoteBar({ api }: { api: EditorApi }) {
  const session = useSession(api);
  const { m: votes } = useY(votesMap(api.store), (m) => ({ m }));
  const now = useNow(!!session && !session.ended);
  const mod = useCanModerate(api, session);
  const host = mod.can;
  const takeoverTip = mod.takeover && session ? `${session.startedByName} ist nicht mehr auf dem Board – du kannst die Abstimmung übernehmen.` : undefined;
  if (!session || api.presenting()) return null;
  const me = api.session.user;
  const live = isRunning(session, now);
  const left = session.perPerson - used(myVotes(votes, session.id, voterOf(session, me.key)));
  const exists = (id: string) => !!api.snapshot().byId.get(id);
  return (
    <Floating className={`collab-votebar panel${live ? '' : ' is-ended'}`} role="region" label="Abstimmung">
      <span className="collab-votebar__icon">
        <IconVote size={20} />
      </span>
      <div className="collab-votebar__text">
        <strong>{session.title}</strong>
        <span>
          {live ? (left > 0 ? `${byPointer('Klick auf Objekte', 'Objekte antippen')} zum Abstimmen · ${voterCount(votes, session.id)} dabei` : 'Alle Stimmen vergeben') : 'Abstimmung beendet'}
          {session.anonymous ? ' · anonym' : ''}
        </span>
      </div>
      {live && (
        <>
          <div className="collab-votes-left" aria-label={`${left} von ${session.perPerson} Stimmen übrig`} title={`${left} von ${session.perPerson} Stimmen übrig`} data-testid="votes-left">
            {session.perPerson <= 10 ? (
              Array.from({ length: session.perPerson }, (_, i) => <i key={i} className={i < left ? 'is-left' : ''} />)
            ) : (
              <b>
                {left}/{session.perPerson}
              </b>
            )}
          </div>
          {session.endsAt !== null && (
            <span className={`collab-votebar__time${session.endsAt - now < 10_000 ? ' is-urgent' : ''}`} data-testid="vote-time">
              {formatMs(session.endsAt - now)}
            </span>
          )}
        </>
      )}
      {live ? (
        host && (
          <button className="btn btn--green btn--sm" title={takeoverTip} onClick={() => endVote(api.store)}>
            Beenden
          </button>
        )
      ) : (
        <>
          <button className="btn btn--green btn--sm" onClick={() => api.openModal('collab.voteResults', { id: session.id })}>
            Ergebnis
          </button>
          {host && (
            <button className="btn btn--sm collab-ghost" title={takeoverTip} onClick={() => closeVote(api.store, exists)}>
              Schließen
            </button>
          )}
        </>
      )}
    </Floating>
  );
}

// ---- Ergebnis -------------------------------------------------------------------------------------------------------

export function VoteResultsDialog({ api, props, onClose }: { api: EditorApi; props: unknown; onClose: () => void }) {
  const session = useSession(api);
  const { m: votes } = useY(votesMap(api.store), (m) => ({ m }));
  const history = useY(historyArray(api.store), readHistory);
  const snap = api.snapshot();
  const ui = uiOf(api.store);
  const mod = useCanModerate(api, session);
  const wanted = (props as { id?: string } | undefined)?.id;
  const current: (VoteResult & { session?: VoteSession }) | null =
    session && (!wanted || wanted === session.id)
      ? { id: session.id, title: session.title, at: '', ...tally(votes, session.id, (id) => snap.byId.has(id)), session }
      : (history.find((h) => h.id === wanted) ?? history[0] ?? null);
  const close = () => {
    if (session) ui.resultsDismissed.set(session.id);
    onClose();
  };
  if (!current) {
    return (
      <Modal title="Abstimmungen" onClose={close}>
        <p>Noch keine Ergebnisse. Starte eine Abstimmung über den Knopf oben rechts.</p>
        <div className="modal-actions">
          <button className="btn btn--primary btn--sm" onClick={close}>
            OK
          </button>
        </div>
      </Modal>
    );
  }
  const max = Math.max(1, ...current.ranking.map((r) => r.votes));
  const host = mod.can;
  // wer wofür gestimmt hat (nur laufende/letzte, nicht-anonyme Abstimmung; das Archiv speichert keine Namen)
  const names = current.session && !current.session.anonymous ? voterNames(votes, current.session.id) : null;
  return (
    <Modal title="Ergebnis" onClose={close}>
      <div className="collab-results">
        <p className="collab-results__meta">
          <strong>{current.title}</strong>
          <span>
            {current.voters} {current.voters === 1 ? 'Person' : 'Personen'} · {current.total} {current.total === 1 ? 'Stimme' : 'Stimmen'}
            {current.session && !current.session.ended ? ' · läuft noch' : ''}
          </span>
        </p>
        {current.ranking.length === 0 ? (
          <p className="collab-results__empty">Es wurde keine Stimme abgegeben.</p>
        ) : (
          <ol className="collab-rank" aria-label="Rangfolge">
            {current.ranking.map((r) => {
              const o = snap.byId.get(r.objectId);
              return (
                <li key={r.objectId} className={r.rank === 1 ? 'is-top' : ''}>
                  <button
                    disabled={!o}
                    onClick={() => {
                      if (!o) return;
                      close();
                      api.setSelection([o.id]);
                      const b = api.bounds(o);
                      if (b) flyTo(api, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, 0.6);
                    }}
                  >
                    <span className="collab-rank__n">{r.rank === 1 ? <IconTrophy size={18} /> : r.rank}</span>
                    <span className="collab-rank__label">
                      {objectLabel(o, typeLabel)}
                      {names?.get(r.objectId) && <small className="collab-rank__who">{names.get(r.objectId)!.join(', ')}</small>}
                      <span className="collab-rank__bar" style={{ width: `${(r.votes / max) * 100}%` }} />
                    </span>
                    <b>{r.votes}</b>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {history.length > (current.session ? 0 : 1) && (
          <details className="collab-history">
            <summary>Frühere Abstimmungen</summary>
            <ul>
              {history
                .filter((h) => h.id !== current.id)
                .map((h) => (
                  <li key={h.id}>
                    <button onClick={() => api.openModal('collab.voteResults', { id: h.id })}>
                      {h.title} <span>{new Date(h.at).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </details>
        )}
        <div className="modal-actions">
          {host && current.session?.ended && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                closeVote(api.store, (id) => snap.byId.has(id));
                onClose();
              }}
            >
              Abstimmung schließen
            </button>
          )}
          <button className="btn btn--primary btn--sm" onClick={close}>
            Fertig
          </button>
        </div>
      </div>
    </Modal>
  );
}
