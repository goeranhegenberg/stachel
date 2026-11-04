// Vorlagen der Instanz (src/template-packs.ts): `*.json` aus STACHEL_TEMPLATES_DIR, geprüft wie eigene Vorlagen, unter
// einer eigenen Kategorie über `GET /api/templates/instance` (Browser und App), Neu-Einlesen ohne Neustart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTemplatePackConfig, readTemplatePacks, TemplatePacks } from '../src/template-packs';
import { Browser, loginMember, startEnv, type TestEnv } from './helpers.js';
import { appSession } from './native-client.js';

const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, color: '#fff27a', text: id, ...extra });

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-packs-'));
const write = (dir: string, name: string, data: unknown) => fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));

describe('Vorlagen der Instanz: Einstellungen', () => {
  it('Ordner und Kategorie aus der Umgebung, sonst <DATA_DIR>/templates und Name der Instanz bzw. „Weitere Vorlagen“', () => {
    expect(loadTemplatePackConfig({}, '/data', 'Stachel')).toEqual({ dir: path.resolve('/data/templates'), category: 'Weitere Vorlagen' });
    expect(loadTemplatePackConfig({}, '/data', 'Verein Nord').category).toBe('Verein Nord');
    expect(loadTemplatePackConfig({ STACHEL_TEMPLATES_DIR: '/vorlagen', STACHEL_TEMPLATES_CATEGORY: ' Unser Fest ' }, '/data', 'X')).toEqual({ dir: path.resolve('/vorlagen'), category: 'Unser Fest' });
  });
});

describe('Vorlagen der Instanz: Dateien lesen', () => {
  it('Paket, Liste und einzelne Vorlage; IDs je Datei, ungültiges wird mit Warnung übersprungen', () => {
    const dir = tmpDir();
    write(dir, 'b-fest.json', { templates: [{ id: 'Ablauf', name: '  Ablauf  Fest ', desc: 'Der Tag', keywords: ['tag', 3, ''], objects: [note('a'), note('b')] }, { name: 'Leer', objects: [] }] });
    write(dir, 'a-liste.json', [{ name: 'Eins', objects: [note('x')] }, { name: 'Eins', objects: [note('y')] }]);
    write(dir, 'c-einzeln.json', `﻿${JSON.stringify({ id: 'abc', name: 'Aus GET /api/templates', createdAt: '2026-11-04T10:00:00Z', objects: [note('z')] })}`);
    write(dir, 'd-kaputt.json', '{nicht json');
    write(dir, 'e-objekte.json', { name: 'Ohne Lage', objects: [{ id: 'q', type: 'sticky' }] });
    write(dir, 'f-doppelt.json', { name: 'Doppelt', objects: [note('a'), note('a')] });
    write(dir, 'liesmich.txt', 'kein JSON-Paket');
    const warnings: string[] = [];
    const list = readTemplatePacks(dir, (m) => warnings.push(m));
    expect(list.map((t) => [t.id, t.name])).toEqual([
      ['a-liste.eins', 'Eins'],
      ['a-liste.eins-2', 'Eins'],
      ['b-fest.ablauf', 'Ablauf Fest'],
      ['c-einzeln.abc', 'Aus GET /api/templates'],
    ]);
    expect(list[2]).toMatchObject({ desc: 'Der Tag', keywords: ['tag'], objects: [note('a'), note('b')] });
    expect(warnings).toHaveLength(4);
    expect(warnings.join('\n')).toMatch(/b-fest\.json, Vorlage 2: „Leer“: keine Objekte/);
    expect(warnings.join('\n')).toMatch(/d-kaputt\.json ist kein gültiges JSON/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fehlender Ordner = keine Vorlagen; Änderungen kommen ohne Neustart (höchstens alle 30 s geprüft)', () => {
    const dir = path.join(tmpDir(), 'templates');
    let now = 1_000_000;
    const packs = new TemplatePacks({ dir, category: 'Fest' }, () => {}, () => now);
    expect(packs.templates()).toEqual([]);
    fs.mkdirSync(dir);
    write(dir, 'fest.json', { name: 'Ablauf', objects: [note('a')] });
    expect(packs.templates()).toEqual([]); // noch im Zwischenspeicher
    now += 31_000;
    expect(packs.templates().map((t) => t.id)).toEqual(['fest.ablauf']);
    fs.rmSync(path.join(dir, 'fest.json'));
    now += 31_000;
    expect(packs.templates()).toEqual([]);
  });
});

describe('Vorlagen der Instanz: GET /api/templates/instance', () => {
  let env: TestEnv;
  let dir: string;
  beforeAll(async () => {
    dir = tmpDir();
    write(dir, 'fest.json', { templates: [{ id: 'ablauf', name: 'Ablauf', desc: 'Aufbau bis Abbau', objects: [note('a'), note('b')] }] });
    env = await startEnv({ templatePacks: { dir, category: 'Unser Fest' } });
  });
  afterAll(async () => {
    await env?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('nur mit Sitzung; Browser und App (sts_) sehen Kategorie und Vorlagen', async () => {
    expect((await new Browser(env.base).get('/api/templates/instance')).status).toBe(401);
    const kt = env.fake.addMember(5301, 'Mara');
    const browser = await loginMember(env, kt);
    const res = await browser.get('/api/templates/instance');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, category: 'Unser Fest', templates: [{ id: 'fest.ablauf', name: 'Ablauf', desc: 'Aufbau bis Abbau', keywords: [], objects: [note('a'), note('b')] }] });
    const app = await appSession(env.base, kt);
    const viaApp = await new Browser(env.base).req('GET', '/api/templates/instance', { headers: { Authorization: `Bearer ${app.token}` } });
    expect(viaApp.status).toBe(200);
    expect(viaApp.body.templates).toHaveLength(1);
  });
});
