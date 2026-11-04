// Test-Boards für die Native-API: ein Board mit allen Objekttypen (alle Formen, Verbinder-Varianten, Rich-Text mit allen
// Knoten/Marks, Tabelle, Zeitleiste, PDF-Dokument, Mindmap, Karte, Sticker, Icon, Stift, Bild, Rahmen, unbekannter Typ)
// und große Boards (2 000 / 5 000 gemischte Objekte, deterministisch). Schreibt direkt ins Y.Doc im Format der Web-App
// (docs/contract.md §4, docs/features/*.md) – genutzt von server/test/native-*.test.ts, tools/native-fixtures.mts und
// tools/sandbox.mts --seed. Nur `yjs` aus server/node_modules (eine Yjs-Instanz mit dem Provider).
import * as Y from 'yjs';

/** Für tools/*.mts (ohne eigene Pakete): dieselbe Yjs-Instanz wie Provider und Seed. */
export { Y };

export const SHAPE_KINDS = [
  'rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star', 'parallelogram', 'trapezoid',
  'cylinder', 'cloud', 'callout', 'arrowRight', 'arrowLeft', 'arrowDouble', 'arrowUp', 'arrowDown', 'chevron', 'cross',
  'braceLeft', 'braceRight', 'terminator', 'document', 'predefined', 'manualInput', 'delay', 'pentagonArrow', 'heart',
  'manualOperation', 'offPage', 'merge', 'card', 'sort', 'multiDocument', 'display', 'storedData', 'internalStorage', 'summing', 'or',
] as const;

// ---- Rich-Text (y-prosemirror-Format) -------------------------------------------------------------------------------

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}
export interface PMDoc {
  type: 'doc';
  content: PMNode[];
}

/** Wie richtext/doc.ts buildChildren: benachbarte Texte → ein Y.XmlText mit Marks als Formatierung. */
function children(nodes: PMNode[] | undefined): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  let run: { insert: string; attributes?: Record<string, unknown> }[] = [];
  const flush = () => {
    if (!run.length) return;
    const t = new Y.XmlText();
    t.applyDelta(run);
    out.push(t);
    run = [];
  };
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      const attrs = n.marks?.length ? Object.fromEntries(n.marks.map((m) => [m.type, m.attrs ?? {}])) : undefined;
      run.push(attrs ? { insert: n.text ?? '', attributes: attrs } : { insert: n.text ?? '' });
      continue;
    }
    flush();
    const el = new Y.XmlElement(n.type);
    for (const [k, v] of Object.entries(n.attrs ?? {})) el.setAttribute(k, v as string);
    const kids = children(n.content);
    if (kids.length) el.insert(0, kids);
    out.push(el);
  }
  flush();
  return out;
}

export function fragment(doc: PMDoc): Y.XmlFragment {
  const f = new Y.XmlFragment();
  const kids = children(doc.content);
  if (kids.length) f.insert(0, kids);
  return f;
}

/** Klartext wie plainOf (richtext/doc.ts): Textblöcke mit \n, hardBreak = \n. */
export function plain(doc: PMDoc): string {
  const lines: string[] = [];
  const inline = (n: PMNode) => n.type === 'text' || n.type === 'hardBreak';
  const walk = (n: PMNode) => {
    const kids = n.content ?? [];
    if (kids.length ? kids.every(inline) : ['paragraph', 'heading', 'codeBlock'].includes(n.type)) {
      lines.push(kids.map((k) => (k.type === 'hardBreak' ? '\n' : (k.text ?? ''))).join(''));
      return;
    }
    kids.forEach(walk);
  };
  doc.content.forEach(walk);
  return lines.join('\n');
}

const t = (text: string, ...marks: { type: string; attrs?: Record<string, unknown> }[]): PMNode => (marks.length ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });

