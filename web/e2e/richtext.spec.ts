// Rich-Text (Feature-Modul richtext): Format je Wort, Format-Leiste, Links, Listen, Schrift, Migration, Undo,
// Formen und Verbinder-Beschriftung, viele Objekte. Gleichzeitiges Tippen zweier Personen: richtext-sync.spec.ts.
// Port: PW_PORT=5191.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { centerOf, objects, openOffline } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `richtext-${name}.png`) });

const editing = (page: Page) => page.locator('.rt.editing');
const bar = (page: Page) => page.getByTestId('richtext-bar');

/** Objekt per Store anlegen (wie ein alter Client: nur `text`). */
async function add(page: Page, obj: Record<string, unknown>): Promise<string> {
  return page.evaluate((o) => (window as any).__stachel.store.create(o), obj);
}
const get = (page: Page, id: string) => page.evaluate((i) => (window as any).__stachel.store.get(i), id);

async function newSticky(page: Page, at = { x: 520, y: 420 }) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await page.mouse.click(at.x, at.y);
  await expect(editing(page)).toBeFocused();
}

/** Wort im Editor markieren (DOM-Auswahl wie mit der Maus) und warten, bis ProseMirror sie übernommen hat. */
async function selectWord(page: Page, word: string) {
  await editing(page).evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const i = n.textContent!.indexOf(w);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + w.length);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
  }, word);
  await page.waitForFunction((w) => {
    const ed = (document.querySelector('.ProseMirror') as any)?.editor;
    const { from, to } = ed.state.selection;
    return ed.state.doc.textBetween(from, to) === w;
  }, word);
}

test.beforeEach(async ({ page }) => {
  await openOffline(page);
});

test('einzelne Wörter fett, kursiv, unterstrichen, durchgestrichen – schwebende Format-Leiste', async ({ page }) => {
  await newSticky(page);
  await expect(bar(page)).toBeVisible();
  // die Kern-Kontextleiste weicht beim Schreiben
  await expect(page.locator('.ctxbar')).toBeHidden();
  await page.keyboard.type('Bühne Nord aufbauen');
  await selectWord(page, 'Nord');
  await page.keyboard.press('Control+b');
  await selectWord(page, 'aufbauen');
  await page.keyboard.press('Control+i');
  await page.keyboard.press('Control+u');
  await selectWord(page, 'Bühne');
  await bar(page).getByRole('button', { name: /Durchgestrichen/ }).click();
  await expect(editing(page)).toBeFocused();
  await shot(page, 'leiste');
  await page.keyboard.press('Escape');
  await expect(editing(page)).toHaveCount(0);

  const s = (await objects(page)).find((o) => o.type === 'sticky')!;
  const full = await get(page, s.id);
  expect(full.text).toBe('Bühne Nord aufbauen');
  const t = page.locator(`[data-id="${s.id}"] .sticky-text`);
  await expect(t.locator('strong')).toHaveText('Nord');
  await expect(t.locator('em u, u em')).toHaveText('aufbauen');
  await expect(t.locator('s')).toHaveText('Bühne');
  // statische Darstellung: kein Editor außerhalb der Bearbeitung
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
});

