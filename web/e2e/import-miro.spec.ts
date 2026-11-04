// Import aus Miro (features/import, docs/features/import.md): ganzer Ablauf im Browser gegen eine gemockte Import-API
// (page.route) – Token → Boards → Fortschritt → Bericht, Rückkehr von der Miro-Freigabeseite, Fehlerfälle.
// Screenshots der Schritte (Rechner und Handy) nach $STACHEL_SHOTS, sonst in den Test-Ausgabeordner.
import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import type { ImportJob, ImportReport, ImportSources } from '../../shared/import';
import { installFakeApi, sampleBoards, type FakeBoard } from './fakeApi';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const GOOD_TOKEN = 'eyJtaXJvLnRva2VuIjoiZ3V0In0_gut';

async function shot(page: Page, name: string) {
  const dir = process.env.STACHEL_SHOTS ?? test.info().outputPath();
  await page.waitForTimeout(250); // Animationen (Dialog, Balken) auslaufen lassen
  await page.screenshot({ path: path.join(dir, `import-${name}.png`) });
}

const REPORT: ImportReport = {
  imported: { sticky: 42, shape: 12, text: 9, connector: 15, frame: 3, image: 4, mindnode: 7 },
  adjusted: [
    { code: 'sticky_color', text: 'Notizfarben an die Stachel-Palette angepasst', count: 18 },
    { code: 'mindmap_layout', text: 'Mindmap neu angeordnet', count: 1 },
  ],
  skipped: [
    { code: 'connector_no_target', text: 'Verbinder ohne Ziel', count: 1 },
    { code: 'image_quota', text: 'Bilder über dem Speicherplatz', count: 2 },
  ],
  notes: ['Tabellen, Kommentare, Freihand-Zeichnungen, Kanban und Zeitleisten gibt Miro über seine Schnittstelle nicht heraus.'],
};

/** Fortschritt eines Jobs je Abfrage (eine Stufe pro GET). */
const TICKS: Pick<ImportJob, 'status' | 'phase' | 'done' | 'total'>[] = [
  { status: 'queued', phase: 'queued', done: 0, total: 0 },
  { status: 'running', phase: 'read', done: 1, total: 3 },
  { status: 'running', phase: 'read', done: 3, total: 3 },
  { status: 'running', phase: 'images', done: 2, total: 5 },
  { status: 'running', phase: 'build', done: 0, total: 0 },
  { status: 'done', phase: 'done', done: 0, total: 0 },
];

interface ImportFakeOptions {
  sources?: Partial<ImportSources['miro']>;
  /** fertige Importe vom Vortag („Letzte Importe“) */
  history?: boolean;
}

