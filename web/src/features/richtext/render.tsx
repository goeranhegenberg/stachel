// Statische Darstellung von Rich-Text aus dem ProseMirror-JSON (ohne Editor-Instanz, auch bei 2000 Objekten).
import type { CSSProperties, ReactNode } from 'react';
import type { PMMark, PMNode } from './doc';
import { safeHref } from './links';

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|var\(--[\w-]+\))$/i;
export const safeColor = (v: unknown): string | undefined => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : undefined);

/** Standard-Farbe der Markierung (Tiptap ohne Farbe). */
export const HIGHLIGHT_DEFAULT = '#fff27a';

/** Teil-Schriftgröße: geschrieben wird `em`; ältere Einfügungen (pt/px aus Word) werden ebenso angezeigt wie im Editor. */
export const cssSize = (v: unknown): string | undefined => {
  const m = typeof v === 'string' ? /^\s*(\d+(?:\.\d+)?)\s*(px|pt|em|rem|%)\s*$/i.exec(v) : null;
  return m && Number(m[1]) > 0 ? `${Number(m[1])}${m[2].toLowerCase()}` : undefined;
};

/**
 * Reihenfolge beim Verschachteln (zuerst = innen): Die Markierung liegt innen, die Schriftgröße (textStyle) außen –
 * sonst ist die Markierung nur so hoch wie die Grundschrift (wie im Editor, der die Größe ebenfalls außen hat).
 */
const MARK_ORDER: Record<string, number> = { highlight: 0, textStyle: 2 };
const byNesting = (a: PMMark, b: PMMark) => (MARK_ORDER[a.type] ?? 1) - (MARK_ORDER[b.type] ?? 1);

function wrapMark(m: PMMark, child: ReactNode, key: number): ReactNode {
  switch (m.type) {
    case 'bold':
      return <strong key={key}>{child}</strong>;
    case 'italic':
      return <em key={key}>{child}</em>;
    case 'underline':
      return <u key={key}>{child}</u>;
    case 'strike':
      return <s key={key}>{child}</s>;
    case 'code':
      return <code key={key}>{child}</code>;
    case 'link': {
      const href = safeHref(m.attrs?.href);
      if (!href) return child;
      return (
        <a key={key} className="rt-link" href={href} title={href} target="_blank" rel="noopener noreferrer nofollow" draggable={false} onClick={(e) => e.preventDefault()}>
          {child}
        </a>
      );
    }
    case 'highlight':
      return (
        <mark key={key} className="rt-hl" style={{ backgroundColor: safeColor(m.attrs?.color) ?? HIGHLIGHT_DEFAULT }}>
          {child}
        </mark>
      );
    case 'textStyle': {
      const style: CSSProperties = {};
      const color = safeColor(m.attrs?.color);
      if (color) style.color = color;
      const size = cssSize(m.attrs?.fontSize);
      if (size) style.fontSize = size;
      return Object.keys(style).length ? (
        <span key={key} style={style}>
          {child}
        </span>
      ) : (
        child
      );
    }
    default:
      return child; // unbekannte Marks: Text bleibt
  }
}

function inline(nodes: PMNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((n, i) => {
    if (n.type === 'hardBreak') out.push(<br key={i} />);
    else if (n.type === 'text' && n.text) {
      let el: ReactNode = n.text;
      [...(n.marks ?? [])].sort(byNesting).forEach((m, j) => (el = wrapMark(m, el, j)));
      out.push(<span key={i}>{el}</span>);
    }
  });
  // leere Zeile bzw. Umbruch am Ende sichtbar machen (wie ProseMirrors trailingBreak)
  if (!out.length || nodes.at(-1)?.type === 'hardBreak') out.push(<br key="end" className="rt-trail" />);
  return out;
}

const isInlineNode = (n: PMNode) => n.type === 'text' || n.type === 'hardBreak';

function block(n: PMNode, key: number | string): ReactNode {
  const kids = n.content ?? [];
  switch (n.type) {
    case 'paragraph':
      return <p key={key}>{inline(kids)}</p>;
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(n.attrs?.level) || 1));
      const H = `h${level}` as 'h1' | 'h2' | 'h3';
      return <H key={key}>{inline(kids)}</H>;
    }
    case 'bulletList':
      return <ul key={key}>{blocks(kids)}</ul>;
    case 'orderedList': {
      const start = Number(n.attrs?.start);
      return (
        <ol key={key} start={Number.isFinite(start) && start !== 1 ? start : undefined}>
          {blocks(kids)}
        </ol>
      );
    }
    case 'listItem':
      return <li key={key}>{blocks(kids)}</li>;
    case 'taskList':
      return (
        <ul key={key} data-type="taskList">
          {blocks(kids)}
        </ul>
      );
    case 'taskItem': {
      const checked = n.attrs?.checked === true || n.attrs?.checked === 'true';
      return (
        <li key={key} data-type="taskItem" data-checked={checked}>
          <label contentEditable={false}>
            <input type="checkbox" checked={checked} readOnly tabIndex={-1} aria-label={checked ? 'Erledigt' : 'Offen'} />
            <span />
          </label>
          <div>{blocks(kids)}</div>
        </li>
      );
    }
    case 'blockquote':
      return <blockquote key={key}>{blocks(kids)}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{kids.map((k) => k.text ?? '').join('') || <br />}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    default:
      // Unbekannter Knoten: Text behalten
      if (kids.length && kids.every(isInlineNode)) return <p key={key}>{inline(kids)}</p>;
      return kids.length ? <div key={key}>{blocks(kids)}</div> : null;
  }
}

export const blocks = (nodes: PMNode[]): ReactNode[] => nodes.map((n, i) => block(n, i));
