// Rich-Text live: zwei Personen schreiben gleichzeitig in dieselbe Haftnotiz (Hocuspocus-Testserver, Vite proxyt /sync).
// Sync-Port: frei vom Betriebssystem pro Worker (syncServer.ts).
import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import type { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { startSyncServer } from './syncServer';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
let server: Server;
let syncPort = 0;

test.beforeAll(async () => {
  ({ server, port: syncPort } = await startSyncServer({
    async onAuthenticate({ requestHeaders }) {
      const m = (requestHeaders.get('cookie') ?? '').match(/stachel_session=([^;]+)/);
      if (!m) throw Object.assign(new Error('not_logged_in'), { reason: 'not_logged_in' });
      return { session: m[1] };
    },
  }));
});

test.afterAll(async () => {
  await server?.destroy();
});

async function openAs(browser: Browser, user: FakeUser, session: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'stachel_session', value: session, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await installFakeApi(page, { loggedIn: true, user, boards: sampleBoards(), syncPort });
  await page.goto('/?b=b-plan');
  await expect(page.getByTestId('status')).toHaveText('Live');
  return page;
}

/** warten, bis ProseMirror die Cursor-Position aus dem Browser übernommen hat */
const atPos = (p: Page, where: 'start' | 'end') =>
  p.waitForFunction((w) => {
    const ed = (document.querySelector('.ProseMirror') as any).editor;
    const { from, empty } = ed.state.selection;
    return empty && from === (w === 'start' ? 1 : ed.state.doc.content.size - 1);
  }, where);

const MARA: FakeUser = { key: 'm:12', name: 'Mara Lindner', isOrga: true };
const JONAS: FakeUser = { key: 'm:31', name: 'Jonas Keller', isOrga: false };

/** Objekt im Dokument des Servers (Wahrheit für alle). */
function serverObject() {
  const doc = (server as any).hocuspocus.documents.get('board:b-plan') as Y.Doc;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const [m] = [...objects.values()].filter((o) => o.get('type') === 'sticky');
  return m;
}

/** Klartext eines Y.XmlFragment (Blöcke mit \n), wie der Vertrag den Spiegel definiert. */
function plain(f: Y.XmlFragment): string {
  const lines: string[] = [];
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    const kids = el.toArray();
    if (kids.length && kids.every((k) => k instanceof Y.XmlText)) {
      lines.push(kids.map((k) => (k as Y.XmlText).toString().replace(/<[^>]+>/g, '')).join(''));
      return;
    }
    if (!kids.length && el instanceof Y.XmlElement && el.nodeName === 'paragraph') lines.push('');
    kids.forEach((k) => k instanceof Y.XmlElement && walk(k));
  };
  walk(f);
  return lines.join('\n');
}

test('zwei Personen tippen gleichzeitig in dieselbe Notiz – nichts geht verloren', async ({ browser }) => {
  const a = await openAs(browser, MARA, 'sess-mara');
  const b = await openAs(browser, JONAS, 'sess-jonas');

  // A legt eine Notiz an
  await a.keyboard.press('n');
  await a.mouse.click(640, 400);
  await expect(a.locator('.rt.editing')).toBeFocused();
  await a.keyboard.type('Bühne');
  await a.keyboard.press('Escape');
  const noteB = b.locator('[data-type="sticky"] .sticky-text');
  await expect(noteB).toHaveText('Bühne');

  // beide bearbeiten dieselbe Notiz
  const box = (await a.locator('[data-type="sticky"]').boundingBox())!;
  await a.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(a.locator('.rt.editing')).toBeFocused();
  await a.keyboard.press('Control+End');
  await atPos(a, 'end');
  const boxB = (await b.locator('[data-type="sticky"]').boundingBox())!;
  await b.mouse.dblclick(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
  await expect(b.locator('.rt.editing')).toBeFocused();
  await b.keyboard.press('Control+Home');
  await atPos(b, 'start');

  // abwechselnd tippen, ohne aufeinander zu warten
  const wa = ' Nord';
  const wb = 'Große ';
  for (let i = 0; i < Math.max(wa.length, wb.length); i++) {
    await Promise.all([wa[i] ? a.keyboard.type(wa[i]) : null, wb[i] ? b.keyboard.type(wb[i]) : null]);
  }
  await a.keyboard.press('Control+b');
  await expect(a.locator('.rt.editing')).toHaveText('Große Bühne Nord');
  await expect(b.locator('.rt.editing')).toHaveText('Große Bühne Nord');
  // die Schreibmarke der anderen Person ist sichtbar
  await expect(a.locator('.rt-caret[data-name="Jonas Keller"]')).toBeVisible();
  await expect(b.locator('.rt-caret[data-name="Mara Lindner"]')).toBeVisible();
  await a.screenshot({ path: path.join(OUT, 'richtext-live.png') });

  await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  await expect(a.locator('[data-type="sticky"] .sticky-text')).toHaveText('Große Bühne Nord');
  await expect(noteB).toHaveText('Große Bühne Nord');

  // auf dem Server: content vollständig, text = Klartext-Spiegel
  await expect.poll(() => serverObject()?.get('text')).toBe('Große Bühne Nord');
  const m = serverObject();
  expect(plain(m.get('content') as Y.XmlFragment)).toBe(m.get('text'));

  await a.context().close();
  await b.context().close();
});
