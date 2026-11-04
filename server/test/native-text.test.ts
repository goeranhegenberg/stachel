// Rich-Text-Bearbeitung der App (docs/contract.md §8.6 `text`, Konzept §4.6): Zusammenführen (merge3), kleinster
// Unterschied ins Fragment (applyDocToFragment) und die `text`-Op über den Gateway – schneller Weg ohne Zwischenänderung,
// Rebase auf gleichzeitige Web-Eingaben (Basis per `baseDoc` bzw. per Revision), echte Überlappung (`ack.conflict`),
// unbekannte Marks/Knoten bleiben, alte Objekte nur mit `text`, Rückgängig, Prüfung.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { applyDocToFragment, diffKeys, merge3, normalizeDoc, sameDoc, stableJson, type PMDoc, type PMNode } from '../src/native/richmerge.js';
import { WEB } from '../src/native/web-impl.js';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient } from './native-client.js';
import { fragment, plain, RICH_ALL } from './native-seed.js';

type M = { type: string; attrs?: Record<string, unknown> };
const t = (text: string, ...marks: M[]): PMNode => (marks.length ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content: PMNode[]): PMNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const doc = (...content: PMNode[]): PMDoc => ({ type: 'doc', content });
const lines = (...s: string[]) => doc(...s.map((x) => p(...(x ? [t(x)] : []))));
const json = (f: Y.XmlFragment) => WEB.fragmentToJson(f) as PMDoc;

/** Fragment in einem eigenen Dokument (Yjs braucht eingefügte Typen). */
function inDoc(d: PMDoc) {
  const ydoc = new Y.Doc();
  const map = ydoc.getMap<Y.XmlFragment>('m');
  map.set('f', fragment(d));
  return { ydoc, f: map.get('f')! };
}

