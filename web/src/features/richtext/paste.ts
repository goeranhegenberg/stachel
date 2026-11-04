// Eingefügtes HTML (Word, Browser, Google Docs) bereinigen, bevor ProseMirror es liest. Läuft in einem inerten
// Dokument (DOMParser): nichts wird geladen oder ausgeführt. Ergebnis enthält nur Elemente und Attribute, die der
// Editor versteht – keine Ereignis-Attribute, Skripte, Rahmen, Bilder oder unsicheren Links.
// Dazu: Word-Listen (mso-list) werden zu echten Listen, Word-Markierung (mso-highlight) zur Markierung, Schriftgrößen
// in pt/px relativ zur Grundgröße der Quelle in `em` umgerechnet (nur Text und Form, Vertrag richtext.md).
import { safeHref } from './links';

/** Elemente, die samt Inhalt wegfallen. */
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'title', 'head',
  'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas', 'svg', 'math', 'noscript', 'template', 'form',
  'button', 'select', 'textarea', 'input', 'xml',
]);
/** Elemente, die bleiben (mit den Attributen aus ATTRS). Alle anderen werden durch ihren Inhalt ersetzt. */
const KEEP = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre', 'a', 'span', 'mark', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'div', 'sub', 'sup',
]);
const ATTRS: Record<string, string[]> = {
  a: ['href'],
  ol: ['start'],
  ul: ['data-type'],
  li: ['data-type', 'data-checked'],
  mark: ['data-color'],
};
/** Von ProseMirror selbst (Kopieren innerhalb von Stachel) */
const GLOBAL_ATTRS = ['data-pm-slice', 'style'];
/** CSS-Eigenschaften, die der Editor auswertet (Fett/Kursiv/Durchgestrichen aus Google Docs, Farbe, Größe). */
const STYLE_KEEP = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'font-size'];

/** Word-Markierungsfarben → Markierungsfarben der Leiste (FormatBar HIGHLIGHTS). */
const WORD_HIGHLIGHT: Record<string, string> = {
  yellow: '#fff27a', darkyellow: '#ffd08a', green: '#c9e14a', brightgreen: '#c9e14a', darkgreen: '#c9e14a',
  cyan: '#9fd3ff', turquoise: '#9fd3ff', blue: '#9fd3ff', darkblue: '#9fd3ff', darkcyan: '#9fd3ff',
  magenta: '#ffb3d1', pink: '#ffb3d1', red: '#ffb3d1', darkred: '#ffb3d1', darkmagenta: '#e2d5ff', violet: '#e2d5ff',
  gray: '#e2d5ff', lightgray: '#e2d5ff', gray25: '#e2d5ff', gray50: '#e2d5ff',
};
const HIGHLIGHTS = ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff'];

export interface PasteContext {
  /** Teil-Schriftgrößen erlaubt (Text, Form); sonst fallen sie weg */
  sizes: boolean;
}

let ctx2d: CanvasRenderingContext2D | null | undefined;
/** CSS-Farbe → `#rrggbb` (benannte Farben, rgb(), hsl()); undefined bei Unbekanntem. */
export function normColor(v: string | undefined | null): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'currentcolor' || s.startsWith('var(')) return undefined;
  if (ctx2d === undefined) ctx2d = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx2d) return /^#[0-9a-f]{3,8}$/.test(s) ? s : undefined;
  ctx2d.fillStyle = '#010203';
  ctx2d.fillStyle = s;
  const out = String(ctx2d.fillStyle);
  if (out === '#010203' && s !== '#010203') return undefined;
  // rgba mit Deckkraft 0 → keine Farbe
  if (/^rgba\(.*,\s*0\)$/.test(out)) return undefined;
  return out;
}

const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
/** Nächste Markierungsfarbe der Leiste; Weiß und sehr dunkle Hintergründe sind keine Markierung. */
function nearestHighlight(hex: string): string | undefined {
  if (!/^#[0-9a-f]{6}$/.test(hex)) return undefined;
  const [r, g, b] = rgb(hex);
  const light = (r * 299 + g * 587 + b * 114) / 1000;
  if (light > 245 || light < 60) return undefined;
  let best = HIGHLIGHTS[0];
  let dist = Infinity;
  for (const c of HIGHLIGHTS) {
    const [r2, g2, b2] = rgb(c);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < dist) {
      dist = d;
      best = c;
    }
  }
  return best;
}

