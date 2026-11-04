// Q3: Clustern ohne KI, Suchen & Ersetzen, Typ wechseln, Befehlspalette – die React-freie Logik, die auch der Server
// für die App rechnet (native-organize.ts, server/test/native-act-organize.test.ts).
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import '../../editor/core';
import '../structure/card/card';
import { RICH_TEXT_FIELD, type BoardObject } from '../../protocol';
import { BoardStore, registerYField, type NewObject } from '../../board/store';
import { contentCodec, fragmentToJson, jsonToFragment, type PMDoc } from '../richtext/doc';
import { COLOR_NAMES } from '../../ui/a11y';
import { bandOrder, CLUSTER_COLOR_NAMES, clusterHeading, clusterInStore, clusterKey, clusterLayout, clusterUnits, gridOf } from './cluster';
import { convertFields, convertInStore, convertTargets } from './convert';
import { findAll, replaceInStore, replacePreview, replaceText } from './replace';
import { filterCommands, flattenMenu, type Command } from './palette';

registerYField(RICH_TEXT_FIELD, contentCodec);

const store = () => new BoardStore(new Y.Doc(), 'm:1');
const sticky = (id: string, x: number, y: number, extra: Partial<NewObject> = {}): NewObject => ({ id, type: 'sticky', x, y, w: 100, h: 100, text: id, ...extra }) as NewObject;
const get = (s: BoardStore, id: string) => s.get(id)!;

