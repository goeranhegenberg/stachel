import { describe, expect, it } from 'vitest';
import type { ImportJob, ImportReport } from '../../../../shared/import';
import { ApiError, ERROR_TEXT } from '../../api';
import { importOffered } from './api';
import {
  appendBoards,
  entryText,
  IMPORT_ERROR_TEXT,
  importedList,
  importErrorText,
  isActive,
  jobsHeading,
  mergeJobs,
  modifiedLabel,
  oauthErrorText,
  parseImportReturn,
  phaseLabel,
  progressOf,
  progressText,
  RECONNECT_CODES,
  reportSummary,
  statusChip,
  toggleSelection,
  typeCount,
} from './model';

const job = (p: Partial<ImportJob> = {}): ImportJob => ({
  id: 'j1',
  source: 'miro',
  sourceBoard: 'uXj1',
  sourceName: 'Workshop',
  status: 'running',
  phase: 'read',
  done: 0,
  total: 0,
  createdAt: '2026-11-04T10:00:00.000Z',
  ...p,
});

const report = (p: Partial<ImportReport> = {}): ImportReport => ({ imported: {}, adjusted: [], skipped: [], notes: [], ...p });

describe('Fortschritt', () => {
  it('Phasen deutsch', () => {
    expect(phaseLabel(job({ phase: 'read' }))).toBe('Objekte lesen');
    expect(phaseLabel(job({ phase: 'images' }))).toBe('Bilder laden');
    expect(phaseLabel(job({ phase: 'build' }))).toBe('Board anlegen');
    expect(phaseLabel(job({ status: 'queued', phase: 'queued' }))).toBe('Wartet auf den Start');
    expect(phaseLabel(job({ status: 'done', phase: 'done' }))).toBe('Fertig');
    expect(phaseLabel(job({ status: 'failed' }))).toBe('Fehlgeschlagen');
    expect(phaseLabel(job({ status: 'canceled' }))).toBe('Abgebrochen');
  });

  it('Anteil und Text mit done/total', () => {
    expect(progressOf(job({ done: 3, total: 12 }))).toBe(0.25);
    expect(progressOf(job({ done: 20, total: 12 }))).toBe(1);
    expect(progressOf(job({ total: 0 }))).toBeNull();
    expect(progressOf(job({ status: 'done', phase: 'done' }))).toBe(1);
    expect(progressOf(job({ status: 'failed', done: 3, total: 12 }))).toBeNull();
    expect(progressText(job({ phase: 'images', done: 48, total: 300 }))).toBe('Bilder laden · 48 von 300');
    expect(progressText(job({ phase: 'build', done: 0, total: 0 }))).toBe('Board anlegen');
    expect(progressText(job({ status: 'queued', phase: 'queued', total: 5 }))).toBe('Wartet auf den Start');
  });

  it('aktiv nur bei queued/running', () => {
    expect(isActive(job({ status: 'queued' }))).toBe(true);
    expect(isActive(job({ status: 'running' }))).toBe(true);
    for (const s of ['done', 'failed', 'canceled'] as const) expect(isActive(job({ status: s }))).toBe(false);
  });

  it('Status-Chip für „Letzte Importe“', () => {
    expect(statusChip(job({ phase: 'images', done: 1, total: 4 }))).toEqual({ text: 'Bilder laden 25 %', tone: 'run' });
    expect(statusChip(job({ phase: 'read' }))).toEqual({ text: 'Objekte lesen', tone: 'run' });
    expect(statusChip(job({ status: 'done' })).tone).toBe('ok');
    expect(statusChip(job({ status: 'failed' })).tone).toBe('bad');
    expect(statusChip(job({ status: 'canceled' })).tone).toBe('off');
  });

  it('Überschrift über den Jobs', () => {
    expect(jobsHeading([job()])).toBe('Board wird übernommen');
    expect(jobsHeading([job(), job({ id: 'j2', status: 'done' })])).toBe('Boards werden übernommen');
    expect(jobsHeading([job({ status: 'done' }), job({ id: 'j2', status: 'done' })])).toBe('Import fertig');
    expect(jobsHeading([job({ status: 'failed' })])).toBe('Import fehlgeschlagen');
    expect(jobsHeading([job({ status: 'canceled' })])).toBe('Import abgebrochen');
    expect(jobsHeading([job({ status: 'done' }), job({ id: 'j2', status: 'failed' })])).toBe('Import beendet');
  });

  it('frische Stände nach ID übernehmen, Reihenfolge bleibt', () => {
    const a = job({ id: 'a' });
    const b = job({ id: 'b' });
    const merged = mergeJobs([a, b], [{ ...b, status: 'done' }, job({ id: 'fremd' })]);
    expect(merged.map((j) => [j.id, j.status])).toEqual([
      ['a', 'running'],
      ['b', 'done'],
    ]);
  });
});

