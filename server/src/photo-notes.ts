// „Zettel abfotografieren“ (P10, docs/features/photo-notes.md): Foto einer Wand mit Papier-Klebezetteln → einzelne Zettel
// (Farbsegmentierung) mit Farbe, Lage und Text (Texterkennung mit Tesseract, deu+eng) → die Apps/das Web zeigen eine
// Vorschau und legen daraus Haftnotizen an. Alles läuft auf diesem Server, ohne Cloud: Das Foto wird nur im Speicher
// verarbeitet und danach verworfen (nichts auf Platte, nichts in der Datenbank, kein Protokoll des Inhalts).
// Abschaltbar mit STACHEL_PHOTO_NOTES=0; Grenzen: Größe (STACHEL_PHOTO_NOTES_MAX_MB), Rate je Person und Stunde.
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { STICKY_COLORS } from '../../shared/protocol.js';
import { sendError } from './http-util.js';
import { RateLimiter } from './rate-limit.js';

export interface PhotoNotesConfig {
  /** STACHEL_PHOTO_NOTES (Standard an; 0/false/off = aus) */
  enabled: boolean;
  /** größtes Foto in Bytes (STACHEL_PHOTO_NOTES_MAX_MB, Standard 15) */
  maxBytes: number;
  /** Fotos je Person und Stunde (STACHEL_PHOTO_NOTES_PER_HOUR, Standard 30) */
  perHour: number;
  /** Programm der Texterkennung (STACHEL_TESSERACT, Standard `tesseract`); leer = ohne Texterkennung */
  tesseract: string;
  /** Sprachen (STACHEL_OCR_LANGS, Standard `deu+eng`) */
  langs: string;
}

const off = (v: string | undefined) => !!v && /^(0|false|off|no|nein)$/i.test(v.trim());
const int = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

export function loadPhotoNotesConfig(env: NodeJS.ProcessEnv): PhotoNotesConfig {
  const langs = (env.STACHEL_OCR_LANGS ?? '').trim();
  return {
    enabled: !off(env.STACHEL_PHOTO_NOTES),
    maxBytes: int(env.STACHEL_PHOTO_NOTES_MAX_MB, 15, 1, 50) * 1024 * 1024,
    perHour: int(env.STACHEL_PHOTO_NOTES_PER_HOUR, 30, 1, 1000),
    tesseract: env.STACHEL_TESSERACT === undefined ? 'tesseract' : env.STACHEL_TESSERACT.trim(),
    langs: /^[a-z_]{3,10}(\+[a-z_]{3,10}){0,4}$/i.test(langs) ? langs : 'deu+eng',
  };
}

// ---- Segmentierung (reine Rechnung auf RGB-Bildpunkten, getestet in photo-notes.test.ts) ---------------------------------

/** Ein erkannter Zettel in Bildpunkten des untersuchten Bilds. */
export interface NoteBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** mittlere Farbe des Papiers */
  rgb: [number, number, number];
}

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Zettel finden: Papier ist farbig (Sättigung) oder heller als die Wand. Benachbarte Papier-Bildpunkte gehören zusammen,
 * wenn ihr Farbton nah ist – so trennen sich aneinanderstoßende Zettel verschiedener Farbe. Zu kleine, zu große, zu
 * schmale und löchrige Flächen fallen weg; gleichfarbige Zettel, die sich berühren, teilt ein Raster nach der
 * typischen Zettelgröße.
 */