describe('merge3', () => {
  it('Änderungen in verschiedenen Absätzen bleiben beide', () => {
    const base = lines('Erste Zeile', 'Zweite Zeile');
    const mine = lines('Erste Zeile aus der App', 'Zweite Zeile');
    const theirs = lines('Erste Zeile', 'Zweite Zeile vom Web');
    const r = merge3(base, mine, theirs);
    expect(r.conflict).toBe(false);
    expect(r.doc).toEqual(lines('Erste Zeile aus der App', 'Zweite Zeile vom Web'));
  });

  it('im selben Absatz an verschiedenen Stellen: beide; gleichzeitig an derselben Stelle eingefügt: erst vorhanden, dann App', () => {
    const base = lines('Hallo Welt');
    expect(merge3(base, lines('Hallo Welt!'), lines('Oh, Hallo Welt')).doc).toEqual(lines('Oh, Hallo Welt!'));
    const same = merge3(base, lines('Hallo Welt und App'), lines('Hallo Welt und Web'));
    expect(same.doc).toEqual(lines('Hallo Welt und Web und App'));
    expect(same.conflict).toBe(false);
  });

  it('dieselbe Stelle unterschiedlich geändert: App gewinnt, conflict', () => {
    const r = merge3(lines('Treffen um 10 Uhr'), lines('Treffen um 11 Uhr'), lines('Treffen um 12 Uhr'));
    expect(r.doc).toEqual(lines('Treffen um 11 Uhr'));
    expect(r.conflict).toBe(true);
    // gleiche Änderung auf beiden Seiten ist kein Konflikt
    const s = merge3(lines('a b'), lines('a X b'), lines('a X b'));
    expect(s).toEqual({ doc: lines('a X b'), conflict: false });
  });

  it('Marks, unbekannte Marks/Knoten/Attribute bleiben; Formatänderung der App + Tippen im Web', () => {
    const comment = { type: 'comment', attrs: { id: 'c1', by: 'm:7' } };
    const base = doc(p(t('Wichtig', { type: 'bold' }), t(' und '), t('kommentiert', comment)), { type: 'callout', attrs: { tone: 'warn' }, content: [p(t('Achtung'))] });
    // App: „und“ kursiv; Web: tippt in den Callout
    const mine = doc(p(t('Wichtig', { type: 'bold' }), t(' '), t('und', { type: 'italic' }), t(' '), t('kommentiert', comment)), { type: 'callout', attrs: { tone: 'warn' }, content: [p(t('Achtung'))] });
    const theirs = doc(p(t('Wichtig', { type: 'bold' }), t(' und '), t('kommentiert', comment)), { type: 'callout', attrs: { tone: 'warn' }, content: [p(t('Achtung!!'))] });
    const r = merge3(base, mine, theirs);
    expect(r.conflict).toBe(false);
    expect(r.doc).toEqual(normalizeDoc(doc(p(t('Wichtig', { type: 'bold' }), t(' '), t('und', { type: 'italic' }), t(' '), t('kommentiert', comment)), { type: 'callout', attrs: { tone: 'warn' }, content: [p(t('Achtung!!'))] })));
  });

  it('Absatz teilen (App) und Tippen in einem anderen Absatz (Web); Häkchen (Web) und Text (App) im selben Eintrag', () => {
    const base = lines('Eins zwei', 'Drei');
    const r = merge3(base, lines('Eins', 'zwei', 'Drei'), lines('Eins zwei', 'Drei vier'));
    expect(r.doc).toEqual(lines('Eins', 'zwei', 'Drei vier'));
    const task = (checked: boolean, text: string) => doc({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked }, content: [p(t(text))] }] });
    const m = merge3(task(false, 'Strom'), task(false, 'Strom klären'), task(true, 'Strom'));
    expect(m).toEqual({ doc: task(true, 'Strom klären'), conflict: false });
  });

  it('Rundreise mit allen Knoten/Marks: ohne Gegenänderung genau der App-Stand', () => {
    const mine = structuredClone(RICH_ALL);
    (mine.content[0]!.content![0] as PMNode).text = 'Ablauf Sonntag';
    expect(sameDoc(merge3(RICH_ALL, mine, RICH_ALL).doc, mine)).toBe(true);
    expect(sameDoc(merge3(RICH_ALL, RICH_ALL, mine).doc, mine)).toBe(true);
  });

  it('Zufall: Hunks erzeugen genau die Zielfolge; ohne Gegenänderung gewinnt die jeweilige Seite', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const word = () => ['a', 'b', 'c', 'd'][rnd(4)]!;
    for (let round = 0; round < 300; round++) {
      const a = Array.from({ length: rnd(30) }, word);
      const b = [...a];
      for (let e = rnd(6); e > 0; e--) {
        const at = rnd(b.length + 1);
        if (rnd(2)) b.splice(at, rnd(3), ...Array.from({ length: rnd(3) }, word));
        else b.splice(at, 0, word());
      }
      const out: string[] = [];
      let pos = 0;
      for (const h of diffKeys(a, b)) {
        out.push(...a.slice(pos, h.bStart), ...b.slice(h.oStart, h.oEnd));
        pos = h.bEnd;
      }
      out.push(...a.slice(pos));
      expect(out).toEqual(b);
      const da = lines(a.join(''));
      const db = lines(b.join(''));
      expect(stableJson(merge3(da, db, da).doc)).toBe(stableJson(normalizeDoc(db)));
      expect(stableJson(merge3(da, da, db).doc)).toBe(stableJson(normalizeDoc(db)));
    }
  });
});

