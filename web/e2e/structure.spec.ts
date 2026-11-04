// Modul „structure“: Vorlagen-Galerie, Mindmap, Karten, Tabellen, Rahmen-Liste, Präsentation, Rahmen-Formate,
// Folgen bei Präsentationen (zwei Browser über einen Test-Sync-Server).
import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import type { Server } from '@hocuspocus/server';
import { startSyncServer } from './syncServer';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { objects, openOffline, selection, type Obj } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `structure-${name}.png`) });

type Full = Obj & { mind?: { parent?: string; level?: number; hidden?: boolean; collapsed?: boolean }; table?: { rows: string[]; cols: string[]; cells: Record<string, string> }; status?: string; assignee?: { name: string }; desc?: string; tags?: { label: string }[]; due?: string; title?: string; slide?: string; color?: string };
const all = (page: Page) => objects(page) as Promise<Full[]>;
const ofType = async (page: Page, type: string) => (await all(page)).filter((o) => o.type === type);
const matrix = (t: Full['table']) => t!.rows.map((r) => t!.cols.map((c) => t!.cells[`${r}:${c}`] ?? ''));

async function tool(page: Page, label: string) {
  await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();
}
/** Karte, Tabelle oder Mindmap über das gemeinsame Werkzeug wählen */
async function block(page: Page, label: 'Karte' | 'Tabelle' | 'Mindmap') {
  await tool(page, 'Karte, Tabelle, Mindmap');
  await page.getByRole('group', { name: 'Werkzeug-Optionen' }).getByRole('button', { name: label, exact: true }).click();
}

