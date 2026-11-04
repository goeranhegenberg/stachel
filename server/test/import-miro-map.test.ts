// Abbildung Miro → Stachel (server/src/import/miro/map.ts, colors.ts, shapes.ts; docs/features/import.md §4):
// je Typ, Farben (nächste Palettenfarbe, eigene Palette, keepColors), Formen-Tabelle, Verbinder (Seiten, Spitzen,
// Beschriftungen, freie Enden), Rahmen-Kinder, Gruppen, Tags, Mindmap-Baum, Bericht, Grenzen – und dass jedes Objekt
// aller Fixtures die Prüfregeln der Native-API erfüllt und sich mit dem Web-Store (samt mind.tree) bauen lässt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { STICKY_COLORS } from '../../shared/protocol';
import { NATIVE_MIND_LIMITS } from '../../shared/native';
import { WEB } from '#stachel-web';
import { CAP_STYLES, capPatch } from '../../web/src/features/shapes/model';
import { TAG_COLORS as CARD_TAG_COLORS } from '../../web/src/features/structure/card/model';
import { chroma, colorDistance, MIRO_STICKY_HEX, MIRO_TAG_COLORS, nearestColor, readableWithBlack, STACHEL_TAG_COLORS, stickyColor, tagColor } from '../src/import/miro/colors';
import { MIRO_CAPS, MIRO_SHAPES_FLOW, MIRO_SHAPES_V2, mapCap, mapFont, roundStroke } from '../src/import/miro/shapes';
import { mapBoard, MIRO_NOTE_MISSING, num, pct, REPORT_TEXTS, sideOf } from '../src/import/miro/map';
import type { MiroBoardData, MiroConnector, MiroItem, MiroMindNode } from '../src/import/miro/types';
import { validateOps } from '../src/native/validate';
import { loadMiroFixture, miroFixtureBoards } from './fixtures/miro/load';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** leeres Board + Teile */
function board(part: Partial<MiroBoardData> = {}): MiroBoardData {
  return { board: { id: 'b1', name: 'Test' }, items: [], connectors: [], tags: [], itemTags: {}, groups: [], mindNodes: [], experimentalShapes: {}, docs: {}, warnings: [], ...part };
}
const ids = () => {
  let n = 0;
  return () => `o${++n}`;
};
const map = (part: Partial<MiroBoardData>, opts: Parameters<typeof mapBoard>[1] = {}) => mapBoard(board(part), { newId: ids(), ...opts });
const it_ = (id: string, type: string, extra: Partial<MiroItem> = {}): MiroItem => ({ id, type, data: {}, style: {}, position: { x: 0, y: 0, origin: 'center', relativeTo: 'canvas_center' }, geometry: { width: 100, height: 100 }, ...extra });
const at = (x: number, y: number, w = 100, h = 100, extra: Partial<MiroItem> = {}) => ({ position: { x, y, origin: 'center', relativeTo: 'canvas_center' }, geometry: { width: w, height: h }, ...extra });
const conn = (id: string, a: string | null, b: string | null, extra: Partial<MiroConnector> = {}): MiroConnector => ({
  id,
  ...(a ? { startItem: { id: a } } : {}),
  ...(b ? { endItem: { id: b } } : {}),
  ...extra,
});
const byType = (objects: Record<string, unknown>[], type: string) => objects.filter((o) => o.type === type);
const codes = (entries: { code: string; count: number }[]) => Object.fromEntries(entries.map((e) => [e.code, e.count]));

/** Formen von Stachel (Kern + Augmentation in web/src/features/shapes/model.ts) */
function stachelShapes(): Set<string> {
  const src = fs.readFileSync(path.join(HERE, '../../web/src/features/shapes/model.ts'), 'utf8');
  const block = /interface ShapeKindMap \{([^}]+)\}/.exec(src)![1]!;
  return new Set(['rect', 'ellipse', 'diamond', 'triangle', ...[...block.matchAll(/(\w+): true/g)].map((m) => m[1]!)]);
}

// ---- Farben ----------------------------------------------------------------------------------------------------------

