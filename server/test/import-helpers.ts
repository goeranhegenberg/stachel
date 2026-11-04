// Gemeinsames für die Import-Tests: Server (Modus org) mit Fake-Miro als API-, Freigabe- und Datei-Host, Beispiel-Board,
// Log-Mitschnitt (pino schreibt über fs.write/fs.writeSync auf fd 1).
import fs from 'node:fs';
import * as Y from 'yjs';
import { boardDocName, DOC_OBJECTS } from '../../shared/protocol.js';
import { loadImportConfig, type Config } from '../src/config.js';
import { FakeMiro, tinyPdf, tinyPng, type FakeBoard } from './fake-miro.js';
import { startEnv, type TestEnv } from './helpers.js';

export const PUBLIC_URL = 'https://stachel.example.test';

export interface ImportEnv extends TestEnv {
  miro: FakeMiro;
}

/** Server + Fake-Miro; `env` ergänzt die Import-Umgebung (z. B. STACHEL_IMPORTS_PER_DAY), `overrides` die Konfiguration. */
export async function startImportEnv(opts: { env?: NodeJS.ProcessEnv; oauth?: boolean; overrides?: Partial<Config> } = {}): Promise<ImportEnv> {
  const miro = await new FakeMiro().start();
  const importCfg = loadImportConfig(
    {
      STACHEL_IMPORT_MIRO_API_BASE: miro.base,
      STACHEL_IMPORT_MIRO_AUTH_BASE: miro.base,
      ...(opts.oauth ? { MIRO_CLIENT_ID: miro.oauth.clientId, MIRO_CLIENT_SECRET: miro.oauth.clientSecret } : {}),
      ...(opts.env ?? {}),
    },
    PUBLIC_URL,
  );
  const env = await startEnv({ import: importCfg, ...(opts.overrides ?? {}) });
  return {
    ...env,
    miro,
    stop: async () => {
      await env.stop();
      await miro.stop();
    },
  };
}

/** Beispiel-Board im Rohformat der Miro-API */
export async function sampleBoard(id = 'b1', name = 'Workshop'): Promise<FakeBoard> {
  const at = (x: number, y: number, rel = 'canvas_center') => ({ x, y, origin: 'center', relativeTo: rel });
  return {
    board: { id, name, description: 'Ein Test-Board', modifiedAt: '2026-11-01T10:00:00Z' },
    items: [
      { id: '10', type: 'frame', data: { title: 'Ideen', format: 'custom', type: 'freeform' }, style: { fillColor: '#ffffff' }, position: at(0, 0), geometry: { width: 1000, height: 600 } },
      { id: '11', type: 'sticky_note', data: { content: '<p>Erste <strong>Idee</strong></p>', shape: 'square' }, style: { fillColor: 'light_yellow', textAlign: 'center', textAlignVertical: 'middle' }, position: at(150, 150, 'parent_top_left'), geometry: { width: 200, height: 200 }, parent: { id: '10' } },
      { id: '12', type: 'sticky_note', data: { content: '<p>Zweite</p>', shape: 'square' }, style: { fillColor: 'cyan' }, position: at(400, 150, 'parent_top_left'), geometry: { width: 200, height: 200 }, parent: { id: '10' } },
      { id: '13', type: 'shape', data: { content: '<p>Start</p>', shape: 'round_rectangle' }, style: { fillColor: '#c9e14a', borderColor: '#000000', borderWidth: '2', fontSize: '24' }, position: at(800, 0), geometry: { width: 240, height: 120 } },
      { id: '14', type: 'text', data: { content: '<p>Überschrift</p>' }, style: { fontSize: '48', color: '#1a1a1a' }, position: at(0, -500), geometry: { width: 400, height: 60 } },
      { id: '15', type: 'image', data: { imageUrl: `https://api.miro.com/v2/boards/${id}/resources/images/bild.png`, title: 'Bild' }, position: at(-800, 0), geometry: { width: 320, height: 240 } },
      { id: '16', type: 'image', data: { imageUrl: `https://api.miro.com/v2/boards/${id}/resources/images/fehlt.png`, title: 'Fehlt' }, position: at(-800, 400), geometry: { width: 320, height: 240 } },
      { id: '17', type: 'document', data: { documentUrl: `https://api.miro.com/v2/boards/${id}/resources/documents/doku.pdf`, title: 'doku.pdf' }, position: at(-1200, 0), geometry: { width: 200, height: 280 } },
      { id: '18', type: 'card', data: { title: '<p>Aufgabe</p>', description: 'Etwas tun', dueDate: '2026-12-01T00:00:00Z' }, style: { cardTheme: '#2d9bf0' }, position: at(800, 300), geometry: { width: 320, height: 94 } },
    ],
    connectors: [{ id: '30', startItem: { id: '11' }, endItem: { id: '13' }, shape: 'curved', style: { strokeColor: '#1a1a1a', endStrokeCap: 'stealth' } }],
    tags: [{ id: 't1', title: 'wichtig', fillColor: 'red' }],
    itemTags: { '11': ['t1'] },
    groups: [{ id: 'g1', type: 'group', data: { items: ['11', '12'] } }],
    files: { 'bild.png': { data: await tinyPng(64, 48), type: 'image/png' }, 'doku.pdf': { data: tinyPdf(), type: 'application/pdf' } },
  };
}

/** Objekte eines gespeicherten Boards (type je ID) */
export function boardObjects(env: TestEnv, boardId: string): Map<string, Record<string, unknown>> {
  const row = env.srv.db.prepare('SELECT state FROM documents WHERE name = ?').get(boardDocName(boardId)) as { state: Uint8Array } | undefined;
  const out = new Map<string, Record<string, unknown>>();
  if (!row) return out;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.state));
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS).forEach((m, id) => {
    if (m instanceof Y.Map) out.set(id, Object.fromEntries([...m.entries()].map(([k, v]) => [k, v instanceof Y.AbstractType ? v.toJSON() : v])));
  });
  doc.destroy();
  return out;
}

/** Log-Ausgabe mitschneiden (fd 1/2), ohne sie auszugeben. */
export function captureLog(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const f = fs as unknown as Record<string, any>;
  const write = f.write;
  const writeSync = f.writeSync;
  f.write = (fd: number, buf: unknown, ...rest: any[]) => {
    if (fd === 1 || fd === 2) {
      chunks.push(String(buf));
      const cb = rest.find((x) => typeof x === 'function');
      const n = typeof buf === 'string' ? Buffer.byteLength(buf) : (buf as Buffer).length;
      if (cb) process.nextTick(cb, null, n);
      return;
    }
    return write(fd, buf, ...rest);
  };
  f.writeSync = (fd: number, buf: unknown, ...rest: any[]) => {
    if (fd === 1 || fd === 2) {
      chunks.push(String(buf));
      return typeof buf === 'string' ? Buffer.byteLength(buf) : (buf as Buffer).length;
    }
    return writeSync(fd, buf, ...rest);
  };
  return {
    text: () => chunks.join(''),
    restore: () => {
      f.write = write;
      f.writeSync = writeSync;
    },
  };
}

