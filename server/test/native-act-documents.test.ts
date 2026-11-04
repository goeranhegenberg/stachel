// Web-Aktionen `documents.*` (Paket P7, docs/contract.md §8.12): PDF-Dokumente aus der App blättern, nachgeladene
// Seiten eintragen, „Alle Seiten aufs Board“ – Ergebnis wie die Web-Funktionen (yjs.ts, pages.ts) auf einem
// Browser-Store; Blättern und Nachtragen ohne Rückgängig-Schritt, „Alle Seiten“ ein Schritt. Dazu: die App-Sitzung
// (Bearer) darf Original-PDFs hochladen und abrufen.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { nativeAction, nativeActionList } from '../../web/src/native/registry';
import { expandLayout } from '../../web/src/features/documents/pages';
import { fillPage, setPage } from '../../web/src/features/documents/yjs';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient, type Msg } from './native-client.js';

const ctx = { user: { key: 'a:t', name: 'T' }, now: new Date().toISOString(), v: 1, id: (n: number) => `k-${n}`, exists: () => false, measure: () => 0 };
const run = (name: string, store: BoardStore, raw: Record<string, unknown>) => {
  const def = nativeAction(name)!;
  const p = def.args(raw, 1);
  if (!p.ok) throw new Error(p.error);
  return def.run(store, p.args, ctx);
};
const DOC = { id: 'd', type: 'document', x: 100, y: 50, w: 400, h: 566, docFile: 'f1', docName: 'Plan.pdf', docCount: 3, docPage: 0, docPages: { '0': 'p0' }, docRatios: [0.707, 1.414, 0.707], imageId: 'p0' };
const stores = (objs: object[] = [DOC]) => {
  const app = new BoardStore(new Y.Doc(), 'a:app');
  const web = new BoardStore(new Y.Doc(), 'a:web');
  app.createMany(objs as NewObject[]);
  web.createMany(objs as NewObject[]);
  app.stopCapturing();
  web.stopCapturing();
  return { app, web };
};
const pick = (s: BoardStore, id = 'd') => {
  const o = s.get(id)!;
  return { docPage: o.docPage, imageId: o.imageId, docPages: o.docPages };
};

