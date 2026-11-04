// Gemeinsamer Timer: Knopf oben rechts (zeigt die Restzeit für alle), Einstellungen im Popover, Ton am Ende.
import { useEffect, useRef, useState } from 'react';
import type { EditorApi } from '../../editor/ext/types';
import { useY } from '../../editor/ext/hooks';
import { IconPause, IconPlay, IconSound, IconStop, IconTimer } from './icons';
import { chime, setSoundOn, soundOn } from './sound';
import { addTime, formatMs, isOver, pauseTimer, readTimer, remainingMs, resumeTimer, startTimer, stopTimer, timerMap, type TimerState } from './timer';
import { useNow } from './VoteViews';

/** Nach Ablauf so lange „Zeit ist um“ zeigen, dann gilt der Timer als aus. */
export const OVER_SHOW_MS = 12_000;

export const useTimer = (api: EditorApi) => useY(timerMap(api.store), readTimer);

/** Zustand für die Anzeige: läuft, pausiert, gerade abgelaufen oder aus. */
export function timerView(t: TimerState, now: number): 'running' | 'paused' | 'over' | 'idle' {
  if (t.state === 'paused') return 'paused';
  if (t.state !== 'running') return 'idle';
  if (now < t.endsAt) return 'running';
  return now - t.endsAt < OVER_SHOW_MS ? 'over' : 'idle';
}

export const PRESETS = [1, 3, 5, 10, 15, 30];

export function TimerButton({ api }: { api: EditorApi }) {
  const t = useTimer(api);
  const now = useNow(t.state === 'running', 200);
  const view = timerView(t, now);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const rem = remainingMs(t, now);
  const active = view !== 'idle';

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

  const pct = t.duration ? Math.min(1, Math.max(0, 1 - rem / t.duration)) : 0;
  return (
    <div className="collab-timer-wrap" ref={wrap}>
      <button
        className={`collab-bar-btn collab-timer collab-timer--${view}${open ? ' is-open' : ''}`}
        aria-label={active ? `Timer ${view === 'over' ? 'abgelaufen' : formatMs(rem)}` : 'Timer'}
        title="Timer für alle"
        aria-expanded={open}
        data-testid="timer"
        onClick={() => setOpen((v) => !v)}
      >
        <IconTimer size={20} />
        {active && <span className="collab-timer__time">{view === 'over' ? 'Zeit!' : formatMs(rem)}</span>}
        {active && <i className="collab-timer__bar" style={{ transform: `scaleX(${view === 'over' ? 1 : pct})` }} />}
      </button>
      {open && <TimerPop api={api} t={t} view={view} rem={rem} onDone={() => setOpen(false)} />}
    </div>
  );
}

function TimerPop({ api, t, view, rem, onDone }: { api: EditorApi; t: TimerState; view: ReturnType<typeof timerView>; rem: number; onDone: () => void }) {
  const [min, setMin] = useState(5);
  const [sound, setSound] = useState(soundOn);
  const by = api.session.user.name;
  const running = view === 'running' || view === 'paused';
  return (
    <div className="collab-pop collab-timer-pop panel" role="dialog" aria-label="Timer">
      {running ? (
        <>
          <div className={`collab-timer-big${view === 'paused' ? ' is-paused' : ''}`} aria-live="off">
            {formatMs(rem)}
          </div>
          <p className="collab-timer-by">
            {view === 'paused' ? 'Pausiert' : 'Läuft'} · gestartet von {t.by || 'jemandem'}
          </p>
          <div className="collab-timer-actions">
            {view === 'paused' ? (
              <button className="collab-round collab-round--green" aria-label="Weiter" title="Weiter" onClick={() => resumeTimer(api.store)}>
                <IconPlay size={20} />
              </button>
            ) : (
              <button className="collab-round" aria-label="Pause" title="Pause" onClick={() => pauseTimer(api.store)}>
                <IconPause size={20} />
              </button>
            )}
            <button className="collab-pill" onClick={() => addTime(api.store, 60_000, by)}>
              +1 Min.
            </button>
            <button className="collab-pill" onClick={() => addTime(api.store, 5 * 60_000, by)}>
              +5 Min.
            </button>
            <button
              className="collab-round collab-round--pink"
              aria-label="Timer beenden"
              title="Timer beenden"
              onClick={() => {
                stopTimer(api.store);
                onDone();
              }}
            >
              <IconStop size={18} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="collab-timer-set">
            <button className="collab-round" aria-label="Eine Minute weniger" disabled={min <= 1} onClick={() => setMin((m) => Math.max(1, m - 1))}>
              −
            </button>
            <div className="collab-timer-big" aria-live="polite">
              {formatMs(min * 60_000)}
            </div>
            <button className="collab-round" aria-label="Eine Minute mehr" disabled={min >= 180} onClick={() => setMin((m) => Math.min(180, m + 1))}>
              +
            </button>
          </div>
          <div className="collab-presets" role="group" aria-label="Schnellauswahl">
            {PRESETS.map((m) => (
              <button key={m} className={`collab-pill${m === min ? ' is-active' : ''}`} onClick={() => setMin(m)}>
                {m} Min.
              </button>
            ))}
          </div>
          <button
            className="btn btn--green btn--sm collab-wide"
            onClick={() => {
              startTimer(api.store, min * 60_000, by);
              onDone();
            }}
          >
            <IconPlay size={16} /> Für alle starten
          </button>
        </>
      )}
      <label className="collab-switch collab-switch--dark">
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => {
            setSound(e.target.checked);
            setSoundOn(e.target.checked);
          }}
        />
        <span aria-hidden="true" />
        <IconSound size={16} off={!sound} /> Ton am Ende
      </label>
    </div>
  );
}

/** Ton und Hinweis, wenn ein Timer abläuft, den dieser Client laufen gesehen hat. */
export function useTimerEnd(api: EditorApi): { over: boolean; by: string } {
  const t = useTimer(api);
  const now = useNow(t.state === 'running', 200);
  const seen = useRef<number | null>(null);
  const rang = useRef<number | null>(null);
  if (t.state === 'running' && now < t.endsAt) seen.current = t.run;
  const over = isOver(t, now) && seen.current === t.run && now - t.endsAt < OVER_SHOW_MS;
  useEffect(() => {
    if (over && rang.current !== t.run) {
      rang.current = t.run;
      chime();
    }
  }, [over, t.run]);
  return { over, by: t.by };
}
