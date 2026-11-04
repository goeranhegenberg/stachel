// Miro-Client (server/src/import/miro/client.ts): Paginierung, Ratenlimit, Backoff mit falscher Uhr, 401, Abbruch.
import { describe, expect, it } from 'vitest';
import { ImportAbortError, MiroApiError, MiroAuthError, MiroClient, resetWaitMs, retryAfterMs } from '../src/import/miro/client.js';

type Handler = (u: URL, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(h: Handler) {
  const calls: { url: URL; auth: string }[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, auth: String((init.headers as Record<string, string>)?.Authorization ?? '') });
    return h(url, init);
  }) as typeof fetch;
  return { f, calls };
}

const ok = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
const status = (n: number, headers: Record<string, string> = {}) => new Response('{}', { status: n, headers });

function clock() {
  let t = Date.UTC(2026, 10, 4, 12);
  const waits: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    waits,
  };
}

const token = { token: async () => 'tok-123' };

describe('MiroClient', () => {
  it('liest Cursor-Seiten bis zum Ende und schickt das Token', async () => {
    const { f, calls } = fakeFetch((u) => {
      const c = Number(u.searchParams.get('cursor') ?? 0);
      const data = Array.from({ length: c < 100 ? 50 : 7 }, (_, i) => ({ id: String(c + i) }));
      return ok({ data, total: 107, ...(c < 100 ? { cursor: String(c + 50) } : {}) });
    });
    const client = new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f });
    const all: string[] = [];
    for await (const p of client.cursorPages<{ id: string }>('/v2/boards/b1/items')) all.push(...p.data.map((x) => x.id));
    expect(all).toHaveLength(107);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.auth === 'Bearer tok-123')).toBe(true);
    expect(calls[0]!.url.searchParams.get('limit')).toBe('50');
    expect(calls[1]!.url.searchParams.get('cursor')).toBe('50');
  });

  it('liest Offset-Seiten', async () => {
    const { f, calls } = fakeFetch((u) => {
      const o = Number(u.searchParams.get('offset'));
      const data = Array.from({ length: Math.max(0, Math.min(50, 60 - o)) }, (_, i) => ({ id: String(o + i) }));
      return ok({ data, total: 60, offset: o });
    });
    const client = new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f });
    let n = 0;
    for await (const p of client.offsetPages('/v2/boards/b1/tags')) n += p.data.length;
    expect(n).toBe(60);
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '50']);
  });

  it('429: wartet exponentiell bzw. nach Retry-After und versucht es erneut', async () => {
    let i = 0;
    const { f } = fakeFetch(() => {
      i++;
      if (i === 1) return status(429);
      if (i === 2) return status(503);
      if (i === 3) return status(429, { 'Retry-After': '7' });
      return ok({ id: 'b1' });
    });
    const c = clock();
    const client = new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f, sleep: c.sleep, now: c.now });
    expect(await client.get('/v2/boards/b1')).toEqual({ id: 'b1' });
    expect(c.waits).toEqual([1000, 2000, 7000]);
  });

  it('gibt nach 6 Versuchen auf (MiroApiError 429), Wartezeit höchstens 60 s', async () => {
    const { f, calls } = fakeFetch(() => status(429, { 'Retry-After': '600' }));
    const c = clock();
    const client = new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f, sleep: c.sleep, now: c.now });
    const err = await client.get('/v2/boards').catch((e) => e);
    expect(err).toBeInstanceOf(MiroApiError);
    expect((err as MiroApiError).status).toBe(429);
    expect(calls).toHaveLength(6);
    expect(c.waits.every((w) => w <= 60_000)).toBe(true);
    expect(String(err.message)).not.toContain('tok-123');
  });

  it('wartet vorab, wenn kaum noch Credits übrig sind', async () => {
    const c = clock();
    const reset = Math.floor(c.now() / 1000) + 20;
    let i = 0;
    const { f } = fakeFetch(() => (i++ === 0 ? ok({ a: 1 }, { 'X-RateLimit-Remaining': '100', 'X-RateLimit-Reset': String(reset) }) : ok({ a: 2 })));
    const client = new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f, sleep: c.sleep, now: c.now });
    await client.get('/v2/boards');
    expect(c.waits).toEqual([]);
    await client.get('/v2/boards');
    expect(c.waits).toHaveLength(1);
    expect(c.waits[0]).toBeGreaterThan(15_000);
    expect(c.waits[0]).toBeLessThanOrEqual(20_000);
  });

  it('401 → MiroAuthError; mit Erneuern einmal neu versuchen', async () => {
    const { f } = fakeFetch(() => status(401));
    await expect(new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f }).get('/v2/boards')).rejects.toBeInstanceOf(MiroAuthError);

    let current = 'alt';
    const { f: f2, calls } = fakeFetch((_u, init) => ((init.headers as Record<string, string>).Authorization === 'Bearer neu' ? ok({ ok: 1 }) : status(401)));
    const auth = { token: async () => current, refresh: async () => (current = 'neu') };
    expect(await new MiroClient({ base: 'https://api.miro.com', auth, fetch: f2 }).get('/v2/boards')).toEqual({ ok: 1 });
    expect(calls.map((c) => c.auth)).toEqual(['Bearer alt', 'Bearer neu']);
  });

  it('404/403 sofort als MiroApiError, Netzfehler mit Backoff', async () => {
    const { f } = fakeFetch(() => status(404));
    const e = await new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f }).get('/v2/boards/x').catch((x) => x);
    expect(e).toBeInstanceOf(MiroApiError);
    expect(e.status).toBe(404);

    let n = 0;
    const c = clock();
    const { f: f2 } = fakeFetch(() => {
      if (n++ < 2) throw new TypeError('fetch failed');
      return ok({ fine: true });
    });
    expect(await new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f2, sleep: c.sleep, now: c.now }).get('/v2/boards')).toEqual({ fine: true });
    expect(c.waits).toEqual([1000, 2000]);
  });

  it('Abbruch über AbortSignal', async () => {
    const ac = new AbortController();
    ac.abort();
    const { f } = fakeFetch(() => ok({}));
    await expect(new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f, signal: ac.signal }).get('/v2/boards')).rejects.toBeInstanceOf(ImportAbortError);
  });

  it('nur Adressen unter der API-Basis (Token geht nirgendwo anders hin)', async () => {
    const { f, calls } = fakeFetch(() => ok({}));
    const client = new MiroClient({ base: 'https://api.miro.com', auth: token, fetch: f });
    await expect(client.get('https://evil.example.com/v2/boards')).rejects.toBeInstanceOf(MiroApiError);
    await expect(client.get('http://api.miro.com/v2/boards')).rejects.toBeInstanceOf(MiroApiError);
    expect(calls).toHaveLength(0);
  });

  it('Hilfen: Retry-After und Reset', () => {
    expect(retryAfterMs('3', 0)).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 0)).toBe(10_000);
    expect(retryAfterMs(null, 0)).toBeNull();
    expect(resetWaitMs('30', 0)).toBe(30_000);
    expect(resetWaitMs(String(2_000_000_000), 2_000_000_000 * 1000 - 5000)).toBe(5000);
    expect(resetWaitMs(String(2_000_000_000), 0)).toBe(60_000);
  });
});
