// Eigene Vorlagen (src/user-templates.ts, Paket Q2): je Person privat, Browser-Cookie und App-Sitzung (Bearer sts_…),
// Grenzen (Name, Objekte, Größe, Anzahl), Löschen nur eigene.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_TEMPLATE_ARGS_JSON, MAX_TEMPLATE_OBJECTS, MAX_USER_TEMPLATES } from '../src/user-templates';
import { Browser, loginMember, startEnv, type TestEnv } from './helpers.js';
import { appSession } from './native-client.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 'a0', createdBy: 'k:1', updatedAt: '', color: '#fff27a', text: id, ...extra });

let memberId = 5200;
async function person(name: string) {
  const kt = env.fake.addMember(++memberId, name);
  const browser = await loginMember(env, kt);
  const app = await appSession(env.base, kt);
  const bearer = (method: string, p: string, json?: unknown) =>
    new Browser(env.base).req(method, p, { json, headers: { Authorization: `Bearer ${app.token}` } });
  return { browser, bearer };
}

describe('Eigene Vorlagen (/api/templates)', () => {
  it('speichern im Browser, lesen in der App (sts_), privat je Person, löschen nur eigene', async () => {
    const mara = await person('Mara');
    const tom = await person('Tom');
    const objects = [note('a', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] } }), note('b'), { id: 'c', type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'a' }, to: { objectId: 'b' } }];
    const saved = await mara.browser.post('/api/templates', { name: '  Meine   Retro ', objects });
    expect(saved.status).toBe(200);
    expect(saved.body.template).toMatchObject({ name: 'Meine Retro', objects });
    const id = saved.body.template.id as string;

    const viaApp = await mara.bearer('GET', '/api/templates');
    expect(viaApp.status).toBe(200);
    expect(viaApp.body.templates.map((t: { id: string }) => t.id)).toEqual([id]);
    expect(viaApp.body.templates[0].objects).toEqual(objects);
    // App speichert auch (Bearer, X-Stachel wie stachel_client)
    const second = await mara.bearer('POST', '/api/templates', { name: 'Aus der App', objects: [note('x')] });
    expect(second.status).toBe(200);
    expect((await mara.browser.get('/api/templates')).body.templates.map((t: { name: string }) => t.name)).toEqual(['Aus der App', 'Meine Retro']);

    // Tom sieht nichts und kann nicht löschen
    expect((await tom.browser.get('/api/templates')).body.templates).toEqual([]);
    expect((await tom.browser.req('DELETE', `/api/templates/${id}`)).status).toBe(404);
    expect((await mara.browser.req('DELETE', `/api/templates/${id}`)).status).toBe(200);
    expect((await mara.bearer('GET', '/api/templates')).body.templates.map((t: { name: string }) => t.name)).toEqual(['Aus der App']);
    expect((await mara.browser.req('DELETE', `/api/templates/${id}`)).status).toBe(404);
  });

  it('ohne Anmeldung 401, Browser ohne CSRF-Kopf abgelehnt', async () => {
    const anon = new Browser(env.base);
    expect((await anon.get('/api/templates')).status).toBe(401);
    const mara = await person('Mara');
    const res = await mara.browser.req('POST', '/api/templates', { json: { name: 'X', objects: [note('a')] }, csrf: false });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('prüft Name, Objekte, Größe und Anzahl', async () => {
    const { browser } = await person('Lena');
    const post = (body: unknown) => browser.post('/api/templates', body);
    expect((await post({ name: '', objects: [note('a')] })).status).toBe(400);
    expect((await post({ name: 'x'.repeat(81), objects: [note('a')] })).status).toBe(400);
    expect((await post({ name: 'Leer', objects: [] })).status).toBe(400);
    expect((await post({ name: 'Kaputt', objects: [{ id: 'a', type: 'sticky', x: 'links' }] })).status).toBe(400);
    expect((await post({ name: 'Doppelt', objects: [note('a'), note('a')] })).status).toBe(400);
    const many = Array.from({ length: MAX_TEMPLATE_OBJECTS + 1 }, (_, i) => note(`n${i}`));
    expect((await post({ name: 'Viele', objects: many })).body.error).toBe('too_large');
    // Anführungszeichen zählen doppelt (so schickt die App die Vorlage als JSON-Text)
    const big = [note('a', { text: '"'.repeat(Math.ceil(MAX_TEMPLATE_ARGS_JSON / 4)) })];
    expect((await post({ name: 'Groß', objects: big })).body.error).toBe('too_large');
    for (let i = 0; i < MAX_USER_TEMPLATES; i++) expect((await post({ name: `V${i}`, objects: [note('a')] })).status).toBe(200);
    const over = await post({ name: 'Eine zu viel', objects: [note('a')] });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe('limit');
  });
});