/** CSS-Größe in px (pt, px, em/rem relativ zu 16 px, %); undefined bei Schlüsselwörtern. */
function toPx(v: string, base: number): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(pt|px|em|rem|%)\s*$/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case 'pt':
      return (n * 4) / 3;
    case 'px':
      return n;
    case 'em':
      return n * base;
    case 'rem':
      return n * 16;
    default:
      return (n / 100) * base;
  }
}

/** Grundschriftgröße der Quelle (px): Word `p.MsoNormal{font-size:…}` bzw. 11 pt, sonst 16 px (Browser). */
function baseSize(doc: Document, html: string): number {
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  const m = /(?:p\.MsoNormal|body)[^{]*\{[^}]*font-size:\s*([\d.]+\s*(?:pt|px))/i.exec(css);
  if (m) return toPx(m[1], 16) ?? 16;
  return /urn:schemas-microsoft-com:office|class="?Mso/i.test(html) ? (11 * 4) / 3 : 16;
}

/** Stil-Attribut in Einzelwerte zerlegen (ohne CSSOM, damit auch mso-* erhalten bleibt). */
function parseStyle(s: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (s ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k && v) out.set(k, v);
  }
  return out;
}

const unwrap = (el: Element) => {
  el.replaceWith(...el.childNodes);
};

interface WordListItem {
  el: Element;
  list: string;
  level: number;
  ordered: boolean;
}

/** Word-Listenabsatz erkennen und die Aufzählungszeichen („·“, „1.“) entfernen. */
function wordListItem(el: Element): WordListItem | null {
  const m = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(el.getAttribute('style') ?? '');
  if (!m) return null;
  let marker = '';
  // Zeichen zwischen <![if !supportLists]> und <![endif]> (im DOMParser Kommentare) bzw. mso-list:Ignore
  let inside = false;
  for (const n of [...el.childNodes]) {
    if (n.nodeType === 8) {
      const d = (n.textContent ?? '').trim().toLowerCase();
      if (d.startsWith('[if') && d.includes('supportlists')) inside = true;
      else if (d.startsWith('[endif')) inside = false;
      n.remove();
      continue;
    }
    if (inside) {
      marker += n.textContent ?? '';
      n.remove();
    }
  }
  el.querySelectorAll('[style*="mso-list"]').forEach((s) => {
    if (/mso-list:\s*ignore/i.test(s.getAttribute('style') ?? '')) {
      marker += s.textContent ?? '';
      s.remove();
    }
  });
  // trim entfernt auch geschützte Leerzeichen
  const mk = marker.trim();
  const ordered = /^(\d+|[a-z]|[ivxlc]+)[.)]$/i.test(mk);
  return { el, list: m[1], level: Math.max(1, Number(m[2])), ordered };
}