export function segmentNotes(rgb: Uint8Array | Buffer, w: number, h: number): NoteBox[] {
  const n = w * h;
  const H = new Float32Array(n);
  const S = new Float32Array(n);
  const V = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [hh, ss, vv] = hsv(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    H[i] = hh;
    S[i] = ss;
    V[i] = vv;
  }
  // Wand: Median der Helligkeit am Rand
  const ring: number[] = [];
  for (let x = 0; x < w; x++) ring.push(V[x]!, V[(h - 1) * w + x]!);
  for (let y = 0; y < h; y++) ring.push(V[y * w]!, V[y * w + w - 1]!);
  ring.sort((a, b) => a - b);
  const wallV = ring[Math.floor(ring.length / 2)] ?? 0.5;
  // 1 = farbiges Papier, 2 = helles (weißes) Papier auf dunklerer Wand
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (S[i]! >= 0.2 && V[i]! >= 0.32) kind[i] = 1;
    else if (wallV < 0.72 && S[i]! < 0.2 && V[i]! >= Math.min(0.97, wallV + 0.22)) kind[i] = 2;
  }
  // kleine Löcher (Schrift, Rauschen) schließen: Bildpunkt mit ≥ 5 Papier-Nachbarn gleicher Art wird Papier – farbige nur,
  // wenn die Nachbarn denselben Farbton haben (sonst verbände er zwei aneinanderstoßende Zettel); er übernimmt ihn
  const closed = kind.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (kind[i]) continue;
      const c = [0, 0, 0];
      let hue = -1;
      let mixed = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * w + dx;
          c[kind[j]!]!++;
          if (kind[j] !== 1) continue;
          if (hue < 0) hue = H[j]!;
          else if (hueDiff(hue, H[j]!) >= 22) mixed = true;
        }
      if (c[1]! >= 5 && !mixed) {
        closed[i] = 1;
        H[i] = hue;
      } else if (c[2]! >= 5) closed[i] = 2;
    }
  }
  // Zusammenhang (Union-Find), getrennt nach Art und Farbton
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const similar = (a: number, b: number) => closed[a] === closed[b] && (closed[a] === 2 || hueDiff(H[a]!, H[b]!) < 22);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!closed[i]) continue;
      if (x + 1 < w && closed[i + 1] && similar(i, i + 1)) join(i, i + 1);
      if (y + 1 < h && closed[i + w] && similar(i, i + w)) join(i, i + w);
    }
  }
  type Comp = { minX: number; minY: number; maxX: number; maxY: number; count: number; paper: number; r: number; g: number; b: number };
  const comps = new Map<number, Comp>();
  for (let i = 0; i < n; i++) {
    if (!closed[i]) continue;
    const root = find(i);
    const x = i % w;
    const y = (i - x) / w;
    let c = comps.get(root);
    if (!c) comps.set(root, (c = { minX: x, minY: y, maxX: x, maxY: y, count: 0, paper: 0, r: 0, g: 0, b: 0 }));
    c.minX = Math.min(c.minX, x);
    c.minY = Math.min(c.minY, y);
    c.maxX = Math.max(c.maxX, x);
    c.maxY = Math.max(c.maxY, y);
    c.count++;
    if (kind[i]) {
      c.paper++;
      c.r += rgb[i * 3]!;
      c.g += rgb[i * 3 + 1]!;
      c.b += rgb[i * 3 + 2]!;
    }
  }
  const minArea = n * 0.0015;
  const maxArea = n * 0.4;
  const boxes: (NoteBox & { area: number })[] = [];
  for (const c of comps.values()) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const area = bw * bh;
    const aspect = bw / bh;
    if (c.count < minArea || area > maxArea || bw < 8 || bh < 8) continue;
    if (aspect < 0.25 || aspect > 4) continue;
    if (c.count / area < 0.5) continue;
    const px = Math.max(1, c.paper);
    boxes.push({ x: c.minX, y: c.minY, w: bw, h: bh, area, rgb: [Math.round(c.r / px), Math.round(c.g / px), Math.round(c.b / px)] });
  }
  if (!boxes.length) return [];
  // berührende gleichfarbige Zettel: nach typischer Größe (Median) in ein Raster teilen
  const ws = boxes.map((b) => b.w).sort((a, b) => a - b);
  const hs = boxes.map((b) => b.h).sort((a, b) => a - b);
  const medW = ws[Math.floor(ws.length / 2)]!;
  const medH = hs[Math.floor(hs.length / 2)]!;
  const out: NoteBox[] = [];
  for (const b of boxes) {
    const cols = boxes.length >= 3 ? Math.max(1, Math.round(b.w / medW)) : 1;
    const rows = boxes.length >= 3 ? Math.max(1, Math.round(b.h / medH)) : 1;
    if (cols * rows > 1 && cols * rows <= 12) {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          out.push({ x: Math.round(b.x + (b.w * c) / cols), y: Math.round(b.y + (b.h * r) / rows), w: Math.round(b.w / cols), h: Math.round(b.h / rows), rgb: b.rgb });
    } else out.push({ x: b.x, y: b.y, w: b.w, h: b.h, rgb: b.rgb });
  }
  // Leserichtung: Zeilen von oben, darin von links
  out.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
  return out;
}

// ---- Farbe → Notizfarbe ----------------------------------------------------------------------------------------------

function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const PALETTE = STICKY_COLORS.map((hex) => ({ hex, lab: lab(hexRgb(hex)) }));

/**
 * Nächste Notizfarbe zur Papierfarbe (Lab-Abstand). Fotos sind meist dunkler und blasser als das Papier: die Helligkeit
 * zählt deshalb nur halb.
 */
