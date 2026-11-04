import { expect, test, type Page } from '@playwright/test';
import { installFakeApi, sampleBoards } from './fakeApi';

test.describe('Anmeldung', () => {
  test('zeigt QR-Code und meldet mit Passwort an (inkl. Fehlertexte)', async ({ page }) => {
    const state = await installFakeApi(page);
    await page.goto('/');
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toBeVisible();
    await expect(page.getByText(/Neuer Code in 1:5\d/)).toBeVisible();

    await page.getByLabel('Benutzername', { exact: true }).fill('orga');
    await page.getByLabel('Passwort', { exact: true }).fill('falsch');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByTestId('login-error')).toHaveText('Benutzername oder Passwort stimmt nicht.');
    await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('');

    await page.getByLabel('Benutzername', { exact: true }).fill('wartend');
    await page.getByLabel('Passwort', { exact: true }).fill('x');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByTestId('login-error')).toHaveText('Dein Konto bei Musterverein wartet noch auf Freigabe.');

    await page.getByLabel('Benutzername', { exact: true }).fill('orga');
    await page.getByLabel('Passwort', { exact: true }).fill('geheim');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible();
    await expect(page.getByTestId('user-name')).toContainText('Mara Lindner');
    expect(state.csrfMissing).toBe(0);
  });

  test('Rate-Limit wird verständlich angezeigt', async ({ page }) => {
    const state = await installFakeApi(page);
    state.wrongPasswords = 3;
    await page.goto('/');
    await page.getByLabel('Benutzername', { exact: true }).fill('orga');
    await page.getByLabel('Passwort', { exact: true }).fill('egal');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByTestId('login-error')).toContainText('Zu viele Versuche');
  });

  test('QR-Bestätigung in der App meldet den Browser an', async ({ page }) => {
    const state = await installFakeApi(page);
    await page.goto('/');
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toBeVisible();
    state.approveNext = true;
    await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible({ timeout: 10_000 });
  });

  test('QR-Code erneuert sich nach Ablauf und bei fremdem Browser', async ({ page }) => {
    const state = await installFakeApi(page, { qrTtlMs: 1500 });
    await page.goto('/');
    await expect.poll(() => state.qrStarts, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    state.qrError = 'wrong_browser';
    await expect(page.getByRole('status').filter({ hasText: 'anderen Browserfenster' })).toBeVisible();
    state.qrError = null;
  });
});

test.describe('Board-Übersicht', () => {
  test('Liste, anlegen, umbenennen, löschen, abmelden', async ({ page }) => {
    const state = await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    await page.goto('/');
    const titles = page.locator('.board-card__title');
    await expect(titles).toHaveCount(5);
    await expect(titles.first()).toHaveText('Festival · Ablauf');
    await expect(titles.last()).toHaveText('Retro Sommerfest 2026');
    await expect(page.locator('.board-card__meta').first()).toContainText('vor 4 Min.');

    // umbenennen
    await page.locator('.board-card').nth(1).getByRole('button', { name: 'Board-Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Umbenennen' }).click();
    await page.getByLabel('Name').fill('Lageplan Gelände v2');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(titles.first()).toHaveText('Lageplan Gelände v2'); // jetzt zuletzt geändert

    // löschen: erst abbrechen, dann bestätigen
    await page.locator('.board-card').first().getByRole('button', { name: 'Board-Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Löschen' }).click();
    await expect(page.getByRole('dialog', { name: 'Board löschen?' })).toContainText('Lageplan Gelände v2');
    await page.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(titles).toHaveCount(5);
    await page.locator('.board-card').first().getByRole('button', { name: 'Board-Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Löschen' }).click();
    await page.getByRole('button', { name: 'In den Papierkorb' }).click();
    await expect(titles).toHaveCount(4);
    expect(state.boards.some((b) => b.title === 'Lageplan Gelände v2')).toBe(false);
    // Papierkorb (pages/trash.tsx): Rückgängig-Hinweis, Board liegt im Papierkorb
    await expect(page.getByTestId('undo-toast')).toContainText('Board gelöscht');
    expect(state.trash.map((b) => b.title)).toEqual(['Lageplan Gelände v2']);
    await expect(page.getByTestId('trash-count')).toHaveText('1');

    // neues Board → Editor mit Titel, zurück
    await page.getByRole('button', { name: 'Neues Board' }).click();
    await page.getByLabel('Name').fill('Awareness-Konzept');
    await page.getByRole('button', { name: 'Anlegen' }).click();
    await expect(page).toHaveURL(/\?b=b1$/);
    await expect(page.getByTestId('board-title')).toHaveText('Awareness-Konzept');
    await expect(page.getByTestId('status')).toBeVisible();
    await page.getByRole('button', { name: 'Zur Übersicht' }).click();
    await expect(titles.first()).toHaveText('Awareness-Konzept');

    // abmelden
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await expect(page.getByRole('heading', { name: 'Benutzername & Passwort' })).toBeVisible();
  });

  test('leere Liste zeigt Einstieg', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: [] });
    await page.goto('/');
    await expect(page.getByText('Noch keine Boards.')).toBeVisible();
  });
});