/** Rich-Text mit allen Knoten und Marks aus RICH_TEXT_NODES/RICH_TEXT_MARKS (+ horizontalRule). */
export const RICH_ALL: PMDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Ablauf Samstag')] },
    { type: 'heading', attrs: { level: 2 }, content: [t('Bühne')] },
    { type: 'heading', attrs: { level: 3 }, content: [t('Technik')] },
    p(
      t('fett', { type: 'bold' }),
      t(' '),
      t('kursiv', { type: 'italic' }),
      t(' '),
      t('durch', { type: 'strike' }),
      t(' '),
      t('unter', { type: 'underline' }),
      t(' '),
      t('code', { type: 'code' }),
      t(' '),
      t('Link', { type: 'link', attrs: { href: 'https://example.org' } }),
      t(' '),
      t('markiert', { type: 'highlight', attrs: { color: '#c9e14a' } }),
      t(' '),
      t('pink', { type: 'textStyle', attrs: { color: '#ec4e92' } }),
    ),
    { type: 'paragraph', content: [t('Zeile 1'), { type: 'hardBreak' }, t('Zeile 2')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Punkt A'))] }, { type: 'listItem', content: [p(t('Punkt B'))] }] },
    { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [p(t('Erstens'))] }, { type: 'listItem', content: [p(t('Zweitens'))] }] },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p(t('Zelte bestellt'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [p(t('Strom klären'))] },
      ],
    },
    { type: 'blockquote', content: [p(t('Zitat'))] },
    { type: 'codeBlock', content: [t('npm run build')] },
    { type: 'horizontalRule' },
    { type: 'paragraph' },
  ],
};

export const richText = (s: string): PMDoc => ({ type: 'doc', content: s.split('\n').map((line) => (line ? p(t(line)) : { type: 'paragraph' })) });

// ---- Objekte schreiben ----------------------------------------------------------------------------------------------

type Fields = Record<string, unknown>;

function put(objects: Y.Map<Y.Map<unknown>>, id: string, fields: Fields) {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ id, createdBy: 'a:seed', updatedAt: '2026-11-01T12:00:00.000Z', ...fields })) {
    if (v === undefined) continue;
    if (k === 'content' && v && typeof v === 'object' && (v as PMDoc).type === 'doc') m.set(k, fragment(v as PMDoc));
    else m.set(k, v);
  }
  objects.set(id, m);
  return m;
}

/** Gleichmäßige Ebenen-Schlüssel (fractional-indexing-kompatibel genug zum Sortieren). */
const zKey = (i: number) => `a${i.toString(36).padStart(4, '0')}`;

export interface SeedImages {
  photo: string;
  page0: string;
  page1: string;
  pdf?: string;
}

