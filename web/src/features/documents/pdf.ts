// pdf.js (pdfjs-dist) – erst beim ersten PDF nachgeladen (eigenes Paket, docs/architecture.md §6). Der Worker kommt als
// eigene Datei aus dem Build (`?url`, CSP worker-src 'self'). Schriften, CMaps und WebAssembly-Dekoder liefert
// pdfAssets.ts (BinaryDataFactory über die Build-Dateien).
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderScale } from './pages';

type PdfJs = typeof import('pdfjs-dist');
type Lib = { pdfjs: PdfJs; BuildFiles: typeof import('./pdfAssets').BuildFiles };

let lib: Promise<Lib> | null = null;

/** pdf.js samt Worker-Adresse und Hilfsdateien laden (einmal). */
function loadPdfJs(): Promise<Lib> {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'), import('./pdfAssets')])
    .then(([pdfjs, worker, assets]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return { pdfjs, BuildFiles: assets.BuildFiles };
    })
    .catch((e) => {
      lib = null;
      throw e;
    });
  return lib;
}

export class PdfError extends Error {
  constructor(
    readonly code: 'password' | 'invalid' | 'browser',
    message: string,
  ) {
    super(message);
  }
}

/** PDF öffnen; Fehler mit deutschem Text (Passwort, kaputt, Browser zu alt). */
export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  let pdfjs: PdfJs;
  let BuildFiles: Lib['BuildFiles'];
  try {
    ({ pdfjs, BuildFiles } = await loadPdfJs());
  } catch {
    throw new PdfError('browser', 'PDF-Anzeige konnte nicht geladen werden. Bitte die Seite neu laden oder den Browser aktualisieren.');
  }
  try {
    return await pdfjs.getDocument({
      // pdf.js übernimmt den Puffer in den Worker: Kopie, damit der Aufrufer seine Bytes behält
      data: new Uint8Array(data).slice(),
      useWorkerFetch: false,
      BinaryDataFactory: BuildFiles,
      cMapPacked: true,
      // Platzhalter, damit pdf.js die Dateien über BuildFiles anfragt (Name wird angehängt)
      cMapUrl: 'pdfjs/cmaps/',
      standardFontDataUrl: 'pdfjs/fonts/',
      wasmUrl: 'pdfjs/wasm/',
      enableXfa: false,
      verbosity: 0,
    }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new PdfError('password', 'Die PDF ist mit einem Passwort geschützt. Bitte ohne Passwort speichern und erneut hochladen.');
    throw new PdfError('invalid', 'Die Datei ist keine lesbare PDF.');
  }
}

/** Seitenverhältnisse (Breite/Höhe) der ersten `n` Seiten. */
export async function pageRatios(pdf: PDFDocumentProxy, n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    out.push(Math.round((vp.width / vp.height) * 1000) / 1000);
  }
  return out;
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));

/** Seite `i` (0-basiert) als Bild: WebP, wo der Browser es schreiben kann (Safari: JPEG). */
export async function renderPage(pdf: PDFDocumentProxy, i: number): Promise<{ blob: Blob; width: number; height: number }> {
  const page = await pdf.getPage(i + 1);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: renderScale(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    let blob = await toBlob(canvas, 'image/webp', 0.85);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.88);
    const { width, height } = canvas;
    canvas.width = canvas.height = 0; // Grafikspeicher sofort frei (iOS)
    if (!blob) throw new Error('Seite ließ sich nicht als Bild speichern.');
    return { blob, width, height };
  } finally {
    page.cleanup();
  }
}
