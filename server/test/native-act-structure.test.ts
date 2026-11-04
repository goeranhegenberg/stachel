// Web-Aktionen des Moduls structure für die App (docs/contract.md §8.12, Paket P3): structure.template,
// structure.paste, structure.toCard, card.title, card.desc – und das Klartext-Zusammenführen (src/native/ytext-merge.ts).
// Ergebnis = dieselbe Web-Funktion (templates/*, paste-model.ts, card/model.ts) direkt auf einem Browser-Store; ein
// Rückgängig-Schritt je Aktion; feste IDs aus `key`; Prüfung der args.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WEB } from '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import type { BoardObject } from '../../web/src/protocol';
import { measureText } from '../../web/src/editor/measureText';
import { cardContentHeight, notesToCards } from '../../web/src/features/structure/card/model';
import { notesOf, pasteChoice, singleNote, tableObject } from '../../web/src/features/structure/paste-model';
import { previewBounds } from '../../web/src/features/structure/templates/bounds';
import { TEMPLATES } from '../../web/src/features/structure/templates/catalog';
import { insertAt, offsetTo, occupiedIn } from '../../web/src/features/structure/templates/insert';
import { cleanTemplateObjects } from '../../web/src/features/structure/templates/own';
import { freeSpot } from '../../web/src/features/structure/templates/place';
import { matrix, safeTable } from '../../web/src/features/structure/table/model';
import { applyText, mergeIntoYText, mergeText } from '../src/native/ytext-merge';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient, type Msg } from './native-client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv({ nativeIdleMs: 300 });
});
afterAll(async () => {
  await env?.stop();
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

let memberId = 3600;
async function setup() {
  const kt = env.fake.addMember(++memberId, 'Mara');
  const browser = await loginMember(env, kt);
  const mara = await appSession(env.base, kt);
  const board = (await browser.post('/api/boards', { title: 'Struktur' })).body.board as { id: string };
  const ws = env.base.replace('http', 'ws');
  const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
  cleanup.push(() => w.destroy());
  await w.synced();
  const a = new NativeClient(ws, mara.token);
  cleanup.push(() => a.close());
  const welcome = await a.hello(board.id);
  return { w, a, welcome, mara };
}

let reqNo = 100;
async function send(a: NativeClient, list: Record<string, unknown>[], req = ++reqNo): Promise<Msg> {
  const from = a.messages.length;
  a.send({ t: 'ops', req, ops: list });
  return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === req, 5000, from);
}
async function undo(a: NativeClient) {
  const from = a.messages.length;
  a.send({ t: 'undo', req: ++reqNo });
  return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === reqNo, 5000, from);
}

const json = (w: ReturnType<typeof webClient>, id: string) => w.objects.get(id)?.toJSON() as Record<string, any> | undefined;
const measure = (s: string, fs: number, weight: number) => measureText(s, fs, weight);
/** Lage/Größe/Typ/Text ohne IDs und Daten (Vorlagen bauen mit Zufalls-IDs und Datum relativ zu heute). */
const shape = (o: Record<string, any>, dx = 0, dy = 0) => ({ type: o.type, x: o.x - dx, y: o.y - dy, w: o.w, h: o.h, text: o.text ?? o.title ?? '' });