describe('applyDocToFragment', () => {
  it('ändert nur den Unterschied: unveränderte Absätze und Text behalten ihre Yjs-Elemente (Schreibmarken bleiben)', () => {
    const { ydoc, f } = inDoc(lines('Erster Absatz', 'Zweiter Absatz', 'Dritter'));
    const second = f.get(1) as Y.XmlElement;
    const secondText = second.get(0) as Y.XmlText;
    // Schreibmarke eines Web-Nutzers mitten im zweiten Absatz
    const caret = Y.createRelativePositionFromTypeIndex(secondText, 7);
    let updates = 0;
    ydoc.on('update', () => updates++);
    ydoc.transact(() => applyDocToFragment(f, lines('Erster Absatz!', 'Zweiter Absatz', 'Dritter')));
    expect(json(f)).toEqual(lines('Erster Absatz!', 'Zweiter Absatz', 'Dritter'));
    expect(f.get(1)).toBe(second);
    expect(Y.createAbsolutePositionFromRelativePosition(caret, ydoc)?.index).toBe(7);
    expect(updates).toBe(1);
    // gleich → gar nichts geschrieben
    ydoc.transact(() => applyDocToFragment(f, lines('Erster Absatz!', 'Zweiter Absatz', 'Dritter')));
    expect(updates).toBe(1);
  });

  it('Marks setzen/entfernen ohne geerbte Formatierung; Absätze einfügen/löschen; Attribute; unbekannte Marks', () => {
    const { ydoc, f } = inDoc(doc(p(t('fett', { type: 'bold' }), t(' normal')), p(t('weg'))));
    const target = doc(
      p(t('fett', { type: 'bold' }), t(' neu'), t(' normal', { type: 'comment', attrs: { id: 'x' } })),
      { type: 'heading', attrs: { level: 2 }, content: [t('Titel')] },
      p(),
    );
    ydoc.transact(() => applyDocToFragment(f, target));
    expect(json(f)).toEqual(target);
    const changed = doc({ type: 'heading', attrs: { level: 3 }, content: [t('Titel')] });
    ydoc.transact(() => applyDocToFragment(f, changed));
    expect(json(f)).toEqual(changed);
    ydoc.transact(() => applyDocToFragment(f, RICH_ALL));
    expect(json(f)).toEqual(RICH_ALL);
  });
});

// ---- Gateway ----------------------------------------------------------------------------------------------------------

let env: TestEnv;
let ws: string;
beforeAll(async () => {
  env = await startEnv({ nativeIdleMs: 300, nativeBufferMax: 50 });
  ws = env.base.replace('http', 'ws');
});
afterAll(async () => {
  await env?.stop();
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

let memberId = 900;
async function person(name: string) {
  const kt = env.fake.addMember(++memberId, name);
  const browser = await loginMember(env, kt);
  const { token, user } = await appSession(env.base, kt);
  return { kt, browser, token, user };
}

async function setup(content: PMDoc | null, text?: string) {
  const mara = await person('Mara');
  const board = (await mara.browser.post('/api/boards', { title: 'Text' })).body.board as { id: string };
  const w = webClient(ws, board.id, { cookie: mara.browser.cookieHeader() });
  cleanup.push(() => w.destroy());
  await w.synced();
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 'a0', text: text ?? (content ? plain(content) : '') })) m.set(k, v);
  if (content) m.set('content', fragment(content));
  w.objects.set('n1', m);
  await w.flushed();
  const a = new NativeClient(ws, mara.token);
  cleanup.push(() => a.close());
  const welcome = await a.hello(board.id);
  return { mara, board, w, a, welcome, note: () => w.objects.get('n1')! };
}

let reqNo = 0;
async function textOp(a: NativeClient, op: Record<string, unknown>) {
  const req = ++reqNo + 1000;
  const from = a.messages.length;
  a.send({ t: 'ops', req, ops: [{ op: 'text', id: 'n1', ...op }] });
  return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === req, 5000, from);
}

/** Web tippt wie y-prosemirror: direkt in den Y.XmlText eines Absatzes (und setzt `text` wie das Rich-Text-Modul). */
function webType(note: Y.Map<unknown>, para: number, at: number, s: string) {
  const f = note.get('content') as Y.XmlFragment;
  note.doc!.transact(() => {
    ((f.get(para) as Y.XmlElement).get(0) as Y.XmlText).insert(at, s);
    note.set('text', WEB.plainOf(WEB.fragmentToJson(f)));
  });
}

