// Mindmaps zwischen Org-App (Native-API, Vertrag §8.6 `mind`) und echtem Browser gegen den ECHTEN Server:
// - Browser legt eine Mindmap an (Tab/Enter) → die App bekommt Knoten samt Layout,
// - App legt Unterthemen an, schreibt, klappt ein → der Browser zeigt es, und sein EIGENES Layout (Canvas-Textmessung)
//   ergibt dieselben Lagen/Größen (Web ordnet nach einer lokalen Änderung neu an: nichts verschiebt sich; ±4 px,
//   expectSameLayout),
// - eingeklappter Knoten links zeigt die Zahl, Browser-Tab am Knoten der App kommt in der App an.
// Screenshot: docs/screenshots/native-mind-web.png (Vergleich mit dem Golden der App goldens/mindmap.png).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeOrg } from '../../server/test/fake-org';
import { appSession, NativeClient, type Msg } from '../../server/test/native-client';
import { E2E_PORT } from '../playwright.config';
import { SHOTS } from '../support/paths';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

let org: FakeOrg;
let server: StachelServer;
let dataDir: string;

test.beforeAll(async () => {
  org = await new FakeOrg().start();
  org.addAdmin('Mara', 'kaktus-123');
  org.tokens.set('app-jonas', { kind: 'admin', username: 'Jonas' });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-mind-'));
  server = new StachelServer(E2E_PORT, dataDir, org.url, path.join(import.meta.dirname, '../test-results/server-native-mind.log'));
  await server.start();
});

