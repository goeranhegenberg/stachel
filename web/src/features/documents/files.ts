// PDF aufs Board: Original hochladen, Seiten im Browser rendern und als Bilder über die Bild-Pipeline hochladen.
// Die erste Seite kommt sofort, die übrigen im Hintergrund (eine nach der anderen). Fehlt eine Seite noch (Hochladende:r
// hat das Board verlassen, großes PDF), rendert sie jeder Client nach, der sie braucht (`ensurePage`).
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { CSRF_HEADER } from '../../protocol';
import { ApiError, errorText } from '../../api';
import type { EditorApi } from '../../editor/ext/types';
import type { Point, Rect } from '../../board/geometry';
import { DOC_TYPE, MAX_PAGES, MAX_PDF_BYTES } from './model';
import { cleanName, docSize, isPdfFile, missingPages, pageCount, pageImage } from './pages';
import { openPdf, pageRatios, renderPage } from './pdf';
import { fillPage } from './yjs';
import { setUploads } from './uploads';

// ---- Original-PDF: Server bzw. lokal (Offline-Modus) ------------------------------------------------------------------

const localFiles = new Map<string, { blob: Blob; url: string }>();
let localSeq = 0;

/** Adresse der Original-PDF (`download`: als Anhang mit Dateinamen). */
export function fileUrl(id: string, download?: string): string {
  if (id.startsWith('local-')) return localFiles.get(id)?.url ?? '';
  const base = `/api/files/${encodeURIComponent(id)}`;
  return download ? `${base}?download=1&name=${encodeURIComponent(download)}` : base;
}

function boardIdFromUrl(): string | null {
  const q = new URLSearchParams(location.search);
  return q.get('b');
}

async function uploadOriginal(api: EditorApi, file: File): Promise<string> {
  if (api.session.isLocal) {
    const id = `local-${++localSeq}-${Date.now().toString(36)}`;
    localFiles.set(id, { blob: file, url: URL.createObjectURL(file) });
    return id;
  }
  const board = boardIdFromUrl();
  if (!board) throw new Error('Kein Board geöffnet.');
  const fd = new FormData();
  fd.append('file', file, file.name);
  let res: Response;
  try {
    res = await fetch(`/api/boards/${encodeURIComponent(board)}/files`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { [CSRF_HEADER]: '1' } });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string; file?: { id: string } } | null;
  if (!res.ok || !data?.ok || !data.file) {
    if (data?.error === 'unsupported_type') throw new Error('Das ist keine gültige PDF-Datei.');
    throw new ApiError(data?.error ?? (res.status === 413 ? 'too_large' : 'server'), res.status, data?.message);
  }
  return data.file.id;
}

/** Bytes der Original-PDF (für Seiten, die noch fehlen). */
async function fetchOriginal(id: string): Promise<ArrayBuffer> {
  const local = localFiles.get(id);
  if (local) return local.blob.arrayBuffer();
  const r = await fetch(fileUrl(id), { credentials: 'same-origin' });
  if (!r.ok) throw new Error(r.status === 404 ? 'Die PDF-Datei gibt es nicht mehr.' : 'Die PDF konnte nicht geladen werden.');
  return r.arrayBuffer();
}

// ---- geöffnete PDFs (eine Zeit lang behalten, dann freigeben) ---------------------------------------------------------

const open = new Map<string, { pdf: Promise<PDFDocumentProxy>; timer: ReturnType<typeof setTimeout> | null; users: number }>();
const KEEP_MS = 60_000;

async function withPdf<T>(fileId: string, fn: (pdf: PDFDocumentProxy) => Promise<T>, preset?: PDFDocumentProxy): Promise<T> {
  let e = open.get(fileId);
  if (!e) {
    const pdf = preset ? Promise.resolve(preset) : fetchOriginal(fileId).then(openPdf);
    e = { pdf, timer: null, users: 0 };
    open.set(fileId, e);
    pdf.catch(() => open.delete(fileId));
  }
  const entry = e;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.users++;
  try {
    return await fn(await entry.pdf);
  } finally {
    entry.users--;
    if (!entry.users) {
      entry.timer = setTimeout(() => {
        if (open.get(fileId) !== entry || entry.users) return;
        open.delete(fileId);
        void entry.pdf.then((p) => p.loadingTask.destroy()).catch(() => {});
      }, KEEP_MS);
    }
  }
}

// ---- Seiten nachladen ---------------------------------------------------------------------------------------------------

const inflight = new Map<string, Promise<string | undefined>>();

async function renderAndUpload(api: EditorApi, pdf: PDFDocumentProxy, page: number, name: string): Promise<string> {
  const { blob } = await renderPage(pdf, page);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const base = name.replace(/\.pdf$/i, '');
  const img = await api.session.uploadImage(new File([blob], `${base}-seite-${page + 1}.${ext}`, { type: blob.type }));
  return img.imageId;
}