/** Gemockte Import-Endpunkte; nach installFakeApi registrieren (spätere Routen gewinnen). */
async function installImportFake(page: Page, boards: FakeBoard[], opts: ImportFakeOptions = {}) {
  const s = {
    sources: { enabled: true, token: true, oauth: false, connected: false, ...opts.sources },
    conns: new Set<string>(),
    jobs: [] as (ImportJob & { tick: number })[],
    /** Fortschritt anhalten (für Screenshots mitten im Import) */
    hold: false,
    /** nächste Antwort auf die Board-Liste: Verbindung abgelaufen */
    expireConn: false,
    /** nächster Start: Tageslimit erreicht */
    limitNext: false,
    tokenTries: [] as string[],
    startBodies: [] as { conn: string; boards: string[]; options: Record<string, boolean> }[],
    canceled: [] as string[],
    disconnects: 0,
    csrfMissing: 0,
  };
  const remote = Array.from({ length: 60 }, (_, i) => ({
    id: `uX${String(i).padStart(3, '0')}`,
    name: i === 0 ? 'Retro Q3 – Team Nord' : i === 1 ? 'Workshop Kundenreise' : i === 2 ? 'Retro Q2' : `Board ${i + 1}`,
    modifiedAt: new Date(Date.now() - (i + 1) * 3_600_000 * 7).toISOString(),
  }));
  if (opts.history) {
    s.jobs.push({
      id: 'old-1',
      source: 'miro',
      sourceBoard: 'uXold',
      sourceName: 'Sprint-Planung Juli',
      status: 'done',
      phase: 'done',
      done: 0,
      total: 0,
      boardId: 'b-old',
      report: { ...REPORT, imported: { sticky: 18, frame: 2 }, adjusted: [], skipped: [] },
      createdAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
      finishedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
      tick: TICKS.length - 1,
    });
    s.jobs.push({
      id: 'old-2',
      source: 'miro',
      sourceBoard: 'uXold2',
      sourceName: 'Altes Moodboard',
      status: 'failed',
      phase: 'images',
      done: 0,
      total: 0,
      error: 'Die Verbindung zu Miro ist abgelaufen. Verbinde dich neu und starte den Import noch einmal.',
      createdAt: new Date(Date.now() - 50 * 3_600_000).toISOString(),
      finishedAt: new Date(Date.now() - 50 * 3_600_000).toISOString(),
      tick: 0,
    });
  }
  let seq = 0;
  const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const fail = (route: Route, status: number, error: string, message?: string) => json(route, status, { ok: false, error, ...(message ? { message } : {}) });
  const view = ({ tick: _t, ...j }: ImportJob & { tick: number }): ImportJob => j;
  const advance = (j: ImportJob & { tick: number }) => {
    if (s.hold || j.status === 'canceled' || j.status === 'failed' || j.tick >= TICKS.length - 1) return;
    j.tick++;
    Object.assign(j, TICKS[j.tick]);
    if (j.phase === 'build') j.boardId = `imp-${j.id}`;
    if (j.status === 'done') {
      j.report = REPORT;
      j.finishedAt = new Date().toISOString();
      const now = new Date().toISOString();
      boards.push({ id: j.boardId!, title: j.sourceName, createdBy: 'm:12', createdByName: 'Mara Lindner', createdAt: now, updatedAt: now });
    }
  };

  await page.route('**/api/import/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    if (m !== 'GET' && req.headers()['x-stachel'] !== '1') {
      s.csrfMissing++;
      return fail(route, 403, 'csrf');
    }
    if (p === '/api/import/sources') return json(route, 200, { ok: true, miro: s.sources });
    if (p === '/api/import/miro/token' && m === 'POST') {
      const { token } = req.postDataJSON();
      s.tokenTries.push(token);
      if (token !== GOOD_TOKEN) return fail(route, 400, 'miro_token_invalid');
      const conn = `c${++seq}`;
      s.conns.add(conn);
      return json(route, 200, { ok: true, conn, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    }
    if (p === '/api/import/miro/oauth/start' && m === 'POST') {
      if (!s.sources.oauth) return fail(route, 404, 'oauth_disabled');
      expect(req.postDataJSON()).toEqual({ client: 'web' });
      return json(route, 200, { ok: true, url: 'https://miro.com/oauth/authorize?response_type=code&client_id=123&state=abc' });
    }
    if (p === '/api/import/miro/oauth' && m === 'DELETE') {
      s.disconnects++;
      s.sources.connected = false;
      return json(route, 200, { ok: true });
    }
    if (p === '/api/import/miro/boards') {
      const conn = url.searchParams.get('conn') ?? '';
      if (s.expireConn || !(conn === 'oauth' ? s.sources.connected : s.conns.has(conn))) {
        s.expireConn = false;
        return fail(route, 401, 'miro_conn_expired', 'Die Verbindung zu Miro ist abgelaufen. Verbinde dich bitte neu.');
      }
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const hits = remote.filter((b) => b.name.toLowerCase().includes(q));
      const page50 = hits.slice(offset, offset + 50);
      return json(route, 200, { ok: true, boards: page50, ...(offset + 50 < hits.length ? { next: offset + 50 } : {}) });
    }
    if (p === '/api/import/miro/jobs' && m === 'POST') {
      const body = req.postDataJSON();
      s.startBodies.push(body);
      if (s.limitNext) {
        s.limitNext = false;
        return fail(route, 429, 'import_limit', 'Du hast heute schon 20 Boards importiert. Morgen geht es weiter.');
      }
      const created = (body.boards as string[]).map((id) => {
        const j = {
          id: `j${++seq}`,
          source: 'miro' as const,
          sourceBoard: id,
          sourceName: remote.find((b) => b.id === id)?.name ?? id,
          ...TICKS[0],
          createdAt: new Date().toISOString(),
          tick: 0,
        };
        s.jobs.unshift(j);
        return j;
      });
      return json(route, 202, { ok: true, jobs: created.map(view) });
    }
    if (p === '/api/import/jobs' && m === 'GET') {
      s.jobs.forEach(advance);
      return json(route, 200, { ok: true, jobs: s.jobs.map(view) });
    }
    const one = p.match(/^\/api\/import\/jobs\/([^/]+)$/);
    if (one) {
      const j = s.jobs.find((x) => x.id === decodeURIComponent(one[1]));
      if (!j) return fail(route, 404, 'not_found');
      if (m === 'DELETE') {
        j.status = 'canceled';
        s.canceled.push(j.id);
        return json(route, 200, { ok: true });
      }
      return json(route, 200, { ok: true, job: view(j) });
    }
    return fail(route, 404, 'not_found');
  });
  // Miro-Freigabeseite: sofort „erlaubt“ und zurück zu Stachel (wie der Server-Callback)
  await page.route('https://miro.com/oauth/**', (route) => {
    s.sources.connected = true;
    const back = new URL('/?import=miro', page.url()).href;
    return route.fulfill({ status: 302, headers: { location: back } });
  });
  return s;
}