describe('Clustern', () => {
  it('Raster und Lesereihenfolge wie das MCP-Auto-Layout', () => {
    expect(gridOf([{ w: 100, h: 50 }, { w: 80, h: 70 }, { w: 120, h: 40 }], 2, 10)).toEqual({ pos: [{ x: 0, y: 0 }, { x: 130, y: 0 }, { x: 0, y: 80 }], w: 210, h: 120 });
    const u = (key: string, x: number, y: number) => ({ key, rect: { x, y, w: 100, h: 100 } });
    expect(bandOrder([u('c', 0, 300), u('b', 200, 10), u('a', 0, 0)]).map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });

  it('nach Farbe: Gruppen nebeneinander in Reihenfolge des ersten Vorkommens, Überschrift darüber, ein Undo-Schritt', () => {
    const s = store();
    s.createMany([
      sticky('a', 0, 0, { color: '#fff27a' }),
      sticky('b', 150, 0, { color: '#ffb3d1' }),
      sticky('c', 300, 0, { color: '#fff27a' }),
      sticky('d', 450, 0),
      { id: 'lk', type: 'sticky', x: 900, y: 900, w: 100, h: 100, locked: true } as NewObject,
    ]);
    s.stopCapturing();
    const r = clusterInStore(s, ['a', 'b', 'c', 'd', 'lk'], 'color', new Map(), (i) => `h${i + 1}`)!;
    expect(r.groups).toBe(2);
    // Gelb (a, c, d ohne Farbe = gelb) zuerst: 2 Spalten (round(√3)), dann Rosa
    const labelH = Math.ceil(32 * 1.25) + 16;
    expect([get(s, 'a').x, get(s, 'a').y]).toEqual([0, labelH]);
    expect([get(s, 'c').x, get(s, 'c').y]).toEqual([124, labelH]);
    expect([get(s, 'd').x, get(s, 'd').y]).toEqual([0, labelH + 124]);
    const pinkX = 224 + 120; // Breite Gelb + Abstand zwischen Gruppen max(120, 24·4)
    expect([get(s, 'b').x, get(s, 'b').y]).toEqual([pinkX, labelH]);
    expect(get(s, 'lk').x).toBe(900);
    expect(get(s, 'h1')).toMatchObject({ type: 'text', text: 'Gelb', x: 0, y: 0, fontSize: 32, bold: true });
    expect(get(s, 'h2')).toMatchObject({ text: 'Rosa', x: pinkX, y: 0 });
    expect(r.select).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd', 'h1', 'h2']));
    s.undo();
    expect(get(s, 'a').x).toBe(0);
    expect(get(s, 'a').y).toBe(0);
    expect(s.get('h1')).toBeUndefined();
  });

  it('nach Tag und Autor:in; Gruppen bleiben ganz; Verbinder-Enden wandern mit', () => {
    const s = store();
    s.createMany([
      sticky('a', 0, 0, { tags: [{ label: 'Bühne', color: '#c9e14a' }] }),
      sticky('b', 150, 0, { tags: [{ label: 'bühne', color: '#c9e14a' }] }),
      sticky('c', 300, 0),
      sticky('g1', 0, 400, { groupId: 'G' }),
      sticky('g2', 120, 400, { groupId: 'G' }),
      { id: 'k', type: 'connector', x: 0, y: 0, w: 0, h: 0, from: { objectId: 'c' }, to: { x: 999, y: 999 } } as NewObject,
    ]);
    const objs = ['a', 'b', 'c', 'g1'].map((id) => get(s, id));
    expect(clusterUnits(objs, s.getSnapshot().ordered).map((u) => u.key)).toEqual(['a', 'b', 'c', 'group:G']);
    expect(clusterKey(get(s, 'b'), 'tag')).toBe('bühne');
    expect(clusterHeading('bühne', 'tag', objs, new Map())).toBe('Bühne');
    expect(clusterHeading('', 'tag', objs, new Map())).toBe('Ohne Tag');
    expect(clusterHeading('m:7', 'author', objs, new Map([['m:7', 'Mara']]))).toBe('Mara');
    const before = get(s, 'c');
    clusterInStore(s, ['a', 'b', 'c', 'g1'], 'tag', new Map(), (i) => `t${i + 1}`);
    expect(get(s, 't1').text).toBe('Bühne');
    expect(get(s, 't2').text).toBe('Ohne Tag');
    // Gruppe bewegt sich als Ganzes
    expect(get(s, 'g2').x - get(s, 'g1').x).toBe(120);
    const c = get(s, 'c');
    const k = get(s, 'k');
    expect(k.to).toEqual({ x: 999 + (c.x - before.x), y: 999 + (c.y - before.y) });
  });

  it('Farbnamen wie ui/a11y (Server lädt die Datei nicht)', () => {
    expect(CLUSTER_COLOR_NAMES).toEqual(COLOR_NAMES);
  });

  it('weniger als zwei Einheiten: nichts', () => {
    const s = store();
    s.createMany([sticky('a', 0, 0)]);
    expect(clusterInStore(s, ['a'], 'color', new Map())).toBeNull();
  });

  it('clusterLayout ohne Überschrift (MCP labels aus)', () => {
    const units = [0, 1].map((i) => ({ key: `u${i}`, ids: [`u${i}`], rect: { x: i * 10, y: 0, w: 50, h: 50 }, head: i }));
    const l = clusterLayout(units, { x: 5, y: 5 }, (u) => String(u.head), { gap: 10, clusterGap: 100, labelSize: 0 });
    expect(l.labels).toEqual([]);
    expect(l.offsets.get('u1')).toEqual({ dx: 5 + 50 + 100 - 10, dy: 5 });
  });
});

describe('Suchen & Ersetzen', () => {
  it('Fundstellen ohne Groß/Klein und Umlaut-tolerant wie die Suche', () => {
    expect(findAll('Bühne, buehne, BÜHNE', 'bühne')).toEqual([
      [0, 5],
      [7, 13],
      [15, 20],
    ]);
    expect(replaceText('Bar bar BAR', 'bar', 'Theke')).toEqual({ text: 'Theke Theke Theke', n: 3 });
    expect(replaceText('Bar bar', 'bar', 'X', true)).toEqual({ text: 'X bar', n: 1 });
    expect(findAll('abc', '  ')).toEqual([]);
  });

  it('Rich-Text: Formatierung der Fundstelle bleibt, Klartext folgt; Rahmen, Karte; Gesperrtes bleibt; ein Schritt', () => {
    const s = store();
    const doc: PMDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Die ' }, { type: 'text', text: 'Bühne', marks: [{ type: 'bold' }] }, { type: 'text', text: ' steht' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'bühne zwei' }] },
      ],
    };
    s.createMany([
      { id: 'n', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Die Bühne steht\nbühne zwei', content: doc } as NewObject,
      { id: 'f', type: 'frame', x: 0, y: 0, w: 500, h: 500, title: 'Bühnenplan' } as NewObject,
      { id: 'c', type: 'card', x: 0, y: 0, w: 300, h: 96, text: 'Bühne bauen', desc: 'Bühne bis Freitag' } as NewObject,
      { id: 'l', type: 'sticky', x: 0, y: 0, w: 100, h: 100, text: 'Bühne', locked: true } as NewObject,
    ]);
    s.stopCapturing();
    const objs = ['n', 'f', 'c', 'l'].map((id) => get(s, id));
    expect(replacePreview(objs, 'bühne')).toEqual({ total: 5, objects: 3, locked: 1 });
    const r = replaceInStore(s, ['n', 'f', 'c', 'l'], 'bühne', 'Theke');
    expect(r).toEqual({ replaced: 5, changed: ['n', 'f', 'c'], locked: 1 });
    expect(get(s, 'n').text).toBe('Die Theke steht\nTheke zwei');
    const json = fragmentToJson(s.yField<Y.XmlFragment>('n', RICH_TEXT_FIELD)!);
    expect(json.content[0]!.content).toEqual([{ type: 'text', text: 'Die ' }, { type: 'text', text: 'Theke', marks: [{ type: 'bold' }] }, { type: 'text', text: ' steht' }]);
    expect(get(s, 'f').title).toBe('Thekenplan');
    expect(get(s, 'c')).toMatchObject({ text: 'Theke bauen', desc: 'Theke bis Freitag' });
    expect(get(s, 'l').text).toBe('Bühne');
    s.undo();
    expect(get(s, 'n').text).toBe('Die Bühne steht\nbühne zwei');
    expect(get(s, 'f').title).toBe('Bühnenplan');
  });

  it('„Ersetzen“ = nur die erste Fundstelle ab dem ersten Objekt mit Treffer; leerer Ersatz löscht', () => {
    const s = store();
    s.createMany([sticky('a', 0, 0, { text: 'ohne' }), sticky('b', 0, 0, { text: 'x x' })]);
    expect(replaceInStore(s, ['a', 'b'], 'x', 'y', { first: true })).toEqual({ replaced: 1, changed: ['b'], locked: 0 });
    expect(get(s, 'b').text).toBe('y x');
    replaceInStore(s, ['b'], 'x', '');
    expect(get(s, 'b').text).toBe('y ');
  });

  it('Rich-Text: kein Erben der Marks vom linken Nachbarn', () => {
    const s = store();
    const doc: PMDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AB', marks: [{ type: 'italic' }] }, { type: 'text', text: 'cd' }] }] };
    s.createMany([{ id: 'n', type: 'shape', x: 0, y: 0, w: 1, h: 1, text: 'ABcd', content: doc } as NewObject]);
    replaceInStore(s, ['n'], 'cd', 'ef');
    const json = fragmentToJson(s.yField<Y.XmlFragment>('n', RICH_TEXT_FIELD)!);
    expect(json.content[0]!.content).toEqual([{ type: 'text', text: 'AB', marks: [{ type: 'italic' }] }, { type: 'text', text: 'ef' }]);
  });
});

