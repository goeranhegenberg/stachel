// Modus local (STACHEL_AUTH=local, eigene Konten) gegen den ECHTEN Server, Mails im Mail-Log statt Versand:
// Registrieren (Captcha im Browser) → Bestätigungslink aus dem Log → anmelden → Board anlegen → mit zweiter Person
// teilen („Kann ansehen“) → sie sieht es unter „Mit mir geteilt“, kann aber nichts ändern → Rolle auf „Bearbeiten“ →
// jetzt geht es. Dazu Konto-Seite und Handy. Screenshots: docs/screenshots/accounts-*.png.
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { solveCaptcha } from '../../server/src/captcha';
import { SHOTS } from '../support/paths';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

const PORT = Number(process.env.E2E_ACCOUNTS_PORT ?? 8696);
const PW = 'Kaktusblüte-im-Mai';
let server: StachelServer;
let dataDir: string;
const pages: Page[] = [];
let mara: Page;
let jonas: Page;
let boardId = '';

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `accounts-${name}.png`), animations: 'disabled' });

interface Mail {
  to: string;
  subject: string;
  text: string;
}
const mails = (): Mail[] => {
  const f = path.join(dataDir, 'mail.log');
  return fs.existsSync(f)
    ? fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
};
async function mailTo(to: string, subject: RegExp): Promise<Mail> {
  let hit: Mail | undefined;
  await expect.poll(() => (hit = mails().find((m) => m.to === to && subject.test(m.subject))) !== undefined, { timeout: 10_000 }).toBe(true);
  return hit!;
}
const linkIn = (m: Mail) => /(http:\/\/127\.0\.0\.1:\d+\/(?:\?|verify\/|reset\/)[^\s]+)/.exec(m.text)![1]!;

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-accounts-'));
  server = new StachelServer(PORT, dataDir, 'http://127.0.0.1:9', path.join(import.meta.dirname, '../test-results/server-accounts.log'), {
    STACHEL_AUTH: 'local',
    STACHEL_BRAND: 'Stachel · INTSODE',
    STACHEL_MAIL_MODE: 'log',
    STACHEL_IMPRINT_URL: 'https://example.org/impressum',
    STACHEL_PRIVACY_URL: 'https://example.org/datenschutz',
    STACHEL_TERMS_URL: 'https://example.org/nutzungsbedingungen',
    STACHEL_CAPTCHA_MAX: '20000',
  });
  await server.start();
  // Jonas registriert sich über die API (wie ein Browser: Captcha lösen, Link aus der Mail)
  const c = await (await fetch(`${server.url}/api/auth/captcha`)).json();
  const r = await fetch(`${server.url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stachel': '1' },
    body: JSON.stringify({ name: 'Jonas Keller', email: 'jonas@example.org', password: PW, terms: true, captcha: solveCaptcha(c) }),
  });
  expect(r.status).toBe(200);
  const token = /verify[=/]([\w-]+)/.exec((await mailTo('jonas@example.org', /bestätigen/)).text)![1];
  expect((await fetch(`${server.url}/api/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Stachel': '1' }, body: JSON.stringify({ token }) })).status).toBe(200);
});

