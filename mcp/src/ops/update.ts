// Ändern und Löschen: Felder je Typ prüfen, Rahmen nehmen ihren Inhalt mit, Mindmaps werden neu gelayoutet.
import type { Obj, Patch } from '../board/model';
import { boundsOf, contains } from '../board/geometry';
import { kindOf, type UpdateInput } from '../kinds/kinds';
import { color, textFields, ToolError, type BuildCtx } from '../kinds/common';
import { layoutPatches, mindRoot, mindSubtree } from './mindmap';
import type { Snap } from './read';

const FILL_TYPES = new Set(['sticky', 'shape', 'frame']);
const TEXT_TYPES = new Set(['sticky', 'text', 'shape']);

export interface UpdatePlan {
  patches: Record<string, Patch>;
  notes: string[];
}

const merge = (patches: Record<string, Patch>, id: string, p: Patch) => {
  if (Object.keys(p).length) patches[id] = { ...(patches[id] ?? {}), ...p };
};

export function planUpdate(items: UpdateInput[], s: Snap, ctx: BuildCtx): UpdatePlan {
  const patches: Record<string, Patch> = {};
  const notes: string[] = [];
  const mindRoots = new Set<string>();
  const explicit = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  for (const u of items) {
    if (seen.has(u.id)) throw new ToolError(`Objekt „${u.id}“ steht doppelt in der Liste – bitte alle Änderungen eines Objekts in einen Eintrag.`);
    seen.add(u.id);
    const o = s.byId.get(u.id);
    if (!o) throw new ToolError(`Objekt „${u.id}“ gibt es auf diesem Board nicht. Gültige IDs liefern get_objects bzw. search.`);
    const kind = kindOf(o.type);
    const allowed = new Set<string>(kind?.updatable ?? ['x', 'y', 'locked', 'hidden']);
    const given = Object.keys(u).filter((k) => k !== 'id' && (u as Record<string, unknown>)[k] !== undefined);
    const bad = given.filter((k) => !allowed.has(k));
    if (bad.length) throw new ToolError(`${kind?.label ?? o.type} „${o.id}“: ${bad.map((b) => `\`${b}\``).join(', ')} gibt es hier nicht. Änderbar: ${[...allowed].join(', ')}.`);
    if (o.locked && given.some((k) => k !== 'locked')) throw new ToolError(`„${o.id}“ ist gesperrt. Erst mit {"id": "${o.id}", "locked": false} entsperren.`);
    const p: Patch = {};
    // Lage und Größe
    if (o.type === 'mindnode') {
      const root = mindRoot(s.byId, o.id);
      if ((u.x !== undefined || u.y !== undefined) && root !== o.id) throw new ToolError(`Nur die Wurzel einer Mindmap lässt sich verschieben (hier „${root}“); Unterthemen ordnet das Layout.`);
    }
    if (u.x !== undefined) p.x = Math.round(u.x);
    if (u.y !== undefined) p.y = Math.round(u.y);
    if (u.w !== undefined) p.w = Math.round(u.w);
    if (u.h !== undefined) p.h = Math.round(u.h);
    if (u.rotation !== undefined) p.rotation = u.rotation ? ((u.rotation % 360) + 360) % 360 : undefined;
    if (u.locked !== undefined) p.locked = u.locked || undefined;
    if (u.hidden !== undefined) p.hidden = u.hidden || undefined;
    if (u.linkTo !== undefined) {
      if (u.linkTo && !s.byId.has(u.linkTo)) throw new ToolError(`linkTo: Objekt „${u.linkTo}“ gibt es nicht.`);
      p.linkTo = u.linkTo || undefined;
    }
    if (u.color !== undefined) p.color = color(u.color, FILL_TYPES.has(o.type) ? 'fill' : 'ink');
    if (u.text !== undefined && TEXT_TYPES.has(o.type)) Object.assign(p, textFields(u.text, o.type));
    if (TEXT_TYPES.has(o.type) || o.type === 'connector') {
      if (u.fontSize !== undefined) p.fontSize = u.fontSize;
      if (u.bold !== undefined) p.bold = u.bold || undefined;
      if (u.italic !== undefined) p.italic = u.italic || undefined;
      if (u.strike !== undefined) p.strike = u.strike || undefined;
      if (u.align !== undefined) p.align = u.align;
      if (u.valign !== undefined) p.valign = u.valign;
      if (u.fontFamily !== undefined) p.fontFamily = u.fontFamily === 'default' ? undefined : u.fontFamily;
    }
    if (o.type === 'mindnode') {
      const mind: Record<string, unknown> = { ...(o.mind ?? {}) };
      if (u.text !== undefined) p.text = u.text.replace(/\s*\n\s*/g, ' ').slice(0, 500);
      if (u.collapsed !== undefined) {
        if (u.collapsed) mind.collapsed = true;
        else delete mind.collapsed;
      }
      if (u.side !== undefined) {
        if ((o.mind?.level ?? 0) !== 1) throw new ToolError('`side` gilt nur für Hauptthemen (Kinder der Wurzel).');
        mind.side = u.side === 'left' ? 'l' : 'r';
      }
      if (u.parent !== undefined) {
        const np = s.byId.get(u.parent);
        if (!np || np.type !== 'mindnode') throw new ToolError(`Neuer Elternknoten „${u.parent}“ ist kein Mindmap-Knoten.`);
        const minds = s.all.filter((k) => k.type === 'mindnode');
        if (mindSubtree(minds, o.id).includes(np.id)) throw new ToolError('Ein Knoten kann nicht unter sich selbst bzw. seine Unterthemen gehängt werden.');
        mindRoots.add(mindRoot(s.byId, o.id));
        mind.parent = np.id;
        mind.order = Math.max(-1, ...minds.filter((k) => k.mind?.parent === np.id).map((k) => Number(k.mind?.order ?? 0))) + 1;
        if (mindRoot(s.byId, np.id) === np.id) mind.side = mind.side ?? 'r';
      }
      if (JSON.stringify(mind) !== JSON.stringify(o.mind ?? {})) p.mind = mind;
      // Zweigfarbe: Unterthemen mit der alten Farbe erben die neue (wie beim Anlegen)
      if (p.color && p.color !== o.color) {
        const minds = s.all.filter((k) => k.type === 'mindnode');
        for (const k of mindSubtree(minds, o.id).slice(1)) {
          const kid = s.byId.get(k)!;
          if (kid.color === o.color && !explicit.has(k)) merge(patches, k, { color: p.color });
        }
      }
      mindRoots.add(mindRoot(s.byId, o.id));
      if (u.parent !== undefined) mindRoots.add(mindRoot(s.byId, u.parent));
    }
    if (kind?.patch) Object.assign(p, kind.patch(o, u, ctx));
    merge(patches, o.id, p);
    // Rahmen verschieben: Inhalt wandert mit, außer er wird selbst geändert
    if (o.type === 'frame' && (p.x !== undefined || p.y !== undefined)) {
      const dx = Number(p.x ?? o.x) - o.x;
      const dy = Number(p.y ?? o.y) - o.y;
      if (dx || dy) {
        const fr = boundsOf(o, s.byId);
        const kids = s.all.filter((k) => k.id !== o.id && k.type !== 'connector' && !k.locked && !explicit.has(k.id) && contains(fr, boundsOf(k, s.byId)));
        for (const k of kids) {
          if (k.type === 'mindnode' && mindRoot(s.byId, k.id) !== k.id) {
            merge(patches, k.id, { x: k.x + dx, y: k.y + dy });
            continue;
          }
          merge(patches, k.id, { x: Math.round(k.x + dx), y: Math.round(k.y + dy) });
        }
        if (kids.length) notes.push(`Rahmen ${o.id}: ${kids.length} Objekte mitverschoben.`);
      }
    }
  }
  // Mindmaps neu layouten (alle Knoten der betroffenen Mindmaps im selben Schritt)
  if (mindRoots.size) {
    const nodes = s.all.filter((k) => k.type === 'mindnode').map((k) => ({ ...k, ...(patches[k.id] ?? {}) }) as Obj);
    for (const [id, lp] of Object.entries(layoutPatches(nodes, mindRoots))) merge(patches, id, lp);
  }
  return { patches, notes };
}

/** Zu löschende ids: samt Mindmap-Unterthemen (Verbinder an den Objekten löscht das Modell selbst). */
export function planDelete(ids: string[], s: Snap): { ids: string[]; mindRoots: Set<string> } {
  const out = new Set<string>();
  const minds = s.all.filter((k) => k.type === 'mindnode');
  const roots = new Set<string>();
  for (const id of ids) {
    const o = s.byId.get(id);
    if (!o) throw new ToolError(`Objekt „${id}“ gibt es auf diesem Board nicht.`);
    if (o.locked) throw new ToolError(`„${id}“ ist gesperrt. Erst mit update_objects {"id": "${id}", "locked": false} entsperren.`);
    if (o.type === 'mindnode') {
      for (const k of mindSubtree(minds, id)) out.add(k);
      const parent = o.mind?.parent as string | undefined;
      if (parent && s.byId.has(parent)) roots.add(mindRoot(s.byId, parent));
    } else out.add(id);
  }
  return { ids: [...out], mindRoots: roots };
}
