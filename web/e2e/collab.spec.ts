// Modul „collab“: Kommentare mit @Erwähnung, Reaktionen, Abstimmung, Timer, Folgen, Herholen, Laser, Anwesenheit.
// Offline (?offline=1): andere Personen kommen als eingespielte Anwesende bzw. direkt ins Y-Dokument.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { camera, centerOf, objects, openOffline } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `collab-${name}.png`) });

const MARA = { key: 'm:12', name: 'Mara Lindner', color: '#ec4e92' };
const JONAS = { key: 'm:31', name: 'Jonas Keller', color: '#1763b5' };

/** Anwesende einspielen (extra = Awareness-Felder der Module). */
async function setPeers(page: Page, peers: { user: typeof MARA; cursor?: { x: number; y: number } | null; extra?: Record<string, unknown>; clientId?: number }[]) {
  await page.evaluate((list) => {
    const s = (window as any).__stachel.session;
    s.setPeers(list.map((p, i) => ({ clientId: p.clientId ?? 100 + i, user: p.user, cursor: p.cursor ?? null, selection: [], extra: p.extra ?? {} })));
  }, peers);
}

async function seed(page: Page) {
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    store.createMany([
      { id: 's1', type: 'sticky', x: -380, y: -140, w: 200, h: 200, color: '#fff27a', text: 'Bühne am See' },
      { id: 's2', type: 'sticky', x: -120, y: -140, w: 200, h: 200, color: '#c9e14a', text: 'Kinderzelt' },
      { id: 's3', type: 'sticky', x: 140, y: -140, w: 200, h: 200, color: '#ffb3d1', text: 'Shuttle vom Bahnhof' },
      { id: 'r1', type: 'shape', shape: 'rect', x: -380, y: 120, w: 720, h: 90, color: '#ffffff', text: 'Sommerfest · Ideen' },
    ]);
    store.stopCapturing();
  });
}

const ydump = (page: Page, name: string) => page.evaluate((n) => (window as any).__stachel.store.doc.getMap(n).toJSON(), name);

test.beforeEach(async ({ page }) => {
  await openOffline(page);
  await seed(page);
  await setPeers(page, [
    { user: MARA, cursor: { x: 420, y: 60 } },
    { user: JONAS, cursor: null, extra: { 'collab.status': 'idle' } },
  ]);
});

