// Minimaler PDF-Schreiber (PDF 1.4): je Seite ein Bild in Seitengröße. Bilder verlustfrei (Flate, RGB) – oder als
// JPEG, wenn der Browser kein CompressionStream kann. Keine Abhängigkeit, kein Netz.

export interface PdfImage {
  /** Pixelmaße */
  width: number;
  height: number;
  /** komprimierte Bilddaten */
  data: Uint8Array;
  filter: 'FlateDecode' | 'DCTDecode';
}

export interface PdfPage {
  /** Seitengröße in Punkt (1/72 Zoll) */
  widthPt: number;
  heightPt: number;
  image: PdfImage;
}

const enc = new TextEncoder();

/** Text als PDF-String (UTF-16BE mit BOM, hex) – für Titel mit Umlauten. */
export function pdfText(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** PDF-Datei aus Seiten bauen (Bytes). */
export function buildPdf(pages: readonly PdfPage[], info: { title?: string; date?: Date } = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  // Objekte: 1 Katalog, 2 Seitenbaum, 3 Info, dann je Seite: Seite, Inhalt, Bild
  const pageObj = (i: number) => 4 + i * 3;
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  const d = info.date ?? new Date();
  const p2 = (v: number) => String(v).padStart(2, '0');
  const date = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
  obj(3, () => push(`<< /Producer ${pdfText('Stachel')} /Creator ${pdfText('Stachel')} /CreationDate (${date})${info.title ? ` /Title ${pdfText(info.title)}` : ''} >>`));

  pages.forEach((p, i) => {
    const n = pageObj(i);
    const w = num(p.widthPt);
    const h = num(p.heightPt);
    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`));
    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im${i} Do\nQ\n`;
    obj(n + 1, () => push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`));
    obj(n + 2, () => {
      const img = p.image;
      push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter} /Length ${img.data.length} >>\nstream\n`);
      push(img.data);
      push('\nendstream');
    });
  });

  const count = 3 + pages.length * 3 + 1;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** RGB-Bytes aus RGBA (Alpha wird auf `bg` gemischt). */
export function rgbaToRgb(rgba: Uint8ClampedArray, bg: [number, number, number] = [255, 255, 255]): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    out[i * 3] = Math.round(rgba[i * 4] * a + bg[0] * (1 - a));
    out[i * 3 + 1] = Math.round(rgba[i * 4 + 1] * a + bg[1] * (1 - a));
    out[i * 3 + 2] = Math.round(rgba[i * 4 + 2] * a + bg[2] * (1 - a));
  }
  return out;
}

/** zlib-Deflate über die Browser-API (CompressionStream 'deflate' = zlib-Format wie PDF FlateDecode). */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Canvas → PDF-Bild (verlustfrei, sonst JPEG). */
export async function canvasToPdfImage(canvas: HTMLCanvasElement, bg: [number, number, number] = [255, 255, 255]): Promise<PdfImage> {
  const { width, height } = canvas;
  if (typeof CompressionStream !== 'undefined') {
    const ctx = canvas.getContext('2d')!;
    const rgb = rgbaToRgb(ctx.getImageData(0, 0, width, height).data, bg);
    return { width, height, data: await deflate(rgb), filter: 'FlateDecode' };
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG fehlgeschlagen'))), 'image/jpeg', 0.92));
  return { width, height, data: new Uint8Array(await blob.arrayBuffer()), filter: 'DCTDecode' };
}