/** Bild der Seite `page` von Dokument `id` sicherstellen (rendern + hochladen, wenn es fehlt). */
export function ensurePage(api: EditorApi, id: string, page: number): Promise<string | undefined> {
  const o = api.store.get(id);
  if (!o || o.type !== DOC_TYPE || !o.docFile) return Promise.resolve(undefined);
  const have = pageImage(o, page);
  if (have) return Promise.resolve(have);
  const key = `${id}:${page}`;
  let p = inflight.get(key);
  if (!p) {
    const fileId = o.docFile;
    const name = o.docName ?? 'Dokument.pdf';
    p = withPdf(fileId, async (pdf) => {
      // in der Zwischenzeit eingetragen (anderer Client)?
      const now = api.store.get(id);
      if (!now) return undefined;
      const already = pageImage(now, page);
      if (already) return already;
      const imageId = await renderAndUpload(api, pdf, page, name);
      return api.store.get(id) ? fillPage(api.store, id, page, imageId) : undefined;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Fehlende Seiten eines Dokuments nacheinander erzeugen (aktuelle zuerst); hört auf, wenn das Objekt verschwindet. */
export async function fillMissing(api: EditorApi, id: string, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  let total = 0;
  let done = 0;
  for (;;) {
    const o = api.store.get(id);
    if (!o) return false;
    const missing = missingPages(o);
    total = Math.max(total, done + missing.length);
    onProgress?.(done, total);
    if (!missing.length) return true;
    // die aktuelle Seite zuerst (jemand blättert gerade dorthin)
    if (!(await ensurePage(api, id, missing[0]))) return false;
    done++;
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ---- Hochladen ----------------------------------------------------------------------------------------------------------

let uploadSeq = 0;

/** PDFs einfügen (Dateiauswahl, Ablegen, Einfügen). */
export async function addPdfs(files: File[], api: EditorApi, at?: Point | null) {
  const c = at ?? api.pointerWorld() ?? api.viewCenter();
  const ids: string[] = [];
  let offset = 0;
  for (const f of files) {
    const name = cleanName(f.name || 'Dokument.pdf');
    if (f.size > MAX_PDF_BYTES) {
      api.toast(`„${name}“ ist größer als 15 MB.`);
      continue;
    }
    const key = `pdf-${++uploadSeq}`;
    const ph = docSize(595 / 842);
    const rect: Rect = { x: Math.round(c.x - ph.w / 2 + offset), y: Math.round(c.y - ph.h / 2 + offset), ...ph };
    setUploads((u) => [...u, { key, rect, name }]);
    try {
      // erst öffnen (prüft Passwort/Format im Browser), dann das Original hochladen
      const pdf = await openPdf(await f.arrayBuffer());
      const fileId = await uploadOriginal(api, f).catch(async (e) => {
        await pdf.loadingTask.destroy();
        throw e;
      });
      const id = await withPdf(
        fileId,
        async (doc) => {
          const n = Math.min(doc.numPages, MAX_PAGES);
          if (doc.numPages > MAX_PAGES) api.toast(`„${name}“ hat ${doc.numPages} Seiten – übernommen werden die ersten ${MAX_PAGES}.`);
          const ratios = await pageRatios(doc, n);
          const size = docSize(ratios[0] ?? 595 / 842);
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, rect: { ...x.rect, ...size, x: Math.round(c.x - size.w / 2 + offset), y: Math.round(c.y - size.h / 2 + offset) } } : x)));
          const first = await renderAndUpload(api, doc, 0, name);
          api.store.stopCapturing();
          const oid = api.store.create({
            type: DOC_TYPE,
            x: Math.round(c.x - size.w / 2 + offset),
            y: Math.round(c.y - size.h / 2 + offset),
            ...size,
            docFile: fileId,
            docName: name,
            docCount: n,
            docPage: 0,
            docPages: { '0': first },
            docRatios: ratios,
            imageId: first,
          });
          api.store.stopCapturing();
          return oid;
        },
        pdf,
      );
      ids.push(id);
      offset += 32;
      // übrige Seiten im Hintergrund
      if (pageCount(api.store.get(id) ?? {}) > 1) void fillMissing(api, id).catch(() => {});
    } catch (e) {
      api.toast(e instanceof ApiError ? errorText(e) : (e as Error)?.message || 'Die PDF konnte nicht hochgeladen werden.');
    } finally {
      setUploads((u) => u.filter((x) => x.key !== key));
    }
  }
  if (ids.length) api.setSelection(ids);
}

export const pdfHandler = { match: isPdfFile, add: addPdfs };