describe('Farben', () => {
  it('jede Miro-Notizfarbe wird zur nächsten Farbe der aktuellen Palette (unabhängig von deren Größe)', () => {
    for (const [name, hex] of Object.entries(MIRO_STICKY_HEX)) {
      const { color } = stickyColor(name, STICKY_COLORS);
      expect(STICKY_COLORS).toContain(color);
      // neutrale Quellen bleiben neutral, sonst schlicht die nächste Farbe
      const pool = chroma(hex) < 10 && STICKY_COLORS.some((p) => chroma(p) < 10) ? STICKY_COLORS.filter((p) => chroma(p) < 10) : STICKY_COLORS;
      const best = Math.min(...pool.map((p) => colorDistance(hex, p)));
      expect(colorDistance(hex, color)).toBeCloseTo(best, 6);
    }
  });

  it('erwartete Richtungen: Gelb → Gelb, Grün → Grün, Schwarz/Grau bleiben neutral', () => {
    const pal = STICKY_COLORS;
    expect(stickyColor('light_yellow', pal).color).toBe('#fff27a');
    expect(stickyColor('green', pal).color).toBe('#c9e14a');
    expect(chroma(stickyColor('black', pal).color)).toBeLessThan(10);
    expect(chroma(stickyColor('gray', pal).color)).toBeLessThan(10);
    expect(stickyColor(undefined, pal).color).toBe(stickyColor('light_yellow', pal).color);
  });

  it('eigene Palette: Ergebnis stammt immer aus ihr', () => {
    const own = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#333333'];
    expect(stickyColor('red', own).color).toBe('#ff0000');
    expect(stickyColor('light_green', own).color).toBe('#00ff00');
    expect(stickyColor('gray', own).color).toBe('#ffffff');
    expect(stickyColor('black', own).color).toBe('#333333');
    for (const n of Object.keys(MIRO_STICKY_HEX)) expect(own).toContain(stickyColor(n, own).color);
    // ohne neutrale Farben in der Palette: nächste bunte
    expect(['#ff0000', '#00ff00', '#0000ff']).toContain(nearestColor('#000000', ['#ff0000', '#00ff00', '#0000ff']));
    const r = map({ items: [it_('s1', 'sticky_note', { style: { fillColor: 'red' } })] }, { palette: own });
    expect(r.objects[0]!.color).toBe('#ff0000');
  });

  it('keepColors behält die Originalfarbe – außer sie ist zu dunkel für schwarze Schrift', () => {
    expect(stickyColor('orange', STICKY_COLORS, true).color).toBe(MIRO_STICKY_HEX.orange);
    expect(stickyColor('#a1b2c3', STICKY_COLORS, true).color).toBe('#a1b2c3');
    expect(readableWithBlack('#000000')).toBe(false);
    expect(STICKY_COLORS).toContain(stickyColor('black', STICKY_COLORS, true).color);
    const r = map({ items: [it_('s1', 'sticky_note', { style: { fillColor: 'cyan' } }), it_('s2', 'sticky_note', { style: { fillColor: 'black' } })] }, { keepColors: true });
    expect(r.objects.map((o) => o.color)).toEqual([MIRO_STICKY_HEX.cyan, stickyColor('black', STICKY_COLORS).color]);
    expect(codes(r.report.adjusted).sticky_color).toBe(1);
  });

  it('unbekannter Farbname → Standardfarbe auf die Palette + Bericht', () => {
    const r = map({ items: [it_('s1', 'sticky_note', { style: { fillColor: 'neon_glitter' } })] });
    expect(STICKY_COLORS).toContain(r.objects[0]!.color);
    expect(codes(r.report.adjusted).sticky_color).toBe(1);
  });

  it('Tag-Farben: alle 12 Miro-Namen auf die Stachel-Tag-Farben; Tabelle = Web', () => {
    expect([...STACHEL_TAG_COLORS]).toEqual(CARD_TAG_COLORS);
    const tagsSrc = fs.readFileSync(path.join(HERE, '../../web/src/features/tools/tags.tsx'), 'utf8');
    expect(tagsSrc).toContain(`export const TAG_COLORS = [${STACHEL_TAG_COLORS.map((c) => `'${c}'`).join(', ')}]`);
    for (const n of ['red', 'light_green', 'cyan', 'yellow', 'magenta', 'green', 'blue', 'gray', 'violet', 'dark_green', 'dark_blue', 'black']) {
      expect(STACHEL_TAG_COLORS).toContain(tagColor(n));
      expect(MIRO_TAG_COLORS[n]).toBe(tagColor(n));
    }
    expect(tagColor('#ec4f90')).toBe('#ec4e92');
    expect(tagColor('irgendwas')).toBe(STACHEL_TAG_COLORS[0]);
  });
});

// ---- Typen -----------------------------------------------------------------------------------------------------------

