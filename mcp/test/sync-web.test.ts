// Gespiegelte Werte aus web/ (dort in React-Dateien, deshalb nicht direkt importierbar) müssen gleich bleiben.
// Schlägt dieser Test fehl, hat sich die Web-App geändert: mcp/src/layout/sizes.ts bzw. stachel/board.ts nachziehen.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as web from '../../web/src/features/structure/mindmap/style';
import { CARD_COLORS, CARD_W, MIND_COLORS, MIND_STYLES, mindSize } from '../src/layout/sizes';

const WEB = path.resolve(import.meta.dirname, '../../web/src');
const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8');

describe('Abgleich mit der Web-App', () => {
  it('Mindmap-Stile, -Farben und Größenformel', () => {
    expect(MIND_STYLES).toEqual(web.MIND_STYLES);
    expect(MIND_COLORS).toEqual(web.MIND_COLORS);
    const fixed = (s: string) => s.length * 9;
    for (const t of ['', 'Kurz', 'Ein deutlich längerer Text, der umbrechen muss, weil er nicht in eine Zeile passt']) {
      for (const level of [0, 1, 2, 3]) expect(mindSize(t, level, fixed)).toEqual(web.mindSize(t, level, fixed));
    }
  });

  it('Karten: Breite, Farben und Höhenformel', () => {
    // Konstanten liegen React-frei in card/model.ts (seit Native P3)
    const card = read('features/structure/card/model.ts');
    expect(card).toContain(`export const CARD_W = ${CARD_W};`);
    expect(card).toContain(`export const CARD_COLORS = ${JSON.stringify(CARD_COLORS).replace(/,/g, ', ').replace(/"/g, "'")};`);
    const build = read('features/structure/templates/build.ts');
    expect(build).toContain('return Math.ceil(28 + tl * 22.1 + (dl ? 6 + dl * 20.3 : 0) + (chips ? 12 + 24 : 0));');
  });

  it('Anwesenheitsfarben', () => {
    const session = read('board/session.ts');
    const board = fs.readFileSync(path.resolve(import.meta.dirname, '../src/stachel/board.ts'), 'utf8');
    const list = /PRESENCE_COLORS = (\[[^\]]+\])/.exec(session)![1];
    expect(board).toContain(`PRESENCE_COLORS = ${list}`);
  });
});
