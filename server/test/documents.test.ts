// PDF-Dokumente (documents.ts): Original hochladen, prüfen, abrufen; Löschen/Duplizieren nehmen PDF und Seiten mit.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { safePdfName, sniffPdf } from '../src/documents.js';
import { Browser, loginAdmin, startEnv, waitFor, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

/** Kleinste gültige PDF mit einer leeren Seite. */
function makePdf(extra = ''): Buffer {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>'];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n${extra}`;
  return Buffer.from(out, 'latin1');
}

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function uploadFile(b: Browser, boardId: string, data: Buffer, name = 'plan.pdf', type = 'application/pdf') {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)], { type }), name);
  return b.req('POST', `/api/boards/${boardId}/files`, { body: fd });
}
async function uploadImage(b: Browser, boardId: string, data: Buffer) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'seite.png');
  return b.req('POST', `/api/boards/${boardId}/images`, { body: fd });
}

describe('sniffPdf / safePdfName', () => {
  it('erkennt PDFs nur am Inhalt', () => {
    expect(sniffPdf(makePdf())).toBe(true);
    expect(sniffPdf(Buffer.from('%PDF-1.7\nkein Ende'))).toBe(false); // abgeschnitten
    expect(sniffPdf(Buffer.from('<html>%PDF-1.4 %%EOF</html>'))).toBe(false);
    expect(sniffPdf(PNG_1x1)).toBe(false);
    expect(sniffPdf(Buffer.from(''))).toBe(false);
  });
  it('macht Dateinamen sicher', () => {
    expect(safePdfName('Lageplan 2026.pdf')).toBe('Lageplan 2026.pdf');
    expect(safePdfName('../../etc/passwd')).toBe('passwd.pdf');
    expect(safePdfName('a"b\r\nc.PDF')).toBe('abc.PDF');
    expect(safePdfName(undefined)).toBe('dokument.pdf');
    expect(safePdfName(`${'x'.repeat(300)}.pdf`)).toHaveLength(120);
  });
});

describe('PDF hochladen', () => {
  it('nimmt eine PDF an und liefert sie nur mit Sitzung aus', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'PDF' })).body.board;
    const pdf = makePdf();
    const r = await uploadFile(b, board.id, pdf);
    expect(r.status).toBe(201);
    expect(r.body.file.url).toBe(`/api/files/${r.body.file.id}`);
    expect(r.body.file.bytes).toBe(pdf.length);

    const got = await b.get(r.body.file.url);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/pdf');
    expect(got.headers.get('content-disposition')).toBe('inline');
    expect(got.headers.get('content-security-policy')).toContain('sandbox');
    expect(got.headers.get('cache-control')).toContain('private');

    const dl = await b.get(`${r.body.file.url}?download=1&name=${encodeURIComponent('Ablauf Übersicht.pdf')}`);
    expect(dl.headers.get('content-disposition')).toBe(`attachment; filename="Ablauf _bersicht.pdf"; filename*=UTF-8''Ablauf%20%C3%9Cbersicht.pdf`);

    // ohne Sitzung: weder hochladen noch abrufen
    const anon = new Browser(env.base);
    expect((await anon.get(r.body.file.url)).status).toBe(401);
    expect((await uploadFile(anon, board.id, pdf)).status).toBe(401);
    // ohne CSRF-Kopf
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'a.pdf');
    expect((await b.req('POST', `/api/boards/${board.id}/files`, { body: fd, csrf: false })).status).toBe(403);
  });

  it('lehnt gefälschte, zu große und falsche Uploads ab', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'PDF falsch' })).body.board;
    // Bild mit PDF-Namen und -Typ
    const fake = await uploadFile(b, board.id, PNG_1x1, 'plan.pdf', 'application/pdf');
    expect(fake.status).toBe(415);
    expect(fake.body.error).toBe('unsupported_type');
    // HTML, das sich als PDF ausgibt
    expect((await uploadFile(b, board.id, Buffer.from('<script>alert(1)</script>%PDF-1.4 %%EOF'))).status).toBe(415);
    // abgeschnittene PDF
    expect((await uploadFile(b, board.id, makePdf().subarray(0, 120))).status).toBe(415);
    // zu groß (über 15 MB)
    const big = await uploadFile(b, board.id, makePdf(' '.repeat(15 * 1024 * 1024)));
    expect(big.status).toBe(413);
    expect(big.body.error).toBe('too_large');
    // unbekanntes Board, kein Multipart
    expect((await uploadFile(b, 'gibtsnicht', makePdf())).status).toBe(404);
    expect((await b.post(`/api/boards/${board.id}/files`, { file: 'x' })).status).toBe(400);
    // nichts davon gespeichert
    const rows = env.srv.db.prepare('SELECT COUNT(*) AS n FROM images WHERE board_id = ?').get(board.id) as { n: number };
    expect(rows.n).toBe(0);
  });

  it('liefert unter /api/files nur PDFs (keine Bilder) und 404 für Unbekanntes', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'PDF und Bild' })).body.board;
    const img = (await uploadImage(b, board.id, PNG_1x1)).body.image;
    expect((await b.get(`/api/files/${img.id}`)).status).toBe(404);
    expect((await b.get('/api/files/gibtsnicht')).status).toBe(404);
    expect((await b.get('/api/files/..%2F..%2Fstachel.sqlite')).status).toBe(404);
  });
});

