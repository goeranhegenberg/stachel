// PDF-Dokumente auf dem Board (docs/contract.md §3, docs/features/documents.md).
// Die Original-PDF liegt wie ein Bild in `images` (mime `application/pdf`, Breite/Höhe 0) unter `data/images/`: so
// gelten Board löschen, Duplizieren und „von einem anderen Board noch genutzt“ ohne Sonderweg auch für PDFs. Die Seiten
// rendert der Browser (pdf.js) und lädt sie als normale Bilder hoch (`POST /api/boards/:id/images`).
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MAX_IMAGE_BYTES } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import { IMAGE_CSP, sendError } from './http-util.js';
import { randomToken } from './sessions.js';
import type { UploadLimits } from './upload-limits.js';

export const PDF_MIME = 'application/pdf';
/** wie bei Bildern (nginx nimmt höchstens 16 MB je Anfrage an, Multipart braucht etwas Rand) */
export const MAX_PDF_BYTES = MAX_IMAGE_BYTES;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Ist das eine PDF? Kopf `%PDF-<Ziffer>.` ganz am Anfang (Magic Bytes) und eine Ende-Marke `%%EOF` (fehlt bei
 * abgeschnittenen Uploads). Dateiendung und angegebener Typ zählen nicht.
 */
export function sniffPdf(b: Buffer): boolean {
  if (b.length < 16) return false;
  if (!/^%PDF-[12]\.\d/.test(b.toString('latin1', 0, 8))) return false;
  return b.lastIndexOf('%%EOF', undefined, 'latin1') > 8;
}

/** Dateiname für Content-Disposition: ohne Pfad und Steuerzeichen, mit .pdf, höchstens 120 Zeichen. */
export function safePdfName(name: unknown): string {
  let s = typeof name === 'string' ? name : '';
  s = s.split(/[\\/]/).pop() ?? '';
  s = s.replace(/[\u0000-\u001f\u007f"]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) s = 'dokument.pdf';
  if (!/\.pdf$/i.test(s)) s = `${s.slice(0, 116)}.pdf`;
  return s.length > 120 ? `${s.slice(0, 116)}.pdf` : s;
}

interface Deps {
  db: Db;
  imagesDir: string;
  boardExists: (id: string) => boolean;
  /** Größe je Upload und Text dazu (upload-limits.ts); fehlt = MAX_PDF_BYTES */
  uploads?: Pick<UploadLimits, 'limits' | 'tooLargeText'>;
}

/** Routen (im Bereich mit Sitzungspflicht registrieren). */
export function registerDocuments(scope: FastifyInstance, { db, imagesDir, boardExists, uploads }: Deps) {
  const maxBytes = uploads?.limits.uploadMaxBytes ?? MAX_PDF_BYTES;
  const tooLarge = uploads?.tooLargeText('pdf') ?? 'Die PDF ist zu groß (höchstens 15 MB).';
  scope.post<{ Params: { id: string } }>('/api/boards/:id/files', async (req, reply) => {
    if (!boardExists(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    if (!req.isMultipart()) return sendError(reply, 400, 'invalid_input', 'Bitte eine PDF-Datei hochladen.');
    const part = await req.file();
    if (!part || part.fieldname !== 'file') return sendError(reply, 400, 'invalid_input', 'Bitte eine PDF-Datei hochladen.');
    let buf: Buffer;
    try {
      buf = await part.toBuffer();
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return sendError(reply, 413, 'too_large', tooLarge);
      }
      throw e;
    }
    if (buf.length > maxBytes) return sendError(reply, 413, 'too_large', tooLarge);
    if (!sniffPdf(buf)) return sendError(reply, 415, 'unsupported_type', 'Das ist keine gültige PDF-Datei.');
    const id = randomToken(16);
    const file = path.join(imagesDir, id);
    await fs.promises.writeFile(`${file}.tmp`, buf);
    await fs.promises.rename(`${file}.tmp`, file);
    db.prepare(
      'INSERT INTO images (id, board_id, mime, width, height, bytes, created_by, created_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)',
    ).run(id, req.params.id, PDF_MIME, buf.length, req.session!.userKey, nowIso());
    return reply.code(201).send({ ok: true, file: { id, url: `/api/files/${id}`, bytes: buf.length } });
  });

  // Original-PDF: `?download=1` als Anhang (mit `name` als Dateiname), sonst zum Lesen (pdf.js holt sie per fetch)
  scope.get<{ Params: { id: string }; Querystring: { download?: string; name?: string } }>('/api/files/:id', async (req, reply) => {
    const id = req.params.id;
    const row = ID_RE.test(id) ? (db.prepare('SELECT mime FROM images WHERE id = ?').get(id) as { mime: string } | undefined) : undefined;
    const file = path.join(imagesDir, id);
    if (!row || row.mime !== PDF_MIME || !fs.existsSync(file)) return sendError(reply, 404, 'not_found', 'Datei nicht gefunden.');
    const name = safePdfName(req.query.name);
    const disposition =
      req.query.download === '1'
        ? `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`
        : 'inline';
    return reply
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Content-Disposition', disposition)
      .header('Content-Security-Policy', IMAGE_CSP)
      .type(PDF_MIME)
      .send(fs.createReadStream(file));
  });
}
