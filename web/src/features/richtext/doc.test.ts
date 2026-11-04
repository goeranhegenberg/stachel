import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { Node as PMNodeClass } from '@tiptap/pm/model';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { BoardStore, LOCAL_ORIGIN, registerYField } from '../../board/store';
import { RICH_TEXT_FIELD } from '../../protocol';
import { richExtensions } from './extensions';
import {
  appendText,
  toggleTask,
  contentCodec,
  ensureContent,
  fragmentToJson,
  hasMarkAll,
  hasUnknown,
  isWholeList,
  jsonToFragment,
  normalizeDoc,
  patchMarkAll,
  plainOf,
  richDoc,
  setMarkAll,
  textToDoc,
  toggleListDoc,
  type PMDoc,
} from './doc';
import { normalizeHref, safeHref } from './links';

const schema = getSchema(richExtensions());

const sample: PMDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Bühne' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'ganz ' },
        { type: 'text', text: 'fett', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' und ' },
        { type: 'text', text: 'rot', marks: [{ type: 'textStyle', attrs: { color: '#ec4e92' } }, { type: 'underline' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] },
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'eins' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'zwei', marks: [{ type: 'highlight', attrs: { color: '#fff27a' } }] }] }] },
      ],
    },
    { type: 'paragraph' },
  ],
};

/** Fragment in einem Doc integrieren (vorläufige Typen werden erst dann lesbar). */
function integrate(f: Y.XmlFragment) {
  const doc = new Y.Doc();
  doc.getMap('m').set('f', f);
  return doc.getMap('m').get('f') as Y.XmlFragment;
}

/** Über das Schema normalisiertes JSON (alle Standard-Attribute ergänzt). */
const viaSchema = (d: PMDoc) => PMNodeClass.fromJSON(schema, d).toJSON();

describe('Fragment ↔ JSON', () => {
  it('Rundreise erhält Knoten, Attribute und Marks', () => {
    const f = integrate(jsonToFragment(sample)!);
    expect(fragmentToJson(f)).toEqual(sample);
  });

  it('ist kompatibel mit y-prosemirror (beide Richtungen)', () => {
    // unser Fragment → y-prosemirror liest es wie Tiptap
    const ours = integrate(jsonToFragment(sample)!);
    expect(yXmlFragmentToProseMirrorRootNode(ours, schema).toJSON()).toEqual(viaSchema(sample));
    // y-prosemirror schreibt → wir lesen dasselbe Dokument
    const doc = new Y.Doc();
    const theirs = doc.getXmlFragment('x');
    prosemirrorJSONToYXmlFragment(schema, sample, theirs);
    expect(viaSchema(fragmentToJson(theirs))).toEqual(viaSchema(sample));
  });

  it('ungültige Daten ergeben kein Fragment', () => {
    expect(jsonToFragment('<p>x</p>')).toBeUndefined();
    expect(jsonToFragment({ type: 'doc' })).toBeUndefined();
    const f = integrate(jsonToFragment({ type: 'doc', content: [{ type: '<script>' }, { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }] })!);
    expect(plainOf(fragmentToJson(f))).toBe('ok');
  });
});

