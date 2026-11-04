// Runde 4 Rich-Text (Bericht x-text): abgeschnittene Listen, Word-Einfügen (pt-Größen, Listen, Markierung),
// Markierung bei großer Schrift, Tabs, sehr langer Text, Esc im Menü, Überschrift/Zitat/Code-Knöpfe, Checkbox mit
// einem Klick, Bereinigung von eingefügtem HTML. Port: PW_PORT=5614.
import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { objects, openOffline } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `richtext-${name}.png`), animations: 'disabled' });

const editing = (page: Page) => page.locator('.rt.editing');
const bar = (page: Page) => page.getByTestId('richtext-bar');
const get = (page: Page, id: string) => page.evaluate((i) => (window as any).__stachel.store.get(i), id);
const add = (page: Page, obj: Record<string, unknown>): Promise<string> => page.evaluate((o) => (window as any).__stachel.store.create(o), obj);

/** Text-Werkzeug: neues Textobjekt an `at`, Editor hat den Fokus. */
async function newText(page: Page, at = { x: 400, y: 300 }) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await expect(editing(page)).toBeFocused();
}

async function newSticky(page: Page, at = { x: 520, y: 420 }) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await page.mouse.click(at.x, at.y);
  await expect(editing(page)).toBeFocused();
}

/** Einfügen wie Strg V aus Word/Browser: Paste-Ereignis mit HTML und Klartext auf den Editor. */
async function pasteHtml(page: Page, html: string, text: string) {
  await editing(page).evaluate(
    (el, d) => {
      const dt = new DataTransfer();
      dt.setData('text/html', d.html);
      dt.setData('text/plain', d.text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    { html, text },
  );
}

/** Ragt Inhalt rechts bzw. unten aus seinem Kasten (abgeschnitten)? */
const overflow = (l: Locator) =>
  l.evaluate((el) => {
    const box = el.getBoundingClientRect();
    let right = 0;
    let bottom = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (!n.textContent?.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const rc of r.getClientRects()) {
        right = Math.max(right, rc.right);
        bottom = Math.max(bottom, rc.bottom);
      }
    }
    return { right: Math.round(right - box.right), bottom: Math.round(bottom - box.bottom) };
  });

const lastOf = async (page: Page, type: string) => (await objects(page)).filter((o) => o.type === type).at(-1)!;

test.beforeEach(async ({ page }) => {
  await openOffline(page);
});

test('B5: Aufzählung und Checkliste im Text werden nicht rechts abgeschnitten', async ({ page }) => {
  for (const [i, start] of (['- ', '[ ] '] as const).entries()) {
    await newText(page, { x: 300, y: 250 + i * 200 });
    await page.keyboard.type(`${start}kurz`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('eine deutlich längere Zeile');
    await page.keyboard.press('Escape');
    const t = await lastOf(page, 'text');
    const el = page.locator(`[data-id="${t.id}"] .text-content`);
    await expect(el).toContainText('eine deutlich längere Zeile');
    const o = await overflow(el);
    expect(o.right, `${start}: rechts abgeschnitten`).toBeLessThanOrEqual(1);
    // auch im Editor (erneut bearbeiten)
    await page.locator(`[data-id="${t.id}"]`).dblclick();
    await expect(editing(page)).toBeFocused();
    expect((await overflow(editing(page))).right).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
  }
});

test('B6/B12: Word-Einfügen – pt-Größen in em, Listen bleiben Listen, gelbe Markierung bleibt; Ansicht = Bearbeiten', async ({ page }) => {
  await newText(page, { x: 300, y: 300 });
  const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>p.MsoNormal{margin:0cm;font-size:11.0pt;}</style></head><body lang=DE><!--StartFragment--><p class=MsoNormal>klein <span style='font-size:7.0pt'>sieben</span> normal <span style='font-size:30.0pt'>dreissig</span> <span style='background:yellow;mso-highlight:yellow'>gelb</span> <span style='font-family:"Courier New"'>courier</span></p><p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Punkt eins</p><p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Punkt zwei</p><p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Erstens</p><p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Zweitens</p><!--EndFragment--></body></html>`;
  await pasteHtml(page, WORD, 'klein sieben normal dreissig gelb courier\n· Punkt eins\n· Punkt zwei\n1. Erstens\n2. Zweitens');
  await expect(editing(page)).toContainText('Zweitens');
  const editSizes = await editing(page).evaluate((el) => {
    const size = (w: string) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) if (n.textContent!.includes(w)) return parseFloat(getComputedStyle(n.parentElement!).fontSize);
      return 0;
    };
    return { sieben: size('sieben'), dreissig: size('dreissig'), klein: size('klein') };
  });
  await page.keyboard.press('Escape');
  const t = await lastOf(page, 'text');
  const full = await get(page, t.id);
  const json = JSON.stringify(full.content);
  // keine pt-Werte im Dokument, sondern em relativ zur Objektgröße
  expect(json).not.toMatch(/\d(\.\d+)?pt/);
  expect(json).toMatch(/"fontSize":"\d+(\.\d+)?em"/);
  // Listen sind echte Listen, ohne „·“
  expect(json).toContain('"bulletList"');
  expect(json).toContain('"orderedList"');
  expect(full.text).not.toContain('·');
  expect(full.text).toContain('Punkt eins');
  // Markierung bleibt
  expect(json).toContain('"highlight"');
  // Ansicht = Bearbeiten
  const el = page.locator(`[data-id="${t.id}"] .text-content`);
  const viewSizes = await el.evaluate((root) => {
    const size = (w: string) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) if (n.textContent!.includes(w)) return parseFloat(getComputedStyle(n.parentElement!).fontSize);
      return 0;
    };
    return { sieben: size('sieben'), dreissig: size('dreissig'), klein: size('klein') };
  });
  expect(viewSizes.sieben).toBeCloseTo(editSizes.sieben, 0);
  expect(viewSizes.dreissig).toBeCloseTo(editSizes.dreissig, 0);
  expect(viewSizes.dreissig).toBeGreaterThan(viewSizes.klein);
  expect(viewSizes.sieben).toBeLessThan(viewSizes.klein);
  expect((await overflow(el)).right).toBeLessThanOrEqual(1);
  await expect(el.locator('ul li')).toHaveCount(2);
  await expect(el.locator('ol li')).toHaveCount(2);
  await shot(page, 'word-einfuegen');
});

test('Härtung: eingefügtes HTML ohne Ereignis-Attribute, Skripte und javascript:-Links', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await newText(page, { x: 300, y: 300 });
  const WEB = `<p onclick="alert(2)" onmouseover="alert(3)">klick <img src="https://example.org/a.png" onerror="alert(4)"> <a href="javascript:alert(5)">js</a> <a href="https://ok.example">ok</a><script>alert(6)</script><style>p{color:red}</style><iframe src="https://example.org"></iframe></p>`;
  const requests: string[] = [];
  page.on('request', (r) => !r.url().startsWith('http://localhost') && requests.push(r.url()));
  await pasteHtml(page, WEB, 'klick js ok');
  await expect(editing(page)).toContainText('ok');
  const html = await editing(page).innerHTML();
  expect(html).not.toMatch(/onclick|onmouseover|onerror|javascript:|<script|<iframe|<img/i);
  await page.keyboard.press('Escape');
  const t = await lastOf(page, 'text');
  const full = await get(page, t.id);
  expect(full.text).toContain('klick');
  expect(JSON.stringify(full.content)).toContain('https://ok.example');
  expect(JSON.stringify(full.content)).not.toContain('javascript:');
  // nichts nachgeladen, keine blockierten Inline-Handler (CSP-Meldung)
  expect(requests).toEqual([]);
  expect(errors.filter((e) => /inline event handler|Content Security Policy/i.test(e))).toEqual([]);
});

test('B7: Markierung deckt auch großes Wort ganz ab (Ansicht wie Bearbeiten)', async ({ page }) => {
  const id = await add(page, {
    type: 'text', x: 200, y: 200, w: 500, h: 200, text: 'klein GROSS',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'klein ' }, { type: 'text', text: 'GROSS', marks: [{ type: 'textStyle', attrs: { fontSize: '3em' } }, { type: 'highlight', attrs: { color: '#fff27a' } }] }] }] },
  });
  const mark = page.locator(`[data-id="${id}"] .text-content mark`);
  await expect(mark).toBeVisible();
  const { markH, textH } = await mark.evaluate((m) => {
    const r = document.createRange();
    r.selectNodeContents(m);
    const textH = Math.max(...[...r.getClientRects()].map((x) => x.height));
    return { markH: (m as HTMLElement).getBoundingClientRect().height, textH };
  });
  expect(markH).toBeGreaterThanOrEqual(textH * 0.8);
});

test('B8: Notiz mit Tabs (aus Excel) passt in die Notiz', async ({ page }) => {
  const id = await add(page, { type: 'sticky', x: 300, y: 200, w: 200, h: 200, color: '#fff27a', text: 'Name\tSchicht\nMara\tFrüh\nJonas\tSpät' });
  const el = page.locator(`[data-id="${id}"] .sticky-text`);
  await expect(el).toContainText('Spät');
  const o = await overflow(el);
  expect(o.bottom).toBeLessThanOrEqual(1);
  expect(o.right).toBeLessThanOrEqual(1);
  // nach dem Bearbeiten (Rich-Text)
  await page.locator(`[data-id="${id}"]`).dblclick();
  await expect(editing(page)).toBeFocused();
  await page.keyboard.press('Escape');
  const o2 = await overflow(page.locator(`[data-id="${id}"] .sticky-text`));
  expect(o2.bottom).toBeLessThanOrEqual(1);
});

test('B9: sehr langer Text in der Notiz – Ansicht blendet unten aus, beim Bearbeiten scrollt die Notiz', async ({ page }) => {
  const words = Array.from({ length: 300 }, (_, i) => `Wort${i}`).join(' ');
  const id = await add(page, { type: 'sticky', x: 300, y: 150, w: 200, h: 200, color: '#fff27a', text: words });
  const el = page.locator(`[data-id="${id}"] .sticky-text`);
  await expect(el).toHaveClass(/rt-clip/);
  // nichts ragt sichtbar über die Notiz hinaus
  const r = await el.evaluate((e) => {
    const box = e.getBoundingClientRect();
    const note = e.closest('.obj')!.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { bottom: box.bottom - note.bottom, overflow: cs.overflow, mask: cs.maskImage || cs.getPropertyValue('-webkit-mask-image') };
  });
  expect(r.bottom).toBeLessThanOrEqual(1);
  expect(r.overflow).toBe('hidden');
  expect(r.mask).toContain('gradient');
  await shot(page, 'lang-ausgeblendet');
  // bearbeiten: ans Ende tippen, die Schreibmarke bleibt sichtbar
  await page.locator(`[data-id="${id}"]`).click();
  await page.keyboard.press('Enter');
  await expect(editing(page)).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ENDE');
  const s = await editing(page).evaluate((e) => {
    const c = getSelection()!.getRangeAt(0).getBoundingClientRect();
    const box = e.getBoundingClientRect();
    return { scrolled: e.scrollTop, caretBottom: c.bottom, boxBottom: box.bottom, scrollable: e.scrollHeight > e.clientHeight };
  });
  expect(s.scrollable).toBe(true);
  expect(s.scrolled).toBeGreaterThan(0);
  expect(s.caretBottom).toBeLessThanOrEqual(s.boxBottom + 1);
  await page.keyboard.press('Escape');
  expect((await get(page, id)).text.endsWith('ENDE')).toBe(true);
});

test('B10: Esc bei offenem Menü der Format-Leiste schließt nur das Menü', async ({ page }) => {
  await newSticky(page);
  await page.keyboard.type('Hallo');
  for (const name of ['Textfarbe', 'Markierung']) {
    await bar(page).getByRole('button', { name, exact: true }).click();
    await expect(bar(page).locator('.ctx-pop')).toBeVisible();
    await expect(editing(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(bar(page).locator('.ctx-pop')).toHaveCount(0);
    await expect(editing(page)).toBeFocused();
  }
  await page.getByTestId('richtext-size').click();
  await expect(bar(page).locator('.ctx-pop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar(page).locator('.ctx-pop')).toHaveCount(0);
  await expect(editing(page)).toBeFocused();
  // zweites Esc beendet die Bearbeitung
  await page.keyboard.press('Escape');
  await expect(editing(page)).toHaveCount(0);
  expect((await lastOf(page, 'sticky')).text).toBe('Hallo');
});

test('Überschrift, Zitat und Code-Block über die Format-Leiste', async ({ page }) => {
  await newText(page, { x: 300, y: 250 });
  await page.keyboard.type('Titel');
  await page.getByTestId('richtext-block').click();
  await bar(page).getByRole('button', { name: 'Überschrift 1' }).click();
  await expect(editing(page).locator('h1')).toHaveText('Titel');
  await expect(page.getByTestId('richtext-block')).toHaveText('H1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ein Zitat');
  await page.getByTestId('richtext-block').click();
  await bar(page).getByRole('button', { name: 'Zitat' }).click();
  await expect(editing(page).locator('blockquote')).toHaveText('Ein Zitat');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('let x = 1');
  await page.getByTestId('richtext-block').click();
  await bar(page).getByRole('button', { name: 'Code-Block' }).click();
  await expect(editing(page).locator('pre code')).toHaveText('let x = 1');
  await shot(page, 'bloecke');
  await page.getByTestId('richtext-block').click();
  await expect(bar(page).getByRole('group', { name: 'Absatz' })).toBeVisible();
  await shot(page, 'bloecke-menue');
  // zurück zu normalem Text
  await bar(page).getByRole('button', { name: 'Normaler Text' }).click();
  await expect(editing(page).locator('pre')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const t = await lastOf(page, 'text');
  const json = JSON.stringify((await get(page, t.id)).content);
  expect(json).toContain('"heading"');
  expect(json).toContain('"blockquote"');
  const view = page.locator(`[data-id="${t.id}"] .text-content`);
  await expect(view.locator('h1')).toHaveText('Titel');
  await expect(view.locator('blockquote')).toHaveText('Ein Zitat');
});

test('Checkbox mit einem Klick abhaken, ohne zu bearbeiten; Strg Z nimmt es zurück; gesperrt nicht', async ({ page }) => {
  await newSticky(page, { x: 500, y: 400 });
  await page.keyboard.type('[ ] Bühne');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Licht');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const s = await lastOf(page, 'sticky');
  const items = page.locator(`[data-id="${s.id}"] li[data-type="taskItem"]`);
  await expect(items).toHaveCount(2);
  const b = (await items.nth(1).locator('input').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(items.nth(1)).toHaveAttribute('data-checked', 'true');
  await expect(items.nth(0)).toHaveAttribute('data-checked', 'false');
  await expect(editing(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__stachel.getSelection())).toEqual([]);
  expect((await get(page, s.id)).text).toBe('Bühne\nLicht');
  await shot(page, 'checkbox-klick');
  await page.keyboard.press('Control+z');
  await expect(items.nth(1)).toHaveAttribute('data-checked', 'false');
  // gesperrt: kein Abhaken
  await page.evaluate((id) => (window as any).__stachel.store.update(id, { locked: true }), s.id);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(150);
  await expect(items.nth(1)).toHaveAttribute('data-checked', 'false');
});
