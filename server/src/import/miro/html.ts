// Miro-HTML → ProseMirror-JSON (Tiptap-Knoten wie RICH_TEXT_NODES/RICH_TEXT_MARKS), docs/import_miro_konzept.md §2.5.
// Kleiner eigener Parser für die Teilmenge, die Miro liefert (Haftnotiz `p a strong b em i u s br`, Form/Text zusätzlich
// `span ol ul li`, Miro-Docs Überschriften, Aufgabenlisten, Zitate, Code). Kein DOM, keine Abhängigkeit.
// Regeln: Entities dekodiert, Zero-Width-Zeichen entfernt, Links nur http/https/mailto, höchstens 20 000 Zeichen
// Klartext und 64 Ebenen (Vertrag §8.6) – mehr wird gekürzt bzw. flach gemacht und als `truncated` gemeldet.
import { HIGHLIGHT_COLORS, hex6, nearestColor, parseColor } from './colors.js';

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}
export interface PMDoc {
  type: 'doc';
  content: PMNode[];
}

export interface HtmlOptions {
  /** Schriftgröße des Objekts: Teilgrößen (`font-size`) werden relativ dazu `textStyle.fontSize: "<n>em"`; fehlt = sie fallen weg (Haftnotiz, Beschriftung) */
  baseFontSize?: number;
  /** Klartext-Grenze (Standard 20 000) */
  maxChars?: number;
}

export interface HtmlResult {
  doc: PMDoc;
  /** Klartext-Spiegel (wie `plainOf` im Web) */
  plain: string;
  /** Text gekürzt bzw. zu tiefe Verschachtelung flach gemacht */
  truncated: boolean;
}

export const HTML_MAX_CHARS = 20_000;
/** Tiefe eines Rich-Text-Dokuments (validate.ts MAX_DOC_DEPTH) */
export const HTML_MAX_DEPTH = 64;
/** größtes Rich-Text-Dokument als JSON (validate.ts MAX_OBJECT_JSON 256 KiB, mit Luft für die übrigen Felder) */
export const HTML_MAX_JSON = 200_000;
/** so tief dürfen Listen verschachtelt sein (je Ebene Liste + Eintrag + Absatz + Text + Marks) */
const MAX_LIST_LEVEL = 12;

// ---- Entities --------------------------------------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', shy: '\u00ad', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
  times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', ecirc: 'ê',
  aacute: 'á', agrave: 'à', acirc: 'â', oacute: 'ó', ograve: 'ò', ocirc: 'ô', uacute: 'ú', ugrave: 'ù', ucirc: 'û',
  iacute: 'í', igrave: 'ì', icirc: 'î', ccedil: 'ç', ntilde: 'ñ', Eacute: 'É', larr: '←', rarr: '→', uarr: '↑',
  darr: '↓', harr: '↔', check: '✓', zwsp: '\u200b', zwnj: '\u200c', zwj: '\u200d', ensp: '\u2002', emsp: '\u2003',
  thinsp: '\u2009',
};

