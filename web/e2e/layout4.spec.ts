// Layout-Prüfung über viele Bildschirmgrößen (Runde 4, Bereich „Layout, Leisten, Dialoge“).
// Für Handy (hoch/quer), Tablet, niedrige Fenster, Browser-Zoom-Entsprechungen und große Monitore wird geprüft, dass alle
// sichtbaren festen Oberflächen-Elemente im Bild liegen und sich nicht überlappen: im Editor mit Auswahl
// (Kontextleiste), mit offenem Dialog und in der Präsentation. Das sichert die ganze Klasse „ragt raus / liegt drüber“ ab.
import { expect, test, type Page } from '@playwright/test';
import { openOffline } from './helpers';
import { installFakeApi, sampleBoards, type FakeBoard } from './fakeApi';

/** Belegbilder nur auf Wunsch (LAYOUT4_SHOTS=<Ordner>), test-results teilen sich parallele Läufe */
const SHOTS = process.env.LAYOUT4_SHOTS;
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve());

type VP = { name: string; width: number; height: number; touch?: boolean };

/** Raster wie im Bericht x-display; z… = 1440×900 bei Browser-Zoom 150 % bzw. 200 %. */
const VIEWPORTS: VP[] = [
  { name: 'p320', width: 320, height: 568, touch: true },
  { name: 'p360', width: 360, height: 740, touch: true },
  { name: 'p390', width: 390, height: 844, touch: true },
  { name: 'l740', width: 740, height: 360, touch: true },
  { name: 'l844', width: 844, height: 390, touch: true },
  { name: 't768', width: 768, height: 1024, touch: true },
  { name: 't1024', width: 1024, height: 768, touch: true },
  { name: 'z200', width: 720, height: 450 },
  { name: 'w800', width: 800, height: 400 },
  { name: 'z150', width: 960, height: 600 },
  { name: 'low1024', width: 1024, height: 500 },
  { name: 'low1280', width: 1280, height: 600 },
  { name: 'd1280', width: 1280, height: 720 },
  { name: 'd1440', width: 1440, height: 900 },
  { name: 'd1920', width: 1920, height: 1080 },
  { name: 'd3840', width: 3840, height: 2160 },
];

/** Feste Leisten (Bildschirm-Elemente, die immer da sind) */
const CHROME = ['.topbar--left > *', '.topbar--right > *', '.toolbar', '.history', '.minimap', '.zoombar', '.ctxbar', '.present-bar'];

type Audit = { outside: string[]; overlaps: string[]; scroll: string[] };

