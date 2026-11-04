// Rich-Text-Daten ohne Editor: Y.XmlFragment (y-prosemirror-Format) ↔ ProseMirror-JSON, Klartext-Spiegel,
// Migration aus `text` und Format-Operationen aufs ganze Objekt. Vertrag: docs/contract.md §4 „Rich-Text“.
import * as Y from 'yjs';
import { RICH_TEXT_FIELD, type BoardObject } from '../../protocol';

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

/** Knoten und Marks, die der Editor kennt (Tiptap-StarterKit + Aufgabenliste + Textstil/Markierung). */
export const KNOWN_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
]);
export const KNOWN_MARKS = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link', 'highlight', 'textStyle']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);
const NAME_RE = /^[A-Za-z][\w-]*$/;

export const isDoc = (v: unknown): v is PMDoc => !!v && typeof v === 'object' && (v as PMDoc).type === 'doc' && Array.isArray((v as PMDoc).content);

// ---- Y.XmlFragment → JSON ------------------------------------------------------------------------------------------

/** y-prosemirror hängt bei überlappenden Marks `--<hash>` an den Namen. */
const markName = (attr: string) => {
  const i = attr.indexOf('--');
  return i > 0 ? attr.slice(0, i) : attr;
};

function textNodes(t: Y.XmlText): PMNode[] {
  const out: PMNode[] = [];
  for (const d of t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof d.insert !== 'string' || !d.insert) continue;
    const node: PMNode = { type: 'text', text: d.insert };
    if (d.attributes) {
      const marks = Object.entries(d.attributes)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => {
          const m: PMMark = { type: markName(k) };
          if (v && typeof v === 'object' && Object.keys(v).length) m.attrs = v as Record<string, unknown>;
          return m;
        });
      if (marks.length) node.marks = marks;
    }
    out.push(node);
  }
  return out;
}

function elementNode(el: Y.XmlElement): PMNode {
  const node: PMNode = { type: el.nodeName };
  const attrs = el.getAttributes() as Record<string, unknown>;
  if (Object.keys(attrs).length) node.attrs = attrs;
  const content = childNodes(el);
  if (content.length) node.content = content;
  return node;
}

function childNodes(parent: Y.XmlFragment | Y.XmlElement): PMNode[] {
  const out: PMNode[] = [];
  for (const c of parent.toArray()) {
    if (c instanceof Y.XmlText) out.push(...textNodes(c));
    else if (c instanceof Y.XmlElement) out.push(elementNode(c));
  }
  return out;
}

