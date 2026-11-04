// Mindmap: Werkzeug, Knoten-Typ, Linien und Knöpfe (Kind, Einklappen), Tab = Kind, Enter = Geschwister,
// Pfeiltasten wandern durch den Baum, Layout automatisch (ops.ts). Ziehen auf einen Knoten hängt um.
import { useEffect, type CSSProperties } from 'react';
import type * as Y from 'yjs';
import type { BoardObject } from '../../../protocol';
import { LOCAL_ORIGIN, type BoardStore, type Snapshot } from '../../../board/store';
import { textOn } from '../../../board/colors';
import { placeStyle } from '../../../editor/render/format';
import { useFontsVersion } from '../../../editor/textMeasure';
import { Editable } from '../../../editor/text/plainEngine';
import { defineContextAction, defineMenuItem, defineObjectType, defineShortcut, defineSlot, shortcuts } from '../../../editor/ext/registry';
import type { EditorApi, ObjectViewProps, SlotProps } from '../../../editor/ext/types';
import { IconChild, IconCollapse, IconSibling } from '../icons';
import { addChild, addSibling, childrenOf, dropNodes, isMind, isRootNode, layoutPatches, mindNodes, neighbor, newRoot, rootOf, subtree, toggleCollapse, withDescendants, commitMind } from './ops';
import { MIND_COLORS, MIND_PLACEHOLDER, mindStyle } from './style';
import { levelOf, MindEdges } from './edges';

// ---- Knoten ---------------------------------------------------------------------------------------------------------

function MindView({ o, editing, cb }: ObjectViewProps) {
  useFontsVersion();
  if (o.mind?.hidden) return <div className="obj structure-mind is-hidden" data-id={o.id} data-type="mindnode" style={{ display: 'none' }} />;
  const level = levelOf(o);
  const st = mindStyle(level);
  const color = o.color ?? (level === 0 ? '#0a0a0a' : MIND_COLORS[0]);
  const kind = level === 0 ? 'root' : level === 1 ? 'main' : 'sub';
  const placeholder = MIND_PLACEHOLDER[Math.min(level, 2)];
  const tStyle: CSSProperties = {
    fontSize: st.fs,
    fontWeight: o.bold ? 800 : st.weight,
    fontStyle: o.italic ? 'italic' : undefined,
    textDecoration: o.strike ? 'line-through' : undefined,
    fontFamily: st.family === 'Barlow' ? undefined : `${st.family}, var(--font-cond)`,
    lineHeight: st.lh,
    letterSpacing: st.ls ? `${st.ls}em` : undefined,
    padding: `${st.padY}px ${st.padX}px`,
  };
  const style = placeStyle(o, { '--mind': color, '--mind-ink': level === 0 ? textOn(color) : '#0a0a0a', borderRadius: kind === 'sub' ? 0 : Math.min(o.h / 2, 26) } as CSSProperties);
  return (
    <div className={`obj structure-mind structure-mind--${kind}`} data-id={o.id} data-type="mindnode" style={style}>
      {editing ? (
        <Editable id={o.id} className="structure-mind__text" initial={o.text ?? ''} current={o.text ?? ''} style={tStyle} placeholder={placeholder} cb={cb} />
      ) : (
        <div className="structure-mind__text" style={tStyle}>
          {o.text || <span className="structure-mind__ph">{placeholder}</span>}
        </div>
      )}
    </div>
  );
}