describe('Objekttypen', () => {
  it('Haftnotiz: Lage aus der Mitte, Quadrat/Rechteck wie Stachel, Rich-Text, Ausrichtung, Drehung, Zahlen als Strings', () => {
    const r = map({
      items: [
        it_('s1', 'sticky_note', { data: { content: '<p>Hallo <b>Welt</b></p>', shape: 'square' }, style: { fillColor: 'light_yellow', textAlign: 'left', textAlignVertical: 'top' }, ...at(100, 200, 199, 228), geometry: { width: '199.0' as never, height: '228.0' as never, rotation: '15' as never } }),
        it_('s2', 'sticky_note', { data: { content: 'x', shape: 'rectangle' }, ...at(0, 0, 350, 228) }),
      ],
    });
    const [a, b] = r.objects;
    expect(a).toMatchObject({ type: 'sticky', x: 0.5, y: 100.5, w: 199, h: 199, rotation: 15, align: 'left', valign: 'top', text: 'Hallo Welt' });
    expect(a!.content).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo ' }, { type: 'text', text: 'Welt', marks: [{ type: 'bold' }] }] }] });
    expect(a!.fontSize).toBeUndefined();
    expect(b).toMatchObject({ x: -175, y: -100, w: 350, h: 200 });
    expect(r.report.imported).toEqual({ sticky: 2 });
  });

  it('Form: Füllung, Deckkraft, Rand (Breite gerundet, Art, borderOpacity 0), Schrift, Textfarbe, Ausrichtung', () => {
    const r = map({
      items: [
        it_('f1', 'shape', {
          data: { shape: 'round_rectangle', content: '<p>Ziel</p>' },
          style: { fillColor: '#8fd14f', fillOpacity: '0.5', borderColor: '#1a1a1a', borderWidth: '3.0', borderOpacity: '1.0', borderStyle: 'dotted', fontFamily: 'georgia', fontSize: '28', color: '#ffffff', textAlign: 'right', textAlignVertical: 'bottom' },
        }),
        it_('f2', 'shape', { data: { shape: 'circle' }, style: { fillColor: 'transparent', borderWidth: '2', borderOpacity: '0' } }),
        it_('f3', 'shape', { data: { shape: 'rectangle' }, style: { fillColor: '#ff000080', borderWidth: '24' } }),
      ],
    });
    const [a, b, c] = r.objects;
    expect(a).toMatchObject({ type: 'shape', shape: 'roundrect', color: '#8fd14f', fillOpacity: 0.5, stroke: '#1a1a1a', strokeWidth: 2, dash: 'dotted', fontFamily: 'serif', fontSize: 28, align: 'right', valign: 'bottom', text: 'Ziel' });
    expect((a!.content as any).content[0].content[0].marks).toEqual([{ type: 'textStyle', attrs: { color: '#ffffff' } }]);
    expect(b).toMatchObject({ shape: 'ellipse', fillOpacity: 0, strokeWidth: 0, text: '' });
    expect(b!.stroke).toBeUndefined();
    expect(b!.content).toBeUndefined();
    expect(c).toMatchObject({ color: '#ff0000', fillOpacity: 0.5, strokeWidth: 8 });
    expect(codes(r.report.adjusted)).toMatchObject({ stroke_width: 2, font_family: 1 });
  });

  it('Text: Schriftgröße, Farbe, Ausrichtung; Hintergrund → Form ohne Rand dahinter, gruppiert', () => {
    const r = map({
      items: [
        it_('t1', 'text', { data: { content: '<p>Titel</p>' }, style: { color: '#e6282e', fontSize: '48', textAlign: 'center', fillColor: 'transparent' }, ...at(0, 0, 400, 0), geometry: { width: 400 } }),
        it_('t2', 'text', { data: { content: '<p>Hinweis</p>' }, style: { color: '#1a1a1a', fontSize: '20', fillColor: '#fef445', fillOpacity: '0.8' }, ...at(500, 0, 300, 40), geometry: { width: 300, height: 40, rotation: -10 } }),
      ],
    });
    expect(r.objects.map((o) => o.type)).toEqual(['text', 'shape', 'text']);
    const [t1, bg, t2] = r.objects;
    expect(t1).toMatchObject({ fontSize: 48, color: '#e6282e', align: 'center', text: 'Titel', w: 400 });
    expect(t1!.h).toBeGreaterThan(48);
    expect(bg).toMatchObject({ shape: 'rect', color: '#fef445', fillOpacity: 0.8, strokeWidth: 0, x: t2!.x, y: t2!.y, w: 300, h: 40, rotation: 350 });
    expect(bg!.groupId).toBeTruthy();
    expect(bg!.groupId).toBe(t2!.groupId);
    expect(codes(r.report.adjusted).text_background).toBe(1);
  });

  it('Karte und App-Karte: Titel/Beschreibung als Klartext, Fälligkeit, Farbe, Felder als Zeilen, keine Personen', () => {
    const r = map({
      items: [
        it_('c1', 'card', { data: { title: '<p>Bühne <b>buchen</b></p>', description: '<p>a</p><p>b</p>', dueDate: '2026-11-20T23:00:00Z', assigneeId: '3458764500000000002' }, style: { cardTheme: '#2d9bf0' }, ...at(0, 0, 100, 60) }),
        it_('c2', 'app_card', { data: { title: 'T', fields: [{ value: 'Offen', tooltip: 'Status' }, { value: 'Nur Wert' }, null], status: 'connected' }, style: { fillColor: '#fac710' } }),
      ],
    });
    const [c1, c2] = r.objects;
    expect(c1).toMatchObject({ type: 'card', text: 'Bühne buchen', desc: 'a\nb', due: '2026-11-20', color: '#2d9bf0', w: 160 });
    expect(c1!.assignee).toBeUndefined();
    expect(c2).toMatchObject({ type: 'card', text: 'T', desc: 'Status: Offen\nNur Wert', color: '#fac710' });
    expect(c2!.status).toBeUndefined();
    expect(JSON.stringify(r.objects)).not.toContain('3458764500000000002');
    expect(codes(r.report.adjusted)).toMatchObject({ card_assignee: 1, app_card: 1 });
  });

  it('Rahmen unten, Kinder aus parent_top_left absolut (verschachtelt), Rahmen ohne Drehung', () => {
    const r = map({
      items: [
        it_('s1', 'sticky_note', { parent: { id: 'f2' }, position: { x: 50, y: 50, relativeTo: 'parent_top_left' }, geometry: { width: 100, height: 100 } }),
        it_('f1', 'frame', { data: { title: 'Außen' }, style: { fillColor: '#ffffffff' }, ...at(0, 0, 1000, 800) }),
        it_('f2', 'frame', { data: { title: '<p>Innen</p>' }, parent: { id: 'f1' }, position: { x: 300, y: 200, relativeTo: 'parent_top_left' }, geometry: { width: 400, height: 300, rotation: 30 } }),
        it_('x1', 'text', { parent: { id: 'fehlt' }, position: { x: 10, y: 10, relativeTo: 'parent_top_left' }, geometry: { width: 20, height: 20 } }),
      ],
    });
    expect(r.objects.map((o) => o.type)).toEqual(['frame', 'frame', 'sticky', 'text']);
    const [f1, f2, s1, x1] = r.objects;
    expect(f1).toMatchObject({ x: -500, y: -400, title: 'Außen', color: '#ffffff' });
    expect(f2).toMatchObject({ x: -400, y: -350, w: 400, h: 300, title: 'Innen' });
    expect(f2!.rotation).toBeUndefined();
    // Mitte = Rahmen-Ecke (-400,-350) + (50,50)
    expect(s1).toMatchObject({ x: -400, y: -350 });
    expect(x1).toMatchObject({ x: 0, y: 0 });
    expect(codes(r.report.adjusted).position_parent).toBe(1);
  });

  it('Bild und PDF: Objekt mit leerer Datei-ID + AssetNeed; andere Dateien → Karte + Bericht', () => {
    const r = map({
      items: [
        it_('i1', 'image', { data: { imageUrl: 'https://api.miro.com/v2/boards/b1/resources/images/i1?format=preview&redirect=false', title: 'Foto.jpg' } }),
        it_('i2', 'image', { data: {} }),
        it_('d1', 'document', { data: { documentUrl: 'https://api.miro.com/v2/boards/b1/resources/documents/d1?redirect=false', title: 'Plan.PDF' } }),
        it_('d2', 'document', { data: { documentUrl: 'https://api.miro.com/x', title: 'Liste.xlsx' } }),
      ],
    });
    expect(r.objects.map((o) => o.type)).toEqual(['image', 'document', 'card']);
    expect(r.objects[0]).toMatchObject({ imageId: '' });
    expect(r.objects[1]).toMatchObject({ docFile: '', docName: 'Plan.PDF' });
    expect(r.objects[2]).toMatchObject({ text: 'Liste.xlsx' });
    expect(r.assets).toEqual([
      { objectId: r.objects[0]!.id, kind: 'image', apiUrl: 'https://api.miro.com/v2/boards/b1/resources/images/i1?format=preview&redirect=false', title: 'Foto.jpg' },
      { objectId: r.objects[1]!.id, kind: 'document', apiUrl: 'https://api.miro.com/v2/boards/b1/resources/documents/d1?redirect=false', title: 'Plan.PDF' },
    ]);
    expect(codes(r.report.skipped)).toMatchObject({ image_missing: 1, document_type: 1 });
  });

  it('Embed/Vorschau: Text mit https-Link; andere Ziele ohne Link', () => {
    const r = map({
      items: [
        it_('e1', 'embed', { data: { url: 'https://example.org/v', title: 'Video', html: '<iframe>' } }),
        it_('e2', 'preview', { data: { url: 'javascript:alert(1)' } }),
        it_('e3', 'preview', { data: { url: 'http://example.org/unsicher' } }),
      ],
    });
    const [a, b, c] = r.objects;
    expect(a).toMatchObject({ type: 'text', text: 'Video\nhttps://example.org/v' });
    expect(JSON.stringify(a!.content)).toContain('"href":"https://example.org/v"');
    expect(JSON.stringify(b)).not.toContain('javascript');
    expect(c!.text).toBe('http://example.org/unsicher');
    expect(JSON.stringify(c!.content)).not.toContain('"link"');
    expect(codes(r.report.adjusted)).toMatchObject({ embed_link: 3, link_unsafe: 2 });
  });

  it('Miro-Doc: Rich-Text aus data.docs; Tabellen, unbekannte Typen und isSupported:false → Bericht', () => {
    const r = map({
      items: [it_('d1', 'doc_format'), it_('t1', 'data_table_format'), it_('k1', 'kanban'), it_('k2', 'usm'), it_('u1', 'sticky_note', { isSupported: false })],
      docs: { d1: '<h2>Protokoll</h2><ul><li>a</li></ul>' },
    });
    expect(r.objects).toHaveLength(1);
    expect(r.objects[0]).toMatchObject({ type: 'text', text: 'Protokoll\na', fontSize: 16 });
    const s = codes(r.report.skipped);
    expect(s).toMatchObject({ table: 1, unknown_type: 2, unsupported_item: 1 });
    expect(r.report.skipped.find((e) => e.code === 'unknown_type')!.text).toContain('kanban, usm');
    expect(r.report.notes).toEqual([MIRO_NOTE_MISSING]);
  });
});