test('Kommentare: an Objekt heften, @Erwähnung, Antwort, erledigt, Panel mit Filter und Zähler, Rückgängig', async ({ page }) => {
  // Werkzeug C, Klick auf die Notiz öffnet das Eingabefeld
  await page.keyboard.press('c');
  await expect(page.locator('[data-tool="collab.comment"]')).toHaveAttribute('aria-pressed', 'true');
  const c1 = await centerOf(page, 's2');
  await page.mouse.click(c1.x + 40, c1.y - 50);
  const input = page.getByRole('textbox', { name: 'Kommentar', exact: true });
  await expect(input).toBeFocused();
  await input.pressSequentially('Passt das so @ma');
  await expect(page.getByRole('listbox', { name: 'Personen erwähnen' })).toBeVisible();
  await expect(page.getByRole('option')).toHaveText([/Mara Lindner$/]);
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('Passt das so @Mara Lindner ');
  await input.pressSequentially('?');
  await page.keyboard.press('Enter');

  // Pin + offener Thread mit hervorgehobener Erwähnung
  const pin = page.locator('.collab-pin[data-thread]');
  await expect(pin).toHaveCount(1);
  const thread = page.getByRole('dialog', { name: 'Kommentar' });
  await expect(thread.locator('.collab-mention')).toHaveText('@Mara Lindner');
  const data = (await ydump(page, 'collab.comments')) as Record<string, any>;
  const [tid, t] = Object.entries(data)[0];
  expect(t).toMatchObject({ objectId: 's2', resolved: false, createdBy: 'a:offline' });
  expect(t.messages[0]).toMatchObject({ text: 'Passt das so @Mara Lindner ?', mentions: ['m:12'], by: 'a:offline' });

  // Antwort (Umschalt+Enter = neue Zeile)
  const reply = thread.getByRole('textbox', { name: 'Antwort' });
  await reply.fill('Ja, aber');
  await reply.press('Shift+Enter');
  await reply.pressSequentially('mit Zelt');
  await reply.press('Enter');
  await expect(thread.locator('.collab-msg')).toHaveCount(2);
  await expect(thread.locator('.collab-msg').nth(1)).toContainText('Ja, aber\nmit Zelt');
  await expect(pin.locator('.collab-pin__count')).toHaveText('2');
  await page.mouse.move(10, 10);
  await shot(page, 'thread');

  // Pin folgt dem Objekt
  const before = (await pin.boundingBox())!;
  await page.evaluate(() => (window as any).__stachel.store.update('s2', { x: -60, y: -100 }));
  await expect.poll(async () => Math.round((await pin.boundingBox())!.x - before.x)).toBe(60);

  // Zähler am Knopf, Panel
  await expect(page.getByTestId('comment-count')).toHaveText('1');
  await thread.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await expect(pin).toHaveCount(0);
  await expect(page.getByTestId('comment-count')).toHaveCount(0);
  expect(((await ydump(page, 'collab.comments')) as any)[tid]).toMatchObject({ resolved: true, resolvedBy: 'a:offline' });

  await page.getByRole('button', { name: 'Kommentare' }).click();
  const panel = page.getByRole('complementary', { name: 'Kommentare' });
  await expect(panel.getByRole('radio', { name: /Offen/ })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByText('Keine Kommentare')).toBeVisible();
  await panel.getByRole('radio', { name: /Erledigt/ }).click();
  await expect(panel.locator('.collab-card')).toHaveCount(1);
  await expect(panel.locator('.collab-card')).toContainText('Haftnotiz „Kinderzelt“');
  await expect(pin).toHaveCount(1); // im Filter „Erledigt“ auch auf dem Board
  await panel.getByRole('button', { name: 'Wieder öffnen' }).click();
  await panel.getByRole('radio', { name: /Offen/ }).click();
  await panel.getByRole('button', { name: /Kommentar von Du \(offline\) öffnen/ }).click();
  await expect(page.getByRole('dialog', { name: 'Kommentar' })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'panel');

  // Esc schließt das Popover; Strg Z nimmt den letzten Kommentar-Schritt zurück
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Kommentar' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('board').focus();
  await page.keyboard.press('Control+z'); // „wieder öffnen“
  await page.keyboard.press('Control+z'); // „erledigt“
  await page.keyboard.press('Control+z'); // Notiz verschoben
  await page.keyboard.press('Control+z'); // Antwort
  const msgs = Object.values((await ydump(page, 'collab.comments')) as Record<string, any>)[0].messages;
  expect(msgs).toHaveLength(1);
});

test('Erwähnung durch andere: Hinweis „Du wurdest erwähnt“, Ansehen öffnet den Thread und gilt als gelesen', async ({ page }) => {
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    const doc = store.doc;
    const YMap = doc.getMap('objects').constructor;
    const YArray = doc.getArray('collab.tmp').constructor;
    const t = new YMap();
    const msgs = new YArray();
    msgs.push([{ id: 'm1', by: 'm:12', name: 'Mara Lindner', text: '@Du (offline) kannst du das Shuttle klären?', at: new Date().toISOString(), mentions: ['a:offline'] }]);
    t.set('x', 0);
    t.set('y', 0);
    t.set('objectId', 's3');
    t.set('dx', 180);
    t.set('dy', 10);
    t.set('resolved', false);
    t.set('createdBy', 'm:12');
    t.set('createdAt', new Date().toISOString());
    t.set('messages', msgs);
    doc.transact(() => doc.getMap('collab.comments').set('t-mara', t), 'remote');
  });
  const notice = page.getByRole('status', { name: 'Du wurdest erwähnt' });
  await expect(notice).toContainText('Mara Lindner: „@Du (offline) kannst du das Shuttle klären?“');
  await expect(page.getByTestId('comment-count')).toHaveText('@');
  await expect(page.locator('.collab-pin.has-mention')).toHaveCount(1);
  await page.waitForTimeout(400);
  await shot(page, 'erwaehnt');
  await notice.getByRole('button', { name: 'Ansehen' }).click();
  await expect(notice).toHaveCount(0);
  const thread = page.getByRole('dialog', { name: 'Kommentar' });
  await expect(thread.locator('.collab-mention.is-me')).toHaveText('@Du (offline)');
  await expect(page.getByTestId('comment-count')).toHaveText('1');
  const reads = await ydump(page, 'collab.reads');
  expect(typeof (reads as any)['a:offline']).toBe('string');
});

