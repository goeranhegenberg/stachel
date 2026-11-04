// Präsentation: Sprechernotizen (nur die präsentierende Person sieht sie) und Übergabe an eine andere Person
// (docs/features/private.md §7). Awareness `structure.handover` = Angebot, `structure.present.from` = übernommen von.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { nanoid } from 'nanoid';
import type { BoardObject } from '../../../protocol';
import type { Peer } from '../../../board/session';
import type { EditorApi, SlotProps } from '../../../editor/ext/types';
import { defineSlot } from '../../../editor/ext/registry';
import { framesInOrder } from './order';
import { PRESENT_FIELD, type PresentState } from './present';
import { IconHandover, IconNotes } from '../icons';
import './handover.css';

/** Awareness: Angebot der präsentierenden Person `{to, id, index, frameId}`, sonst null. */
export const HANDOVER_FIELD = 'structure.handover';

export interface HandoverOffer {
  to: string;
  id: string;
  index: number;
  frameId: string;
}

/** clientId der Person, von der ich gerade übernehme (setzt der Hinweis vor dem Start, liest die Präsentationsleiste). */
let takingFrom: number | null = null;
export const handoverFrom = () => takingFrom;
export const clearHandoverFrom = () => {
  takingFrom = null;
};

/** Nach meiner Übergabe der neuen Person folgen (FollowPresenter liest das). */
let followAfter: number | null = null;
export function takeFollowAfter(presenter: Peer): boolean {
  const s = presenter.extra[PRESENT_FIELD] as PresentState | undefined;
  if (followAfter === null || s?.from !== followAfter) return false;
  followAfter = null;
  return true;
}

const offerOf = (p: Peer): HandoverOffer | null => {
  const h = p.extra[HANDOVER_FIELD] as Partial<HandoverOffer> | null | undefined;
  return h && typeof h.to === 'string' && typeof h.id === 'string' && typeof h.index === 'number' && typeof h.frameId === 'string'
    ? (h as HandoverOffer)
    : null;
};

/** Wer präsentiert (bei einer Übergabe beide kurz): die Person, die von einer anderen Präsentierenden übernommen hat. */
export function currentPresenter(peers: readonly Peer[]): Peer | undefined {
  const list = peers.filter((p) => p.extra[PRESENT_FIELD]);
  return list.find((p) => list.some((q) => q.clientId === (p.extra[PRESENT_FIELD] as PresentState).from)) ?? list[0];
}

const usePeers = (api: EditorApi) => useSyncExternalStore(api.session.subscribe, api.session.getPeers);

