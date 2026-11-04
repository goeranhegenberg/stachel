// Miro-HTML → ProseMirror-JSON (server/src/import/miro/html.ts, Konzept §2.5): Entities, Marks, Links, Listen,
// Aufgabenlisten, Überschriften, Grenzen; Klartext-Spiegel gleich dem des Web (plainOf), Dokumente bestehen die Prüfung
// der Native-API (validate.ts, Op `text`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { plainOf as webPlainOf } from '../../web/src/features/richtext/doc';
import { HIGHLIGHT_COLORS } from '../src/import/miro/colors';
import { colorizeDoc, decodeEntities, docDepth, HTML_MAX_DEPTH, htmlToDoc, htmlToPlain, plainOf, safeHref, type PMDoc } from '../src/import/miro/html';
import { validateOps } from '../src/native/validate';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const doc = (html: string, base?: number) => htmlToDoc(html, base ? { baseFontSize: base } : {}).doc;
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => (marks ? { type: 'text', text, marks } : { type: 'text', text });

/** besteht die Prüfung der Native-API für Rich-Text (Op `text`) */
const validDoc = (d: PMDoc) => {
  expect(() => validateOps([{ op: 'text', id: 'x1', base: 0, doc: d }])).not.toThrow();
};

describe('Entities und Zeichen', () => {
  it('dekodiert benannte und numerische Entities, entfernt Zero-Width-Zeichen', () => {
    expect(decodeEntities('a&amp;b &lt;c&gt; &uuml;ber &#252; &#xFC; &quot;x&quot; &nbsp;|&#8203;|\u200b|&zwj;|&shy;')).toBe('a&b <c> über ü ü "x" \u00a0||||');
    expect(decodeEntities('&#128512; &unbekannt; &#0;')).toBe('😀 &unbekannt; \ufffd');
  });

  it('Text aus Miro-Haftnotiz', () => {
    expect(doc('<p><strong>Catering</strong> war p&uuml;nktlich&nbsp;&amp; lecker</p>')).toEqual({
      type: 'doc',
      content: [p(t('Catering', [{ type: 'bold' }]), t(' war pünktlich\u00a0& lecker'))],
    });
  });

  it('Leerraum wie im Browser, leere Absätze am Ende weg, <br> am Blockende ohne eigene Zeile', () => {
    expect(doc('<p>  a \n  b  </p>\n<p>c<br></p><p></p><p>&#8203;</p>')).toEqual({ type: 'doc', content: [p(t('a b')), p(t('c'))] });
    expect(doc('<p>a<br>b</p><p><br></p><p>c</p>')).toEqual({ type: 'doc', content: [p(t('a'), { type: 'hardBreak' }, t('b')), { type: 'paragraph' }, p(t('c'))] });
    expect(doc('Ohne Tags')).toEqual({ type: 'doc', content: [p(t('Ohne Tags'))] });
    expect(doc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(htmlToDoc(undefined).plain).toBe('');
  });
});

describe('Marks', () => {
  it('fett, kursiv, unterstrichen, durchgestrichen, Code – auch verschachtelt', () => {
    expect(doc('<p><b>a</b><i>b</i><em>c</em><u>d</u><s>e</s><strike>f</strike><del>g</del><code>h</code><strong><em>i</em></strong></p>').content[0]).toEqual(
      p(
        t('a', [{ type: 'bold' }]),
        t('bc', [{ type: 'italic' }]),
        t('d', [{ type: 'underline' }]),
        t('efg', [{ type: 'strike' }]),
        t('h', [{ type: 'code' }]),
        t('i', [{ type: 'bold' }, { type: 'italic' }]),
      ),
    );
  });

  it('Links nur http, https, mailto – sonst bleibt nur der Text', () => {
    const link = (href: string) => ({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } });
    expect(doc('<p><a href="https://example.org/a?b=1&amp;c=2">x</a> <a href="mailto:a@example.org">m</a></p>').content[0]).toEqual(
      p(t('x', [link('https://example.org/a?b=1&c=2')]), t(' '), t('m', [link('mailto:a@example.org')])),
    );
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '/relativ', 'ftp://x', 'java&#x09;script:alert(1)']) {
      expect(doc(`<p><a href="${bad}">t</a></p>`).content[0]).toEqual(p(t('t')));
    }
    expect(safeHref('http://example.org')).toBe('http://example.org');
    expect(safeHref(' https://example.org/x ')).toBe('https://example.org/x');
    expect(safeHref('https://')).toBeUndefined();
  });

  it('span: Textfarbe, Markierung (nächste der 6 Farben), Teilgrößen nur mit Objekt-Schriftgröße', () => {
    expect(doc('<p><span style="color:#e6282e">rot</span><span style="color: rgb(0, 0, 255)">blau</span></p>').content[0]).toEqual(
      p(t('rot', [{ type: 'textStyle', attrs: { color: '#e6282e' } }]), t('blau', [{ type: 'textStyle', attrs: { color: '#0000ff' } }])),
    );
    const hl = doc('<p><span style="background-color:#fef445">gelb</span><span style="background-color:#ff9cc0">rosa</span></p>').content[0]!.content!;
    expect(hl[0]!.marks).toEqual([{ type: 'highlight', attrs: { color: '#fff27a' } }]);
    expect(hl[1]!.marks).toEqual([{ type: 'highlight', attrs: { color: '#ffb3d1' } }]);
    for (const m of hl) expect(HIGHLIGHT_COLORS).toContain((m.marks![0]!.attrs as { color: string }).color);
    expect(doc('<p><span style="background-color:transparent">x</span></p>').content[0]).toEqual(p(t('x')));
    expect(doc('<p><span style="font-size:28px">groß</span><span style="font-size:14px">normal</span></p>', 14).content[0]).toEqual(
      p(t('groß', [{ type: 'textStyle', attrs: { fontSize: '2em' } }]), t('normal')),
    );
    expect(doc('<p><span style="font-size:28px">groß</span></p>').content[0]).toEqual(p(t('groß')));
    expect(doc('<p><span style="color:#ff0000;font-size:200px">x</span></p>', 10).content[0]!.content![0]!.marks).toEqual([{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '6em' } }]);
  });

  it('colorizeDoc legt die Farbe nur über Text ohne eigene Farbe', () => {
    const d = colorizeDoc(doc('<p>a<span style="color:#ff0000">b</span><b>c</b></p>'), '#ffffff');
    expect(d.content[0]!.content).toEqual([
      t('a', [{ type: 'textStyle', attrs: { color: '#ffffff' } }]),
      t('b', [{ type: 'textStyle', attrs: { color: '#ff0000' } }]),
      t('c', [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#ffffff' } }]),
    ]);
  });
});

