// Referenzwerte für das Einfügen von HTML beim Schreiben (Paritäts-Audit F16): der echte Rich-Text-Editor der Web-App
// (Tiptap mit `richExtensions()`, also `cleanPastedHtml` aus features/richtext/paste.ts und ProseMirrors Einfügen) im
// Chromium. Je Fall: Ausgangstext, Auswahl, eingefügtes HTML (Word, Google Docs, Browser) → Dokument danach und
// Schreibmarke. Der Web-Code wird mit esbuild gebündelt und in die Seite geladen – nichts wird nachgebaut.
// Schreibt docs/native_fixtures/web/paste.json; die App vergleicht ihre Portierung damit
// (packages/stachel_board/test/rest/paste_web_reference_test.dart, liest die Datei direkt).
// Aufruf (Web-App unter <url>, z. B. Sandbox):
//   server/node_modules/.bin/tsx tools/native-paste-fixtures.mts http://127.0.0.1:8790
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore – esbuild liegt in server/node_modules (Server-Build)
import { build } from '../server/node_modules/esbuild/lib/main.js';
// @ts-ignore – Playwright liegt in web/node_modules (E2E der Web-App)
import { chromium } from '../web/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:8600';
const out = path.join(ROOT, 'docs/native_fixtures/web/paste.json');

const bundle = await build({
  stdin: {
    contents: `import { Editor } from '@tiptap/core';
      import { TextSelection } from '@tiptap/pm/state';
      import { richExtensions } from './extensions';
      (window as any).__paste = { Editor, TextSelection, richExtensions };`,
    resolveDir: path.join(ROOT, 'web/src/features/richtext'),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const p = (...content: unknown[]) => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

/** Ausgangsdokumente; Auswahl als Offsets im Klartext (Blöcke mit \n verbunden, wie RichEditDoc.text) */
const START: Record<string, { doc: unknown; sel: [number, number] }> = {
  empty: { doc: doc(p()), sel: [0, 0] },
  middle: { doc: doc(p(t('AnfangEnde'))), sel: [6, 6] },
  replace: { doc: doc(p(t('A Mitte B'))), sel: [2, 7] },
  end: { doc: doc(p(t('Erste Zeile')), p(t('Zweite'))), sel: [18, 18] },
  bold: { doc: doc(p(t('fett', [{ type: 'bold' }]))), sel: [2, 2] },
  list: {
    doc: doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Punkt'))] }] }),
    sel: [5, 5],
  },
  heading: { doc: doc({ type: 'heading', attrs: { level: 2 }, content: [t('Titel')] }), sel: [5, 5] },
  quote: { doc: doc({ type: 'blockquote', content: [p(t('Zitattext'))] }), sel: [5, 5] },
  code: { doc: doc({ type: 'codeBlock', attrs: { language: null }, content: [t('abcdef')] }), sel: [3, 3] },
  olMid: {
    doc: doc({
      type: 'orderedList',
      attrs: { start: 1, type: null },
      content: [
        { type: 'listItem', content: [p(t('Erstes'))] },
        { type: 'listItem', content: [p(t('Zweites'))] },
      ],
    }),
    sel: [3, 3],
  },
  multi: { doc: doc(p(t('Erste Zeile')), p(t('Zweite Zeile')), p(t('Dritte'))), sel: [6, 19] },
  all: { doc: doc(p(t('Alles weg')), p(t('bleibt'))), sel: [0, 9] },
  emptyItem: {
    doc: doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Eins'))] }, { type: 'listItem', content: [p()] }] }),
    sel: [5, 5],
  },
  task: {
    doc: doc({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p(t('Aufgabe'))] }] }),
    sel: [7, 7],
  },
  between: { doc: doc(p(t('Oben')), p(t('Unten'))), sel: [4, 4] },
};

