// Metadaten aus hochgeladenen Bildern entfernen (docs/contract.md §3 Bilder, Datenschutz): EXIF (inkl.
// GPS, Kamera, Aufnahmezeit), XMP, IPTC, Kommentare, PNG-Textfelder und Anhänge hinter dem JPEG-Ende. Verlustfrei durch
// Weglassen der Blöcke; nur wenn das Bild eine EXIF-Drehung hat (Handy-Fotos im Hochformat), wird es einmal gedreht neu
// kodiert, damit es ohne die Angabe richtig herum steht. Farbprofile (ICC) bleiben. Die verkleinerten Stufen
// (image-variants.ts) erzeugt sharp ohnehin ohne Metadaten.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Db } from './db.js';
import { sniffImage, type ImageInfo } from './images.js';

const LIMIT_INPUT_PIXELS = 100_000_000;

export class ImageCleanError extends Error {}

/** Bild ohne Metadaten; `info` passt zum Ergebnis (nach einer Drehung sind Breite/Höhe getauscht). */
export async function cleanImage(buf: Buffer, info: ImageInfo): Promise<{ buf: Buffer; info: ImageInfo }> {
  if (info.mime === 'image/gif') {
    // GIF kennt kein EXIF; ungewöhnlicher Aufbau → unverändert (wie bisher) statt ablehnen
    try {
      return done(stripGif(buf), info);
    } catch {
      return done(buf, info);
    }
  }
  let orientation = 1;
  let animated = false;
  try {
    const meta = await sharp(buf, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'none' }).metadata();
    orientation = meta.orientation ?? 1;
    animated = (meta.pages ?? 1) > 1;
  } catch {
    // Kopf nicht lesbar: unten verlustfrei versuchen
  }
  if (orientation > 1 && !animated) return done(await reencode(buf, info), info);
  try {
    const out = info.mime === 'image/jpeg' ? stripJpeg(buf) : info.mime === 'image/png' ? stripPng(buf) : stripWebp(buf);
    return done(out, info);
  } catch {
    // Aufbau unerwartet: lieber neu kodieren als Metadaten durchlassen
    return done(await reencode(buf, info), info);
  }
}

function done(out: Buffer, before: ImageInfo): { buf: Buffer; info: ImageInfo } {
  const info = sniffImage(out);
  if (!info || info.mime !== before.mime) throw new ImageCleanError('Bild nach dem Bereinigen unlesbar');
  return { buf: out, info };
}

async function reencode(buf: Buffer, info: ImageInfo): Promise<Buffer> {
  try {
    const img = sharp(buf, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'none' }).rotate().keepIccProfile();
    if (info.mime === 'image/jpeg') return await img.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    if (info.mime === 'image/png') return await img.png().toBuffer();
    return await img.webp({ quality: 92 }).toBuffer();
  } catch (e) {
    throw new ImageCleanError(`Bild ließ sich nicht lesen: ${(e as Error).message}`);
  }
}

/**
 * JPEG: Segmente bis zum Bildbeginn (SOS) durchgehen und nur behalten, was zur Darstellung gehört: APP0 (JFIF),
 * APP2 nur als ICC-Profil, APP14 (Adobe-Farbraum), Tabellen und Rahmen. Weg: APP1 (EXIF/XMP), APP13 (IPTC), COM, übrige
 * APPn (u. a. MPF mit Zusatzbildern). Nach dem Ende (EOI) Angehängtes (Hersteller-Anhänge) abschneiden.
 */
export function stripJpeg(b: Buffer): Buffer {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new ImageCleanError('kein JPEG');
  const parts: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  // Unlesbarer Rest (kaputte/abgeschnittene Datei): unverändert lassen – Metadaten-Leser finden dort auch nichts
  const rest = () => Buffer.concat([...parts, b.subarray(i)]);
  for (;;) {
    if (i + 4 > b.length || b[i] !== 0xff) return rest();
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // Füllbyte
      continue;
    }
    if (marker === 0xd9) return rest();
    const len = b.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (len < 2 || end > b.length) return rest();
    if (marker === 0xda) {
      // Bilddaten: bis zum ersten EOI (in den Daten ist 0xFF immer gestopft bzw. ein Marker)
      // ohne EOI (abgeschnittene Datei): Rest unverändert, wie der Browser es zeigt
      const eoi = findEoi(b, end);
      parts.push(b.subarray(i, eoi < 0 ? b.length : eoi + 2));
      return Buffer.concat(parts);
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = !isApp && marker !== 0xfe ? true : marker === 0xe0 || marker === 0xee || (marker === 0xe2 && b.toString('latin1', i + 4, i + 16) === 'ICC_PROFILE\0');
    if (keep) parts.push(b.subarray(i, end));
    i = end;
  }
}