// ---- Formen ----------------------------------------------------------------------------------------------------------

describe('Formen-Tabelle', () => {
  it('21 v2-Formen und 24 Flussdiagramm-Formen, jede auf eine Stachel-Form', () => {
    expect(Object.keys(MIRO_SHAPES_V2)).toHaveLength(21);
    expect(Object.keys(MIRO_SHAPES_FLOW)).toHaveLength(24);
    const known = stachelShapes();
    for (const [name, m] of [...Object.entries(MIRO_SHAPES_V2), ...Object.entries(MIRO_SHAPES_FLOW)]) {
      expect(known.has(m.shape), `${name} → ${m.shape}`).toBe(true);
      const r = map({ items: [it_('x', 'shape', { data: { shape: name } })] });
      expect(r.objects[0]!.shape).toBe(m.shape);
      expect(codes(r.report.adjusted).shape_unknown).toBeUndefined();
    }
  });

  it('Flussdiagramm über v2-experimental: deren Form/Stil gelten; Magnettrommel gedreht; Unbekanntes → rect + Bericht', () => {
    const r = map({
      items: [
        it_('a', 'shape', { data: { shape: 'rectangle', content: 'A' }, ...at(0, 0, 200, 80) }),
        it_('b', 'shape', { data: { shape: 'flow_chart_magnetic_drum' }, ...at(500, 0, 200, 100) }),
        it_('c', 'shape', { data: { shape: 'ganz_neu' }, ...at(0, 0, 10, 10) }),
      ],
      experimentalShapes: { a: { id: 'a', type: 'shape', data: { shape: 'flow_chart_terminator' }, style: { fillColor: '#c9df56' } } },
    });
    expect(r.objects[0]).toMatchObject({ shape: 'terminator', color: '#c9df56', text: 'A' });
    expect(r.objects[1]).toMatchObject({ shape: 'cylinder', rotation: 90, w: 100, h: 200, x: 450, y: -100 });
    expect(r.objects[2]).toMatchObject({ shape: 'rect' });
    expect(r.report.adjusted.find((e) => e.code === 'shape_unknown')!.text).toContain('ganz_neu');
    expect(codes(r.report.adjusted).shape_similar).toBe(1);
  });

  it('Schriften auf die 4 Stachel-Familien', () => {
    expect(mapFont('georgia').font).toBe('serif');
    expect(mapFont('roboto_mono').font).toBe('mono');
    expect(mapFont('pt_sans_narrow').font).toBe('condensed');
    expect(mapFont('arial')).toEqual({ font: undefined, changed: false });
    expect(mapFont('caveat')).toEqual({ font: undefined, changed: true });
    expect(mapFont(undefined)).toEqual({ font: undefined, changed: false });
  });

  it('Strichstärken auf 1/2/4/8', () => {
    expect([0.5, 1, 1.4, 2, 3, 3.1, 5, 6, 7, 24].map(roundStroke)).toEqual([1, 1, 1, 2, 2, 4, 4, 4, 8, 8]);
  });
});

