// Bau des Boards aus der Abbildung (server/src/import/build.ts): Beschreibung über dem fertigen Inhalt.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DOC_OBJECTS } from '../../shared/protocol';
import { buildDoc } from '../src/import/build';
import { mapBoard } from '../src/import/miro/map';
import { loadMiroFixture } from './fixtures/miro/load';

describe('Import: Bau', () => {
  it('rückt die Board-Beschreibung über die neu angeordnete Mindmap', () => {
    const data = loadMiroFixture('echt_mindmap');
    const mapped = mapBoard(data, { description: true });
    expect(mapped.descriptionId).toBeTruthy();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildDoc('u:test', 'Test', mapped, new Map()));
    const objects = doc.getMap<Y.Map<unknown>>(DOC_OBJECTS);
    const desc = objects.get(mapped.descriptionId!)!;
    const bottom = (desc.get('y') as number) + (desc.get('h') as number);
    let minY = Infinity;
    objects.forEach((m, id) => {
      if (id !== mapped.descriptionId && m.get('type') !== 'connector') minY = Math.min(minY, m.get('y') as number);
    });
    expect(objects.size).toBeGreaterThan(10);
    expect(bottom).toBeLessThan(minY);
  });
});