/** In der Präsentationsleiste: Notizen des Rahmens, „Übergeben an …“, Ende bei Übernahme durch jemand anderen. */
export function PresentExtras({
  api,
  frame,
  index,
  onExit,
  portal = (n) => n,
}: {
  api: EditorApi;
  frame: BoardObject | undefined;
  index: number;
  onExit: () => void;
  /** Fenster außerhalb der Leiste zeigen (die Leiste schneidet ab) */
  portal?: (node: ReactNode) => ReactNode;
}) {
  const peers = usePeers(api);
  const me = api.session.user.key;
  const myId = api.store.doc.clientID;
  const [notesOpen, setNotesOpen] = useState(true);
  const [pick, setPick] = useState(false);
  const [offer, setOffer] = useState<HandoverOffer | null>(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  // Angebot in der Awareness (folgt dem aktuellen Rahmen), beim Schließen weg
  useEffect(() => {
    api.session.setLocalField(HANDOVER_FIELD, offer && frame ? { ...offer, index, frameId: frame.id } : null);
  }, [api, offer, index, frame]);
  useEffect(() => () => api.session.setLocalField(HANDOVER_FIELD, null), [api]);

  // Jemand hat übernommen (present.from = ich): selbst beenden und der neuen Person folgen
  const takenBy = peers.find((p) => (p.extra[PRESENT_FIELD] as PresentState | undefined)?.from === myId);
  useEffect(() => {
    if (!takenBy) return;
    followAfter = myId;
    setOffer(null);
    exitRef.current();
  }, [takenBy, myId]);

  const others = new Map<string, Peer>();
  for (const p of peers) if (p.user.key !== me && !p.user.key.startsWith('ai:') && !others.has(p.user.key)) others.set(p.user.key, p);
  const notes = frame?.notes?.trim();
  const target = offer ? others.get(offer.to) : undefined;

  return (
    <>
      <button
        className={`ctx-btn${notesOpen && notes ? ' is-active' : ''}`}
        aria-label="Sprechernotizen"
        aria-pressed={notesOpen}
        title={notes ? 'Sprechernotizen (nur du siehst sie)' : 'Keine Notizen zu diesem Rahmen'}
        disabled={!notes}
        onClick={() => setNotesOpen((v) => !v)}
      >
        <IconNotes />
      </button>
      <button className={`ctx-btn${offer ? ' is-active' : ''}`} aria-label="Übergeben an …" title="Präsentation übergeben" onClick={() => setPick((v) => !v)}>
        <IconHandover />
      </button>
      {notesOpen &&
        notes &&
        portal(
          <div className="present-notes" data-testid="present-notes" role="note" aria-label="Sprechernotizen">
            <span className="present-notes__head">Notizen · nur für dich</span>
            <p className="present-notes__text">{notes}</p>
          </div>,
        )}
      {(pick || offer) &&
        portal(
          <div className="present-handover panel" role="dialog" aria-label="Präsentation übergeben">
            {offer ? (
              <>
                <span>Warte auf {target?.user.name ?? 'die Person'} …</span>
                <button className="btn" onClick={() => setOffer(null)}>
                  Zurückziehen
                </button>
              </>
            ) : others.size === 0 ? (
              <span>Niemand sonst ist gerade da.</span>
            ) : (
              <>
                <span className="present-handover__head">Übergeben an</span>
                {[...others.values()].map((p) => (
                  <button
                    key={p.user.key}
                    className="present-handover__person"
                    onClick={() => {
                      setOffer({
                        to: p.user.key,
                        id: nanoid(10),
                        index,
                        frameId: frame?.id ?? '',
                      });
                      setPick(false);
                    }}
                  >
                    <span className="present-handover__dot" style={{ background: p.user.color }} aria-hidden="true" />
                    {p.user.name}
                  </button>
                ))}
              </>
            )}
          </div>,
        )}
    </>
  );
}

/** Hinweis bei der Person, der übergeben wird: Übernehmen startet die Präsentation ab diesem Rahmen. */
function HandoverPrompt({ api, snap }: SlotProps) {
  const peers = usePeers(api);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const me = api.session.user.key;
  if (api.presenting()) return null;
  const from = peers.find((p) => {
    const o = offerOf(p);
    return o && o.to === me && !dismissed.includes(o.id) && p.extra[PRESENT_FIELD];
  });
  const offer = from ? offerOf(from) : null;
  if (!from || !offer) return null;
  const accept = () => {
    const frames = framesInOrder(snap.ordered);
    const i = frames.findIndex((f) => f.id === offer.frameId);
    takingFrom = from.clientId;
    setDismissed((d) => [...d, offer.id]);
    api.startPresent(i >= 0 ? i : offer.index);
  };
  return (
    <div
      className="present-offer panel"
      role="alertdialog"
      aria-label="Präsentation übernehmen"
      data-testid="present-offer"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span>
        <strong>{from.user.name}</strong> möchte dir die Präsentation übergeben.
      </span>
      <button className="btn btn--primary" onClick={accept}>
        Übernehmen
      </button>
      <button className="btn" onClick={() => setDismissed((d) => [...d, offer.id])}>
        Ablehnen
      </button>
    </div>
  );
}

defineSlot({
  id: 'structure.handover',
  slot: 'overlay',
  order: 31,
  Component: HandoverPrompt,
});