// ---- Verbinder -------------------------------------------------------------------------------------------------------

describe('Verbinder', () => {
  const two = [it_('a', 'sticky_note', at(0, 0, 100, 100)), it_('b', 'sticky_note', at(400, 0, 100, 100))];

  it('Seiten aus snapTo bzw. Prozentlage', () => {
    expect(sideOf({ position: { x: '50.0%', y: '0.0%' } })).toBe('n');
    expect(sideOf({ position: { x: '100%', y: '50%' } })).toBe('e');
    expect(sideOf({ position: { x: '50%', y: '100%' } })).toBe('s');
    expect(sideOf({ position: { x: '0%', y: '50.5%' } })).toBe('w');
    expect(sideOf({ position: { x: '73.4%', y: '20%' } })).toBeUndefined();
    expect(sideOf({ snapTo: 'left' })).toBe('w');
    expect(sideOf({ snapTo: 'auto', position: { x: '50%', y: '100%' } })).toBe('s');
    expect(sideOf(undefined)).toBeUndefined();
    expect(pct('30%')).toBe(0.3);
    expect(num('14')).toBe(14);
  });

  it('alle 16 Miro-Spitzen auf Stachel-Spitzen; Felder wie capPatch im Web', () => {
    expect(Object.keys(MIRO_CAPS)).toHaveLength(16);
    for (const m of Object.values(MIRO_CAPS)) expect(CAP_STYLES).toContain(m.cap);
    for (const [s, e] of [['none', 'stealth'], ['filled_oval', 'arrow'], ['diamond', 'none'], ['erd_one', 'erd_many'], ['triangle', 'filled_diamond']]) {
      const r = map({ items: two, connectors: [conn('c', 'a', 'b', { style: { startStrokeCap: s, endStrokeCap: e } })] });
      const o = r.objects.find((x) => x.type === 'connector')!;
      const want = { ...capPatch('start', mapCap(s, 'start').cap), ...capPatch('end', mapCap(e, 'end').cap) };
      for (const [k, v] of Object.entries(want)) expect(o[k], `${s}/${e} ${k}`).toBe(v);
      for (const k of ['capStart', 'capEnd', 'arrowStart']) if (!(k in want) || want[k as keyof typeof want] === undefined) expect(o[k]).toBeUndefined();
    }
  });

  it('Linienart, Farbe, Strich, Art, Beschriftungen (erste am Verbinder, weitere als Text), Seiten', () => {
    const r = map({
      items: two,
      connectors: [
        conn('c1', 'a', 'b', {
          shape: 'elbowed',
          startItem: { id: 'a', position: { x: '100%', y: '50%' } },
          endItem: { id: 'b', position: { x: '0%', y: '50%' } },
          style: { strokeColor: '#e6282e', strokeWidth: '3.0', strokeStyle: 'dashed', fontSize: '18', color: '#0000ff', textOrientation: 'aligned', startStrokeCap: 'erd_zero_or_many', endStrokeCap: 'wurst' },
          captions: [{ content: '<p>ja</p>', position: '25%' }, { content: '<p>später</p>', position: '75%' }, { content: '<p></p>' }],
        }),
        conn('c2', 'a', 'b', { shape: 'straight' }),
        conn('c3', 'a', 'b'),
      ],
    });
    const [c1, c2, c3] = byType(r.objects, 'connector');
    expect(c1).toMatchObject({ from: { objectId: r.objects[0]!.id, side: 'e' }, to: { objectId: r.objects[1]!.id, side: 'w' }, lineStyle: 'elbow', color: '#e6282e', strokeWidth: 2, dash: 'dashed', text: 'ja', labelPos: 0.25, fontSize: 18, capStart: 'arrow', arrowStart: true, arrowEnd: true });
    expect(JSON.stringify(c1!.content)).toContain('#0000ff');
    expect(c2!.lineStyle).toBeUndefined();
    expect(c3!.lineStyle).toBe('curved');
    expect(c3).toMatchObject({ color: '#1a1a1a', strokeWidth: 2, arrowEnd: true });
    expect(c3!.labelPos).toBeUndefined();
    const extra = r.objects[r.objects.length - 1]!;
    // 75 % zwischen den Mitten (0,0) und (400,0) → 300
    expect(extra).toMatchObject({ type: 'text', text: 'später', fontSize: 18, align: 'center' });
    expect((extra.x as number) + (extra.w as number) / 2).toBe(300);
    expect(codes(r.report.adjusted)).toMatchObject({ connector_caption_extra: 1, connector_text_orientation: 1, connector_erd: 1, connector_cap_unknown: 1, stroke_width: 1 });
  });

  it('Enden an nicht übernommenen Objekten → frei an deren Mitte; ohne Lage/ohne Ende → weglassen; Verbinder oben', () => {
    const r = map({
      items: [...two, it_('t', 'data_table_format', at(1000, 500, 200, 100))],
      connectors: [conn('c1', 'a', 't'), conn('c2', 'a', 'gibtsnicht'), conn('c3', null, 'b'), conn('c4', 'b', 'a', { isSupported: false })],
    });
    const cs = byType(r.objects, 'connector');
    expect(cs).toHaveLength(2);
    expect(cs[0]!.to).toEqual({ x: 1000, y: 500 });
    expect(r.objects.slice(-2).every((o) => o.type === 'connector')).toBe(true);
    expect(codes(r.report.adjusted).connector_free_end).toBe(1);
    expect(codes(r.report.skipped)).toMatchObject({ connector_no_end: 2, table: 1 });
  });
});

