// Zettel abfotografieren (P10, photo-notes.ts): Segmentierung auf einem erzeugten Wandfoto, Farbe → Notizfarbe,
// Tesseract-TSV, Route mit Grenzen, Rechten, Abschalter – und dass das Foto nirgends gespeichert wird.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzePhoto, loadPhotoNotesConfig, nearestStickyColor, tesseractAvailable, textsFromTsv, type OcrEngine } from '../src/photo-notes.js';
import { Browser, loginAdmin, startEnv, type TestEnv } from './helpers.js';
import { LOCAL, signUp } from './local-helpers.js';

/** Belegbilder nur auf Wunsch (PHOTO_SHOTS=<Ordner>) */
const SHOTS = process.env.PHOTO_SHOTS;

/** Wand (hellgrau, leicht verrauscht) mit Zetteln: [x, y, Farbe, Text], 160 × 160, leicht gedreht. */
const NOTES: [number, number, string, string][] = [
  [80, 70, '#f7e15a', 'Bühne'],
  [270, 70, '#f39ac0', 'Zelte'],
  // stößt an den rosa Zettel (andere Farbe)
  [430, 70, '#8fcaf2', 'Bar'],
  [80, 270, '#a6d65a', 'Müll'],
  [270, 270, '#f7a35a', 'Shuttle'],
  [470, 280, '#f7e15a', 'Helfer'],
];

