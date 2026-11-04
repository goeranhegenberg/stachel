// Datenvertrag des Moduls „collab“ (docs/features/collab.md): Namen der Y-Strukturen und Awareness-Felder.
// Keine neuen Objektfelder – alles liegt in eigenen Strukturen neben `objects`.

/** Kommentar-Threads: Y.Map<threadId, Y.Map> (Rückgängig inklusive) */
export const Y_COMMENTS = 'collab.comments';
/** Reaktionen: Y.Map<"objectId|emoji|userKey", Reaction> (Rückgängig inklusive) */
export const Y_REACTIONS = 'collab.reactions';
/** Laufende/letzte Abstimmung: Y.Map mit Schlüssel 'session' (ohne Rückgängig) */
export const Y_VOTE = 'collab.vote';
/** Stimmen: Y.Map<"sessionId|userKey|objectId", { n, name }> (ohne Rückgängig) */
export const Y_VOTES = 'collab.votes';
/** Ergebnisse beendeter Abstimmungen: Y.Array<VoteResult> (ohne Rückgängig, höchstens 20) */
export const Y_VOTE_HISTORY = 'collab.voteHistory';
/** Gemeinsamer Timer: Y.Map mit Schlüssel 'timer' (ohne Rückgängig) */
export const Y_TIMER = 'collab.timer';
/** Gelesen-Stand der Erwähnungen je Person: Y.Map<userKey, ISO-Zeit> (ohne Rückgängig) */
export const Y_READS = 'collab.reads';

// Awareness (flüchtig)
/** userKey der Person, der ich folge (oder null) */
export const AW_FOLLOW = 'collab.follow';
/** mein sichtbarer Weltausschnitt {x,y,w,h} – nur solange mir jemand folgt */
export const AW_VIEWPORT = 'collab.viewport';
/** „Alle zu mir holen“: { id, rect, ts } */
export const AW_SUMMON = 'collab.summon';
/** Laserpointer: { s: Nummer des letzten Punkts, p: [x,y, x,y, …] (letzte Punkte) } oder null */
export const AW_LASER = 'collab.laser';
/** Status: 'active' | 'idle' | 'away' */
export const AW_STATUS = 'collab.status';
/** Cursor-Chat: { text, typing? } am eigenen Mauszeiger oder null */
export const AW_CHAT = 'collab.chat';
/** laufende Bild-Uploads: [{ x, y, w, h, color }] (Weltkoordinaten; setzt der Editor) oder null */
export const AW_UPLOADS = 'collab.uploads';

export type PresenceStatus = 'active' | 'idle' | 'away';

/** Ein Wert mit Abonnement (lokaler UI-Zustand, geteilt zwischen den Slots des Moduls). */
export class Cell<T> {
  private fns = new Set<() => void>();
  constructor(private value: T) {}
  get = () => this.value;
  set = (v: T | ((prev: T) => T)) => {
    const next = typeof v === 'function' ? (v as (p: T) => T)(this.value) : v;
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const fn of this.fns) fn();
  };
  subscribe = (fn: () => void) => {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  };
}

export const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