describe('Blöcke', () => {
  it('Listen (auch verschachtelt, ohne End-Tags, Startnummer)', () => {
    expect(doc('<ul><li>a<li>b<ul><li>c</li></ul></ul><ol start="3"><li><p>d</p></li></ol>')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [p(t('a'))] },
            { type: 'listItem', content: [p(t('b')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('c'))] }] }] },
          ],
        },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('d'))] }] },
      ],
    });
  });

  it('Aufgabenlisten (Tiptap-Attribute bzw. Kästchen)', () => {
    const want = {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p(t('ja'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [p(t('nein'))] },
      ],
    };
    expect(doc('<ul data-type="taskList"><li data-checked="true"><p>ja</p></li><li data-checked="false"><p>nein</p></li></ul>').content[0]).toEqual(want);
    expect(doc('<ul><li><input type="checkbox" checked> ja</li><li><input type="checkbox">nein</li></ul>').content[0]).toEqual(want);
  });

  it('Überschriften (h4–h6 → 3), Zitat, Code-Block, Trennlinie, Tabellen als Zeilen', () => {
    expect(doc('<h1>A</h1><h2>B</h2><h5>C</h5><blockquote><p>Z</p></blockquote><pre><code>x = 1\n  y</code></pre><hr><table><tr><th>K</th><td>V</td></tr></table>')).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [t('A')] },
        { type: 'heading', attrs: { level: 2 }, content: [t('B')] },
        { type: 'heading', attrs: { level: 3 }, content: [t('C')] },
        { type: 'blockquote', content: [p(t('Z'))] },
        { type: 'codeBlock', content: [t('x = 1\n  y')] },
        { type: 'horizontalRule' },
        p(t('K', [{ type: 'bold' }]), t(' | '), t('V')),
      ],
    });
  });

  it('Unbekanntes: Tag weg, Text bleibt; script/style/iframe samt Inhalt weg; kaputtes HTML verzeiht', () => {
    expect(doc('<p><foo>a</foo><script>alert(1)</script><style>p{}</style><iframe src="x">i</iframe>b<img src="x" onerror="y">c</p>')).toEqual({ type: 'doc', content: [p(t('abc'))] });
    expect(doc('<p>1 < 2 und <b>fett')).toEqual({ type: 'doc', content: [p(t('1 < 2 und '), t('fett', [{ type: 'bold' }]))] });
    expect(doc('<!-- Kommentar --><p onclick="x">a</p></div></span>')).toEqual({ type: 'doc', content: [p(t('a'))] });
    expect(doc('<div><p>a</p>b</div>')).toEqual({ type: 'doc', content: [p(t('a')), p(t('b'))] });
  });
});