describe('Klartext zusammenführen (ytext-merge)', () => {
  it('verschiedene Stellen bleiben beide, gleichzeitig Eingefügtes auch (erst vorhanden, dann App), gleiche Stelle → App + conflict', () => {
    expect(mergeText('Hallo Welt', 'Hallo schöne Welt', 'Hallo Welt!')).toEqual({ text: 'Hallo schöne Welt!', conflict: false });
    expect(mergeText('ab', 'aXb', 'aYb')).toEqual({ text: 'aYXb', conflict: false });
    expect(mergeText('Bühne', 'Bühne A', 'Bühne A')).toEqual({ text: 'Bühne A', conflict: false });
    expect(mergeText('Strom', 'Wasser', 'Licht')).toEqual({ text: 'Wasser', conflict: true });
    expect(mergeText('a', 'a', 'b')).toEqual({ text: 'b', conflict: false });
    // Emoji werden nie halbiert
    expect(mergeText('🎉x', '🎉xy', '🎸🎉x')).toEqual({ text: '🎸🎉xy', conflict: false });
  });

  it('applyText schreibt nur den Unterschied (Schreibmarken anderer bleiben am Zeichen)', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'Bühne 🎸 aufbauen');
    const rel = Y.createRelativePositionFromTypeIndex(t, 'Bühne 🎸 auf'.length);
    let deltas = 0;
    t.observe((e) => (deltas += e.delta.filter((d) => d.insert || d.delete).length));
    applyText(t, 'Bühne 🎸 morgen aufbauen!');
    expect(t.toString()).toBe('Bühne 🎸 morgen aufbauen!');
    expect(deltas).toBeLessThanOrEqual(2);
    expect(Y.createAbsolutePositionFromRelativePosition(rel, doc)!.index).toBe('Bühne 🎸 morgen auf'.length);
    // mit Basis: fremde Änderung bleibt
    t.insert(0, '1. ');
    expect(mergeIntoYText(t, 'Bühne 🎸 morgen aufbauen!', 'Bühne 🎸 heute aufbauen!')).toEqual({ text: '1. Bühne 🎸 heute aufbauen!', conflict: false });
    expect(t.toString()).toBe('1. Bühne 🎸 heute aufbauen!');
  });
});

describe('Vorschau der Vorlagen für die App', () => {
  it('docs/native_fixtures/web/templates.json und structure.json passen zum Web-Code (sonst tools/native-template-fixtures.mts und in die App übernehmen)', async () => {
    const data = pathToFileURL(path.resolve(HERE, '../../tools/native-template-fixtures-data.mts')).href;
    const mod = (await import(data)) as { buildTemplateFixtures: () => { templates: Record<string, unknown[]> }; buildStructureReferences: () => unknown };
    const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve(HERE, `../../docs/native_fixtures/web/${f}`), 'utf8')) as unknown;
    const now = JSON.parse(JSON.stringify(mod.buildTemplateFixtures()));
    expect(read('templates.json')).toEqual(now);
    expect(Object.keys(now.templates)).toEqual(TEMPLATES.map((t) => t.id));
    // Referenzwerte der App (Kartenhöhe, Tabellen, „Einfügen als …“)
    expect(read('structure.json')).toEqual(JSON.parse(JSON.stringify(mod.buildStructureReferences())));
  });
});

