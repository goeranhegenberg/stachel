// GET /api/users: alle, die sich schon einmal angemeldet haben (für @Erwähnungen).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nowIso } from '../src/db.js';
import { listUsers, setupUsers } from '../src/users.js';
import { Browser, loginAdmin, loginMember, startEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

describe('Personen', () => {
  it('ohne Sitzung → 401 not_logged_in', async () => {
    const res = await new Browser(env.base).get('/api/users');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'not_logged_in' });
  });

  it('listet alle, die sich angemeldet haben – auch nach dem Abmelden, nach Namen sortiert', async () => {
    const token = env.fake.addMember(7, 'Ida Wolff');
    const ida = await loginMember(env, token);
    await ida.post('/api/auth/logout');
    const orga = await loginAdmin(env);
    const res = await orga.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toEqual({
      ok: true,
      users: [
        { key: 'm:7', name: 'Ida Wolff' },
        { key: 'a:orga', name: 'orga' },
      ],
    });
  });

  it('übernimmt Namensänderungen beim nächsten /api/auth/me', async () => {
    const b = await loginAdmin(env);
    env.srv.db.prepare("UPDATE sessions SET name = 'Orga-Team'").run();
    await b.get('/api/auth/me');
    const res = await b.get('/api/users');
    expect(res.body.users).toContainEqual({ key: 'a:orga', name: 'Orga-Team' });
    expect(res.body.users.filter((u: { key: string }) => u.key === 'a:orga')).toHaveLength(1);
  });

  it('füllt die Liste bei älteren Datenbanken aus Sitzungen und Boards', () => {
    const db = env.srv.db;
    const now = nowIso();
    db.prepare('INSERT INTO boards (id, title, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('alt1', 'Alt', 'm:99', 'Jonas Keller', now, now);
    db.exec('DELETE FROM users');
    setupUsers(db);
    const keys = listUsers(db).map((u) => u.key);
    expect(keys).toContain('m:99');
    expect(keys).toContain('a:orga');
  });
});
