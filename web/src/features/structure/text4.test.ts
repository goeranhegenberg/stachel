// Runde 4: Live-Textfelder (B2 Karten-Dialog, B4 Tabellenzellen) – gleichzeitiges Tippen verliert nichts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../../editor/core';
import './index';
import { BoardStore } from '../../board/store';
import { matrix, tableFrom } from './table/model';
import { cellSource, migrateCell, setCell } from './table/yjs';
import { newTable, tableEnv } from './table/table';
import { freeSpot } from './templates/place';
import { parseTsv, pasteChoice, pasteLines } from './paste';
import { mapPos, migrateToYText, rebase, spliceOf, stringFieldSource, yTextSource, applySplice } from './ytext';

const fresh = (key = 'm:1') => new BoardStore(new Y.Doc(), key);
/** zwei verbundene Geräte; `sync()` tauscht alle Änderungen aus */
function pair() {
  const a = fresh('m:1');
  const b = fresh('m:2');
  const sync = () => {
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));
  };
  return { a, b, sync };
}

describe('Text-Abgleich', () => {
  it('kleinste Änderung, Schreibmarke, Drei-Wege', () => {
    expect(spliceOf('Hallo Welt', 'Hallo schöne Welt')).toEqual({ index: 6, del: 0, ins: 'schöne ' });
    expect(spliceOf('abc', 'ac')).toEqual({ index: 1, del: 1, ins: '' });
    expect(mapPos(8, 'Hallo Welt', 'Oh Hallo Welt')).toBe(11);
    expect(mapPos(2, 'Hallo Welt', 'Hallo Welt!')).toBe(2);
    // ich tippe am Anfang, jemand anderes am Ende
    const base = 'Mara schreibt.';
    const mine = 'Ja, Mara schreibt.';
    const theirs = 'Mara schreibt. Jonas ergänzt.';
    expect(applySplice(theirs, rebase(base, mine, theirs))).toBe('Ja, Mara schreibt. Jonas ergänzt.');
    // beide hängen ans Ende an
    expect(applySplice('aY', rebase('a', 'aX', 'aY'))).toBe('aXY');
  });
});

describe('Karte: Beschreibung als Y.Text (B2)', () => {
  it('gleichzeitiges Tippen zweier Personen in dieselbe Beschreibung geht nicht verloren', () => {
    const { a, b, sync } = pair();
    const id = a.create({ type: 'card', x: 0, y: 0, w: 300, h: 96, text: 'Karte', desc: 'Mara schreibt hier.' });
    sync();
    // alte Karte mit String-Feld lädt und wird beim Öffnen umgestellt
    expect(b.get(id)!.desc).toBe('Mara schreibt hier.');
    migrateToYText(a, a.objects.get(id), 'desc');
    sync();
    expect(b.objects.get(id)!.get('desc')).toBeInstanceOf(Y.Text);
    const sa = yTextSource(a, () => a.objects.get(id), 'desc');
    const sb = yTextSource(b, () => b.objects.get(id), 'desc');
    // beide tippen, bevor sich die Geräte abgleichen
    sb.write({ index: sb.read().length, del: 0, ins: ' Jonas ergänzt.' });
    sa.write({ index: sa.read().length, del: 0, ins: ' Mara noch was.' });
    sync();
    for (const s of [a, b]) {
      const d = s.get(id)!.desc!;
      expect(d).toContain('Jonas ergänzt.');
      expect(d).toContain('Mara noch was.');
      expect(d.startsWith('Mara schreibt hier.')).toBe(true);
    }
    expect(a.get(id)!.desc).toBe(b.get(id)!.desc);
  });

  it('Rückgängig nimmt die eigene Eingabe zurück', () => {
    const s = fresh();
    const id = s.create({ type: 'card', x: 0, y: 0, w: 300, h: 96, text: 'K' });
    s.stopCapturing();
    const src = yTextSource(s, () => s.objects.get(id), 'desc');
    src.write({ index: 0, del: 0, ins: 'Neu' });
    expect(s.get(id)!.desc).toBe('Neu');
    s.undo();
    expect(s.get(id)!.desc ?? '').toBe('');
  });

  it('Titel (String-Feld) gleicht gegen fremde Änderungen ab', () => {
    const s = fresh();
    const id = s.create({ type: 'card', x: 0, y: 0, w: 300, h: 96, text: 'Bühne' });
    const src = stringFieldSource(s, id, 'text');
    // jemand anderes hat inzwischen vorne etwas ergänzt
    s.update(id, { text: 'Große Bühne' });
    src.write(rebase('Bühne', 'Bühne Nord', src.read()));
    expect(s.get(id)!.text).toBe('Große Bühne Nord');
  });
});

