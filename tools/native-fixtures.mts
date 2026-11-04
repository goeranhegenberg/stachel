// Beispiel-Daten der Native-API für die Dart-Tests (docs/contract.md §8.9, docs/native_fixtures/README.md): startet den
// echten Server (server/dist) im Modus org mit Fake-Identitätsdienst, legt das Board „Alle Typen“ an (wie ein Browser), holt `welcome` über
// /native/v1 und zeichnet die Patches typischer Web-Änderungen auf. Werte, die sich je Lauf ändern (Board-/Bild-IDs,
// Epoche, clientId), werden durch feste ersetzt – die Dateien sind dadurch stabil.
// Vorher: npm --prefix server run build
// Aufruf: server/node_modules/.bin/tsx tools/native-fixtures.mts [--out docs/native_fixtures] [--big 2000 [--big 5000]]
//   --big N   zusätzlich ein großes Board (deterministisch) als big_<N>.welcome.json (nicht eingecheckt)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeOrg } from '../server/test/fake-org';
import { applyPatches, appSession, NativeClient, webClient, type Msg } from '../server/test/native-client';
import { passwordLogin, seedAllTypesBoard, seedBigBoard } from '../server/test/native-sandbox';
// Yjs aus server/node_modules (tools/ hat keine eigenen Pakete; eine Instanz mit dem Provider)
import { Y } from '../server/test/native-seed';
import { StachelServer } from '../e2e/support/server';
import { ROOT, SERVER_ENTRY } from '../e2e/support/paths';

const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1]! : path.join(ROOT, 'docs/native_fixtures'));
const bigs = args.flatMap((a, i) => (a === '--big' ? [Number(args[i + 1])] : [])).filter((n) => n > 0);

if (!fs.existsSync(SERVER_ENTRY)) {
  console.error(`Server nicht gebaut (${SERVER_ENTRY} fehlt). Erst: npm --prefix server run build`);
  process.exit(1);
}