const WORD_HEAD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>p.MsoNormal{margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif;}</style></head><body lang=DE><!--StartFragment-->`;
const WORD_TAIL = `<!--EndFragment--></body></html>`;
const HTML: Record<string, string> = {
  inline: 'Hallo <b>Welt</b> und <i>mehr</i>',
  twoParas: '<p>Erster Absatz</p><p>Zweiter <strong>Absatz</strong></p>',
  whitespace: '<p>  viel   Raum  </p>\n<p>\n danach </p>',
  br: '<p>Zeile<br>neue Zeile</p>',
  headings: '<h1>Eins</h1><h5>Fünf</h5><p>Text</p>',
  links: '<p><a href="https://example.org/x">gut</a> <a href="javascript:alert(1)">böse</a> <a href="www.beispiel.de">ohne</a></p>',
  dropped: '<p>A<script>alert(1)</script><img src="x.png">B<style>p{}</style></p><iframe src="x"></iframe><p>C</p>',
  googleDocs:
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:700;">Fett</span><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400;"> normal </span><span style="font-size:11pt;font-family:Arial;color:#000000;font-style:italic;">kursiv</span><span style="font-size:11pt;color:#000000;text-decoration:line-through;"> weg</span></b>',
  colors:
    '<p><span style="color: rgb(236, 78, 146)">pink</span> <span style="color:red">rot</span> <span style="color:#000000">schwarz</span> <font color="blue">alt</font></p>',
  highlight: '<p><mark>gelb</mark> <span style="background-color:#c9e14a">grün</span> <span style="background:#ffffff">weiß</span></p>',
  sizes: '<p>klein <span style="font-size:24px">groß</span> <span style="font-size:8pt">winzig</span> <span style="font-size:1em">gleich</span></p>',
  wordList:
    WORD_HEAD +
    `<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Erster Punkt</p>