describe('Grenzen', () => {
  it('Text über 20 000 Zeichen wird gekürzt', () => {
    const r = htmlToDoc(`<p>${'x'.repeat(30_000)}</p>`);
    expect(r.truncated).toBe(true);
    expect(r.plain.length).toBe(20_000);
    validDoc(r.doc);
    const many = htmlToDoc(Array.from({ length: 12_000 }, (_, i) => `<p>${i}</p>`).join(''));
    expect(many.truncated).toBe(true);
    expect(many.plain.length).toBeLessThanOrEqual(20_000);
    validDoc(many.doc);
    expect(htmlToDoc('<p>abc</p>', { maxChars: 2 }).plain).toBe('ab');
  });

  it('tief verschachtelte Listen/Zitate werden flach (Tiefe ≤ 64), der Text bleibt', () => {
    const n = 200;
    const r = htmlToDoc(`${'<ul><li>x'.repeat(n)}${'</li></ul>'.repeat(n)}`);
    expect(r.truncated).toBe(true);
    expect(docDepth(r.doc)).toBeLessThanOrEqual(HTML_MAX_DEPTH);
    expect(r.plain.split('\n').length).toBe(n);
    validDoc(r.doc);
    const q = htmlToDoc(`${'<blockquote>'.repeat(300)}tief${'</blockquote>'.repeat(300)}`);
    expect(docDepth(q.doc)).toBeLessThanOrEqual(HTML_MAX_DEPTH);
    expect(q.plain).toBe('tief');
    validDoc(q.doc);
    const spans = htmlToDoc(`<p>${'<span><b>'.repeat(500)}x${'</b></span>'.repeat(500)}</p>`);
    expect(spans.plain).toBe('x');
    validDoc(spans.doc);
  });
});

describe('Klartext wie im Web', () => {
  const samples = [
    '<p>a</p><p>b<br>c</p>',
    '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>',
    '<h1>T</h1><blockquote><p>q</p></blockquote><pre><code>x\ny</code></pre><hr><p></p><p>z</p>',
    '<ul data-type="taskList"><li data-checked="true"><p>t</p></li></ul>',
    'lose <b>Text</b>',
    fs.readFileSync(path.join(HERE, 'fixtures/miro/workshop/docs.json'), 'utf8'),
  ];
  it.each(samples.map((s, i) => [i, s]))('Beispiel %i', (_i, html) => {
    const r = htmlToDoc(html);
    expect(r.plain).toBe(webPlainOf(r.doc as never));
    expect(plainOf(r.doc)).toBe(r.plain);
    validDoc(r.doc);
  });

  it('htmlToPlain für Titel und Kartenfelder', () => {
    expect(htmlToPlain('<p>Bühne für <b>2027</b> buchen</p>')).toBe('Bühne für 2027 buchen');
    expect(htmlToPlain('<p>a</p><p>b</p>')).toBe('a\nb');
  });
});

it('HIGHLIGHT_COLORS = Markierungsfarben der Format-Leiste im Web', () => {
  const src = fs.readFileSync(path.join(HERE, '../../web/src/features/richtext/FormatBar.tsx'), 'utf8');
  const m = /export const HIGHLIGHTS = \[([^\]]+)\]/.exec(src);
  expect(m).toBeTruthy();
  expect([...HIGHLIGHT_COLORS]).toEqual(m![1]!.split(',').map((s) => s.trim().replace(/'/g, '')));
});
