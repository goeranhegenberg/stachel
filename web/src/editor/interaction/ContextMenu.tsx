// Rechtsklick-Menü (role=menu): Pfeiltasten, Enter, Esc; schließt bei Klick daneben.
// Einträge mit `items` öffnen ein Untermenü: am Rechner seitlich (Überfahren, Pfeil rechts), am Handy aufgeklappt darunter.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../../ui/useMediaQuery';

export interface MenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Trennlinie vor diesem Eintrag */
  sep?: boolean;
  /** Aktion; bei Einträgen mit Untermenü (`items`) nicht nötig */
  onSelect?: () => void;
  /** Untermenü */
  items?: MenuItem[];
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const enabledOf = (items: MenuItem[]) => items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg className="ctxmenu__chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={open ? { transform: 'rotate(90deg)' } : undefined}>
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Handy/Tablet: Untermenü klappt im Menü auf statt seitlich
  const inline = useMediaQuery('(max-width: 700px), (pointer: coarse)');
  const [pos, setPos] = useState({ x, y });
  const enabled = enabledOf(items);
  const [active, setActive] = useState(enabled[0] ?? 0);
  /** offenes Untermenü (Index des Eintrags) und ob die Tastatur gerade darin ist */
  const [sub, setSub] = useState<number | null>(null);
  const [inSub, setInSub] = useState(false);
  const [subActive, setSubActive] = useState(0);
  const [subPos, setSubPos] = useState<{ x: number; y: number } | null>(null);
  const subItems = sub !== null ? (items[sub]?.items ?? []) : [];
  const subEnabled = enabledOf(subItems);

  // im Fenster halten
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(y, window.innerHeight - h - 8)) });
    el.focus({ preventScroll: true });
  }, [x, y]);

  // Untermenü neben dem Eintrag, rechts oder (kein Platz) links
  useLayoutEffect(() => {
    if (sub === null || inline) return setSubPos(null);
    const row = itemRefs.current[sub];
    const panel = subRef.current;
    const host = ref.current?.offsetParent as HTMLElement | null;
    if (!row || !panel) return;
    const r = row.getBoundingClientRect();
    const o = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const right = r.right + 4 + w <= window.innerWidth - 8;
    const left = right ? r.right + 4 : Math.max(8, r.left - 4 - w);
    const top = Math.max(8, Math.min(r.top - 6, window.innerHeight - h - 8));
    setSubPos({ x: left - o.left, y: top - o.top });
  }, [sub, inline, pos.x, pos.y]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !subRef.current?.contains(t)) onClose();
    };
    const blur = () => onClose();
    // Fenster verkleinert (oder Handy gedreht) und das Menü liegt jetzt außerhalb: schließen, sonst bliebe es
    // unsichtbar offen. Passt es noch ins Bild, bleibt es offen.
    const resize = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r && (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1)) onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', resize);
    };
  }, [onClose]);

  const openSub = (i: number, viaKeyboard: boolean) => {
    const list = items[i]?.items ?? [];
    setSub(i);
    setSubActive(enabledOf(list)[0] ?? 0);
    setInSub(viaKeyboard);
  };
  const closeSub = () => {
    setSub(null);
    setInSub(false);
  };

  const runItem = (it: MenuItem | undefined) => {
    if (!it || it.disabled || !it.onSelect) return;
    onClose();
    it.onSelect();
  };
  const run = (i: number, viaKeyboard = false) => {
    const it = items[i];
    if (!it || it.disabled) return;
    if (it.items) {
      if (sub === i && !viaKeyboard) closeSub();
      else openSub(i, viaKeyboard);
      return;
    }
    runItem(it);
  };

  const step = (list: number[], cur: number, d: number) => list[(list.indexOf(cur) + d + list.length) % list.length];

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const key = e.key;
    if (inSub && sub !== null) {
      if (key === 'ArrowDown' || key === 'ArrowUp') setSubActive(step(subEnabled, subActive, key === 'ArrowDown' ? 1 : -1));
      else if (key === 'ArrowLeft' || key === 'Escape') closeSub();
      else if (key === 'Enter' || key === ' ') runItem(subItems[subActive]);
      else if (key === 'Tab') onClose();
      else return;
      e.preventDefault();
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      setActive(step(enabled, active, key === 'ArrowDown' ? 1 : -1));
      if (!inline) closeSub();
    } else if (key === 'Home') setActive(enabled[0]);
    else if (key === 'End') setActive(enabled[enabled.length - 1]);
    else if (key === 'ArrowRight' && items[active]?.items) openSub(active, true);
    else if (key === 'Enter' || key === ' ') run(active, true);
    else if (key === 'Escape' || key === 'Tab') onClose();
    else return;
    e.preventDefault();
  };

  const row = (it: MenuItem, i: number, opts: { id: string; isActive: boolean; open?: boolean; onEnter: () => void; onClick: () => void; nested?: boolean }) => (
    <div
      // nur Einträge des Hauptmenüs (Untermenü-Zeilen haben dieselben Indizes und würden die Position verfälschen)
      ref={opts.nested || opts.id !== `ctxmenu-${i}` ? undefined : (el) => void (itemRefs.current[i] = el)}
      id={opts.id}
      role="menuitem"
      aria-disabled={it.disabled || undefined}
      aria-haspopup={it.items ? 'menu' : undefined}
      aria-expanded={it.items ? !!opts.open : undefined}
      className={`ctxmenu__item${opts.isActive ? ' is-active' : ''}${it.danger ? ' is-danger' : ''}${opts.nested ? ' ctxmenu__item--nested' : ''}`}
      onPointerEnter={() => !it.disabled && opts.onEnter()}
      onClick={opts.onClick}
    >
      <span>{it.label}</span>
      {it.items ? <Chevron open={inline && opts.open} /> : it.shortcut && <kbd>{it.shortcut}</kbd>}
    </div>
  );

  const subList = (nested: boolean) =>
    subItems.map((it, j) => (
      <Fragment key={it.label}>
        {it.sep && j > 0 && <div className="ctxmenu__sep" role="separator" />}
        {row(it, j, {
          id: `ctxmenu-${sub}-${j}`,
          isActive: inSub && j === subActive,
          nested,
          onEnter: () => {
            setInSub(true);
            setSubActive(j);
          },
          onClick: () => runItem(it),
        })}
      </Fragment>
    ));

  return (
    <>
      <div
        ref={ref}
        className="ctxmenu panel"
        role="menu"
        aria-label="Kontextmenü"
        tabIndex={-1}
        aria-activedescendant={inSub && sub !== null ? `ctxmenu-${sub}-${subActive}` : `ctxmenu-${active}`}
        style={{ left: pos.x, top: pos.y }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {items.map((it, i) => (
          <Fragment key={it.label}>
            {it.sep && i > 0 && <div className="ctxmenu__sep" role="separator" />}
            {row(it, i, {
              id: `ctxmenu-${i}`,
              isActive: i === active && !inSub,
              open: sub === i,
              onEnter: () => {
                setActive(i);
                setInSub(false);
                // am Rechner öffnet Überfahren das Untermenü (und schließt ein anderes)
                if (!inline) {
                  if (it.items) openSub(i, false);
                  else if (sub !== null) closeSub();
                }
              },
              onClick: () => run(i),
            })}
            {inline && sub === i && (
              <div className="ctxmenu__inline" role="group" aria-label={it.label}>
                {subList(true)}
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {!inline && sub !== null && (
        <div
          ref={subRef}
          className="ctxmenu ctxmenu--sub panel"
          role="menu"
          aria-label={items[sub]?.label}
          style={{ left: subPos?.x ?? -9999, top: subPos?.y ?? 0 }}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerEnter={() => setInSub(true)}
        >
          {subList(false)}
        </div>
      )}
    </>
  );
}