<p class=MsoListParagraphCxSpMiddle style='text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New"'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Unterpunkt</p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Zweiter Punkt</p>` +
    WORD_TAIL,
  wordNumbered:
    WORD_HEAD +
    `<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Eins</p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Zwei</p>` +
    WORD_TAIL,
  wordHighlight:
    WORD_HEAD +
    `<p class=MsoNormal>Normal <span style='background:yellow;mso-highlight:yellow'>markiert</span> und <span style='font-size:16.0pt'>größer</span> <b>fett</b></p>` +
    WORD_TAIL,
  lists: '<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol start="3"><li>drei</li></ol>',
  tasks: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>erledigt</p></li><li data-type="taskItem" data-checked="false"><p>offen</p></li></ul>',
  blocks: '<blockquote><p>Zitat</p></blockquote><pre><code>x = 1\ny = 2</code></pre><hr><p>danach</p>',
  table: '<table><tr><th>Name</th><th>Wer</th></tr><tr><td>Bar</td><td>Mara</td></tr></table>',
  divs: '<div>Erste</div><div>Zweite <em>mit</em> Text</div>',
  code: '<p>Das ist <code>code()</code> und <u>unterstrichen</u> <s>weg</s> <sub>tief</sub></p>',
  entities: '<p>&lt;b&gt; &amp; &quot;x&quot; &nbsp;Abstand</p>',
  nested: '<p><a href="https://a.de"><b>fetter Link</b></a> <b><code>c()</code></b> <i><u>beides</u></i></p>',
  hrOnly: '<hr>',
  pAndHr: '<p>vor</p><hr>',
  tab: '<p>a\tb   c</p>',
  spanNested: '<span style="color:red">rot <span style="color:blue">blau</span> wieder</span>',
  wordBold:
    WORD_HEAD +
    `<p class=MsoNormal><b><span style='font-size:14.0pt'>Fett</span></b><span style='font-size:14.0pt'> und <i>kursiv</i><o:p></o:p></span></p>` +
    WORD_TAIL,
  brEnd: '<p>Ende<br></p><p>x</p>',
  liText: '<li>a</li><li>b</li>',
  h4: '<h4>Vier</h4><h6>Sechs</h6>',
  styledDiv: '<div style="font-weight:bold">Div fett</div><div style="font-style:italic;text-decoration:underline line-through">Div</div>',
  plainLines: 'eins<br>zwei<br><br>drei',
};

/** Fälle: Ausgangslage × HTML × Variante (sticky: ohne Teil-Größen, text: mit) */
const CASES: { start: string; html: string; variant: string }[] = [];
for (const html of Object.keys(HTML)) {
  CASES.push({ start: 'empty', html, variant: 'sticky' });
  CASES.push({ start: 'middle', html, variant: 'text' });
}
for (const start of ['replace', 'end', 'bold', 'list', 'heading'])
  for (const html of ['inline', 'twoParas', 'headings', 'lists', 'wordList', 'googleDocs', 'blocks', 'br'])
    CASES.push({ start, html, variant: 'sticky' });
for (const html of ['sizes', 'wordHighlight', 'googleDocs', 'colors']) CASES.push({ start: 'empty', html, variant: 'text' });
for (const start of ['quote', 'code', 'olMid', 'multi', 'all', 'emptyItem', 'task', 'between'])
  for (const html of ['inline', 'twoParas', 'lists', 'tasks', 'blocks', 'headings', 'hrOnly', 'pAndHr', 'wordList', 'liText'])
    CASES.push({ start, html, variant: 'sticky' });

const browser = await chromium.launch();
// die Seite verbietet Inline-Skripte (CSP); für das gebündelte Web-Modul hier ausgesetzt
const page = await browser.newPage({ bypassCSP: true });
await page.goto(`${url}/?offline=1`);
await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
// als Text übergeben: tsx/esbuild würde in eine Funktion Hilfsaufrufe (__name) einbauen, die es im Browser nicht gibt
const RUN = `({ cases, starts, htmls }) => {
  const { Editor, TextSelection, richExtensions } = window.__paste;
  // Klartext-Offset (Blöcke mit \\n verbunden) → ProseMirror-Position
  const blocksOf = (doc) => { const out = []; doc.descendants((n, pos) => { if (n.isTextblock) { out.push({ pos: pos + 1, n }); return false; } return true; }); return out; };
  const toPos = (doc, off) => {
    let at = 0;
    for (const b of blocksOf(doc)) {
      const len = b.n.textContent.length + countBreaks(b.n);
      if (off <= at + len) return b.pos + (off - at);
      at += len + 1;
    }
    return doc.content.size - 1;
  };
  const countBreaks = (n) => { let k = 0; n.forEach((c) => { if (c.type.name === 'hardBreak') k++; }); return k; };
  const toOff = (doc, pos) => {
    let at = 0;
    for (const b of blocksOf(doc)) {
      const len = b.n.content.size;
      if (pos <= b.pos + len) return at + Math.max(0, pos - b.pos);
      at += len + 1;
    }
    // hinter dem letzten Textblock (z. B. eine Trennlinie ist ausgewählt): Ende des Texts
    return Math.max(0, at - 1);
  };
  const out = [];
  for (const c of cases) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const s = starts[c.start];
    const editor = new Editor({ element: el, extensions: richExtensions(), content: s.doc, editorProps: { attributes: { 'data-variant': c.variant } } });
    const d = editor.state.doc;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(d, toPos(d, s.sel[0]), toPos(d, s.sel[1]))));
    editor.view.pasteHTML(htmls[c.html]);
    const after = editor.state;
    out.push({ ...c, html: htmls[c.html], htmlId: c.html, doc: s.doc, sel: s.sel, result: editor.getJSON(), caret: toOff(after.doc, after.selection.head) });
    editor.destroy();
    el.remove();
  }
  return out;
}`;
const cases = await page.evaluate(`(${RUN})(${JSON.stringify({ cases: CASES, starts: START, htmls: HTML })})`);
await browser.close();

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ about: 'HTML einfügen im Rich-Text-Editor (Tiptap, pasteHTML) – tools/native-paste-fixtures.mts', cases }, null, 1) + '\n');
console.log(`${(cases as unknown[]).length} Fälle → ${path.relative(ROOT, out)}`);
