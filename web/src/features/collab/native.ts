// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P5 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Abstimmung, Timer und Kommentar-Pin umhängen mit genau den Web-Funktionen
// (voting.ts, timer.ts, comments.ts). Abstimmung und Timer ohne Rückgängig wie im Web (gemeinsamer Ablauf, nicht
// Board-Inhalt), Pin umhängen ein Rückgängig-Schritt.
// Test: server/test/native-act-collab.test.ts, Doku: Abschnitt „Native-Aktionen“ in docs/features/collab.md.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import { A, parseArgs } from '../../native/args';
import { defineNativeAction, type NativeActionCtx } from '../../native/registry';
import type { BoardStore } from '../../board/store';
import { anchorAt, commentsMap, moveThread } from './comments';
import { addTime, MAX_TIMER_MS, pauseTimer, readTimer, resumeTimer, startTimer, stopTimer, timerMap } from './timer';
import { castVote, closeVote, endVote, isRunning, readSession, startVote, votable, voteMap, type VoteOutcome } from './voting';

/** Stimmen pro Person im Start-Dialog (VoteViews.tsx: Stepper 1–20) */
export const VOTE_PER_PERSON_MAX = 20;
/** Dauer-Auswahl im Start-Dialog (Minuten; `null` = „Ohne“) */
export const VOTE_MINUTES = [1, 3, 5, 10] as const;
/** längster Titel (Eingabefeld `maxLength`) */
export const VOTE_TITLE_MAX = 80;

/** Hinweis des Web, wenn alle Stimmen vergeben sind (VoteLayer). */
export const NONE_LEFT_TOAST = 'Keine Stimmen mehr übrig – klick auf eine vergebene Stimme, um sie zurückzunehmen.';

/** Server-Zeit zum Abgleich der App-Uhr (Restzeiten von Timer und Abstimmung rechnen mit ms seit 1970). */
const clock = () => ({ now: Date.now() });

const none = <T>(raw: Record<string, unknown>) => parseArgs<T>(raw, {});

// ---- Abstimmung -------------------------------------------------------------------------------------------------------

type VoteStartArgs = { title: string; perPerson: number; minutes: number | null; multi: boolean; anonymous: boolean };

/** `collab.vote.start` (Dialog „Abstimmung starten“): wie startVote; läuft schon eine, passiert nichts. */
defineNativeAction<VoteStartArgs>('collab.vote.start', {
  undo: 'none',
  args: (raw) =>
    parseArgs<VoteStartArgs>(raw, {
      title: A.str(VOTE_TITLE_MAX),
      perPerson: A.int(1, VOTE_PER_PERSON_MAX),
      minutes: (v) => v === null || (VOTE_MINUTES as readonly unknown[]).includes(v),
      multi: A.bool,
      anonymous: A.bool,
    }),
  run(store, a, ctx) {
    if (isRunning(readSession(voteMap(store)), Date.now())) return { skipped: true, toast: 'Es läuft schon eine Abstimmung.', data: clock() };
    const s = startVote(store, { title: a.title, perPerson: a.perPerson, multi: a.multi, minutes: a.minutes, anonymous: a.anonymous }, ctx.user);
    return { select: [], data: { id: s.id, ...clock() } };
  },
});

/** `collab.vote.cast`: Objekt antippen (`delta` 1) bzw. „−“ (`delta` −1) – wie der Klick im VoteLayer. */
defineNativeAction<{ objectId: string; delta: 1 | -1 }>('collab.vote.cast', {
  undo: 'none',
  args: (raw) => parseArgs(raw, { objectId: A.id, delta: (v) => v === 1 || v === -1 }),
  run(store, { objectId, delta }, ctx) {
    const o = store.get(objectId);
    if (!o || !votable(o)) return { skipped: true, data: { outcome: 'not-votable', ...clock() } };
    const outcome: VoteOutcome = castVote(store, readSession(voteMap(store)), ctx.user, objectId, delta);
    return { ...(outcome === 'none-left' ? { toast: NONE_LEFT_TOAST } : {}), data: { outcome, ...clock() } };
  },
});

/** `collab.vote.end`: „Beenden“ bzw. Ablauf der Zeit (jeder Client darf, mehrfach ist harmlos – wie im Web). */
defineNativeAction<Record<string, never>>('collab.vote.end', {
  undo: 'none',
  args: none,
  run(store) {
    endVote(store);
    return { data: clock() };
  },
});

/** `collab.vote.close`: „Schließen“ – Ergebnis ins Archiv, Sitzung und Stimmen weg (gelöschte Objekte zählen nicht). */
defineNativeAction<Record<string, never>>('collab.vote.close', {
  undo: 'none',
  args: none,
  run(store, _a, ctx: NativeActionCtx) {
    closeVote(store, (id) => ctx.exists(id));
    return { data: clock() };
  },
});

// ---- Timer ------------------------------------------------------------------------------------------------------------

const ms = A.int(1000, MAX_TIMER_MS);

/** `collab.timer.start` („Für alle starten“ / Board-Menü „Timer für alle: 5 Min.“): gestartet von = Name der Person. */
defineNativeAction<{ ms: number }>('collab.timer.start', {
  undo: 'none',
  args: (raw) => parseArgs(raw, { ms }),
  run(store, a, ctx) {
    startTimer(store, a.ms, ctx.user.name);
    return { data: { ...readTimer(timerMap(store)), ...clock() } };
  },
});

/** `collab.timer.add` („+1 Min.“ / „+5 Min.“; abgelaufen = neu starten). */
defineNativeAction<{ ms: number }>('collab.timer.add', {
  undo: 'none',
  args: (raw) => parseArgs(raw, { ms }),
  run(store, a, ctx) {
    addTime(store, a.ms, ctx.user.name);
    return { data: { ...readTimer(timerMap(store)), ...clock() } };
  },
});

const timerStep = (name: string, fn: (store: BoardStore) => void) =>
  defineNativeAction<Record<string, never>>(name, {
    undo: 'none',
    args: none,
    run(store) {
      fn(store);
      return { data: { ...readTimer(timerMap(store)), ...clock() } };
    },
  });

timerStep('collab.timer.pause', (s) => pauseTimer(s));
timerStep('collab.timer.resume', (s) => resumeTimer(s));
timerStep('collab.timer.stop', (s) => stopTimer(s));

// ---- Kommentar-Pin umhängen (L02) -----------------------------------------------------------------------------------

/**
 * `collab.commentMove`: Pin an eine neue Stelle gezogen – wie im Web `moveThread(anchorAt(p, hit))`; die App nennt
 * das Objekt unter der Stelle (`objectId`, ihr Treffer), der Abstand zur Ecke kommt aus dem Server-Stand.
 */
defineNativeAction<{ thread: string; x: number; y: number; objectId?: string }>('collab.commentMove', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { thread: A.id, x: A.num(), y: A.num(), objectId: A.opt(A.id) }),
  run(store, { thread, x, y, objectId }) {
    if (!commentsMap(store).has(thread)) return { skipped: true };
    const hit = objectId ? (store.get(objectId) ?? null) : null;
    moveThread(store, thread, anchorAt({ x, y }, hit));
    return {};
  },
});
