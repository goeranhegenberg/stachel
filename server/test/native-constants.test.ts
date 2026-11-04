// Web-Konstanten für die App (Vertrag §8.13, Audit §3.3): docs/native_fixtures/web/constants.json muss genau das sein,
// was tools/native-web-constants-data.mts jetzt aus dem Web-Code liest. Scheitert der Test, hat sich ein Web-Wert
// geändert: neu erzeugen (server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-web-constants.mts) und
// in die App übernehmen (lib/src/web/web_constants.g.dart).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// dynamisch: der Web-Code (inkl. .tsx) folgt nicht den Server-Regeln der Typprüfung (wie #stachel-web)
const DATA = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/native-web-constants-data.mts')).href;
interface WebConstants {
  colors: { sticky: string[] };
  shapes: { entries: unknown[] };
  stickers: { icons: unknown[]; stamps: { glyph: unknown[] }[] };
  templates: { list: { contains: Record<string, number> }[] };
  reactions: string[];
  timer: { presetsMin: number[] };
}
const { buildWebConstants } = (await import(DATA)) as { buildWebConstants: () => WebConstants };

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/native_fixtures/web/constants.json');

describe('Web-Konstanten', () => {
  it('constants.json passt zum Web-Code (sonst neu erzeugen und in die App übernehmen)', () => {
    const file = JSON.parse(fs.readFileSync(FILE, 'utf8')) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildWebConstants())));
  });

  it('enthält, was die Pakete brauchen', () => {
    const c = buildWebConstants();
    expect(c.colors.sticky.length).toBeGreaterThan(3);
    expect(c.shapes.entries.length).toBeGreaterThan(20);
    expect(c.stickers.icons.length).toBeGreaterThan(100);
    expect(c.stickers.stamps.every((s) => s.glyph.length > 0)).toBe(true);
    expect(c.templates.list.length).toBeGreaterThan(3);
    expect(c.templates.list.every((t) => Object.keys(t.contains).length > 0)).toBe(true);
    expect(c.reactions).toContain('🌵');
    expect(c.timer.presetsMin).toContain(5);
  });
});