/** Zero-Width- und Steuerzeichen, die im Text nichts verloren haben (Tab und Zeilenumbruch bleiben) */
const INVISIBLE_RE = /[\u200b\u200c\u200d\u2060\ufeff\u00ad\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** HTML-Entities dekodieren und unsichtbare Zeichen entfernen. */
export function decodeEntities(s: string): string {
  const out = s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
      return String.fromCodePoint(code);
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
  return out.replace(INVISIBLE_RE, '');
}

// ---- Tokenizer + Baum ------------------------------------------------------------------------------------------------

interface HElement {
  tag: string;
  attrs: Record<string, string>;
  children: HNode[];
}
type HNode = HElement | string;

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'area', 'base', 'embed', 'source', 'track', 'param']);
/** samt Inhalt verwerfen */
const DROP = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'textarea', 'select', 'button', 'canvas', 'video', 'audio']);

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = m[1]!.toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** HTML in einen schlichten Baum (verzeiht fehlende End-Tags; tiefer als HTML_MAX_DEPTH wird flach). */
function parseHtml(html: string): HElement {
  const root: HElement = { tag: '#root', attrs: {}, children: [] };
  const stack: HElement[] = [root];
  const top = () => stack[stack.length - 1]!;
  let i = 0;
  let flattened = false;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      top().children.push(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(html.slice(i, lt)));
    i = lt;
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const c = html[i + 1];
    if (c === '!' || c === '?') {
      const end = html.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(i, i + 4096));
    if (!m) {
      // kein Tag: „<“ als Text
      top().children.push('<');
      i += 1;
      continue;
    }
    i += m[0].length;
    const tag = m[2]!.toLowerCase();
    if (m[1]) {
      // End-Tag: bis zum passenden offenen Element schließen, sonst ignorieren
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    if (DROP.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i);
      if (end < 0) i = n;
      else {
        const gt = html.indexOf('>', end);
        i = gt < 0 ? n : gt + 1;
      }
      continue;
    }
    const attrs = parseAttrs(m[3] ?? '');
    // implizit schließen wie im Browser: <p> in <p>, <li> neben <li>
    if (tag === 'p' && top().tag === 'p') stack.pop();
    if (tag === 'li') {
      for (let k = stack.length - 1; k > 0; k--) {
        const t = stack[k]!.tag;
        if (t === 'ul' || t === 'ol') break;
        if (t === 'li') {
          stack.length = k;
          break;
        }
      }
    }
    const el: HElement = { tag, attrs, children: [] };
    if (stack.length > HTML_MAX_DEPTH) {
      flattened = true;
      if (tag === 'br') top().children.push(el);
      continue;
    }
    top().children.push(el);
    if (!VOID.has(tag) && !m[3]?.trimEnd().endsWith('/')) stack.push(el);
  }
  if (flattened) root.attrs['data-flattened'] = '1';
  return root;
}

// ---- Baum → ProseMirror ----------------------------------------------------------------------------------------------

const BLOCK = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'body', 'html',
  'dl', 'dt', 'dd', 'address', 'details', 'summary',
]);

const SAFE_LINK_RE = /^(https?:|mailto:)/i;

/** Sicheres Link-Ziel oder undefined (nur http, https, mailto). */
export function safeHref(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(INVISIBLE_RE, '');
  if (!s || /\s/.test(s.replace(/ /g, '%20')) || s.length > 2048) return undefined;
  if (!SAFE_LINK_RE.test(s)) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return undefined;
  } catch {
    return undefined;
  }
  return s;
}

/** Link-Mark mit den Attributen der Tiptap-Erweiterung (wie Strg K im Web). */
export const linkMark = (href: string): PMMark => ({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } });

function styleMap(style: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (style ?? '').split(';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    m.set(part.slice(0, k).trim().toLowerCase(), part.slice(k + 1).trim());
  }
  return m;
}

/** Marks um eine Mark ergänzen (textStyle: Attribute zusammenführen, sonst ersetzen). */
function withMark(marks: PMMark[], mark: PMMark): PMMark[] {
  const i = marks.findIndex((x) => x.type === mark.type);
  if (i < 0) return [...marks, mark];
  const next = marks.slice();
  next[i] = mark.type === 'textStyle' ? { type: 'textStyle', attrs: { ...marks[i]!.attrs, ...mark.attrs } } : mark;
  return next;
}

interface Ctx {
  base?: number;
  budget: number;
  truncated: boolean;
}

function fontSizeEm(v: string, base: number | undefined): string | undefined {
  if (!base || base <= 0) return undefined;
  const m = /^([\d.]+)\s*(px|pt|em|rem|%)?$/i.exec(v.trim());
  if (!m) return undefined;
  let px = Number(m[1]);
  if (!Number.isFinite(px) || px <= 0) return undefined;
  const unit = (m[2] ?? 'px').toLowerCase();
  if (unit === 'pt') px = (px * 4) / 3;
  else if (unit === 'em' || unit === 'rem') px *= base;
  else if (unit === '%') px = (px / 100) * base;
  const em = Math.min(6, Math.max(0.25, px / base));
  if (Math.abs(em - 1) < 0.05) return undefined;
  return `${Math.round(em * 100) / 100}em`;
}

