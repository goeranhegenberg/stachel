import { describe, expect, it } from 'vitest';
import { parseUserAgent } from '../src/pairings.js';

// Die Org-App zeigt vor dem Bestätigen, wer sich anmelden will (GET /api/auth/qr/:code/info). Fragt die Stachel-App
// auf demselben Handy („Mit der Org-App anmelden“, User-Agent `StachelApp/<version> (<os>)`), steht dort
// „Stachel-App auf Android“ statt „Unbekannter Browser“.
describe('parseUserAgent: Stachel-App', () => {
  it('erkennt die App samt System', () => {
    expect(parseUserAgent('StachelApp/1.0.0+1 (android)')).toEqual({ browser: 'Stachel-App', os: 'Android' });
    expect(parseUserAgent('StachelApp/1.0.0+1 (ios)')).toEqual({ browser: 'Stachel-App', os: 'iOS' });
  });
  it('Browser bleiben wie bisher', () => {
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toEqual({
      browser: 'Chrome',
      os: 'Android',
    });
    expect(parseUserAgent('Dart/3.11 (dart:io)')).toEqual({ browser: null, os: null });
  });
});