export async function wallPhoto(width = 720, height = 480, notes = NOTES): Promise<Buffer> {
  const rects = notes
    .map(
      ([x, y, c, t], i) =>
        `<g transform="rotate(${(i % 3) - 1} ${x + 80} ${y + 80})"><rect x="${x + 3}" y="${y + 4}" width="160" height="160" fill="rgba(0,0,0,.18)"/>` +
        `<rect x="${x}" y="${y}" width="160" height="160" fill="${c}"/>` +
        `<text x="${x + 80}" y="${y + 92}" font-family="sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#222">${t}</text></g>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="n"><feTurbulence baseFrequency="0.9" numOctaves="1" seed="3"/><feColorMatrix values="0 0 0 0 0.86  0 0 0 0 0.85  0 0 0 0 0.82  0 0 0 0.25 0"/></filter></defs><rect width="100%" height="100%" fill="#dcdad3"/><rect width="100%" height="100%" filter="url(#n)"/>${rects}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** Texterkennung zum Testen: liefert je Ausschnitt einen festen Text (Reihenfolge = Leserichtung). */
const fakeOcr = (texts: string[]): OcrEngine => async (_png, crops) => ({ texts: crops.map((_, i) => texts[i] ?? ''), conf: crops.map(() => 90) });

describe('Auswertung', () => {
  it('findet alle Zettel, trennt verschiedenfarbige Nachbarn, Farbe → Notizfarbe, Leserichtung', async () => {
    const photo = await wallPhoto();
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'wand-test.jpg'), photo);
    const r = await analyzePhoto(photo, fakeOcr(['Bühne', 'Zelte', 'Bar', 'Müll', 'Shuttle', 'Helfer']));
    expect([r.width, r.height]).toEqual([720, 480]);
    expect(r.ocr).toBe(true);
    expect(r.preview).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.notes).toHaveLength(6);
    expect(r.notes.map((n) => n.text)).toEqual(['Bühne', 'Zelte', 'Bar', 'Müll', 'Shuttle', 'Helfer']);
    // Lage ungefähr wie gezeichnet
    for (const [i, n] of r.notes.entries()) {
      const [x, y] = NOTES[i]!;
      expect(Math.abs(n.x - x), `x ${i}`).toBeLessThan(14);
      expect(Math.abs(n.y - y), `y ${i}`).toBeLessThan(14);
      expect(Math.abs(n.w - 160), `w ${i}`).toBeLessThan(28);
    }
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'wand-test.json'), JSON.stringify(r.notes.map((n) => [n.rgb, n.color])));
    expect(r.notes.map((n) => n.color)).toEqual(['#fff27a', '#ffb3d1', '#9fd3ff', '#7bc950', '#ff8c42', '#fff27a']);
  });

  it('ohne Zettel: leere Liste; kein Bild: Fehler', async () => {
    const blank = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#d9d7d0' } }).png().toBuffer();
    const r = await analyzePhoto(blank, fakeOcr([]));
    expect(r.notes).toEqual([]);
    await expect(analyzePhoto(Buffer.from('kein Foto'), null)).rejects.toThrow();
  });

  it('EXIF-Drehung wird beachtet (Hochformat-Foto)', async () => {
    const photo = await wallPhoto();
    // als 90° gedreht gespeichert, Orientierung 6 = „im Uhrzeigersinn drehen zum Anzeigen“
    const rotated = await sharp(photo).rotate(-90).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await analyzePhoto(rotated, null);
    expect([r.width, r.height]).toEqual([720, 480]);
    expect(r.notes).toHaveLength(6);
    expect(r.ocr).toBe(false);
  });

  it('nächste Notizfarbe (Fotos sind dunkler und blasser)', () => {
    expect(nearestStickyColor([230, 210, 70])).toBe('#fff27a');
    expect(nearestStickyColor([190, 40, 40])).toBe('#c62828');
    expect(nearestStickyColor([40, 40, 40])).toBe('#2b2b2b');
    expect(nearestStickyColor([60, 110, 190])).toBe('#1565c0');
  });

  it('Tesseract-TSV: Wörter → Zeilen je Ausschnitt, unsichere Wörter fallen weg', () => {
    const head = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
    const w = (block: number, line: number, top: number, conf: number, text: string) => `5\t1\t${block}\t1\t${line}\t1\t10\t${top}\t50\t20\t${conf}\t${text}`;
    const tsv = [head, w(1, 1, 30, 91, 'Bühne'), w(1, 1, 30, 88, 'aufbauen'), w(1, 2, 60, 90, 'Mo'), w(1, 2, 60, 12, '~~'), w(2, 1, 230, 80, 'Zelte')].join('\n');
    expect(textsFromTsv(tsv, [{ top: 0, height: 200 }, { top: 200, height: 200 }])).toEqual({ texts: ['Bühne aufbauen\nMo', 'Zelte'], conf: [90, 80] });
  });

  it('Einstellungen aus der Umgebung', () => {
    expect(loadPhotoNotesConfig({})).toMatchObject({ enabled: true, maxBytes: 15 * 1024 * 1024, perHour: 30, tesseract: 'tesseract', langs: 'deu+eng' });
    expect(loadPhotoNotesConfig({ STACHEL_PHOTO_NOTES: '0', STACHEL_PHOTO_NOTES_MAX_MB: '3', STACHEL_OCR_LANGS: 'deu', STACHEL_TESSERACT: '' })).toMatchObject({
      enabled: false,
      maxBytes: 3 * 1024 * 1024,
      langs: 'deu',
      tesseract: '',
    });
    expect(loadPhotoNotesConfig({ STACHEL_OCR_LANGS: 'deu; rm -rf' }).langs).toBe('deu+eng');
  });
});

describe('echte Texterkennung (nur mit installiertem Tesseract)', async () => {
  const has = await tesseractAvailable(loadPhotoNotesConfig(process.env).tesseract);
  it.skipIf(!has)('liest gedruckte Wörter auf den Zetteln', async () => {
    const { tesseractEngine } = await import('../src/photo-notes.js');
    const r = await analyzePhoto(await wallPhoto(), tesseractEngine(loadPhotoNotesConfig(process.env)));
    expect(r.ocr).toBe(true);
    const all = r.notes.map((n) => n.text.toLowerCase()).join(' ');
    for (const w of ['bühne', 'zelte', 'bar', 'shuttle', 'helfer']) expect(all).toContain(w);
  });
});

describe('Route POST /api/boards/:id/photo-notes', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ photoNotes: { ...loadPhotoNotesConfig({}), perHour: 3, maxBytes: 2 * 1024 * 1024 } });
  });
  afterAll(async () => {
    await env?.stop();
  });

  const post = (b: Browser, id: string, body: Buffer, type = 'image/jpeg', csrf = true) => b.req('POST', `/api/boards/${id}/photo-notes`, { body: new Uint8Array(body), headers: { 'Content-Type': type }, csrf });
  const files = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : []);

  it('wertet aus, speichert nichts, Instanz meldet die Funktion', async () => {
    expect((await new Browser(env.base).get('/api/instance')).body.photoNotes).toBe(true);
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'Wand' })).body.board;
    const before = files(env.cfg.dataDir);
    const dbBefore = (env.srv.db.prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number }).n;
    const r = await post(b, board.id, await wallPhoto());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.notes).toHaveLength(6);
    expect(r.headers.get('cache-control')).toBe('no-store');
    // nichts auf Platte, nichts in der Datenbank
    expect(files(env.cfg.dataDir).filter((f) => !f.endsWith('-wal') && !f.endsWith('-shm') && !f.includes('stachel.sqlite'))).toEqual(before.filter((f) => !f.endsWith('-wal') && !f.endsWith('-shm') && !f.includes('stachel.sqlite')));
    expect((env.srv.db.prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number }).n).toBe(dbBefore);
  });

  it('Anmeldung, CSRF, Board, Typ, Größe, Rate', async () => {
    const anon = new Browser(env.base);
    expect((await post(anon, 'x', Buffer.from('x'))).status).toBe(401);
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'Grenzen' })).body.board;
    expect((await post(b, board.id, Buffer.from('x'), 'image/jpeg', false)).status).toBe(403);
    expect((await post(b, 'gibtesnicht', await wallPhoto())).status).toBe(404);
    const bad = await post(b, board.id, Buffer.from('kein Bild'));
    expect([bad.status, bad.body.error]).toEqual([415, 'unsupported_type']);
    const big = await post(b, board.id, Buffer.alloc(2 * 1024 * 1024 + 64 * 1024, 1));
    expect(big.status).toBe(413);
    // Rate: 3 je Stunde und Person – die Auswertung im ersten Test und das unlesbare Foto zählten schon
    const photo = await wallPhoto(360, 240, [[40, 40, '#f7e15a', 'A']]);
    const codes: number[] = [];
    for (let i = 0; i < 2; i++) codes.push((await post(b, board.id, photo)).status);
    expect(codes).toEqual([200, 429]);
  });

  it('abgeschaltet: keine Route, Instanz meldet false', async () => {
    const off = await startEnv({ photoNotes: { ...loadPhotoNotesConfig({ STACHEL_PHOTO_NOTES: 'off' }) } });
    try {
      expect((await new Browser(off.base).get('/api/instance')).body.photoNotes).toBe(false);
      const b = await loginAdmin(off);
      const board = (await b.post('/api/boards', { title: 'Aus' })).body.board;
      expect((await post(b, board.id, await wallPhoto())).status).toBe(404);
    } finally {
      await off.stop();
    }
  });
});

describe('Rechte im Modus local', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('nur mit Bearbeiten-Recht; Fremde sehen das Board gar nicht', async () => {
    const owner = await signUp(env, 'Olga Owner', 'olga@example.org');
    const viewer = await signUp(env, 'Vera Viewer', 'vera@example.org');
    const stranger = await signUp(env, 'Sven Fremd', 'sven@example.org');
    const board = (await owner.post('/api/boards', { title: 'Workshop' })).body.board;
    await owner.post(`/api/boards/${board.id}/share`, { emails: ['vera@example.org'], role: 'view' });
    const photo = await wallPhoto(360, 240, [[40, 40, '#f7e15a', 'A']]);
    const post = (b: Browser) => b.req('POST', `/api/boards/${board.id}/photo-notes`, { body: new Uint8Array(photo), headers: { 'Content-Type': 'image/jpeg' } });
    expect((await post(owner)).status).toBe(200);
    expect((await post(viewer)).status).toBe(403);
    expect((await post(stranger)).status).toBe(404);
  });
});