describe('Typ wechseln', () => {
  const obj = (o: Partial<BoardObject>) => ({ id: 'x', x: 0, y: 0, w: 100, h: 100, z: '', createdBy: '', updatedAt: '', ...o }) as BoardObject;

  it('Ziele: alle außer dem gemeinsamen Typ; nichts bei Gesperrtem oder Fremdem', () => {
    expect(convertTargets([obj({ type: 'sticky' })])).toEqual(['shape', 'text', 'card']);
    expect(convertTargets([obj({ type: 'sticky' }), obj({ type: 'text' })])).toEqual(['sticky', 'shape', 'text', 'card']);
    expect(convertTargets([obj({ type: 'sticky', locked: true })])).toEqual([]);
    expect(convertTargets([obj({ type: 'frame' })])).toEqual([]);
  });

  it('Felder: Fläche bleibt Fläche, Text schwarz, Karte mit Streifen und Mindestbreite', () => {
    expect(convertFields(obj({ type: 'sticky', color: '#ffb3d1', tags: [] }), 'shape')).toMatchObject({ shape: 'rect', color: '#ffb3d1', tags: undefined, strokeWidth: 2 });
    expect(convertFields(obj({ type: 'shape', color: '#9fd3ff', shape: 'ellipse', stroke: '#000' }), 'sticky')).toMatchObject({ color: '#9fd3ff', shape: undefined, stroke: undefined, fontSize: undefined });
    expect(convertFields(obj({ type: 'sticky', color: '#ffb3d1' }), 'text')).toMatchObject({ color: '#0a0a0a', fontSize: 28, valign: undefined });
    expect(convertFields(obj({ type: 'sticky', text: 'Hallo' }), 'card')).toMatchObject({ color: '#1763b5', w: 300, text: 'Hallo', content: undefined, fontSize: undefined });
    expect(convertFields(obj({ type: 'card', text: 'Titel', desc: 'Mehr' } as Partial<BoardObject>), 'sticky')).toMatchObject({ text: 'Titel\nMehr', desc: undefined, status: undefined });
  });

  it('gleiche ID, Rich-Text bleibt, Lage/Gruppe/Autor bleiben, ein Undo-Schritt', () => {
    const s = store();
    const doc: PMDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi', marks: [{ type: 'bold' }] }] }] };
    s.createMany([{ id: 'n', type: 'sticky', x: 10, y: 20, w: 200, h: 200, color: '#c9e14a', text: 'Hi', content: doc, groupId: 'G', tags: [{ label: 't', color: '#000' }] } as NewObject, sticky('m', 0, 0, { groupId: 'G' })]);
    s.stopCapturing();
    expect(convertInStore(s, ['n', 'nope'], 'shape')).toEqual(['n']);
    const o = get(s, 'n');
    expect(o).toMatchObject({ type: 'shape', x: 10, y: 20, color: '#c9e14a', shape: 'rect', text: 'Hi', groupId: 'G', createdBy: 'm:1' });
    expect(o.tags).toBeUndefined();
    expect(fragmentToJson(s.yField<Y.XmlFragment>('n', RICH_TEXT_FIELD)!).content[0]!.content![0]!.marks).toEqual([{ type: 'bold' }]);
    s.undo();
    expect(get(s, 'n')).toMatchObject({ type: 'sticky', tags: [{ label: 't', color: '#000' }] });
    expect(jsonToFragment(doc)).toBeTruthy();
  });

  it('zur Karte: Höhe aus der Messung', () => {
    const s = store();
    s.createMany([sticky('n', 0, 0, { text: 'Titel' })]);
    convertInStore(s, ['n'], 'card', () => 77);
    expect(get(s, 'n')).toMatchObject({ type: 'card', h: 77, w: 300, text: 'Titel' });
  });
});

