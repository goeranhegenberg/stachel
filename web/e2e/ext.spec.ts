// Erweiterungspunkte (docs/architecture.md): ein Feature-Modul trägt sich zur Laufzeit in alle Register ein –
// ohne Änderung an Editor.tsx, ObjectLayer.tsx oder editor.css. Dazu Tastatur-Navigation und Bild-Farbe.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { objects, openOffline, selection } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');

test.beforeEach(async ({ page }) => {
  await openOffline(page);
});

test('Feature-Modul: Typ, Werkzeug, Kontextleiste, Kürzel, Menüs, Seitenleiste, Slots, Dialog, eigene Y-Struktur', async ({ page }) => {
  await page.evaluate(() => {
    const { ext, h, api } = (window as any).__stachel;
    // Objekttyp „Plakette“: runde Fläche mit Zahl
    ext.defineObjectType({
      type: 'badge',
      label: 'Plakette',
      View: ({ o }: any) =>
        h(
          'div',
          {
            className: 'obj',
            'data-id': o.id,
            'data-type': 'badge',
            style: { transform: `translate(${o.x}px, ${o.y}px)`, width: o.w, height: o.h, borderRadius: '50%', background: o.color ?? '#ec4e92', color: '#fff', display: 'grid', placeItems: 'center', font: '700 32px Barlow' },
          },
          String(o.text ?? ''),
        ),
      simpleStyle: (o: any) => ({ background: o.color ?? '#ec4e92', borderRadius: '50%' }),
      defaultSize: { w: 80, h: 80 },
      palette: ['#ec4e92', '#1763b5'],
      defaultColor: '#ec4e92',
      rotatable: true,
    });
    ext.defineTool({
      id: 'badge',
      label: 'Plakette',
      order: 95,
      key: 'b',
      Icon: () => h('span', { style: { font: '800 18px Barlow' } }, '#'),
      down: (e: any, a: any) => {
        a.create({ type: 'badge', x: Math.round(e.world.x - 40), y: Math.round(e.world.y - 40), w: 80, h: 80, text: '1' }, { select: true });
      },
    });
    ext.defineContextAction({
      id: 'badge.plus',
      order: 85,
      when: (c: any) => c.types.size === 1 && c.types.has('badge'),
      Bar: (p: any) =>
        h('div', { className: 'ctx-group' }, h('button', { className: 'ctx-btn', 'aria-label': 'Hochzählen', onClick: () => p.patch((o: any) => ({ text: String(Number(o.text ?? 0) + 1) })) }, '+1')),
    });
    ext.defineShortcut({
      id: 'badge.reset',
      keys: ['mod+shift+0'],
      run: (a: any) => a.patchSelection((o: any) => (o.type === 'badge' ? { text: '0' } : null)),
      help: { group: 'Plaketten', keys: 'Strg Umschalt 0', label: 'Zurücksetzen', order: 10 },
    });
    ext.defineMenuItem({ id: 'badge.clear', on: 'object', order: 95, item: (a: any) => ({ label: 'Plakette leeren', onSelect: () => a.patchSelection(() => ({ text: '' })) }) });
    ext.defineMenuItem({ id: 'board.export', on: 'board', order: 10, item: (a: any) => ({ label: 'Exportieren', onSelect: () => a.toast('Export gestartet') }) });
    ext.defineSidebarTab({
      id: 'badges',
      title: 'Plaketten',
      order: 10,
      button: true,
      Icon: () => h('span', { style: { font: '800 16px Barlow' } }, '#'),
      Panel: ({ snap }: any) =>
        h(
          'ul',
          { 'data-testid': 'badge-list', style: { margin: 0, paddingLeft: 18 } },
          snap.ordered.filter((o: any) => o.type === 'badge').map((o: any) => h('li', { key: o.id }, `Plakette ${o.text}`)),
        ),
    });
    ext.defineSlot({
      id: 'badge.count',
      slot: 'topbarRight',
      order: 10,
      Component: ({ snap }: any) => h('div', { className: 'panel', 'data-testid': 'badge-count', style: { padding: '0 14px', height: 48, display: 'grid', placeItems: 'center' } }, `${snap.ordered.length} Objekte`),
    });
    ext.defineSlot({ id: 'badge.mark', slot: 'world', order: 10, Component: () => h('div', { 'data-testid': 'world-mark', style: { position: 'absolute', transform: 'translate(300px, 300px)', width: 6, height: 6, background: '#ec4e92' } }) });
    ext.defineModal({
      id: 'hello',
      Component: ({ onClose }: any) => h('div', { className: 'modal-backdrop' }, h('div', { className: 'modal', role: 'dialog', 'aria-label': 'Hallo' }, 'Hallo', h('button', { onClick: onClose }, 'Zu'))),
    });
    // neu zeichnen lassen (Register werden sonst beim Import gefüllt)
    api().setCamera({ ...api().camera() });
  });

  // Werkzeug mit Kürzel, Klick legt eine Plakette an
  await expect(page.locator('[data-tool="badge"]')).toBeVisible();
  await page.keyboard.press('b');
  await expect(page.locator('[data-tool="badge"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(720, 450);
  const badge = (await objects(page)).find((o) => o.type === 'badge')!;
  expect(badge).toMatchObject({ x: -40, y: -40, w: 80, h: 80, text: '1' });
  expect(await selection(page)).toEqual([badge.id]);
  await expect(page.locator(`[data-id="${badge.id}"]`)).toHaveText('1');
  await expect(page.locator('[data-handle="rotate"]')).toHaveCount(1);

  // Kontextleiste: Kern-Farbe (Palette des Typs) + eigene Gruppe
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await bar.getByRole('button', { name: 'Hochzählen' }).click();
  await expect(page.locator(`[data-id="${badge.id}"]`)).toHaveText('2');
  await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
  await bar.getByRole('button', { name: 'Farbe Blau' }).click();
  expect((await objects(page)).find((o) => o.id === badge.id)).toMatchObject({ color: '#1763b5' });

  // Kürzel
  await page.keyboard.press('Control+Shift+0');
  await expect(page.locator(`[data-id="${badge.id}"]`)).toHaveText('0');
  await page.keyboard.press('Control+z');
  await expect(page.locator(`[data-id="${badge.id}"]`)).toHaveText('2');

  // Kontextmenü (Rechtsklick)
  await page.mouse.click(720, 450, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Plakette leeren' }).click();
  await expect(page.locator(`[data-id="${badge.id}"]`)).toHaveText('');

  // Board-Menü
  await page.getByRole('button', { name: 'Board-Menü' }).click();
  await page.getByRole('menuitem', { name: 'Exportieren', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Export gestartet' })).toBeVisible();

  // Slots oben rechts und in der Welt-Ebene
  await expect(page.getByTestId('badge-count')).toHaveText('1 Objekte');
  await expect(page.getByTestId('world-mark')).toHaveCount(1);

  // Seitenleiste über den Knopf oben rechts; Esc schließt sie
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Plaketten' }).click();
  await expect(page.getByRole('complementary', { name: 'Plaketten' })).toBeVisible();
  await expect(page.getByTestId('badge-list')).toHaveText('Plakette ');
  await page.mouse.click(400, 300);
  await page.waitForTimeout(4500); // Einblenden und Toast abwarten
  await page.screenshot({ path: path.join(OUT, 'ext-seitenleiste.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Plaketten' })).toHaveCount(0);

  // Kürzel-Übersicht listet die neue Gruppe
  await page.keyboard.press('?');
  await expect(page.getByRole('heading', { name: 'Plaketten' })).toBeVisible();
  await page.getByRole('button', { name: 'Schließen' }).click();

  // Dialog über die API
  await page.evaluate(() => (window as any).__stachel.api().openModal('hello'));
  await expect(page.getByRole('dialog', { name: 'Hallo' })).toBeVisible();
  await page.getByRole('button', { name: 'Zu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Hallo' })).toHaveCount(0);

  // eigene Y-Struktur neben 'objects': Rückgängig über den Store
  const votes = await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    const m = store.extMap('votes');
    store.stopCapturing();
    store.transact(() => m.set('a', 3));
    store.stopCapturing();
    const before = m.get('a');
    store.undo();
    return [before, m.get('a') ?? null];
  });
  expect(votes).toEqual([3, null]);
});

test('Tastatur: Tab wählt das nächste Objekt, Ansage für Screenreader', async ({ page }) => {
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    store.createMany([
      { id: 'n1', type: 'sticky', x: -400, y: -100, w: 200, h: 200, text: 'Eins' },
      { id: 'n2', type: 'sticky', x: -100, y: -100, w: 200, h: 200, text: 'Zwei' },
      { id: 'n3', type: 'shape', shape: 'ellipse', x: 2600, y: -100, w: 200, h: 200, text: 'Weit weg' },
    ]);
  });
  await page.getByTestId('board').focus();
  await page.keyboard.press('Tab');
  expect(await selection(page)).toEqual(['n1']);
  await expect(page.getByTestId('announcer')).toHaveText(/Haftnotiz „Eins“ ausgewählt/);
  await page.keyboard.press('Tab');
  expect(await selection(page)).toEqual(['n2']);
  // drittes Objekt liegt außerhalb: Kamera holt es ins Bild
  await page.keyboard.press('Tab');
  expect(await selection(page)).toEqual(['n3']);
  await expect(page.getByTestId('announcer')).toHaveText(/Ellipse „Weit weg“ ausgewählt/);
  await expect(page.locator('[data-id="n3"]')).toBeInViewport();
  await page.keyboard.press('Shift+Tab');
  expect(await selection(page)).toEqual(['n2']);
  // am Ende verlässt der Fokus das Board (keine Tastaturfalle)
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('board')).not.toBeFocused();
});

