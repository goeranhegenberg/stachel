// Validierung, Anlegen, Ändern und Layout ohne Server (Y.Doc im Speicher).
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { BoardModel, type Obj } from '../src/board/model';
import { boundsOf, overlaps } from '../src/board/geometry';
import { ToolError } from '../src/kinds/common';
import { CREATABLE } from '../src/kinds/kinds';
import { newCtx, planCreate, planKanban, planNotes } from '../src/ops/create';
import { buildMind, layoutNew, parseOutline } from '../src/ops/mindmap';
import { compact, overview, snap } from '../src/ops/read';
import { planDelete, planUpdate } from '../src/ops/update';
import { layoutClusters, layoutGrid, layoutLayered, movePatches, unitsOf } from '../src/ops/layout';
import { resolveColor } from '../src/board/palette';
import { assertNoFrameClash } from '../src/ops/place';

function board() {
  const doc = new Y.Doc();
  const model = new BoardModel(doc, 'a:mara');
  const s = () => snap(model.all());
  const create = (items: any[]) => {
    const ss = s();
    const ctx = newCtx(ss, model);
    const plan = planCreate(items, ss, ctx);
    doc.transact(() => {
      model.create(plan.objs);
      model.update(plan.framePatches);
    });
    return { plan, refs: ctx.refs };
  };
  return { doc, model, s, create };
}

const noOverlap = (objs: Obj[], s: ReturnType<typeof snap>) => {
  for (let i = 0; i < objs.length; i++)
    for (let j = i + 1; j < objs.length; j++) if (overlaps(boundsOf(objs[i]!, s.byId), boundsOf(objs[j]!, s.byId))) return `${objs[i]!.id} ↔ ${objs[j]!.id}`;
  return null;
};