test('Reaktionen: Emoji über die Kontextleiste, Chips mit Namen, Umschalten', async ({ page }) => {
  // Mara hat schon reagiert
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    store.doc.transact(() => store.doc.getMap('collab.reactions').set('s1|👍|m:12', { o: 's1', e: '👍', u: 'm:12', n: 'Mara Lindner', at: '2026-10-01T10:00:00.000Z' }), 'remote');
  });
  const chips = page.locator('[data-reactions="s1"] .collab-chip');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveAttribute('data-tip', 'Mara Lindner hat mit 👍 reagiert');

  // zwei Notizen auswählen, 👍 und 🔥 vergeben
  const a = await centerOf(page, 's1');
  const b = await centerOf(page, 's2');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await bar.getByRole('button', { name: 'Reagieren' }).click();
  await bar.getByRole('button', { name: 'Reaktion 👍' }).click();
  await bar.getByRole('button', { name: 'Reaktion 🔥' }).click();
  await expect(bar.getByRole('button', { name: 'Reaktion 👍' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chips).toHaveText(['👍2', '🔥1']);
  await expect(chips.first()).toHaveAttribute('data-tip', 'Mara Lindner und du haben mit 👍 reagiert');
  // Namen erscheinen beim Überfahren
  await chips.first().hover();
  await expect.poll(() => chips.first().evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('1');
  await shot(page, 'reaktionen-namen');
  await expect(page.locator('[data-reactions="s2"] .collab-chip')).toHaveText(['👍1', '🔥1']);
  await page.mouse.click(700, 820);
  await page.waitForTimeout(200);
  await shot(page, 'reaktionen');

  // Klick auf den eigenen Chip nimmt die Reaktion zurück, Strg Z bringt sie wieder
  await chips.first().click();
  await expect(chips.first()).toHaveText('👍1');
  await expect(chips.first()).not.toHaveClass(/is-mine/);
  await page.getByTestId('board').focus();
  await page.keyboard.press('Control+z');
  await expect(chips.first()).toHaveText('👍2');
});

test('Abstimmung: starten, Objekte anklicken, Stimmen begrenzt, Ergebnis mit Rangfolge, Archiv', async ({ page }) => {
  await page.getByRole('button', { name: 'Abstimmung starten' }).click();
  const dlg = page.getByRole('dialog', { name: 'Abstimmung starten' });
  await dlg.getByLabel('Worum geht es?').fill('Was machen wir zuerst?');
  await dlg.getByRole('button', { name: 'Weniger Stimmen' }).click(); // 3 → 2
  await dlg.getByRole('radio', { name: '1 Min.' }).click();
  await shot(page, 'abstimmung-start');
  await dlg.getByRole('button', { name: 'Abstimmung starten' }).click();

  const bar = page.getByRole('region', { name: 'Abstimmung' });
  await expect(bar).toContainText('Was machen wir zuerst?');
  await expect(page.getByTestId('votes-left')).toHaveAttribute('aria-label', '2 von 2 Stimmen übrig');
  await expect(page.getByTestId('vote-time')).toHaveText(/^(1:00|0:5\d)$/);

  // Jonas stimmt (aus der Ferne) für s3
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    const s = store.doc.getMap('collab.vote').get('session');
    store.doc.transact(() => store.doc.getMap('collab.votes').set(`${s.id}|m:31|s3`, { n: 1, name: 'Jonas Keller' }), 'remote');
  });

  // Klick auf Objekte vergibt Stimmen (statt auswählen)
  await page.locator('[data-vote="s3"]').click();
  await expect(page.locator('[data-vote="s3"] .collab-vote-badge')).toHaveText('1');
  expect(await page.evaluate(() => (window as any).__stachel.getSelection())).toEqual([]);
  await page.locator('[data-vote="s1"]').click();
  await expect(page.getByTestId('votes-left')).toHaveAttribute('aria-label', '0 von 2 Stimmen übrig');
  await page.locator('[data-vote="s2"]').click();
  await expect(page.getByRole('status').filter({ hasText: 'Keine Stimmen mehr übrig' })).toBeVisible();
  // noch einmal klicken nimmt die Stimme zurück
  await page.locator('[data-vote="s1"]').click();
  await page.locator('[data-vote="s2"]').click();
  await expect(page.locator('.collab-vote-badge')).toHaveCount(2);
  await page.mouse.move(1100, 700);
  await shot(page, 'abstimmung');

  // Beenden → Ergebnis für alle
  await bar.getByRole('button', { name: 'Beenden' }).click();
  const res = page.getByRole('dialog', { name: 'Ergebnis' });
  await expect(res).toContainText('2 Personen · 3 Stimmen');
  await expect(res.locator('.collab-rank li')).toHaveText([/Shuttle vom Bahnhof.*2$/, /Kinderzelt.*1$/]);
  await shot(page, 'abstimmung-ergebnis');
  await res.getByRole('button', { name: 'Abstimmung schließen' }).click();
  await expect(bar).toHaveCount(0);
  const hist = await page.evaluate(() => (window as any).__stachel.store.doc.getArray('collab.voteHistory').toJSON());
  expect(hist[0]).toMatchObject({ title: 'Was machen wir zuerst?', voters: 2, total: 3 });
  expect(hist[0].ranking.map((r: any) => [r.objectId, r.votes, r.rank])).toEqual([
    ['s3', 2, 1],
    ['s2', 1, 2],
  ]);
  // frühere Ergebnisse über das Board-Menü
  await page.getByRole('button', { name: 'Board-Menü' }).click();
  await page.getByRole('menuitem', { name: 'Frühere Abstimmungen' }).click();
  await expect(page.getByRole('dialog', { name: 'Ergebnis' })).toContainText('Was machen wir zuerst?');
});