test('Bild-Upload speichert die Durchschnittsfarbe am Bild', async ({ page }) => {
  // 2×1-PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAIAKg4D/2MLmzYAAAAASUVORK5CYII=', 'base64');
  await page.getByTestId('image-input').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'image').length).toBe(1);
  const img = (await objects(page)).find((o) => o.type === 'image') as { color?: string };
  expect(img.color).toMatch(/^#[0-9a-f]{6}$/);
  await expect(page.locator('.upload-ph')).toHaveCount(0);
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('mehr als 9 Werkzeuge: der Rest steckt hinter „Weitere Werkzeuge“, Seitenleisten im Board-Menü', async ({ page }) => {
    await page.evaluate(() => {
      const { ext, h, api } = (window as any).__stachel;
      for (const [id, order] of [['t.a', 72], ['t.b', 74], ['t.c', 76]] as const)
        ext.defineTool({ id, label: `Werkzeug ${id}`, order, Icon: () => h('span', null, id.slice(2)), down: () => {} });
      ext.defineSidebarTab({ id: 't.panel', title: 'Notizen', order: 10, button: true, Icon: () => h('span', null, 'K'), Panel: () => h('p', null, 'Leer') });
      api().setCamera({ ...api().camera() });
    });
    const bar = page.getByRole('navigation', { name: 'Werkzeuge' });
    await expect(bar.locator(':scope > .tb-btn')).toHaveCount(9);
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await bar.getByRole('button', { name: 'Weitere Werkzeuge' }).tap();
    await page.getByRole('group', { name: 'Weitere Werkzeuge' }).getByRole('button', { name: 'Bild einfügen' }).waitFor();
    await page.getByRole('group', { name: 'Weitere Werkzeuge' }).getByRole('button', { name: 'Werkzeug t.c' }).tap();
    await expect(bar.getByRole('button', { name: 'Weitere Werkzeuge' })).toHaveClass(/is-active/);
    expect(await page.evaluate(() => (window as any).__stachel.api().tool())).toBe('t.c');
    // Seitenleisten-Knopf: am Handy im Board-Menü
    await expect(page.getByRole('button', { name: 'Notizen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Board-Menü' }).tap();
    await page.getByRole('menuitem', { name: 'Notizen' }).tap();
    await expect(page.getByRole('complementary', { name: 'Notizen' })).toBeVisible();
  });
});