const freePort = 8700 + Math.floor(Math.random() * 200);
const org = await new FakeOrg().start();
for (const name of ['mara', 'jonas']) {
  org.addAdmin(name, 'kaktus-123');
  org.tokens.set(`sandbox-${name}`, { kind: 'admin', username: name });
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-fixtures-'));
// Sandbox-Schalter: der Seed schreibt Kommentare fester Personen über /sync (server/src/sync.ts, Review SEC-06)
const server = new StachelServer(freePort, dataDir, org.url, path.join(dataDir, 'server.log'), { STACHEL_NATIVE_DEV_ACTIONS: '1' });
await server.start();
const wsBase = server.url.replace(/^http/, 'ws');

/** Je Lauf andere Werte durch feste ersetzen. */
function stable(json: string, map: Record<string, string>): string {
  let out = json;
  for (const [from, to] of Object.entries(map)) out = out.split(from).join(to);
  return out;
}

const write = (name: string, value: unknown, map: Record<string, string>) => {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, stable(`${JSON.stringify(value, null, 2)}\n`, map));
  console.log(`geschrieben: ${path.relative(ROOT, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
};

try {
  const mara = await passwordLogin(server.url, 'mara', 'kaktus-123');
  const jonas = await passwordLogin(server.url, 'jonas', 'kaktus-123');
  const { token } = await appSession(server.url, 'sandbox-mara');

  // ---- Alle Typen: welcome ----
  const { id: boardId, images } = await seedAllTypesBoard(server.url, mara);
  const app = new NativeClient(wsBase, token);
  const welcome = await app.hello(boardId);
  if (welcome.t !== 'welcome') throw new Error(`kein welcome: ${JSON.stringify(welcome)}`);
  const map: Record<string, string> = {
    [boardId]: 'board_all_types',
    [images.photo]: 'img_photo',
    [images.page0]: 'img_page0',
    [images.page1]: 'img_page1',
    [images.pdf!]: 'pdf_file',
    [welcome.epoch as string]: 'epoch_fixture',
    [`"clientId": ${welcome.clientId}`]: '"clientId": 1',
  };
  write('all_types.welcome.json', welcome, map);

  // ---- typische Web-Änderungen (als Jonas) → Patches ----
  const web = webClient(wsBase, boardId, { cookie: jonas });
  await web.synced();
  const objects = web.objects;
  const steps: [string, () => void][] = [
    ['Notiz verschieben', () => objects.get('sticky_rect')!.set('x', 420)],
    ['Farbe und Drehung ändern, Fettdruck entfernen', () => web.doc.transact(() => {
      const m = objects.get('sticky_rect')!;
      m.set('color', '#ffb3d1');
      m.set('rotation', -6);
      m.delete('bold');
    })],
    ['Rich-Text tippen (mit Klartext-Spiegel)', () => web.doc.transact(() => {
      const frag = objects.get('sticky_rich')!.get('content') as Y.XmlFragment;
      ((frag.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Neu: ');
      objects.get('sticky_rich')!.set('text', `Neu: ${String(objects.get('sticky_rich')!.get('text'))}`);
    })],
    ['Notiz anlegen', () => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ id: 'web_new', type: 'sticky', x: 900, y: 0, w: 200, h: 200, z: 'zz', color: '#fff27a', text: 'Vom Web', createdBy: 'a:jonas', updatedAt: '2026-11-01T12:05:00.000Z' })) m.set(k, v);
      objects.set('web_new', m);
    }],
    ['Tabellenzelle ändern', () => {
      const cells = (objects.get('table1')!.get('table') as Y.Map<unknown>).get('cells') as Y.Map<unknown>;
      cells.set('r3:c2', 'Jonas');
    }],
    ['Stiftstrich und angedockte Notiz samt Verbinder löschen', () => web.doc.transact(() => {
      objects.delete('pen1');
      objects.delete('sticky_old');
      objects.delete('conn_elbow');
    })],
    ['Reaktion setzen', () => web.doc.getMap('collab.reactions').set('web_new|🎉|a:jonas', { o: 'web_new', e: '🎉', u: 'a:jonas', n: 'jonas', at: '2026-11-01T12:06:00.000Z' })],
    ['Rahmen nach vorn (z)', () => objects.get('frame1')!.set('z', 'zzz')],
  ];
  const from = app.messages.length;
  for (const [, run] of steps) {
    run();
    await web.flushed();
  }
  const last = await app.next((m) => m.t === 'patch' && m.rev === welcome.rev + steps.length, 8000, from);
  const patches = app.messages.slice(from).filter((m) => m.t === 'patch' && m.rev <= last.rev);
  write(
    'all_types.patches.json',
    patches.map((p, i) => ({ step: steps[i]?.[0] ?? '', ...p })),
    map,
  );
  // erwarteter Stand nach den Patches = frischer Schnappschuss (die App muss genau hier landen)
  const state = applyPatches(new Map((welcome.snapshot.objects as Record<string, unknown>[]).map((o) => [o.id as string, o])), patches as Msg[]);
  const fresh = new NativeClient(wsBase, token);
  const again = await fresh.hello(boardId);
  const expected = again.snapshot.objects as Record<string, unknown>[];
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  const byIdText = (list: Record<string, unknown>[]) => JSON.stringify(canon(Object.fromEntries(list.map((o) => [o.id as string, o]))));
  const ok = byIdText([...state.values()]) === byIdText(expected);
  if (!ok) throw new Error('Schnappschuss + Patches ≠ frischer Schnappschuss');
  write('all_types.after_patches.objects.json', expected, map);
  web.destroy();
  app.close();
  fresh.close();

  // ---- große Boards (nicht eingecheckt) ----
  for (const n of bigs) {
    const { id } = await seedBigBoard(server.url, mara, n);
    const c = new NativeClient(wsBase, token);
    const w = await c.hello(id);
    c.close();
    write(`big_${n}.welcome.json`, w, { [id]: `board_big_${n}`, [w.epoch as string]: 'epoch_fixture', [`"clientId": ${w.clientId}`]: '"clientId": 1' });
  }
} finally {
  await server.stop();
  await org.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