/** Lesekopie eines Fragments als ProseMirror-JSON (ohne Schema; lose Texte oben werden zu Absätzen). */
export function fragmentToJson(f: Y.XmlFragment): PMDoc {
  const content: PMNode[] = [];
  for (const c of f.toArray()) {
    if (c instanceof Y.XmlElement) content.push(elementNode(c));
    else if (c instanceof Y.XmlText) {
      const inline = textNodes(c);
      content.push(inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' });
    }
  }
  return { type: 'doc', content };
}

// ---- JSON → Y-Typen (vorläufig, werden beim Einfügen integriert) ----------------------------------------------------

type YChild = Y.XmlElement | Y.XmlText;

const marksToAttrs = (marks: PMMark[] | undefined): Record<string, unknown> | undefined => {
  if (!marks?.length) return undefined;
  const a: Record<string, unknown> = {};
  for (const m of marks) if (m && typeof m.type === 'string' && NAME_RE.test(m.type)) a[m.type] = m.attrs ?? {};
  return a;
};

/** Kinder wie y-prosemirror: benachbarte Textknoten bilden ein Y.XmlText, Marks werden Formatierungsattribute. */
function buildChildren(nodes: PMNode[] | undefined): YChild[] {
  const out: YChild[] = [];
  let run: { insert: string; attributes?: Record<string, unknown> }[] = [];
  const flush = () => {
    if (!run.length) return;
    const t = new Y.XmlText();
    t.applyDelta(run);
    out.push(t);
    run = [];
  };
  for (const n of nodes ?? []) {
    if (!n || typeof n.type !== 'string') continue;
    if (n.type === 'text') {
      if (typeof n.text === 'string' && n.text) run.push(n.marks?.length ? { insert: n.text, attributes: marksToAttrs(n.marks) } : { insert: n.text });
      continue;
    }
    if (!NAME_RE.test(n.type)) continue;
    flush();
    const el = new Y.XmlElement(n.type);
    for (const [k, v] of Object.entries(n.attrs ?? {})) if (v !== null && v !== undefined) el.setAttribute(k, v as string);
    const kids = buildChildren(n.content);
    if (kids.length) el.insert(0, kids);
    out.push(el);
  }
  flush();
  return out;
}

/** Neues (noch nicht eingefügtes) Fragment aus ProseMirror-JSON; undefined bei ungültigen Daten. */
export function jsonToFragment(doc: unknown): Y.XmlFragment | undefined {
  if (!isDoc(doc)) return undefined;
  const f = new Y.XmlFragment();
  const kids = buildChildren(doc.content);
  if (kids.length) f.insert(0, kids);
  return f;
}

/** Inhalt eines eingefügten Fragments ersetzen (im laufenden transact aufrufen). */
export function replaceFragment(f: Y.XmlFragment, doc: PMDoc) {
  if (f.length) f.delete(0, f.length);
  const kids = buildChildren(doc.content);
  if (kids.length) f.insert(0, kids);
}

// ---- Klartext -------------------------------------------------------------------------------------------------------

const isInline = (n: PMNode) => n.type === 'text' || n.type === 'hardBreak';

/** Klartext-Spiegel (Vertrag): Blöcke und Listeneinträge mit `\n` getrennt, Zeilenumbrüche als `\n`. */
export function plainOf(doc: PMDoc | null | undefined): string {
  if (!doc) return '';
  const lines: string[] = [];
  const walk = (n: PMNode) => {
    const kids = n.content ?? [];
    // Textblock: hat Inline-Inhalt oder ist ein leerer Absatz/Überschrift/Code
    if (kids.length ? kids.every(isInline) : n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') {
      lines.push(kids.map((k) => (k.type === 'hardBreak' ? '\n' : (k.text ?? ''))).join(''));
      return;
    }
    kids.forEach(walk);
  };
  doc.content.forEach(walk);
  return lines.join('\n');
}

/** Dokument aus Klartext: je Zeile ein Absatz (Migration). */
export function textToDoc(text: string): PMDoc {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  };
}

/** Rich-Text gilt nur, wenn sein Klartext zum Feld `text` passt (sonst hat ein alter Client `text` geändert). */
export function richDoc(o: Pick<BoardObject, 'content' | 'text'>): PMDoc | null {
  const c = o.content;
  if (!isDoc(c)) return null;
  return plainOf(c) === (o.text ?? '') ? c : null;
}

/** Enthält das Dokument Knoten/Marks, die der Editor nicht kennt? */
export function hasUnknown(doc: PMDoc): boolean {
  const bad = (n: PMNode): boolean =>
    (n.type !== 'text' && !KNOWN_NODES.has(n.type)) || !!n.marks?.some((m) => !KNOWN_MARKS.has(m.type)) || !!n.content?.some(bad);
  return doc.content.some(bad);
}

/** Unbekannte Knoten zu Absätzen (Text bleibt), unbekannte Marks weg – damit der Editor nichts verwirft. */
export function normalizeDoc(doc: PMDoc): PMDoc {
  const inline = (nodes: PMNode[] | undefined): PMNode[] =>
    (nodes ?? []).flatMap((n) => {
      if (n.type === 'text') return [{ ...n, marks: n.marks?.filter((m) => KNOWN_MARKS.has(m.type)) }];
      if (n.type === 'hardBreak') return [n];
      return inline(n.content);
    });
  const block = (n: PMNode): PMNode[] => {
    if (n.type === 'text' || n.type === 'hardBreak') return [{ type: 'paragraph', content: inline([n]) }];
    if (!KNOWN_NODES.has(n.type)) {
      const kids = n.content ?? [];
      if (kids.length && kids.every(isInline)) return [{ type: 'paragraph', content: inline(kids) }];
      return kids.length ? kids.flatMap(block) : [{ type: 'paragraph' }];
    }
    const kids = n.content ?? [];
    if (kids.length && kids.every(isInline)) return [{ ...n, content: inline(kids) }];
    return [kids.length ? { ...n, content: kids.flatMap(block) } : n];
  };
  return { type: 'doc', content: doc.content.flatMap(block) };
}

// ---- Fragment im Objekt (Migration) ---------------------------------------------------------------------------------