test('ohne Auswahl gilt das Format für den ganzen Text; Farbe, Markierung, Listen, Schrift, Größe, Ausrichtung', async ({ page }) => {
  await newSticky(page);
  await page.keyboard.type('Bar aufbauen');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Kasse besetzen');
  // Textfarbe ohne Auswahl → ganzer Text
  await bar(page).getByRole('button', { name: 'Textfarbe', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Textfarbe Pink' }).click();
  await expect(editing(page)).toBeFocused();
  // Markierung nur für ein Wort
  await selectWord(page, 'Kasse');
  await bar(page).getByRole('button', { name: 'Markierung', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Markierung Grün' }).click();
  // ganzer Text als Aufzählung
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => !(document.querySelector('.ProseMirror') as any).editor.state.selection.empty);
  await bar(page).getByRole('button', { name: 'Aufzählung' }).click();
  await expect(editing(page).locator('ul > li')).toHaveCount(2);
  // Schriftart, Größe, Ausrichtung gelten fürs Objekt
  await bar(page).getByRole('button', { name: 'Schriftart' }).click();
  await bar(page).getByRole('button', { name: 'Serif' }).click();
  await bar(page).getByTestId('richtext-size').click();
  await bar(page).getByRole('button', { name: '28', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Ausrichtung' }).click();
  await bar(page).getByRole('button', { name: 'Linksbündig' }).click();
  await expect(editing(page)).toBeFocused();
  await shot(page, 'formate');
  await page.keyboard.press('Escape');

  const s = (await objects(page)).find((o) => o.type === 'sticky')!;
  const full = await get(page, s.id);
  expect(full).toMatchObject({ text: 'Bar aufbauen\nKasse besetzen', fontFamily: 'serif', fontSize: 28, align: 'left' });
  const t = page.locator(`[data-id="${s.id}"] .sticky-text`);
  await expect(t.locator('ul > li')).toHaveCount(2);
  await expect(t.locator('mark')).toHaveText('Kasse');
  expect(await t.locator('span[style*="color"]').count()).toBeGreaterThanOrEqual(2);
  expect(await t.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Source Serif 4');
  expect(await t.evaluate((el) => getComputedStyle(el).fontSize)).toBe('28px');
  // Größe wieder automatisch (Haftnotiz)
  const c = await centerOf(page, s.id);
  await page.mouse.dblclick(c.x, c.y);
  await bar(page).getByTestId('richtext-size').click();
  await bar(page).getByRole('button', { name: 'Auto' }).click();
  await page.keyboard.press('Escape');
  expect((await get(page, s.id)).fontSize).toBeUndefined();
});

test('Markdown-Kürzel für Listen, Tab rückt Listen ein', async ({ page }) => {
  await newSticky(page);
  await page.keyboard.type('- Strom');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Wasser');
  await page.keyboard.press('Tab');
  await expect(editing(page).locator('ul ul > li')).toHaveText('Wasser');
  await expect(page.locator('[data-type="sticky"]')).toHaveCount(1); // Tab legt hier keine neue Notiz an
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // leerer Eintrag beendet die Liste
  await page.keyboard.type('1. Erstens');
  await expect(editing(page).locator('ol > li')).toHaveText('Erstens');
  await page.keyboard.press('Escape');
  const s = (await objects(page)).find((o) => o.type === 'sticky')!;
  expect((await get(page, s.id)).text).toBe('Strom\nWasser\nErstens');
});

test('Links: Strg K, im Board anklickbar mit Nachfrage, unsichere Links abgelehnt', async ({ page, context }) => {
  await context.route('https://example.org/**', (r) => r.fulfill({ body: 'ok', contentType: 'text/plain' }));
  await newSticky(page);
  await page.keyboard.type('Infos: ');
  await page.keyboard.press('Control+k');
  const input = bar(page).getByRole('textbox', { name: 'Linkadresse' });
  await expect(input).toBeFocused();
  await input.fill('javascript:alert(1)');
  await input.press('Enter');
  await expect(bar(page).getByText('Das ist kein gültiger Link.')).toBeVisible();
  await input.fill('example.org');
  await input.press('Enter');
  await expect(editing(page)).toBeFocused();
  await expect(editing(page).locator('a')).toHaveAttribute('href', 'https://example.org/');
  // Text markieren und verlinken
  await page.keyboard.type(' und Tickets');
  await selectWord(page, 'Tickets');
  await page.keyboard.press('Control+k');
  await bar(page).getByRole('textbox', { name: 'Linkadresse' }).fill('https://example.org/tickets');
  await bar(page).getByRole('button', { name: 'Übernehmen' }).click();
  await page.keyboard.press('Escape');

  const s = (await objects(page)).find((o) => o.type === 'sticky')!;
  expect((await get(page, s.id)).text).toBe('Infos: example.org und Tickets');
  const link = page.locator(`[data-id="${s.id}"] a.rt-link`, { hasText: 'Tickets' });
  await expect(link).toHaveAttribute('href', 'https://example.org/tickets');
  // Klick auf den Link → Nachfrage
  await page.mouse.click(1000, 700);
  await link.click();
  const dlg = page.getByRole('dialog', { name: 'Link öffnen?' });
  await expect(dlg).toContainText('example.org/tickets');
  await shot(page, 'link');
  await dlg.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dlg).toBeHidden();
  await link.click();
  const popup = context.waitForEvent('page');
  await page.getByRole('dialog', { name: 'Link öffnen?' }).getByRole('button', { name: 'Öffnen' }).click();
  expect((await popup).url()).toBe('https://example.org/tickets');
});

test('Migration: altes Board mit Klartext, alter Client ändert nur text', async ({ page }) => {
  const id = await add(page, { type: 'sticky', x: 100, y: 100, w: 220, h: 220, color: '#c9e14a', text: 'Alte Notiz\nzweite Zeile' });
  const t = page.locator(`[data-id="${id}"] .sticky-text`);
  await expect(t).toHaveText('Alte Notiz\nzweite Zeile', { useInnerText: true });
  expect((await get(page, id)).content).toBeUndefined();
  // erst beim Bearbeiten entsteht content (je Zeile ein Absatz)
  const c = await centerOf(page, id);
  await page.mouse.dblclick(c.x, c.y);
  await expect(editing(page)).toBeFocused();
  await expect(editing(page).locator('p')).toHaveCount(2);
  await page.keyboard.press('Escape');
  expect((await get(page, id)).content.content).toHaveLength(2);
  // alter Client ändert nur `text` → `text` gilt
  await page.evaluate((i) => (window as any).__stachel.store.update(i, { text: 'vom alten Client' }), id);
  await expect(t).toHaveText('vom alten Client');
  await page.mouse.dblclick(c.x, c.y);
  await expect(editing(page)).toHaveText('vom alten Client');
  await page.keyboard.press('Escape');
  const after = await get(page, id);
  expect(after.text).toBe('vom alten Client');
  expect(after.content.content[0].content[0].text).toBe('vom alten Client');
});

test('Rückgängig: im Editor nur der Text, auf dem Board Text und content gemeinsam', async ({ page }) => {
  await newSticky(page);
  await page.keyboard.type('Erst');
  await page.waitForTimeout(800); // eigener Undo-Schritt
  await page.keyboard.type(' dann');
  await page.keyboard.press('Control+z');
  await expect(editing(page)).toHaveText('Erst');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z'); // Anlegen bleibt (Grenze der Bearbeitung)
  await expect(editing(page)).toHaveText('');
  await expect(page.locator('[data-type="sticky"]')).toHaveCount(1);
  await page.keyboard.press('Control+y');
  await expect(editing(page)).toHaveText('Erst');
  await page.keyboard.press('Escape');
  const s = (await objects(page)).find((o) => o.type === 'sticky')!;
  expect((await get(page, s.id)).text).toBe('Erst');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await get(page, s.id)).text).toBe('');
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await get(page, s.id)).text).toBe('Erst');
  expect((await get(page, s.id)).content.content[0].content[0].text).toBe('Erst');
});

test('Auto-Schriftgröße der Haftnotiz bleibt, auch mit Liste und anderer Schrift', async ({ page }) => {
  const short = await add(page, { type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Kurz' });
  const long = await add(page, { type: 'sticky', x: 240, y: 0, w: 200, h: 200, color: '#ffb3d1', text: 'Ein deutlich längerer Text auf der Notiz, der kleiner werden muss' });
  const list = await add(page, {
    type: 'sticky',
    x: 480,
    y: 0,
    w: 200,
    h: 200,
    color: '#c9e14a',
    fontFamily: 'condensed',
    align: 'left',
    text: 'Aufbau\nStrom legen\nZelte stellen\nBühne prüfen',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Aufbau' }] },
        {
          type: 'taskList',
          content: ['Strom legen', 'Zelte stellen', 'Bühne prüfen'].map((t, i) => ({
            type: 'taskItem',
            attrs: { checked: i === 0 },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
          })),
        },
      ],
    },
  });
  await page.evaluate(() => (window as any).__stachel.api().fitAll());
  await page.waitForTimeout(400);
  const fs = (id: string) => page.locator(`[data-id="${id}"] .sticky-text`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await fs(long)).toBeLessThan(await fs(short));
  const fits = (id: string) =>
    page.locator(`[data-id="${id}"] .sticky-text`).evaluate((el) => {
      const box = el.parentElement!;
      const pad = parseFloat(getComputedStyle(box).paddingTop) * 2;
      return el.scrollHeight <= box.clientHeight - pad + 1 && el.scrollWidth <= el.clientWidth + 1;
    });
  for (const id of [short, long, list]) expect(await fits(id)).toBe(true);
  const l = page.locator(`[data-id="${list}"] .sticky-text`);
  await expect(l.locator('h2')).toHaveText('Aufbau');
  await expect(l.locator('li[data-checked="true"]')).toHaveText('Strom legen');
  expect(await l.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Barlow Condensed');
  // die Liste füllt die Notiz sinnvoll aus (nicht winzig)
  expect(await fs(list)).toBeGreaterThan(12);
  await shot(page, 'haftnotizen');
});

test('Text auf Formen und als Beschriftung von Verbindern', async ({ page }) => {
  const shape = await add(page, { type: 'shape', shape: 'rect', x: 100, y: 100, w: 220, h: 140, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: '', fontSize: 20 });
  const a = await add(page, { type: 'sticky', x: 500, y: 100, w: 160, h: 160, text: 'A' });
  const conn = await page.evaluate(
    ({ a, s }) => (window as any).__stachel.store.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: s }, to: { objectId: a }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true }),
    { a, s: shape },
  );
  const c = await centerOf(page, shape);
  await page.mouse.dblclick(c.x, c.y);
  await expect(page.locator('.shape-text.editing')).toBeFocused();
  await page.keyboard.type('Kasse offen');
  await selectWord(page, 'offen');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Escape');
  await expect(page.locator(`[data-id="${shape}"] .shape-text strong`)).toHaveText('offen');

  // Beschriftung: Verbinder auswählen, Enter
  await page.evaluate((id) => (window as any).__stachel.api().setSelection([id]), conn);
  await page.locator('[data-testid="board"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.richtext-label-edit .rt.editing')).toBeFocused();
  await page.keyboard.type('nur mit Ticket');
  await selectWord(page, 'Ticket');
  await page.keyboard.press('Control+i');
  await expect(bar(page)).toBeVisible();
  await shot(page, 'beschriftung');
  await page.keyboard.press('Enter'); // beendet bei Beschriftungen
  await expect(page.locator('.richtext-label-edit')).toHaveCount(0);
  await expect(page.locator(`[data-id="${conn}"] .conn-label em`)).toHaveText('Ticket');
  expect((await get(page, conn)).text).toBe('nur mit Ticket');
});

