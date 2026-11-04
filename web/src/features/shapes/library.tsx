// Bibliothek in der Seitenleiste (Formen-, Sticker- und Icon-Panels): Suche, Klick wählt das Werkzeug,
// Ziehen legt das Objekt direkt an der Ablagestelle an. Dazu das Untermenü des Formen-Werkzeugs.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ShapeKind } from '../../protocol';
import type { Point } from '../../board/geometry';
import { defineShortcut, defineSidebarTab, defineTool, tools } from '../../editor/ext/registry';
import { setToolOption, useToolOption } from '../../editor/ext/toolOptions';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { entryById, matches, searchShapes, SECTIONS, SHAPE_ENTRIES, type ShapeEntry } from './catalog';
import { EMOJI_GROUPS, recentEmoji, searchEmoji } from './emoji';
import type { IconEntry } from './iconSet';
import { ShapeIcon } from './kinds';
import { armSticker, ItemPreview, place, type PlaceItem } from './stickers';
import { STAMPS } from './stamps';

type Tab = 'shapes' | 'stickers' | 'icons';
const TABS: { id: Tab; label: string; search: string }[] = [
  { id: 'shapes', label: 'Formen', search: 'Formen suchen' },
  { id: 'stickers', label: 'Sticker', search: 'Emoji oder Stempel suchen' },
  { id: 'icons', label: 'Icons', search: 'Icons suchen' },
];

// ---- Aktionen ---------------------------------------------------------------------------------------------------------------

const narrow = () => typeof window !== 'undefined' && window.innerWidth < 700;

function armShape(api: EditorApi, e: ShapeEntry) {
  setToolOption('shape', 'kind', e.kind);
  setToolOption('shape', 'entry', e.id);
  api.setTool('shape');
  if (narrow()) api.openSidebar(null);
}

function dropShape(api: EditorApi, e: ShapeEntry, p: Point) {
  api.create(
    { type: 'shape', shape: e.kind, x: Math.round(p.x - e.w / 2), y: Math.round(p.y - e.h / 2), w: e.w, h: e.h, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: '', fontSize: 20 },
    { select: true },
  );
}

function armItem(api: EditorApi, item: PlaceItem) {
  armSticker(api, item);
  if (narrow()) api.openSidebar(null);
}

// ---- Ziehen aus der Bibliothek aufs Board ----------------------------------------------------------------------------------

interface Ghost {
  x: number;
  y: number;
  node: ReactNode;
}

/** Kachel: Klick = `onClick`, Ziehen aufs Board = `onDrop(Weltpunkt)`. */
function useTileDrag(api: EditorApi) {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const dragged = useRef(false);
  const bind = (node: ReactNode, onClick: () => void, onDrop: (p: Point) => void) => ({
    // Klick (auch Tastatur) erst im click-Ereignis: schließt sich danach das Blatt (Handy), landet kein
    // nachgereichter Klick auf dem, was darunter liegt
    onClick: () => {
      if (dragged.current) dragged.current = false;
      else onClick();
    },
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      dragged.current = false;
      const move = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        dragging = true;
        setGhost({ x: ev.clientX, y: ev.clientY, node });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        setGhost(null);
        if (!dragging) return;
        dragged.current = true;
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const board = document.querySelector('[data-testid="board"]');
        if (!board || !under || !board.contains(under) || under.closest('.panel')) return;
        const r = board.getBoundingClientRect();
        onDrop(api.toWorld({ x: ev.clientX - r.left, y: ev.clientY - r.top }));
      };
      const cancel = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        setGhost(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
  });
  // im body, damit die Seitenleiste (overflow, Animation) den Geist nicht abschneidet
  const ghostEl =
    ghost &&
    createPortal(
      <div className="shapes-drag-ghost" style={{ transform: `translate(${ghost.x}px, ${ghost.y}px)` }} aria-hidden="true">
        {ghost.node}
      </div>,
      document.body,
    );
  return { bind, ghostEl };
}

// ---- Icons erst bei Bedarf laden (eigener Chunk) -----------------------------------------------------------------------------

let iconCache: IconEntry[] | null = null;
/** Icons laden; ein Fehlschlag (z. B. neu gebautes Bundle) wird einmal wiederholt, danach gibt es „Erneut versuchen“. */
function useIcons(active: boolean): { icons: IconEntry[] | null; failed: boolean; retry: () => void } {
  const [icons, setIcons] = useState<IconEntry[] | null>(iconCache);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active || icons) return;
    let alive = true;
    setFailed(false);
    const load = (left: number): void => {
      import('./iconSet')
        .then((m) => {
          iconCache = m.ICONS;
          if (alive) setIcons(m.ICONS);
        })
        .catch(() => {
          if (!alive) return;
          if (left > 0) window.setTimeout(() => alive && load(left - 1), 1200);
          else setFailed(true);
        });
    };
    load(1);
    return () => {
      alive = false;
    };
  }, [active, icons, attempt]);
  return { icons, failed, retry: () => setAttempt((n) => n + 1) };
}