describe('Klartext-Spiegel', () => {
  it('trennt Blöcke und Listeneinträge mit Zeilenumbruch', () => {
    expect(plainOf(sample)).toBe('Bühne\nganz fett und rot\nLink\neins\nzwei\n');
    expect(plainOf({ type: 'doc', content: [] })).toBe('');
    expect(plainOf({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
  });

  it('textToDoc ist die Umkehrung', () => {
    for (const t of ['', 'eins', 'a\nb', '\n\nx\n', 'Zeile  mit   Leerzeichen']) expect(plainOf(textToDoc(t))).toBe(t);
  });

  it('richDoc gilt nur, wenn text passt (sonst hat ein alter Client text geändert)', () => {
    expect(richDoc({ content: sample, text: plainOf(sample) })).toBe(sample);
    expect(richDoc({ content: sample, text: 'alter Client' })).toBeNull();
    expect(richDoc({ text: 'x' })).toBeNull();
    expect(richDoc({ content: '<xml/>', text: '' })).toBeNull();
  });
});

describe('Migration', () => {
  const setup = (fields: Record<string, unknown>) => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc, 'm:1');
    const id = store.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200, ...(fields as object) });
    store.stopCapturing();
    return { doc, store, id };
  };

  it('baut content aus text, ohne eigenen Undo-Schritt', () => {
    const { store, id } = setup({ text: 'eins\nzwei' });
    const depth = store.undoDepth();
    const f = ensureContent(store, id)!;
    expect(fragmentToJson(f)).toEqual(textToDoc('eins\nzwei'));
    expect(store.undoDepth()).toBe(depth);
    // zweiter Aufruf ändert nichts
    expect(ensureContent(store, id)).toBe(f);
  });

  it('text eines alten Clients gilt: content wird neu aufgebaut', () => {
    const { store, id } = setup({ text: 'neu', content: sample });
    expect(store.get(id)!.content).toEqual(sample);
    ensureContent(store, id);
    expect(plainOf(store.get(id)!.content as PMDoc)).toBe('neu');
  });

  it('unbekannte Knoten und Marks werden zu Bekanntem, der Text bleibt', () => {
    const odd: PMDoc = {
      type: 'doc',
      content: [{ type: 'callout', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hinweis', marks: [{ type: 'comment' }, { type: 'bold' }] }] }] }],
    };
    expect(hasUnknown(odd)).toBe(true);
    const n = normalizeDoc(odd);
    expect(hasUnknown(n)).toBe(false);
    expect(plainOf(n)).toBe('Hinweis');
    const { store, id } = setup({ text: 'Hinweis', content: odd });
    ensureContent(store, id);
    expect(hasUnknown(store.get(id)!.content as PMDoc)).toBe(false);
  });
});

describe('Store: Feld-Codec', () => {
  registerYField(RICH_TEXT_FIELD, contentCodec);

  it('Schnappschuss liefert JSON, Kopieren baut ein neues Fragment', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id = store.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: plainOf(sample), content: sample });
    const o = store.get(id)!;
    expect(o.content).toEqual(sample);
    const copy = store.create({ ...o, id: undefined, z: undefined, x: 300 });
    const fa = store.yField<Y.XmlFragment>(id, RICH_TEXT_FIELD)!;
    const fb = store.yField<Y.XmlFragment>(copy, RICH_TEXT_FIELD)!;
    expect(fb).toBeInstanceOf(Y.XmlFragment);
    expect(fb).not.toBe(fa);
    expect(store.get(copy)!.content).toEqual(sample);
  });

  it('Mark aufs ganze Objekt ist ein Undo-Schritt', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id = store.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'a\nb' });
    store.stopCapturing();
    store.transact(() => setMarkAll(ensureContent(store, id, LOCAL_ORIGIN)!, 'underline', {}));
    expect(hasMarkAll(store.get(id)!.content as PMDoc, 'underline')).toBe(true);
    store.undo();
    expect(store.get(id)!.content).toBeUndefined();
    expect(store.get(id)!.text).toBe('a\nb');
  });

  it('zwei Personen tippen gleichzeitig in denselben Text: nichts geht verloren', () => {
    const a = new Y.Doc();
    const sa = new BoardStore(a, 'm:1');
    const id = sa.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Bühne', content: textToDoc('Bühne') });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const sb = new BoardStore(b, 'm:2');
    // gleichzeitig (ohne Austausch) an verschiedenen Stellen tippen
    sa.transact(() => appendText(sa.yField<Y.XmlFragment>(id, RICH_TEXT_FIELD)!, ' Nord'));
    sb.transact(() => ((sb.yField<Y.XmlFragment>(id, RICH_TEXT_FIELD)!.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Große '));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(plainOf(sa.get(id)!.content as PMDoc)).toBe('Große Bühne Nord');
    expect(sb.get(id)!.content).toEqual(sa.get(id)!.content);
  });
});

describe('Format aufs ganze Objekt', () => {
  it('setMarkAll setzt und entfernt; Code-Blöcke bleiben ohne Marks', () => {
    const f = integrate(jsonToFragment({ type: 'doc', content: [...sample.content, { type: 'codeBlock', content: [{ type: 'text', text: 'x=1' }] }] })!);
    setMarkAll(f, 'italic', {});
    const j = fragmentToJson(f);
    expect(hasMarkAll(j, 'italic')).toBe(true);
    expect(j.content.at(-1)!.content![0].marks).toBeUndefined();
    setMarkAll(f, 'italic', null);
    expect(hasMarkAll(fragmentToJson(f), 'italic')).toBe(false);
    // andere Marks bleiben
    expect(hasMarkAll(fragmentToJson(f), 'bold')).toBe(false);
    expect(JSON.stringify(fragmentToJson(f))).toContain('"bold"');
  });

  it('patchMarkAll ändert die Textfarbe und behält Teil-Schriftgrößen', () => {
    const f = integrate(
      jsonToFragment({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'groß', marks: [{ type: 'textStyle', attrs: { fontSize: '1.5em' } }] }, { type: 'text', text: ' klein' }] }],
      })!,
    );
    patchMarkAll(f, 'textStyle', { color: '#1763b5' });
    const runs = fragmentToJson(f).content[0].content!;
    expect(runs[0].marks).toEqual([{ type: 'textStyle', attrs: { fontSize: '1.5em', color: '#1763b5' } }]);
    expect(runs[1].marks).toEqual([{ type: 'textStyle', attrs: { color: '#1763b5' } }]);
    expect(viaSchema(fragmentToJson(f))).toBeTruthy();
    patchMarkAll(f, 'textStyle', { color: null });
    const after = fragmentToJson(f).content[0].content!;
    expect(after[0].marks).toEqual([{ type: 'textStyle', attrs: { fontSize: '1.5em' } }]);
    expect(after[1].marks).toBeUndefined();
    expect(plainOf(fragmentToJson(f))).toBe('groß klein');
  });

  it('Listen umschalten erhält den Klartext', () => {
    const d = textToDoc('eins\nzwei\ndrei');
    for (const kind of ['bulletList', 'orderedList', 'taskList'] as const) {
      const l = toggleListDoc(d, kind);
      expect(isWholeList(l, kind)).toBe(true);
      expect(plainOf(l)).toBe('eins\nzwei\ndrei');
      expect(viaSchema(l)).toBeTruthy();
      const back = toggleListDoc(l, kind);
      expect(back).toEqual(d);
    }
  });

  it('appendText hängt am letzten Textblock an und erbt das Format', () => {
    const f = integrate(jsonToFragment(sample)!);
    appendText(f, 'x');
    expect(plainOf(fragmentToJson(f))).toBe('Bühne\nganz fett und rot\nLink\neins\nzwei\nx');
    const g = integrate(new Y.XmlFragment());
    appendText(g, 'a');
    appendText(g, 'b');
    expect(fragmentToJson(g)).toEqual(textToDoc('ab'));
    const h = integrate(jsonToFragment(toggleListDoc(textToDoc('eins'), 'bulletList'))!);
    appendText(h, 's');
    expect(plainOf(fragmentToJson(h))).toBe('einss');
    const k = integrate(jsonToFragment({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fett', marks: [{ type: 'bold' }] }] }] })!);
    appendText(k, '!');
    expect(fragmentToJson(k).content[0].content).toEqual([{ type: 'text', text: 'fett!', marks: [{ type: 'bold' }] }]);
  });
});

describe('Checkliste ohne Bearbeitung', () => {
  it('toggleTask schaltet den n-ten Eintrag (auch verschachtelt) und lässt den Klartext gleich', () => {
    const item = (text: string, checked: boolean, sub?: unknown) => ({
      type: 'taskItem',
      attrs: { checked },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...(sub ? [sub] : [])],
    });
    const f = integrate(
      jsonToFragment({ type: 'doc', content: [{ type: 'taskList', content: [item('a', false, { type: 'taskList', content: [item('a1', false)] }), item('b', true)] }] })!,
    );
    const before = plainOf(fragmentToJson(f));
    expect(toggleTask(f, 1)).toBe(true);
    expect(toggleTask(f, 2)).toBe(false);
    expect(toggleTask(f, 5)).toBeNull();
    const json = JSON.stringify(fragmentToJson(f));
    expect(json.match(/"checked":true/g)).toHaveLength(1);
    expect(plainOf(fragmentToJson(f))).toBe(before);
    // y-prosemirror liest das Attribut als Boolean
    expect(fragmentToJson(f).content[0].content![0].content![1].content![0].attrs?.checked).toBe(true);
  });
});

describe('Links', () => {
  it('lässt nur sichere Ziele zu', () => {
    expect(safeHref('https://example.org')).toBe('https://example.org/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(normalizeHref('example.org/tickets')).toBe('https://example.org/tickets');
    expect(normalizeHref('orga@example.org')).toBe('mailto:orga@example.org');
    expect(normalizeHref('JavaScript:alert(1)')).toBeNull();
    expect(normalizeHref('  ')).toBeNull();
  });
});