defineObjectType({
  type: 'mindnode',
  label: 'Mindmap-Knoten',
  View: MindView,
  simpleStyle: (o) => {
    if (o.mind?.hidden) return { display: 'none' };
    const level = levelOf(o);
    const color = o.color ?? MIND_COLORS[0];
    if (level === 0) return { background: color, borderRadius: o.h / 2 };
    if (level === 1) return { background: '#fff', boxShadow: `inset 0 0 0 ${Math.max(3, o.h * 0.08)}px ${color}`, borderRadius: o.h / 2 };
    return { borderBottom: `${Math.max(3, o.h * 0.1)}px solid ${color}` };
  },
  // Treffer nur über das DOM: versteckte Knoten (eingeklappt) liegen sonst unsichtbar über ihren Eltern
  hit: 'none',
  create: (p) => newRoot(p),
  edit: 'text',
  onEditDone: dropIfEmpty,
  plainText: (o) => o.text,
  invisible: (o) => !!o.mind?.hidden,
  palette: MIND_COLORS,
  defaultColor: MIND_COLORS[0],
  handles: () => [],
  snapTarget: false,
  // Kopieren: Elternbezug umschreiben; ohne mitkopierten Elternknoten wird der Knoten zur Wurzel
  remap: (clone, o, ctx) => {
    const parent = o.mind?.parent ? ctx.map(o.mind.parent) : undefined;
    const mind = { ...o.mind, parent };
    if (!parent) {
      delete mind.parent;
      delete mind.side;
      delete mind.hidden;
      mind.level = 0;
    }
    return { ...clone, mind };
  },
});

// ---- Tastatur -------------------------------------------------------------------------------------------------------

/** Einzeln ausgewählter, nicht gesperrter Knoten. */
function selectedNode(api: EditorApi): BoardObject | null {
  const sel = api.selected();
  return sel.length === 1 && isMind(sel[0]) && !sel[0].locked && !sel[0].mind?.hidden ? sel[0] : null;
}

const editNode = (api: EditorApi, id: string | null) => {
  const o = id ? api.store.get(id) : undefined;
  if (o) api.startEditing(o);
};

/** Gerade angelegte Knoten → Undo-Tiefe vor dem Anlegen. Bleibt so ein Knoten leer, verschwindet er wieder (B11). */
const fresh = new Map<string, number>();

/** Knoten anlegen (Kind bzw. Geschwister) und gleich bearbeiten. */
function addAndEdit(api: EditorApi, add: () => string | null) {
  const depth = api.store.undoDepth();
  const id = add();
  if (id) fresh.set(id, depth);
  editNode(api, id);
}

/** Bearbeitung eines neuen Knotens ohne Text beendet: Anlegen zurücknehmen (wie nie geschehen, nicht wiederholbar). */
function dropIfEmpty(o: BoardObject, api: EditorApi) {
  const depth = fresh.get(o.id);
  fresh.delete(o.id);
  if (depth === undefined) return;
  // nach dem Ende der Bearbeitung prüfen (Text ist dann geschrieben; Tab/Enter legen evtl. schon ein Kind an)
  queueMicrotask(() => {
    const now = api.store.get(o.id);
    if (!now || (now.text ?? '').trim() || api.editingId() === o.id) return;
    if (childrenOf(mindNodes(api.snapshot()), o.id).length) return;
    const parent = now.mind?.parent;
    api.store.revertTo(depth);
    if (!api.store.get(o.id)) api.setSelection(parent && api.store.get(parent) ? [parent] : []);
  });
}

/** Bearbeitung beenden (Text bleibt), dann `fn` auf dem aktuellen Stand des Knotens. */
function afterEdit(api: EditorApi, fn: (o: BoardObject) => void): boolean {
  const id = api.editingId();
  const o = id ? api.store.get(id) : undefined;
  if (!isMind(o)) return false;
  (document.activeElement as HTMLElement | null)?.blur();
  fn(api.store.get(o.id)!);
  return true;
}

const coreTab = shortcuts.get('edit.tab');
if (coreTab) {
  // Tab beim Schreiben: im Mindmap-Knoten ein Unterthema, sonst wie bisher (nächste Haftnotiz)
  defineShortcut({
    ...coreTab,
    run: (api, e) => {
      if (afterEdit(api, (o) => (e.shiftKey ? undefined : addAndEdit(api, () => addChild(api.store, o))))) return;
      return coreTab.run?.(api, e);
    },
  });
}