export interface StoreLike {
  doc: Y.Doc;
  objects: Y.Map<Y.Map<unknown>>;
  get(id: string): BoardObject | undefined;
  /** Y.Map im Board oder in der Privat-Ablage (BoardStore, docs/features/private.md) */
  mapOf?(id: string): Y.Map<unknown> | undefined;
}

/** Origin für die Migration beim Bearbeiten (nicht im Undo: der Text sieht davor und danach gleich aus). */
export const MIGRATE_ORIGIN = 'richtext:migrate';

/**
 * Fragment `content` eines Objekts, passend zu `text` (Vertrag: Migration, alter Client hat nur `text` geändert,
 * unbekannte Knoten). Läuft im aktuellen transact bzw. mit `origin` in einem eigenen.
 */
export function ensureContent(store: StoreLike, id: string, origin: unknown = MIGRATE_ORIGIN): Y.XmlFragment | null {
  const m = store.mapOf ? store.mapOf(id) : store.objects.get(id);
  if (!m) return null;
  const ydoc = m.doc ?? store.doc;
  const text = (m.get('text') as string | undefined) ?? '';
  const cur = m.get(RICH_TEXT_FIELD);
  if (cur instanceof Y.XmlFragment) {
    const json = fragmentToJson(cur);
    const ok = plainOf(json) === text;
    if (ok && !hasUnknown(json)) return cur;
    ydoc.transact(() => replaceFragment(cur, ok ? normalizeDoc(json) : textToDoc(text)), origin);
    return cur;
  }
  const f = jsonToFragment(text ? textToDoc(text) : { type: 'doc', content: [] })!;
  ydoc.transact(() => m.set(RICH_TEXT_FIELD, f), origin);
  return f;
}

// ---- Format aufs ganze Objekt ---------------------------------------------------------------------------------------

/** Alle Y.XmlText eines Fragments (ohne Code-Blöcke, dort sind keine Marks erlaubt). */
export function textsOf(f: Y.XmlFragment | Y.XmlElement): Y.XmlText[] {
  const out: Y.XmlText[] = [];
  for (const c of f.toArray()) {
    if (c instanceof Y.XmlText) out.push(c);
    else if (c instanceof Y.XmlElement && c.nodeName !== 'codeBlock') out.push(...textsOf(c));
  }
  return out;
}

/** Mark über den ganzen Text setzen (attrs) bzw. entfernen (null). */
export function setMarkAll(f: Y.XmlFragment, mark: string, attrs: Record<string, unknown> | null) {
  for (const t of textsOf(f)) if (t.length) t.format(0, t.length, { [mark]: attrs });
}

/**
 * Attribute eines Marks über den ganzen Text ändern, ohne andere Attribute zu verlieren (z. B. Textfarbe in
 * `textStyle` setzen, Teil-Schriftgröße behalten). `null` entfernt ein Attribut; bleibt keins, verschwindet das Mark.
 */
