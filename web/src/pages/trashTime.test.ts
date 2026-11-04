import { describe, expect, it } from 'vitest';
import { TRASH_DAYS } from '../protocol';
import { daysLeft, purgeText } from './trashTime';

const DAY = 86_400_000;
const now = Date.parse('2026-10-30T12:00:00.000Z');
const at = (ms: number) => new Date(now + ms).toISOString();

describe('Papierkorb-Fristen', () => {
  it('frisch gelöscht: volle 30 Tage', () => {
    expect(daysLeft(at(TRASH_DAYS * DAY), now)).toBe(30);
    expect(purgeText(at(TRASH_DAYS * DAY), now)).toBe('Wird endgültig gelöscht in 30 Tagen');
  });
  it('angebrochene Tage zählen als ganzer Tag, Einzahl bei 1', () => {
    expect(daysLeft(at(DAY + 1), now)).toBe(2);
    expect(purgeText(at(3 * 3600_000), now)).toBe('Wird endgültig gelöscht in 1 Tag');
  });
  it('abgelaufen (Server hat noch nicht aufgeräumt): heute, nie negativ', () => {
    expect(daysLeft(at(-5 * DAY), now)).toBe(0);
    expect(purgeText(at(0), now)).toBe('Wird heute endgültig gelöscht');
  });
  it('kaputtes Datum: Standardfrist statt NaN', () => {
    expect(daysLeft('kein Datum', now)).toBe(TRASH_DAYS);
  });
});