defineShortcut({
  id: 'structure.mindTab',
  keys: ['Tab'],
  run: (api, e) => {
    const o = selectedNode(api);
    if (!o || e.shiftKey || e.altKey) return false;
    addAndEdit(api, () => addChild(api.store, o));
  },
  help: { group: 'Mindmap', keys: 'Tab', label: 'Unterthema anlegen', order: 10 },
});

defineShortcut({
  id: 'structure.mindEnter',
  keys: ['Enter'],
  scope: 'both',
  run: (api, e) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) return false;
    if (api.editingId()) {
      return afterEdit(api, (o) => {
        if (!isRootNode(api.snapshot().byId, o)) addAndEdit(api, () => addSibling(api.store, o));
      });
    }
    const o = selectedNode(api);
    if (!o || isRootNode(api.snapshot().byId, o)) return false;
    addAndEdit(api, () => addSibling(api.store, o));
  },
  help: { group: 'Mindmap', keys: 'Enter', label: 'Thema auf gleicher Ebene', order: 20 },
});

defineShortcut({
  id: 'structure.mindArrows',
  keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
  run: (api, e) => {
    const o = selectedNode(api);
    if (!o || e.shiftKey || e.altKey) return false;
    const snap = api.snapshot();
    const n = neighbor(snap, o, e.key);
    // am Rand nichts verschieben – nur die Wurzel lässt sich mit ↑/↓ samt Mindmap bewegen
    if (!n) return !isRootNode(snap.byId, o) || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    api.setSelection([n.id]);
    const s = api.toScreen({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    const v = api.viewSize();
    if (s.x < 60 || s.y < 60 || s.x > v.w - 60 || s.y > v.h - 60) api.centerOn({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
  help: { group: 'Mindmap', keys: 'Pfeiltasten', label: 'Zwischen Themen wechseln', order: 30 },
});

defineShortcut({
  id: 'structure.mindDelete',
  keys: ['Delete', 'Backspace'],
  run: (api) => {
    const sel = api.selected().filter((o) => !o.locked);
    if (!sel.some(isMind)) return false;
    // Knoten samt Unterthemen in einem Schritt löschen, Layout der restlichen Mindmap nachziehen
    commitMind(api.store, { remove: withDescendants(api.snapshot(), sel.map((o) => o.id)) });
    api.setSelection([]);
  },
});

defineShortcut({
  id: 'structure.mindCollapse',
  keys: ['mod+Period', 'mod+.'],
  run: (api) => {
    const o = selectedNode(api);
    if (!o || !childrenOf(mindNodes(api.snapshot()), o.id).length) return false;
    toggleCollapse(api.store, o);
  },
  help: { group: 'Mindmap', keys: 'Strg .', label: 'Zweig ein-/ausklappen', order: 40 },
});

// ---- Kontextleiste & Menü ---------------------------------------------------------------------------------------------

defineContextAction({
  id: 'structure.mind',
  order: 75,
  when: (c) => !!c.single && isMind(c.single) && !c.locked,
  Bar: ({ api, single }) => {
    const o = single!;
    const snap = api.snapshot();
    const root = isRootNode(snap.byId, o);
    const hasKids = childrenOf(mindNodes(snap), o.id).length > 0;
    return (
      <div className="ctx-group">
        <button className="ctx-btn" aria-label="Unterthema anlegen" title="Unterthema (Tab)" onClick={() => addAndEdit(api, () => addChild(api.store, o))}>
          <IconChild />
        </button>
        {!root && (
          <button className="ctx-btn" aria-label="Thema auf gleicher Ebene" title="Gleiche Ebene (Enter)" onClick={() => addAndEdit(api, () => addSibling(api.store, o))}>
            <IconSibling />
          </button>
        )}
        {hasKids && (
          <button className="ctx-btn" aria-label={o.mind?.collapsed ? 'Zweig ausklappen' : 'Zweig einklappen'} title={o.mind?.collapsed ? 'Ausklappen (Strg .)' : 'Einklappen (Strg .)'} onClick={() => toggleCollapse(api.store, o)}>
            <IconCollapse open={!o.mind?.collapsed} />
          </button>
        )}
      </div>
    );
  },
});

defineMenuItem({
  id: 'structure.mindCollapse',
  on: 'object',
  order: 76,
  item: (api) => {
    const o = selectedNode(api);
    if (!o || !childrenOf(mindNodes(api.snapshot()), o.id).length) return null;
    return { label: o.mind?.collapsed ? 'Zweig ausklappen' : 'Zweig einklappen', shortcut: 'Strg .', onSelect: () => toggleCollapse(api.store, o) };
  },
});

// ---- Linien (Welt-Ebene, auch in der Präsentation) ----------------------------------------------------------------------

function MindLines({ snap }: SlotProps) {
  const nodes = mindNodes(snap);
  if (!nodes.length) return null;
  return (
    <svg className="structure-mind-lines" width={1} height={1} aria-hidden="true">
      <MindEdges nodes={nodes} byId={snap.byId} />
    </svg>
  );
}

defineSlot({ id: 'structure.mindLines', slot: 'world', order: 10, presenting: true, Component: MindLines });

// ---- Knöpfe am Knoten (Kind anlegen, Ein-/Ausklappen) ---------------------------------------------------------------

function MindControls({ api, snap, cam, selection }: SlotProps) {
  const nodes = mindNodes(snap);
  // Versteckte (eingeklappte) Knoten nicht ausgewählt lassen
  useEffect(() => {
    const keep = selection.filter((id) => !snap.byId.get(id)?.mind?.hidden);
    if (keep.length !== selection.length) api.setSelection(keep);
  }, [api, selection, snap]);
  if (!nodes.length) return null;
  const sel = selection.length === 1 ? snap.byId.get(selection[0]) : undefined;
  const editing = api.editingId();
  const s = 1 / cam.z;
  const btns: React.ReactNode[] = [];
  const at = (x: number, y: number): CSSProperties => ({ transform: `translate(${x}px, ${y}px) scale(${s}) translate(-50%, -50%)` });
  for (const n of nodes) {
    if (n.mind?.hidden) continue;
    const kids = childrenOf(nodes, n.id);
    const isSel = sel?.id === n.id && !n.locked && editing !== n.id;
    const root = isRootNode(snap.byId, n);
    const sides: ('l' | 'r')[] = root ? (isSel ? ['r', 'l'] : ['r']) : [n.mind?.side ?? 'r'];
    for (const side of sides) {
      const dir = side === 'r' ? 1 : -1;
      const ex = side === 'r' ? n.x + n.w : n.x;
      const ey = levelOf(n) >= 2 ? n.y + n.h : n.y + n.h / 2;
      const sideKids = root ? kids.filter((k) => (k.mind?.side ?? 'r') === side) : kids;
      const collapsed = !!n.mind?.collapsed;
      let off = 14;
      // eingeklappte Wurzel: Zahl nur rechts; eingeklappte Knoten links zeigen sie auf ihrer Seite
      if (sideKids.length && (collapsed || isSel) && (!root || side === 'r' || !collapsed)) {
        const count = subtree(nodes, n.id).length - 1;
        btns.push(
          <button
            key={`c-${n.id}-${side}`}
            className={`structure-mind-btn structure-mind-btn--toggle${collapsed ? ' is-collapsed' : ''}`}
            style={{ ...at(ex + dir * off * s, ey), '--mind': n.color ?? MIND_COLORS[0] } as CSSProperties}
            aria-label={collapsed ? `Zweig ausklappen (${count})` : 'Zweig einklappen'}
            title={collapsed ? 'Ausklappen' : 'Einklappen'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleCollapse(api.store, n)}
          >
            {collapsed ? count : '−'}
          </button>,
        );
        off += 26;
      }
      if (isSel && !collapsed) {
        btns.push(
          <button
            key={`a-${n.id}-${side}`}
            className="structure-mind-btn structure-mind-btn--add"
            style={at(ex + dir * (off + 4) * s, ey)}
            aria-label={root ? (side === 'r' ? 'Thema rechts anlegen' : 'Thema links anlegen') : 'Unterthema anlegen'}
            title="Unterthema (Tab)"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => addAndEdit(api, () => addChild(api.store, n, side))}
          >
            +
          </button>,
        );
      }
    }
  }
  return <div className="structure-mind-controls">{btns}</div>;
}

defineSlot({ id: 'structure.mindControls', slot: 'world', order: 11, Component: MindControls });

// ---- Automatisches Layout bei eigenen Änderungen (Tippen, Verschieben, Einfügen, Löschen) ------------------------------

/** Beobachtet eigene Änderungen an Mindmap-Knoten und zieht das Layout nach; beim Ziehen erst nach dem Loslassen. */
export function startMindRuntime(store: BoardStore): () => void {
  let prev: Snapshot = store.getSnapshot();
  let applying = false;
  let pointerDown = false;
  const roots = new Set<string>();
  const orphans = new Set<string>();
  const dragged = new Set<string>();
  let queued = false;

  const flush = () => {
    queued = false;
    const snap = store.getSnapshot();
    const live = [...orphans].filter((id) => snap.byId.has(id));
    orphans.clear();
    const patches = layoutPatches(mindNodes(snap), new Set([...roots].filter((id) => snap.byId.has(id))));
    roots.clear();
    if (!live.length && !Object.keys(patches).length) return;
    applying = true;
    try {
      store.transact(() => {
        if (live.length) store.remove(withDescendants(snap, live));
        store.updateMany(patches);
      });
    } finally {
      applying = false;
    }
    // nach dem Löschen verwaister Knoten: Rest neu anordnen
    if (live.length) {
      for (const n of mindNodes(store.getSnapshot())) roots.add(rootOf(store.getSnapshot().byId, n.id));
      queue();
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  };

  const onDeep = (events: Y.YEvent<any>[], tr: Y.Transaction) => {
    const snap = store.getSnapshot();
    if (tr.origin === LOCAL_ORIGIN && !applying) {
      const touched = new Set<string>();
      for (const ev of events) {
        if (ev.path.length === 0) for (const k of ev.changes.keys.keys()) touched.add(k);
        else if (typeof ev.path[0] === 'string') touched.add(ev.path[0]);
      }
      for (const id of touched) {
        const now = snap.byId.get(id);
        const before = prev.byId.get(id);
        if (!isMind(now) && !isMind(before)) continue;
        if (isMind(now)) {
          const moved = before && (now.x !== before.x || now.y !== before.y);
          // Ziehen eines Unterthemas: Layout erst nach dem Loslassen (Umhängen/Umsortieren)
          if (moved && pointerDown && !isRootNode(snap.byId, now)) {
            dragged.add(id);
            continue;
          }
          roots.add(rootOf(snap.byId, id));
        } else if (before) {
          // gelöscht: Kinder verwaisen → mitlöschen, Eltern-Mindmap neu anordnen
          for (const k of mindNodes(snap)) if (k.mind?.parent === id) orphans.add(k.id);
          const p = before.mind?.parent;
          if (p && snap.byId.has(p)) roots.add(rootOf(snap.byId, p));
        }
      }
      if (roots.size || orphans.size) queue();
    }
    prev = snap;
  };

  const down = () => {
    pointerDown = true;
  };
  const up = () => {
    pointerDown = false;
    if (!dragged.size) return;
    const ids = [...dragged];
    dragged.clear();
    // nach den Handlern des Editors (Loslassen schreibt die letzte Position)
    queueMicrotask(() => {
      applying = true;
      try {
        dropNodes(store, ids);
      } finally {
        applying = false;
      }
    });
  };
  store.objects.observeDeep(onDeep);
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  return () => {
    store.objects.unobserveDeep(onDeep);
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
}

function MindRuntime({ api }: SlotProps) {
  const store = api.store;
  useEffect(() => startMindRuntime(store), [store]);
  return null;
}

defineSlot({ id: 'structure.mindRuntime', slot: 'overlay', order: 1, presenting: true, Component: MindRuntime });