export function patchMarkAll(f: Y.XmlFragment, mark: string, patch: Record<string, unknown>) {
  for (const t of textsOf(f)) {
    let at = 0;
    for (const d of t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
      const len = typeof d.insert === 'string' ? d.insert.length : 1;
      const cur = d.attributes?.[mark];
      const next: Record<string, unknown> = { ...(cur && typeof cur === 'object' ? (cur as Record<string, unknown>) : {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) delete next[k];
        else next[k] = v;
      }
      if (typeof d.insert === 'string') t.format(at, len, { [mark]: Object.values(next).some((v) => v !== null && v !== undefined) ? next : null });
      at += len;
    }
  }
}

/** Trägt der ganze (nicht leere) Text das Mark? `match` prüft zusätzlich die Attribute. */
export function hasMarkAll(doc: PMDoc | null, mark: string, match?: (attrs: Record<string, unknown> | undefined) => boolean): boolean {
  if (!doc) return false;
  let seen = false;
  let all = true;
  const walk = (n: PMNode, inCode: boolean) => {
    if (n.type === 'text' && n.text && !inCode) {
      seen = true;
      const m = n.marks?.find((k) => k.type === mark);
      if (!m || (match && !match(m.attrs))) all = false;
    }
    n.content?.forEach((k) => walk(k, inCode || n.type === 'codeBlock'));
  };
  doc.content.forEach((n) => walk(n, false));
  return seen && all;
}

/** Erstes Vorkommen eines Marks (z. B. aktuelle Textfarbe); `match` prüft zusätzlich die Attribute. */
export function firstMark(doc: PMDoc | null, mark: string, match?: (attrs: Record<string, unknown> | undefined) => boolean): PMMark | undefined {
  if (!doc) return undefined;
  let found: PMMark | undefined;
  const walk = (n: PMNode) => {
    if (found) return;
    const m = n.marks?.find((k) => k.type === mark && (!match || match(k.attrs)));
    if (m) found = m;
    n.content?.forEach(walk);
  };
  doc.content.forEach(walk);
  return found;
}

/** Inline-Inhalte aller Textblöcke (für Listen-Umbau). */
function textblocks(doc: PMDoc): PMNode[][] {
  const out: PMNode[][] = [];
  const walk = (n: PMNode) => {
    const kids = n.content ?? [];
    if (kids.length ? kids.every(isInline) : n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') {
      out.push(kids);
      return;
    }
    kids.forEach(walk);
  };
  doc.content.forEach(walk);
  return out;
}

export type ListKind = 'bulletList' | 'orderedList' | 'taskList';

/** Ist das ganze Dokument eine einzige Liste dieser Art? */
export const isWholeList = (doc: PMDoc | null, kind: ListKind) => !!doc && doc.content.length === 1 && doc.content[0].type === kind;

/** Ganzen Text zur Liste machen bzw. (ist er schon eine) zurück zu Absätzen. Klartext bleibt gleich. */
export function toggleListDoc(doc: PMDoc, kind: ListKind): PMDoc {
  const blocks = textblocks(doc);
  const para = (inline: PMNode[]): PMNode => (inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' });
  if (isWholeList(doc, kind)) return { type: 'doc', content: blocks.map(para) };
  const item = kind === 'taskList' ? 'taskItem' : 'listItem';
  return {
    type: 'doc',
    content: [{ type: kind, content: blocks.map((b) => ({ type: item, ...(kind === 'taskList' ? { attrs: { checked: false } } : {}), content: [para(b)] })) }],
  };
}

export const isListType = (t: string) => LISTS.has(t);

/** Zeichen am Ende anhängen (Tippen auf ein ausgewähltes Objekt); erbt das Format des letzten Zeichens. */
export function appendText(f: Y.XmlFragment, ch: string) {
  let parent: Y.XmlFragment | Y.XmlElement = f;
  for (;;) {
    const last: unknown = parent.length ? parent.get(parent.length - 1) : null;
    if (last instanceof Y.XmlElement && last.nodeName !== 'hardBreak') {
      const kids = last.toArray();
      if (!kids.length || kids.every((k) => k instanceof Y.XmlText || (k instanceof Y.XmlElement && k.nodeName === 'hardBreak'))) {
        const t = kids.at(-1);
        if (t instanceof Y.XmlText) t.insert(t.length, ch);
        else {
          const nt = new Y.XmlText();
          nt.insert(0, ch);
          last.insert(last.length, [nt]);
        }
        return;
      }
      parent = last;
      continue;
    }
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, ch);
    p.insert(0, [t]);
    parent.insert(parent.length, [p]);
    return;
  }
}

/** Feld-Codec für `content` (Schnappschuss-Lesekopie = ProseMirror-JSON, Einfügen baut ein neues Fragment). */
export const contentCodec = {
  toPlain: (v: Y.AbstractType<any>): unknown => (v instanceof Y.XmlFragment ? fragmentToJson(v) : v.toJSON()),
  fromPlain: (v: unknown): Y.AbstractType<any> | undefined => jsonToFragment(v),
};

// ---- Checkliste ohne Bearbeitung -------------------------------------------------------------------------------------

/** Alle taskItem-Elemente in Dokument-Reihenfolge (wie die statische Anzeige sie zeichnet). */
export function taskItems(f: Y.XmlFragment | Y.XmlElement): Y.XmlElement[] {
  const out: Y.XmlElement[] = [];
  for (const c of f.toArray()) {
    if (!(c instanceof Y.XmlElement)) continue;
    if (c.nodeName === 'taskItem') out.push(c);
    out.push(...taskItems(c));
  }
  return out;
}

/** Häkchen des `index`-ten Eintrags umschalten (Klick auf das Kästchen in der Anzeige). Liefert den neuen Stand. */
export function toggleTask(f: Y.XmlFragment, index: number): boolean | null {
  const it = taskItems(f)[index];
  if (!it) return null;
  const cur = it.getAttribute('checked') as unknown;
  const next = !(cur === true || cur === 'true');
  it.setAttribute('checked', next as unknown as string);
  return next;
}