test.afterAll(async () => {
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

type Node = { id: string; x: number; y: number; w: number; h: number; text?: string; color?: string; mind?: Record<string, unknown> };
const layout = (list: Node[]) => Object.fromEntries(list.map((n) => [n.id, [n.x, n.y, n.w, n.h, JSON.stringify(n.mind ?? {}), n.color, n.text]]));

/** Lage und Größe auf ±4 px gleich, alles andere genau: Der Server misst Text mit Schriftmetriken, der Browser mit
 * Canvas; Chromium unter Linux (GitHub-CI) liegt dabei 1–3 px neben Windows. */
const PX = 4;
function expectSameLayout(got: ReturnType<typeof layout>, want: ReturnType<typeof layout>) {
  expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
  for (const [id, w] of Object.entries(want)) {
    const g = got[id];
    expect(g.slice(4), id).toEqual(w.slice(4));
    for (let i = 0; i < 4; i++) expect(Math.abs((g[i] as number) - (w[i] as number)), `${id} ${'xywh'[i]}`).toBeLessThanOrEqual(PX);
  }
}

/** App-Stand aus welcome + Patches. */
function appState(a: NativeClient) {
  const s = new Map<string, Record<string, any>>();
  for (const m of a.messages) {
    if (m.t === 'welcome') for (const o of m.snapshot.objects) s.set(o.id, o);
    if (m.t !== 'patch') continue;
    for (const c of m.changes as Msg[]) {
      if (c.created) s.set(c.id, c.created);
      else if (c.removed) s.delete(c.id);
      else if (s.has(c.id)) {
        const o = { ...s.get(c.id)!, ...(c.set ?? {}) };
        for (const k of c.unset ?? []) delete o[k];
        s.set(c.id, o);
      }
    }
  }
  return s;
}

/** Mindmap-Knoten, wie sie im Dokument stehen (über die App gelesen). */
const minds = (a: NativeClient): Node[] => [...appState(a).values()].filter((o) => o.type === 'mindnode') as Node[];

/** Der Browser ändert den Text der Wurzel und nimmt es zurück (echtes Tippen): seine Laufzeit ordnet die Mindmap dabei
 * mit der eigenen Canvas-Messung neu an. Hätte er ein anderes Layout, stünden danach andere Werte im Dokument. */
async function browserRelayout(page: Page, rootId: string) {
  await page.locator(`[data-id="${rootId}"]`).dblclick();
  await expect(page.locator('.structure-mind__text.editing')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.waitForTimeout(200);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

let req = 100;
async function ops(a: NativeClient, list: Record<string, unknown>[]) {
  const r = ++req;
  const from = a.messages.length;
  a.send({ t: 'ops', req: r, ops: list });
  const ack = await a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === r, 8000, from);
  expect(ack.t).toBe('ack');
}

test('Mindmap: Browser ↔ App, Layout des Servers = Layout des Browsers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Benutzername' }).fill('Mara');
  await page.locator('#p').fill('kaktus-123');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByRole('button', { name: 'Neues Board' }).click();
  await page.getByRole('dialog', { name: 'Neues Board' }).getByLabel('Name').fill('Mindmap App');
  await page.getByRole('dialog', { name: 'Neues Board' }).getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\?b=[\w-]+$/);
  await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  const board = new URL(page.url()).searchParams.get('b')!;
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  // App (Jonas) von Anfang an dabei
  const { token } = await appSession(server.url, 'app-jonas');
  const a = new NativeClient(server.url.replace('http', 'ws'), token);
  const welcome = await a.hello(board);
  expect(welcome.features).toContain('mind');

  // Browser: Mindmap mit Tab/Enter
  await page.getByRole('navigation').getByRole('button', { name: 'Karte, Tabelle, Mindmap', exact: true }).click();
  await page.getByRole('group', { name: 'Werkzeug-Optionen' }).getByRole('button', { name: 'Mindmap', exact: true }).click();
  await page.mouse.click(560, 380);
  await expect(page.locator('.structure-mind__text.editing')).toBeFocused();
  await page.keyboard.type('Sommerfest');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Programm');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Orga');
  await page.keyboard.press('Escape');
  // App sieht die Knoten mit dem Layout des Browsers
  await expect.poll(() => minds(a).map((n) => n.text).sort()).toEqual(['Orga', 'Programm', 'Sommerfest']);
  const byText = (t: string) => minds(a).find((n) => n.text === t)!;
  const root = byText('Sommerfest'), prog = byText('Programm'), orga = byText('Orga');
  expect(orga.mind?.parent).toBe(root.id);

  // App: Unterthemen, Text, links ein Zweig, eingeklappt
  await ops(a, [{ op: 'mind', do: 'child', id: orga.id, new: 'app1' }]);
  await ops(a, [{ op: 'mind', do: 'text', id: 'app1', text: 'Helfer:innen und Schichtplan für alle Tage' }]);
  await ops(a, [{ op: 'mind', do: 'sibling', id: 'app1', new: 'app2' }, { op: 'mind', do: 'text', id: 'app2', text: 'Finanzen' }]);
  await ops(a, [{ op: 'mind', do: 'child', id: root.id, new: 'tech', side: 'l' }, { op: 'mind', do: 'text', id: 'tech', text: 'Technik' }]);
  await ops(a, [{ op: 'mind', do: 'child', id: 'tech', new: 'strom' }, { op: 'mind', do: 'text', id: 'strom', text: 'Strom & Licht' }]);
  await ops(a, [{ op: 'mind', do: 'collapse', id: 'tech', collapsed: true }]);
  await expect.poll(() => minds(a).length).toBe(7);
  await expect(page.locator('[data-id="app1"]')).toContainText('Helfer:innen');
  await expect(page.locator('[data-id="strom"]')).toBeHidden();
  // eingeklappter Knoten links: Zahl am Knoten
  await expect(page.getByRole('button', { name: 'Zweig ausklappen (1)' })).toBeVisible();

  // Der Browser ordnet nach einer eigenen Änderung neu an (Canvas-Messung): nichts verschiebt sich
  const server1 = layout(minds(a));
  await browserRelayout(page, root.id);
  // der Browser hat wirklich neu angeordnet (mit „!“ war die Wurzel breiter) …
  expect(a.messages.some((m) => m.t === 'patch' && (m.changes as Msg[]).some((c) => c.set?.text === 'Sommerfest!'))).toBe(true);
  // … und danach steht wieder genau das Layout des Servers da
  expectSameLayout(layout(minds(a)), server1);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, 'native-mind-web.png') });

  // Browser: Tab an einem Knoten der App → kommt in der App an (Elternknoten, Layout)
  await page.locator('[data-id="app2"]').click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('Kasse');
  await page.keyboard.press('Escape');
  await expect.poll(() => minds(a).find((o) => o.text === 'Kasse')?.mind?.parent).toBe('app2');

  // App zieht Orga samt Unterthemen unter Programm (update + drop) → Browser zeigt den neuen Elternknoten
  const p = minds(a).find((n) => n.id === prog.id)!;
  await ops(a, [{ op: 'update', patches: { [orga.id]: { x: p.x + 5, y: p.y + 5 } } }, { op: 'mind', do: 'drop', ids: [orga.id] }]);
  await expect.poll(() => minds(a).find((n) => n.id === orga.id)!.mind?.parent).toBe(prog.id);
  await expect(page.locator(`[data-id="${orga.id}"]`)).toBeVisible();
  // und wieder: das Web hätte dasselbe Layout
  const server2 = layout(minds(a));
  await browserRelayout(page, root.id);
  expectSameLayout(layout(minds(a)), server2);
  a.close();
});