// ---- Gruppen, Tags ---------------------------------------------------------------------------------------------------

describe('Gruppen und Tags', () => {
  it('Gruppe → gleiche groupId; Gruppen mit nur einem übernommenen Mitglied lösen sich auf', () => {
    const r = map({
      items: [it_('a', 'sticky_note'), it_('b', 'shape'), it_('c', 'sticky_note'), it_('t', 'data_table_format')],
      groups: [{ id: 'g1', items: ['a', 'b'] }, { id: 'g2', items: ['c', 't'] }],
    });
    const [a, b, c] = r.objects;
    expect(a!.groupId).toBeTruthy();
    expect(a!.groupId).toBe(b!.groupId);
    expect(c!.groupId).toBeUndefined();
  });

  it('Tags an Notizen und Karten: Name ≤ 40, höchstens 8, doppelte Namen einmal, Farben auf Tag-Farben', () => {
    const tags = Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, title: i === 0 ? 'x'.repeat(50) : i === 1 ? 'Doppelt' : i === 2 ? 'doppelt' : `Tag ${i}`, fillColor: i % 2 ? 'red' : 'blue' }));
    const r = map({
      items: [it_('s', 'sticky_note', { tagIds: ['t0', 't1'] }), it_('c', 'card', { data: { title: 'K' } }), it_('f', 'shape')],
      tags,
      itemTags: { s: tags.map((t) => t.id), c: ['t3', 'unbekannt'], f: ['t3'] },
    });
    const [s, c, f] = r.objects;
    const st = s!.tags as { label: string; color: string }[];
    expect(st).toHaveLength(8);
    expect(st[0]!.label).toBe('x'.repeat(40));
    expect(st.filter((t) => t.label.toLowerCase() === 'doppelt')).toHaveLength(1);
    for (const t of st) expect(STACHEL_TAG_COLORS).toContain(t.color);
    expect(c!.tags).toEqual([{ label: 'Tag 3', color: '#ec4e92' }]);
    expect(f!.tags).toBeUndefined();
    expect(codes(r.report.adjusted).tag_name_cut).toBe(1);
    expect(codes(r.report.skipped).tag_limit).toBe(2);
  });
});

// ---- Mindmap ---------------------------------------------------------------------------------------------------------

describe('Mindmap', () => {
  const node = (id: string, text: string, x: number, y: number, parent?: string, data: Record<string, unknown> = {}): MiroMindNode => ({
    id,
    type: 'mindmap_node',
    data: { nodeView: { type: 'text', data: { content: `<p>${text}</p>` } }, ...data },
    position: { x, y, origin: 'center', relativeTo: 'canvas_center' },
    geometry: { width: 100, height: 40 },
    ...(parent ? { parent: { id: parent } } : {}),
  });

  it('Baum je Wurzel, Seiten aus direction bzw. Lage, Reihenfolge nach Lage, IDs wie mind.tree, Verbinder an Knoten', () => {
    const r = map({
      mindNodes: [node('k2', 'Unten', 200, 100, 'r'), node('r', 'Wurzel', 10, 20, undefined, { isRoot: true }), node('k1', 'Oben', 200, -100, 'r', { direction: 'end' }), node('k3', 'Links', -200, 0, 'r'), node('k11', 'Kind', 400, -100, 'k1', { direction: 'start' })],
      items: [it_('s', 'sticky_note', at(-600, 0))],
      connectors: [conn('c', 's', 'k3', { endItem: { id: 'k3', position: { x: '0%', y: '50%' } } })],
    });
    expect(r.minds).toHaveLength(1);
    const m = r.minds[0]!;
    expect(m).toMatchObject({ x: 10, y: 20 });
    expect(m.tree).toEqual({ text: 'Wurzel', children: [{ text: 'Oben', side: 'r', children: [{ text: 'Kind' }] }, { text: 'Links', side: 'l' }, { text: 'Unten', side: 'r' }] });
    // Vorordnung wie web-impl: Oben = -1, Kind = -2, Links = -3
    const c = byType(r.objects, 'connector')[0]!;
    expect(c.to).toEqual({ objectId: `${m.rootId}-3` });
    expect(r.report.imported.mindnode).toBe(5);
    expect(codes(r.report.adjusted).mindmap_layout).toBe(1);
  });

  it('Grenzen: 10 Ebenen, 400 Knoten je Mindmap', () => {
    const deep: MiroMindNode[] = [node('d0', 'Wurzel', 0, 0, undefined, { isRoot: true })];
    for (let i = 1; i < 14; i++) deep.push(node(`d${i}`, `E${i}`, i * 100, 0, `d${i - 1}`));
    const wide: MiroMindNode[] = [node('w0', 'Breit', 5000, 0, undefined, { isRoot: true })];
    for (let i = 1; i <= 450; i++) wide.push(node(`w${i}`, `K${i}`, 5200, i, 'w0'));
    const r = map({ mindNodes: [...deep, ...wide] });
    const depth = (t: { children?: unknown[] }): number => 1 + Math.max(0, ...((t.children ?? []) as { children?: unknown[] }[]).map(depth));
    const count = (t: { children?: unknown[] }): number => 1 + ((t.children ?? []) as { children?: unknown[] }[]).reduce((s, k) => s + count(k), 0);
    expect(depth(r.minds[0]!.tree)).toBe(NATIVE_MIND_LIMITS.maxDepth);
    expect(count(r.minds[1]!.tree)).toBe(NATIVE_MIND_LIMITS.maxNodes);
    expect(codes(r.report.skipped).mindmap_limit).toBe(4 + 51);
    for (const mm of r.minds) expect(() => validateOps([{ op: 'mind', do: 'tree', new: mm.rootId, x: mm.x, y: mm.y, tree: mm.tree }])).not.toThrow();
  });
});