/** Im Browser: Elemente außerhalb des Viewports, paarweise Überlappungen, Seiten-Scrollbalken. */
function audit(page: Page, selectors = CHROME): Promise<Audit> {
  return page.evaluate((selectors) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const out: Audit = { outside: [], overlaps: [], scroll: [] };
    const name = (el: Element) => {
      const c = (typeof el.className === 'string' ? el.className : '')
        .split(/\s+/)
        .filter((x) => x && x !== 'panel' && !x.startsWith('is-'))
        .slice(0, 2)
        .join('.');
      const l = el.getAttribute('aria-label');
      return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${l ? `[${l}]` : ''}`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const se = document.scrollingElement!;
    if (se.scrollWidth > vw + 1 || se.scrollHeight > vh + 1) out.scroll.push(`Seite scrollt ${se.scrollWidth}×${se.scrollHeight}`);
    const els = [...new Set(selectors.flatMap((s) => [...document.querySelectorAll(s)]))].filter(visible);
    const fmt = (r: DOMRect) => `[${Math.round(r.left)},${Math.round(r.top)} – ${Math.round(r.right)},${Math.round(r.bottom)}]`;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.outside.push(`${name(el)} ${fmt(r)}`);
      // Knöpfe in der Leiste ebenfalls (die Leiste selbst kann z. B. per max-width passen, ihr Inhalt aber nicht)
      for (const b of el.querySelectorAll('button')) {
        if (!visible(b) || b.closest('.ctx-pop, .flyout, .ctxbar__morepop')) continue;
        const rb = b.getBoundingClientRect();
        if (rb.left < -1 || rb.top < -1 || rb.right > vw + 1 || rb.bottom > vh + 1) out.outside.push(`${name(b)} in ${name(el)} ${fmt(rb)}`);
      }
    }
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i];
        const b = els[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix > 1 && iy > 1) out.overlaps.push(`${name(a)} ${fmt(ra)} × ${name(b)} ${fmt(rb)}`);
      }
    return out;
  }, selectors);
}

async function expectClean(page: Page, what: string, selectors?: string[]) {
  const a = await audit(page, selectors);
  expect([...a.scroll, ...a.outside.map((s) => `außerhalb: ${s}`), ...a.overlaps.map((s) => `überlappt: ${s}`)], what).toEqual([]);
}

/** Objekt per Kamera an eine Bildschirmstelle bringen (Anteil der Breite/Höhe) und auswählen. */
async function selectAt(page: Page, ids: string[], fx = 0.5, fy = 0.55, z = 1) {
  await page.evaluate(
    ({ ids, fx, fy, z }) => {
      const s = (window as any).__stachel;
      const objs = ids.map((id) => s.store.get(id));
      const x0 = Math.min(...objs.map((o: any) => o.x));
      const y0 = Math.min(...objs.map((o: any) => o.y));
      const x1 = Math.max(...objs.map((o: any) => o.x + o.w));
      const y1 = Math.max(...objs.map((o: any) => o.y + o.h));
      s.setCamera({ x: innerWidth * fx - ((x0 + x1) / 2) * z, y: innerHeight * fy - ((y0 + y1) / 2) * z, z });
      s.api().setSelection(ids);
    },
    { ids, fx, fy, z },
  );
  await expect(page.getByRole('toolbar', { name: 'Auswahl bearbeiten' })).toBeVisible();
  await page.waitForTimeout(150);
}

const SELECTIONS: { name: string; ids: string[]; z?: number }[] = [
  { name: 'Notiz', ids: ['demo-s3'] },
  { name: 'Form', ids: ['demo-b'] },
  { name: 'Verbinder', ids: ['demo-c4'] },
  { name: 'Mehrfach', ids: ['demo-s1', 'demo-s2', 'demo-a'], z: 0.5 },
];

const DIALOGS: { id: string; action: RegExp }[] = [
  { id: 'tools.export', action: /^Exportieren$/ },
  { id: 'tools.settings', action: /^Fertig$/ },
  { id: 'collab.voteStart', action: /^Abstimmung starten$/ },
  { id: 'shortcuts', action: /^Schließen$/ },
  { id: 'structure.templates', action: /./ },
];

for (const vp of VIEWPORTS) {
  test.describe(`Layout ${vp.name} (${vp.width}×${vp.height}${vp.touch ? ', Touch' : ''})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch });

    test('Leisten ohne und mit Auswahl: alles im Bild, nichts überlappt', async ({ page }) => {
      await openOffline(page, true);
      await page.waitForTimeout(200);
      await expectClean(page, 'ohne Auswahl');
      for (const s of SELECTIONS) {
        for (const [fx, where] of [
          [0.5, 'Mitte'],
          [0.1, 'links'],
          [0.92, 'rechts'],
        ] as const) {
          await selectAt(page, s.ids, fx, 0.55, s.z);
          await expectClean(page, `${s.name} ${where}`);
          // alle Knöpfe der Kontextleiste sind erreichbar: entweder in der Leiste oder hinter „Weitere Aktionen“
          const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
          const more = bar.getByRole('button', { name: 'Weitere Aktionen' });
          if (await more.count()) {
            await more.click();
            const pop = page.getByRole('group', { name: 'Weitere Aktionen' });
            await expect(pop).toBeVisible();
            // Popover dürfen über Leisten liegen, müssen aber ganz im Bild sein
            await expect(pop, `${s.name} ${where}: Menü „···“ im Bild`).toBeInViewport({ ratio: 1 });
            await expectClean(page, `${s.name} ${where}, Mehr offen`);
            await more.click();
            await expect(pop).toBeHidden();
          }
          if (s.name === 'Notiz' || s.name === 'Form') {
            const del = bar.getByRole('button', { name: 'Löschen' });
            if (!(await del.isVisible())) await more.click();
            await expect(del).toBeVisible();
            // im Menü „···“ ggf. erst hinscrollen (niedrige Fenster), wie ein Mensch
            await del.scrollIntoViewIfNeeded();
            await expect(del).toBeInViewport({ ratio: 1 });
            await page.keyboard.press('Escape');
          }
        }
        await page.evaluate(() => (window as any).__stachel.api().setSelection([]));
      }
      await shot(page, `${vp.name}-auswahl`);
    });

    test('Dialoge: höchstens so groß wie der Bildschirm, Knöpfe sichtbar', async ({ page }) => {
      await openOffline(page, true);
      for (const d of DIALOGS) {
        await page.evaluate((id) => (window as any).__stachel.api().openModal(id), d.id);
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        await page.waitForTimeout(250);
        const box = (await modal.boundingBox())!;
        expect(box.x, `${d.id} links`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${d.id} oben`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${d.id} rechts`).toBeLessThanOrEqual(vp.width + 0.5);
        expect(box.y + box.height, `${d.id} unten`).toBeLessThanOrEqual(vp.height + 0.5);
        await expect(modal.locator('h2').first(), `${d.id} Titel`).toBeInViewport({ ratio: 1 });
        if (d.id !== 'structure.templates') {
          const btn = modal.locator('.modal-actions').getByRole('button', { name: d.action });
          await expect(btn, `${d.id} Knopf`).toBeInViewport({ ratio: 1 });
          // wirklich anklickbar (nicht unter etwas anderem)
          const hit = await btn.evaluate((b) => {
            const r = b.getBoundingClientRect();
            const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!e && b.contains(e);
          });
          expect(hit, `${d.id} Knopf frei`).toBe(true);
        }
        // nichts ragt waagerecht aus dem Dialog: weder Scrollbreite noch ein abgeschnittenes Element (z. B. die
        // Format-Karten des Exports bei 320 px, die nur weggeschnitten statt gescrollt wurden)
        const wide = await modal.evaluate((m) => [m, ...m.querySelectorAll('.modal__body')].some((e) => e.scrollWidth > e.clientWidth + 1));
        expect(wide, `${d.id} waagerecht zu breit`).toBe(false);
        const clipped = await modal.evaluate((m) => {
          const r0 = m.getBoundingClientRect();
          const cs = getComputedStyle(m);
          // Inhaltsfläche (ohne Innenabstand): dorthin gehört alles
          const box = { left: r0.left + parseFloat(cs.paddingLeft), right: r0.right - parseFloat(cs.paddingRight) };
          return [...m.querySelectorAll<HTMLElement>('button, label, select, input, .seg, [role="radiogroup"]')]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
            })
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.left < box.left - 1 || r.right > box.right + 1;
            })
            .map((e) => `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 60));
        });
        expect(clipped, `${d.id} Elemente ragen seitlich heraus`).toEqual([]);
        await shot(page, `${vp.name}-dlg-${d.id}`);
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0);
      }
    });

    test('Präsentation: Leiste im Bild, Zähler einzeilig', async ({ page }) => {
      await openOffline(page, true);
      await page.getByRole('button', { name: 'Rahmen-Liste' }).click();
      await page.getByRole('button', { name: /Präsentieren/ }).click();
      const bar = page.locator('.present-bar');
      await expect(bar).toBeVisible();
      await page.waitForTimeout(300);
      await expectClean(page, 'Präsentation');
      const pos = bar.locator('.present-bar__pos');
      const h = await pos.evaluate((e) => e.getBoundingClientRect().height);
      expect(h, 'Zähler einzeilig').toBeLessThan(30);
      await shot(page, `${vp.name}-praesentation`);
    });
  });
}

// ---- Einzelbefunde ------------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
const add = (page: Page, obj: Record<string, unknown>): Promise<string> => page.evaluate((o) => (window as any).__stachel.store.create(o), obj);

test.describe('Kontextleiste: Lage', () => {
  test('verdeckt weder Nachbarobjekte (oben oder unten, wo frei) noch die linke Werkzeugleiste', async ({ page }) => {
    await openOffline(page);
    // dicht übereinander wie in einer Mindmap: über der Auswahl liegt ein Knoten, darunter ist frei
    const top = await add(page, { type: 'sticky', x: 0, y: -170, w: 200, h: 100, text: 'oben' });
    const mid = await add(page, { type: 'sticky', x: 0, y: 0, w: 200, h: 100, text: 'Mitte' });
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 620, y: 400, z: 1 }));
    await page.evaluate((id) => (window as any).__stachel.api().setSelection([id]), mid);
    const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
    await expect(bar).toBeVisible();
    const bb = (await bar.boundingBox())!;
    expect(hit(bb, (await page.locator(`[data-id="${top}"]`).boundingBox())!), 'Leiste über dem Nachbarn').toBe(false);
    expect(hit(bb, (await page.locator(`[data-id="${mid}"]`).boundingBox())!), 'Leiste über der Auswahl').toBe(false);
    // ohne Nachbarn: wie gewohnt oben
    await page.evaluate((id) => (window as any).__stachel.store.remove(new Set([id])), top);
    await page.waitForTimeout(100);
    const bb2 = (await bar.boundingBox())!;
    const mb = (await page.locator(`[data-id="${mid}"]`).boundingBox())!;
    expect(bb2.y + bb2.height).toBeLessThan(mb.y);

    // ganz links: nicht über den Werkzeugen
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 0, y: 400, z: 1 }));
    await page.waitForTimeout(100);
    const tb = (await page.getByRole('navigation', { name: 'Werkzeuge' }).boundingBox())!;
    expect(hit((await bar.boundingBox())!, tb), 'Leiste über der Werkzeugleiste').toBe(false);
  });

  test('Handy: Menü „···“ mit Namen, Löschen per Tipp', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await openOffline(page, true);
    await page.locator('[data-id="demo-s3"]').tap();
    const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
    // eine Zeile (keine vier unordentlichen Zeilen mehr)
    expect((await bar.boundingBox())!.height).toBeLessThan(60);
    await bar.getByRole('button', { name: 'Weitere Aktionen' }).tap();
    const more = page.getByRole('group', { name: 'Weitere Aktionen' });
    await expect(more).toBeInViewport({ ratio: 1 });
    // Kacheln tragen Namen (kein Tooltip am Handy)
    await expect(more.getByRole('button', { name: 'Löschen' })).toHaveAttribute('data-name', 'Löschen');
    await expect(more.getByRole('button', { name: /^Fett/ })).toHaveAttribute('data-name', 'Fett');
    await shot(page, 'handy-mehr');
    await more.getByRole('button', { name: 'Löschen' }).tap();
    await expect(page.locator('[data-id="demo-s3"]')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('Alles einpassen', () => {
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 1280, height: 600 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    test(`${vp.width}×${vp.height}: kein Inhalt unter Übersichtskarte, Zoom oder Werkzeugen`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      await openOffline(page, true);
      // ausladender Inhalt nach rechts unten (wie Lageplan/Festival-Vorlage)
      await add(page, { type: 'sticky', x: 1900, y: 700, w: 200, h: 200, text: 'Ecke' });
      await page.getByRole('button', { name: 'Alles einpassen' }).click();
      await page.waitForTimeout(400);
      const objs = await page.locator('.world .obj').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { id: (e as HTMLElement).dataset.id, x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      );
      const chrome = await page.locator('.topbar--left > *, .topbar--right > *, .toolbar, .history, .minimap, .zoombar').evaluateAll((els) =>
        els
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { cls: (e as HTMLElement).className, x: r.x, y: r.y, width: r.width, height: r.height };
          })
          .filter((r) => r.width > 0),
      );
      const bad = objs.flatMap((o) => chrome.filter((c) => hit(o, c)).map((c) => `${o.id} unter ${c.cls}`));
      expect(bad).toEqual([]);
      await ctx.close();
    });
  }
});

test.describe('Oberfläche ausblenden und Vollbild', () => {
  test('Strg \\ blendet alle Leisten aus, das Auge holt sie zurück; Board-Menü bietet beides', async ({ page }) => {
    await openOffline(page, true);
    await page.getByTestId('board').click({ position: { x: 700, y: 120 } });
    await page.keyboard.press('Control+Backslash');
    for (const sel of ['.topbar--left', '.toolbar', '.history', '.bottom-right']) await expect(page.locator(sel)).toBeHidden();
    const eye = page.getByRole('button', { name: 'Oberfläche einblenden' });
    await expect(eye).toBeVisible();
    await shot(page, 'fokus');
    await eye.click();
    await expect(page.locator('.toolbar')).toBeVisible();
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await expect(page.getByRole('menuitem', { name: /Vollbild/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /Oberfläche ausblenden/ }).click();
    await expect(page.locator('.toolbar')).toBeHidden();
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('.toolbar')).toBeVisible();
  });
});

test.describe('Kopfleiste', () => {
  for (const vp of [
    { width: 390, height: 844, min: 90 },
    { width: 768, height: 1024, min: 90 },
  ]) {
    test(`${vp.width} px: Board-Titel lesbar, Board-Menü frei`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      await openOffline(page, true);
      const title = page.getByRole('button', { name: 'Offline-Board' });
      expect((await title.boundingBox())!.width).toBeGreaterThanOrEqual(vp.min);
      // „···“ wirklich antippbar (nicht unter Timer/Abstimmung)
      const menu = page.getByRole('button', { name: 'Board-Menü' });
      const free = await menu.evaluate((b) => {
        const r = b.getBoundingClientRect();
        return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
      expect(free).toBe(true);
      await ctx.close();
    });
  }

  test('Touch: Hinweise ohne Maus-/Tastaturbegriffe', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await openOffline(page);
    await expect(page.locator('.empty-hint')).toContainText('Doppeltippen');
    await page.getByRole('button', { name: 'Board-Menü' }).tap();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Mausrad|Tastenkürzel/ })).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('Board-Übersicht', () => {
  const many = (): FakeBoard[] => Array.from({ length: 12 }, (_, i) => ({ ...sampleBoards()[0], id: `b${i}`, title: `Board ${i + 1}` }));

  test('große Monitore: mehr als 4 Spalten', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
    const page = await ctx.newPage();
    await installFakeApi(page, { loggedIn: true, boards: many() });
    await page.goto('/');
    const cards = page.locator('.board-card');
    await expect(cards.first()).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, 'uebersicht-2560');
    const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    // erste Zeile (Karten gleiten beim Einblenden ein paar Pixel)
    expect(tops.filter((t) => Math.abs(t - tops[0]) < 30).length, JSON.stringify(tops)).toBeGreaterThan(4);
    await ctx.close();
  });

  test('Notch: Kopfzeile unter der Statusleiste (Safe-Area)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const ok = await cdp
      .send('Emulation.setSafeAreaInsetsOverride' as any, { insets: { top: 47, bottom: 34, left: 0, right: 0 } })
      .then(() => true)
      .catch(() => false);
    test.skip(!ok, 'Safe-Area-Emulation fehlt in diesem Chromium');
    await installFakeApi(page, { loggedIn: true, boards: many() });
    await page.goto('/');
    const logout = page.getByRole('button', { name: /Abmelden/ });
    await expect(logout).toBeVisible();
    expect((await logout.boundingBox())!.y).toBeGreaterThanOrEqual(47);
    await ctx.close();
  });
});

test.describe('Fenstergröße ändern', () => {
  test('Kontextmenü außerhalb des neuen Bildes schließt sich, Popover der Kontextleiste rückt ins Bild', async ({ page }) => {
    await openOffline(page, true);
    await page.mouse.click(1250, 560, { button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.setViewportSize({ width: 900, height: 600 });
    await expect(menu).toHaveCount(0);

    // Popover der Kontextleiste: nach dem Verkleinern wieder ganz im Bild
    await page.setViewportSize({ width: 1440, height: 900 });
    await selectAt(page, ['demo-b'], 0.75, 0.75);
    // erstes Popover der Leiste (Farbe bzw. Füllung)
    await page.locator('.ctxbar > .ctx-group [aria-haspopup="true"]').first().click();
    const pop = page.locator('.ctxbar > .ctx-pop');
    await expect(pop).toBeVisible();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(300);
    if (await pop.count()) await expect(pop).toBeInViewport({ ratio: 1 });
  });
});