describe('Bericht', () => {
  it('Typen mit deutschen Namen, Einzahl/Mehrzahl', () => {
    expect(typeCount('sticky', 1)).toBe('1 Notiz');
    expect(typeCount('sticky', 24)).toBe('24 Notizen');
    expect(typeCount('connector', 3)).toBe('3 Verbinder');
    expect(typeCount('mindnode', 2)).toBe('2 Mindmap-Knoten');
    expect(typeCount('image', 1)).toBe('1 Bild');
    expect(typeCount('document', 2)).toBe('2 Dokumente');
    expect(typeCount('neu', 2)).toBe('2 × neu');
  });

  it('größte Zahl zuerst, Nullen weg', () => {
    const list = importedList(report({ imported: { text: 3, sticky: 24, shape: 3, frame: 0, image: 1 } }));
    expect(list.map((x) => x.label)).toEqual(['24 Notizen', '3 Formen', '3 Texte', '1 Bild']);
    expect(importedList(undefined)).toEqual([]);
  });

  it('Zusammenfassung in einer Zeile', () => {
    const r = report({
      imported: { sticky: 120, connector: 8 },
      adjusted: [{ code: 'sticky_color', text: 'Notizfarben auf die Palette angepasst', count: 12 }],
      skipped: [
        { code: 'unknown', text: 'unbekannte Objekte', count: 2 },
        { code: 'image_quota', text: 'Bild über dem Speicherplatz', count: 1 },
      ],
    });
    expect(reportSummary(r)).toBe('128 Objekte übernommen · 12 angepasst · 3 nicht übernommen');
    expect(reportSummary(report({ imported: { sticky: 1 } }))).toBe('1 Objekt übernommen');
    expect(reportSummary(undefined)).toBe('');
  });

  it('Einträge mit Zahl, außer der Text nennt sie schon', () => {
    expect(entryText({ text: 'Verbinder ohne Ziel', count: 3 })).toBe('3 × Verbinder ohne Ziel');
    expect(entryText({ text: 'Mindmap neu angeordnet', count: 1 })).toBe('Mindmap neu angeordnet');
    expect(entryText({ text: '12 Notizfarben angepasst', count: 12 })).toBe('12 Notizfarben angepasst');
  });
});

describe('Auswahl', () => {
  it('höchstens 10 Boards', () => {
    let sel: string[] = [];
    for (let i = 0; i < 12; i++) sel = toggleSelection(sel, `b${i}`);
    expect(sel).toHaveLength(10);
    expect(sel).not.toContain('b10');
    sel = toggleSelection(sel, 'b3');
    expect(sel).toHaveLength(9);
    expect(toggleSelection(sel, 'b11')).toContain('b11');
  });

  it('„Mehr laden“ hängt ohne Doppelte an', () => {
    expect(appendBoards([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('zuletzt geändert', () => {
    const now = Date.parse('2026-11-04T12:00:00Z');
    expect(modifiedLabel('2026-11-04T11:55:00Z', now)).toBe('Geändert vor 5 Min.');
    expect(modifiedLabel(undefined, now)).toBe('');
    expect(modifiedLabel('kaputt', now)).toBe('');
  });
});

describe('Fehler', () => {
  it('Server-Text gewinnt, sonst Ersatztext mit nächstem Schritt', () => {
    expect(importErrorText(new ApiError('import_limit', 429, 'Heute gehen noch 0 Boards.'))).toBe('Heute gehen noch 0 Boards.');
    expect(importErrorText(new ApiError('miro_token_invalid', 400))).toBe(IMPORT_ERROR_TEXT.miro_token_invalid);
    expect(importErrorText(new ApiError('miro_unavailable', 502))).toContain('in ein paar Minuten');
    // board_limit: Server-Text ist genauer (Grenze der Instanz)
    expect(importErrorText(new ApiError('board_limit', 403, 'Höchstens 50 Boards.'))).toBe('Höchstens 50 Boards.');
    expect(importErrorText(new ApiError('board_limit', 403))).toBe(IMPORT_ERROR_TEXT.board_limit);
    expect(importErrorText(new ApiError('network', 0))).toBe(ERROR_TEXT.network);
    expect(importErrorText(new Error('x'))).toBe(ERROR_TEXT.server);
  });

  it('alle Codes aus dem Vertrag haben einen Text', () => {
    for (const c of ['miro_token_invalid', 'miro_conn_expired', 'import_limit', 'board_limit', 'oauth_disabled', 'import_disabled', 'miro_unavailable'])
      expect(IMPORT_ERROR_TEXT[c], c).toMatch(/\.$/);
  });

  it('abgelaufene Verbindung oder abgelehntes Token → neu verbinden', () => {
    expect(RECONNECT_CODES.has('miro_conn_expired')).toBe(true);
    expect(RECONNECT_CODES.has('miro_token_invalid')).toBe(true);
    expect(RECONNECT_CODES.has('import_limit')).toBe(false);
  });

  it('Fehler von der Rückkehr aus Miro', () => {
    expect(oauthErrorText('access_denied')).toContain('nicht erlaubt');
    expect(oauthErrorText('irgendwas')).toContain('noch einmal');
    expect(oauthErrorText('state_expired')).toContain('abgelaufen');
    expect(oauthErrorText('oauth_failed')).toContain('nicht bestätigt');
    expect(oauthErrorText('miro_unavailable')).toContain('in ein paar Minuten');
  });
});

describe('Rückkehr von Miro', () => {
  it('erkennt ?import=miro und behält andere Parameter', () => {
    expect(parseImportReturn('')).toEqual({ open: false });
    expect(parseImportReturn('?b=x')).toEqual({ open: false });
    expect(parseImportReturn('?import=miro')).toEqual({ open: true, error: null, rest: '' });
    expect(parseImportReturn('?import=miro&error=access_denied&x=1')).toEqual({ open: true, error: 'access_denied', rest: '?x=1' });
  });
});

describe('Angebot der Instanz', () => {
  it('Knopf nur bei enabled und (token oder oauth)', () => {
    const s = (miro: Partial<{ enabled: boolean; token: boolean; oauth: boolean; connected: boolean }>) =>
      ({ ok: true, miro: { enabled: true, token: false, oauth: false, connected: false, ...miro } }) as const;
    expect(importOffered(s({ token: true }))).toBe(true);
    expect(importOffered(s({ oauth: true }))).toBe(true);
    expect(importOffered(s({}))).toBe(false);
    expect(importOffered(s({ enabled: false, token: true, oauth: true }))).toBe(false);
    expect(importOffered(null)).toBe(false);
  });
});
