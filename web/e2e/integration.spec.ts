// Zusammenspiel der Feature-Module: alle Objekttypen mit Reaktionen/Abstimmung/Kommentaren, Export, Suche in Rich-Text,
// Vorlagen mit Flussdiagramm-Formen, Rückgängig über alle Module, Kontextmenü mit Untermenüs, Handy-Leiste, Cursor-Chat.
// Ports: PW_PORT=5196.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { centerOf, objects, openOffline, type Obj } from './helpers';
import { installFakeApi, sampleBoards } from './fakeApi';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `integration-${name}.png`) });

async function insertTemplate(page: Page, id: string) {
  await page.evaluate(() => (window as any).__stachel.api().openModal('structure.templates'));
  await page.locator(`[data-template="${id}"]`).dblclick();
  await expect(page.getByRole('dialog', { name: 'Vorlagen' })).toBeHidden();
  // nächste Vorlage daneben: Ansicht nach rechts schieben
  await page.evaluate(() => {
    const api = (window as any).__stachel.api();
    const c = api.camera();
    api.setCamera({ ...c, x: c.x - 4000 * c.z });
  });
}

const ydump = (page: Page, name: string) => page.evaluate((n) => (window as any).__stachel.store.doc.getMap(n).toJSON(), name);

/** Alle Objekttypen auf einem Board: Vorlagen (Karten, Tabelle, Mindmap, Formen, Verbinder, Rahmen), Bild, Sticker. */
async function seedAllTypes(page: Page) {
  for (const id of ['kanban', 'shifts', 'mindmap', 'flow']) await insertTemplate(page, id);
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    store.createMany([
      { id: 'i-s', type: 'sticky', x: -600, y: -600, w: 200, h: 200, color: '#fff27a', text: 'Notiz' },
      { id: 'i-t', type: 'text', x: -300, y: -600, w: 240, h: 40, fontSize: 28, text: 'Überschrift' },
      { id: 'i-p', type: 'pen', x: -600, y: -300, w: 100, h: 40, points: [0, 0, 50, 40, 100, 0], color: '#0a0a0a', strokeWidth: 4 },
    ]);
    store.stopCapturing();
  });
  // Bild über den Upload-Knopf (2×1-PNG)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAIAKg4D/2MLmzYAAAAASUVORK5CYII=', 'base64');
  await page.getByTestId('image-input').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => (await objects(page)).some((o) => o.type === 'image')).toBe(true);
  // Sticker über das Werkzeug
  await page.keyboard.press('Escape');
  await page.locator('[data-tool="shapes.sticker"]').click();
  await page.mouse.click(700, 760);
  await page.keyboard.press('v');
  await expect.poll(async () => (await objects(page)).some((o) => o.type === 'sticker')).toBe(true);
  await page.evaluate(() => (window as any).__stachel.api().fitAll());
}

const typesOf = (list: Obj[]) => new Set(list.map((o) => o.type));