function findEoi(b: Buffer, from: number): number {
  for (let j = from; j < b.length - 1; j++) {
    if (b[j] === 0xff && b[j + 1] === 0xd9) return j;
  }
  return -1;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Textfelder, EXIF und Zeitstempel; alles andere (auch Farbprofil, Animation) bleibt. */
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

export function stripPng(b: Buffer): Buffer {
  if (!b.subarray(0, 8).equals(PNG_SIG)) throw new ImageCleanError('kein PNG');
  const parts: Buffer[] = [PNG_SIG];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > b.length) break; // kaputt/abgeschnitten: Rest unverändert
    if (!PNG_DROP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  return Buffer.concat([...parts, b.subarray(i)]);
}

/** WebP (RIFF): Blöcke EXIF und XMP weglassen und die Flags im VP8X-Kopf zurücksetzen. */
export function stripWebp(b: Buffer): Buffer {
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') throw new ImageCleanError('kein WebP');
  const riffEnd = Math.min(b.length, 8 + b.readUInt32LE(4));
  const parts: Buffer[] = [];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const type = b.toString('latin1', i, i + 4);
    const len = b.readUInt32LE(i + 4);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > riffEnd) {
      parts.push(b.subarray(i, riffEnd)); // kaputt/abgeschnitten: Rest unverändert
      i = riffEnd;
      break;
    }
    if (type === 'VP8X') {
      const c = Buffer.from(b.subarray(i, Math.min(end, riffEnd)));
      c[8] = c[8]! & ~(0x08 | 0x04); // EXIF- und XMP-Flag
      parts.push(c);
    } else if (type !== 'EXIF' && type !== 'XMP ') {
      parts.push(b.subarray(i, Math.min(end, riffEnd)));
    }
    i = end;
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** GIF: Kommentar-Blöcke und XMP-Anwendungsblöcke weglassen (Bilddaten und Animation bleiben byte-gleich). */
export function stripGif(b: Buffer): Buffer {
  const sig = b.toString('latin1', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new ImageCleanError('kein GIF');
  let i = 13;
  const flags = b[10]!;
  if (flags & 0x80) i += 3 * (1 << ((flags & 0x07) + 1)); // globale Farbtabelle
  const parts: Buffer[] = [b.subarray(0, i)];
  const subBlocksEnd = (from: number) => {
    let j = from;
    for (;;) {
      if (j >= b.length) throw new ImageCleanError('GIF zu kurz');
      const n = b[j]!;
      j += 1 + n;
      if (n === 0) return j;
    }
  };
  while (i < b.length) {
    const intro = b[i]!;
    if (intro === 0x3b) {
      parts.push(b.subarray(i, i + 1));
      return Buffer.concat(parts);
    }
    if (intro === 0x2c) {
      // Bild: Kopf (10) + lokale Farbtabelle + LZW-Größe + Datenblöcke
      let j = i + 10;
      const f = b[i + 9]!;
      if (f & 0x80) j += 3 * (1 << ((f & 0x07) + 1));
      const end = subBlocksEnd(j + 1);
      parts.push(b.subarray(i, end));
      i = end;
    } else if (intro === 0x21) {
      const label = b[i + 1]!;
      const end = subBlocksEnd(i + 2);
      const app = label === 0xff ? b.toString('latin1', i + 3, i + 14) : '';
      const drop = label === 0xfe || (label === 0xff && app !== 'NETSCAPE2.0' && app !== 'ANIMEXTS1.0');
      if (!drop) parts.push(b.subarray(i, end));
      i = end;
    } else {
      throw new ImageCleanError('GIF-Block unbekannt');
    }
  }
  // ohne Trailer: so lassen wie gelesen, Trailer anhängen
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

/**
 * Einmalig beim Start (Marker-Datei in DATA_DIR): schon gespeicherte Originale bereinigen. Läuft im Hintergrund, Bild für
 * Bild; Fehler bei einzelnen Bildern werden geloggt und übersprungen.
 */
export async function cleanStoredImages(db: Db, dataDir: string, imagesDir: string, log: (msg: string, err?: unknown) => void): Promise<number> {
  const marker = path.join(dataDir, 'images-clean-v1.done');
  if (fs.existsSync(marker)) return 0;
  const rows = db.prepare(`SELECT id, mime, width, height FROM images WHERE mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`).all() as unknown as (ImageInfo & { id: string })[];
  let n = 0;
  for (const r of rows) {
    const file = path.join(imagesDir, r.id);
    try {
      if (!fs.existsSync(file)) continue;
      const buf = await fs.promises.readFile(file);
      const info = sniffImage(buf);
      if (!info) continue;
      const out = await cleanImage(buf, info);
      if (out.buf.equals(buf)) continue;
      await fs.promises.writeFile(`${file}.clean.tmp`, out.buf);
      await fs.promises.rename(`${file}.clean.tmp`, file);
      db.prepare('UPDATE images SET width = ?, height = ?, bytes = ? WHERE id = ?').run(out.info.width, out.info.height, out.buf.length, r.id);
      n++;
    } catch (e) {
      log(`Bild ${r.id}: Metadaten ließen sich nicht entfernen`, e);
    }
  }
  fs.writeFileSync(marker, `${new Date().toISOString()} ${n}\n`);
  return n;
}