test.describe('offline', () => {
  test.beforeEach(async ({ page }) => {
    await openOffline(page);
  });

  test('Vorlagen-Galerie: Vorschau, Suche, Einfügen in der Bildmitte, ein Undo-Schritt', async ({ page }) => {
    await tool(page, 'Vorlagen');
    const dlg = page.getByRole('dialog', { name: 'Vorlagen' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('option')).toHaveCount(27);
    await dlg.getByRole('tab', { name: 'Events' }).click();
    await expect(dlg.getByRole('option')).toHaveCount(10);
    await dlg.locator('[data-template="siteplan"]').click();
    await page.waitForTimeout(150);
    await shot(page, 'vorlagen-events');
    await dlg.getByRole('tab', { name: 'Alle' }).click();
    await dlg.getByLabel('Vorlage suchen').fill('schicht');
    await expect(dlg.getByRole('option')).toHaveCount(3);
    await dlg.getByLabel('Vorlage suchen').fill('');
    await dlg.locator('[data-template="kanban"]').click();
    await expect(dlg.getByRole('heading', { name: 'Kanban' })).toBeVisible();
    await page.waitForTimeout(150);
    await shot(page, 'vorlagen');

    await dlg.getByRole('button', { name: 'Einfügen' }).click();
    await expect(dlg).toBeHidden();
    const objs = await all(page);
    expect(objs.filter((o) => o.type === 'card').length).toBe(7);
    expect(objs.filter((o) => o.type === 'frame').length).toBe(1);
    expect((await selection(page)).length).toBe(objs.length);
    // Mitte der Vorlage = Bildmitte (bzw. Mitte der freien Fläche: eingepasst wird neben Übersichtskarte und Werkzeugen, ui/chromeInsets)
    const frame = objs.find((o) => o.type === 'frame')!;
    const center = await page.evaluate(() => (window as any).__stachel.api().viewCenter());
    expect(Math.abs(frame.x + frame.w / 2 - center.x)).toBeLessThan(100);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await shot(page, 'kanban');
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await all(page)).length).toBe(0);
  });

  test('Vorlagen der Instanz: eigene Kategorie mit Plakette, Suche, Einfügen', async ({ page }) => {
    const note = (id: string, x: number, text: string) => ({ id, type: 'sticky', x, y: 0, w: 200, h: 200, color: '#fff27a', text });
    await page.route('**/api/templates/instance', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, category: 'Unser Verein', templates: [{ id: 'fest.ablauf', name: 'Vereinsfest-Ablauf', desc: 'Aufbau bis Abbau', keywords: ['grill'], objects: [note('a', 0, 'Grill anheizen'), note('b', 240, 'Musik')] }] }),
      }),
    );
    await tool(page, 'Vorlagen');
    const dlg = page.getByRole('dialog', { name: 'Vorlagen' });
    await expect(dlg.getByRole('option')).toHaveCount(28);
    await dlg.getByRole('tab', { name: 'Unser Verein' }).click();
    await expect(dlg.getByRole('option')).toHaveCount(1);
    await expect(dlg.locator('[data-template="pack:fest.ablauf"] .structure-tpl__thumb')).toHaveAttribute('data-badge', 'Unser Verein');
    await dlg.getByRole('tab', { name: 'Alle' }).click();
    await dlg.getByLabel('Vorlage suchen').fill('grill');
    await expect(dlg.getByRole('option')).toHaveCount(1);
    await expect(dlg.getByRole('heading', { name: 'Vereinsfest-Ablauf' })).toBeVisible();
    await page.waitForTimeout(150);
    await shot(page, 'vorlagen-instanz');
    await dlg.getByRole('button', { name: 'Einfügen' }).click();
    await expect(dlg).toBeHidden();
    expect((await ofType(page, 'sticky')).map((o) => (o as Full & { text?: string }).text).sort()).toEqual(['Grill anheizen', 'Musik']);
  });

  test('alle Vorlagen lassen sich einfügen', async ({ page }) => {
    const ids = ['kanban', 'retro', 'mindmap', 'flow', 'brainstorm', 'eventplan', 'week', 'swot', 'festival', 'shifts', 'siteplan'];
    for (const id of ids) {
      await page.evaluate(() => (window as any).__stachel.api().openModal('structure.templates'));
      await page.locator(`[data-template="${id}"]`).dblclick();
      await expect(page.getByRole('dialog', { name: 'Vorlagen' })).toBeHidden();
      const n = (await all(page)).length;
      expect(n, id).toBeGreaterThan(0);
      if (['mindmap', 'festival', 'shifts', 'siteplan', 'flow', 'retro'].includes(id)) {
        await page.keyboard.press('Escape');
        await page.evaluate(() => (window as any).__stachel.api().zoomToSelection());
        await page.evaluate(() => (window as any).__stachel.api().fitAll());
        await page.waitForTimeout(400);
        await shot(page, `vorlage-${id}`);
      }
      await page.evaluate(() => {
        const s = (window as any).__stachel.store;
        s.remove(s.getSnapshot().ordered.map((o: any) => o.id));
      });
    }
  });

  test('Mindmap: Tab = Unterthema, Enter = gleiche Ebene, Layout, Einklappen, Löschen mit Unterthemen', async ({ page }) => {
    await block(page, 'Mindmap');
    await page.mouse.click(500, 420);
    await expect(page.locator('.structure-mind__text.editing')).toBeFocused();
    await page.keyboard.type('Festival');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Programm');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Orga');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Helfer:innen');
    await page.keyboard.press('Escape');
    const nodes = await ofType(page, 'mindnode');
    expect(nodes.map((n) => n.text)).toEqual(['Festival', 'Programm', 'Orga', 'Helfer:innen']);
    const [root, prog, orga, help] = nodes;
    expect(prog.mind?.parent).toBe(root.id);
    expect(orga.mind?.parent).toBe(root.id);
    expect(help.mind?.parent).toBe(orga.id);
    expect(prog.x).toBeGreaterThan(root.x + root.w);
    expect(orga.y).toBeGreaterThan(prog.y);
    expect(help.x).toBeGreaterThan(orga.x + orga.w);
    // Linien liegen in der Welt-Ebene
    await expect(page.locator('.structure-mind-lines path')).toHaveCount(3);

    // Pfeiltasten wandern durch den Baum
    await page.locator(`[data-id="${root.id}"]`).click();
    await page.keyboard.press('ArrowRight');
    expect(await selection(page)).toEqual([prog.id]);
    await page.keyboard.press('ArrowDown');
    expect(await selection(page)).toEqual([orga.id]);
    await page.waitForTimeout(150);
    await shot(page, 'mindmap');

    // Einklappen über den Knopf am Knoten
    await page.getByRole('button', { name: 'Zweig einklappen' }).first().click();
    await expect.poll(async () => (await ofType(page, 'mindnode')).find((n) => n.id === help.id)?.mind?.hidden).toBe(true);
    await expect(page.locator(`[data-id="${help.id}"]`)).toBeHidden();
    await page.getByRole('button', { name: /Zweig ausklappen/ }).first().click();
    await expect(page.locator(`[data-id="${help.id}"]`)).toBeVisible();

    // Löschen nimmt die Unterthemen mit (ein Schritt)
    await page.locator(`[data-id="${orga.id}"]`).click();
    await page.keyboard.press('Delete');
    expect((await ofType(page, 'mindnode')).map((n) => n.text)).toEqual(['Festival', 'Programm']);
    await page.keyboard.press('Control+z');
    expect((await ofType(page, 'mindnode')).length).toBe(4);

    // Tippen auf einen ausgewählten Knoten startet die Bearbeitung (Klartext, ohne Rich-Text-Reste)
    await page.locator(`[data-id="${root.id}"]`).click();
    await page.keyboard.type('!');
    await expect(page.locator('.structure-mind__text.editing')).toBeFocused();
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    const r2 = (await ofType(page, 'mindnode')).find((n) => n.id === root.id)! as Full & { content?: unknown };
    expect(r2.text).toBe('Festival!!');
    expect(r2.content).toBeUndefined();
  });

  test('Karten: Titel, Status, Person, Datum, Details mit Beschreibung und Tags', async ({ page }) => {
    await block(page, 'Karte');
    await page.mouse.move(600, 400);
    await shot(page, 'werkzeug');
    await page.mouse.click(600, 400);
    await expect(page.locator('.structure-card__title.editing')).toBeFocused();
    await page.keyboard.type('Bühnenplan finalisieren');
    await page.keyboard.press('Escape');
    let [card] = await ofType(page, 'card');
    expect(card.text).toBe('Bühnenplan finalisieren');

    await page.locator(`[data-id="${card.id}"]`).click();
    await page.getByRole('button', { name: 'Status' }).click();
    await page.getByRole('button', { name: 'In Arbeit' }).click();
    await page.getByRole('button', { name: 'Zuständig' }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Karte öffnen' }).click();
    const dlg = page.getByRole('dialog', { name: 'Karte' });
    await dlg.getByLabel('Beschreibung').fill('Reihenfolge der Bands mit der Technik abstimmen.');
    await dlg.getByLabel('Fällig am').fill('2027-06-12');
    await dlg.getByLabel('Neuer Tag').fill('Technik');
    await dlg.getByRole('button', { name: 'Tagfarbe Pink' }).click();
    await dlg.getByRole('button', { name: 'Hinzufügen' }).click();
    await dlg.getByLabel('Neuer Tag').fill('Programm');
    await dlg.getByLabel('Neuer Tag').press('Enter');
    await page.waitForTimeout(100);
    await shot(page, 'karte-details');
    await dlg.getByRole('button', { name: 'Fertig' }).click();

    [card] = await ofType(page, 'card');
    expect(card.status).toBe('doing');
    expect(card.assignee?.name).toBeTruthy();
    expect(card.desc).toContain('Bands');
    expect(card.due).toBe('2027-06-12');
    expect(card.tags?.map((t) => t.label)).toEqual(['Technik', 'Programm']);
    await expect(page.locator(`[data-id="${card.id}"] .structure-chip--tag`)).toHaveCount(2);
    // Höhe folgt dem Inhalt
    const box = (await page.locator(`[data-id="${card.id}"] .structure-card__inner`).boundingBox())!;
    const z = await page.evaluate(() => (window as any).__stachel.getCamera().z);
    expect(Math.abs(box.height / z - card.h)).toBeLessThan(4);
    await page.waitForTimeout(100);
    await shot(page, 'karte');
  });

  test('Haftnotiz in Karte umwandeln', async ({ page }) => {
    await page.evaluate(() => (window as any).__stachel.store.create({ type: 'sticky', x: -100, y: -100, w: 200, h: 200, text: 'Getränke bestellen', color: '#fff27a' }));
    const [note] = await ofType(page, 'sticky');
    await page.locator(`[data-id="${note.id}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'In Karte umwandeln' }).click();
    const objs = await all(page);
    expect(objs.map((o) => o.type)).toEqual(['card']);
    expect(objs[0].text).toBe('Getränke bestellen');
  });

  test('Tabellen: Zellen tippen, Tab/Enter, Zeilen und Spalten, Kopfzeile, Spaltenbreite', async ({ page }) => {
    await block(page, 'Tabelle');
    await page.mouse.click(640, 420);
    const editor = page.locator('.structure-table__editor');
    await expect(editor).toBeFocused();
    await page.keyboard.type('Bereich');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Fr 18–22');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Sa 18–22');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Bar');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Einlass');
    await page.keyboard.press('Escape');
    let [t] = await ofType(page, 'table');
    expect(matrix(t.table)).toEqual([
      ['Bereich', 'Fr 18–22', 'Sa 18–22'],
      ['Bar', '', ''],
      ['Einlass', '', ''],
    ]);

    // Tippen auf die ausgewählte Tabelle schreibt in die aktive Zelle
    await page.locator(`[data-id="${t.id}"] [data-cell="1:1"]`).click();
    await page.keyboard.type('Lena');
    await page.keyboard.press('Escape');
    [t] = await ofType(page, 'table');
    expect(matrix(t.table)[1][1]).toBe('Lena');

    // Plus-Knöpfe am Rand
    await page.getByRole('button', { name: 'Zeile anhängen' }).click();
    await page.getByRole('button', { name: 'Spalte anhängen' }).click();
    [t] = await ofType(page, 'table');
    expect(t.table!.rows.length).toBe(4);
    expect(t.table!.cols.length).toBe(4);
    // Kontextleiste: Zeile löschen (aktive Zelle), Kopfspalte
    await page.getByRole('button', { name: 'Spalte löschen' }).click();
    await page.getByRole('button', { name: 'Kopfbereich' }).click();
    await page.getByRole('button', { name: 'Beides' }).click();
    [t] = await ofType(page, 'table');
    expect(t.table!.cols.length).toBe(3);
    await expect(page.locator(`[data-id="${t.id}"] .structure-table__cell.is-headcol`)).toHaveCount(3);

    // Spaltenbreite ziehen: Gesamtbreite bleibt
    const w0 = t.w;
    const grip = page.locator(`[data-id="${t.id}"] .structure-table__grip`).first();
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + 20);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 60, g.y + 20, { steps: 6 });
    await page.mouse.up();
    [t] = await ofType(page, 'table');
    expect(t.w).toBe(w0);
    const firstCol = (await page.locator(`[data-id="${t.id}"] [data-cell="0:0"]`).boundingBox())!;
    expect(firstCol.width).toBeGreaterThan(g.x - firstCol.x + 30);
    await page.waitForTimeout(100);
    await shot(page, 'tabelle');
  });

  test('Rahmen-Liste: umsortieren per Ziehen, Klick springt hin; Präsentation mit Pfeiltasten', async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as any).__stachel.store;
      const colors = ['#ffffff', '#fff27a', '#9fd3ff'];
      ['Begrüßung', 'Programm', 'Danke'].forEach((title, i) => {
        const id = s.create({ type: 'frame', x: i * 900, y: 0, w: 800, h: 450, title, color: colors[i] });
        s.create({ type: 'sticky', x: i * 900 + 300, y: 120, w: 200, h: 200, text: title, color: '#c9e14a' });
        return id;
      });
    });
    await page.getByRole('button', { name: 'Rahmen-Liste' }).click();
    const panel = page.getByRole('dialog', { name: 'Rahmen' });
    await expect(panel.locator('.frames-panel__title')).toHaveText(['Begrüßung', 'Programm', 'Danke']);
    await expect(panel.locator('.frames-panel__thumb svg')).toHaveCount(3);
    await page.waitForTimeout(100);
    await shot(page, 'rahmen-liste');

    // „Danke“ an die erste Stelle ziehen
    const grip = panel.locator('.frames-panel__row').nth(2).getByRole('button', { name: 'Verschieben' });
    const gb = (await grip.boundingBox())!;
    const first = (await panel.locator('.frames-panel__row').first().boundingBox())!;
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x + gb.width / 2, first.y + 4, { steps: 10 });
    await page.mouse.up();
    await expect(panel.locator('.frames-panel__title')).toHaveText(['Danke', 'Begrüßung', 'Programm']);
    // Tastatur: Alt+↓ schiebt einen Platz nach hinten
    await panel.getByRole('button', { name: '1. Danke' }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(panel.locator('.frames-panel__title')).toHaveText(['Begrüßung', 'Danke', 'Programm']);
    await page.keyboard.press('Control+z');
    await expect(panel.locator('.frames-panel__title')).toHaveText(['Danke', 'Begrüßung', 'Programm']);

    // Klick springt hin
    await panel.getByRole('button', { name: '3. Programm' }).click();
    await expect.poll(async () => {
      const c = await page.evaluate(() => (window as any).__stachel.api().viewCenter());
      return Math.round(c.x);
    }).toBeGreaterThan(900);

    // Präsentation in dieser Reihenfolge
    await panel.getByRole('button', { name: 'Präsentieren', exact: true }).click();
    await expect(page.getByTestId('present-pos')).toHaveText('1 / 3');
    await expect(page.locator('.present-bar__title')).toHaveText('Danke');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('present-pos')).toHaveText('2 / 3');
    await expect(page.locator('.present-bar__title')).toHaveText('Begrüßung');
    await page.waitForTimeout(400);
    await shot(page, 'praesentation');
    await page.getByRole('button', { name: 'Präsentation beenden' }).click();
    await expect(page.locator('.present-bar')).toBeHidden();
  });

  test('Rahmen-Formate: 16:9 per Klick, Handy beim Aufziehen, Format und Raster nachträglich', async ({ page }) => {
    await tool(page, 'Rahmen');
    await page.getByRole('button', { name: 'Format 16:9' }).click();
    await page.mouse.click(700, 450);
    let [f] = await ofType(page, 'frame');
    expect([f.w, f.h]).toEqual([1280, 720]);

    await page.keyboard.press('Escape');
    await tool(page, 'Rahmen');
    await page.getByRole('button', { name: 'Format Handy' }).click();
    await page.mouse.move(100, 200);
    await page.mouse.down();
    await page.mouse.move(180, 260, { steps: 6 });
    await page.mouse.up();
    const frames = await ofType(page, 'frame');
    f = frames[1];
    expect(Math.abs(f.w / f.h - 390 / 844)).toBeLessThan(0.02);

    // Format in der Kontextleiste, Raster mit Koordinaten
    await page.getByRole('button', { name: 'Format', exact: true }).click();
    await page.getByRole('button', { name: 'A4 quer' }).click();
    f = (await ofType(page, 'frame'))[1];
    expect([f.w, f.h]).toEqual([1123, 794]);
    await page.getByRole('button', { name: 'Raster', exact: true }).click();
    await page.getByRole('button', { name: 'Raster 100' }).click();
    await page.getByRole('button', { name: 'A1 B2' }).click();
    await expect(page.locator(`[data-id="${f.id}"] .structure-grid-labels span`).first()).toHaveText('A');
  });
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Galerie und Rahmen-Liste passen aufs Handy', async ({ page }) => {
    await openOffline(page);
    await page.evaluate(() => (window as any).__stachel.api().openModal('structure.templates'));
    const dlg = page.getByRole('dialog', { name: 'Vorlagen' });
    await expect(dlg.getByRole('option')).toHaveCount(27);
    await dlg.locator('[data-template="mindmap"]').tap();
    await expect(dlg.getByRole('button', { name: 'Einfügen' })).toBeInViewport();
    await page.waitForTimeout(150);
    await shot(page, 'handy-vorlagen');
    await dlg.getByRole('button', { name: 'Einfügen' }).tap();
    expect((await ofType(page, 'mindnode')).length).toBeGreaterThan(5);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noScroll).toBe(true);
  });
});

// ---- Folgen: zwei Browser über einen Test-Sync-Server ------------------------------------------------------------------

test.describe('live', () => {
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

  // Abstand der Rahmenmitte zur Bildmitte; eingepasst wird in die freie Fläche neben den Leisten (ui/chromeInsets), daher bis 160 px
  const frameCenterOffset = async (page: Page, i: number) => {
    const b = (await page.locator('[data-type="frame"]').nth(i).boundingBox())!;
    const v = page.viewportSize()!;
    return Math.hypot(b.x + b.width / 2 - v.width / 2, b.y + b.height / 2 - v.height / 2);
  };

  test('Mitlesende können der Präsentation folgen; Zuständig kennt die Anwesenden', async ({ browser }) => {
    const a = await openAs(browser, { key: 'm:12', name: 'Mara Lindner', isOrga: true }, 'sess-mara');
    const b = await openAs(browser, { key: 'm:31', name: 'Jonas Keller', isOrga: false }, 'sess-jonas');
    // A legt zwei Rahmen und eine Karte an
    await tool(a, 'Rahmen');
    await a.mouse.click(330, 300);
    await a.keyboard.press('Escape');
    await tool(a, 'Rahmen');
    await a.mouse.click(1040, 600);
    await a.keyboard.press('Escape');
    await block(a, 'Karte');
    await a.mouse.click(330, 680);
    await a.keyboard.type('Aufgabe');
    await a.keyboard.press('Escape');
    await a.keyboard.press('Escape');
    await expect(b.locator('[data-type="frame"]')).toHaveCount(2);
    await expect(b.locator('[data-type="card"]')).toHaveText('Aufgabe');

    // Zuständig: beide Personen stehen zur Wahl
    await b.locator('[data-type="card"]').click();
    await b.getByRole('button', { name: 'Zuständig' }).click();
    await expect(b.getByRole('option', { name: 'Jonas Keller' })).toBeVisible();
    await b.getByRole('option', { name: 'Mara Lindner' }).click();
    await expect(a.locator('[data-type="card"] .structure-avatar')).toHaveAttribute('title', 'Mara Lindner');
    await b.keyboard.press('Escape');

    // A präsentiert, B folgt
    await a.getByRole('button', { name: 'Rahmen-Liste' }).click();
    await a.getByRole('dialog', { name: 'Rahmen' }).getByRole('button', { name: 'Präsentieren', exact: true }).click();
    const banner = b.locator('.structure-follow');
    await expect(banner).toContainText('Mara Lindner');
    await expect(banner).toContainText('1/2');
    await banner.getByRole('button', { name: 'Folgen' }).click();
    await expect.poll(() => frameCenterOffset(b, 0)).toBeLessThan(160);
    await a.keyboard.press('ArrowRight');
    await expect(banner).toContainText('2/2');
    await expect.poll(() => frameCenterOffset(b, 1)).toBeLessThan(160);
    await b.waitForTimeout(300);
    await b.screenshot({ path: path.join(OUT, 'structure-folgen.png') });
    await a.keyboard.press('Escape');
    await expect(banner).toBeHidden();
    await a.context().close();
    await b.context().close();
  });
});
