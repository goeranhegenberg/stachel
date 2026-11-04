import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../protocol';
import { isInvisible, registerTypeInfo, siblingFields } from './types';

const base = { id: 'a', type: 'sticky', x: 10, y: 20, w: 200, h: 200, z: 'a0', createdBy: 'm:1', updatedAt: '2026-10-23T00:00:00Z' } as BoardObject;

describe('Kern-Haken je Typ', () => {
  it('siblingFields: Kopie ohne Identität, Text, Sperre, Gruppe; Typ überschreibt Felder', () => {
    const f = siblingFields({ ...base, text: 'Hallo', content: '<p/>', locked: true, groupId: 'g', color: '#c9e14a' });
    expect(f).toMatchObject({ type: 'sticky', w: 200, h: 200, color: '#c9e14a', text: '', locked: undefined, groupId: undefined });
    expect(f).not.toHaveProperty('id');
    expect(f).not.toHaveProperty('content');
    expect(f).not.toHaveProperty('x');
    registerTypeInfo('t.card', { sibling: () => ({ desc: undefined }) as Partial<BoardObject> });
    const c = siblingFields({ ...base, type: 't.card' as BoardObject['type'], desc: 'Beschreibung' } as BoardObject);
    expect((c as Record<string, unknown>).desc).toBeUndefined();
  });

  it('isInvisible: Feld hidden oder Typ-Regel', () => {
    expect(isInvisible(base)).toBe(false);
    expect(isInvisible({ ...base, hidden: true } as BoardObject)).toBe(true);
    registerTypeInfo('t.node', { invisible: (o) => (o as { folded?: boolean }).folded === true });
    expect(isInvisible({ ...base, type: 't.node', folded: true } as unknown as BoardObject)).toBe(true);
    expect(isInvisible({ ...base, type: 't.node' } as unknown as BoardObject)).toBe(false);
  });
});