export function nearestStickyColor(rgb: [number, number, number]): string {
  const [l, a, b] = lab(rgb);
  let best = PALETTE[0]!;
  let bestD = Infinity;
  for (const p of PALETTE) {
    const d = ((l - p.lab[0]) * 0.5) ** 2 + (a - p.lab[1]) ** 2 + (b - p.lab[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best.hex;
}

// ---- Texterkennung (Tesseract als eigener Prozess, ohne Netz) -------------------------------------------------------

export interface OcrWord {
  text: string;
  /** Ausschnitt-Nummer */
  crop: number;
  line: number;
  conf: number;
}

export type OcrEngine = (png: Buffer, crops: { top: number; height: number }[]) => Promise<{ texts: string[]; conf: number[] } | null>;

/** Tesseract-TSV in Texte je Ausschnitt (Zeilen bleiben Zeilen). */
export function textsFromTsv(tsv: string, crops: { top: number; height: number }[]): { texts: string[]; conf: number[] } {
  const lines: Map<string, { crop: number; words: string[]; confs: number[]; top: number }>[] = crops.map(() => new Map());
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c.slice(11).join('\t').trim();
    const conf = Number(c[10]);
    if (!text || !(conf >= 30)) continue;
    const top = Number(c[7]);
    const height = Number(c[9]);
    const mid = top + height / 2;
    const crop = crops.findIndex((k) => mid >= k.top && mid < k.top + k.height);
    if (crop < 0) continue;
    const key = `${c[2]}-${c[3]}-${c[4]}`;
    const m = lines[crop]!;
    let l = m.get(key);
    if (!l) m.set(key, (l = { crop, words: [], confs: [], top }));
    l.words.push(text);
    l.confs.push(conf);
  }
  const texts = lines.map((m) =>
    [...m.values()]
      .sort((a, b) => a.top - b.top)
      .map((l) => l.words.join(' '))
      .join('\n')
      .replace(/[|_~]+/g, '')
      .trim(),
  );
  const conf = lines.map((m) => {
    const all = [...m.values()].flatMap((l) => l.confs);
    return all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : 0;
  });
  return { texts, conf };
}

let tesseractOk: Promise<boolean> | null = null;

/** Gibt es das Tesseract-Programm? (einmal je Prozess geprüft) */
export function tesseractAvailable(bin: string): Promise<boolean> {
  if (!bin) return Promise.resolve(false);
  tesseractOk ??= new Promise((resolve) => {
    try {
      const p = spawn(bin, ['--version'], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  return tesseractOk;
}

/** Texterkennung über das Tesseract-Programm: Bild über stdin, TSV über stdout, ein Kern, 40 s Zeitlimit. */
export function tesseractEngine(cfg: Pick<PhotoNotesConfig, 'tesseract' | 'langs'>): OcrEngine {
  return async (png, crops) => {
    if (!(await tesseractAvailable(cfg.tesseract))) return null;
    const tsv = await new Promise<string>((resolve, reject) => {
      const p = spawn(cfg.tesseract, ['stdin', 'stdout', '-l', cfg.langs, '--psm', '4', 'tsv'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, OMP_THREAD_LIMIT: '1' },
      });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => p.kill('SIGKILL'), 40_000);
      p.stdout.on('data', (d: Buffer) => chunks.push(d));
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
        else reject(new Error(`tesseract endete mit ${code}`));
      });
      p.stdin.on('error', () => {});
      p.stdin.end(png);
    });
    return textsFromTsv(tsv, crops);
  };
}

// ---- Ablauf -----------------------------------------------------------------------------------------------------------

/** Ergebnis für Web und Apps (Vertrag §3 „Zettel abfotografieren“). */
export interface PhotoNotesResult {
  /** Maße des ausgewerteten (gedrehten, verkleinerten) Fotos; Lage der Zettel in diesen Bildpunkten */
  width: number;
  height: number;
  notes: { x: number; y: number; w: number; h: number; color: string; rgb: string; text: string; conf: number }[];
  /** Texterkennung lief (false = kein Tesseract, nur Zettel und Farben) */
  ocr: boolean;
  /** kleine Vorschau des Fotos (JPEG, data:-URI) für die Auswahl – wird nicht gespeichert */
  preview: string;
}

export class PhotoNotesError extends Error {}

const LIMIT_INPUT_PIXELS = 60_000_000;
const SEG_SIDE = 480;
const WORK_SIDE = 2400;
const MAX_NOTES = 60;
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

/** Foto auswerten (nur im Speicher). */
export async function analyzePhoto(buf: Buffer, ocr: OcrEngine | null): Promise<PhotoNotesResult> {
  let base: Sharp;
  let meta: Metadata;
  try {
    base = sharp(buf, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'none', animated: false }).rotate();
    meta = await sharp(buf, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'none' }).metadata();
  } catch {
    throw new PhotoNotesError('unreadable');
  }
  if (!meta.width || !meta.height || !['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff'].includes(meta.format ?? '')) throw new PhotoNotesError('unreadable');
  // gedreht (EXIF) und auf Arbeitsgröße
  const work = await base
    .resize({ width: WORK_SIDE, height: WORK_SIDE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw new PhotoNotesError('unreadable');
    });
  const W = work.info.width;
  const Hh = work.info.height;
  const seg = await sharp(work.data).resize({ width: SEG_SIDE, height: SEG_SIDE, fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const k = W / seg.info.width;
  const boxes = segmentNotes(seg.data, seg.info.width, seg.info.height).slice(0, MAX_NOTES);
  const notes: PhotoNotesResult['notes'] = boxes.map((b) => ({
    x: Math.round(b.x * k),
    y: Math.round(b.y * k),
    w: Math.round(b.w * k),
    h: Math.round(b.h * k),
    color: nearestStickyColor(b.rgb),
    rgb: `#${hex2(b.rgb[0])}${hex2(b.rgb[1])}${hex2(b.rgb[2])}`,
    text: '',
    conf: 0,
  }));
  let ran = false;
  if (ocr && notes.length) {
    // Ausschnitte (innen etwas kleiner, ohne Kante/Schatten) untereinander auf weißem Grund, Graustufen, Kontrast gestreckt
    const target = 640;
    const gap = 40;
    const parts: { input: Buffer; top: number; left: number }[] = [];
    const crops: { top: number; height: number }[] = [];
    let top = gap;
    for (const nb of notes) {
      const ix = Math.round(nb.w * 0.05);
      const iy = Math.round(nb.h * 0.05);
      const left = Math.max(0, nb.x + ix);
      const t = Math.max(0, nb.y + iy);
      const width = Math.max(1, Math.min(W - left, nb.w - 2 * ix));
      const height = Math.max(1, Math.min(Hh - t, nb.h - 2 * iy));
      const scale = Math.min(3, target / width);
      const img = await sharp(work.data)
        .extract({ left, top: t, width, height })
        .resize({ width: Math.max(1, Math.round(width * scale)) })
        .greyscale()
        .normalise()
        .png()
        .toBuffer({ resolveWithObject: true });
      parts.push({ input: img.data, top, left: gap });
      crops.push({ top: top - gap / 2, height: img.info.height + gap });
      top += img.info.height + gap;
    }
    const sheetW = Math.max(...parts.map((p) => p.left)) + target + gap;
    const sheet = await sharp({ create: { width: Math.round(sheetW + target * 2), height: top, channels: 3, background: '#ffffff' } })
      .composite(parts)
      .greyscale()
      .png()
      .toBuffer();
    const res = await ocr(sheet, crops).catch(() => null);
    if (res) {
      ran = true;
      notes.forEach((nt, i) => {
        nt.text = (res.texts[i] ?? '').slice(0, 500);
        nt.conf = res.conf[i] ?? 0;
      });
    }
  }
  const preview = await sharp(work.data).resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  return { width: W, height: Hh, notes, ocr: ran, preview: `data:image/jpeg;base64,${preview.toString('base64')}` };
}

/** `POST /api/boards/:id/photo-notes` (Rohdaten image/*) – im Sitzungs-Bereich (Board-Recht „bearbeiten“, access.ts). */
export async function registerPhotoNotes(scope: FastifyInstance, deps: { cfg: PhotoNotesConfig; boardExists: (id: string) => boolean; ocr?: OcrEngine | null }) {
  const { cfg } = deps;
  if (!cfg.enabled) return;
  const ocr = deps.ocr !== undefined ? deps.ocr : cfg.tesseract ? tesseractEngine(cfg) : null;
  const limit = new RateLimiter(cfg.perHour, 3600_000);
  const timer = setInterval(() => limit.prune(), 10 * 60_000);
  timer.unref();
  scope.addHook('onClose', async () => clearInterval(timer));
  // zwei Auswertungen gleichzeitig, der Rest wartet kurz (Speicher und CPU)
  let active = 0;
  await scope.register(async (s) => {
    s.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: cfg.maxBytes }, (_req, body, done) => done(null, body));
    s.post<{ Params: { id: string } }>('/api/boards/:id/photo-notes', { bodyLimit: cfg.maxBytes }, async (req, reply) => {
      if (!deps.boardExists(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) return sendError(reply, 400, 'invalid_input', 'Bitte ein Foto senden.');
      if (!limit.allow(req.session!.userKey)) return sendError(reply, 429, 'rate_limited', 'Gerade wurden viele Fotos ausgewertet. Bitte versuch es später noch einmal.');
      if (active >= 2) return sendError(reply, 503, 'busy', 'Der Server wertet gerade andere Fotos aus. Bitte versuch es gleich noch einmal.');
      active++;
      try {
        const result = await analyzePhoto(buf, ocr);
        reply.header('Cache-Control', 'no-store');
        return { ok: true, ...result };
      } catch (e) {
        if (e instanceof PhotoNotesError) return sendError(reply, 415, 'unsupported_type', 'Das Foto ließ sich nicht lesen. Bitte ein JPEG, PNG oder WebP senden.');
        throw e;
      } finally {
        active--;
      }
    });
  });
}