// ---- Panel ------------------------------------------------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="shapes-lib__section">
      <h3 className="shapes-lib__h">{title}</h3>
      {children}
    </section>
  );
}

function LibraryPanel({ api }: SlotProps) {
  const [tab, setTab] = useToolOption<Tab>('shapes.library', 'tab', 'shapes');
  const [q, setQ] = useState('');
  const { bind, ghostEl } = useTileDrag(api);
  const { icons, failed, retry } = useIcons(tab === 'icons');
  const [kind] = useToolOption<ShapeKind>('shape', 'kind', 'rect');
  const [entryId] = useToolOption<string | undefined>('shape', 'entry', undefined);
  const activeTool = api.tool();

  useEffect(() => setQ(''), [tab]);

  const shapeTile = (e: ShapeEntry) => {
    const on = activeTool === 'shape' && kind === e.kind && (entryId ?? e.id) === e.id;
    return (
      <button key={e.id} className={`shapes-tile shapes-tile--shape${on ? ' is-active' : ''}`} title={`${e.label} – klicken oder aufs Board ziehen`} aria-label={e.label} {...bind(<ShapeIcon kind={e.kind} w={e.w} h={e.h} size={44} />, () => armShape(api, e), (p) => dropShape(api, e, p))}>
        <ShapeIcon kind={e.kind} w={e.w} h={e.h} size={34} />
        <span>{e.label}</span>
      </button>
    );
  };
  const itemTile = (item: PlaceItem, label: string, key: string) => (
    <button key={key} className="shapes-tile shapes-tile--item" title={label} aria-label={label} {...bind(<ItemPreview item={item} size={52} />, () => armItem(api, item), (p) => place(api, item, p, false))}>
      <ItemPreview item={item} size={item.kind === 'icon' ? 24 : 30} />
    </button>
  );
  const stampTile = (id: string, label: string) => itemTile({ kind: 'stamp', id }, `Stempel ${label}`, `stamp-${id}`);
  const emojiTile = (ch: string, keyPrefix = '') => itemTile({ kind: 'emoji', ch }, `Emoji ${ch}`, `${keyPrefix}${ch}`);
  const iconTile = (i: IconEntry) => itemTile({ kind: 'icon', name: i.name, label: i.label, node: i.node }, `Icon ${i.label}`, i.name);

  let body: ReactNode;
  if (tab === 'shapes') {
    const found = q.trim() ? searchShapes(q) : null;
    body = found ? (
      found.length ? (
        <div className="shapes-grid shapes-grid--shapes">{found.map(shapeTile)}</div>
      ) : (
        <p className="shapes-empty">Keine Form gefunden.</p>
      )
    ) : (
      SECTIONS.map((s) => (
        <Section key={s.id} title={s.label}>
          <div className="shapes-grid shapes-grid--shapes">{SHAPE_ENTRIES.filter((e) => e.section === s.id).map(shapeTile)}</div>
        </Section>
      ))
    );
  } else if (tab === 'stickers') {
    if (q.trim()) {
      const stamps = STAMPS.filter((s) => matches(q, s.label, 'stempel'));
      const emoji = searchEmoji(q);
      body =
        stamps.length + emoji.length ? (
          <div className="shapes-grid">
            {stamps.map((s) => stampTile(s.id, s.label))}
            {emoji.slice(0, 160).map((e) => emojiTile(e.ch))}
          </div>
        ) : (
          <p className="shapes-empty">Nichts gefunden.</p>
        );
    } else
      body = (
        <>
          <Section title="Stempel">
            <div className="shapes-grid">{STAMPS.map((s) => stampTile(s.id, s.label))}</div>
          </Section>
          <Section title="Zuletzt verwendet">
            <div className="shapes-grid">{recentEmoji().map((ch) => emojiTile(ch, 'r-'))}</div>
          </Section>
          {EMOJI_GROUPS.map((g) => (
            <Section key={g.id} title={g.label}>
              <div className="shapes-grid">{g.items.map((e) => emojiTile(e.ch, `${g.id}-`))}</div>
            </Section>
          ))}
        </>
      );
  } else if (!icons)
    body = failed ? (
      <p className="shapes-empty">
        Icons konnten nicht geladen werden.{' '}
        <button className="ctx-chip" onClick={retry}>
          Erneut versuchen
        </button>
      </p>
    ) : (
      <p className="shapes-empty">Icons werden geladen …</p>
    );
  else {
    const list = q.trim() ? icons.filter((i) => matches(q, i.label, i.keys)) : null;
    body = list ? (
      list.length ? (
        <div className="shapes-grid">{list.map(iconTile)}</div>
      ) : (
        <p className="shapes-empty">Kein Icon gefunden.</p>
      )
    ) : (
      [...new Set(icons.map((i) => i.group))].map((g) => (
        <Section key={g} title={g}>
          <div className="shapes-grid">{icons.filter((i) => i.group === g).map(iconTile)}</div>
        </Section>
      ))
    );
  }

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <div className="shapes-lib">
      <div className="shapes-seg" role="tablist" aria-label="Bibliothek">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab} className={`shapes-seg__btn${t.id === tab ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <label className="shapes-search-wrap">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <input className="shapes-search" type="search" placeholder={current.search} aria-label={current.search} value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Esc: erst leeren, dann das Feld verlassen (Board-Kürzel wirken wieder)
            if (e.key === 'Escape') {
              e.preventDefault();
              if (q) setQ('');
              else e.currentTarget.blur();
            }
          }}
        />
      </label>
      <p className="shapes-lib__hint">Klicken und aufs Board tippen – oder direkt hinziehen.</p>
      <div className="shapes-lib__body">{body}</div>
      {ghostEl}
    </div>
  );
}

function IconLibrary({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <circle cx="17" cy="7" r="3.5" />
      <path d="M7 13.5 10.5 20h-7Z" />
      <path d="m17 13.2 1.1 2.3 2.5.4-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.4Z" />
    </svg>
  );
}

defineSidebarTab({ id: 'shapes.library', title: 'Bibliothek', order: 40, Icon: IconLibrary, Panel: LibraryPanel });

// ---- Untermenü des Formen-Werkzeugs ---------------------------------------------------------------------------------------

const QUICK = ['rect', 'roundrect', 'circle', 'triangle', 'diamond', 'star', 'arrowRight', 'callout', 'cloud', 'cylinder'];

function ShapeOptions({ api }: { api: EditorApi }) {
  const [kind, setKind] = useToolOption<ShapeKind>('shape', 'kind', 'rect');
  const [entry, setEntry] = useToolOption<string | undefined>('shape', 'entry', undefined);
  const quick = useMemo(() => QUICK.map((id) => entryById(id)!).filter(Boolean), []);
  // gewählte Form aus der Bibliothek, die nicht in der Schnellauswahl steht, vorne anzeigen
  const extra = !quick.some((e) => e.kind === kind) ? (entryById(entry) ?? SHAPE_ENTRIES.find((e) => e.kind === kind)) : undefined;
  const list = extra ? [extra, ...quick] : quick;
  const activeId = list.some((x) => x.id === entry && x.kind === kind) ? entry : list.find((x) => x.kind === kind)?.id;
  return (
    <div className="shapes-fly-grid">
      {list.map((e) => (
        <button
          key={e.id}
          className={`fly-btn${e.id === activeId ? ' is-active' : ''}`}
          aria-label={e.label}
          title={e.label}
          onClick={() => {
            setKind(e.kind);
            setEntry(e.id);
          }}
        >
          <ShapeIcon kind={e.kind} w={e.w} h={e.h} />
        </button>
      ))}
      <button
        className="fly-btn shapes-fly-more"
        aria-label="Alle Formen"
        title="Alle Formen"
        onClick={() => {
          setToolOption('shapes.library', 'tab', 'shapes');
          api.openSidebar('shapes.library');
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.3" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="3.25" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.3" />
          <path d="M16.75 13.5v6.5M13.5 16.75H20" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

defineTool({ ...tools.get('shape')!, Options: ShapeOptions });


// Kürzel: R = Rechteck, O = Kreis (Formen-Werkzeug mit dieser Form)
const pickShape = (id: string) => (api: EditorApi) => {
  const e = entryById(id)!;
  setToolOption('shape', 'kind', e.kind);
  setToolOption('shape', 'entry', e.id);
  api.setTool('shape');
  api.setSelection([]);
};
defineShortcut({ id: 'shapes.rect', keys: ['r'], late: true, run: pickShape('rect'), help: { group: 'Werkzeuge', keys: 'R / O', label: 'Rechteck / Kreis', order: 100 } });
defineShortcut({ id: 'shapes.circle', keys: ['o'], late: true, run: pickShape('circle') });