// ---- Bericht, Grenzen, Optionen --------------------------------------------------------------------------------------

describe('Bericht und Grenzen', () => {
  it('stabile Codes mit deutschen Texten; Hinweise aus dem Lesen kommen in den Bericht', () => {
    for (const [code, text] of Object.entries(REPORT_TEXTS)) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(text.length).toBeGreaterThan(10);
    }
    const r = map({ warnings: [{ code: 'mindmap_unavailable', text: 'Mindmaps konnten nicht gelesen werden', count: 1 }] });
    expect(r.report.skipped).toEqual([{ code: 'mindmap_unavailable', text: 'Mindmaps konnten nicht gelesen werden', count: 1 }]);
    expect(r.report.notes[0]).toContain('Tabellen, Kommentare, Freihand-Zeichnungen');
    expect(r.title).toBe('Test');
    expect(mapBoard(board({ board: { id: 'x', name: '  ' } })).title).toBe('Import aus Miro');
  });

  it('Obergrenzen für Objekte und Bilder', () => {
    const items = Array.from({ length: 10 }, (_, i) => it_(`s${i}`, 'sticky_note', at(i * 300, 0)));
    const imgs = Array.from({ length: 5 }, (_, i) => it_(`i${i}`, 'image', { data: { imageUrl: `https://api.miro.com/i${i}` } }));
    const r = map({ items: [...items, ...imgs], connectors: [conn('c', 's0', 's9')] }, { maxObjects: 8, maxImages: 2 });
    expect(r.objects).toHaveLength(8);
    // 7 Notizen/Bilder + 1 Verbinder über der Grenze
    expect(codes(r.report.skipped)).toMatchObject({ object_limit: 8 });
    const r2 = map({ items: imgs }, { maxImages: 2 });
    expect(r2.assets).toHaveLength(2);
    expect(codes(r2.report.skipped).image_limit).toBe(3);
  });

  it('Board-Beschreibung als Text oben links (abschaltbar)', () => {
    const data = { board: { id: 'b', name: 'B', description: 'Zeile 1\nZeile 2' }, items: [it_('s', 'sticky_note', at(100, 100))] };
    const on = map(data);
    const d = on.objects[on.objects.length - 1]!;
    expect(d).toMatchObject({ type: 'text', text: 'Zeile 1\nZeile 2', x: 50 });
    expect((d.y as number) + (d.h as number)).toBeLessThan(50);
    expect(map(data, { description: false }).objects).toHaveLength(1);
  });
});

// ---- Fixtures: Prüfregeln und Web-Store ------------------------------------------------------------------------------

