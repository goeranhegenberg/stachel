// Native-API: App-Sitzung (POST/DELETE /api/auth/app-session), Bearer sts_ für /api, /api/native/info, „Im Browser
// öffnen“ (docs/contract.md §8.1, §8.2).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEnv, type TestEnv } from './helpers.js';
import { appSession, NativeClient } from './native-client.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

const bearer = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });

describe('App-Sitzung (POST /api/auth/app-session)', () => {
  it('tauscht ein Org-Token gegen ein sts_-Token; nur der Hash liegt in sessions', async () => {
    const kt = env.fake.addMember(501, 'Mara');
    const res = await fetch(`${env.base}/api/auth/app-session`, { method: 'POST', headers: bearer(kt) });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    const body = (await res.json()) as { ok: boolean; token: string; user: { key: string; name: string; isOrga: boolean }; expiresAt: string };
    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^sts_[A-Za-z0-9_-]{43}$/);
    expect(body.user).toEqual({ key: 'm:501', name: 'Mara', isOrga: false });
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
    const rows = env.srv.db.prepare('SELECT id, user_key FROM sessions WHERE user_key = ?').all('m:501') as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toContain(body.token);
    // für @Erwähnungen bekannt
    const users = await fetch(`${env.base}/api/users`, { headers: bearer(body.token) });
    expect(((await users.json()) as { users: { key: string }[] }).users.some((u) => u.key === 'm:501')).toBe(true);
  });

  it('Fehler wie app-code: invalid_token, pending, forbidden, org_unreachable', async () => {
    const post = (h: Record<string, string>) => fetch(`${env.base}/api/auth/app-session`, { method: 'POST', headers: h });
    const err = async (r: Response) => [r.status, ((await r.json()) as { error: string }).error];
    expect(await err(await post({}))).toEqual([401, 'invalid_token']);
    expect(await err(await post(bearer('falsch')))).toEqual([401, 'invalid_token']);
    expect(await err(await post(bearer(env.fake.addMember(502, 'Wartet', 'pending'))))).toEqual([403, 'pending']);
    env.fake.mode = 'down';
    try {
      expect(await err(await post(bearer(env.fake.addMember(503, 'Offline'))))).toEqual([502, 'org_unreachable']);
    } finally {
      env.fake.mode = 'ok';
    }
  });

  it('Bearer sts_ gilt für /api (lesen ohne, schreiben mit X-Stachel), /api/auth/me prüft nach, DELETE meldet ab', async () => {
    const kt = env.fake.addMember(504, 'Jonas');
    const { token } = await appSession(env.base, kt);
    const list = await fetch(`${env.base}/api/boards`, { headers: bearer(token) });
    expect(list.status).toBe(200);
    // schreiben ohne CSRF-Header → 403, mit → 201
    expect((await fetch(`${env.base}/api/boards`, { method: 'POST', headers: bearer(token, { 'Content-Type': 'application/json' }), body: '{"title":"x"}' })).status).toBe(403);
    const created = await fetch(`${env.base}/api/boards`, { method: 'POST', headers: bearer(token, { 'Content-Type': 'application/json', 'X-Stachel': '1' }), body: '{"title":"Aus der App"}' });
    expect(created.status).toBe(201);
    const board = ((await created.json()) as { board: { id: string; createdBy: string } }).board;
    expect(board.createdBy).toBe('m:504');
    // Favorit über Bearer
    expect((await fetch(`${env.base}/api/boards/${board.id}/favorite`, { method: 'PUT', headers: bearer(token, { 'X-Stachel': '1' }) })).status).toBe(200);
    const fav = (await (await fetch(`${env.base}/api/boards`, { headers: bearer(token) })).json()) as { boards: { id: string; favorite?: boolean }[] };
    expect(fav.boards.find((b) => b.id === board.id)?.favorite).toBe(true);

    const me = await fetch(`${env.base}/api/auth/me`, { headers: bearer(token) });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { key: string } }).user.key).toBe('m:504');

    // Identitätsdienst sperrt das Konto: Nachprüfung (älter als 6 h) löscht die Sitzung
    env.srv.sessions.setVerifiedAt(token, new Date(Date.now() - 7 * 3600_000).toISOString());
    env.fake.revoke(kt);
    expect((await fetch(`${env.base}/api/auth/me`, { headers: bearer(token) })).status).toBe(401);
    expect((await fetch(`${env.base}/api/boards`, { headers: bearer(token) })).status).toBe(401);
  });

  it('DELETE /api/auth/app-session löscht die Sitzung und trennt offene Native-Verbindungen', async () => {
    const { token } = await appSession(env.base, env.fake.addMember(505, 'Lena'));
    const b = (await (await fetch(`${env.base}/api/boards`, { method: 'POST', headers: bearer(token, { 'X-Stachel': '1', 'Content-Type': 'application/json' }), body: '{}' })).json()) as { board: { id: string } };
    const app = new NativeClient(env.base.replace('http', 'ws'), token);
    expect((await app.hello(b.board.id)).t).toBe('welcome');
    // ohne CSRF-Header abgelehnt
    expect((await fetch(`${env.base}/api/auth/app-session`, { method: 'DELETE', headers: bearer(token) })).status).toBe(403);
    const del = await fetch(`${env.base}/api/auth/app-session`, { method: 'DELETE', headers: bearer(token, { 'X-Stachel': '1' }) });
    expect(del.status).toBe(200);
    expect((await app.waitClosed()).code).toBe(4401);
    expect(app.messages.at(-1)).toMatchObject({ t: 'error', error: 'not_logged_in' });
    expect((await fetch(`${env.base}/api/boards`, { headers: bearer(token) })).status).toBe(401);
    // doppelt ist harmlos
    expect((await fetch(`${env.base}/api/auth/app-session`, { method: 'DELETE', headers: bearer(token, { 'X-Stachel': '1' }) })).status).toBe(200);
  });

  it('ein stk_-API-Token oder Cookie ist kein App-Token für /native/v1', async () => {
    const res = await fetch(`${env.base}/api/auth/me`, { headers: bearer('stk_' + 'x'.repeat(43)) });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/native/info und „Im Browser öffnen“', () => {
  it('liefert Protokoll, Pfad, Funktionen und Grenzen ohne Sitzung', async () => {
    const res = await fetch(`${env.base}/api/native/info`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = (await res.json()) as { actions: Record<string, number> };
    expect(body.actions['dev.note']).toBeUndefined();
    expect(Object.values(body.actions).every((v) => Number.isInteger(v) && v >= 1)).toBe(true);
    expect(body).toEqual({
      ok: true,
      proto: [1],
      minApp: null,
      minApps: { org: null, stachel: null },
      path: '/native/v1',
      features: ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'comments', 'reactions', 'uploads', 'inbox', 'mind', 'act', 'extra', 'private'],
      // Web-Aktionen der Pakete P1–P9 (§8.12); Sandbox-Aktionen (dev.*) nur mit STACHEL_NATIVE_DEV_ACTIONS=1
      actions: expect.any(Object),
      presenceExtra: ['collab.status', 'collab.follow', 'collab.summon', 'collab.laser', 'collab.chat', 'structure.present', 'structure.handover'],
      limits: { maxOps: 500, maxMessageBytes: 4 * 1024 * 1024, maxTextLength: 20_000 },
    });
  });

  it('browser=1 leitet ohne app=1 weiter (System-Browser statt WebView)', async () => {
    const kt = env.fake.addMember(506, 'Browserin');
    const code = async () => ((await (await fetch(`${env.base}/api/auth/app-code`, { method: 'POST', headers: bearer(kt) })).json()) as { code: string }).code;
    const r1 = await fetch(`${env.base}/auth/app?code=${await code()}&b=abc123&browser=1`, { redirect: 'manual' });
    expect(r1.status).toBe(302);
    expect(r1.headers.get('location')).toBe('/?b=abc123');
    const r2 = await fetch(`${env.base}/auth/app?code=${await code()}&b=abc123`, { redirect: 'manual' });
    expect(r2.headers.get('location')).toBe('/?b=abc123&app=1');
  });
});