/** Aufeinanderfolgende Word-Listenabsätze zu <ul>/<ol> mit <li> zusammenfassen (Ebenen verschachtelt). */
function wordLists(root: Element) {
  const doc = root.ownerDocument;
  const paras = [...root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div')].filter((p) => /mso-list:\s*l\d+/i.test(p.getAttribute('style') ?? ''));
  let top: Element | null = null;
  let topId = '';
  let stack: { level: number; list: Element }[] = [];
  for (const p of paras) {
    const it = wordListItem(p);
    if (!it) continue;
    // gehört zur laufenden Liste, wenn direkt davor (ohne Text dazwischen) die Liste steht
    let sib = p.previousSibling;
    while (sib && (sib.nodeType === 8 || (sib.nodeType === 3 && !(sib.textContent ?? '').trim()))) sib = sib.previousSibling;
    if (!top || sib !== top || it.list !== topId) {
      top = null;
      topId = it.list;
      stack = [];
    }
    const li = doc.createElement('li');
    const para = doc.createElement('p');
    para.append(...p.childNodes);
    li.append(para);
    while (stack.length && stack.at(-1)!.level > it.level) stack.pop();
    let cur = stack.at(-1);
    if (!cur || cur.level < it.level) {
      const list = doc.createElement(it.ordered ? 'ol' : 'ul');
      if (cur) (cur.list.lastElementChild ?? cur.list.appendChild(doc.createElement('li'))).append(list);
      else {
        p.before(list);
        top = list;
      }
      cur = { level: it.level, list };
      stack.push(cur);
    }
    cur.list.append(li);
    p.remove();
  }
}

/** Bereinigt eingefügtes HTML (siehe Dateikopf). */
export function cleanPastedHtml(html: string, ctx: PasteContext): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = baseSize(doc, html);
  const body = doc.body;
  if (!body) return '';
  wordLists(body);

  const walk = (el: Element) => {
    for (const child of [...el.children]) walk(child);
    const tag = el.tagName.toLowerCase();
    if (el === body) return;
    if (DROP.has(tag)) {
      el.remove();
      return;
    }
    // Attribute: nur erlaubte, keine Ereignisse
    const allowed = new Set([...(ATTRS[tag] ?? []), ...GLOBAL_ATTRS]);
    for (const a of [...el.attributes]) if (!allowed.has(a.name.toLowerCase())) el.removeAttribute(a.name);
    if (tag === 'a') {
      const href = safeHref(el.getAttribute('href'));
      if (href) el.setAttribute('href', href);
      else el.removeAttribute('href');
    }
    // Stil: nur ausgewertete Eigenschaften; Markierung und Größe gesondert
    const st = parseStyle(el.getAttribute('style'));
    let highlight: string | undefined;
    const wordHl = st.get('mso-highlight')?.toLowerCase().replace(/\s/g, '');
    if (wordHl && wordHl !== 'none') highlight = WORD_HIGHLIGHT[wordHl] ?? nearestHighlight(normColor(wordHl) ?? '');
    else if (tag !== 'mark' && !['p', 'div', 'li', 'ul', 'ol', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      const bg = st.get('background-color') ?? st.get('background');
      const c = bg ? normColor(bg.split(/\s+/)[0]) : undefined;
      if (c) highlight = nearestHighlight(c);
    }
    if (tag === 'mark') {
      const c = normColor(el.getAttribute('data-color') ?? st.get('background-color') ?? st.get('background'));
      el.removeAttribute('data-color');
      if (c) el.setAttribute('data-color', nearestHighlight(c) ?? HIGHLIGHTS[0]);
    }
    const parts: string[] = [];
    for (const k of STYLE_KEEP) {
      const v = st.get(k);
      if (!v) continue;
      if (k === 'color') {
        const c = normColor(v);
        if (c && c !== '#000000') parts.push(`color: ${c}`);
      } else if (k === 'font-size') {
        if (!ctx.sizes) continue;
        const px = toPx(v, base);
        if (px === undefined) continue;
        const em = Math.round(Math.min(6, Math.max(0.25, px / base)) * 100) / 100;
        if (Math.abs(em - 1) >= 0.05) parts.push(`font-size: ${em}em`);
      } else if (/^[\w\s-]+$/.test(v)) parts.push(`${k}: ${v}`);
    }
    if (parts.length) el.setAttribute('style', parts.join('; '));
    else el.removeAttribute('style');
    if (highlight) {
      const mark = doc.createElement('mark');
      mark.setAttribute('data-color', highlight);
      mark.append(...el.childNodes);
      el.append(mark);
    }
    if (!KEEP.has(tag)) {
      // Block-Elemente (Tabellen, section …) als Absatz-Grenze behalten, sonst nur den Inhalt
      if (/^(table|tbody|thead|tfoot|section|article|header|footer|main|aside|nav|figure|figcaption|address|dl|dd|dt|center)$/.test(tag)) {
        const div = doc.createElement('div');
        div.append(...el.childNodes);
        el.replaceWith(div);
      } else if (/^(tr|td|th|caption)$/.test(tag)) {
        const p = doc.createElement(tag === 'tr' ? 'div' : 'span');
        p.append(...el.childNodes);
        if (tag !== 'tr') p.append(doc.createTextNode(' '));
        el.replaceWith(p);
      } else unwrap(el);
    } else if (tag === 'span' && !el.attributes.length) unwrap(el);
    else if (/^h[4-6]$/.test(tag)) {
      // Überschriften gibt es in drei Stufen (Vertrag)
      const h = doc.createElement('h3');
      h.append(...el.childNodes);
      el.replaceWith(h);
    }
  };
  // Kommentare (Word-Bedingungen, StartFragment) entfernen
  const cw = doc.createTreeWalker(body, 128);
  const comments: Node[] = [];
  while (cw.nextNode()) comments.push(cw.currentNode);
  comments.forEach((c) => (c as ChildNode).remove());
  walk(body);
  return body.innerHTML;
}
