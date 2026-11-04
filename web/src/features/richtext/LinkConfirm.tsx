// Links im Board anklickbar: kurzer Klick auf einen Link (außerhalb der Bearbeitung) fragt nach, bevor er sich öffnet.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { IconExternal } from './icons';
import { safeHref, shortHref } from './links';

interface Pending {
  href: string;
  x: number;
  y: number;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const set = (p: Pending | null) => {
  pending = p;
  listeners.forEach((fn) => fn());
};

if (typeof window !== 'undefined') {
  let down: { href: string; x: number; y: number; t: number } | null = null;
  let timer = 0;
  window.addEventListener(
    'pointerdown',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a.rt-link');
      // im Editor (Bearbeitung) bleibt ein Klick ein Klick in den Text
      down = a && !a.closest('.editing') && e.button === 0 ? { href: a.getAttribute('href') ?? '', x: e.clientX, y: e.clientY, t: performance.now() } : null;
    },
    true,
  );
  window.addEventListener(
    'pointerup',
    (e) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 600) return;
      const href = safeHref(d.href);
      if (!href) return;
      // kurz warten: ein Doppelklick startet die Bearbeitung statt den Link
      clearTimeout(timer);
      timer = window.setTimeout(() => set({ href, x: e.clientX, y: e.clientY }), 280);
    },
    true,
  );
  window.addEventListener('dblclick', () => clearTimeout(timer), true);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function LinkConfirm() {
  const p = useSyncExternalStore(subscribe, () => pending);
  if (!p) return null;
  return createPortal(<Dialog key={p.href + p.x + p.y} p={p} />, document.body);
}

function Dialog({ p }: { p: Pending }) {
  const ref = useRef<HTMLDivElement>(null);
  const open = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: p.x, top: p.y + 14 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, p.x - w / 2), window.innerWidth - w - 8);
    const top = p.y + 14 + h > window.innerHeight - 8 ? p.y - h - 14 : p.y + 14;
    setPos({ left, top });
    open.current?.focus({ preventScroll: true });
  }, [p]);
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) set(null);
    };
    window.addEventListener('keydown', close, true);
    window.addEventListener('pointerdown', close, true);
    return () => {
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('pointerdown', close, true);
    };
  }, []);
  return (
    <div ref={ref} className="richtext-confirm panel" role="dialog" aria-label="Link öffnen?" style={{ left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="richtext-confirm-title">Link öffnen?</div>
      <div className="richtext-confirm-url" title={p.href}>
        {shortHref(p.href, 56)}
      </div>
      <div className="richtext-confirm-actions">
        <button type="button" className="btn richtext-confirm-cancel" onClick={() => set(null)}>
          Abbrechen
        </button>
        <button
          ref={open}
          type="button"
          className="btn btn--green"
          onClick={() => {
            window.open(p.href, '_blank', 'noopener,noreferrer');
            set(null);
          }}
        >
          <IconExternal size={16} />
          Öffnen
        </button>
      </div>
    </div>
  );
}