test('Kontextleiste ohne Bearbeitung: Unterstrichen, Liste, Textfarbe, Schriftart fürs ganze Objekt; Kopie behält Format', async ({ page }) => {
  const id = await add(page, { type: 'sticky', x: 100, y: 100, w: 220, h: 220, text: 'Eins\nZwei' });
  await page.evaluate((i) => (window as any).__stachel.api().setSelection([i]), id);
  const ctx = page.locator('.ctxbar');
  await ctx.getByRole('button', { name: /Unterstrichen/ }).click();
  await ctx.getByRole('button', { name: 'Liste' }).click();
  await ctx.getByRole('button', { name: 'Nummerierte Liste' }).click();
  await ctx.getByRole('button', { name: 'Textfarbe', exact: true }).click();
  await ctx.getByRole('button', { name: 'Textfarbe Blau' }).click();
  await ctx.getByRole('button', { name: 'Schriftart' }).click();
  await ctx.getByRole('button', { name: 'Mono' }).click();
  const t = page.locator(`[data-id="${id}"] .sticky-text`);
  await expect(t.locator('ol > li')).toHaveCount(2);
  await expect(t.locator('u')).toHaveCount(2);
  expect((await get(page, id)).text).toBe('Eins\nZwei');
  await shot(page, 'kontextleiste');
  // Strg U auf dem Board schaltet zurück, Strg Z nimmt es zurück
  await page.locator('[data-testid="board"]').focus();
  await page.keyboard.press('Control+u');
  await expect(t.locator('u')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(t.locator('u')).toHaveCount(2);
  // Duplizieren behält Rich-Text
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-type="sticky"] ol')).toHaveCount(2);
  const copy = (await objects(page)).filter((o) => o.type === 'sticky').find((o) => o.id !== id)!;
  expect((await get(page, copy.id)).content).toEqual((await get(page, id)).content);
  // Tippen auf die ausgewählte Notiz hängt an und startet die Bearbeitung
  await page.keyboard.type('!');
  await expect(editing(page)).toBeFocused();
  await page.keyboard.type('?');
  await page.keyboard.press('Escape');
  expect((await get(page, copy.id)).text).toBe('Eins\nZwei!?');
});