test('Abstimmung endet nach Ablauf der Zeit von selbst', async ({ page }) => {
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    const now = Date.now();
    store.doc.getMap('collab.vote').set('session', { id: 'v1', title: 'Schnell', perPerson: 1, multi: false, endsAt: now + 1500, startedBy: 'm:12', startedByName: 'Mara Lindner', startedAt: now, ended: false });
  });
  await expect(page.getByRole('region', { name: 'Abstimmung' })).toContainText('Schnell');
  await page.locator('[data-vote="s2"]').click();
  await expect(page.getByRole('dialog', { name: 'Ergebnis' })).toContainText('1 Person · 1 Stimme', { timeout: 5000 });
  // nicht Gastgeber: kein „Schließen“
  await expect(page.getByRole('button', { name: 'Abstimmung schließen' })).toHaveCount(0);
});

test('Timer: für alle starten, Restzeit oben, Pause, Ton und Hinweis am Ende', async ({ page }) => {
  const timer = page.getByTestId('timer');
  await timer.click();
  const pop = page.getByRole('dialog', { name: 'Timer' });
  await pop.getByRole('button', { name: '3 Min.' }).click();
  await pop.getByRole('button', { name: 'Eine Minute mehr' }).click();
  await expect(pop.locator('.collab-timer-big')).toHaveText('4:00');
  await shot(page, 'timer-einstellen');
  await pop.getByRole('button', { name: 'Für alle starten' }).click();
  await expect(timer).toHaveText(/^(4:00|3:5\d)/);
  const t = (await ydump(page, 'collab.timer')) as any;
  expect(t.timer).toMatchObject({ state: 'running', duration: 240_000, by: 'Du (offline)' });

  // Pause hält die Zeit an
  await timer.click();
  await page.getByRole('dialog', { name: 'Timer' }).getByRole('button', { name: 'Pause' }).click();
  expect(((await ydump(page, 'collab.timer')) as any).timer.state).toBe('paused');
  await page.getByRole('dialog', { name: 'Timer' }).getByRole('button', { name: 'Weiter' }).click();
  await page.keyboard.press('Escape');

  // Jemand stellt den Timer auf fast abgelaufen → Ton + „Zeit ist um!“
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    const m = store.doc.getMap('collab.timer');
    m.set('timer', { ...m.get('timer'), endsAt: Date.now() + 1200, duration: 60_000 });
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Zeit ist um!' })).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => (window as any).__collabChimes)).toBe(1);
  await expect(timer).toHaveText(/Zeit!/);
  await shot(page, 'timer-ende');
  await page.getByRole('alert').getByRole('button', { name: 'OK' }).click();
  await expect(timer).toHaveText('');
});