describe('Fixtures', () => {
  const boards = miroFixtureBoards();
  it('es gibt Workshop-, Flussdiagramm- und Mindmap-Board (nachgebaut und echt)', () => {
    expect(boards).toEqual(expect.arrayContaining(['flowchart', 'mindmap', 'workshop', 'echt_flowchart', 'echt_mindmap', 'echt_workshop']));
  });

  it('echt_workshop: Tags über item_tags, Gruppe über group.id, Notizformen, Rahmen-Kinder absolut', () => {
    const data = loadMiroFixture('echt_workshop');
    const r = mapBoard(data, { newId: ids() });
    const stickies = byType(r.objects, 'sticky');
    expect(stickies).toHaveLength(20);
    for (const o of stickies) {
      expect(STICKY_COLORS).toContain(o.color);
      // Quadrat w = h, Rechteck w = 1,75 · h (Miro liefert 199 × 228 bzw. 230 × 149,8)
      const ratio = (o.w as number) / (o.h as number);
      expect([1, 1.75].some((x) => Math.abs(ratio - x) < 0.01)).toBe(true);
    }
    const tagged = stickies.filter((o) => o.tags);
    expect(tagged.length).toBe(6);
    expect((tagged[0]!.tags as { label: string }[]).map((t) => t.label)).toEqual(['Wichtig']);
    // Gruppe: Text mit Hintergrund (+ Fläche) und zwei Formen
    const groups = new Map<string, number>();
    for (const o of r.objects) if (typeof o.groupId === 'string') groups.set(o.groupId, (groups.get(o.groupId) ?? 0) + 1);
    expect([...groups.values()]).toEqual([4]);
    // Kind im Rahmen (Mitte 1600/300, 1000 × 700 → Ecke 1100/−50): „Was lief gut?“ bei (150, 165) relativ
    const frame = byType(r.objects, 'frame')[0]!;
    expect(frame).toMatchObject({ x: 1100, y: -50, title: 'Retro-Rahmen' });
    const kid = stickies.find((o) => o.text === 'Was lief gut?')!;
    expect(kid.x).toBeGreaterThanOrEqual(frame.x as number);
    expect((kid.x as number) + (kid.w as number)).toBeLessThanOrEqual((frame.x as number) + (frame.w as number));
    expect(r.assets.map((a) => a.kind).sort()).toEqual(['document', 'image', 'image']);
    expect(r.report.skipped).toEqual([]);
  });

  it('echt_flowchart: 21 v2-Formen + 8 Flussdiagramm-Formen (isSupported:false in /items, Daten aus v2-experimental)', () => {
    const data = loadMiroFixture('echt_flowchart');
    expect(data.items.filter((i) => i.isSupported === false)).toHaveLength(8);
    const r = mapBoard(data, { newId: ids() });
    const shapes = byType(r.objects, 'shape');
    expect(shapes).toHaveLength(29);
    expect(new Set(shapes.map((o) => o.shape))).toEqual(new Set(['rect', 'roundrect', 'ellipse', 'triangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'callout', 'star', 'predefined', 'cloud', 'cross', 'cylinder', 'arrowRight', 'arrowLeft', 'arrowDouble', 'braceLeft', 'braceRight', 'terminator', 'document', 'manualInput']));
    // Text der Flussdiagramm-Formen steckt in <span style=…><p>…</p></span>
    expect(shapes.find((o) => o.shape === 'terminator')!.text).toBe('terminator');
    expect(codes(r.report.adjusted).shape_opacity).toBe(8);
    expect(codes(r.report.skipped).unsupported_item).toBeUndefined();
    // alle 11 Verbinder hängen an übernommenen Formen
    const conns = byType(r.objects, 'connector');
    expect(conns).toHaveLength(11);
    for (const c of conns) for (const e of [c.from, c.to] as { objectId?: string }[]) expect(r.objects.some((o) => o.id === e.objectId)).toBe(true);
    // 30 %/70 %: keine Seitenmitte → ohne side
    expect(conns.find((c) => c.text === 'frei angedockt')!.from).toEqual({ objectId: expect.any(String) });
  });

  it('echt_mindmap: Knoten aus mindmap_nodes (relativ zum Elternknoten), /items-Knoten ignoriert, Tabelle und Freihand im Bericht', () => {
    const data = loadMiroFixture('echt_mindmap');
    const r = mapBoard(data, { newId: ids() });
    expect(r.minds).toHaveLength(1);
    const count = (t: { children?: unknown[] }): number => 1 + ((t.children ?? []) as { children?: unknown[] }[]).reduce((s, k) => s + count(k), 0);
    expect(count(r.minds[0]!.tree)).toBe(14);
    expect(r.minds[0]!.tree.text).toBe('Stachel-Import');
    for (const k of r.minds[0]!.tree.children!) expect(k.side).toBe(k.text.startsWith('Links') ? 'l' : 'r');
    expect(codes(r.report.skipped)).toEqual({ table: 1, freehand: 1 });
    expect(r.report.imported.mindnode).toBe(14);
  });

  it.each(boards)('%s: jedes Objekt erfüllt die Prüfregeln der Native-API (create, Rich-Text, Mindmap)', (name) => {
    const r = mapBoard(loadMiroFixture(name), { newId: ids() });
    expect(r.objects.length).toBeGreaterThan(0);
    const assetIds = new Set(r.assets.map((a) => a.objectId));
    for (const o of r.objects) {
      // Dateien setzt der Import nach dem Laden (S1); hier wie dort eine gültige ID
      const filled: Record<string, unknown> = { ...o, ...(o.imageId === '' ? { imageId: 'asset1' } : {}), ...(o.docFile === '' ? { docFile: 'asset2' } : {}) };
      if (o.imageId === '' || o.docFile === '') expect(assetIds.has(o.id)).toBe(true);
      const { content, ...rest } = filled;
      expect(() => validateOps([{ op: 'create', objects: [rest] }]), JSON.stringify(rest).slice(0, 300)).not.toThrow();
      if (content !== undefined) {
        expect(() => validateOps([{ op: 'text', id: o.id, base: 0, doc: content }])).not.toThrow();
        expect(WEB.plainOf(content)).toBe(o.text);
      }
      for (const k of ['createdBy', 'updatedAt', 'z', 'assignee']) expect(o[k]).toBeUndefined();
    }
    for (const m of r.minds) expect(() => validateOps([{ op: 'mind', do: 'tree', new: m.rootId, x: m.x, y: m.y, tree: m.tree }])).not.toThrow();
    // keine Personendaten aus den Rohantworten
    const json = JSON.stringify(r);
    expect(json).not.toContain('3458764500000000001');
    expect(json).not.toContain('Person A');
  });

  it.each(boards)('%s: lässt sich mit dem Web-Store bauen (createMany + mind.tree), Verbinder-Enden existieren', (name) => {
    const r = mapBoard(loadMiroFixture(name));
    const doc = new Y.Doc();
    const store = WEB.createStore(doc, 'm:1', 'import');
    let n = 0;
    store.createMany(r.objects.map((o) => ({ ...o, ...(o.imageId === '' ? { imageId: `img${++n}` } : {}), ...(o.docFile === '' ? { docFile: `pdf${++n}` } : {}) })));
    for (const m of r.minds) expect(store.mind.tree(m.rootId, m.x, m.y, m.tree)).toBe(true);
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const minds = r.report.imported.mindnode ?? 0;
    expect(objects.size).toBe(r.objects.length + minds);
    for (const o of r.objects) {
      const y = objects.get(o.id)!;
      expect(y.get('type')).toBe(o.type);
      if (o.content) expect(WEB.plainOf(WEB.fragmentToJson(y.get('content') as Y.XmlFragment))).toBe(o.text);
      if (o.type === 'connector') {
        for (const end of [o.from, o.to] as Record<string, unknown>[]) if (typeof end.objectId === 'string') expect(objects.has(end.objectId), `${name}: Ende ${end.objectId}`).toBe(true);
      }
    }
    // Mindmap-Knoten sind echte mindnode-Objekte mit Text
    if (minds) {
      const texts = [...objects.values()].filter((m) => m.get('type') === 'mindnode').map((m) => m.get('text'));
      expect(texts).toContain(r.minds[0]!.tree.text);
    }
    store.destroy();
  });
});
