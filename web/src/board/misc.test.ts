import { describe, expect, it } from 'vitest';
import { compareKeys, keyBetween, keysAbove, keysBelow, keysBetween } from './fractional';
import { fitFontSize, wrapLines } from './textfit';
import { penFromPoints, scalePoints, simplify, smoothPath } from './pen';
import { cloneObjects, parse, serialize } from './clipboard';
import { initials, textOn, userColor } from './colors';
import { USER_COLORS, type BoardObject } from '../protocol';
import { mergeRemoteText } from '../editor/render/remoteText';
import { detailOf, placeStyle } from '../editor/render/format';
import '../editor/core';

describe('Fractional-Index', () => {
  it('erzeugt sortierbare Schlüssel zwischen, über und unter', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const mid = keyBetween(a, b);
    expect(compareKeys(a, mid)).toBe(-1);
    expect(compareKeys(mid, b)).toBe(-1);
    const below = keysBelow(a, 3);
    expect([...below].sort(compareKeys)).toEqual(below);
    expect(compareKeys(below[2], a)).toBe(-1);
    const above = keysAbove(b, 5);
    expect(above.every((k) => k > b)).toBe(true);
    expect([...above].sort(compareKeys)).toEqual(above);
  });

  it('bleibt kurz beim ständigen Anhängen (2000 Objekte)', () => {
    let top: string | null = null;
    for (let i = 0; i < 2000; i++) top = keyBetween(top, null);
    expect(top!.length).toBeLessThan(6);
  });

  it('wiederholtes Einfügen zwischen zwei Schlüsseln bleibt geordnet', () => {
    let lo = keyBetween(null, null);
    const hi = keyBetween(lo, null);
    for (let i = 0; i < 50; i++) {
      const k = keyBetween(lo, hi);
      expect(lo < k && k < hi).toBe(true);
      lo = k;
    }
  });

  it('übersteht kaputte Schlüssel', () => {
    expect(() => keyBetween('!!kaputt', null)).not.toThrow();
    expect(keyBetween('!!kaputt', null) > '!!kaputt').toBe(true);
    expect(keysBetween('!!', null, 3)).toHaveLength(3);
  });
});

describe('Haftnotiz-Schriftgröße', () => {
  const mono = (t: string, fs: number) => t.length * fs * 0.5; // feste Zeichenbreite
  it('bricht wortweise um', () => {
    expect(wrapLines('aa bb cc', 10, 25, mono)).toEqual(['aa bb', 'cc']);
    expect(wrapLines('eins\nzwei', 10, 1000, mono)).toEqual(['eins', 'zwei']);
  });
  it('bricht nach Bindestrichen wie der Browser', () => {
    expect(wrapLines('Awareness-Team', 10, 60, mono)).toEqual(['Awareness-', 'Team']);
  });
  it('kurzer Text groß, langer Text kleiner', () => {
    const short = fitFontSize('Hallo', 160, 160, mono, { max: 40 });
    const long = fitFontSize('Das ist ein deutlich längerer Text für eine Haftnotiz mit vielen Wörtern', 160, 160, mono, { max: 40 });
    expect(short).toBe(40);
    expect(long).toBeLessThan(short);
    const lines = wrapLines('Das ist ein deutlich längerer Text für eine Haftnotiz mit vielen Wörtern', long, 160, mono);
    expect(lines.length * long * 1.22).toBeLessThanOrEqual(160);
  });
  it('trennt Wörter nicht, solange es kleiner auch ohne geht', () => {
    const fs = fitFontSize('Bühnenplan', 100, 100, mono, { max: 40 });
    expect(mono('Bühnenplan', fs)).toBeLessThanOrEqual(100);
  });
});

describe('Stift', () => {
  it('dünnt Punkte aus und erhält Ecken', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.01 },
      { x: 2, y: 0 },
      { x: 3, y: 0.01 },
      { x: 4, y: 4 },
    ];
    const s = simplify(pts, 0.1);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[4]);
    expect(s.length).toBeLessThan(pts.length);
  });
  it('baut einen geglätteten Pfad', () => {
    expect(smoothPath([0, 0, 10, 0, 20, 10])).toBe('M0 0Q10 0 15 5L20 10');
    expect(smoothPath([])).toBe('');
  });
  it('berechnet Bounding Box und relative Punkte', () => {
    const p = penFromPoints(
      [
        { x: 100, y: 100 },
        { x: 150, y: 120 },
      ],
      4,
    );
    expect(p).toEqual({ x: 98, y: 98, w: 54, h: 24, points: [2, 2, 52, 22] });
    expect(scalePoints(p.points, 2, 0.5)).toEqual([4, 1, 104, 11]);
  });
});