test('Anwesenheit: Status, Klick auf Avatar folgt, eigene Geste beendet das Folgen, „Alle zu mir holen“ empfangen', async ({ page }) => {
  const presence = page.getByTestId('presence');
  await expect(presence.getByTitle('Jonas Keller – hinspringen und folgen')).toHaveClass(/is-idle/);

  // Liste mit Status
  await presence.getByRole('button', { name: 'Anwesende' }).click();
  const list = page.getByRole('dialog', { name: 'Anwesende' });
  await expect(list.locator('li')).toHaveText([/Mara Lindner\s*aktiv/, /Jonas Keller\s*inaktiv/]);
  await list.getByRole('radio', { name: 'Gleich zurück' }).click();
  await expect(presence.locator('.presence__me .collab-dot--away')).toHaveCount(1);
  await shot(page, 'anwesende');
  await page.keyboard.press('Escape');

  // Mara zeigt einen Ausschnitt weiter rechts unten; Klick auf ihren Avatar folgt ihr
  await setPeers(page, [{ user: MARA, cursor: { x: 1500, y: 900 }, extra: { 'collab.viewport': { x: 1000, y: 600, w: 1440, h: 900 } } }, { user: JONAS }]);
  await presence.getByTitle('Mara Lindner – hinspringen und folgen').click();
  await expect.poll(async () => camera(page)).toEqual({ x: -1000, y: -600, z: 1 });
  await expect(page.getByRole('status').filter({ hasText: 'Du folgst Mara Lindner' })).toBeVisible();
  await expect(page.locator('.collab-follow-frame')).toHaveCount(1);
  await shot(page, 'folgen');
  // sie scrollt weiter → ich auch
  await setPeers(page, [{ user: MARA, cursor: null, extra: { 'collab.viewport': { x: 1400, y: 600, w: 720, h: 450 } } }, { user: JONAS }]);
  await expect.poll(async () => camera(page)).toEqual({ x: -2800, y: -1200, z: 2 });
  // eigene Geste auf dem Board beendet das Folgen
  await page.mouse.click(700, 500);
  await expect(page.locator('.collab-follow-frame')).toHaveCount(0);
  await setPeers(page, [{ user: MARA, cursor: null, extra: { 'collab.viewport': { x: 0, y: 0, w: 1440, h: 900 } } }, { user: JONAS }]);
  await page.waitForTimeout(300);
  expect((await camera(page)).z).toBe(2);

  // Jonas holt alle zu sich
  await setPeers(page, [{ user: MARA }, { user: JONAS, extra: { 'collab.summon': { id: 'x1', rect: { x: -720, y: -450, w: 1440, h: 900 }, ts: Date.now() } } }]);
  await expect.poll(async () => camera(page)).toEqual({ x: 720, y: 450, z: 1 });
  await expect(page.getByRole('status').filter({ hasText: 'Jonas Keller hat dich zu sich geholt.' })).toBeVisible();
});