describe('documents.* direkt', () => {
  it('sind angemeldet und prüfen die Argumente', () => {
    const list = nativeActionList();
    for (const n of ['documents.page', 'documents.addPage', 'documents.repair', 'documents.expand']) expect(list[n], n).toBe(1);
    expect(nativeAction('documents.page')!.undo).toBe('none');
    expect(nativeAction('documents.addPage')!.undo).toBe('none');
    expect(nativeAction('documents.repair')!.undo).toBe('none');
    expect(nativeAction('documents.expand')!.undo).toBe('undo');
    const bad: [string, Record<string, unknown>][] = [
      ['documents.page', { id: 'd' }],
      ['documents.page', { id: 'd', page: -1 }],
      ['documents.page', { id: 'd', page: 1.5 }],
      ['documents.addPage', { id: 'd', page: 1 }],
      ['documents.addPage', { id: 'd', page: 300, imageId: 'x' }],
      ['documents.addPage', { id: 'd', page: 1, imageId: 'a b' }],
      ['documents.expand', { id: 'd', page: 0 }],
    ];
    for (const [n, raw] of bad) expect(nativeAction(n)!.args(raw, 1).ok, `${n} ${JSON.stringify(raw)}`).toBe(false);
  });

  it('documents.page = setPage des Web (begrenzt, Spiegel, fehlende Seite ohne imageId), kein Undo-Schritt', () => {
    const { app, web } = stores();
    for (const p of [1, 2, 99, 0]) {
      const r = run('documents.page', app, { id: 'd', page: p });
      setPage(web, 'd', p);
      expect(pick(app), `Seite ${p}`).toEqual(pick(web));
      expect(r).toEqual({ data: { page: Math.min(p, 2), imageId: p === 0 ? 'p0' : null } });
    }
    expect(app.undoManager.undoStack).toHaveLength(1); // nur das Anlegen
    expect(run('documents.page', app, { id: 'fehlt', page: 1 })).toEqual({ skipped: true });
  });

  it('documents.addPage = fillPage (wer zuerst kommt), aktuelle Seite setzt imageId; fehlende Seiten in data', () => {
    const { app, web } = stores();
    run('documents.page', app, { id: 'd', page: 1 });
    setPage(web, 'd', 1);
    expect(run('documents.addPage', app, { id: 'd', page: 1, imageId: 'neu1' })).toEqual({ data: { imageId: 'neu1', missing: [2] } });
    fillPage(web, 'd', 1, 'neu1');
    expect(pick(app)).toEqual(pick(web));
    expect(pick(app)).toMatchObject({ imageId: 'neu1', docPages: { '0': 'p0', '1': 'neu1' } });
    // später kommt ein anderer Client mit derselben Seite: das erste Bild bleibt
    expect(run('documents.addPage', app, { id: 'd', page: 1, imageId: 'spaet' })).toEqual({ data: { imageId: 'neu1', missing: [2] } });
    expect(run('documents.addPage', app, { id: 'd', page: 2, imageId: 'p2' })).toEqual({ data: { imageId: 'p2', missing: [] } });
    expect(app.get('d')!.imageId).toBe('neu1');
    expect(run('documents.addPage', app, { id: 'd', page: 7, imageId: 'x' })).toEqual({ skipped: true });
    expect(app.undoManager.undoStack).toHaveLength(1);
  });

  it('documents.repair stellt den Spiegel richtig', () => {
    const { app } = stores();
    app.doc.transact(() => {
      const m = app.objects.get('d')!;
      (m.get('docPages') as Y.Map<string>).set('1', 'p1');
      m.set('docPage', 1);
      m.delete('imageId');
    }, 'documents');
    expect(run('documents.repair', app, { id: 'd' })).toEqual({ data: { page: 1, imageId: 'p1' } });
    expect(app.get('d')!.imageId).toBe('p1');
    expect(run('documents.repair', app, { id: 'd' })).toEqual({ skipped: true });
  });

  it('documents.expand: erst alle Seiten, dann Raster wie expandLayout, gewählt, Kamera, Hinweis', () => {
    const { app } = stores();
    expect(run('documents.expand', app, { id: 'd' })).toEqual({ skipped: true, data: { missing: [1, 2] } });
    expect(app.getSnapshot().ordered).toHaveLength(1);
    run('documents.addPage', app, { id: 'd', page: 1, imageId: 'p1' });
    run('documents.addPage', app, { id: 'd', page: 2, imageId: 'p2' });
    const r = run('documents.expand', app, { id: 'd' }) as { select: string[]; focus: { x: number; y: number; w: number; h: number }; toast: string };
    const rects = expandLayout(app.get('d')!);
    expect(r.select).toEqual(['k-1', 'k-2', 'k-3']);
    expect(r.toast).toBe('3 Seiten liegen als Bilder auf dem Board.');
    r.select.forEach((id, i) => expect(app.get(id)).toMatchObject({ type: 'image', ...rects[i], imageId: `p${i}`, color: '#ffffff' }));
    expect(r.focus).toEqual({ x: 100, y: 50, w: rects[2]!.x + rects[2]!.w - 100, h: Math.max(566, ...rects.map((x) => x.y + x.h - 50)) });
    // ein Rückgängig-Schritt nimmt alle Seiten wieder weg
    app.undo();
    expect(app.getSnapshot().ordered.map((o) => o.id)).toEqual(['d']);
    // gesperrt: nichts
    app.update('d', { locked: true });
    expect(run('documents.expand', app, { id: 'd' })).toEqual({ skipped: true });
  });

  it('eine Seite: Hinweis in der Einzahl', () => {
    const { app } = stores([{ ...DOC, docCount: 1, docRatios: [0.707] }]);
    expect((run('documents.expand', app, { id: 'd' }) as { toast: string }).toast).toBe('Seite liegt als Bild auf dem Board.');
  });
});