describe('Zwischenablage', () => {
  const base = (id: string, extra: Partial<BoardObject> = {}): BoardObject => ({
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    z: 'a0',
    createdBy: 'm:1',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  });
  it('klont mit neuen IDs und schreibt Verbinder um', () => {
    const a = base('a');
    const b = base('b', { x: 300 });
    const outside = base('o', { x: 900 });
    const c1 = base('c1', { type: 'connector', from: { objectId: 'a' }, to: { objectId: 'b' } });
    const c2 = base('c2', { type: 'connector', from: { objectId: 'a' }, to: { objectId: 'o' } });
    const lookup = (id: string) => ({ a, b, o: outside, c1, c2 })[id];
    const clones = cloneObjects([a, b, c1, c2], 10, 20, lookup);
    const ids = clones.map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).not.toContain('a');
    const [ca, cb, cc1, cc2] = clones;
    expect(ca).toMatchObject({ x: 10, y: 20 });
    expect(cc1.from).toEqual({ objectId: ca.id });
    expect(cc1.to).toEqual({ objectId: cb.id });
    // Ende zu nicht kopiertem Objekt wird frei (Mitte des Originals + Versatz)
    expect(cc2.to).toEqual({ x: 950 + 10, y: 50 + 20 });
    expect('z' in ca).toBe(false);
  });
  it('serialisiert und erkennt nur eigene Daten', () => {
    const text = serialize([base('a')]);
    expect(parse(text)![0].id).toBe('a');
    expect(parse('Hallo Welt')).toBeNull();
    expect(parse('{"marker":"stachel/objects@1", kaputt')).toBeNull();
  });
});

describe('Farben', () => {
  it('Nutzerfarbe ist deterministisch und aus der Palette', () => {
    expect(userColor('m:12')).toBe(userColor('m:12'));
    expect(USER_COLORS).toContain(userColor('a:admin'));
  });
  it('Initialen', () => {
    expect(initials('Mara Lindner')).toBe('ML');
    expect(initials('Du (offline)')).toBe('DO');
    expect(initials('admin')).toBe('AD');
    expect(initials('')).toBe('?');
  });
  it('Textfarbe nach Helligkeit', () => {
    expect(textOn('#000000')).toBe('#ffffff');
    expect(textOn('#fff27a')).toBe('#0a0a0a');
    expect(textOn('#1763b5')).toBe('#ffffff');
  });
});

describe('Darstellung', () => {
  const ob = (type: BoardObject['type'], w: number, h: number, extra: Partial<BoardObject> = {}): BoardObject =>
    ({ id: 'x', type, x: 10, y: 20, w, h, z: 'a0', createdBy: '', updatedAt: '', ...extra }) as BoardObject;

  it('Detailstufe nach Bildschirmgröße', () => {
    expect(detailOf(ob('sticky', 200, 200), 1)).toBe('full');
    expect(detailOf(ob('sticky', 200, 200), 0.19)).toBe('simple'); // 38 px
    expect(detailOf(ob('sticky', 200, 200), 0.2)).toBe('full'); // 40 px
    expect(detailOf(ob('image', 520, 300), 0.15)).toBe('simple'); // 78 px
    expect(detailOf(ob('image', 520, 300), 0.16)).toBe('full');
    expect(detailOf(ob('frame', 100, 100), 0.05)).toBe('full');
    expect(detailOf(ob('pen', 10, 10), 0.05)).toBe('full');
  });

  it('Drehung um die Objektmitte', () => {
    expect(placeStyle(ob('shape', 100, 60)).transform).toBe('translate(10px, 20px)');
    const s = placeStyle(ob('shape', 100, 60, { rotation: 30 }));
    expect(s.transform).toBe('translate(10px, 20px) rotate(30deg)');
    expect(s.transformOrigin).toBe('50px 30px');
  });

  it('fremder Text beim gleichzeitigen Bearbeiten geht nicht verloren', () => {
    expect(mergeRemoteText('Bühne', null)).toBe('Bühne');
    expect(mergeRemoteText('Bühne', 'Bühne')).toBe('Bühne');
    expect(mergeRemoteText('Bühne Nord', 'Bühne')).toBe('Bühne Nord');
    expect(mergeRemoteText('Bühne', 'Bühne und Bar')).toBe('Bühne und Bar');
    expect(mergeRemoteText('', 'Bar')).toBe('Bar');
    expect(mergeRemoteText('Bühne', 'Bar')).toBe('Bühne\nBar');
  });
});
