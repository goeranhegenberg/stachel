// Ende-zu-Ende gegen den ECHTEN Server: web/dist vom Server ausgeliefert, Fake-Identitätsdienst (Modus org).
// Zwei Browser (Mara per Passwort, Jonas per QR wie die App) arbeiten live auf einem Board; danach Neuladen und
// Server-Neustart – alles muss noch da sein. Screenshots: docs/screenshots/live-*.png.
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeOrg } from '../../server/test/fake-org';
import { E2E_PORT } from '../playwright.config';
import { SHOTS } from '../support/paths';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

const MARA = 'Mara';
const JONAS = 'Jonas Keller';
let org: FakeOrg;
let server: StachelServer;
let dataDir: string;
let jonasToken: string;
let a: Page; // Mara
let b: Page; // Jonas
let boardUrl = '';

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `live-${name}.png`) });

/** Wartet, bis ProseMirror die Schreibmarke an den Anfang bzw. ans Ende gesetzt hat. */
const caretAt = (p: Page, where: 'start' | 'end') =>
  p.waitForFunction((w) => {
    const ed = (document.querySelector('.ProseMirror') as any)?.editor;
    if (!ed) return false;
    const { from, empty } = ed.state.selection;
    return empty && from === (w === 'start' ? 1 : ed.state.doc.content.size - 1);
  }, where);

const stickies = (p: Page) => p.locator('[data-type="sticky"]');