/** Kleinste gültige PDF mit einer leeren Seite (wie documents.test.ts). */
function makePdf(): Buffer {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>'];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('documents.* über die Native-API', () => {
  let env: TestEnv;
  const cleanup: (() => void)[] = [];
  beforeAll(async () => {
    env = await startEnv({ nativeIdleMs: 300 });
  });
  afterAll(async () => env?.stop());
  afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
  });

  it('App lädt PDF und Seite hoch (Bearer), legt das Dokument an, blättert ohne Undo, „Alle Seiten“ mit Undo; Web sieht alles', async () => {
    const kt = env.fake.addMember(4713, 'Mara');
    const browser = await loginMember(env, kt);
    const mara = await appSession(env.base, kt);
    const board = (await browser.post('/api/boards', { title: 'PDF' })).body.board as { id: string };
    const auth = { Authorization: `Bearer ${mara.token}`, 'X-Stachel': '1' };

    // Original-PDF und Seitenbild wie die App (Multipart, Bearer)
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(makePdf())], { type: 'application/pdf' }), 'Plan.pdf');
    const up = await fetch(`${env.base}/api/boards/${board.id}/files`, { method: 'POST', headers: auth, body: fd });
    expect(up.status).toBe(201);
    const fileId = ((await up.json()) as { file: { id: string } }).file.id;
    const got = await fetch(`${env.base}/api/files/${fileId}`, { headers: { Authorization: `Bearer ${mara.token}` } });
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(makePdf())).toBe(true);
    const dl = await fetch(`${env.base}/api/files/${fileId}?download=1&name=${encodeURIComponent('Lageplan 2027.pdf')}`, { headers: { Authorization: `Bearer ${mara.token}` } });
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    const images: string[] = [];
    for (let i = 0; i < 2; i++) {
      const f = new FormData();
      f.append('file', new Blob([new Uint8Array(PNG_1x1)], { type: 'image/png' }), `Plan-seite-${i + 1}.png`);
      const r = await fetch(`${env.base}/api/boards/${board.id}/images`, { method: 'POST', headers: auth, body: f });
      expect(r.status).toBe(201);
      images.push(((await r.json()) as { image: { id: string } }).image.id);
    }

    const ws = env.base.replace('http', 'ws');
    const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
    cleanup.push(() => w.destroy());
    await w.synced();
    const a = new NativeClient(ws, mara.token);
    cleanup.push(() => a.close());
    const welcome = await a.hello(board.id);
    for (const n of ['documents.page', 'documents.addPage', 'documents.repair', 'documents.expand']) expect(welcome.actions[n]).toBe(1);
    let req = 10;
    const send = async (ops: Record<string, unknown>[]): Promise<Msg> => {
      const r = ++req;
      const from = a.messages.length;
      a.send({ t: 'ops', req: r, ops });
      return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === r, 5000, from);
    };
    const webDoc = () => (w.objects.get('d') as Y.Map<unknown> | undefined)?.toJSON() as Record<string, any> | undefined;

    // anlegen wie die App (create mit docPages als Objekt → Y.Map im Web)
    const created = await send([
      { op: 'create', objects: [{ id: 'd', type: 'document', x: 0, y: 0, w: 453, h: 640, docFile: fileId, docName: 'Plan.pdf', docCount: 2, docPage: 0, docPages: { '0': images[0] }, docRatios: [0.707, 0.707], imageId: images[0] }] },
    ]);
    expect(created.t).toBe('ack');
    a.send({ t: 'step' });
    await waitFor(() => webDoc()?.docName === 'Plan.pdf');
    expect((w.objects.get('d') as Y.Map<unknown>).get('docPages')).toBeInstanceOf(Y.Map);

    // blättern: fehlende Seite → imageId fällt weg, die App trägt sie nach
    const paged = await send([{ op: 'act', name: 'documents.page', args: { id: 'd', page: 1 } }]);
    expect(paged.results['0'].data).toEqual({ page: 1, imageId: null });
    await waitFor(() => webDoc()?.docPage === 1);
    expect(webDoc()?.imageId).toBeUndefined();
    const added = await send([{ op: 'act', name: 'documents.addPage', args: { id: 'd', page: 1, imageId: images[1] } }]);
    expect(added.results['0'].data).toEqual({ imageId: images[1], missing: [] });
    await waitFor(() => webDoc()?.imageId === images[1]);
    expect(webDoc()?.docPages).toEqual({ '0': images[0], '1': images[1] });

    // alle Seiten aufs Board: ein Schritt; Rückgängig nimmt nur die Seiten weg, nicht das Blättern
    const ex = await send([{ op: 'act', name: 'documents.expand', key: 'exp1', args: { id: 'd' } }]);
    expect(ex.results['0'].select).toEqual(['exp1-1', 'exp1-2']);
    expect(ex.results['0'].toast).toBe('2 Seiten liegen als Bilder auf dem Board.');
    await waitFor(() => w.objects.has('exp1-2'));
    expect((w.objects.get('exp1-1') as Y.Map<unknown>).toJSON()).toMatchObject({ type: 'image', imageId: images[0], color: '#ffffff' });
    a.send({ t: 'undo', req: ++req });
    await a.next((m) => m.t === 'ack' && m.req === req);
    await waitFor(() => !w.objects.has('exp1-1'));
    expect(webDoc()?.docPage).toBe(1);
    // nächstes Rückgängig: das Anlegen (Blättern/Nachtragen sind keine Schritte)
    a.send({ t: 'undo', req: ++req });
    await a.next((m) => m.t === 'ack' && m.req === req);
    await waitFor(() => !w.objects.has('d'));
  });
});
