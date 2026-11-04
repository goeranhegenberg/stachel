// Markdown (einfaches, zeilenweises Format) ↔ ProseMirror-JSON des Rich-Text-Felds `content`
// (Knoten/Marks wie docs/features/richtext.md). Jede Zeile ist ein eigener Absatz – wie Klartext auf dem Board.
//
// Blöcke: `# `/`## `/`### ` Überschrift, `- `/`* ` Aufzählung, `1. ` Nummerierung, `- [ ] `/`- [x] ` Checkliste
// (Einrücken mit 2 Leerzeichen = Unterliste), `> ` Zitat, ``` Code-Block, `---` Linie, Leerzeile = leerer Absatz.
// Inline: **fett**, *kursiv* bzw. _kursiv_, ~~durchgestrichen~~, `code`, [Text](https://…), ==markiert==,
// <u>unterstrichen</u>. `\` hebt ein Zeichen auf.
import type { PMDoc, PMMark, PMNode } from '../../../web/src/features/richtext/doc';

// ---- Markdown → JSON ------------------------------------------------------------------------------------------------

const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

/** Inline-Markdown in Textknoten mit Marks. */
export function parseInline(src: string): PMNode[] {
  const out: PMNode[] = [];
  const push = (text: string, marks: PMMark[]) => {
    if (!text) return;
    const last = out[out.length - 1];
    const same = last && last.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks);
    if (same) last.text += text;
    else out.push(marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text });
  };
  const walk = (s: string, marks: PMMark[]) => {
    let buf = '';
    let i = 0;
    const flush = () => {
      push(buf, marks);
      buf = '';
    };
    const tryWrap = (open: string, close: string, mark: PMMark): boolean => {
      if (!s.startsWith(open, i)) return false;
      const end = s.indexOf(close, i + open.length);
      if (end <= i + open.length) return false;
      flush();
      walk(s.slice(i + open.length, end), [...marks.filter((m) => m.type !== mark.type), mark]);
      i = end + close.length;
      return true;
    };
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === '\\' && i + 1 < s.length) {
        buf += s[i + 1];
        i += 2;
        continue;
      }
      if (ch === '`') {
        const end = s.indexOf('`', i + 1);
        if (end > i + 1) {
          flush();
          push(s.slice(i + 1, end), [...marks, { type: 'code' }]);
          i = end + 1;
          continue;
        }
      }
      if (ch === '[') {
        const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i));
        if (m) {
          const href = /^[a-z][\w+.-]*:/i.test(m[2]!) ? m[2]! : `https://${m[2]}`;
          flush();
          if (SAFE_LINK.test(href)) walk(m[1]!, [...marks, { type: 'link', attrs: { href } }]);
          else walk(m[1]!, marks);
          i += m[0].length;
          continue;
        }
      }
      if (tryWrap('**', '**', { type: 'bold' }) || tryWrap('__', '__', { type: 'bold' })) continue;
      if (tryWrap('~~', '~~', { type: 'strike' })) continue;
      if (tryWrap('==', '==', { type: 'highlight' })) continue;
      if (tryWrap('<u>', '</u>', { type: 'underline' })) continue;
      // *kursiv* / _kursiv_ nur an Wortgrenzen (nicht in snake_case oder 2*3*4)
      if ((ch === '*' || ch === '_') && (i === 0 || /[\s([{"'„]/.test(s[i - 1]!)) && s[i + 1] && s[i + 1] !== ' ') {
        const end = s.indexOf(ch, i + 1);
        if (end > i + 1 && s[end - 1] !== ' ' && (end + 1 >= s.length || /[\s.,;:!?)\]}"'“]/.test(s[end + 1]!))) {
          flush();
          walk(s.slice(i + 1, end), [...marks, { type: 'italic' }]);
          i = end + 1;
          continue;
        }
      }
      buf += ch;
      i++;
    }
    flush();
  };
  walk(src, []);
  return out;
}

const para = (text: string): PMNode => {
  const content = parseInline(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

type ListKind = 'bulletList' | 'orderedList' | 'taskList';
interface ListLine {
  indent: number;
  kind: ListKind;
  text: string;
  checked?: boolean;
  start?: number;
}

function listLine(line: string): ListLine | null {
  const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (!m) return null;
  const indent = Math.floor(m[1]!.replace(/\t/g, '  ').length / 2);
  const marker = m[2]!;
  let text = m[3]!;
  const task = /^\[( |x|X)\]\s*(.*)$/.exec(text);
  if (task && !/\d/.test(marker)) return { indent, kind: 'taskList', text: task[2]!, checked: task[1] !== ' ' };
  if (/\d/.test(marker)) return { indent, kind: 'orderedList', text, start: parseInt(marker, 10) };
  text = text.trimEnd();
  return { indent, kind: 'bulletList', text };
}

/** Aufeinanderfolgende Listenzeilen → verschachtelte Listen. */
function buildList(lines: ListLine[]): PMNode[] {
  const out: PMNode[] = [];
  let i = 0;
  const build = (level: number): PMNode | null => {
    const first = lines[i];
    if (!first || first.indent < level) return null;
    const kind = first.kind;
    const list: PMNode = { type: kind, content: [] };
    if (kind === 'orderedList' && first.start && first.start !== 1) list.attrs = { start: first.start };
    while (i < lines.length && lines[i]!.indent >= level) {
      const l = lines[i]!;
      if (l.indent > level) {
        // tiefer eingerückt ohne Eintrag davor: als Unterliste an den letzten Eintrag hängen
        const sub = build(l.indent);
        const last = list.content![list.content!.length - 1];
        if (sub) {
          if (last) last.content!.push(sub);
          else list.content!.push({ type: kind === 'taskList' ? 'taskItem' : 'listItem', ...(kind === 'taskList' ? { attrs: { checked: false } } : {}), content: [{ type: 'paragraph' }, sub] });
        }
        continue;
      }
      if (l.kind !== kind) break;
      i++;
      const item: PMNode = { type: kind === 'taskList' ? 'taskItem' : 'listItem', content: [para(l.text)] };
      if (kind === 'taskList') item.attrs = { checked: !!l.checked };
      list.content!.push(item);
      // Unterliste direkt darunter
      while (i < lines.length && lines[i]!.indent > level) {
        const sub = build(lines[i]!.indent);
        if (sub) item.content!.push(sub);
        else break;
      }
    }
    return list;
  };
  while (i < lines.length) {
    const before = i;
    const l = build(lines[i]!.indent);
    if (l) out.push(l);
    if (i === before) i++; // Sicherheit gegen Endlosschleife
  }
  return out;
}

/** Markdown → ProseMirror-Dokument. */
export function markdownToDoc(md: string): PMDoc {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const content: PMNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Code-Block
    if (/^```/.test(line.trim())) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) body.push(lines[i++]!);
      i++;
      const text = body.join('\n');
      content.push(text ? { type: 'codeBlock', content: [{ type: 'text', text }] } : { type: 'codeBlock' });
      continue;
    }
    if (listLine(line)) {
      const group: ListLine[] = [];
      while (i < lines.length && listLine(lines[i]!)) group.push(listLine(lines[i++]!)!);
      content.push(...buildList(group));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const inline = parseInline(h[2]!.trim());
      content.push({ type: 'heading', attrs: { level: Math.min(3, h[1]!.length) }, ...(inline.length ? { content: inline } : {}) });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: PMNode[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) quote.push(para(lines[i++]!.replace(/^>\s?/, '')));
      content.push({ type: 'blockquote', content: quote });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }
    content.push(para(line));
    i++;
  }
  // abschließende Leerzeilen weglassen
  while (content.length > 1 && content[content.length - 1]!.type === 'paragraph' && !content[content.length - 1]!.content) content.pop();
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** Enthält der Text Markdown-Formatierung (sonst reicht Klartext)? */
export function hasFormatting(doc: PMDoc): boolean {
  const rich = (n: PMNode): boolean => (n.type !== 'paragraph' && n.type !== 'text' && n.type !== 'doc') || !!n.marks?.length || !!n.content?.some(rich);
  return doc.content.some(rich);
}

// ---- JSON → Markdown ------------------------------------------------------------------------------------------------

function inlineMd(nodes: PMNode[] | undefined): string {
  let s = '';
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      s += '\n';
      continue;
    }
    if (n.type !== 'text') {
      s += inlineMd(n.content);
      continue;
    }
    let t = n.text ?? '';
    const marks = n.marks ?? [];
    const has = (m: string) => marks.find((x) => x.type === m);
    if (has('code')) t = `\`${t}\``;
    else t = t.replace(/([*_~`\\[\]=])/g, '\\$1');
    if (has('bold')) t = `**${t}**`;
    if (has('italic')) t = `*${t}*`;
    if (has('strike')) t = `~~${t}~~`;
    if (has('underline')) t = `<u>${t}</u>`;
    if (has('highlight')) t = `==${t}==`;
    const link = has('link');
    if (link && typeof link.attrs?.href === 'string') t = `[${t}](${link.attrs.href})`;
    s += t;
  }
  return s;
}

function blockMd(n: PMNode, indent: string, out: string[]) {
  switch (n.type) {
    case 'heading':
      out.push(`${indent}${'#'.repeat(Number(n.attrs?.level ?? 1) || 1)} ${inlineMd(n.content)}`);
      return;
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      let num = Number(n.attrs?.start ?? 1) || 1;
      for (const item of n.content ?? []) {
        const marker = n.type === 'orderedList' ? `${num++}.` : n.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}]` : '-';
        const [first, ...rest] = item.content ?? [];
        out.push(`${indent}${marker} ${first ? (first.content?.every((k) => k.type === 'text' || k.type === 'hardBreak') || !first.content ? inlineMd(first.content) : '') : ''}`);
        for (const r of rest) blockMd(r, `${indent}  `, out);
      }
      return;
    }
    case 'blockquote':
      for (const c of n.content ?? []) {
        const sub: string[] = [];
        blockMd(c, '', sub);
        sub.forEach((l) => out.push(`${indent}> ${l}`));
      }
      return;
    case 'codeBlock':
      out.push(`${indent}\`\`\``, ...inlineMd(n.content).split('\n').map((l) => indent + l), `${indent}\`\`\``);
      return;
    case 'horizontalRule':
      out.push(`${indent}---`);
      return;
    default:
      if (n.content?.some((k) => k.type !== 'text' && k.type !== 'hardBreak')) n.content.forEach((k) => blockMd(k, indent, out));
      else out.push(indent + inlineMd(n.content));
  }
}

/** ProseMirror-Dokument → Markdown (gleiches Format wie markdownToDoc). */
export function docToMarkdown(doc: PMDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return '';
  const out: string[] = [];
  for (const n of doc.content) blockMd(n, '', out);
  return out.join('\n');
}