test.describe('offline', () => {
  test.beforeEach(async ({ page }) => {
    await openOffline(page);
  });

  test('alle Objekttypen: Reaktionen, Abstimmung, Kommentar-Pins, Export, Suche', async ({ page }) => {
    await seedAllTypes(page);
    const all = await objects(page);
    const types = typesOf(all);
    for (const t of ['sticky', 'text', 'shape', 'connector', 'pen', 'frame', 'image', 'card', 'table', 'mindnode', 'sticker']) expect(types.has(t), t).toBe(true);
    // Vorlage Flussdiagramm nutzt die Flussdiagramm-Formen des Moduls shapes
    const kinds = new Set(all.filter((o) => o.type === 'shape').map((o: any) => o.shape));
    for (const k of ['terminator', 'manualInput', 'diamond', 'predefined', 'document']) expect(kinds.has(k), k).toBe(true);

    // Reaktion auf alles (Strg A → Kontextleiste)
    await page.getByTestId('board').focus();
    await page.keyboard.press('Control+a');
    const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
    await bar.getByRole('button', { name: 'Reagieren' }).click();
    await bar.getByRole('button', { name: 'Reaktion 👍' }).click();
    const reactions = (await ydump(page, 'collab.reactions')) as Record<string, { o: string }>;
    const reacted = new Set(Object.values(reactions).map((r) => all.find((o) => o.id === r.o)?.type));
    for (const t of ['sticky', 'text', 'shape', 'image', 'card', 'table', 'mindnode', 'sticker']) expect(reacted.has(t), `Reaktion an ${t}`).toBe(true);
    await page.keyboard.press('Escape');

    // Abstimmung: jede abstimmbare Art bekommt eine Fläche
    await page.getByRole('button', { name: 'Abstimmung starten' }).click();
    await page.getByRole('dialog', { name: 'Abstimmung starten' }).getByRole('button', { name: 'Abstimmung starten' }).click();
    // je Typ ein Objekt heranzoomen: abstimmbar oder nicht
    const zoomTo = (id: string) =>
      page.evaluate((i) => {
        const api = (window as any).__stachel.api();
        const o = api.snapshot().byId.get(i);
        const b = api.bounds(o);
        api.fitTo({ x: b.x - 200, y: b.y - 200, w: b.w + 400, h: b.h + 400 });
      }, id);
    for (const t of ['sticky', 'text', 'shape', 'image', 'card', 'table', 'mindnode', 'sticker', 'connector', 'frame', 'pen']) {
      const o = all.find((x) => x.type === t && !(x as any).mind?.hidden)!;
      await zoomTo(o.id);
      await expect(page.locator(`[data-vote="${o.id}"]`), `Abstimmen an ${t}`).toHaveCount(['connector', 'frame', 'pen'].includes(t) ? 0 : 1);
    }
    await page.getByRole('region', { name: 'Abstimmung' }).getByRole('button', { name: 'Beenden' }).click();
    await page.getByRole('dialog', { name: 'Ergebnis' }).getByRole('button', { name: 'Fertig' }).click();

    // Kommentar an einer Karte und an einer Tabelle (Pin wandert mit)
    const card = all.find((o) => o.type === 'card')!;
    await page.evaluate((id) => {
      const api = (window as any).__stachel.api();
      api.setSelection([id]);
      api.zoomToSelection();
    }, card.id);
    await page.keyboard.press('Escape');
    const c = await centerOf(page, card.id);
    await page.keyboard.press('c');
    await page.mouse.click(c.x, c.y);
    await page.getByRole('textbox', { name: 'Kommentar', exact: true }).fill('Wer übernimmt das?');
    await page.keyboard.press('Enter');
    const threads = (await ydump(page, 'collab.comments')) as Record<string, { objectId?: string }>;
    expect(Object.values(threads).map((t) => t.objectId)).toContain(card.id);
    await page.keyboard.press('Escape');

    // Export des ganzen Boards mit allen Typen
    await page.evaluate(() => (window as any).__stachel.api().fitAll());
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Exportieren …' }).click();
    const dialog = page.getByTestId('export-dialog');
    await dialog.getByRole('radio', { name: /Ganzes Board/ }).check();
    const [png] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportieren' }).click()]);
    const buf = fs.readFileSync((await png.path())!);
    expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBeGreaterThan(1000);
    fs.writeFileSync(path.join(OUT, 'integration-export.png'), buf);

    // Suche findet Text aus Karten, Tabellen, Mindmap und Formen
    await page.keyboard.press('Control+f');
    const search = page.getByRole('search');
    for (const q of ['Budget', 'Einlass', 'Workshops', 'Kleinbusse']) {
      await search.getByRole('searchbox').fill(q);
      await expect(search).not.toContainText('Keine Treffer');
    }
    await page.keyboard.press('Escape');
    await shot(page, 'alle-typen');
  });

  test('Rich-Text: Wort fett in einer Form, Suche findet es; Rückgängig über die Module', async ({ page }) => {
    await page.evaluate(() => {
      const { store } = (window as any).__stachel;
      store.createMany([
        { id: 'f1', type: 'shape', shape: 'hexagon', x: -200, y: -100, w: 260, h: 180, color: '#c9e14a', text: '' },
        { id: 'n1', type: 'sticky', x: 120, y: -100, w: 200, h: 200, color: '#fff27a', text: 'Kasse' },
      ]);
      store.stopCapturing();
    });
    const f = await centerOf(page, 'f1');
    await page.mouse.dblclick(f.x, f.y);
    await expect(page.locator('.rt.editing')).toBeFocused();
    await page.keyboard.type('Bühne West');
    await expect(page.locator('.rt.editing')).toHaveText('Bühne West');
    await page.waitForTimeout(200);
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForFunction(() => {
      const { from, to } = (document.querySelector('.ProseMirror') as any).editor.state.selection;
      return to - from === 4;
    });
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-id="f1"] strong')).toHaveText('West');

    await page.keyboard.press('Control+f');
    await page.getByRole('search').getByRole('searchbox').fill('west');
    await expect(page.getByRole('search')).toContainText('1 von 1');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Reaktion, Kommentar, Form ändern – Strg Z nimmt eins nach dem anderen zurück
    await page.evaluate(() => (window as any).__stachel.api().setSelection(['n1']));
    const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
    await bar.getByRole('button', { name: 'Reagieren' }).click();
    await bar.getByRole('button', { name: 'Reaktion 🎉' }).click();
    await expect(page.locator('[data-reactions="n1"] .collab-chip')).toHaveCount(1);
    await page.keyboard.press('Escape');
    const n = await centerOf(page, 'n1');
    await page.keyboard.press('c');
    await page.mouse.click(n.x, n.y);
    await page.getByRole('textbox', { name: 'Kommentar', exact: true }).fill('Kasse doppelt besetzen');
    await page.keyboard.press('Enter');
    await expect(page.locator('.collab-pin[data-thread]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await page.getByTestId('board').focus();
    await page.keyboard.press('Control+z');
    await expect(page.locator('.collab-pin[data-thread]')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-reactions="n1"] .collab-chip')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-id="f1"] strong')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(page.locator('[data-id="f1"] strong')).toHaveText('West');
  });

  test('Strg K auf ausgewähltem Objekt: Link für den ganzen Text', async ({ page }) => {
    await page.evaluate(() => {
      const { store } = (window as any).__stachel;
      store.createMany([{ id: 'k1', type: 'sticky', x: -100, y: -100, w: 200, h: 200, color: '#fff27a', text: 'Infos' }]);
      store.stopCapturing();
      (window as any).__stachel.api().setSelection(['k1']);
    });
    await page.getByTestId('board').focus();
    await page.keyboard.press('Control+k');
    const input = page.getByRole('textbox', { name: 'Linkadresse' });
    await expect(input).toBeFocused();
    await input.fill('example.org');
    await input.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-id="k1"] a.rt-link')).toHaveText('Infos');
    await expect(page.locator('[data-id="k1"] a.rt-link')).toHaveAttribute('href', 'https://example.org/');
  });

  test('Kontextmenü: Untermenüs „Ebene“ und „Ausrichten“, Tastatur', async ({ page }) => {
    await page.evaluate(() => {
      const { store } = (window as any).__stachel;
      store.createMany([
        { id: 'a', type: 'sticky', x: -300, y: -100, w: 160, h: 160, color: '#fff27a', text: 'A' },
        { id: 'b', type: 'sticky', x: -60, y: 20, w: 160, h: 160, color: '#c9e14a', text: 'B' },
        { id: 'c', type: 'sticky', x: 180, y: -40, w: 160, h: 160, color: '#ffb3d1', text: 'C' },
      ]);
      store.stopCapturing();
      (window as any).__stachel.api().setSelection(['a', 'b', 'c']);
    });
    const p = await centerOf(page, 'b');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Kontextmenü' });
    await menu.getByRole('menuitem', { name: 'Ausrichten' }).hover();
    const sub = page.getByRole('menu', { name: 'Ausrichten' });
    await expect(sub).toBeVisible();
    await page.waitForTimeout(150);
    await shot(page, 'kontextmenue-ausrichten');
    await sub.getByRole('menuitem', { name: 'Oben' }).click();
    await expect.poll(async () => new Set((await objects(page)).map((o) => o.y)).size).toBe(1);

    // Tastatur: Ebene → Ganz nach hinten für „c“
    await page.evaluate(() => (window as any).__stachel.api().setSelection(['c']));
    const pc = await centerOf(page, 'c');
    await page.mouse.click(pc.x, pc.y, { button: 'right' });
    for (let i = 0; i < 20; i++) {
      const label = await page.locator('.ctxmenu__item.is-active span').first().textContent();
      if (label === 'Ebene') break;
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menu', { name: 'Ebene' })).toBeVisible();
    await page.keyboard.press('ArrowUp'); // letzter Eintrag: Ganz nach hinten
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect((await objects(page))[0].id).toBe('c');
  });

  test('Cursor-Chat: „/“ öffnet das Feld am Zeiger, andere Nachrichten erscheinen an ihrem Cursor', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__stachel.session.setPeers([
        { clientId: 201, user: { key: 'm:12', name: 'Mara Lindner', color: '#ec4e92' }, cursor: { x: 120, y: 80 }, selection: [], extra: { 'collab.chat': { text: 'Hier die Bühne?', typing: true } } },
      ]);
    });
    await expect(page.locator('.collab-cchat[data-chat="Mara Lindner"] .collab-cchat__text')).toHaveText('Hier die Bühne?');
    await page.mouse.move(500, 420);
    await page.getByTestId('board').focus();
    await page.keyboard.press('/');
    const input = page.getByRole('textbox', { name: 'Nachricht am Mauszeiger' });
    await expect(input).toBeFocused();
    await input.pressSequentially('Ja, genau da');
    await page.waitForTimeout(150);
    await shot(page, 'cursor-chat');
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
    // Esc verwirft
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Nachricht am Mauszeiger' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Nachricht am Mauszeiger' })).toHaveCount(0);
    expect(await objects(page)).toHaveLength(0);
  });
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('alle Werkzeuge erreichbar: Kernwerkzeuge in der Leiste, Modul-Werkzeuge hinter „Weitere“', async ({ page }) => {
    await openOffline(page);
    const bar = page.getByRole('navigation', { name: 'Werkzeuge' });
    for (const t of ['select', 'sticky', 'text', 'shape', 'connector', 'pen', 'frame', 'image']) await expect(bar.locator(`:scope > [data-tool="${t}"]`), t).toBeVisible();
    await expect(bar.locator('[data-tool="hand"]')).toHaveCount(0);
    await bar.getByRole('button', { name: 'Weitere Werkzeuge' }).tap();
    const more = page.getByRole('group', { name: 'Weitere Werkzeuge' });
    for (const label of ['Vorlagen', 'Kommentar', 'Karte, Tabelle, Mindmap', 'Sticker', 'Laserpointer']) await expect(more.getByRole('button', { name: label }), label).toBeVisible();
    await page.waitForTimeout(150);
    await shot(page, 'handy-werkzeuge');
    const box = (await bar.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});

test('Vorlage im Editor: Hinweis „Vorlage“ neben dem Titel', async ({ page }) => {
  const boards = sampleBoards().map((b, i) => (i === 0 ? { ...b, template: true } : b));
  await installFakeApi(page, { loggedIn: true, boards });
  await page.goto(`/?b=${boards[0].id}`);
  await expect(page.getByTestId('board-title')).toHaveText(boards[0].title);
  await expect(page.getByTestId('template-badge')).toHaveText('Vorlage');
});