function marksOf(el: HElement, marks: PMMark[], ctx: Ctx): PMMark[] {
  let out = marks;
  switch (el.tag) {
    case 'strong':
    case 'b':
      out = withMark(out, { type: 'bold' });
      break;
    case 'em':
    case 'i':
    case 'cite':
    case 'var':
      out = withMark(out, { type: 'italic' });
      break;
    case 'u':
    case 'ins':
      out = withMark(out, { type: 'underline' });
      break;
    case 's':
    case 'strike':
    case 'del':
      out = withMark(out, { type: 'strike' });
      break;
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      out = withMark(out, { type: 'code' });
      break;
    case 'mark': {
      const c = hex6(el.attrs['data-color']) ?? hex6(styleMap(el.attrs.style).get('background-color'));
      out = withMark(out, { type: 'highlight', attrs: { color: c ? nearestColor(c, HIGHLIGHT_COLORS) : HIGHLIGHT_COLORS[0] } });
      break;
    }
    case 'a': {
      const href = safeHref(el.attrs.href);
      if (href) out = withMark(out, linkMark(href));
      break;
    }
    case 'font': {
      const c = hex6(el.attrs.color);
      if (c) out = withMark(out, { type: 'textStyle', attrs: { color: c } });
      break;
    }
  }
  const st = styleMap(el.attrs.style);
  if (!st.size) return out;
  const color = st.get('color');
  if (color !== undefined) {
    const c = hex6(color);
    if (c) out = withMark(out, { type: 'textStyle', attrs: { color: c } });
  }
  const bg = st.get('background-color') ?? st.get('background');
  if (bg !== undefined && el.tag !== 'mark') {
    const c = parseColor(bg);
    if (c && c.a > 0) out = withMark(out, { type: 'highlight', attrs: { color: nearestColor(hex6(bg)!, HIGHLIGHT_COLORS) } });
  }
  const fs = st.get('font-size');
  if (fs !== undefined) {
    const em = fontSizeEm(fs, ctx.base);
    if (em) out = withMark(out, { type: 'textStyle', attrs: { fontSize: em } });
  }
  const fw = st.get('font-weight');
  if (fw && (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600)) out = withMark(out, { type: 'bold' });
  if (st.get('font-style') === 'italic') out = withMark(out, { type: 'italic' });
  const deco = `${st.get('text-decoration') ?? ''} ${st.get('text-decoration-line') ?? ''}`;
  if (deco.includes('underline')) out = withMark(out, { type: 'underline' });
  if (deco.includes('line-through')) out = withMark(out, { type: 'strike' });
  return out;
}

