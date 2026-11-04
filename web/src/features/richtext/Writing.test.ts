import { describe, expect, it } from 'vitest';
import type { Peer } from '../../board/session';
import { writersOf } from './Writing';

const peer = (clientId: number, key: string, name: string, caret: unknown, color = '#1763b5'): Peer => ({
  clientId,
  user: { key, name, color },
  cursor: null,
  selection: [],
  extra: caret === undefined ? {} : { 'richtext.caret': caret },
});

describe('writersOf („schreibt hier gerade“)', () => {
  it('je Objekt die Schreibenden (App ohne Schreibmarke zählt), ohne mich und ohne das selbst bearbeitete Objekt', () => {
    const peers = [
      peer(1, 'm:7', 'Mara Muster', { id: 'n1', anchor: null, head: null }, '#ec4e92'),
      peer(2, 'm:8', 'Jonas', { id: 'n1', anchor: {}, head: {} }),
      peer(3, 'm:8', 'Jonas', { id: 'n1' }),
      peer(4, 'm:9', 'Lena', { id: 'n2' }),
      peer(5, 'm:1', 'Ich', { id: 'n3' }),
      peer(6, 'm:2', 'Kaputt', 'quatsch'),
      peer(7, 'm:3', 'Ohne', undefined),
    ];
    expect(writersOf(peers, 'n2', 'm:1')).toEqual([{ id: 'n1', names: ['Mara', 'Jonas'], color: '#ec4e92' }]);
    expect(writersOf(peers, null, null).map((w) => w.id)).toEqual(['n1', 'n2', 'n3']);
  });
});