test.describe('Board-Übersicht: Suche, Fehler, Dialoge, Menü', () => {
  const cardTitles = (page: Page) => page.locator('.board-card__title');

  test('Suche (Umlaute, Ersteller), Tastenkürzel, keine Treffer, Reihenfolge', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    await page.goto('/');
    await expect(cardTitles(page)).toHaveCount(5);
    const search = page.getByRole('searchbox', { name: 'Boards durchsuchen' });

    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await search.fill('gelaende');
    await expect(cardTitles(page)).toHaveText(['Lageplan Gelände']);
    await expect(page.locator('.board-card__title mark')).toHaveText('Gelände');

    await search.fill('IDA');
    await expect(cardTitles(page)).toHaveText(['Ideen-Pool']);
    await expect(page.locator('.board-card__meta mark')).toHaveText('Ida');

    await search.fill('xyz');
    await expect(page.getByTestId('no-hit')).toContainText('Kein Board passt zu „xyz“');
    await page.getByRole('button', { name: 'Suche löschen' }).click();
    await expect(cardTitles(page)).toHaveCount(5);
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');

    await page.locator('h1').click();
    await page.keyboard.press('Control+k');
    await expect(search).toBeFocused();
    await search.fill('festival');
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');

    await page.getByRole('radio', { name: 'Name' }).click();
    await expect(cardTitles(page)).toHaveText(['Festival · Ablauf', 'Helfer-Schichten', 'Ideen-Pool', 'Lageplan Gelände', 'Retro Sommerfest 2026']);
    await page.getByRole('radio', { name: 'Von mir' }).click();
    await expect(cardTitles(page)).toHaveText(['Festival · Ablauf', 'Helfer-Schichten', 'Lageplan Gelände', 'Ideen-Pool', 'Retro Sommerfest 2026']);
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Von mir' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Zuletzt geändert' }).click();
    await expect(cardTitles(page).first()).toHaveText('Festival · Ablauf');
    await expect(cardTitles(page).nth(1)).toHaveText('Lageplan Gelände');
  });

  test('Fehler: Nochmal versuchen, Liste bleibt beim Neuladen stehen, Netzfehler wird wiederholt', async ({ page }) => {
    await page.clock.install();
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    let mode: 'ok' | 'server' | 'network' = 'server';
    let calls = 0;
    await page.route('**/api/boards', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      calls++;
      if (mode === 'server') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"server","message":"kaputt"}' });
      if (mode === 'network') return route.abort('internetdisconnected');
      return route.fallback();
    });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('Der Server hat gerade ein Problem');
    mode = 'ok';
    await page.getByRole('button', { name: 'Nochmal versuchen' }).click();
    await expect(cardTitles(page)).toHaveCount(5);
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Fokus-Neuladen schlägt fehl → Liste bleibt, kleiner Hinweis
    mode = 'server';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Liste gerade nicht aktuell')).toBeVisible();
    await expect(cardTitles(page)).toHaveCount(5);
    mode = 'ok';
    await page.locator('.boards-stale__retry').click();
    await expect(page.getByText('Liste gerade nicht aktuell')).toHaveCount(0);

    // Netzfehler beim ersten Laden → alle 10 s neuer Versuch
    mode = 'network';
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Keine Verbindung zum Stachel-Server');
    await expect(page.getByRole('alert')).toContainText('alle 10 Sekunden');
    const before = calls;
    mode = 'ok';
    await page.clock.runFor(10_500);
    await expect(cardTitles(page)).toHaveCount(5);
    expect(calls).toBeGreaterThan(before);
  });

  test('Dialog: Fokusfalle, Hintergrund gesperrt, Neuladen überschreibt den Namen nicht', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    await page.goto('/');
    await expect(cardTitles(page)).toHaveCount(5);
    const newBtn = page.getByRole('button', { name: 'Neues Board' });
    await newBtn.click();
    const dialog = page.getByRole('dialog', { name: 'Neues Board' });
    const name = dialog.getByLabel('Name');
    await expect(name).toBeFocused();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');

    const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await inDialog()).toBe(true);
    }
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Anlegen' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();

    await name.fill('Abc');
    await name.press('End');
    // Fensterfokus lädt die Liste neu → darf den Dialog nicht neu fokussieren/markieren
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(300);
    await page.keyboard.type('Def');
    await expect(name).toHaveValue('AbcDef');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
    await expect(newBtn).toBeFocused();
  });

  test('Board-Menü per Tastatur, Grund fürs gesperrte Löschen sichtbar', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), user: { key: 'm:99', name: 'Gast Gärtner', isOrga: false } });
    await page.goto('/');
    await expect(cardTitles(page)).toHaveCount(5);
    const btn = page.locator('.board-card').first().getByRole('button', { name: 'Board-Aktionen' });
    await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    await btn.focus();
    await page.keyboard.press('Enter');
    const rename = page.getByRole('menuitem', { name: 'Umbenennen' });
    const del = page.getByRole('menuitem', { name: 'Löschen' });
    await expect(rename).toBeFocused();
    // dazwischen Duplizieren / Als Vorlage speichern (Modul tools); End springt ans Ende
    await page.keyboard.press('End');
    await expect(del).toBeFocused();
    await expect(del).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.board-menu__reason')).toHaveText('Nur wer es angelegt hat oder zur Orga gehört.');
    await page.keyboard.press('ArrowDown');
    await expect(rename).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(del).toBeFocused();
    await page.keyboard.press('Enter'); // gesperrt: nichts passiert
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(btn).toBeFocused();

    await page.keyboard.press('ArrowDown'); // öffnet wieder
    await expect(rename).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(btn).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(rename).toBeFocused();
    await page.keyboard.press('Enter'); // Umbenennen
    await expect(page.getByRole('dialog', { name: 'Umbenennen' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(btn).toBeFocused();
  });

  test('Vorschaubild zeigt den zuletzt gesehenen Inhalt', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    await page.goto('/');
    await expect(cardTitles(page)).toHaveCount(5);
    await expect(page.getByTestId('board-thumb-img')).toHaveCount(0);
    await page.evaluate(async () => {
      const path = '/src/ui/thumbs.ts';
      const m = await import(/* @vite-ignore */ path);
      const o = (id: string, type: string, x: number, y: number, w: number, h: number, extra = {}) => ({ id, type, x, y, w, h, z: 'a0', createdBy: 'm:1', updatedAt: '', ...extra });
      const objs = [
        o('f', 'frame', 0, 0, 900, 420, { title: 'Ablauf' }),
        o('a', 'sticky', 40, 60, 200, 200, { color: '#ffb3d1', text: 'Bühne' }),
        o('b', 'sticky', 300, 60, 200, 200, { color: '#c9e14a', text: 'Bar' }),
        o('c', 'shape', 600, 90, 220, 140, { shape: 'diamond', color: '#9fd3ff' }),
        o('k', 'connector', 0, 0, 0, 0, { from: { objectId: 'a' }, to: { objectId: 'c' } }),
      ];
      m.saveThumb('b-plan', m.renderThumb(objs));
    });
    await page.reload();
    await expect(page.getByTestId('board-thumb-img')).toHaveCount(1);
    const img = page.locator('.board-card').first().getByTestId('board-thumb-img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(560);
  });
});