describe('PDF im Board-Lebenszyklus', () => {
  /** Dokument-Objekt mit Original, Seiten (Y.Map) und aktueller Seite als imageId */
  function docObj(id: string, file: string, pages: string[]): Y.Map<unknown> {
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ id, type: 'document', x: 0, y: 0, w: 100, h: 140, z: 'a0', docFile: file, docCount: pages.length, imageId: pages[0] })) m.set(k, v);
    const p = new Y.Map<string>();
    pages.forEach((pid, i) => p.set(String(i), pid));
    m.set('docPages', p);
    return m;
  }

  it('Duplizieren kopiert PDF und Seiten mit neuen IDs; Löschen des Originals lässt die Kopie heil', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'Mit PDF' })).body.board;
    const file = (await uploadFile(b, board.id, makePdf())).body.file;
    const p1 = (await uploadImage(b, board.id, PNG_1x1)).body.image;
    const p2 = (await uploadImage(b, board.id, PNG_1x1)).body.image;
    const conn = await env.srv.hocuspocus.openDirectConnection(`board:${board.id}`, { user: { key: 'a:test', name: 'Test', isOrga: true } });
    await conn.transact((doc) => doc.getMap('objects').set('d1', docObj('d1', file.id, [p1.id, p2.id])));
    await conn.disconnect();

    const copy = (await b.post(`/api/boards/${board.id}/duplicate`, {})).body.board;
    const row = env.srv.db.prepare('SELECT state FROM documents WHERE name = ?').get(`board:${copy.id}`) as { state: Uint8Array };
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(row.state));
    const m = doc.getMap<Y.Map<unknown>>('objects').get('d1')!;
    const pages = (m.get('docPages') as Y.Map<string>).toJSON();
    expect(m.get('docFile')).not.toBe(file.id);
    expect(pages['0']).not.toBe(p1.id);
    expect(pages['1']).not.toBe(p2.id);
    expect(m.get('imageId')).toBe(pages['0']);
    expect((await b.get(`/api/files/${m.get('docFile')}`)).status).toBe(200);
    expect((await b.get(`/api/images/${pages['1']}`)).status).toBe(200);
    doc.destroy();
  });

  it('Einfügen auf einem anderen Board kopiert Original und Seiten fürs Ziel-Board (UPL-1)', async () => {
    const b = await loginAdmin(env);
    const src = (await b.post('/api/boards', { title: 'Quelle PDF' })).body.board;
    const dst = (await b.post('/api/boards', { title: 'Ziel PDF' })).body.board;
    const file = (await uploadFile(b, src.id, makePdf())).body.file;
    const p1 = (await uploadImage(b, src.id, PNG_1x1)).body.image;
    const p2 = (await uploadImage(b, src.id, PNG_1x1)).body.image;
    const conn = await env.srv.hocuspocus.openDirectConnection(`board:${dst.id}`, { user: { key: 'a:test', name: 'Test', isOrga: true } });
    await conn.transact((d) => d.getMap('objects').set('d1', docObj('d1', file.id, [p1.id, p2.id])));
    const live = env.srv.hocuspocus.documents.get(`board:${dst.id}`)!;
    const m = () => live.getMap<Y.Map<unknown>>('objects').get('d1')!;
    await waitFor(() => m().get('docFile') !== file.id);
    const pages = (m().get('docPages') as Y.Map<string>).toJSON();
    const boardOf = (id: unknown) => (env.srv.db.prepare('SELECT board_id FROM images WHERE id = ?').get(String(id)) as { board_id: string } | undefined)?.board_id;
    expect([boardOf(m().get('docFile')), boardOf(pages['0']), boardOf(pages['1']), boardOf(m().get('imageId'))]).toEqual([dst.id, dst.id, dst.id, dst.id]);
    expect(m().get('imageId')).toBe(pages['0']);
    expect((await b.get(`/api/files/${m().get('docFile')}`)).status).toBe(200);
    await conn.disconnect();
    expect(boardOf(file.id)).toBe(src.id);
  });
});
