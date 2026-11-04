// Bildtyp per Magic Bytes erkennen und Abmessungen aus dem Header lesen (keine Dateiendungen).

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

const ascii = (b: Buffer, start: number, end: number) => b.toString('latin1', start, end);

function png(b: Buffer): ImageInfo | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v) || ascii(b, 12, 16) !== 'IHDR') return null;
  return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gif(b: Buffer): ImageInfo | null {
  const head = ascii(b, 0, 6);
  if (b.length < 10 || (head !== 'GIF87a' && head !== 'GIF89a')) return null;
  return { mime: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webp(b: Buffer): ImageInfo | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 12) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { mime: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const b1 = b[21]!, b2 = b[22]!, b3 = b[23]!, b4 = b[24]!;
    return {
      mime: 'image/webp',
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8X') {
    return { mime: 'image/webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}

function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i < b.length) i++;
    const marker = b[i]!;
    i++;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // Ende/Scan ohne SOF
    if (i + 2 > b.length) return null;
    const len = b.readUInt16BE(i);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 7 > b.length) return null;
      return { mime: 'image/jpeg', height: b.readUInt16BE(i + 3), width: b.readUInt16BE(i + 5) };
    }
    i += len;
  }
  return null;
}

/** Erkennt PNG/JPEG/WebP/GIF; sonst null. */
export function sniffImage(b: Buffer): ImageInfo | null {
  const info = png(b) ?? jpeg(b) ?? webp(b) ?? gif(b);
  if (!info || info.width < 1 || info.height < 1) return null;
  return info;
}