describe('Struktur-Aktionen (P3)', () => {
  it('stehen in welcome.actions', async () => {
    const { welcome } = await setup();
    for (const n of ['structure.template', 'structure.insert', 'structure.paste', 'structure.toCard', 'structure.people', 'card.title', 'card.desc']) expect(welcome.actions[n]).toBe(1);
    expect(WEB.actionList(false)['card.desc']).toBe(1);
  });

  it('structure.template: wie die Galerie (Bildmitte, sonst freier Platz daneben), feste IDs, ein Schritt, gleiche key nur einmal', async () => {
    const { a, w } = await setup();
    const ack = await send(a, [{ op: 'act', name: 'structure.template', args: { template: 'kanban', x: 0, y: 0 }, key: 'kb1' }]);
    expect(ack.t).toBe('ack');
    const ref = TEMPLATES.find((t) => t.id === 'kanban')!.build();
    const ids = ref.map((_, i) => `kb1-${i + 1}`);
    expect(ack.results['0'].select).toEqual(ids);
    await waitFor(() => w.objects.has(ids.at(-1)!));
    // gleiche Objekte wie die Vorlage, Mitte (Umriss aller Objekte) auf der Bildmitte
    const d = offsetTo(ref, { x: 0, y: 0 });
    ids.forEach((id, i) => expect(shape(json(w, id)!)).toEqual(shape(ref[i]!, -d.x, -d.y)));
    const b = previewBounds(ref)!;
    expect(ack.results['0'].data.rect).toEqual({ x: -b.w / 2, y: -b.h / 2, w: b.w, h: b.h });
    // zweites Mal: in der Mitte liegt schon etwas → nächster freier Platz (Referenz: freeSpot auf einem Browser-Store)
    const snap = new BoardStore(new Y.Doc(), 'a:ref');
    snap.createMany(ids.map((id) => json(w, id)!) as unknown as NewObject[]);
    const c = freeSpot(b, { x: 0, y: 0 }, occupiedIn(snap.getSnapshot()));
    expect(c).not.toEqual({ x: 0, y: 0 });
    const ack2 = await send(a, [{ op: 'act', name: 'structure.template', args: { template: 'kanban', x: 0, y: 0 }, key: 'kb2' }]);
    expect(ack2.results['0'].data.rect).toEqual({ x: c.x - b.w / 2, y: c.y - b.h / 2, w: b.w, h: b.h });
    // gleiche key: nicht noch einmal
    await send(a, [{ op: 'act', name: 'structure.template', args: { template: 'kanban', x: 0, y: 0 }, key: 'kb2' }]);
    expect([...w.objects.keys()].filter((k) => k.startsWith('kb2-')).length).toBe(ref.length);
    // ein Rückgängig-Schritt je Vorlage
    expect((await undo(a)).t).toBe('ack');
    await waitFor(() => !w.objects.has('kb2-1'));
    expect([...w.objects.keys()].filter((k) => k.startsWith('kb2-')).length).toBe(0);
    expect(w.objects.has('kb1-1')).toBe(true);
  });

  it('structure.template: Verbinder zeigen auf die Kopien, Mindmap-Knoten auf ihre neuen Eltern', async () => {
    const { a, w } = await setup();
    const ack = await send(a, [
      { op: 'act', name: 'structure.template', args: { template: 'flow', x: 0, y: 0 }, key: 'fl' },
      { op: 'act', name: 'structure.template', args: { template: 'mindmap', x: 5000, y: 0 }, key: 'mm' },
    ]);
    const all = [...ack.results['0'].select, ...ack.results['1'].select] as string[];
    await waitFor(() => all.every((id) => w.objects.has(id)));
    const objs = all.map((id) => json(w, id)!);
    const connectors = objs.filter((o) => o.type === 'connector');
    expect(connectors.length).toBe(7);
    for (const c of connectors) for (const e of [c.from, c.to]) expect(all).toContain(e.objectId);
    const nodes = objs.filter((o) => o.type === 'mindnode');
    expect(nodes.filter((n) => !n.mind.parent)).toHaveLength(1);
    for (const n of nodes) if (n.mind.parent) expect(ack.results['1'].select).toContain(n.mind.parent);
  });

  it('structure.paste: Tabelle, N Haftnotizen, eine Haftnotiz – Mitte an der Einfüge-Stelle, danach gewählt', async () => {
    const { a, w } = await setup();
    const tsv = 'Bereich\tFr\tSa\nBar\tLena\t\nEinlass\t"Tom\nMira"\tJonas\n';
    let ack = await send(a, [{ op: 'act', name: 'structure.paste', args: { text: tsv, as: 'table', x: 100, y: 50 }, key: 'p1' }]);
    expect(ack.results['0'].select).toEqual(['p1-1']);
    await waitFor(() => w.objects.has('p1-1'));
    const t = json(w, 'p1-1')!;
    const ref = tableObject(pasteChoice(tsv)!.table!, { x: 100, y: 50 });
    expect(matrix(safeTable(t.table))).toEqual(matrix(safeTable(ref.table)));
    const td = offsetTo([ref], { x: 100, y: 50 });
    expect([t.x, t.y, t.w, t.h]).toEqual([ref.x + td.x, ref.y + td.y, ref.w, ref.h]);
    // je Zeile eine Notiz im Raster (Farbe/Größe wie das Notiz-Werkzeug der App)
    const text = 'Strom\nWasser\n\nLicht\n';
    ack = await send(a, [{ op: 'act', name: 'structure.paste', args: { text, as: 'notes', x: 0, y: 0, color: '#9fd3ff', w: 300, h: 200 }, key: 'p2' }]);
    expect(ack.results['0'].select).toEqual(['p2-1', 'p2-2', 'p2-3']);
    await waitFor(() => w.objects.has('p2-3'));
    const base = { type: 'sticky' as const, x: 0, y: 0, w: 300, h: 200, color: '#9fd3ff', text: '' };
    const notes = notesOf(base, pasteChoice(text)!);
    const nd = offsetTo(notes, { x: 0, y: 0 });
    notes.forEach((n, i) => expect(json(w, `p2-${i + 1}`)).toMatchObject({ type: 'sticky', x: n.x + nd.x, y: n.y + nd.y, w: 300, h: 200, color: '#9fd3ff', text: n.text }));
    // alles als eine Notiz
    ack = await send(a, [{ op: 'act', name: 'structure.paste', args: { text: 'a\tb\r\nc', as: 'note', x: 0, y: 0 }, key: 'p3' }]);
    await waitFor(() => w.objects.has('p3-1'));
    expect(json(w, 'p3-1')).toMatchObject({ type: 'sticky', x: -100, y: -100, w: 200, h: 200, color: '#fff27a', text: singleNote(base, 'a\tb\r\nc').text });
    // Tabelle ohne Tabellendaten: nichts
    ack = await send(a, [{ op: 'act', name: 'structure.paste', args: { text: 'eins\nzwei', as: 'table', x: 0, y: 0 } }]);
    expect(ack.results['0']).toEqual({ skipped: true });
    // Prüfung
    ack = await send(a, [{ op: 'act', name: 'structure.paste', args: { text: 'x', as: 'bild', x: 0, y: 0 } }]);
    expect([ack.t, ack.error]).toEqual(['nack', 'invalid_input']);
    ack = await send(a, [{ op: 'act', name: 'structure.template', args: { template: 'gibtsnicht', x: 0, y: 0 } }]);
    expect([ack.t, ack.error]).toEqual(['nack', 'invalid_input']);
  });

  it('structure.insert (Q2): eigene Vorlage wie die Galerie (insertAt + freeSpot), Rich-Text, Verbinder, ein Schritt', async () => {
    const { a, w } = await setup();
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fett', marks: [{ type: 'bold' }] }] }] };
    // so speichert der Browser die Auswahl (templateFromSelection → /api/templates)
    const saved = [
      { id: 'f', type: 'frame', x: 0, y: 0, w: 600, h: 400, z: 'a0', createdBy: 'k:9', updatedAt: '', title: 'Meine Retro', color: '#ffffff' },
      { id: 'n1', type: 'sticky', x: 40, y: 80, w: 200, h: 200, z: 'a1', createdBy: 'k:9', updatedAt: '', text: 'Fett', content: doc, color: '#c9e14a', locked: true },
      { id: 'n2', type: 'sticky', x: 340, y: 80, w: 200, h: 200, z: 'a2', createdBy: 'k:9', updatedAt: '', text: 'B', color: '#ffb3d1' },
      { id: 'c', type: 'connector', x: 0, y: 0, w: 1, h: 1, z: 'a3', createdBy: 'k:9', updatedAt: '', from: { objectId: 'n1' }, to: { objectId: 'n2' } },
    ];
    const ack = await send(a, [{ op: 'act', name: 'structure.insert', args: { json: JSON.stringify(saved), x: 1000, y: 500 }, key: 'own' }]);
    expect(ack.t).toBe('ack');
    const ids = ['own-1', 'own-2', 'own-3', 'own-4'];
    expect(ack.results['0'].select).toEqual(ids);
    await waitFor(() => ids.every((id) => w.objects.has(id)));
    // Referenz: dieselbe Web-Funktion (own.ts + insertAt) auf einem Browser-Store
    const ref = new BoardStore(new Y.Doc(), 'a:ref');
    const objs = cleanTemplateObjects(saved);
    const b = previewBounds(objs)!;
    const c = freeSpot(b, { x: 1000, y: 500 }, occupiedIn(ref.getSnapshot()));
    insertAt(ref, objs, c, (i) => ids[i]!);
    for (const id of ids) expect(shape(json(w, id)!)).toEqual(shape(ref.get(id)! as unknown as Record<string, any>));
    expect(ack.results['0'].data.rect).toEqual({ x: c.x - b.w / 2, y: c.y - b.h / 2, w: b.w, h: b.h });
    expect(json(w, 'own-4')).toMatchObject({ from: { objectId: 'own-2' }, to: { objectId: 'own-3' } });
    expect(json(w, 'own-2')!.locked).toBeUndefined();
    expect(json(w, 'own-2')!.createdBy).not.toBe('k:9');
    // Rich-Text wieder als Fragment (Lesekopie wie im Schnappschuss)
    const frag = w.objects.get('own-2')!.get('content');
    expect(frag).toBeInstanceOf(Y.XmlFragment);
    expect((frag as Y.XmlFragment).toString()).toContain('Fett');
    // ein Rückgängig-Schritt
    expect((await undo(a)).t).toBe('ack');
    await waitFor(() => !w.objects.has('own-1'));
    expect(ids.some((id) => w.objects.has(id))).toBe(false);
    // Unbrauchbares: nichts zu tun bzw. abgelehnt
    let r = await send(a, [{ op: 'act', name: 'structure.insert', args: { json: '[{"id":"x","type":"gibtsnicht","x":0,"y":0,"w":1,"h":1}]', x: 0, y: 0 } }]);
    expect(r.results['0']).toEqual({ skipped: true });
    r = await send(a, [{ op: 'act', name: 'structure.insert', args: { json: 'kein json', x: 0, y: 0 } }]);
    expect(r.results['0']).toEqual({ skipped: true });
    r = await send(a, [{ op: 'act', name: 'structure.insert', args: { objects: saved, x: 0, y: 0 } }]);
    expect([r.t, r.error]).toEqual(['nack', 'invalid_input']);
  });

  it('structure.toCard: nur ungesperrte Haftnotizen, Lage/Breite/Text wie im Web, Höhe aus dem Inhalt, ein Schritt', async () => {
    const { a, w } = await setup();
    const n1 = { id: 'n1', type: 'sticky', x: 10, y: 20, w: 200, h: 200, text: 'Bühne aufbauen und Strom für alle Stände verlegen', color: '#fff27a' };
    const n2 = { id: 'n2', type: 'sticky', x: 400, y: 20, w: 400, h: 200, text: 'Lang', color: '#fff27a' };
    const n3 = { id: 'n3', type: 'sticky', x: 900, y: 20, w: 200, h: 200, text: 'gesperrt', locked: true };
    await send(a, [{ op: 'create', objects: [n1, n2, n3, { id: 's1', type: 'shape', shape: 'rect', x: 0, y: 400, w: 100, h: 100 }] }]);
    a.send({ t: 'step' });
    const ack = await send(a, [{ op: 'act', name: 'structure.toCard', args: { ids: ['n1', 'n2', 'n3', 's1', 'fehlt'] }, key: 'tc' }]);
    expect(ack.results['0'].select).toEqual(['tc-1', 'tc-2']);
    await waitFor(() => w.objects.has('tc-2') && !w.objects.has('n1'));
    // Referenz: notesToCards auf einem Browser-Store (Höhe gemessen wie die Ansicht)
    const ref = new BoardStore(new Y.Doc(), 'a:ref');
    ref.createMany([n1, n2] as unknown as NewObject[]);
    const refIds = notesToCards(ref, [ref.get('n1')!, ref.get('n2')!], (i) => `tc-${i + 1}`, (c) => cardContentHeight(c, measure));
    for (const id of refIds) {
      const want = ref.get(id)!;
      expect(json(w, id)).toMatchObject({ type: 'card', x: want.x, y: want.y, w: want.w, h: want.h, text: want.text, color: '#1763b5' });
    }
    expect(json(w, 'tc-1')!.h).toBeGreaterThan(70);
    expect(w.objects.has('n2')).toBe(false);
    expect(w.objects.has('n3')).toBe(true);
    // ein Rückgängig-Schritt: Notizen zurück, Karten weg
    await undo(a);
    await waitFor(() => w.objects.has('n1') && !w.objects.has('tc-1'));
    expect(w.objects.has('n2')).toBe(true);
    const none = await send(a, [{ op: 'act', name: 'structure.toCard', args: { ids: ['n3', 's1'] } }]);
    expect(none.results['0']).toEqual({ skipped: true });
  });

  it('card.title / card.desc: Drei-Wege mit gleichzeitigen Eingaben im Web, Beschreibung als Y.Text, Höhe aus dem Inhalt', async () => {
    const { a, w } = await setup();
    await send(a, [{ op: 'create', objects: [{ id: 'k1', type: 'card', x: 0, y: 0, w: 300, h: 96, text: 'Strom', color: '#1763b5', status: 'doing' }] }]);
    a.send({ t: 'step' });
    await waitFor(() => w.objects.has('k1'));
    // Web tippt gleichzeitig vorne in den Titel; die App hängt hinten an (Basis = alter Stand)
    w.objects.get('k1')!.set('text', 'Viel Strom');
    await w.flushed();
    let ack = await send(a, [{ op: 'act', name: 'card.title', args: { id: 'k1', base: 'Strom', text: 'Strom für die Bühne' } }]);
    expect(ack.results['0']).toEqual({ data: { conflict: false } });
    await waitFor(() => json(w, 'k1')!.text === 'Viel Strom für die Bühne');
    // Beschreibung: alter String wird Y.Text, gleichzeitig getippter Text bleibt
    w.objects.get('k1')!.set('desc', 'Kabel');
    await w.flushed();
    ack = await send(a, [{ op: 'act', name: 'card.desc', args: { id: 'k1', base: 'Kabel', text: 'Kabel und Verteiler bei der Technik abholen' } }]);
    expect(ack.results['0']).toEqual({ data: { conflict: false } });
    await waitFor(() => w.objects.get('k1')!.get('desc') instanceof Y.Text);
    const yt = w.objects.get('k1')!.get('desc') as Y.Text;
    yt.insert(0, 'Wichtig: ');
    await w.flushed();
    a.send({ t: 'step' });
    ack = await send(a, [{ op: 'act', name: 'card.desc', args: { id: 'k1', base: 'Kabel und Verteiler bei der Technik abholen', text: 'Kabel und Verteiler morgen bei der Technik abholen' } }]);
    await waitFor(() => yt.toString() === 'Wichtig: Kabel und Verteiler morgen bei der Technik abholen');
    // Höhe wie die Ansicht misst (Titel, Beschreibung, Status-Chip)
    const o = json(w, 'k1')! as unknown as BoardObject;
    expect(o.h).toBe(cardContentHeight({ ...o, desc: yt.toString() }, measure));
    expect(o.h).toBeGreaterThan(96);
    // jede Eingabe ein Rückgängig-Schritt
    await undo(a);
    await waitFor(() => yt.toString() === 'Wichtig: Kabel und Verteiler bei der Technik abholen');
    // gesperrt / keine Karte → nichts
    await send(a, [{ op: 'update', patches: { k1: { locked: true } } }]);
    ack = await send(a, [{ op: 'act', name: 'card.desc', args: { id: 'k1', text: 'x' } }]);
    expect(ack.results['0']).toEqual({ skipped: true });
  });

  it('structure.people: eigener Name für „Zuständig“ (wie beim Öffnen im Browser), ohne Rückgängig, nur bei Änderung', async () => {
    const { a, w, mara } = await setup();
    let ack = await send(a, [{ op: 'act', name: 'structure.people', args: {} }]);
    expect(ack.results['0']).toEqual({});
    const people = w.doc.getMap<string>('structure.people');
    await waitFor(() => people.get(mara.user.key) === mara.user.name);
    ack = await send(a, [{ op: 'act', name: 'structure.people', args: {} }]);
    expect(ack.results['0']).toEqual({ skipped: true });
    expect((await undo(a)).error).toBe('nothing');
  });

  it('Kartenhöhe: leer = Platzhalter, Beschreibung höchstens 4 Zeilen, Fußzeile bricht um', () => {
    const card = (extra: Partial<BoardObject>) => ({ id: 'c', type: 'card', x: 0, y: 0, w: 300, h: 96, z: '', createdBy: '', updatedAt: '', ...extra }) as BoardObject;
    const empty = cardContentHeight(card({ text: '' }), measure);
    expect(empty).toBe(Math.round(14 + 22.1 + 14));
    expect(cardContentHeight(card({ text: 'Titel' }), measure)).toBe(empty);
    const long = 'Sehr lange Beschreibung '.repeat(20);
    expect(cardContentHeight(card({ text: 'T', desc: long }), measure)).toBe(Math.round(14 + 22.1 + 6 + 4 * 20.3 + 14));
    const chips = cardContentHeight(card({ text: 'T', status: 'done', due: '2026-06-12', assignee: { key: 'm:1', name: 'Mara' } }), measure);
    expect(chips).toBe(Math.round(14 + 22.1 + 12 + 26 + 14));
    const many = cardContentHeight(card({ text: 'T', tags: Array.from({ length: 6 }, (_, i) => ({ label: `Tag Nummer ${i}`, color: '#c9e14a' })) }), measure);
    expect(many).toBeGreaterThan(Math.round(14 + 22.1 + 12 + 24 + 6 + 24 + 14) - 1);
  });
});
