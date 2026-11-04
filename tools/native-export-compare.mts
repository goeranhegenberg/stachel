// Sichtvergleich Export (Paritäts-Audit N07): PNG-Export „Ganzes Board“ mit den Vorgaben des Dialogs (Scharf) über die
// echte Web-Oberfläche der Sandbox (Kontextmenü → „Board exportieren …“ → Download), dazu ein Bildschirmfoto des
// Boards (<ausgabe>_screen.png). Das Gegenstück der App: flutter/packages/stachel_board/test/rest/
// n07_export_live_test.dart (--dart-define=N07_BOARD=<id> --dart-define=N07_OUT=<datei>).
// Aufruf: server/node_modules/.bin/tsx tools/native-export-compare.mts http://127.0.0.1:8790 <board-id> <ausgabe.png>
// Beobachtet 2026-11-02: der Web-Export (SVG-foreignObject) lässt waagerechte Rasterlinien eines Rahmens, einen an
// einer Tabellenzelle angedockten Verbinder und den Bildinhalt teils weg – das Board selbst zeigt sie.
// @ts-ignore
import { chromium } from '../web/node_modules/playwright/index.mjs';
import { passwordLogin } from '../server/test/native-sandbox';

const [base, board, out] = process.argv.slice(2);
const cookie = await passwordLogin(base!, 'mara', 'kaktus-123');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const [name, value] = cookie.split(';')[0]!.split('=');
await ctx.addCookies([{ name: name!, value: value!, url: base! }]);
const page = await ctx.newPage();
await page.goto(`${base}/?b=${board}`);
await page.waitForSelector('[data-testid="board"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: out!.replace('.png', '_screen.png') });
// leere Stelle rechts unten: Kontextmenü
const box = (await page.locator('[data-testid="board"]').boundingBox())!;
await page.mouse.click(box.x + box.width - 60, box.y + 80, { button: 'right' });
await page.getByText('Board exportieren', { exact: false }).first().click();
await page.waitForTimeout(500);
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exportieren|Herunterladen|PNG/ }).last().click()]);
await dl.saveAs(out!);
console.log('ok', out);
await browser.close();