const sameMarks = (a: PMMark[] | undefined, b: PMMark[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Text an eine Inline-Liste hängen (Leerraum zusammengefasst, Budget beachtet). */
function pushText(inline: PMNode[], raw: string, marks: PMMark[], ctx: Ctx, pre = false) {
  let s = pre ? raw : raw.replace(/[ \t\n\r\f]+/g, ' ');
  if (!s) return;
  if (!pre) {
    // Leerraum am Anfang eines Absatzes bzw. nach einem Umbruch oder Leerzeichen entfällt
    const prev = inline[inline.length - 1];
    if (s.startsWith(' ') && (!prev || prev.type === 'hardBreak' || prev.text?.endsWith(' '))) s = s.slice(1);
    if (!s) return;
  }
  if (ctx.budget <= 0) {
    ctx.truncated = true;
    return;
  }
  if (s.length > ctx.budget) {
    s = s.slice(0, ctx.budget);
    ctx.truncated = true;
  }
  ctx.budget -= s.length;
  const prev = inline[inline.length - 1];
  if (prev && prev.type === 'text' && sameMarks(prev.marks, marks)) prev.text += s;
  else inline.push(marks.length ? { type: 'text', text: s, marks: marks.map((m) => (m.attrs ? { type: m.type, attrs: { ...m.attrs } } : { type: m.type })) } : { type: 'text', text: s });
}

/** Inline-Inhalt fertig machen: Leerzeichen am Ende weg, leere Textknoten weg. */
function finishInline(inline: PMNode[]): PMNode[] {
  const trim = () => {
    while (inline.length) {
      const last = inline[inline.length - 1]!;
      if (last.type !== 'text') break;
      last.text = last.text!.replace(/ +$/, '');
      if (last.text) break;
      inline.pop();
    }
  };
  trim();
  // ein `<br>` am Ende eines Blocks erzeugt im Browser keine eigene Zeile (`<p>a<br></p>` = „a“, `<p><br></p>` = leer)
  if (inline[inline.length - 1]?.type === 'hardBreak') {
    inline.pop();
    trim();
  }
  return inline;
}

const hasBlock = (el: HElement): boolean => el.children.some((c) => typeof c !== 'string' && (BLOCK.has(c.tag) || hasBlock(c)));

function textContent(n: HNode): string {
  if (typeof n === 'string') return n;
  if (n.tag === 'br') return '\n';
  return n.children.map(textContent).join('');
}

function paragraph(inline: PMNode[]): PMNode {
  const content = finishInline(inline);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

/** Kinder eines Containers → Blöcke (lose Inline-Teile werden Absätze). */
function blocksOf(nodes: HNode[], marks: PMMark[], ctx: Ctx, level: number): PMNode[] {
  const out: PMNode[] = [];
  let inline: PMNode[] = [];
  let open = false;
  const flush = () => {
    if (open || inline.length) {
      const p = paragraph(inline);
      if (p.content || open) out.push(p);
    }
    inline = [];
    open = false;
  };
  const addInline = (n: HNode, m: PMMark[]) => {
    if (typeof n === 'string') {
      if (!inline.length && !n.trim() && !open) return;
      pushText(inline, n, m, ctx);
      if (inline.length) open = true;
      return;
    }
    if (n.tag === 'br') {
      if (ctx.budget > 0) {
        inline.push({ type: 'hardBreak' });
        ctx.budget -= 1;
      } else ctx.truncated = true;
      open = true;
      return;
    }
    if (n.tag === 'img' || n.tag === 'input' || n.tag === 'wbr') return;
    const mm = marksOf(n, m, ctx);
    for (const c of n.children) addInline(c, mm);
  };
  for (const n of nodes) {
    if (typeof n !== 'string' && (BLOCK.has(n.tag) || hasBlock(n))) {
      flush();
      if (BLOCK.has(n.tag)) out.push(...blockOf(n, marks, ctx, level));
      else out.push(...blocksOf(n.children, marksOf(n, marks, ctx), ctx, level));
    } else addInline(n, marks);
  }
  flush();
  return out;
}

/** Zeilentrenner im Klartext kosten ein Zeichen Budget */
function spend(ctx: Ctx) {
  ctx.budget = Math.max(0, ctx.budget - 1);
}

function isTaskList(el: HElement): boolean {
  if (el.attrs['data-type'] === 'taskList' || /\b(task-?list|checklist)\b/i.test(el.attrs.class ?? '')) return true;
  return el.children.some((c) => typeof c !== 'string' && c.tag === 'li' && ('data-checked' in c.attrs || c.children.some((k) => typeof k !== 'string' && k.tag === 'input' && k.attrs.type === 'checkbox') || c.attrs['data-type'] === 'taskItem'));
}

function checkedOf(li: HElement): boolean {
  const d = li.attrs['data-checked'];
  if (d !== undefined) return d === 'true' || d === '' || d === 'checked';
  const box = li.children.find((k): k is HElement => typeof k !== 'string' && k.tag === 'input');
  return !!box && 'checked' in box.attrs;
}

function listOf(el: HElement, marks: PMMark[], ctx: Ctx, level: number): PMNode[] {
  const task = isTaskList(el);
  const type = task ? 'taskList' : el.tag === 'ol' ? 'orderedList' : 'bulletList';
  const items: PMNode[] = [];
  // zu tief: Einträge als Absätze auf der aktuellen Ebene
  if (level >= MAX_LIST_LEVEL) {
    ctx.truncated = true;
    return el.children.flatMap((c) => (typeof c === 'string' ? blocksOf([c], marks, ctx, level) : blocksOf(c.tag === 'li' ? c.children : [c], marks, ctx, level)));
  }
  let loose: HNode[] = [];
  const pushItem = (children: HNode[], li?: HElement) => {
    let content = blocksOf(children, marks, ctx, level + 1);
    if (!content.length || content[0]!.type !== 'paragraph') content = [{ type: 'paragraph' }, ...content];
    const item: PMNode = { type: task ? 'taskItem' : 'listItem', content };
    if (task) item.attrs = { checked: li ? checkedOf(li) : false };
    items.push(item);
    spend(ctx);
  };
  const flushLoose = () => {
    if (loose.some((c) => typeof c !== 'string' || c.trim())) pushItem(loose);
    loose = [];
  };
  for (const c of el.children) {
    if (typeof c !== 'string' && c.tag === 'li') {
      flushLoose();
      pushItem(c.children, c);
    } else if (typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol') && items.length) {
      // verschachtelte Liste direkt in der Liste (ohne li): an den vorigen Eintrag hängen
      flushLoose();
      items[items.length - 1]!.content!.push(...listOf(c, marks, ctx, level + 1));
    } else loose.push(c);
  }
  flushLoose();
  if (!items.length) return [];
  const node: PMNode = { type, content: items };
  if (type === 'orderedList') {
    const start = Number(el.attrs.start);
    if (Number.isInteger(start) && start !== 1 && start >= 0 && start < 1e6) node.attrs = { start };
  }
  return [node];
}

function blockOf(el: HElement, marks: PMMark[], ctx: Ctx, level: number): PMNode[] {
  switch (el.tag) {
    case 'p':
    case 'dt':
    case 'dd':
    case 'summary':
    case 'figcaption':
    case 'address': {
      if (hasBlock(el)) return blocksOf(el.children, marksOf(el, marks, ctx), ctx, level);
      const out = blocksOf(el.children, marksOf(el, marks, ctx), ctx, level);
      spend(ctx);
      return out.length ? out : [{ type: 'paragraph' }];
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const lvl = Math.min(3, Number(el.tag[1]));
      const inner = blocksOf(el.children, marksOf(el, marks, ctx), ctx, level);
      spend(ctx);
      const first = inner[0];
      const heading: PMNode = { type: 'heading', attrs: { level: lvl } };
      if (first?.type === 'paragraph' && first.content) heading.content = first.content;
      return [heading, ...inner.slice(first?.type === 'paragraph' ? 1 : 0)];
    }
    case 'ul':
    case 'ol':
      return listOf(el, marks, ctx, level);
    case 'li':
      // ohne Liste: wie ein Absatz
      return blocksOf(el.children, marks, ctx, level);
    case 'blockquote': {
      if (level >= MAX_LIST_LEVEL) {
        ctx.truncated = true;
        return blocksOf(el.children, marks, ctx, level);
      }
      const content = blocksOf(el.children, marks, ctx, level + 1);
      return [{ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] }];
    }
    case 'pre': {
      let text = textContent(el).replace(INVISIBLE_RE, '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
      if (text.length > ctx.budget) {
        text = text.slice(0, ctx.budget);
        ctx.truncated = true;
      }
      ctx.budget -= text.length;
      spend(ctx);
      return [text ? { type: 'codeBlock', content: [{ type: 'text', text }] } : { type: 'codeBlock' }];
    }
    case 'hr':
      return [{ type: 'horizontalRule' }];
    case 'table':
    case 'thead':
    case 'tbody':
    case 'tfoot': {
      // Tabellen gibt es im Rich-Text nicht: je Zeile ein Absatz, Zellen mit „ | “ getrennt
      const out: PMNode[] = [];
      for (const c of el.children) {
        if (typeof c === 'string') continue;
        out.push(...blockOf(c.tag === 'tr' || BLOCK.has(c.tag) ? c : { tag: 'div', attrs: {}, children: [c] }, marks, ctx, level));
      }
      return out;
    }
    case 'tr': {
      const cells = el.children.filter((c): c is HElement => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'));
      const inline: PMNode[] = [];
      cells.forEach((cell, i) => {
        if (i > 0) pushText(inline, ' | ', marks, ctx, true);
        const inner = blocksOf(cell.children, marksOf(cell, cell.tag === 'th' ? withMark(marks, { type: 'bold' }) : marks, ctx), ctx, level);
        inner.forEach((b, k) => {
          if (k > 0) pushText(inline, ' ', marks, ctx, true);
          inline.push(...(b.content ?? []).filter((x) => x.type === 'text' || x.type === 'hardBreak'));
        });
      });
      spend(ctx);
      return [paragraph(inline)];
    }
    default:
      // div, section … : Container
      return blocksOf(el.children, marksOf(el, marks, ctx), ctx, level);
  }
}

// ---- Klartext --------------------------------------------------------------------------------------------------------

const isInline = (n: PMNode) => n.type === 'text' || n.type === 'hardBreak';

/** Klartext-Spiegel – genau wie `plainOf` in web/src/features/richtext/doc.ts (Test prüft die Gleichheit). */
export function plainOf(doc: PMDoc): string {
  const lines: string[] = [];
  const walk = (n: PMNode) => {
    const kids = n.content ?? [];
    if (kids.length ? kids.every(isInline) : n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') {
      lines.push(kids.map((k) => (k.type === 'hardBreak' ? '\n' : (k.text ?? ''))).join(''));
      return;
    }
    kids.forEach(walk);
  };
  doc.content.forEach(walk);
  return lines.join('\n');
}

/** Dokument aus Klartext (je Zeile ein Absatz), wie `textToDoc` im Web. */
export function textToDoc(text: string): PMDoc {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  };
}

// ---- Einstieg --------------------------------------------------------------------------------------------------------

/** Miro-HTML → ProseMirror-Dokument + Klartext. Leerer/fehlender Inhalt → ein leerer Absatz. */
export function htmlToDoc(html: unknown, opts: HtmlOptions = {}): HtmlResult {
  const src = typeof html === 'string' ? html : '';
  const ctx: Ctx = { base: opts.baseFontSize, budget: opts.maxChars ?? HTML_MAX_CHARS, truncated: false };
  // sehr lange Eingaben: der Klartext ist ohnehin begrenzt, mehr als das 50-Fache davon parsen wir nicht
  const limited = src.length > ctx.budget * 50 + 10_000 ? src.slice(0, ctx.budget * 50 + 10_000) : src;
  const tree = parseHtml(limited);
  let content = blocksOf(tree.children, [], ctx, 0);
  // leere Absätze am Ende (Miro hängt gern `<p></p>` an) entfallen, einer bleibt immer
  while (content.length > 1) {
    const last = content[content.length - 1]!;
    if (last.type !== 'paragraph' || last.content) break;
    content = content.slice(0, -1);
  }
  if (!content.length) content = [{ type: 'paragraph' }];
  let truncated = ctx.truncated || limited !== src || tree.attrs['data-flattened'] === '1';
  // sehr viele kleine Blöcke: JSON-Grenze – hintere Blöcke fallen weg
  let size = JSON.stringify(content).length;
  while (size > HTML_MAX_JSON && content.length > 1) {
    content = content.slice(0, Math.max(1, Math.floor((content.length * HTML_MAX_JSON * 0.95) / size)));
    size = JSON.stringify(content).length;
    truncated = true;
  }
  let doc: PMDoc = { type: 'doc', content };
  let plain = plainOf(doc);
  const max = opts.maxChars ?? HTML_MAX_CHARS;
  if (plain.length > max || size > HTML_MAX_JSON) {
    // Zeilentrenner zählen mit bzw. ein einzelner Block ist zu groß: als Klartext-Dokument neu aufbauen
    plain = plain.slice(0, max);
    doc = textToDoc(plain);
    while (JSON.stringify(doc).length > HTML_MAX_JSON) {
      plain = plain.slice(0, Math.floor(plain.length * 0.8));
      doc = textToDoc(plain);
    }
    return { doc, plain, truncated: true };
  }
  return { doc, plain, truncated };
}

/** Nur der Klartext (Titel, Mindmap-Knoten, Kartenfelder): Blöcke und Umbrüche als Zeilen. */
export function htmlToPlain(html: unknown, maxChars = HTML_MAX_CHARS): string {
  return htmlToDoc(html, { maxChars }).plain;
}

/** Textfarbe über den ganzen Text legen, wo der Text noch keine eigene Farbe hat (Form: Miro `style.color`). */
export function colorizeDoc(doc: PMDoc, color: string): PMDoc {
  const walk = (n: PMNode): PMNode => {
    if (n.type === 'text') {
      const ts = n.marks?.find((m) => m.type === 'textStyle');
      if (ts?.attrs?.color) return n;
      const marks = withMark(n.marks ?? [], { type: 'textStyle', attrs: { color } });
      return { ...n, marks };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return { type: 'doc', content: doc.content.map(walk) };
}

/** Tiefe wie validate.ts `docError` (Knoten ab 1 unter `doc`). */
export function docDepth(doc: PMDoc): number {
  const d = (n: PMNode, k: number): number => Math.max(k, ...(n.content ?? []).map((c) => d(c, k + 1)));
  return Math.max(0, ...doc.content.map((c) => d(c, 1)));
}
