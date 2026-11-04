// Fehlertexte (api.ts): Grenzen der Instanz (Server upload-limits.ts, Sicherheits-Review UPL-2) zeigen den Text des
// Servers – er nennt die eingestellte Größe bzw. den belegten Speicher; sonst gelten die festen Texte.
import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_TEXT } from './api';

describe('ApiError', () => {
  it('Speicher voll, zu groß, Board-Grenze: Text des Servers, ohne Text der feste', () => {
    expect(new ApiError('quota_exceeded', 413, 'Dein Speicherplatz ist voll (1.024 MB von 1.024 MB belegt).').message).toBe(
      'Dein Speicherplatz ist voll (1.024 MB von 1.024 MB belegt).',
    );
    expect(new ApiError('too_large', 413, 'Das Bild ist zu groß (höchstens 5 MB).').message).toBe('Das Bild ist zu groß (höchstens 5 MB).');
    expect(new ApiError('board_limit', 403).message).toBe(ERROR_TEXT.board_limit);
    expect(new ApiError('too_large', 413).message).toBe(ERROR_TEXT.too_large);
  });

  it('sonst bleibt der feste Text', () => {
    expect(new ApiError('rate_limited', 429, 'Server sagt etwas').message).toBe(ERROR_TEXT.rate_limited);
    expect(new ApiError('unbekannt', 400, 'Text vom Server').message).toBe('Text vom Server');
  });
});
