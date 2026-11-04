import { describe, expect, it } from 'vitest';
import { matchKey, parseKey, specificity } from './keys';

const ev = (key: string, o: Partial<KeyboardEvent> = {}) => ({ key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent;

describe('Tastenkürzel', () => {
  it('erkennt Strg/⌘ genau, Umschalt nur wenn genannt', () => {
    const undo = parseKey('mod+z');
    const redo = parseKey('mod+shift+z');
    expect(matchKey(undo, ev('z', { ctrlKey: true }))).toBe(true);
    expect(matchKey(undo, ev('Z', { metaKey: true, shiftKey: true }))).toBe(true);
    expect(matchKey(redo, ev('Z', { metaKey: true, shiftKey: true }))).toBe(true);
    expect(matchKey(redo, ev('z', { ctrlKey: true }))).toBe(false);
    expect(matchKey(undo, ev('z'))).toBe(false);
    expect(specificity(redo)).toBeGreaterThan(specificity(undo));
  });
  it('kennt code-Namen, Sondertasten und plus', () => {
    expect(matchKey(parseKey('shift+Digit1'), ev('!', { shiftKey: true, code: 'Digit1' }))).toBe(true);
    expect(matchKey(parseKey('PageDown'), ev('PageDown'))).toBe(true);
    expect(matchKey(parseKey('mod+plus'), ev('+', { ctrlKey: true }))).toBe(true);
    expect(matchKey(parseKey('?'), ev('?', { shiftKey: true }))).toBe(true);
    expect(matchKey(parseKey('?'), ev('?', { ctrlKey: true }))).toBe(false);
  });
});
