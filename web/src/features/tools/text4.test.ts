// Runde 4 (x-text): Format übertragen nur mit Formatfeldern je Typ (B1), Suche findet Tags und Personen.
import { describe, expect, it } from 'vitest';
import '../../editor/core';
import '../structure/card/card';
import '../structure/table/table';
import '../structure/mindmap/mindmap';
import type { BoardObject } from '../../protocol';
import { extractStyle, stylePatch } from './formatPainter';
import { findHits } from './search';
import { objRect } from '../../board/geometry';

let seq = 0;
const obj = (p: Partial<BoardObject> & { type: BoardObject['type'] }): BoardObject => ({
  id: p.id ?? `o${++seq}`,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: `a${seq}`,
  createdBy: '',
  updatedAt: '',
  ...p,
});

describe('Format übertragen: Positivliste', () => {
  it('Karte: nur die Farbe, Beschreibung/Person/Datum/Status/Tags bleiben', () => {
    const a = obj({ type: 'card', text: 'A', color: '#ec4e92', desc: 'Beschreibung A', assignee: { key: 'm:1', name: 'Mara' }, due: '2026-11-01', status: 'doing', tags: [{ label: 'Bühne', color: '#c9e14a' }] });
    const b = obj({ type: 'card', text: 'B', color: '#1763b5', desc: 'Beschreibung B', assignee: { key: 'm:2', name: 'Jonas' }, due: '2026-12-24', status: 'todo', tags: [{ label: 'Später', color: '#1763b5' }] });
    expect(stylePatch(extractStyle(a), b)).toEqual({ color: '#ec4e92' });
  });

  it('Tabelle: Kopfbereich und Farbe, nie der Inhalt', () => {
    const src = obj({ type: 'table', color: '#ec4e92', tableHead: 'both', table: { rows: ['r'], cols: ['c'], cells: { 'r:c': 'Quelle' }, widths: {} } });
    const dst = obj({ type: 'table', color: '#0a0a0a', table: { rows: ['x'], cols: ['y'], cells: { 'x:y': 'Ziel' }, widths: {} } });
    expect(stylePatch(extractStyle(src), dst)).toEqual({ color: '#ec4e92', tableHead: 'both' });
  });

  it('Mindmap-Knoten: Baum (mind) bleibt', () => {
    const src = obj({ type: 'mindnode', text: 'Kind1', color: '#ec4e92', mind: { parent: 'r', order: 1, side: 'r', level: 1 } });
    const dst = obj({ type: 'mindnode', text: 'Kind2', color: '#1763b5', mind: { parent: 'q', order: 2, side: 'l', level: 2 } });
    expect(stylePatch(extractStyle(src), dst)).toEqual({ color: '#ec4e92' });
  });

  it('Haftnotiz: Tags, Link und Inhalt bleiben, Format wird übertragen bzw. zurückgesetzt', () => {
    const src = obj({ type: 'sticky', text: 'Q', color: '#ffb3d1', bold: true, fontFamily: 'serif', tags: [{ label: 'Wichtig', color: '#ec4e92' }], linkTo: 'f1' });
    const dst = obj({ type: 'sticky', text: 'Z', italic: true, tags: [{ label: 'Später', color: '#1763b5' }] });
    expect(stylePatch(extractStyle(src), dst)).toEqual({ color: '#ffb3d1', bold: true, fontFamily: 'serif', italic: undefined });
  });

  it('Form: Rand und Füllung, aber nicht die Formart', () => {
    const src = obj({ type: 'shape', shape: 'ellipse', color: '#c9e14a', stroke: '#0a0a0a', strokeWidth: 4, dash: 'dashed', fillOpacity: 0.5 });
    const dst = obj({ type: 'shape', shape: 'rect', text: 'Bühne' });
    expect(stylePatch(extractStyle(src), dst)).toEqual({ color: '#c9e14a', stroke: '#0a0a0a', strokeWidth: 4, dash: 'dashed', fillOpacity: 0.5 });
  });

  it('Verbinder: Linienformat, nicht Enden oder Beschriftung', () => {
    const src = obj({ type: 'connector', from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, text: 'ja', color: '#1763b5', lineStyle: 'elbow', capEnd: 'circle', labelPos: 0.2 });
    const dst = obj({ type: 'connector', from: { objectId: 'a' }, to: { objectId: 'b' }, text: 'nein' });
    expect(stylePatch(extractStyle(src), dst)).toEqual({ color: '#1763b5', lineStyle: 'elbow', capEnd: 'circle' });
  });

  it('zwischen Typen: Textformat nur, wo beide es kennen; Karte nimmt kein Textformat', () => {
    const s = extractStyle(obj({ type: 'sticky', color: '#ffb3d1', bold: true, align: 'left', fontSize: 24 }));
    expect(stylePatch(s, obj({ type: 'card', desc: 'x' }))).toBeNull();
    expect(stylePatch(s, obj({ type: 'text' }))).toEqual({ bold: true, align: 'left', fontSize: 24 });
  });
});

describe('Suche (Strg F)', () => {
  it('findet Tags von Notizen und Karten sowie die zuständige Person', () => {
    const objs = [
      obj({ type: 'sticky', text: 'Getränke', tags: [{ label: 'Dringend', color: '#ec4e92' }], x: 0, y: 0 }),
      obj({ type: 'card', text: 'Bühnenplan', assignee: { key: 'm:1', name: 'Mara Lindner' }, tags: [{ label: 'Technik', color: '#1763b5' }], x: 300, y: 0 }),
      obj({ type: 'sticky', text: 'Müll', x: 0, y: 300 }),
    ];
    expect(findHits(objs, 'dringend', objRect).map((h) => h.o.text)).toEqual(['Getränke']);
    expect(findHits(objs, 'mara', objRect).map((h) => h.o.text)).toEqual(['Bühnenplan']);
    expect(findHits(objs, 'technik', objRect).map((h) => h.o.text)).toEqual(['Bühnenplan']);
    expect(findHits(objs, 'müll', objRect)).toHaveLength(1);
  });
});
