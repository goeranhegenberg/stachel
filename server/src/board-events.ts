// Board-Ereignisse für alle offenen Seiten: die Übersicht bekommt sie per Server-Sent Events
// (`GET /api/boards/events`), der Editor eines Boards zusätzlich als Hocuspocus-Stateless-Nachricht (sync.ts).
// Vertrag: docs/contract.md §3 „Live-Übersicht“ und §4 „Stateless-Nachrichten“.
import type { FastifyInstance, FastifyRequest } from 'fastify';

export type BoardEvent =
  /** neu angelegt (auch Duplikat, Vorlage) */
  | { type: 'created'; id: string }
  /** umbenannt; `titleSeq` steigt streng (gleichzeitiges Umbenennen: höchste Nummer gewinnt bei allen) */
  | { type: 'renamed'; id: string; title: string; titleSeq: number }
  /** von `by` (Name) in den Papierkorb verschoben */
  | { type: 'deleted'; id: string; by: string; byKey: string }
  /** aus dem Papierkorb wiederhergestellt (trash.ts) */
  | { type: 'restored'; id: string; by: string; byKey: string }
  /** endgültig gelöscht (von Hand im Papierkorb oder nach Ablauf der Frist) */
  | { type: 'purged'; id: string }
  /** Inhalt gespeichert bzw. Vorschaubild neu (gedrosselt) */
  | { type: 'updated'; id: string };

type Listener = (e: BoardEvent) => void;

/** Höchstens so oft je Board ein „updated“ (Speichern passiert beim Tippen alle paar Sekunden). */
const UPDATED_EVERY_MS = 15_000;
/** Kommentarzeile gegen Proxy-Zeitlimits (nginx: 60 s). */
const HEARTBEAT_MS = 25_000;

export class BoardEvents {
  private listeners = new Set<Listener>();
  private lastUpdated = new Map<string, number>();
  private seq = 0;
  /** offene Event-Streams (beim Herunterfahren schließen, sonst wartet der HTTP-Server ewig) */
  readonly streams = new Set<{ end: () => void }>();

  /** Streng steigende Nummer für Titeländerungen (auch über Neustarts hinweg ungefähr steigend). */
  nextTitleSeq(): number {
    this.seq = Math.max(this.seq + 1, Date.now());
    return this.seq;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** `force`: `updated` ohne Drossel (neues Vorschaubild – sonst sähe die Übersicht es erst beim nächsten Speichern). */
  emit(e: BoardEvent, now = Date.now(), force = false) {
    if (e.type === 'updated' && force) this.lastUpdated.set(e.id, now);
    else if (e.type === 'updated') {
      const last = this.lastUpdated.get(e.id) ?? 0;
      if (now - last < UPDATED_EVERY_MS) return;
      this.lastUpdated.set(e.id, now);
    } else if (e.type === 'deleted' || e.type === 'purged') this.lastUpdated.delete(e.id);
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // ein kaputter Empfänger stört die anderen nicht
      }
    }
  }

  get listenerCount() {
    return this.listeners.size;
  }

  /** Alle Event-Streams beenden (Herunterfahren). */
  closeAll() {
    for (const s of [...this.streams]) s.end();
  }
}

/** `GET /api/boards/events` (im Scope mit Sitzungsprüfung registrieren): Server-Sent Events für die Übersicht. */
export function registerBoardEvents(
  scope: FastifyInstance,
  events: BoardEvents,
  /** Modus local: nur Ereignisse zu Boards, auf die die Person Zugriff hat (access.ts) */
  filter?: (req: FastifyRequest, e: BoardEvent) => boolean,
) {
  scope.get('/api/boards/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // nginx soll nicht puffern
      'X-Accel-Buffering': 'no',
    });
    // Wiederverbinden des Browsers nach 3 s (EventSource-Standard), erste Zeile sofort, damit Proxys durchreichen
    res.write('retry: 3000\n: verbunden\n\n');
    const send = (e: BoardEvent) => {
      if (filter && !filter(req, e)) return;
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const off = events.on(send);
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const stream = { end: () => res.end() };
    events.streams.add(stream);
    const done = () => {
      off();
      clearInterval(beat);
      events.streams.delete(stream);
    };
    req.raw.on('close', done);
    res.on('close', done);
    res.on('error', done);
  });
}
