import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../../editor/core';
import type { BoardObject } from '../../protocol';
import { objRect } from '../../board/geometry';
import { compareObjects } from '../../board/store';
import { layerStepPatches } from './layers';
import { buildPdf, pdfText, rgbaToRgb } from './export/pdf';
import { exportPages, pageSizePt } from './export/exporter';
import { clampScale } from './export/render';
import { findHits } from './search';
import { extractStyle, stylePatch } from './formatPainter';
import { DEFAULT_SETTINGS, isDark, readSettings } from './settings';
import { gridMove, snapToGrid } from './grid';
import { keyCaps } from './ShortcutsDialog';
import { thumbRect, THUMB_H, THUMB_W } from './thumbnail';
import { hiddenCss } from './hide';
import { fileName, objectLink } from './util';

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
const snapOf = (objs: BoardObject[]) => {
  const ordered = [...objs].sort(compareObjects);
  return { version: 1, byId: new Map(ordered.map((o) => [o.id, o])), ordered, rank: new Map(ordered.map((o, i) => [o.id, i])), topZ: null, bottomZ: null };
};
const applyZ = (objs: BoardObject[], patches: Record<string, { z: string }>) =>
  objs
    .map((o) => (patches[o.id] ? { ...o, ...patches[o.id] } : o))
    .sort(compareObjects)
    .map((o) => o.id);

describe('Ebenen schrittweise', () => {
  const a = obj({ id: 'a', type: 'sticky', z: 'a1' });
  const b = obj({ id: 'b', type: 'sticky', z: 'a2', x: 50 });
  const c = obj({ id: 'c', type: 'sticky', z: 'a3', x: 500 }); // überlappt nicht
  const d = obj({ id: 'd', type: 'sticky', z: 'a4', x: 20 });
  const f = obj({ id: 'f', type: 'frame', z: 'a0', w: 900, h: 900 });
  const all = [f, a, b, c, d];

  it('nach vorne über das nächste überlappende Objekt (nicht überlappende zählen nicht)', () => {
    const p = layerStepPatches(snapOf(all).ordered, new Set(['a']), 1);
    expect(Object.keys(p)).toEqual(['a']);
    expect(applyZ(all, p)).toEqual(['f', 'b', 'a', 'c', 'd']);
    const p2 = layerStepPatches(snapOf(all).ordered, new Set(['b']), 1);
    expect(applyZ(all, p2)).toEqual(['f', 'a', 'c', 'd', 'b']);
  });

  it('nach hinten; ganz unten passiert nichts; Rahmen bleiben unter allem', () => {
    expect(applyZ(all, layerStepPatches(snapOf(all).ordered, new Set(['d']), -1))).toEqual(['f', 'a', 'd', 'b', 'c']);
    expect(layerStepPatches(snapOf(all).ordered, new Set(['a']), -1)).toEqual({});
    expect(layerStepPatches(snapOf(all).ordered, new Set(['f']), 1)).toEqual({});
  });

  it('mehrere ausgewählte überholen sich nicht', () => {
    const p = layerStepPatches(snapOf(all).ordered, new Set(['a', 'b']), 1);
    expect(applyZ(all, p)).toEqual(['f', 'c', 'd', 'a', 'b']);
  });
});

describe('PDF', () => {
  it('baut eine gültige Struktur mit korrekter xref-Tabelle', () => {
    const img = { width: 2, height: 1, data: new Uint8Array([1, 2, 3, 4, 5, 6]), filter: 'FlateDecode' as const };
    const bytes = buildPdf(
      [
        { widthPt: 200, heightPt: 100, image: img },
        { widthPt: 100.123, heightPt: 300, image: img },
      ],
      { title: 'Lageplan Größe', date: new Date(Date.UTC(2026, 9, 23, 12, 0, 0)) },
    );
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 100.12 300]');
    expect(text).toContain('/CreationDate (D:20261023120000Z)');
    expect(text).toContain(`/Title ${pdfText('Lageplan Größe')}`);
    // startxref zeigt auf „xref“, jeder Eintrag auf „n 0 obj“
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text.slice(startxref).split('\n').slice(3, 3 + 9);
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('Titel als UTF-16 und RGBA → RGB auf Hintergrund', () => {
    expect(pdfText('Ä')).toBe('<FEFF00C4>');
    expect([...rgbaToRgb(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), [10, 20, 30])]).toEqual([255, 0, 0, 10, 20, 30]);
  });
});