/** Board mit allen Objekttypen; liefert die IDs nach Rolle (für Tests). */
export function seedAllTypes(doc: Y.Doc, img: SeedImages = { photo: 'img_photo', page0: 'img_page0', page1: 'img_page1', pdf: 'pdf_file' }) {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let z = 0;
  const nz = () => zKey(++z);
  doc.transact(() => {
    put(objects, 'frame1', { type: 'frame', x: -100, y: -200, w: 2600, h: 1900, z: nz(), title: 'Sommerfest', color: '#ffffff', frameGrid: 50, frameGridLabels: true, slide: 'a0' });
    put(objects, 'sticky_rich', {
      type: 'sticky', x: 0, y: 0, w: 260, h: 260, z: nz(), color: '#fff27a', text: plain(RICH_ALL), content: RICH_ALL, align: 'left', valign: 'top',
      tags: [{ label: 'Wichtig', color: '#ec4e92' }, { label: 'Technik', color: '#1763b5' }],
    });
    put(objects, 'sticky_rect', { type: 'sticky', x: 300, y: 0, w: 350, h: 200, z: nz(), color: '#c9e14a', text: 'Rechteckige Notiz', fontSize: 28, bold: true, rotation: 4, fontFamily: 'serif' });
    put(objects, 'sticky_old', { type: 'sticky', x: 680, y: 0, w: 200, h: 200, z: nz(), color: '#9fd3ff', text: 'Nur Klartext (alter Client)' });
    put(objects, 'text_auto', { type: 'text', x: 0, y: -120, w: 420, h: 60, z: nz(), color: '#0a0a0a', fontSize: 48, autoWidth: true, text: 'Überschrift', content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [t('Überschrift')] }] } });
    put(objects, 'text_fixed', { type: 'text', x: 460, y: -120, w: 300, h: 80, z: nz(), color: '#1763b5', fontSize: 20, italic: true, strike: true, align: 'right', text: 'Fester Text mit Umbruch über mehrere Zeilen' });
    SHAPE_KINDS.forEach((kind, i) => {
      put(objects, `shape_${kind}`, {
        type: 'shape', shape: kind, x: (i % 9) * 200, y: 300 + Math.floor(i / 9) * 150, w: 160, h: 110, z: nz(),
        color: i % 3 === 0 ? '#ffffff' : '#ffd08a', stroke: '#0a0a0a', strokeWidth: i % 4 === 0 ? 0 : 2, fontSize: 18, text: kind,
        ...(i % 5 === 0 ? { dash: 'dashed' } : {}), ...(i % 7 === 0 ? { fillOpacity: 0.5 } : {}), ...(i === 1 ? { valign: 'bottom', rotation: 15 } : {}),
      });
    });
    const conn = (id: string, f: Fields) => put(objects, id, { type: 'connector', x: 0, y: 0, w: 1, h: 1, z: nz(), color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, ...f });
    conn('conn_straight', { from: { objectId: 'sticky_rich' }, to: { objectId: 'sticky_rect' } });
    conn('conn_elbow', { from: { objectId: 'sticky_rect', side: 'e' }, to: { objectId: 'sticky_old', side: 'w' }, lineStyle: 'elbow', dash: 'dashed', capEnd: 'arrow' });
    conn('conn_curved', {
      from: { objectId: 'shape_rect', side: 's' }, to: { objectId: 'shape_ellipse' }, lineStyle: 'curved', arrowStart: true, capStart: 'circle', color: '#ec4e92', strokeWidth: 4,
      text: 'Weg zur Bühne', content: richText('Weg zur Bühne'), labelPos: 0.3,
    });
    conn('conn_free', { from: { x: 1900, y: 0 }, to: { x: 2200, y: 150 }, dash: 'dotted', arrowEnd: false });
    put(objects, 'pen1', { type: 'pen', x: 1900, y: 300, w: 200, h: 80, z: nz(), color: '#1763b5', strokeWidth: 4, points: [0, 0, 50, 40, 100, 10, 150, 70, 200, 30] });
    put(objects, 'marker1', { type: 'pen', x: 1900, y: 420, w: 200, h: 20, z: nz(), color: '#c9e14a', strokeWidth: 16, marker: true, points: [0, 10, 200, 10] });
    put(objects, 'image1', { type: 'image', x: 1900, y: 500, w: 320, h: 240, z: nz(), imageId: img.photo, color: '#7a9a3c', rotation: -3 });
    put(objects, 'sticker_emoji', { type: 'sticker', x: 2250, y: 300, w: 64, h: 64, z: nz(), emoji: '🌵' });
    put(objects, 'sticker_stamp', { type: 'sticker', x: 2330, y: 300, w: 96, h: 96, z: nz(), stamp: 'like' });
    put(objects, 'icon1', {
      type: 'icon', x: 2250, y: 420, w: 48, h: 48, z: nz(), color: '#0a0a0a', icon: 'tent',
      iconNode: [['path', { d: 'M3.5 21 14 3' }], ['path', { d: 'M20.5 21 10 3' }], ['path', { d: 'M15.5 21 12 15l-3.5 6' }], ['path', { d: 'M2 21h20' }]],
    });
    const card = put(objects, 'card1', {
      type: 'card', x: 0, y: 1300, w: 300, h: 160, z: nz(), text: 'Bühne aufbauen', color: '#1763b5', status: 'doing', due: '2027-06-12',
      tags: [{ label: 'Aufbau', color: '#2b8a3e' }], assignee: { key: 'm:7', name: 'Jonas' },
    });
    card.set('desc', new Y.Text('Freitag ab 14 Uhr, mit Lena und Mara'));
    const table = put(objects, 'table1', { type: 'table', x: 350, y: 1300, w: 480, h: 150, z: nz(), color: '#0a0a0a', tableHead: 'both' });
    const ty = new Y.Map<unknown>();
    const rows = new Y.Array<string>();
    rows.push(['r1', 'r2', 'r3']);
    const cols = new Y.Array<string>();
    cols.push(['c1', 'c2', 'c3']);
    const cells = new Y.Map<unknown>();
    cells.set('r1:c1', 'Was');
    cells.set('r1:c2', 'Wer');
    cells.set('r1:c3', 'Wann');
    cells.set('r2:c1', new Y.Text('Zelte'));
    cells.set('r2:c2', 'Mara');
    cells.set('r2:c3', 'Fr');
    cells.set('r3:c1', 'Strom');
    const widths = new Y.Map<number>();
    widths.set('c1', 2);
    ty.set('rows', rows);
    ty.set('cols', cols);
    ty.set('cells', cells);
    ty.set('widths', widths);
    table.set('table', ty);
    put(objects, 'mind_root', { type: 'mindnode', x: 900, y: 1300, w: 160, h: 60, z: nz(), text: 'Festival', color: '#1763b5', mind: { level: 0 } });
    put(objects, 'mind_a', { type: 'mindnode', x: 1120, y: 1250, w: 140, h: 44, z: nz(), text: 'Musik', color: '#1763b5', mind: { parent: 'mind_root', order: 0, side: 'r', level: 1 } });
    put(objects, 'mind_b', { type: 'mindnode', x: 700, y: 1350, w: 140, h: 44, z: nz(), text: 'Essen', color: '#ec4e92', mind: { parent: 'mind_root', order: 1, side: 'l', level: 1, collapsed: true } });
    conn('conn_mind', { from: { objectId: 'mind_root' }, to: { objectId: 'mind_a' }, lineStyle: 'curved', arrowEnd: false });
    const tl = put(objects, 'timeline1', { type: 'timeline', x: 0, y: 1550, w: 1200, h: 220, z: nz(), tlStart: '2027-06-01', tlEnd: '2027-06-30', tlUnit: 'week' });
    const tly = new Y.Map<unknown>();
    const lanes = new Y.Array<string>();
    lanes.push(['l1', 'l2']);
    const names = new Y.Map<unknown>();
    names.set('l1', new Y.Text('Aufbau'));
    names.set('l2', new Y.Text('Programm'));
    const items = new Y.Map<Y.Map<unknown>>();
    const item = (key: string, f: Fields, title: string) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(f)) m.set(k, v);
      m.set('title', new Y.Text(title));
      items.set(key, m);
    };
    item('i1', { lane: 'l1', start: '2027-06-08', end: '2027-06-11', color: '#2b8a3e' }, 'Zelte');
    item('i2', { lane: 'l2', start: '2027-06-12', end: '2027-06-12', ms: true }, 'Eröffnung');
    tly.set('lanes', lanes);
    tly.set('names', names);
    tly.set('items', items);
    tl.set('timeline', tly);
    const pdf = put(objects, 'doc1', {
      type: 'document', x: 1300, y: 1300, w: 300, h: 424, z: nz(), docFile: img.pdf, docName: 'Lageplan 2027.pdf', docCount: 2, docPage: 0,
      imageId: img.page0, docRatios: [0.707, 1.414],
    });
    const pages = new Y.Map<string>();
    pages.set('0', img.page0);
    pages.set('1', img.page1);
    pdf.set('docPages', pages);
    // Gruppe, gesperrt, ausgeblendet, Link
    put(objects, 'group_a', { type: 'sticky', x: 1700, y: 1300, w: 120, h: 120, z: nz(), color: '#ffb3d1', text: 'A', groupId: 'g1', locked: true });
    put(objects, 'group_b', { type: 'sticky', x: 1830, y: 1300, w: 120, h: 120, z: nz(), color: '#ffb3d1', text: 'B', groupId: 'g1', linkTo: 'frame1' });
    put(objects, 'hidden1', { type: 'shape', shape: 'rect', x: 1700, y: 1450, w: 100, h: 60, z: nz(), color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: '', hidden: true });
    // unbekannter Typ (neues Web-Feature, App noch alt): muss unverändert durchkommen
    put(objects, 'future1', { type: 'future.widget', x: 2000, y: 1300, w: 240, h: 160, z: nz(), 'future.payload': { level: 3, items: ['a', 'b'] }, color: '#e2d5ff' });
    // Feature-Strukturen: Kommentar und Reaktion
    const comments = doc.getMap<Y.Map<unknown>>('collab.comments');
    const th = new Y.Map<unknown>();
    const msgs = new Y.Array<unknown>();
    msgs.push([{ id: 'm1', by: 'm:7', name: 'Jonas', text: '@Mara passt das so?', at: '2026-11-01T12:00:00.000Z', mentions: ['m:12'] }]);
    th.set('id', 't1');
    th.set('x', 260);
    th.set('y', 0);
    th.set('objectId', 'sticky_rich');
    th.set('dx', 260);
    th.set('dy', 0);
    th.set('resolved', false);
    th.set('createdBy', 'm:7');
    th.set('createdAt', '2026-11-01T12:00:00.000Z');
    th.set('messages', msgs);
    comments.set('t1', th);
    doc.getMap('collab.reactions').set('sticky_rich|👍|m:7', { o: 'sticky_rich', e: '👍', u: 'm:7', n: 'Jonas', at: '2026-11-01T12:01:00.000Z' });
  });
  return { objects };
}