test('Laserpointer: eigene Spur verblasst, fremde Spur (Name nur am Mauszeiger, nicht doppelt)', async ({ page }) => {
  await page.locator('[data-tool="collab.laser"]').click();
  await page.mouse.move(500, 400);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(500 + i * 25, 400 + Math.sin(i / 2) * 40);
  await expect(page.locator('[data-laser="me"] line').first()).toBeVisible();
  const segs = await page.locator('[data-laser="me"] > g').count();
  expect(segs).toBeGreaterThan(5);
  // fremde Spur über die Awareness
  await setPeers(page, [{ user: MARA, extra: { 'collab.laser': { s: 4, p: [-200, 200, -150, 230, -100, 220, -50, 260], g: [1] } } }]);
  await expect(page.locator('.collab-laser [data-laser]:not([data-laser="me"]) line').first()).toBeVisible();
  await expect(page.locator('.collab-laser text')).toHaveCount(0);
  await shot(page, 'laser');
  await page.mouse.up();
  // nach dem Verblassen ist nichts mehr zu sehen
  await expect(page.locator('.collab-laser')).toHaveCount(0, { timeout: 3000 });
});

test('Kontextmenü: Kommentieren, Board-Menü: Kommentare ausblenden, Pin umhängen', async ({ page }) => {
  const a = await centerOf(page, 's1');
  await page.mouse.click(a.x, a.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /Kommentieren/ }).click();
  const input = page.getByRole('textbox', { name: 'Kommentar', exact: true });
  await expect(input).toBeFocused();
  await input.fill('Größer?');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.locator('.collab-pin[data-thread]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Board-Menü' }).click();
  await page.getByRole('menuitem', { name: 'Kommentar-Pins ausblenden' }).click();
  await expect(page.locator('.collab-pin[data-thread]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Board-Menü' }).click();
  await page.getByRole('menuitem', { name: 'Kommentar-Pins zeigen' }).click();
  await expect(page.locator('.collab-pin[data-thread]')).toHaveCount(1);
  // Pin ziehen heftet ihn an die Form darunter
  const pin = (await page.locator('.collab-pin[data-thread]').boundingBox())!;
  const shape = await centerOf(page, 'r1');
  await page.mouse.move(pin.x + 10, pin.y + 10);
  await page.mouse.down();
  await page.mouse.move(shape.x, shape.y, { steps: 8 });
  await page.mouse.up();
  const t = Object.values((await ydump(page, 'collab.comments')) as Record<string, any>)[0];
  expect(t.objectId).toBe('r1');
  expect(await objects(page)).toHaveLength(4);
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('Timer läuft sichtbar, Kommentare und Abstimmung im Board-Menü', async ({ page }) => {
    await page.getByRole('button', { name: 'Board-Menü' }).tap();
    await page.getByRole('menuitem', { name: 'Timer für alle: 5 Min.' }).tap();
    await expect(page.getByTestId('timer')).toHaveText(/^(5:00|4:5\d)/);
    const box = (await page.locator('.topbar--right').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    // Timer-Chip liegt unter der Zoom-Leiste, nicht darauf
    const chip = (await page.getByTestId('timer').boundingBox())!;
    const zoom = (await page.locator('.zoombar').boundingBox())!;
    expect(chip.y).toBeGreaterThanOrEqual(zoom.y + zoom.height);
    await page.getByRole('button', { name: 'Board-Menü' }).tap();
    await expect(page.getByRole('menuitem', { name: 'Abstimmung starten' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Kommentare', exact: true }).tap();
    await expect(page.getByRole('complementary', { name: 'Kommentare' })).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, 'handy');
  });
});
