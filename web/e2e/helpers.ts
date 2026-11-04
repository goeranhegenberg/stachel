import { expect, type Page } from '@playwright/test';

export interface Obj {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  from?: { objectId?: string; side?: string; x?: number; y?: number };
  to?: { objectId?: string; side?: string; x?: number; y?: number };
  fontSize?: number;
  locked?: boolean;
}

export async function openOffline(page: Page, demo = false) {
  await page.goto(`/?offline=1${demo ? '&demo=1' : ''}`);
  await expect(page.getByTestId('board')).toBeVisible();
  await page.waitForFunction(() => (window as any).__stachel?.store);
}

export const objects = (page: Page): Promise<Obj[]> =>
  page.evaluate(() => (window as any).__stachel.store.getSnapshot().ordered.map((o: any) => ({ ...o })));

export const selection = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__stachel.getSelection());

export const camera = (page: Page): Promise<{ x: number; y: number; z: number }> => page.evaluate(() => (window as any).__stachel.getCamera());

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export async function centerOf(page: Page, id: string) {
  const box = await page.locator(`[data-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`Objekt ${id} nicht sichtbar`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Haftnotiz per Werkzeug anlegen und Text tippen. */
export async function addSticky(page: Page, at: { x: number; y: number }, text: string) {
  // Esc hebt eine Auswahl auf – sonst schreibt „n“ in die ausgewählte Notiz
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  const list = await objects(page);
  return list.filter((o) => o.type === 'sticky').at(-1)!;
}
