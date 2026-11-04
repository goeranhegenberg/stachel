// Fake-Miro für E2E, Sandbox und Live-Tests der Apps (docs/features/import.md §7 „Testen“).
// Aufruf: server/node_modules/.bin/tsx tools/miro-fake.mts [port] [--host 127.0.0.1] [--token <t>]
//         [--client-id <id>] [--client-secret <s>]
//   port         Standard 8791
//   --token      gültiges persönliches Token (Standard fake-token; mehrfach erlaubt)
//   --client-*   OAuth-App (Standard fake-client / fake-secret)
// Boards: server/test/fixtures/miro/<board>/… (Format dort in README.md) und immer ein kleines Beispiel-Board `demo1` mit
// Bild und PDF.
// Stachel dazu mit STACHEL_IMPORT_MIRO_API_BASE=http://127.0.0.1:<port> und STACHEL_IMPORT_MIRO_AUTH_BASE=http://127.0.0.1:<port>
// starten (für OAuth zusätzlich MIRO_CLIENT_ID/MIRO_CLIENT_SECRET wie oben).
import { FakeMiro, loadFixtureBoards, tinyPdf, tinyPng } from '../server/test/fake-miro';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 8791);
const host = opt('--host') ?? '127.0.0.1';

const fake = new FakeMiro({ clientId: opt('--client-id') ?? 'fake-client', clientSecret: opt('--client-secret') ?? 'fake-secret' });
for (const t of all('--token').length ? all('--token') : ['fake-token']) fake.tokens.add(t);
for (const b of loadFixtureBoards()) fake.addBoard(b);
fake.addBoard({
  board: { id: 'demo1', name: 'Beispiel-Board', description: 'Kleines Board aus dem Fake-Miro', modifiedAt: new Date().toISOString() },
  items: [
    { id: '1', type: 'frame', data: { title: 'Rahmen' }, style: { fillColor: '#ffffff' }, position: { x: 0, y: 0, origin: 'center', relativeTo: 'canvas_center' }, geometry: { width: 800, height: 500 } },
    { id: '2', type: 'sticky_note', data: { content: '<p>Hallo <strong>Welt</strong></p>', shape: 'square' }, style: { fillColor: 'light_yellow', textAlign: 'center', textAlignVertical: 'middle' }, position: { x: 100, y: 100, origin: 'center', relativeTo: 'parent_top_left' }, geometry: { width: 200, height: 200 }, parent: { id: '1' } },
    { id: '3', type: 'shape', data: { content: '<p>Form</p>', shape: 'round_rectangle' }, style: { fillColor: '#c9e14a', borderColor: '#1a1a1a', borderWidth: '2', fontSize: '24' }, position: { x: 600, y: 0, origin: 'center', relativeTo: 'canvas_center' }, geometry: { width: 240, height: 120 } },
    { id: '4', type: 'image', data: { imageUrl: 'https://api.miro.com/v2/boards/demo1/resources/images/bild.png', title: 'Bild' }, position: { x: -600, y: 0, origin: 'center', relativeTo: 'canvas_center' }, geometry: { width: 320, height: 240 } },
    { id: '5', type: 'document', data: { documentUrl: 'https://api.miro.com/v2/boards/demo1/resources/documents/doku.pdf', title: 'doku.pdf' }, position: { x: -600, y: 400, origin: 'center', relativeTo: 'canvas_center' }, geometry: { width: 200, height: 280 } },
  ],
  connectors: [{ id: 'c1', startItem: { id: '2' }, endItem: { id: '3' }, shape: 'curved', style: { strokeColor: '#1a1a1a', endStrokeCap: 'stealth' } }],
  files: { 'bild.png': { data: await tinyPng(64, 48), type: 'image/png' }, 'doku.pdf': { data: tinyPdf(), type: 'application/pdf' } },
});
await fake.start(port, host);
console.log(JSON.stringify({ base: fake.base, tokens: [...fake.tokens], clientId: fake.oauth.clientId, boards: [...fake.boards.keys()] }, null, 2));
console.log(`Fake-Miro läuft auf ${fake.base} (Strg+C beendet).`);
