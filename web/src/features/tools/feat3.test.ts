// Notiz-Tags, Objekt-Links und Textmarker (Runde 3): reine Logik und Register-Einträge.
import { describe, expect, it } from 'vitest';
import '../../editor/core';
import type { BoardObject } from '../../protocol';
import { objectTypes, tools } from '../../editor/ext/registry';
import { setToolOption } from '../../editor/ext/toolOptions';
import { boardTags, TAG_MAX, toggleTag } from './tags';
import { linkable, targetName } from './linkTo';
import { penMode } from './marker';
import { hiddenCss } from './hide';

const obj = (p: Partial<BoardObject> & { type: BoardObject['type'] }): BoardObject => ({ id: 'x', x: 0, y: 0, w: 100, h: 100, ...p }) as BoardObject;

describe('Notiz-Tags', () => {
  it('Board-Tags: je Name einmal (ohne Groß-/Kleinschreibung), erste Farbe, sortiert; kaputte Einträge übersprungen', () => {
    const tags = boardTags([
      obj({ type: 'sticky', tags: [{ label: 'technik', color: '#ec4e92' }, { label: ' ', color: '#000000' }] }),
      obj({ type: 'card', tags: [{ label: 'Bühne', color: '#c9e14a' }, { label: 'Technik', color: '#1763b5' }] }),
      obj({ type: 'sticky', tags: 'kaputt' as unknown as BoardObject['tags'] }),
    ]);
    expect(tags).toEqual([
      { label: 'Bühne', color: '#c9e14a' },
      { label: 'technik', color: '#ec4e92' },
    ]);
  });

  it('toggleTag: an/aus, letzter Tag weg = Feld weg, nichts doppelt, Obergrenze', () => {
    const t = { label: 'Orga', color: '#1763b5' };
    const o = obj({ type: 'sticky' });
    expect(toggleTag(o, t, true)).toEqual({ tags: [t] });
    expect(toggleTag(obj({ type: 'sticky', tags: [{ label: 'orga', color: '#000000' }] }), t, true)).toBeNull();
    expect(toggleTag(obj({ type: 'sticky', tags: [{ label: 'orga', color: '#000000' }] }), t, false)).toEqual({ tags: undefined });
    const full = obj({ type: 'sticky', tags: Array.from({ length: TAG_MAX }, (_, i) => ({ label: `t${i}`, color: '#000000' })) });
    expect(toggleTag(full, t, true)).toBeNull();
    expect(toggleTag(obj({ type: 'sticky', tags: [t] }), t, true)).toBeNull();
  });

  it('ausgeblendete Notiz: Tags verschwinden mit', () => {
    expect(hiddenCss(['n1'], false)).toMatch(/\[data-tags-for="n1"\][^}]*visibility: hidden/);
    expect(hiddenCss(['n1'], true)).toContain('[data-tags-for="n1"] { opacity: 0.38; }');
  });

  it('Haftnotiz-Typ: Kopie daneben ohne Tags', () => {
    const def = objectTypes.get('sticky')!;
    expect(def.sibling?.(obj({ type: 'sticky', tags: [{ label: 'a', color: '#000000' }] }))).toMatchObject({ tags: undefined });
  });
});

describe('Objekt-Links', () => {
  it('Verbinder und Striche haben keinen Link; Namen für Rahmen und Text', () => {
    expect(linkable(obj({ type: 'connector' }))).toBe(false);
    expect(linkable(obj({ type: 'pen' }))).toBe(false);
    expect(linkable(obj({ type: 'sticky' }))).toBe(true);
    expect(targetName(obj({ type: 'frame', title: '  Bühne ' }))).toBe('Bühne');
    expect(targetName(obj({ type: 'frame' }))).toBe('Rahmen');
    expect(targetName(obj({ type: 'sticky', text: 'Erste Zeile\nzweite' }))).toBe('Erste Zeile');
    expect(targetName(obj({ type: 'sticky', text: 'x'.repeat(50) }))).toHaveLength(30);
    expect(targetName(obj({ type: 'shape' }))).toBe('Objekt');
  });
});

describe('Textmarker', () => {
  it('Stift-Werkzeug bleibt dasselbe (Kürzel P), Modus über Werkzeug-Option', () => {
    const pen = tools.get('pen')!;
    expect(pen.key).toBe('p');
    expect(pen.Options).toBeTruthy();
    expect(penMode()).toBe('pen');
    setToolOption('pen', 'mode', 'marker');
    expect(penMode()).toBe('marker');
    setToolOption('pen', 'mode', 'pen');
  });
});