describe('Export-Bereiche', () => {
  const frame = obj({ id: 'fr', type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Bühne', z: 'a0' });
  const inside = obj({ id: 'in', type: 'sticky', x: 20, y: 20, z: 'a1' });
  const outside = obj({ id: 'out', type: 'sticky', x: 1000, y: 0, z: 'a2' });
  const hidden = obj({ id: 'hid', type: 'sticky', x: 2000, y: 0, z: 'a3', hidden: true });
  const conn = obj({ id: 'cn', type: 'connector', z: 'a4', from: { objectId: 'in' }, to: { objectId: 'out' } });
  const snap = snapOf([frame, inside, outside, hidden, conn]);
  const bounds = (o: BoardObject) => (o.type === 'connector' ? { x: 70, y: 70, w: 980, h: 10 } : objRect(o));

  it('ganzes Board ohne Ausgeblendete, mit Rand', () => {
    const [p] = exportPages(snap, [], { kind: 'board' }, bounds);
    expect(p.objects.map((o) => o.id)).not.toContain('hid');
    expect(p.rect).toEqual({ x: -40, y: -40, w: 1180, h: 380 });
  });

  it('Auswahl nimmt Verbinder zwischen ausgewählten Objekten mit; Rahmen = Rahmen-Ausschnitt', () => {
    const [p] = exportPages(snap, ['in', 'out'], { kind: 'selection' }, bounds);
    expect(p.objects.map((o) => o.id)).toEqual(['in', 'out', 'cn']);
    const [f] = exportPages(snap, ['fr'], { kind: 'selection' }, bounds);
    expect(f.rect).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(f.label).toBe('Bühne');
    expect(f.objects.map((o) => o.id)).toEqual(['fr', 'in', 'cn']);
    expect(exportPages(snap, [], { kind: 'frames' }, bounds)).toHaveLength(1);
    expect(exportPages(snap, [], { kind: 'selection' }, bounds)).toEqual([]);
  });

  it('Seitengröße und Maßstab begrenzt', () => {
    expect(pageSizePt({ x: 0, y: 0, w: 800, h: 600 })).toEqual({ widthPt: 600, heightPt: 450 });
    const big = pageSizePt({ x: 0, y: 0, w: 10000, h: 5000 });
    expect(big.widthPt).toBeCloseTo(1684);
    expect(clampScale({ x: 0, y: 0, w: 20000, h: 1000 }, 2)).toBeCloseTo(8192 / 20000);
    expect(clampScale({ x: 0, y: 0, w: 500, h: 400 }, 2)).toBe(2);
    expect(clampScale({ x: 0, y: 0, w: 6000, h: 6000 }, 3)).toBeCloseTo(1);
  });
});

describe('Suche', () => {
  it('findet ohne Groß/Klein und Umlaut-tolerant, in Lesereihenfolge, ohne Ausgeblendete', () => {
    const objs = [
      obj({ type: 'sticky', text: 'Getränke Bühne', x: 500, y: 10 }),
      obj({ type: 'sticky', text: 'Bühnenplan', x: 0, y: 20 }),
      obj({ type: 'frame', title: 'Buehne Nord', x: 0, y: 400 }),
      obj({ type: 'sticky', text: 'Bühne versteckt', hidden: true }),
      obj({ type: 'sticky', text: 'Müll' }),
    ];
    const hits = findHits(objs, 'buhne', objRect);
    expect(hits.map((h) => (h.o.text ?? h.o.title)?.slice(0, 6))).toEqual(['Bühnen', 'Geträn', 'Buehne']);
    expect(findHits(objs, 'buhne', objRect, true)).toHaveLength(4);
    expect(findHits(objs, '  ', objRect)).toEqual([]);
  });
});

describe('Format übertragen', () => {
  it('gleicher Typ: alles (auch Zurücksetzen), anderer Typ: Textformat und passende Farbe', () => {
    const src = obj({ type: 'sticky', color: '#ffb3d1', bold: true, align: 'left', fontSize: 24 });
    const s = extractStyle(src);
    expect(stylePatch(s, obj({ type: 'sticky', italic: true }))).toEqual({ color: '#ffb3d1', bold: true, align: 'left', fontSize: 24, italic: undefined });
    expect(stylePatch(s, obj({ type: 'shape' }))).toEqual({ color: '#ffb3d1', bold: true, align: 'left', fontSize: 24 });
    expect(stylePatch(s, obj({ type: 'text' }))).toEqual({ bold: true, align: 'left', fontSize: 24 });
    expect(stylePatch(extractStyle(obj({ type: 'connector', color: '#1763b5', lineStyle: 'elbow' })), obj({ type: 'pen' }))).toEqual({ color: '#1763b5' });
    expect(stylePatch(s, { ...src, id: 'x' })).toBeNull();
  });
});

describe('Board-Einstellungen, Raster, Kürzel', () => {
  it('liest fehlende/fremde Werte als Standard', () => {
    const doc = new Y.Doc();
    const m = doc.getMap('tools.settings');
    expect(readSettings(m)).toEqual(DEFAULT_SETTINGS);
    m.set('pattern', 'lines');
    m.set('color', '#2A2A27');
    expect(readSettings(m)).toEqual({ pattern: 'lines', color: '#2a2a27', authors: false });
    m.set('authors', true);
    expect(readSettings(m).authors).toBe(true);
    m.set('authors', 'ja');
    m.set('pattern', 'kariert');
    m.set('color', 'red');
    expect(readSettings(m)).toEqual(DEFAULT_SETTINGS);
    expect(isDark('#2a2a27')).toBe(true);
    expect(isDark('#f3f3ef')).toBe(false);
  });

  it('Einrasten nur bei aktivem Ziehen', () => {
    const o = obj({ type: 'sticky', x: 5, y: 7 });
    let on = false;
    const move = gridMove(undefined, () => on);
    expect(move(o, 30, 30)).toEqual({ x: 35, y: 37 });
    on = true;
    expect(move(o, 30, 30)).toEqual({ x: 24, y: 48 });
    expect(snapToGrid(-13)).toBe(-24);
  });

  it('zerlegt Kürzel in Tastenkappen', () => {
    expect(keyCaps('Strg Umschalt G')).toEqual([['Strg', 'Umschalt', 'G']]);
    expect(keyCaps('Strg Z / Strg Y')).toEqual([
      ['Strg', 'Z'],
      ['Strg', 'Y'],
    ]);
    expect(keyCaps('Leertaste + Ziehen')).toEqual([['Leertaste', '+', 'Ziehen']]);
    expect(keyCaps('Bild ↑ / Bild ↓')).toEqual([['Bild ↑'], ['Bild ↓']]);
    expect(keyCaps('?')).toEqual([['?']]);
  });
});

describe('Vorschaubild, Ausblenden, Hilfen', () => {
  it('Ausschnitt im Seitenverhältnis der Karte', () => {
    const r = thumbRect([obj({ type: 'sticky', x: 0, y: 0, w: 100, h: 100 })], objRect)!;
    expect(r.w / r.h).toBeCloseTo(THUMB_W / THUMB_H);
    expect(r.x + r.w / 2).toBeCloseTo(50);
    expect(r.y + r.h / 2).toBeCloseTo(50);
    expect(thumbRect([], objRect)).toBeNull();
  });

  it('CSS für Ausgeblendete', () => {
    expect(hiddenCss([], false)).toBe('');
    expect(hiddenCss(['a'], false)).toContain('visibility: hidden');
    expect(hiddenCss(['a'], true)).toContain('opacity: 0.38');
  });

  it('Dateinamen und Links', () => {
    expect(fileName('Sommerfest: Tag 2 / Ablauf?', 'png')).toBe('Sommerfest Tag 2 Ablauf.png');
    expect(fileName('  ', 'pdf')).toBe('Stachel.pdf');
    expect(objectLink('b1', 'x y', 'https://s.test')).toBe('https://s.test/?b=b1&o=x+y');
    // Web-App unter STACHEL_BASE_PATH (server/src/site.ts)
    expect(objectLink('b1', 'n_1', 'https://s.test', '/app/')).toBe('https://s.test/app/?b=b1&o=n_1');
    expect(objectLink(null, 'n_1', 'https://s.test', '/app/')).toBe('https://s.test/app/?offline=1&o=n_1');
  });
});
