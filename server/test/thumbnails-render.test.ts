// Server-Vorschaubilder (P8, thumbnails.ts + web features/tools/thumbSvg.ts): lesbare Miniaturen aus dem Board-Dokument.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { renderThumbnail, thumbnailSvgOf } from '../src/thumbnails.js';

/** Belegbilder nur auf Wunsch (THUMB_SHOTS=<Ordner>) */
const SHOTS = process.env.THUMB_SHOTS;

function docWith(objs: Record<string, Record<string, unknown>>, settings?: Record<string, unknown>) {
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<unknown>>('objects');
  doc.transact(() => {
    let z = 0;
    for (const [id, o] of Object.entries(objs)) map.set(id, new Y.Map(Object.entries({ z: `a${z++}`, createdBy: 'm:1', updatedAt: '2026-11-04T00:00:00Z', ...o })));
    if (settings) for (const [k, v] of Object.entries(settings)) doc.getMap('tools.settings').set(k, v);
  });
  return doc;
}

const sticky = (x: number, y: number, color: string, text: string) => ({ type: 'sticky', x, y, w: 200, h: 200, color, text });

describe('Vorschaubild vom Server', () => {
  it('rendert Notizen, Rahmen mit Titel, Form, Text und Verbinder als WebP 560 × 260', async () => {
    const doc = docWith({
      f1: { type: 'frame', x: 0, y: 0, w: 1400, h: 700, title: 'Ideen fürs Sommerfest', color: '#ffffff' },
      s1: sticky(60, 80, '#fff27a', 'Bühnenplan bis 15.11.'),
      s2: sticky(300, 80, '#c62828', 'Bierwagen anfragen'),
      s3: sticky(540, 80, '#1565c0', 'Shuttle vom Bahnhof?'),
      s4: sticky(780, 80, '#7bc950', 'Kinder-Workshop'),
      sh: { type: 'shape', shape: 'ellipse', x: 60, y: 380, w: 260, h: 160, color: '#ec4e92', text: 'Start' },
      t1: { type: 'text', x: 400, y: 420, w: 500, h: 60, fontSize: 48, text: 'Ablauf Samstag' },
      c1: { type: 'connector', x: 0, y: 0, w: 0, h: 0, from: { objectId: 's1' }, to: { objectId: 's2' } },
    });
    const svg = thumbnailSvgOf(doc)!.svg;
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'thumb-klein.svg'), svg);
    expect(svg).toContain('IDEEN FÜRS SOMMERFEST');
    expect(svg).toContain('Bühnen');
    // dunkle Notiz: weiße Schrift (WCAG), helle: schwarz
    expect(svg).toMatch(/fill="#ffffff" text-anchor="middle"><tspan[^>]*>Bierwagen/);
    expect(svg).toMatch(/fill="#0a0a0a" text-anchor="middle"><tspan[^>]*>Bühnen/);
    const buf = (await renderThumbnail(doc))!;
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([560, 260]);
    if (SHOTS) await sharp(buf).png().toFile(path.join(SHOTS, 'thumb-klein.png'));
  });

  it('großes Board: dichtester Ausschnitt im Mindestmaßstab, Text bleibt Text', async () => {
    const objs: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 30; i++) objs[`n${i}`] = sticky(8000 + (i % 6) * 230, 5000 + Math.floor(i / 6) * 230, i % 2 ? '#ffb3d1' : '#9fd3ff', `Idee ${i + 1}`);
    objs.far = sticky(0, 0, '#fff27a', 'weit weg');
    const r = thumbnailSvgOf(docWith(objs))!;
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'thumb-gross.svg'), r.svg);
    expect(r.svg).toContain('Idee 1<');
    expect(r.svg).not.toContain('weit weg');
    if (SHOTS) await sharp(Buffer.from(r.svg)).png().toFile(path.join(SHOTS, 'thumb-gross.png'));
  });

  it('leeres Board → keine Vorschau; ausgeblendete Objekte und private Ablagen fehlen', async () => {
    expect(thumbnailSvgOf(new Y.Doc())).toBeNull();
    const doc = docWith({ a: sticky(0, 0, '#fff27a', 'sichtbar'), b: { ...sticky(300, 0, '#fff27a', 'versteckt'), hidden: true } });
    // Platzhalter und Zustand des privaten Modus liegen außerhalb von `objects` (private-mode.ts) – nie im Bild
    doc.getMap('private.hidden').set('x', { by: 'm:2', x: 600, y: 0, w: 200, h: 200 });
    const svg = thumbnailSvgOf(doc)!.svg;
    expect(svg).toContain('sichtbar');
    expect(svg).not.toContain('versteckt');
    expect(svg).not.toMatch(/x="600"/);
  });

  it('Hintergrund aus den Board-Einstellungen', () => {
    const svg = thumbnailSvgOf(docWith({ a: sticky(0, 0, '#fff27a', 'x') }, { color: '#e9f1f8' }))!.svg;
    expect(svg).toContain('fill="#e9f1f8"');
  });
});