describe('Tabellenzelle als Y.Text (B4)', () => {
  it('gleichzeitiges Tippen in derselben Zelle wird zusammengeführt, alte String-Zellen laden', () => {
    const { a, b, sync } = pair();
    const id = a.create(newTable({ x: 0, y: 0 }, tableFrom([['Mara', ''], ['', '']])));
    sync();
    const t = a.get(id)!.table!;
    const [r, c] = [t.rows[0], t.cols[0]];
    expect(matrix(b.get(id)!.table!)[0][0]).toBe('Mara');
    migrateCell(a, id, r, c);
    sync();
    const ca = cellSource(a, id, r, c, tableEnv);
    const cb = cellSource(b, id, r, c, tableEnv);
    for (const w of [' A1', ' A2', ' A3']) ca.write({ index: ca.read().length, del: 0, ins: w });
    for (const w of [' B1', ' B2', ' B3']) cb.write({ index: cb.read().length, del: 0, ins: w });
    sync();
    const va = matrix(a.get(id)!.table!)[0][0];
    expect(va).toBe(matrix(b.get(id)!.table!)[0][0]);
    for (const w of ['Mara', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3']) expect(va).toContain(w);
  });

  it('setCell auf eine Y.Text-Zelle ändert nur den Unterschied; Höhe wächst mit', () => {
    const s = fresh();
    const id = s.create(newTable({ x: 0, y: 0 }));
    const o = s.get(id)!;
    const [r, c] = [o.table!.rows[0], o.table!.cols[0]];
    const src = cellSource(s, id, r, c, tableEnv);
    src.write({ index: 0, del: 0, ins: 'Hallo' });
    const h0 = s.get(id)!.h;
    setCell(s, s.get(id)!, tableEnv(o), r, c, 'Hallo Welt mit einem sehr langen Text, der umbrechen muss, damit die Zeile höher wird');
    expect(s.get(id)!.h).toBeGreaterThan(h0);
    expect(matrix(s.get(id)!.table!)[0][0].startsWith('Hallo Welt')).toBe(true);
  });
});

describe('Vorlage an freien Platz (B13)', () => {
  it('Mitte, wenn frei; sonst nächster freier Platz daneben', () => {
    const occupied = (blocks: { x: number; y: number; w: number; h: number }[]) => (r: { x: number; y: number; w: number; h: number }) =>
      blocks.some((b) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);
    expect(freeSpot({ w: 400, h: 300 }, { x: 0, y: 0 }, occupied([]))).toEqual({ x: 0, y: 0 });
    const content = [{ x: -300, y: -200, w: 600, h: 400 }];
    const p = freeSpot({ w: 400, h: 300 }, { x: 0, y: 0 }, occupied(content));
    // liegt nicht über dem Inhalt (mit Rand) und nicht weit weg
    expect(occupied(content)({ x: p.x - 200, y: p.y - 150, w: 400, h: 300 })).toBe(false);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(900);
  });
});

describe('Einfügen: Tabellendaten und mehrere Zeilen', () => {
  it('erkennt TSV (auch Felder in Anführungszeichen), Zeilen und einfachen Text', () => {
    expect(parseTsv('Name\tSchicht\r\nMara\tFrüh\r\nJonas\tSpät\r\n')).toEqual([
      ['Name', 'Schicht'],
      ['Mara', 'Früh'],
      ['Jonas', 'Spät'],
    ]);
    expect(parseTsv('A\t"Zeile 1\nZeile 2"\tC\nx')).toEqual([
      ['A', 'Zeile 1\nZeile 2', 'C'],
      ['x', '', ''],
    ]);
    expect(parseTsv('ohne Tabs\nzweite')).toBeNull();
    expect(pasteLines('eins\n\n zwei \r\ndrei\n')).toEqual(['eins', 'zwei', 'drei']);
    expect(pasteChoice('nur eine Zeile')).toBeNull();
    expect(pasteChoice('a\nb')?.lines).toEqual(['a', 'b']);
    expect(pasteChoice('a\tb')?.table).toEqual([['a', 'b']]);
  });
});