test.afterAll(async () => {
  for (const p of pages) await p.context().close();
  await server?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

async function newPage(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: server.url, viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const p = await ctx.newPage();
  pages.push(p);
  return p;
}

async function login(p: Page, email: string) {
  await p.goto('/');
  await p.getByLabel('E-Mail-Adresse').fill(email);
  await p.getByLabel('Passwort', { exact: true }).fill(PW);
  await p.getByRole('button', { name: 'Anmelden', exact: true }).last().click();
  await expect(p.getByRole('button', { name: 'Neues Board' })).toBeVisible();
}

test('Anmeldeseite im Modus local: Instanzname, kein QR, Impressum/Datenschutz', async ({ browser }) => {
  mara = await newPage(browser);
  await mara.goto('/');
  await expect(mara.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await expect(mara.getByText('Stachel · INTSODE').first()).toBeVisible();
  await expect(mara.getByTestId('qr-card')).toHaveCount(0);
  await expect(mara.getByText(/Organisation/)).toHaveCount(0);
  const footer = mara.getByTestId('legal-footer');
  await expect(footer.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', 'https://example.org/impressum');
  await expect(footer.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute('href', 'https://example.org/datenschutz');
  await expect(footer.getByRole('link', { name: 'Nutzungsbedingungen' })).toHaveAttribute('href', 'https://example.org/nutzungsbedingungen');
  // Lizenzen der mitgelieferten Software (beim Build erzeugt, docs/legal CR-4)
  const lic = await mara.request.get(await footer.getByRole('link', { name: 'Lizenzen' }).getAttribute('href').then((h) => new URL(h!, mara.url()).toString()));
  expect(lic.status()).toBe(200);
  expect(await lic.text()).toContain('Liberation');
  await shot(mara, 'login');
});

test('Registrieren mit Captcha → Bestätigungslink aus dem Mail-Log → anmelden', async () => {
  await mara.getByRole('tab', { name: 'Registrieren' }).click();
  await mara.getByLabel('Name').click();
  await mara.keyboard.type('Mara Lindner');
  await mara.getByLabel('E-Mail-Adresse').click();
  await mara.keyboard.type('mara@example.org');
  await mara.getByLabel('Passwort', { exact: true }).click();
  await mara.keyboard.type('zu kurz');
  await expect(mara.getByText('Noch 3 Zeichen')).toBeVisible();
  await mara.keyboard.press('Control+a');
  await mara.keyboard.type(PW);
  await expect(mara.getByTestId('captcha-state')).toContainText('Sicherheitsprüfung erledigt', { timeout: 20_000 });
  // Datenschutz nur als Hinweis-Link, Pflicht-Häkchen = Nutzungsbedingungen + 18 (docs/legal CR-1)
  await expect(mara.getByTestId('register-privacy-note').getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute('href', 'https://example.org/datenschutz');
  await expect(mara.getByRole('checkbox')).toHaveCount(1);
  await mara.getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(mara.getByTestId('login-error')).toContainText('Nutzungsbedingungen');
  await mara.getByRole('checkbox', { name: /Nutzungsbedingungen und bin mindestens 18 Jahre alt/ }).check();
  await shot(mara, 'registrieren');
  await mara.getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(mara.getByTestId('register-sent')).toContainText('mara@example.org');

  const link = linkIn(await mailTo('mara@example.org', /bestätigen/));
  await mara.goto(link);
  await expect(mara.getByTestId('login-info')).toContainText('E-Mail-Adresse bestätigt');
  // Token ist aus der Adresszeile entfernt
  expect(mara.url()).not.toContain('verify=');
  await expect(mara.getByLabel('E-Mail-Adresse')).toHaveValue('mara@example.org');
  await mara.getByLabel('Passwort', { exact: true }).fill(PW);
  await mara.getByRole('button', { name: 'Anmelden', exact: true }).last().click();
  await expect(mara.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  await expect(mara.getByTestId('user-name')).toHaveText('Mara Lindner');
});

test('Board anlegen und mit Jonas teilen („Kann ansehen“)', async () => {
  await mara.getByRole('button', { name: 'Neues Board' }).click();
  await mara.getByRole('dialog', { name: 'Neues Board' }).getByLabel('Name').fill('Sommerfest');
  await mara.getByRole('dialog', { name: 'Neues Board' }).getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(mara).toHaveURL(/\?b=[\w-]+$/);
  boardId = new URL(mara.url()).searchParams.get('b')!;
  await expect(mara.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await mara.keyboard.press('n');
  await mara.mouse.click(520, 380);
  await expect(mara.locator('.rt.editing')).toBeFocused();
  await mara.keyboard.type('Bühne Nord');
  await mara.keyboard.press('Escape');
  await expect(mara.locator('[data-type="sticky"]')).toHaveCount(1);

  await mara.getByTestId('share-open').click();
  const dlg = mara.getByTestId('share-dialog');
  await expect(dlg.getByTestId('share-people')).toContainText('Mara Lindner (du)');
  await dlg.getByPlaceholder('E-Mail-Adressen, mit Komma getrennt').fill('jonas@example.org, neu@example.org');
  await dlg.getByLabel('Rolle für die Einladung').selectOption('view');
  await dlg.getByRole('button', { name: 'Einladen' }).click();
  await expect(dlg.getByTestId('share-people')).toContainText('Jonas Keller');
  await expect(dlg.getByTestId('share-people')).toContainText('neu@example.org');
  await expect(dlg.getByLabel('Rolle von Jonas Keller')).toHaveValue('view');
  await shot(mara, 'teilen');
  await mailTo('jonas@example.org', /geteilt/);
  await mailTo('neu@example.org', /eingeladen/);
  await dlg.getByRole('button', { name: 'Fertig' }).click();
});

test('Jonas sieht das Board unter „Mit mir geteilt“ und kann es nur ansehen', async ({ browser }) => {
  jonas = await newPage(browser);
  await login(jonas, 'jonas@example.org');
  await jonas.getByTestId('owner-filter').getByRole('button', { name: 'Mit mir geteilt' }).click();
  const card = jonas.locator('.board-card', { hasText: 'Sommerfest' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('board-role')).toHaveText('Kann ansehen');
  await jonas.getByTestId('owner-filter').getByRole('button', { name: 'Meine Boards' }).click();
  await expect(jonas.locator('.board-card', { hasText: 'Sommerfest' })).toHaveCount(0);
  await jonas.getByTestId('owner-filter').getByRole('button', { name: 'Alle' }).click();
  await shot(jonas, 'geteilt-uebersicht');

  await jonas.locator('.board-card', { hasText: 'Sommerfest' }).locator('.board-card__link').click();
  await expect(jonas.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await expect(jonas.getByTestId('role-badge')).toHaveText('Nur ansehen');
  await expect(jonas.locator('[data-type="sticky"]')).toContainText('Bühne Nord');
  await expect(jonas.locator('.toolbar')).toBeHidden();
  // Versuche zu bearbeiten: Kürzel, Doppelklick, Löschen, Einfügen
  await jonas.keyboard.press('n');
  await jonas.mouse.click(800, 420);
  await jonas.mouse.dblclick(900, 300);
  const note = jonas.locator('[data-type="sticky"]').first();
  const box = (await note.boundingBox())!;
  await jonas.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await jonas.keyboard.press('Delete');
  await jonas.keyboard.press('Control+d');
  await jonas.waitForTimeout(800);
  await expect(jonas.locator('[data-type="sticky"]')).toHaveCount(1);
  await expect(mara.locator('[data-type="sticky"]')).toHaveCount(1);
  await expect(mara.locator('[data-type="sticky"]')).toContainText('Bühne Nord');
  await shot(jonas, 'nur-ansehen');
});

test('Rolle „Kann kommentieren“: nur Kommentare, @-Liste nur mit Personen mit Zugriff', async () => {
  await mara.getByTestId('share-open').click();
  const dlg = mara.getByTestId('share-dialog');
  await dlg.getByLabel('Rolle von Jonas Keller').selectOption('comment');
  await expect(dlg.getByLabel('Rolle von Jonas Keller')).toHaveValue('comment');
  await dlg.getByRole('button', { name: 'Fertig' }).click();

  await expect(jonas.getByTestId('role-badge')).toHaveText('Kommentieren', { timeout: 20_000 });
  await expect(jonas.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await jonas.getByTestId('comment-tool').click();
  await jonas.mouse.click(860, 260);
  const input = jonas.getByRole('textbox', { name: 'Kommentar', exact: true });
  await expect(input).toBeFocused();
  await input.pressSequentially('Passt so @');
  // nur Personen mit Zugriff (nicht die offene Einladung, niemand Fremdes)
  await expect(jonas.getByRole('listbox', { name: 'Personen erwähnen' })).toBeVisible();
  await expect(jonas.getByRole('option')).toHaveText([/Mara Lindner$/]);
  await jonas.keyboard.press('Escape');
  await input.pressSequentially('!');
  await jonas.keyboard.press('Enter');
  await expect(mara.locator('.collab-pin[data-thread]')).toHaveCount(1, { timeout: 10_000 });
  await shot(jonas, 'kommentieren');
  // Notizen bleiben unangetastet
  await jonas.keyboard.press('Escape');
  await jonas.keyboard.press('n');
  await jonas.mouse.click(300, 600);
  await jonas.waitForTimeout(500);
  await expect(mara.locator('[data-type="sticky"]')).toHaveCount(1);
});

test('Rolle auf „Kann bearbeiten“: Jonas verbindet neu und kann jetzt schreiben', async () => {
  await mara.getByTestId('share-open').click();
  const dlg = mara.getByTestId('share-dialog');
  await dlg.getByLabel('Rolle von Jonas Keller').selectOption('edit');
  await expect(dlg.getByLabel('Rolle von Jonas Keller')).toHaveValue('edit');
  await dlg.getByRole('button', { name: 'Fertig' }).click();

  await expect(jonas.getByTestId('role-badge')).toHaveCount(0, { timeout: 20_000 });
  await expect(jonas.locator('.toolbar')).toBeVisible();
  await expect(jonas.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await jonas.keyboard.press('Escape');
  await jonas.keyboard.press('n');
  await jonas.mouse.click(760, 520);
  await expect(jonas.locator('.rt.editing')).toBeFocused();
  await jonas.keyboard.type('Catering');
  await jonas.keyboard.press('Escape');
  await expect(mara.locator('[data-type="sticky"]')).toHaveCount(2);
  await expect(mara.locator('[data-type="sticky"]', { hasText: 'Catering' })).toBeVisible();
});

test('Fremde ohne Einladung: kein Zugriff, auch nicht per Adresse', async ({ browser }) => {
  // dritte Person registriert sich über die API
  const c = await (await fetch(`${server.url}/api/auth/captcha`)).json();
  await fetch(`${server.url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stachel': '1' },
    body: JSON.stringify({ name: 'Sven Fremd', email: 'sven@example.org', password: PW, terms: true, captcha: solveCaptcha(c) }),
  });
  const token = /verify[=/]([\w-]+)/.exec((await mailTo('sven@example.org', /bestätigen/)).text)![1];
  await fetch(`${server.url}/api/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Stachel': '1' }, body: JSON.stringify({ token }) });
  const sven = await newPage(browser);
  await login(sven, 'sven@example.org');
  await expect(sven.locator('.board-card', { hasText: 'Sommerfest' })).toHaveCount(0);
  await sven.goto(`/?b=${boardId}`);
  await expect(sven.getByRole('alertdialog')).toContainText(/nicht \(mehr\) mit dir geteilt|gibt es nicht/);
  await shot(sven, 'kein-zugriff');
});

test('Konto-Seite: Name ändern, Fußzeile', async () => {
  await mara.goto('/');
  await mara.getByTestId('account-link').click();
  await expect(mara.getByRole('heading', { name: 'Dein Konto' })).toBeVisible();
  await expect(mara.getByTestId('account-email')).toContainText('mara@example.org');
  await mara.getByRole('textbox', { name: 'Name' }).fill('Mara L.');
  await mara.getByRole('button', { name: 'Speichern' }).click();
  await expect(mara.getByText('Name gespeichert.')).toBeVisible();
  await shot(mara, 'konto');
  // Meine Daten herunterladen (Art. 20 DSGVO, docs/legal CR-8)
  const dl = mara.waitForEvent('download');
  await mara.getByTestId('account-export').click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^stachel-daten-\d{4}-\d{2}-\d{2}\.zip$/);
  expect(fs.readFileSync((await file.path())!).subarray(0, 2).toString()).toBe('PK');
  await mara.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(mara.getByTestId('user-name')).toHaveText('Mara L.');
});

test('Handy: Anmeldung, Übersicht und Teilen-Dialog', async ({ browser }) => {
  const phone = await newPage(browser, { width: 390, height: 844 });
  await phone.goto('/');
  await expect(phone.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  // Formular zuerst, nichts ragt über den Rand
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(phone, 'handy-login');
  await phone.getByRole('tab', { name: 'Registrieren' }).click();
  await shot(phone, 'handy-registrieren');
  await phone.getByRole('tab', { name: 'Anmelden' }).click();
  await login(phone, 'jonas@example.org');
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(phone, 'handy-uebersicht');
  await phone.locator('.board-card', { hasText: 'Sommerfest' }).locator('.board-card__link').click();
  await expect(phone.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await phone.getByTestId('share-open').click();
  await expect(phone.getByTestId('share-dialog')).toBeVisible();
  await shot(phone, 'handy-teilen');
});