async function openOverview(page: Page, opts: ImportFakeOptions = {}) {
  const base = await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
  const imp = await installImportFake(page, base.boards, opts);
  return { base, imp };
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Board importieren' });

test.describe('Import aus Miro', () => {
  test('Token → Boards → Fortschritt → Bericht → Board öffnen', async ({ page }) => {
    const { base, imp } = await openOverview(page, { history: true, sources: { oauth: true } });
    await page.goto('/');
    await expect(page.locator('.board-card__title')).toHaveCount(5);
    const open = page.getByRole('button', { name: 'Board importieren' });
    await expect(open).toBeVisible();
    // neben „Neues Board“, gleiche Höhe
    const [a, b] = [await open.boundingBox(), await page.getByRole('button', { name: 'Neues Board' }).boundingBox()];
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    await shot(page, 'uebersicht');

    // 0: Quelle + letzte Importe
    await open.click();
    const d = dialog(page);
    await expect(d.getByRole('button', { name: /Aus Miro/ })).toBeFocused();
    await expect(d.locator('.import-recent__row')).toHaveCount(2);
    await expect(d.locator('.import-recent__row').first()).toContainText('Sprint-Planung Juli');
    await expect(d.locator('.import-recent__row').first()).toContainText('Fertig');
    await expect(d.locator('.import-recent__row').nth(1)).toContainText('Fehlgeschlagen');
    await expect(d).toContainText('Miro ist eine Marke der RealtimeBoard, Inc. Stachel steht in keiner Verbindung zu Miro.');
    await shot(page, 'quelle');

    // 1: Verbinden – beide Wege, Token falsch, Anleitung, Token richtig
    await d.getByRole('button', { name: /Aus Miro/ }).click();
    await expect(d.getByRole('button', { name: 'Mit Miro verbinden' })).toBeVisible();
    const field = d.getByLabel('Zugriffstoken einfügen');
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveAttribute('autocomplete', 'off');
    await d.getByText('So bekommst du ein Token').click();
    await expect(d.getByRole('link', { name: 'miro.com/app/settings/user-profile/apps' })).toHaveAttribute('href', 'https://miro.com/app/settings/user-profile/apps');
    await expect(d.getByText('boards:read')).toBeVisible();
    await shot(page, 'verbinden');
    await d.getByRole('button', { name: 'Weiter' }).click();
    await expect(d.getByRole('alert')).toContainText('Bitte füge zuerst das Token');
    await field.fill('falsch');
    await d.getByRole('button', { name: 'Weiter' }).click();
    await expect(d.getByRole('alert')).toContainText('Miro hat das Token abgelehnt');
    await field.fill(GOOD_TOKEN);
    await d.getByRole('button', { name: 'Weiter' }).click();

    // 2: Boards wählen (50 + „Mehr laden“), Suche, Optionen
    await expect(d.getByRole('heading', { name: 'Welche Boards?' })).toBeVisible();
    await expect(d.getByText('Mit deinem Token verbunden')).toBeVisible();
    const rows = d.locator('.import-board');
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText('Geändert vor 7 Std.');
    await d.getByRole('button', { name: 'Mehr laden' }).click();
    await expect(rows).toHaveCount(60);
    await expect(d.getByRole('button', { name: 'Mehr laden' })).toHaveCount(0);
    await d.getByPlaceholder('In Miro suchen').fill('retro');
    await expect(rows).toHaveCount(2);
    await d.getByRole('checkbox', { name: /Retro Q3/ }).check();
    await d.getByRole('checkbox', { name: /Retro Q2/ }).check();
    await expect(d.getByText('2 ausgewählt')).toBeVisible();
    await d.getByRole('checkbox', { name: /Originalfarben/ }).check();
    await expect(d.getByRole('checkbox', { name: /Board-Beschreibung/ })).toBeChecked();
    imp.hold = true;
    await shot(page, 'boards');
    await d.getByRole('button', { name: '2 Boards importieren' }).click();

    // 3: Fortschritt (angehalten für den Screenshot), dann weiter bis fertig
    expect(imp.startBodies[0]).toEqual({ conn: 'c1', boards: ['uX000', 'uX002'], options: { keepColors: true, description: true } });
    await expect(d.getByRole('heading', { name: 'Boards werden übernommen' })).toBeVisible();
    await expect(d.getByText('läuft im Hintergrund weiter')).toBeVisible();
    await expect(d.getByRole('progressbar')).toHaveCount(2);
    imp.hold = false;
    await expect(d.getByTestId('import-phase').first()).toHaveText('Objekte lesen · 1 von 3');
    imp.hold = true;
    await shot(page, 'fortschritt');
    imp.hold = false;
    await expect(d.getByTestId('import-phase').first()).toHaveText(/Bilder laden · 2 von 5/, { timeout: 10_000 });

    // 4: Bericht
    await expect(d.getByRole('heading', { name: 'Import fertig' })).toBeVisible({ timeout: 15_000 });
    const card = d.getByTestId('import-job').first();
    await expect(card).toContainText('Fertig');
    await expect(card.locator('summary')).toHaveText('92 Objekte übernommen · 19 angepasst · 3 nicht übernommen');
    await card.locator('summary').click();
    const rep = card.getByTestId('import-report');
    await expect(rep).toContainText('42 Notizen');
    await expect(rep).toContainText('7 Mindmap-Knoten');
    await expect(rep).toContainText('18 × Notizfarben an die Stachel-Palette angepasst');
    await expect(rep).toContainText('Verbinder ohne Ziel');
    await expect(rep).toContainText('Tabellen, Kommentare');
    await shot(page, 'bericht');

    // neues Board steht in der Liste, Token liegt nirgends im Browser
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href)).not.toContain(GOOD_TOKEN);
    expect(imp.csrfMissing + base.csrfMissing).toBe(0);
    await card.getByRole('button', { name: 'Board öffnen' }).click();
    await expect(page).toHaveURL(/\?b=imp-j\d/);
  });

  test('ein Board, schließen während des Imports, „läuft“ am Knopf, wieder öffnen', async ({ page }) => {
    const { imp } = await openOverview(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Board importieren' }).click();
    const d = dialog(page);
    await d.getByRole('button', { name: /Aus Miro/ }).click();
    await expect(d.getByRole('button', { name: 'Mit Miro verbinden' })).toHaveCount(0);
    await d.getByLabel('Zugriffstoken einfügen').fill(GOOD_TOKEN);
    await d.getByLabel('Zugriffstoken einfügen').press('Enter');
    await d.getByRole('checkbox', { name: /Workshop Kundenreise/ }).check();
    imp.hold = true;
    await d.getByRole('button', { name: 'Importieren', exact: true }).click();
    await expect(d.getByRole('heading', { name: 'Board wird übernommen' })).toBeVisible();
    await d.getByRole('button', { name: 'Im Hintergrund weiter' }).click();
    await expect(d).toHaveCount(0);
    const open = page.getByRole('button', { name: /Board importieren/ });
    await expect(open).toContainText('läuft');
    await shot(page, 'uebersicht-laeuft');
    // wieder öffnen → direkt beim Fortschritt
    await open.click();
    await expect(d.getByRole('heading', { name: 'Board wird übernommen' })).toBeVisible();
    await page.keyboard.press('Escape');
    imp.hold = false;
    // fertig → Knopf normal, Liste neu geladen
    await expect(open).not.toContainText('läuft', { timeout: 15_000 });
    await expect(page.locator('.board-card__title', { hasText: 'Workshop Kundenreise' })).toBeVisible();
  });

  test('Abbrechen, Tageslimit und abgelaufene Verbindung', async ({ page }) => {
    const { imp } = await openOverview(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Board importieren' }).click();
    const d = dialog(page);
    await d.getByRole('button', { name: /Aus Miro/ }).click();
    await d.getByLabel('Zugriffstoken einfügen').fill(GOOD_TOKEN);
    await d.getByRole('button', { name: 'Weiter' }).click();
    await d.getByRole('checkbox', { name: /Retro Q2/ }).check();

    imp.limitNext = true;
    await d.getByRole('button', { name: 'Importieren', exact: true }).click();
    await expect(d.getByRole('alert')).toHaveText('Du hast heute schon 20 Boards importiert. Morgen geht es weiter.');

    imp.hold = true;
    await d.getByRole('button', { name: 'Importieren', exact: true }).click();
    await d.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(d.getByRole('heading', { name: 'Import abgebrochen' })).toBeVisible();
    await expect(d).toContainText('es wurde kein Board angelegt');
    expect(imp.canceled).toHaveLength(1);

    // „Weitere importieren“ → Liste; Verbindung abgelaufen → zurück zum Verbinden mit Grund
    imp.expireConn = true;
    await d.getByRole('button', { name: 'Weitere importieren' }).click();
    await expect(d.getByRole('heading', { name: 'Zugang zu Miro' })).toBeVisible();
    await expect(d.getByRole('alert')).toContainText('Die Verbindung zu Miro ist abgelaufen');
  });

  test('höchstens 10 Boards auf einmal', async ({ page }) => {
    await openOverview(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Board importieren' }).click();
    const d = dialog(page);
    await d.getByRole('button', { name: /Aus Miro/ }).click();
    await d.getByLabel('Zugriffstoken einfügen').fill(GOOD_TOKEN);
    await d.getByRole('button', { name: 'Weiter' }).click();
    const boxes = d.locator('.import-board input');
    await expect(boxes).toHaveCount(50);
    for (let i = 0; i < 10; i++) await boxes.nth(i).check();
    await expect(boxes.nth(10)).toBeDisabled();
    await expect(d.getByText('10 ausgewählt – mehr als 10 gehen nicht auf einmal')).toBeVisible();
    await boxes.nth(0).uncheck();
    await expect(boxes.nth(10)).toBeEnabled();
  });

  test('Mit Miro verbinden: Freigabe, Rückkehr mit ?import=miro, Verbindung trennen', async ({ page }) => {
    const { imp } = await openOverview(page, { sources: { oauth: true, token: false } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Board importieren' }).click();
    const d = dialog(page);
    await d.getByRole('button', { name: /Aus Miro/ }).click();
    await expect(d.getByLabel('Zugriffstoken einfügen')).toHaveCount(0);
    await d.getByRole('button', { name: 'Mit Miro verbinden' }).click();

    // zurück von Miro: Dialog direkt bei der Board-Auswahl, Parameter aus der Adresse entfernt
    await expect(d.getByRole('heading', { name: 'Welche Boards?' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(d.getByText('Mit Miro verbunden')).toBeVisible();
    await expect(d.locator('.import-board')).toHaveCount(50);

    // schon verbunden: „Aus Miro“ springt gleich zur Auswahl
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Board importieren' }).click();
    await d.getByRole('button', { name: /Aus Miro/ }).click();
    await expect(d.getByRole('heading', { name: 'Welche Boards?' })).toBeVisible();

    await d.getByRole('button', { name: 'Verbindung zu Miro trennen' }).click();
    await expect(d.getByRole('button', { name: 'Mit Miro verbinden' })).toBeVisible();
    expect(imp.disconnects).toBe(1);
  });

  test('Rückkehr mit Fehler: verständliche Meldung, Parameter weg', async ({ page }) => {
    await openOverview(page, { sources: { oauth: true } });
    await page.goto('/?import=miro&error=access_denied');
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Zugang zu Miro' })).toBeVisible();
    await expect(d.getByRole('alert')).toContainText('Du hast den Zugriff in Miro nicht erlaubt');
    await expect(page).toHaveURL(/\/$/);
    await page.reload();
    await expect(page.locator('.board-card__title')).toHaveCount(5);
    await expect(d).toHaveCount(0);
  });

  test('kein Knopf, wenn die Instanz den Import nicht anbietet', async ({ page }) => {
    await openOverview(page, { sources: { enabled: true, token: false, oauth: false } });
    await page.goto('/');
    await expect(page.locator('.board-card__title')).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Board importieren' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  });
});

test.describe('Import aus Miro am Handy', () => {
  test.use(PHONE);

  test('alle Schritte passen in die Breite', async ({ page }) => {
    const { imp } = await openOverview(page, { history: true, sources: { oauth: true } });
    await page.goto('/');
    const open = page.getByRole('button', { name: 'Board importieren' });
    await expect(open).toBeVisible();
    await shot(page, 'handy-uebersicht');
    const fits = async () => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(w).toBeLessThanOrEqual(390);
      const m = await dialog(page).boundingBox();
      expect(m!.x).toBeGreaterThanOrEqual(0);
      expect(m!.x + m!.width).toBeLessThanOrEqual(390.5);
    };
    await open.click();
    const d = dialog(page);
    await expect(d.locator('.import-recent__row')).toHaveCount(2);
    await fits();
    await shot(page, 'handy-quelle');
    await d.getByRole('button', { name: /Aus Miro/ }).click();
    await d.getByText('So bekommst du ein Token').click();
    await fits();
    await shot(page, 'handy-verbinden');
    await d.getByLabel('Zugriffstoken einfügen').fill(GOOD_TOKEN);
    await d.getByRole('button', { name: 'Weiter' }).click();
    await d.getByRole('checkbox', { name: /Workshop Kundenreise/ }).check();
    await d.getByRole('checkbox', { name: /Retro Q3/ }).check();
    await fits();
    await shot(page, 'handy-boards');
    // Knopf „Importieren“ bleibt sichtbar (Knopfleiste klebt unten)
    await expect(d.getByRole('button', { name: '2 Boards importieren' })).toBeInViewport();
    imp.hold = true;
    await d.getByRole('button', { name: '2 Boards importieren' }).click();
    imp.hold = false;
    await expect(d.getByTestId('import-phase').first()).toHaveText('Objekte lesen · 1 von 3');
    imp.hold = true;
    await fits();
    await shot(page, 'handy-fortschritt');
    imp.hold = false;
    await expect(d.getByRole('heading', { name: 'Import fertig' })).toBeVisible({ timeout: 15_000 });
    await d.getByTestId('import-job').first().locator('summary').click();
    await fits();
    await shot(page, 'handy-bericht');
  });
});