describe('Befehlspalette', () => {
  const noop = () => {};
  it('Untermenüs flach, deaktivierte weg', () => {
    const flat = flattenMenu([{ label: 'Ausrichten', items: [{ label: 'Links', onSelect: noop }, { label: 'Aus', disabled: true, onSelect: noop }] }, { label: 'Löschen', shortcut: 'Entf', onSelect: noop }]);
    expect(flat.map((f) => [f.label, f.shortcut])).toEqual([
      ['Ausrichten › Links', undefined],
      ['Löschen', 'Entf'],
    ]);
  });
  it('Filter: Wortanfang vor Teilwort, Umlaut-tolerant', () => {
    const c = (label: string, group = 'Board'): Command => ({ id: label, label, group, run: noop });
    const list = [c('Board exportieren …'), c('Export als PNG'), c('Auf dem Board suchen'), c('Größe ändern', 'Auswahl')];
    expect(filterCommands(list, 'export').map((x) => x.label)).toEqual(['Export als PNG', 'Board exportieren …']);
    expect(filterCommands(list, 'groesse').map((x) => x.label)).toEqual(['Größe ändern']);
    expect(filterCommands(list, 'auswahl').map((x) => x.label)).toEqual(['Größe ändern']);
    expect(filterCommands(list, '')).toHaveLength(4);
  });
});
