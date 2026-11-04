// Gemeinsamer Timer (ohne React): Y.Map 'collab.timer', Schlüssel 'timer'. Zeiten in ms seit 1970.
import type * as Y from 'yjs';
import type { BoardStore } from '../../board/store';
import { num, str, Y_TIMER } from './model';

export interface TimerState {
  state: 'idle' | 'running' | 'paused';
  /** Ende (running) */
  endsAt: number;
  /** Restzeit (paused) */
  remaining: number;
  /** Gesamtdauer (für den Fortschritt) */
  duration: number;
  /** Name der Person, die gestartet hat */
  by: string;
  /** zählt bei jedem Start hoch (Ton nur einmal je Lauf) */
  run: number;
}

export const IDLE: TimerState = { state: 'idle', endsAt: 0, remaining: 0, duration: 0, by: '', run: 0 };
export const MAX_TIMER_MS = 3 * 3600_000;

export const timerMap = (store: BoardStore) => store.extMap<unknown>(Y_TIMER, { undo: false });

export function readTimer(map: Y.Map<unknown>): TimerState {
  const t = map.get('timer') as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object') return IDLE;
  const state = t.state === 'running' || t.state === 'paused' ? t.state : 'idle';
  return { state, endsAt: num(t.endsAt), remaining: Math.max(0, num(t.remaining)), duration: Math.max(0, num(t.duration)), by: str(t.by), run: num(t.run) };
}

/** Restzeit in ms (0 = abgelaufen bzw. aus). */
export function remainingMs(t: TimerState, now: number): number {
  if (t.state === 'running') return Math.max(0, t.endsAt - now);
  if (t.state === 'paused') return t.remaining;
  return 0;
}

/** Läuft und ist abgelaufen. */
export const isOver = (t: TimerState, now: number) => t.state === 'running' && now >= t.endsAt;

/** „4:05“, ab einer Stunde „1:02:03“ (Sekunden aufgerundet). */
export function formatMs(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const write = (store: BoardStore, t: TimerState) => store.doc.transact(() => timerMap(store).set('timer', t));

export function startTimer(store: BoardStore, ms: number, by: string, now = Date.now()) {
  const d = Math.min(MAX_TIMER_MS, Math.max(1000, Math.round(ms)));
  const prev = readTimer(timerMap(store));
  write(store, { state: 'running', endsAt: now + d, remaining: 0, duration: d, by, run: prev.run + 1 });
}

export function pauseTimer(store: BoardStore, now = Date.now()) {
  const t = readTimer(timerMap(store));
  if (t.state !== 'running' || now >= t.endsAt) return;
  write(store, { ...t, state: 'paused', remaining: t.endsAt - now });
}

export function resumeTimer(store: BoardStore, now = Date.now()) {
  const t = readTimer(timerMap(store));
  if (t.state !== 'paused') return;
  write(store, { ...t, state: 'running', endsAt: now + t.remaining, remaining: 0 });
}

export function stopTimer(store: BoardStore) {
  const t = readTimer(timerMap(store));
  write(store, { ...IDLE, run: t.run });
}

/** Zeit dazugeben (läuft weiter bzw. bleibt pausiert; abgelaufen = neu starten). */
export function addTime(store: BoardStore, ms: number, by: string, now = Date.now()) {
  const t = readTimer(timerMap(store));
  if (t.state === 'idle' || isOver(t, now)) return startTimer(store, ms, by, now);
  if (t.state === 'running') {
    const end = Math.min(now + MAX_TIMER_MS, t.endsAt + ms);
    write(store, { ...t, endsAt: end, duration: t.duration + (end - t.endsAt) });
  } else {
    const rem = Math.min(MAX_TIMER_MS, t.remaining + ms);
    write(store, { ...t, remaining: rem, duration: t.duration + (rem - t.remaining) });
  }
}
