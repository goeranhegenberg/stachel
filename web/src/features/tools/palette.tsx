// Befehlspalette (Q3, Strg K / ⌘ K): alle Befehle aus den Registern zum Suchen und Ausführen – Werkzeuge,
// Tastenkürzel mit Aktion, Board-Menü, Menü der Auswahl und der leeren Fläche (Untermenüs als „Ausrichten › Links“).
// Die App hat dasselbe als „Befehl suchen …“ im Board-Menü (stachel_board features/commands).
import { useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import { menuItems, shortcuts, tools } from '../../editor/ext/registry';
import type { EditorApi } from '../../editor/ext/types';
import type { MenuItem } from '../../editor/interaction/ContextMenu';
import { center, unionRects, type Point } from '../../board/geometry';
import { Modal } from '../../ui/Modal';
import { IconSearch } from '../../ui/icons';
import { findMatch, foldQuery, fold } from '../../ui/search';

export interface Command {
  id: string;
  label: string;
  /** Gruppe in der Liste */
  group: string;
  /** Kürzel als Text („Strg F“) */
  keys?: string;
  run: () => void;
}

/** Reihenfolge der Gruppen in der Palette. */
export const COMMAND_GROUPS = ['Auswahl', 'Werkzeuge', 'Board', 'Fläche', 'Bearbeiten', 'Ansicht'] as const;

/** Menüeinträge flach: Untermenüs als „Eltern › Kind“, deaktivierte fallen weg. */
export function flattenMenu(items: readonly MenuItem[], prefix = ''): { label: string; shortcut?: string; run: () => void }[] {
  const out: { label: string; shortcut?: string; run: () => void }[] = [];
  for (const it of items) {
    if (it.disabled) continue;
    const label = prefix ? `${prefix} › ${it.label}` : it.label;
    if (it.items?.length) out.push(...flattenMenu(it.items, label));
    else if (it.onSelect) out.push({ label, shortcut: it.shortcut, run: it.onSelect });
  }
  return out;
}

const norm = (s: string) => s.replace(/\s*…$/, '').trim().toLocaleLowerCase('de');

/**
 * Alle Befehle für den Moment: Menü der Auswahl (wenn etwas gewählt ist), Werkzeuge, Board-Menü, Menü der leeren Fläche
 * (an der Bildmitte), Kürzel mit Aktion. Gleich benannte Befehle nur einmal (der erste gewinnt).
 */
export function collectCommands(api: EditorApi): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  const add = (c: Command) => {
    const k = norm(c.label);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  const menu = (on: 'object' | 'canvas' | 'board', at: Point, group: string) => {
    const items = menuItems
      .list()
      .filter((d) => d.on === on)
      .map((d) => {
        try {
          return d.item(api, at);
        } catch {
          return null;
        }
      })
      .filter((x): x is MenuItem => !!x);
    for (const it of flattenMenu(items)) add({ id: `${on}:${it.label}`, label: it.label, group, keys: it.shortcut, run: it.run });
  };
  const sel = api.selected();
  if (sel.length) {
    const r = unionRects(sel.map((o) => api.bounds(o)).filter((b): b is NonNullable<typeof b> => !!b));
    menu('object', r ? center(r) : api.viewCenter(), 'Auswahl');
  }
  for (const t of tools.list()) {
    add({ id: `tool:${t.id}`, label: t.hint ?? t.label, group: 'Werkzeuge', keys: t.key?.toUpperCase(), run: () => (t.action ? t.action(api) : api.setTool(t.id)) });
  }
  menu('board', api.viewCenter(), 'Board');
  menu('canvas', api.viewCenter(), 'Fläche');
  for (const s of shortcuts.list()) {
    if (!s.run || !s.help || !s.keys?.length || s.scope === 'editing' || s.id === PALETTE_ID) continue;
    const run = s.run;
    add({
      id: `key:${s.id}`,
      label: s.help.label,
      group: s.help.group === 'Ansicht' ? 'Ansicht' : 'Bearbeiten',
      keys: s.help.keys,
      run: () => void run(api, new KeyboardEvent('keydown')),
    });
  }
  const rank = (g: string) => (COMMAND_GROUPS as readonly string[]).indexOf(g);
  return out.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.group) - rank(b.c.group) || a.i - b.i).map((x) => x.c);
}

/** Treffer für `query` (wie die Suche: ohne Groß/Klein, Umlaut-tolerant); Wortanfang zuerst, sonst Reihenfolge. */
export function filterCommands(list: readonly Command[], query: string): Command[] {
  const q = foldQuery(query);
  if (!q) return [...list];
  const scored = list
    .map((c, i) => {
      const hay = `${c.label} ${c.group}`;
      const m = findMatch(hay, query);
      if (!m) return null;
      const f = fold(c.label).text;
      const score = f.startsWith(q) ? 0 : new RegExp(`(^|[\\s›(„-])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(f) ? 1 : 2;
      return { c, i, score };
    })
    .filter((x): x is { c: Command; i: number; score: number } => !!x);
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((x) => x.c);
}

export const PALETTE_ID = 'tools.palette';

export function CommandPalette({ api, onClose }: { api: EditorApi; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const all = useMemo(() => collectCommands(api), [api]);
  const list = useMemo(() => filterCommands(all, q), [all, q]);
  const listRef = useRef<HTMLUListElement>(null);
  const cur = Math.min(index, Math.max(0, list.length - 1));
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // nach dem Schließen (Fokus zurück aufs Board), damit Dialoge/Werkzeuge des Befehls normal starten
    requestAnimationFrame(() => c.run());
  };
  const move = (d: number) => {
    if (!list.length) return;
    const next = (cur + d + list.length) % list.length;
    setIndex(next);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e: RKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(list[cur]);
    }
  };
  let lastGroup = '';
  return (
    <Modal title="Befehl suchen" onClose={onClose} labelledBy="palette-title">
      <label className="tools-keys__search">
        <IconSearch size={18} />
        <input
          type="search"
          placeholder="Befehl suchen …"
          aria-label="Befehl suchen"
          role="combobox"
          aria-expanded="true"
          aria-controls="tools-palette-list"
          aria-activedescendant={list[cur] ? `tools-palette-${cur}` : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKey}
          data-autofocus
          data-testid="palette-input"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <ul className="tools-palette" id="tools-palette-list" role="listbox" aria-label="Befehle" ref={listRef} data-testid="palette-list">
        {!list.length && <li className="tools-keys__none">Kein Befehl passt zu „{q.trim()}“.</li>}
        {list.map((c, i) => {
          const head = !q.trim() && c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <li key={c.id} role="presentation">
              {head && <div className="tools-palette__group">{head}</div>}
              <button
                type="button"
                role="option"
                id={`tools-palette-${i}`}
                aria-selected={i === cur}
                data-index={i}
                className={`tools-palette__item${i === cur ? ' is-active' : ''}`}
                onMouseMove={() => i !== cur && setIndex(i)}
                onClick={() => run(c)}
                tabIndex={-1}
              >
                <span className="tools-palette__label">{c.label}</span>
                {q.trim() && <span className="tools-palette__where">{c.group}</span>}
                {c.keys && <kbd className="tools-palette__keys">{c.keys}</kbd>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