async function centerOf(p: Page, sel: string, i = 0) {
  const box = (await p.locator(sel).nth(i).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  return ctx.newPage();
}

async function openBoard(p: Page) {
  await p.goto(boardUrl);
  await expect(p.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
}

test.beforeAll(async () => {
  org = await new FakeOrg().start();
  org.addAdmin(MARA, 'kaktus-123');
  jonasToken = org.addMember(31, JONAS);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-'));
  server = new StachelServer(E2E_PORT, dataDir, org.url, path.join(import.meta.dirname, '../test-results/server.log'));
  await server.start();
});

test.afterAll(async () => {
  await a?.context().close();
  await b?.context().close();
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Passwort-Login und neues Board', async ({ browser }) => {
  a = await newPage(browser);
  await a.goto('/');
  await expect(a.getByRole('heading', { name: 'Benutzername & Passwort' })).toBeVisible();
  // falsches Passwort
  await a.getByRole('textbox', { name: 'Benutzername' }).fill(MARA);
  await a.locator('#p').fill('falsch');
  await a.getByRole('button', { name: 'Anmelden' }).click();
  await expect(a.getByTestId('login-error')).toBeVisible();
  await a.locator('#p').fill('kaktus-123');
  await shot(a, 'login');
  await a.getByRole('button', { name: 'Anmelden' }).click();
  await expect(a.getByRole('button', { name: 'Neues Board' })).toBeVisible();

  await a.getByRole('button', { name: 'Neues Board' }).click();
  await a.getByRole('dialog', { name: 'Neues Board' }).getByLabel('Name').fill('Festival-Planung');
  await a.getByRole('dialog', { name: 'Neues Board' }).getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(a).toHaveURL(/\?b=[\w-]+$/);
  boardUrl = new URL(a.url()).pathname + new URL(a.url()).search;
  await expect(a.getByTestId('board-title')).toHaveText('Festival-Planung');
  await expect(a.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
});

test('QR-Login: die App bestätigt per Request, der Browser ist angemeldet', async ({ browser }) => {
  b = await newPage(browser);
  const qr = b.waitForResponse((r) => r.url().endsWith('/api/auth/qr') && r.request().method() === 'POST');
  await b.goto('/');
  const { code } = await (await qr).json();
  await expect(b.getByRole('img', { name: 'QR-Code zum Anmelden' })).toBeVisible();
  await shot(b, 'qr');
  // wie die Org-App: POST /api/auth/qr/approve mit Org-Token, ohne Cookie und ohne X-Stachel
  const res = await fetch(`${server.url}/api/auth/qr/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jonasToken}` },
    body: JSON.stringify({ code }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, name: JONAS });
  await expect(b.getByRole('button', { name: 'Neues Board' })).toBeVisible({ timeout: 30_000 });
  await expect(b.getByText('Festival-Planung')).toBeVisible();
  await openBoard(b);
  await expect(b.getByTestId('board-title')).toHaveText('Festival-Planung');
});

test('Rich-Text: fett + unterstrichen bei Mara ist bei Jonas sichtbar', async () => {
  await a.keyboard.press('Escape');
  await a.keyboard.press('n');
  await a.mouse.click(420, 360);
  await expect(a.locator('.rt.editing')).toBeFocused();
  await a.keyboard.type('Bühne Nord');
  await expect(a.locator('.rt.editing')).toHaveText('Bühne Nord');
  await caretAt(a, 'end');
  for (let i = 0; i < 4; i++) await a.keyboard.press('Shift+ArrowLeft');
  await a.waitForFunction(() => {
    const { from, to } = (document.querySelector('.ProseMirror') as any).editor.state.selection;
    return to - from === 4;
  });
  await a.keyboard.press('Control+b');
  await a.keyboard.press('Control+u');
  await a.keyboard.press('Escape');

  const note = stickies(b).first();
  await expect(note).toContainText('Bühne Nord');
  await expect(note.locator('strong')).toHaveText('Nord');
  await expect(note.locator('u')).toHaveText('Nord');
  // Anwesenheit: beide sehen sich
  await expect(a.getByTestId('presence').getByTitle(`${JONAS} – hinspringen und folgen`)).toBeVisible();
  await shot(b, 'richtext');
});

test('Gleichzeitiges Tippen in derselben Notiz', async () => {
  await a.keyboard.press('Escape');
  await a.keyboard.press('n');
  await a.mouse.click(700, 360);
  await expect(a.locator('.rt.editing')).toBeFocused();
  await a.keyboard.type('Bar');
  await a.keyboard.press('Escape');
  await expect(stickies(b)).toHaveCount(2);

  const pa = await centerOf(a, '[data-type="sticky"]', 1);
  await a.mouse.dblclick(pa.x, pa.y);
  await expect(a.locator('.rt.editing')).toBeFocused();
  await a.keyboard.press('Control+End');
  await caretAt(a, 'end');
  const pb = await centerOf(b, '[data-type="sticky"]', 1);
  await b.mouse.dblclick(pb.x, pb.y);
  await expect(b.locator('.rt.editing')).toBeFocused();
  await b.keyboard.press('Control+Home');
  await caretAt(b, 'start');

  const wa = ' am Eingang';
  const wb = 'Neue ';
  for (let i = 0; i < Math.max(wa.length, wb.length); i++) {
    await Promise.all([wa[i] ? a.keyboard.type(wa[i]) : null, wb[i] ? b.keyboard.type(wb[i]) : null]);
  }
  await expect(a.locator('.rt.editing')).toHaveText('Neue Bar am Eingang');
  await expect(b.locator('.rt.editing')).toHaveText('Neue Bar am Eingang');
  await expect(a.locator(`.rt-caret[data-name="${JONAS}"]`)).toBeVisible();
  await shot(a, 'gleichzeitig');
  await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  await expect(stickies(b).nth(1)).toHaveText('Neue Bar am Eingang');
});

test('Kommentar mit @Erwähnung: Jonas bekommt den Hinweis', async () => {
  await a.keyboard.press('Escape');
  await a.keyboard.press('c');
  const p = await centerOf(a, '[data-type="sticky"]', 0);
  await a.mouse.click(p.x + 30, p.y - 30);
  const input = a.getByRole('textbox', { name: 'Kommentar', exact: true });
  await expect(input).toBeFocused();
  await input.pressSequentially('Passt das so @jo');
  await expect(a.getByRole('option', { name: new RegExp(JONAS) })).toBeVisible();
  await a.keyboard.press('Enter');
  await expect(input).toHaveValue(`Passt das so @${JONAS} `);
  await input.pressSequentially('?');
  await a.keyboard.press('Enter');
  await expect(a.locator('.collab-pin[data-thread]')).toHaveCount(1);
  await a.keyboard.press('Escape');
  await a.keyboard.press('v');

  const notice = b.getByRole('status', { name: 'Du wurdest erwähnt' });
  await expect(notice).toBeVisible();
  await expect(b.getByTestId('comment-count')).toHaveText('@');
  await b.waitForTimeout(400); // Einblenden abwarten
  await shot(b, 'erwaehnung');
  await notice.getByRole('button', { name: 'Ansehen' }).click();
  const thread = b.getByRole('dialog', { name: 'Kommentar' });
  await expect(thread.locator('.collab-mention.is-me')).toHaveText(`@${JONAS}`);
  await b.keyboard.press('Escape');
  await expect(b.getByTestId('comment-count')).toHaveText('1');
});

test('Abstimmung: Mara startet, beide stimmen, Ergebnis', async () => {
  await a.getByRole('button', { name: 'Abstimmung starten' }).click();
  const dlg = a.getByRole('dialog', { name: 'Abstimmung starten' });
  await dlg.getByLabel('Worum geht es?').fill('Was zuerst?');
  await dlg.getByRole('button', { name: 'Abstimmung starten' }).click();
  await expect(b.getByRole('region', { name: 'Abstimmung' })).toContainText('Was zuerst?');

  // beide stimmen für die zweite Notiz, Jonas zusätzlich für die erste
  await b.locator('[data-vote]').nth(1).click();
  await b.locator('[data-vote]').nth(0).click();
  await a.locator('[data-vote]').nth(1).click();
  await expect(b.getByTestId('votes-left')).toHaveAttribute('aria-label', '1 von 3 Stimmen übrig');
  await shot(b, 'abstimmung');
  await a.getByRole('region', { name: 'Abstimmung' }).getByRole('button', { name: 'Beenden' }).click();
  for (const p of [a, b]) {
    const res = p.getByRole('dialog', { name: 'Ergebnis' });
    await expect(res.locator('.collab-rank li')).toHaveText([/Neue Bar am Eingang.*2$/, /Bühne Nord.*1$/]);
  }
  await shot(a, 'abstimmung-ergebnis');
  // Mara (Starterin) schließt die Abstimmung, bei Jonas bleibt das Ergebnis bis „Fertig“ stehen
  await a.getByRole('button', { name: 'Abstimmung schließen' }).click();
  await expect(b.getByRole('region', { name: 'Abstimmung' })).toHaveCount(0);
  await b.getByRole('dialog', { name: 'Ergebnis' }).getByRole('button', { name: 'Fertig' }).click();
  await expect(b.getByRole('dialog', { name: 'Ergebnis' })).toHaveCount(0);
});

test('Timer für alle', async () => {
  await a.getByTestId('timer').click();
  const pop = a.getByRole('dialog', { name: 'Timer' });
  await pop.getByRole('button', { name: '5 Min.', exact: true }).click();
  await pop.getByRole('button', { name: 'Für alle starten' }).click();
  await expect(b.getByTestId('timer')).toHaveText(/^(5:00|4:[0-5]\d)/);
  await a.keyboard.press('Escape');
  await shot(b, 'timer');
});

test('Cursor-Chat: Mara tippt am Mauszeiger, Jonas liest live mit', async () => {
  await a.mouse.move(760, 520);
  await a.mouse.move(780, 540);
  await a.getByTestId('board').focus();
  await a.keyboard.press('/');
  await a.getByRole('textbox', { name: 'Nachricht am Mauszeiger' }).pressSequentially('Hier kommt die Bar hin');
  await expect(b.locator(`.collab-cchat[data-chat="${MARA}"] .collab-cchat__text`)).toHaveText('Hier kommt die Bar hin');
  await shot(b, 'cursor-chat');
  await a.keyboard.press('Enter');
  await expect(b.locator(`.collab-cchat[data-chat="${MARA}"]`)).toHaveCount(0, { timeout: 10_000 });
});

test('Folgen: Jonas folgt Mara, ihre Ansicht bewegt seine', async () => {
  await b.getByTestId('presence').getByTitle(`${MARA} – hinspringen und folgen`).click();
  await expect(b.getByRole('status').filter({ hasText: `Du folgst ${MARA}` })).toBeVisible();
  await expect(b.locator('.collab-follow-frame')).toHaveCount(1);
  const before = (await stickies(b).first().boundingBox())!;
  // Mara schiebt die Ansicht 200 px nach links
  await a.mouse.move(640, 600);
  await a.mouse.wheel(200, 0);
  await expect.poll(async () => Math.round((await stickies(b).first().boundingBox())!.x - before.x), { timeout: 10_000 }).toBeLessThan(-150);
  await shot(b, 'folgen');
  // eigene Geste beendet das Folgen
  await b.mouse.click(860, 560);
  await expect(b.locator('.collab-follow-frame')).toHaveCount(0);
});

test('Bild-Upload: Jonas lädt hoch, Mara sieht das Bild', async () => {
  // kleiner Lageplan als Testbild (im Browser gezeichnet, keine Datei im Repo)
  const pic = await a.context().newPage();
  await pic.setViewportSize({ width: 240, height: 160 });
  await pic.setContent(`<body style="margin:0;background:#c9e14a;font:700 20px sans-serif">
    <div style="position:absolute;left:14px;top:14px;width:110px;height:60px;background:#0a0a0a;color:#fff;display:grid;place-items:center">Bühne</div>
    <div style="position:absolute;right:14px;bottom:14px;width:80px;height:50px;background:#ec4e92;color:#fff;display:grid;place-items:center">Bar</div>
    <div style="position:absolute;left:14px;bottom:14px;width:60px;height:60px;border-radius:50%;background:#1763b5"></div></body>`);
  const png = await pic.screenshot();
  await pic.close();
  await b.getByTestId('image-input').setInputFiles({ name: 'lageplan.png', mimeType: 'image/png', buffer: png });
  const img = a.locator('[data-type="image"] img');
  await expect(img).toHaveAttribute('src', /\/api\/images\//, { timeout: 20_000 });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(240);
});

test('Neuladen und Server-Neustart: alles ist noch da', async () => {
  // offene Änderungen sind übertragen, sobald der Status „Live“ zeigt; Neustart speichert (SIGTERM)
  await a.waitForTimeout(500);
  await server.restart();
  for (const p of [a, b]) {
    await p.reload();
    await expect(p.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
    await expect(stickies(p)).toHaveCount(2);
    await expect(stickies(p).first().locator('strong')).toHaveText('Nord');
    await expect(stickies(p).first().locator('u')).toHaveText('Nord');
    await expect(stickies(p).nth(1)).toHaveText('Neue Bar am Eingang');
    await expect(p.locator('.collab-pin[data-thread]')).toHaveCount(1);
    await expect.poll(() => p.locator('[data-type="image"] img').evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 20_000 }).toBe(240);
    await expect(p.getByTestId('timer')).toHaveText(/^\d:\d\d/);
  }
  // Abstimmung im Archiv
  await a.getByRole('button', { name: 'Board-Menü' }).click();
  await a.getByRole('menuitem', { name: 'Frühere Abstimmungen' }).click();
  await expect(a.getByRole('dialog', { name: 'Ergebnis' })).toContainText('Was zuerst?');
  await a.keyboard.press('Escape');
  await shot(a, 'nach-neustart');
  // Board-Titel und Übersicht
  await a.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(a.getByText('Festival-Planung')).toBeVisible();
  await shot(a, 'uebersicht');
});

test('Abmelden', async () => {
  // Vorschaubilder (localStorage) sind nach dem Abmelden weg (docs/legal CR-11); andere Einstellungen bleiben
  await a.evaluate(() => {
    localStorage.setItem('stachel:thumb:fremd', 'data:image/png;base64,AA');
    localStorage.setItem('stachel:thumbs', '["fremd"]');
    localStorage.setItem('stachel.wheel', 'zoom');
  });
  await a.getByRole('button', { name: 'Abmelden' }).click();
  await expect(a.getByRole('heading', { name: 'Benutzername & Passwort' })).toBeVisible();
  expect(await a.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('stachel:thumb')))).toEqual([]);
  expect(await a.evaluate(() => localStorage.getItem('stachel.wheel'))).toBe('zoom');
  await a.reload();
  await expect(a.getByRole('heading', { name: 'Benutzername & Passwort' })).toBeVisible();
  // die Sitzung ist auch serverseitig weg
  const me = await a.request.get('/api/auth/me');
  expect(me.status()).toBe(401);
  // Jonas ist weiter angemeldet
  expect((await b.request.get('/api/auth/me')).status()).toBe(200);
});
