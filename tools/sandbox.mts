// Lokale Spielwiese zum interaktiven Testen: echter Server (server/dist + web/dist) im Modus org mit Fake-Identitätsdienst und
// leerem Daten-Ordner. Vorher bauen: `cd e2e && npm run build` (nur für die App reicht `npm --prefix server run build`).
// Aufruf: server/node_modules/.bin/tsx tools/sandbox.mts [port] [--host 0.0.0.0] [--seed] [--info <datei.json>] [--local]
//         [--base /app [--landing]]
//   port        Stachel (Standard 8600); der Fake-Identitätsdienst läuft auf port+1
//   --host      0.0.0.0, damit ein Handy im WLAN die Sandbox erreicht (http://<PC-IP>:8600)
//   --seed      Boards für App-Tests anlegen: „Alle Typen“ (mit Bildern/PDF), „Groß 2000“, „Groß 5000“
//   --info      Verbindungsdaten zusätzlich als JSON hierhin schreiben (Standard: <Daten>/sandbox.json)
//   --local     Modus local für die Stachel-App (eigene Konten, kein Fake-Identitätsdienst, Mails in <Daten>/mail.log, leichtes
//               Captcha); mit --seed je ein bestätigtes Konto owner|edit|comment|view@sandbox.test (Passwort
//               Stachel-Probe-2026) und ein Board von owner, mit den anderen in ihrer Rolle geteilt (tools/sandbox-local.mts)
//   --base      Web-App unter diesem Pfad (STACHEL_BASE_PATH, z. B. /app wie stachel.intsode.com; API bleibt an der Wurzel),
//   --landing   dazu die Produktseite unter / (STACHEL_LANDING=1), server/src/site.ts
// Logins (Passwort-Formular): mara / kaktus-123, jonas / kaktus-123, lena / kaktus-123
// Org-App (Native-API, docs/contract.md §8): Org-Token `sandbox-<name>` (gleiche Person wie der Passwort-Login,
// a:<name>, Orga) bzw. `sandbox-member-<name>` (Team-Mitglied m:<id>) → POST /api/auth/app-session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeOrg } from '../server/test/fake-org';
import { passwordLogin, seedAllTypesBoard, seedBigBoard } from '../server/test/native-sandbox';
import { StachelServer } from '../e2e/support/server';
import { SERVER_ENTRY } from '../e2e/support/paths';
import { runLocalSandbox } from './sandbox-local.mts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 8600);
const host = opt('--host') ?? '127.0.0.1';
/** Web-App unter einem Pfad (server/src/site.ts) */
const siteEnv: Record<string, string> = {
  ...(opt('--base') ? { STACHEL_BASE_PATH: opt('--base')! } : {}),
  ...(flag('--landing') ? { STACHEL_LANDING: '1' } : {}),
};
const PEOPLE = [
  { login: 'mara', name: 'Mara', memberId: 101, orga: true },
  { login: 'jonas', name: 'Jonas', memberId: 102, orga: false },
  { login: 'lena', name: 'Lena', memberId: 103, orga: false },
];

if (!fs.existsSync(SERVER_ENTRY)) {
  console.error(`Server nicht gebaut (${SERVER_ENTRY} fehlt). Erst: npm --prefix server run build (bzw. cd e2e && npm run build für die Web-App).`);
  process.exit(1);
}

if (flag('--local')) {
  await runLocalSandbox({ port, host, seed: flag('--seed'), infoFile: opt('--info'), env: siteEnv });
} else {
  const org = await new FakeOrg().start(port + 1, host);
  for (const p of PEOPLE) {
    org.addAdmin(p.login, 'kaktus-123');
    // feste Org-Tokens für die App: gleiche Person wie der Passwort-Login bzw. ein Team-Mitglied
    org.tokens.set(`sandbox-${p.login}`, { kind: 'admin', username: p.login });
    org.tokens.set(`sandbox-member-${p.login}`, { kind: 'member', id: p.memberId, name: p.name, status: 'active', orga: p.orga });
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `stachel-sandbox-${port}-`));
  // Sandbox-Aktionen der Native-API (dev.note, Vertrag §8.12) für App-Tests ohne echte Web-Aktion
  const server = new StachelServer(port, dataDir, org.url, path.join(dataDir, 'server.log'), { STACHEL_NATIVE_DEV_ACTIONS: '1', ...siteEnv, ...(host === '127.0.0.1' ? {} : { HOST: host }) });
  await server.start();

  const boards: Record<string, string> = {};
  if (flag('--seed')) {
    const cookie = await passwordLogin(server.url, 'mara', 'kaktus-123');
    boards.allTypes = (await seedAllTypesBoard(server.url, cookie)).id;
    boards.big2000 = (await seedBigBoard(server.url, cookie, 2000)).id;
    boards.big5000 = (await seedBigBoard(server.url, cookie, 5000)).id;
  }

  const info = {
    stachelBase: server.url,
    nativeUrl: `${server.url.replace(/^http/, 'ws')}/native/v1`,
    orgBase: org.url,
    password: 'kaktus-123',
    people: PEOPLE.map((p) => ({ login: p.login, name: p.name, key: `a:${p.login}`, teamToken: `sandbox-${p.login}`, memberToken: `sandbox-member-${p.login}`, memberKey: `m:${p.memberId}` })),
    boards,
    dataDir,
  };
  const infoFile = opt('--info') ?? path.join(dataDir, 'sandbox.json');
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));

  console.log(`Stachel-Sandbox: ${server.url}  (Daten ${dataDir}, Log server.log)`);
  console.log(`Org-Fake:        ${org.url}  (POST /login, GET /me)`);
  console.log(`Native-API:      ${info.nativeUrl}`);
  console.log('Logins:          mara / jonas / lena, Passwort kaktus-123');
  console.log(`Org-Tokens:      ${PEOPLE.map((p) => `sandbox-${p.login}`).join(', ')}  (Mitglieder: sandbox-member-<name>)`);
  if (Object.keys(boards).length) console.log(`Boards:          ${Object.entries(boards).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`Verbindungsdaten: ${infoFile}`);

  const stop = async () => {
    await server.stop();
    await org.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