describe('Anlegen', () => {
  it('Notiz, Form, Text mit Standardwerten wie die Web-App; Text als Rich-Text nur bei Formatierung', () => {
    const b = board();
    const { refs } = b.create([
      { type: 'sticky', ref: 'n', text: 'Hallo', x: 0, y: 0 },
      { type: 'shape', ref: 'f', text: '**Start**', x: 300, y: 0 },
      { type: 'text', ref: 't', text: 'Überschrift', fontSize: 48, x: 0, y: -100 },
    ]);
    const n = b.model.get(refs.get('n')!)!;
    expect(n).toMatchObject({ type: 'sticky', w: 200, h: 200, color: '#fff27a', text: 'Hallo', createdBy: 'a:mara' });
    expect(n.content).toBeUndefined();
    const f = b.model.get(refs.get('f')!)!;
    expect(f).toMatchObject({ shape: 'rect', w: 180, h: 120, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: 'Start' });
    expect((b.doc.getMap('objects').get(f.id) as Y.Map<unknown>).get('content')).toBeInstanceOf(Y.XmlFragment);
    const t = b.model.get(refs.get('t')!)!;
    expect(t.autoWidth).toBe(true);
    expect(t.w).toBeGreaterThan(200);
    expect(t.h).toBe(60);
  });

  it('Rechteck-Notiz 350×200, Farbnamen deutsch/englisch', () => {
    const b = board();
    const { refs } = b.create([{ type: 'sticky', ref: 'r', text: 'x', shape: 'rect', color: 'grün', x: 0, y: 0 }]);
    expect(b.model.get(refs.get('r')!)).toMatchObject({ w: 350, h: 200, color: '#c9e14a' });
    expect(resolveColor('Pink', 'ink')).toBe('#ec4e92');
    expect(resolveColor('#ABC', 'fill')).toBe('#aabbcc');
    expect(resolveColor('lachsfarben', 'fill')).toBeNull();
  });

  it('Verbinder über refs im selben Aufruf; geschwungen + Pfeil als Standard', () => {
    const b = board();
    const { refs } = b.create([
      { type: 'shape', ref: 'a', text: 'A', x: 0, y: 0 },
      { type: 'shape', ref: 'b', text: 'B', x: 400, y: 0 },
      { type: 'connector', ref: 'c', from: 'a', to: { id: 'b', side: 'w' }, label: 'weiter' },
    ]);
    const c = b.model.get(refs.get('c')!)!;
    expect(c).toMatchObject({ from: { objectId: refs.get('a') }, to: { objectId: refs.get('b'), side: 'w' }, lineStyle: 'curved', arrowEnd: true, text: 'weiter' });
    expect(c.capEnd).toBeUndefined(); // triangle = Standard (Feld fehlt)
  });

  it('klare Fehler: unbekanntes Ziel, doppelte ref, Farbe, Verbinder auf sich selbst, halbe Lage', () => {
    const b = board();
    const err = (items: any[]) => {
      try {
        b.create(items);
      } catch (e) {
        expect(e).toBeInstanceOf(ToolError);
        return (e as Error).message;
      }
      throw new Error('kein Fehler');
    };
    expect(err([{ type: 'connector', from: 'gibtsnicht', to: { x: 0, y: 0 } }])).toMatch(/gibt es auf diesem Board nicht.*get_objects/);
    expect(err([{ type: 'sticky', ref: 'a' }, { type: 'sticky', ref: 'a' }])).toMatch(/doppelt/);
    expect(err([{ type: 'sticky', color: 'lachs' }])).toMatch(/Farbe „lachs“.*yellow/);
    expect(err([{ type: 'sticky', ref: 'x' }, { type: 'connector', from: 'x', to: 'x' }])).toMatch(/zwei verschiedene/);
    expect(err([{ type: 'sticky', x: 5 }])).toMatch(/x und y zusammen/);
    expect(b.model.all()).toHaveLength(0);
  });

  it('Zod-Schemas lehnen unbekannte Felder und falsche Werte ab', () => {
    const sticky = CREATABLE.find((k) => k.type === 'sticky')!.create!;
    expect(sticky.safeParse({ type: 'sticky', text: 'a', farbe: 'gelb' }).success).toBe(false);
    expect(sticky.safeParse({ type: 'sticky', shape: 'circle' }).success).toBe(false);
    const shape = CREATABLE.find((k) => k.type === 'shape')!.create!;
    expect(shape.safeParse({ type: 'shape', shape: 'star', w: 3 }).success).toBe(false);
    expect(shape.safeParse({ type: 'shape', shape: 'hexagon', strokeWidth: 3 }).success).toBe(false);
    expect(shape.safeParse({ type: 'shape', shape: 'hexagon', strokeWidth: 4 }).success).toBe(true);
  });

  it('ohne Lage: frei neben dem Inhalt, ohne Überlappung', () => {
    const b = board();
    b.create([{ type: 'frame', title: 'Bestand', x: 0, y: 0, w: 800, h: 600 }]);
    b.create(Array.from({ length: 7 }, (_, i) => ({ type: 'sticky', text: `n${i}` })));
    const s = b.s();
    const notes = s.all.filter((o) => o.type === 'sticky');
    expect(notes.every((n) => n.x >= 800)).toBe(true);
    expect(noOverlap(s.all, s)).toBeNull();
  });

  it('in Rahmen: relative Lage bzw. freie Stelle; Rahmen wächst, wenn es nicht passt', () => {
    const b = board();
    const { refs } = b.create([{ type: 'frame', ref: 'f', title: 'Ideen', x: 100, y: 100, w: 500, h: 400 }]);
    const fid = refs.get('f')!;
    b.create([{ type: 'sticky', text: 'a', in: fid, x: 50, y: 60 }]);
    expect(b.s().all.find((o) => o.text === 'a')).toMatchObject({ x: 150, y: 160 });
    const ss = b.s();
    const ctx = newCtx(ss, b.model);
    const plan = planNotes(Array.from({ length: 9 }, (_, i) => ({ text: `i${i}` })), { in: fid, columns: 3 }, ss, ctx);
    b.doc.transact(() => {
      b.model.create(plan.objs);
      b.model.update(plan.framePatches);
    });
    const s = b.s();
    const frame = s.byId.get(fid)!;
    const notes = s.all.filter((o) => o.type === 'sticky');
    for (const n of notes) {
      expect(n.x).toBeGreaterThanOrEqual(frame.x);
      expect(n.y + n.h).toBeLessThanOrEqual(frame.y + frame.h);
    }
    expect(frame.h).toBeGreaterThan(400);
    expect(noOverlap(notes, s)).toBeNull();
  });

  it('Kanban: Rahmen, Spalten, Karten mit Höhe nach Inhalt', () => {
    const b = board();
    const ss = b.s();
    const ctx = newCtx(ss, b.model);
    const k = planKanban(
      { title: 'Aufgaben', columns: [{ title: 'Offen', cards: [{ title: 'Bühne buchen', desc: 'Lang '.repeat(30), status: 'todo' }, { title: 'Bar' }] }, { title: 'Erledigt', color: 'green', cards: [] }] },
      ss,
      ctx,
      (c) => (c ? resolveColor(c, 'ink') ?? undefined : undefined),
    );
    b.doc.transact(() => b.model.create(k.plan.objs));
    const s = b.s();
    const cards = s.all.filter((o) => o.type === 'card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.h).toBeGreaterThan(cards[1]!.h);
    expect(cards[0]!.y + cards[0]!.h).toBeLessThan(cards[1]!.y);
    expect(s.byId.get(k.frameId)).toMatchObject({ type: 'frame', title: 'Aufgaben' });
    expect(compact(cards[0]!, s)).toMatchObject({ title: 'Bühne buchen', status: 'todo', frame: k.frameId });
  });
});

describe('Ändern und Löschen', () => {
  it('nur passende Felder je Typ, mit Hinweis auf die erlaubten', () => {
    const b = board();
    const { refs } = b.create([{ type: 'sticky', ref: 'n', text: 'x', x: 0, y: 0 }]);
    const s = b.s();
    expect(() => planUpdate([{ id: refs.get('n')!, status: 'done' }], s, newCtx(s, b.model))).toThrow(/`status` gibt es hier nicht\. Änderbar:/);
    expect(() => planUpdate([{ id: 'nope', text: 'a' }], s, newCtx(s, b.model))).toThrow(/gibt es auf diesem Board nicht/);
    const p = planUpdate([{ id: refs.get('n')!, text: 'neu', shape: 'rect', tags: [{ label: 'Bar' }] }], s, newCtx(s, b.model));
    expect(p.patches[refs.get('n')!]).toMatchObject({ text: 'neu', w: 350, x: -75, tags: [{ label: 'Bar', color: '#1763b5' }] });
  });

  it('Rahmen verschieben nimmt den Inhalt mit', () => {
    const b = board();
    const { refs } = b.create([
      { type: 'frame', ref: 'f', x: 0, y: 0, w: 600, h: 400 },
      { type: 'sticky', ref: 'in', x: 100, y: 100 },
      { type: 'sticky', ref: 'out', x: 900, y: 100 },
    ]);
    const s = b.s();
    const p = planUpdate([{ id: refs.get('f')!, x: 1000, y: 0 }], s, newCtx(s, b.model));
    expect(p.patches[refs.get('in')!]).toEqual({ x: 1100, y: 100 });
    expect(p.patches[refs.get('out')!]).toBeUndefined();
  });

  it('Mindmap: Text ändern ordnet neu, Löschen nimmt Unterthemen mit', () => {
    const b = board();
    const nodes = layoutNew(buildMind(parseOutline('Wurzel\n- A\n  - A1\n- B'), { x: 0, y: 0, resolveColor: () => undefined })).nodes;
    b.doc.transact(() => b.model.create(nodes));
    const s = b.s();
    const a = s.all.find((o) => o.text === 'A')!;
    const p = planUpdate([{ id: a.id, text: 'Ein sehr viel längerer Hauptast-Text' }], s, newCtx(s, b.model));
    expect(p.patches[a.id]!.w).toBeGreaterThan(a.w);
    const a1 = s.all.find((o) => o.text === 'A1')!;
    expect(p.patches[a1.id]!.x).toBeGreaterThan(a1.x); // Kind rückt nach rechts
    const del = planDelete([a.id], s);
    expect(new Set(del.ids)).toEqual(new Set([a.id, a1.id]));
    expect(() => planUpdate([{ id: a1.id, x: 5 }], s, newCtx(s, b.model))).toThrow(/Nur die Wurzel/);
  });

  it('Rahmen dürfen sich nicht teilweise überdecken (Vorschlag einer freien Stelle), verschachtelt ist ok', () => {
    const b = board();
    const { refs } = b.create([
      { type: 'frame', ref: 'a', title: 'A', x: 0, y: 0, w: 600, h: 400 },
      { type: 'frame', ref: 'b', title: 'B', x: 800, y: 0, w: 600, h: 400 },
    ]);
    const s = b.s();
    expect(() => assertNoFrameClash(s, { [refs.get('b')!]: { x: 300 } })).toThrow(/„B“ würde Rahmen „A“ teilweise überdecken.*x=\d+, y=-?\d+/);
    expect(() => assertNoFrameClash(s, { [refs.get('b')!]: { x: 50, y: 50, w: 200, h: 200 } })).not.toThrow();
    expect(() => assertNoFrameClash(s, {}, [{ id: 'neu', type: 'frame', x: 500, y: 100, w: 400, h: 200 }])).toThrow(/überdecken/);
  });

  it('Gruppe löst sich auf, wenn nur ein Mitglied bleibt', () => {
    const b = board();
    const { refs } = b.create([{ type: 'sticky', ref: 'a', x: 0, y: 0 }, { type: 'sticky', ref: 'b', x: 300, y: 0 }]);
    b.doc.transact(() => b.model.update({ [refs.get('a')!]: { groupId: 'g1' }, [refs.get('b')!]: { groupId: 'g1' } }));
    b.doc.transact(() => b.model.remove([refs.get('a')!]));
    expect(b.model.get(refs.get('b')!)!.groupId).toBeUndefined();
  });
});

describe('Layout', () => {
  it('Mindmap-Layout: Hauptäste ab 5 links und rechts, Wurzel bleibt, nichts überlappt', () => {
    const spec = parseOutline(`Festival\n${['Programm', 'Orga', 'Werbung', 'Finanzen', 'Technik', 'Helfer'].map((t) => `- ${t}\n  - ${t} 1\n  - ${t} 2`).join('\n')}`);
    const lay = layoutNew(buildMind(spec, { x: 0, y: 0, resolveColor: () => undefined, balance: true }));
    const root = lay.nodes[0]!;
    expect(root).toMatchObject({ x: 0, y: 0 });
    const sides = lay.nodes.filter((n) => n.mind?.level === 1).map((n) => n.mind?.side);
    expect(sides.filter((x) => x === 'l')).toHaveLength(3);
    const s = snap(lay.nodes);
    expect(noOverlap(lay.nodes, s)).toBeNull();
  });

  it('Raster, Cluster und Fluss ohne Überlappung', () => {
    const b = board();
    b.create(
      Array.from({ length: 12 }, (_, i) => ({ type: 'sticky', text: `n${i}`, color: ['yellow', 'pink', 'blue'][i % 3], x: (i * 37) % 300, y: (i * 53) % 200 })),
    );
    let s = b.s();
    const units = unitsOf(s.all, s);
    for (const res of [layoutGrid(units, { x: 0, y: 0 }, { gap: 24 }), layoutClusters(units, { x: 0, y: 0 }, { by: 'color', gap: 24, clusterGap: 120, labelSize: 0 })]) {
      const patches = movePatches(units, res.offsets, s);
      const moved = s.all.map((o) => ({ ...o, ...(patches[o.id] ?? {}) }) as Obj);
      expect(noOverlap(moved, snap(moved))).toBeNull();
    }
    // Fluss: Kette a → b → c, Verzweigung c → d/e
    const f = board();
    const { refs } = f.create([
      ...['a', 'b', 'c', 'd', 'e'].map((r, i) => ({ type: 'shape', ref: r, text: r, x: i * 20, y: i * 15 })),
      { type: 'connector', from: 'a', to: 'b' },
      { type: 'connector', from: 'b', to: 'c' },
      { type: 'connector', from: 'c', to: 'd' },
      { type: 'connector', from: 'c', to: 'e' },
    ]);
    s = f.s();
    const u = unitsOf(s.all, s);
    const res = layoutLayered(u, s, { x: 0, y: 0 }, { direction: 'right', gapMain: 120, gapCross: 64 });
    const patches = movePatches(u, res.offsets, s);
    const at = (r: string) => ({ ...s.byId.get(refs.get(r)!)!, ...(patches[refs.get(r)!] ?? {}) }) as Obj;
    expect(at('a').x).toBeLessThan(at('b').x);
    expect(at('b').x).toBeLessThan(at('c').x);
    expect(at('d').x).toBe(at('e').x);
    expect(at('d').x - (at('c').x + at('c').w)).toBe(120);
    const moved = s.all.filter((o) => o.type !== 'connector').map((o) => ({ ...o, ...(patches[o.id] ?? {}) }) as Obj);
    expect(noOverlap(moved, snap(moved))).toBeNull();
  });

  it('Überblick: Rahmen mit Inhalt, Cluster außerhalb, freier Platz', () => {
    const b = board();
    b.create([
      { type: 'frame', ref: 'f', title: 'Planung', x: 0, y: 0, w: 600, h: 400 },
      { type: 'sticky', text: 'drin', x: 50, y: 50 },
      { type: 'sticky', text: 'draußen 1', x: 1000, y: 0 },
      { type: 'sticky', text: 'draußen 2', x: 1220, y: 0 },
    ]);
    const o = overview(b.s());
    expect(o.frames[0]).toMatchObject({ title: 'Planung', objects: 1 });
    expect(o.clustersOutsideFrames).toHaveLength(1);
    expect(o.clustersOutsideFrames[0]!.objects).toBe(2);
    expect(o.suggestedFreeSpot.x).toBeGreaterThan(1420);
  });
});