// ---- Große Boards -----------------------------------------------------------------------------------------------------

/** Kleiner deterministischer Zufall (mulberry32), damit große Boards überall gleich aussehen. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff', '#ffffff'];

/**
 * Großes Board wie web/e2e/perf-scale.spec.ts: n gemischte Objekte (≈ 50 % Haftnotizen, 20 % Formen, 10 % Text,
 * 10 % Verbinder, 5 % Stift, 5 % Karten) in einem Raster, Rahmen je 400 Objekte. Deterministisch (seed).
 */
export function seedBig(doc: Y.Doc, n: number, seed = 1) {
  const r = rng(seed);
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const cols = Math.ceil(Math.sqrt(n));
  const ids: string[] = [];
  doc.transact(() => {
    for (let f = 0; f * 400 < n; f++) {
      const x0 = (f % 4) * 20 * 260;
      const y0 = Math.floor(f / 4) * 20 * 260;
      put(objects, `f${f}`, { type: 'frame', x: x0 - 40, y: y0 - 80, w: 20 * 260 + 40, h: 20 * 260 + 40, z: zKey(0), title: `Bereich ${f + 1}`, color: '#ffffff' });
    }
    for (let i = 0; i < n; i++) {
      const x = (i % cols) * 260;
      const y = Math.floor(i / cols) * 260;
      const id = `o${i}`;
      const k = r();
      const z = zKey(i + 1);
      if (k < 0.5) {
        put(objects, id, { type: 'sticky', x, y, w: 200, h: 200, z, color: COLORS[Math.floor(r() * COLORS.length)], text: `Notiz ${i}` });
      } else if (k < 0.7) {
        put(objects, id, { type: 'shape', shape: SHAPE_KINDS[Math.floor(r() * SHAPE_KINDS.length)], x, y, w: 200, h: 140, z, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, fontSize: 20, text: `Form ${i}` });
      } else if (k < 0.8) {
        put(objects, id, { type: 'text', x, y, w: 220, h: 40, z, color: '#0a0a0a', fontSize: 24, text: `Text ${i}`, autoWidth: true });
      } else if (k < 0.9 && ids.length > 1) {
        const a = ids[Math.floor(r() * ids.length)]!;
        const b = ids[Math.floor(r() * ids.length)]!;
        if (a !== b) {
          put(objects, id, { type: 'connector', x: 0, y: 0, w: 1, h: 1, z, from: { objectId: a }, to: { objectId: b }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, lineStyle: r() < 0.5 ? 'curved' : 'straight' });
          continue;
        }
        put(objects, id, { type: 'sticky', x, y, w: 200, h: 200, z, color: COLORS[0], text: `Notiz ${i}` });
      } else if (k < 0.95) {
        const pts: number[] = [];
        for (let j = 0; j < 20; j++) pts.push(j * 10, Math.round(r() * 80));
        put(objects, id, { type: 'pen', x, y, w: 190, h: 80, z, color: '#1763b5', strokeWidth: 3, points: pts });
      } else {
        put(objects, id, { type: 'card', x, y, w: 220, h: 120, z, text: `Aufgabe ${i}`, color: '#1763b5', status: 'todo' });
      }
      ids.push(id);
    }
  });
  return { count: objects.size };
}