describe('text-Op über den Gateway', () => {
  it('ohne Zwischenänderung: App-Stand gilt, nur der Unterschied geht ins Fragment, Marks + Unbekanntes bleiben, text-Spiegel', async () => {
    const comment = { type: 'comment', attrs: { id: 'c1' } };
    const start = doc(p(t('Hallo ', { type: 'bold' }), t('Welt', comment)), p(t('Zweiter')));
    const { a, w, welcome, note } = await setup(start);
    expect(welcome.features).toContain('text');
    const second = (note().get('content') as Y.XmlFragment).get(1);
    const edited = doc(p(t('Hallo ', { type: 'bold' }), t('Welt', comment), t('!')), p(t('Zweiter')));
    const ack = await textOp(a, { base: welcome.rev, doc: edited, epoch: welcome.epoch });
    expect(ack).toMatchObject({ t: 'ack' });
    expect(ack.conflict).toBeUndefined();
    const patch = a.messages.find((m) => m.t === 'patch' && m.rev === ack.rev)!;
    expect(patch.changes[0].set.content).toEqual(edited);
    expect(patch.changes[0].set.text).toBe('Hallo Welt!\nZweiter');
    await waitFor(() => note().get('text') === 'Hallo Welt!\nZweiter');
    expect(json(note().get('content') as Y.XmlFragment)).toEqual(edited);
    expect((note().get('content') as Y.XmlFragment).get(1)).toBe(second);
    expect(w.objects.get('n1')!.get('updatedAt')).toBeTypeOf('string');
  });

  it('Web hat inzwischen getippt: Rebase über baseDoc und über die Basis-Revision – nichts geht verloren', async () => {
    const start = lines('Einkaufen', 'Zelte');
    const { a, welcome, note } = await setup(start);
    // Web tippt in den zweiten Absatz, nachdem die App ihren Stand hatte
    webType(note(), 1, 5, ' und Planen');
    await a.next((m) => m.t === 'patch' && m.rev > welcome.rev);
    const ack = await textOp(a, { base: welcome.rev, epoch: welcome.epoch, baseDoc: start, doc: lines('Einkaufen gehen', 'Zelte') });
    expect(ack.conflict).toBeUndefined();
    await waitFor(() => note().get('text') === 'Einkaufen gehen\nZelte und Planen');
    // nur Revision (ohne baseDoc): der Spiegel kennt den Stand zu dieser Revision
    const rev = ack.rev as number;
    webType(note(), 0, 0, 'Jetzt ');
    await a.next((m) => m.t === 'patch' && m.rev > rev);
    const ack2 = await textOp(a, { base: rev, epoch: welcome.epoch, doc: lines('Einkaufen gehen', 'Zelte und Planen', 'Grill') });
    expect(ack2.conflict).toBeUndefined();
    await waitFor(() => note().get('text') === 'Jetzt Einkaufen gehen\nZelte und Planen\nGrill');
  });

  it('dieselbe Stelle gleichzeitig geändert: App gewinnt, ack.conflict nennt das Objekt; fremde Epoche ohne baseDoc = Basis unbekannt', async () => {
    const start = lines('Treffen um 10 Uhr');
    const { a, welcome, note } = await setup(start);
    const f = note().get('content') as Y.XmlFragment;
    note().doc!.transact(() => {
      const x = (f.get(0) as Y.XmlElement).get(0) as Y.XmlText;
      x.delete(11, 2);
      x.insert(11, '12');
      note().set('text', 'Treffen um 12 Uhr');
    });
    await a.next((m) => m.t === 'patch' && m.rev > welcome.rev);
    const ack = await textOp(a, { base: welcome.rev, baseDoc: start, doc: lines('Treffen um 11 Uhr') });
    expect(ack.conflict).toEqual(['n1']);
    await waitFor(() => note().get('text') === 'Treffen um 11 Uhr');
    // alte Epoche (Server neu gestartet) und kein baseDoc: der spätere Stand gilt, mit Hinweis
    const ack2 = await textOp(a, { base: 1, epoch: 'alt', doc: lines('Treffen um 13 Uhr') });
    expect(ack2.conflict).toEqual(['n1']);
    await waitFor(() => note().get('text') === 'Treffen um 13 Uhr');
  });

  it('altes Objekt nur mit `text`: Fragment wird angelegt; text-Spiegel weicht ab → `text` gilt als Basis', async () => {
    const { a, welcome, note } = await setup(null, 'Nur Klartext\nZweite');
    const ack = await textOp(a, { base: welcome.rev, epoch: welcome.epoch, doc: doc(p(t('Nur ', { type: 'bold' }), t('Klartext')), p(t('Zweite'))) });
    expect(ack.t).toBe('ack');
    await waitFor(() => note().get('content') instanceof Y.XmlFragment);
    expect(json(note().get('content') as Y.XmlFragment)).toEqual(doc(p(t('Nur ', { type: 'bold' }), t('Klartext')), p(t('Zweite'))));
    expect(note().get('text')).toBe('Nur Klartext\nZweite');
    // alter Client ändert nur `text` → App bearbeitet auf ihrem (veralteten) Stand → `text` war die Wahrheit
    note().set('text', 'Nur Klartext\nZweite\nDritte');
    await a.next((m) => m.t === 'patch' && m.changes?.[0]?.set?.text?.includes('Dritte'));
    const ack2 = await textOp(a, { base: ack.rev, epoch: welcome.epoch, doc: doc(p(t('Nur ', { type: 'bold' }), t('Klartext!')), p(t('Zweite'))) });
    expect(ack2.t).toBe('ack');
    await waitFor(() => note().get('text') === 'Nur Klartext!\nZweite\nDritte');
  });

  it('Rückgängig nimmt den Text-Schritt zurück (nur den eigenen); Wiederholung derselben req ändert nichts', async () => {
    const start = lines('Eins');
    const { a, welcome, note } = await setup(start);
    const req = 5000;
    const msg = { t: 'ops', req, ops: [{ op: 'text', id: 'n1', base: welcome.rev, epoch: welcome.epoch, baseDoc: start, doc: lines('Eins zwei') }] };
    a.send(msg);
    await a.next((m) => m.t === 'ack' && m.req === req);
    await waitFor(() => note().get('text') === 'Eins zwei');
    a.send(msg);
    await a.next((m) => m.t === 'ack' && m.req === req, 3000, a.messages.length - 1);
    expect(note().get('text')).toBe('Eins zwei');
    a.send({ t: 'step' });
    a.send({ t: 'undo', req: req + 1 });
    await a.next((m) => m.t === 'ack' && m.req === req + 1);
    await waitFor(() => note().get('text') === 'Eins');
    expect(json(note().get('content') as Y.XmlFragment)).toEqual(start);
  });

  it('Prüfung: kaputtes Dokument, fehlende base, zu lang → nack invalid_input; gelöschtes Objekt → ack ohne Änderung', async () => {
    const { a, welcome, w } = await setup(lines('x'));
    expect(await textOp(a, { base: welcome.rev, doc: { type: 'paragraph' } })).toMatchObject({ t: 'nack', error: 'invalid_input', index: 0 });
    expect(await textOp(a, { doc: lines('y') })).toMatchObject({ t: 'nack', error: 'invalid_input' });
    expect(await textOp(a, { base: 0, doc: lines('y'.repeat(20_001)) })).toMatchObject({ t: 'nack', error: 'invalid_input' });
    expect(await textOp(a, { base: 0, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text' }] }] } })).toMatchObject({ t: 'nack' });
    w.objects.delete('n1');
    await w.flushed();
    expect(await textOp(a, { base: welcome.rev, doc: lines('z') })).toMatchObject({ t: 'ack' });
    expect(w.objects.has('n1')).toBe(false);
  });
});