test('2000 Notizen mit Rich-Text: kein Editor außer dem bearbeiteten', async ({ page }) => {
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    const list = [];
    for (let i = 0; i < 2000; i++) {
      list.push({
        type: 'sticky',
        x: (i % 50) * 230,
        y: Math.floor(i / 50) * 230,
        w: 200,
        h: 200,
        text: `Nr ${i} fett`,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Nr ${i} ` }, { type: 'text', text: 'fett', marks: [{ type: 'bold' }] }] }] },
      });
    }
    store.createMany(list);
  });
  await page.evaluate(() => (window as any).__stachel.setCamera({ x: 0, y: 0, z: 1 }));
  await expect(page.locator('.sticky-text strong').first()).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  const first = (await objects(page)).find((o) => o.text === 'Nr 0 fett')!;
  const c = await centerOf(page, first.id);
  await page.mouse.dblclick(c.x, c.y);
  await expect(page.locator('.ProseMirror')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
});

test('Text-Objekt: Größe und Rahmen folgen dem Rich-Text (Liste, Fett, Schriftgröße)', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await page.mouse.click(400, 300);
  await expect(editing(page)).toBeFocused();
  await page.keyboard.type('Ablauf');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Einlass');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Konzert');
  await page.keyboard.press('Control+a');
  await bar(page).getByRole('button', { name: 'Nummerierte Liste' }).click();
  await page.keyboard.press('Control+b');
  const t = (await objects(page)).find((o) => o.type === 'text')!;
  const rendered = () => page.locator(`[data-id="${t.id}"] .text-content`).evaluate((el) => ({ h: Math.ceil((el as HTMLElement).offsetHeight), w: (el as HTMLElement).scrollWidth }));
  // schon während des Schreibens passt der Rahmen
  await expect.poll(async () => Math.abs((await get(page, t.id)).h - (await rendered()).h)).toBeLessThanOrEqual(1);
  await bar(page).getByTestId('richtext-size').click();
  await bar(page).getByRole('button', { name: '48', exact: true }).click();
  await expect.poll(async () => Math.abs((await get(page, t.id)).h - (await rendered()).h)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  const o = await get(page, t.id);
  expect(o).toMatchObject({ text: 'Ablauf\nEinlass\nKonzert', fontSize: 48 });
  const r = await rendered();
  expect(Math.abs(o.h - r.h)).toBeLessThanOrEqual(1);
  // Breite folgt dem fetten Inhalt (autoWidth), nichts läuft über
  expect(r.w).toBeLessThanOrEqual(o.w + 1);
  await expect(page.locator(`[data-id="${t.id}"] ol > li strong`)).toHaveCount(3);
  await shot(page, 'text');
});

test('Schriftgröße für einzelne Wörter (Text und Form), Textfarbe fürs Objekt behält sie', async ({ page }) => {
  const id = await add(page, { type: 'text', x: 100, y: 100, w: 400, h: 40, fontSize: 24, autoWidth: true, color: '#0a0a0a', text: 'Einlass ab 18 Uhr' });
  const c = await centerOf(page, id);
  await page.mouse.dblclick(c.x, c.y);
  await expect(editing(page)).toBeFocused();
  await selectWord(page, '18 Uhr');
  await bar(page).getByTestId('richtext-size').click();
  await bar(page).getByRole('button', { name: '48', exact: true }).click();
  await expect(bar(page).getByTestId('richtext-size')).toHaveText('48');
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await expect(bar(page).getByTestId('richtext-size')).toHaveText('24');
  await page.keyboard.press('Escape');
  const t = page.locator(`[data-id="${id}"] .text-content`);
  const big = t.locator('span[style*="font-size"]');
  await expect(big).toHaveText('18 Uhr');
  expect(await big.evaluate((el) => getComputedStyle(el).fontSize)).toBe('48px');
  // Höhe folgt der größeren Zeile, Breite dem Inhalt
  const o = await get(page, id);
  expect(o.h).toBeGreaterThanOrEqual(55);
  expect(await t.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(o.w + 1);
  // Objektgröße per Ecke ändern skaliert die Teilgröße mit (em)
  await page.evaluate((i) => (window as any).__stachel.store.update(i, { fontSize: 12 }), id);
  await expect.poll(() => big.evaluate((el) => getComputedStyle(el).fontSize)).toBe('24px');

  // Form: Wort vergrößern, dann Textfarbe über die Kontextleiste – die Größe bleibt
  const shape = await add(page, { type: 'shape', shape: 'rect', x: 100, y: 300, w: 300, h: 160, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, fontSize: 20, text: 'Bühne Nord' });
  const sc = await centerOf(page, shape);
  await page.mouse.dblclick(sc.x, sc.y);
  await selectWord(page, 'Nord');
  await bar(page).getByTestId('richtext-size').click();
  await bar(page).getByRole('button', { name: '32', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.evaluate((i) => (window as any).__stachel.api().setSelection([i]), shape);
  const ctx = page.locator('.ctxbar');
  await ctx.getByRole('button', { name: 'Textfarbe', exact: true }).click();
  await ctx.getByRole('button', { name: 'Textfarbe Blau' }).click();
  const word = page.locator(`[data-id="${shape}"] .shape-text span[style*="font-size"]`);
  await expect(word).toHaveText('Nord');
  expect(await word.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(23, 99, 181)');
  await page.evaluate((i) => (window as any).__stachel.store.update(i, { fontSize: 24 }), id);
  await page.evaluate(() => (window as any).__stachel.api().fitAll());
  await page.waitForTimeout(500);
  await shot(page, 'groessen');
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 780 } });
  test('Format-Leiste unten angedockt, scrollbar, Popover über der Leiste', async ({ page }) => {
    const id = await add(page, { type: 'sticky', x: 0, y: 0, w: 220, h: 220, text: 'Getränke zählen' });
    await page.evaluate(() => (window as any).__stachel.api().fitAll());
    await page.evaluate((i) => {
      const api = (window as any).__stachel.api();
      api.startEditing(api.snapshot().byId?.get?.(i) ?? (window as any).__stachel.store.get(i));
    }, id);
    await expect(editing(page)).toBeFocused();
    const b = await bar(page).boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(390);
    expect(b!.y + b!.height).toBeGreaterThan(700);
    await selectWord(page, 'Getränke');
    await bar(page).getByRole('button', { name: 'Markierung', exact: true }).click();
    const pop = bar(page).getByRole('group', { name: 'Markierung' });
    await expect(pop).toBeVisible();
    const pb = await pop.boundingBox();
    expect(pb!.y + pb!.height).toBeLessThanOrEqual(b!.y);
    await shot(page, 'handy');
    await pop.getByRole('button', { name: 'Markierung Rosa' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator(`[data-id="${id}"] mark`)).toHaveText('Getränke');
  });
});
