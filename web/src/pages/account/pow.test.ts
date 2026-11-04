import { describe, expect, it } from 'vitest';
import { sha256Hex, solvePow } from './pow';

describe('Captcha-Proof-of-Work', () => {
  it('SHA-256 stimmt mit bekannten Werten überein', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // zwei Blöcke
    expect(sha256Hex('a'.repeat(64))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
  });

  it('findet die Zahl zur Aufgabe', () => {
    const salt = '0a1b2c3d4e5f?expires=1999999999';
    const challenge = sha256Hex(`${salt}4711`);
    expect(solvePow(salt, challenge, 10_000)).toBe(4711);
    expect(solvePow(salt, challenge, 4000)).toBeNull();
  });
});
