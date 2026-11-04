// Router unter einem Pfad (STACHEL_BASE_PATH, server/src/site.ts): Basis aus der Adresse, Seitenadressen der Web-App.
import { describe, expect, it, vi } from 'vitest';

describe('Basis der Web-App', () => {
  it('ergibt sich aus dem Pfad beim Laden', async () => {
    const { baseOf } = await import('./router');
    expect(baseOf('/')).toBe('/');
    expect(baseOf('/index.html')).toBe('/');
    expect(baseOf('/app/')).toBe('/app/');
    expect(baseOf('/app')).toBe('/app/');
    expect(baseOf('/app/index.html')).toBe('/app/');
    expect(baseOf('/team/stachel/')).toBe('/team/stachel/');
  });

  it('ohne Browser (Server, MCP-Bündel) ist die Basis /', async () => {
    const { APP_BASE, appHref, boardHref } = await import('./router');
    expect(APP_BASE).toBe('/');
    expect(appHref()).toBe('/');
    expect(boardHref('a b')).toBe('/?b=a%20b');
  });

  it('unter /app: Übersicht, Board, Konto und Teilen-Kurzlink mit Präfix', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { pathname: '/app/', search: '?b=x', origin: 'https://stachel.intsode.com' });
    try {
      const r = await import('./router');
      expect(r.APP_BASE).toBe('/app/');
      expect(r.appHref()).toBe('/app/');
      expect(r.appHref('?konto=1')).toBe('/app/?konto=1');
      expect(r.boardHref('abc')).toBe('/app/?b=abc');
      expect(r.boardShareUrl('abc')).toBe('https://stachel.intsode.com/app/b/abc');
      expect(r.parseRoute('?b=abc')).toEqual({ name: 'board', id: 'abc' });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
