import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../core';
import { contextActions, defineObjectType, defineShortcut, menuItems, objectTypes, Registry, shortcuts, tools } from './registry';
import { BoardStore } from '../../board/store';
import { hitTest } from '../../board/geometry';
import { cloneObjects } from '../../board/clipboard';
import { shortcutGroups } from '../interaction/Shortcuts';
import type { BoardObject } from '../../protocol';

describe('Register', () => {
  it('sortiert nach order, ersetzt bei gleicher id', () => {
    const r = new Registry<{ id: string; order: number; v: string }>(
      (d) => d.id,
      (d) => d.order,
    );
    r.define({ id: 'b', order: 20, v: 'b' });
    r.define({ id: 'a', order: 10, v: 'a' });
    r.define({ id: 'c', order: 20, v: 'c' });
    expect(r.list().map((d) => d.v)).toEqual(['a', 'b', 'c']);
    r.define({ id: 'b', order: 5, v: 'B' });
    expect(r.list().map((d) => d.v)).toEqual(['B', 'a', 'c']);
  });

  it('enthält die Kern-Einträge (Typen, Werkzeuge, Kontextleiste, Menü, Kürzel)', () => {
    expect(objectTypes.list().map((d) => d.type)).toEqual(['sticky', 'text', 'shape', 'frame', 'image', 'pen', 'connector']);
    expect(tools.list().map((t) => t.key ?? '-').join('')).toBe('vhntslpef-');
    expect(contextActions.list().map((a) => a.id)).toEqual(['core.color', 'core.shape', 'core.font', 'core.format', 'core.connector', 'core.pen', 'core.arrange', 'core.common']);
    expect(menuItems.list().filter((m) => m.on === 'canvas').length).toBe(3);
    expect(shortcuts.get('format.bold')?.keys).toEqual(['mod+b']);
    // Kürzel-Übersicht wie vor dem Umbau
    const groups = shortcutGroups();
    expect(groups.map((g) => g.title)).toEqual(['Werkzeuge', 'Bearbeiten', 'Ansicht']);
    expect(groups[0].items[1]).toEqual(['H', 'Ansicht verschieben']);
    expect(groups[1].items.length).toBe(12); // inkl. Lasso
    expect(groups[2].items.at(-1)).toEqual(['?', 'Diese Übersicht']);
  });

  it('neuer Objekttyp: Store kennt ihn, Hit-Rolle und Kopieren greifen', () => {
    defineObjectType({
      type: 'zz-test' as never,
      label: 'Test',
      View: () => null,
      hit: 'background',
      remap: (clone) => ({ ...clone, text: 'kopiert' }),
    });
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id = store.create({ type: 'zz-test' as never, x: 0, y: 0, w: 100, h: 100 });
    const o = store.get(id)!;
    expect(o.type).toBe('zz-test');
    // Hintergrund-Rolle: eine Notiz darüber gewinnt, allein trifft der Typ
    expect(hitTest([o], { x: 50, y: 50 })?.id).toBe(id);
    const sticky = { ...o, id: 's', type: 'sticky' } as BoardObject;
    expect(hitTest([sticky, o], { x: 50, y: 50 })?.id).toBe('s');
    expect(cloneObjects([o], 10, 0, () => undefined)[0]).toMatchObject({ x: 10, text: 'kopiert' });
  });

  it('Kürzel mit gleicher id ersetzen das Kern-Kürzel', () => {
    const before = shortcuts.get('view.help')!;
    defineShortcut({ ...before, keys: ['F1'] });
    expect(shortcuts.get('view.help')?.keys).toEqual(['F1']);
    defineShortcut(before);
  });
});
