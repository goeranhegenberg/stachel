// Hilfsdateien von pdf.js (Standardschriften, CMaps, WebAssembly-Dekoder für JBIG2/JPEG 2000) als Build-Dateien.
// Vite benennt sie mit Hash um, pdf.js erwartet dagegen feste Ordner: diese BinaryDataFactory ordnet Dateinamen den
// Build-Adressen zu. Nur zusammen mit pdf.js nachgeladen (pdf.ts), damit die Liste nicht im Editor-Paket landet.
// Nur Adressen (ohne Einbetten): Vite legt die Dateien in den Build, geladen wird erst, wenn pdf.js sie anfragt
const FONTS = import.meta.glob<string>('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url&no-inline', import: 'default', eager: true });
const CMAPS = import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url&no-inline', import: 'default', eager: true });
const WASM = import.meta.glob<string>('/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm', { query: '?url&no-inline', import: 'default', eager: true });
const DIRS: Record<string, Record<string, string>> = { standardFontDataUrl: FONTS, cMapUrl: CMAPS, wasmUrl: WASM };

async function fetchBytes(url: string): Promise<Uint8Array> {
  // falls Vite doch einbettet (data:-URL): nicht per fetch holen (CSP connect-src)
  if (url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** pdf.js-Schnittstelle: `fetch({ kind, filename })` → Bytes. */
export class BuildFiles {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const dir = DIRS[kind];
    const load = dir && Object.entries(dir).find(([k]) => k.endsWith(`/${filename}`))?.[1];
    if (!load) throw new Error(`pdf.js-Datei fehlt: ${filename}`);
    return fetchBytes(load);
  }
}
