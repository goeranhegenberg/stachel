// Rich-Text-Bearbeitung der App (docs/contract.md §8.6 `text`, Konzept §4.6): Drei-Wege-Zusammenführung zweier
// ProseMirror-JSON-Stände auf einer gemeinsamen Basis und kleinster Unterschied ins Y.XmlFragment (y-prosemirror-Format).
//
// - merge3(Basis, App, aktuell): beide Änderungen gegenüber der Basis als Zeichen-/Knoten-Folge (Token) vergleichen
//   (Myers-Diff) und zusammenlegen. Getrennte Stellen bleiben beide erhalten; gleichzeitig an derselben Stelle
//   eingefügter Text bleibt auch beide (erst der vorhandene, dann der der App); nur wenn beide dieselbe Stelle
//   unterschiedlich ändern, gewinnt die App (der spätere Stand) und `conflict` wird gesetzt.
// - applyDocToFragment: macht das Fragment gleich dem Ziel, rührt aber gleiche Knoten und gleichen Text nicht an
//   (fremde Schreibmarken und Rückgängig im Web bleiben stabil). Unbekannte Knoten/Marks/Attribute bleiben, wie sie sind.
// Reine Funktionen ohne Web-Code; Knoten-/Mark-Namen und Attribute werden nicht geprüft, nur weitergereicht.
import * as Y from 'yjs';

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

export const isPMDoc = (v: unknown): v is PMDoc =>
  !!v && typeof v === 'object' && (v as PMDoc).type === 'doc' && Array.isArray((v as PMDoc).content);

/** JSON mit sortierten Schlüsseln (Vergleich unabhängig von der Reihenfolge der Attribute). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const emptyAttrs = (a: unknown) => !a || (typeof a === 'object' && !Object.keys(a as object).length);

/** Marks in fester Form: ohne leere `attrs`. */
function normMarks(marks: PMMark[] | undefined): PMMark[] {
  return (marks ?? []).filter((m) => m && typeof m.type === 'string').map((m) => (emptyAttrs(m.attrs) ? { type: m.type } : { type: m.type, attrs: m.attrs }));
}

/** Dokument in fester Form (gleiche Inhalte → gleiches JSON): benachbarte Texte mit gleichen Marks zusammen, leere weg. */
export function normalizeDoc(doc: PMDoc): PMDoc {
  return { type: 'doc', content: normNodes(doc.content) };
}

function normNodes(nodes: PMNode[] | undefined): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes ?? []) {
    if (!n || typeof n.type !== 'string') continue;
    if (n.type === 'text') {
      if (typeof n.text !== 'string' || !n.text) continue;
      const marks = normMarks(n.marks);
      const last = out[out.length - 1];
      if (last?.type === 'text' && stableJson(last.marks ?? []) === stableJson(marks)) {
        last.text += n.text;
        continue;
      }
      out.push(marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text });
      continue;
    }
    const node: PMNode = { type: n.type };
    if (!emptyAttrs(n.attrs)) node.attrs = n.attrs;
    const marks = normMarks(n.marks);
    if (marks.length) node.marks = marks;
    const content = normNodes(n.content);
    if (content.length) node.content = content;
    out.push(node);
  }
  return out;
}

export const sameDoc = (a: PMDoc, b: PMDoc) => stableJson(normalizeDoc(a)) === stableJson(normalizeDoc(b));

// ---- Token ------------------------------------------------------------------------------------------------------------

type Tok = { k: 'open'; node: PMNode; key: string } | { k: 'close'; key: string } | { k: 'char'; ch: string; marks: PMMark[]; key: string };

const CLOSE: Tok = { k: 'close', key: ')' };

function tokens(doc: PMDoc): Tok[] {
  const out: Tok[] = [];
  const walk = (n: PMNode) => {
    if (n.type === 'text') {
      const marks = normMarks(n.marks);
      const mk = stableJson(marks);
      for (const ch of Array.from(n.text ?? '')) out.push({ k: 'char', ch, marks, key: `c${ch}${mk}` });
      return;
    }
    const head: PMNode = { type: n.type };
    if (!emptyAttrs(n.attrs)) head.attrs = n.attrs;
    const marks = normMarks(n.marks);
    if (marks.length) head.marks = marks;
    out.push({ k: 'open', node: head, key: `o${stableJson(head)}` });
    (n.content ?? []).forEach(walk);
    out.push(CLOSE);
  };
  normalizeDoc(doc).content.forEach(walk);
  return out;
}

/** Token-Folge → Dokument; repariert Unausgewogenes (überzählige Enden weg, offene schließen, Text oben → Absatz). */
function fromTokens(toks: Tok[]): PMDoc {
  const root: PMNode = { type: 'doc', content: [] };
  const stack: PMNode[] = [root];
  for (const t of toks) {
    const top = stack[stack.length - 1]!;
    if (t.k === 'open') {
      const node: PMNode = { ...t.node };
      (top.content ??= []).push(node);
      stack.push(node);
    } else if (t.k === 'close') {
      if (stack.length > 1) stack.pop();
    } else {
      let parent = top;
      if (parent === root) {
        // Text direkt im Dokument: in einen Absatz
        const last = root.content![root.content!.length - 1];
        if (last?.type === 'paragraph' && last.content?.every((c) => c.type === 'text')) parent = last;
        else {
          parent = { type: 'paragraph', content: [] };
          root.content!.push(parent);
        }
      }
      const kids = (parent.content ??= []);
      const last = kids[kids.length - 1];
      if (last?.type === 'text' && stableJson(last.marks ?? []) === stableJson(t.marks)) last.text += t.ch;
      else kids.push(t.marks.length ? { type: 'text', text: t.ch, marks: t.marks } : { type: 'text', text: t.ch });
    }
  }
  return normalizeDoc({ type: 'doc', content: root.content ?? [] });
}

// ---- Diff -------------------------------------------------------------------------------------------------------------

/** Geänderter Bereich: base[bStart, bEnd) wurde zu other[oStart, oEnd). */
export interface Hunk {
  bStart: number;
  bEnd: number;
  oStart: number;
  oEnd: number;
}

/** Oberhalb dieser Zahl von Unterschieden wird der Mittelteil als ein Block ersetzt (Rechenzeit begrenzen). */
const MAX_EDITS = 1000;

/** Myers-Diff zweier Schlüssel-Folgen als zusammenhängende Änderungsbereiche. */
export function diffKeys(a: readonly string[], b: readonly string[]): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return [];
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return [{ bStart: start, bEnd: endA, oStart: start, oEnd: endB }];
  const max = Math.min(n + m, MAX_EDITS);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [{ bStart: start, bEnd: endA, oStart: start, oEnd: endB }];
  // Rückweg: Schritte (gleich / löschen / einfügen) sammeln
  const ops: ('=' | '-' | '+')[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vv = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vv[off + k - 1]! < vv[off + k + 1]!) ? k + 1 : k - 1;
    const prevX = vv[off + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('=');
      x--;
      y--;
    }
    if (x === prevX) {
      ops.push('+');
      y--;
    } else {
      ops.push('-');
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push('=');
    x--;
    y--;
  }
  ops.reverse();
  const hunks: Hunk[] = [];
  let i = start;
  let j = start;
  let cur: Hunk | null = null;
  for (const op of ops) {
    if (op === '=') {
      if (cur) hunks.push(cur);
      cur = null;
      i++;
      j++;
      continue;
    }
    cur ??= { bStart: i, bEnd: i, oStart: j, oEnd: j };
    if (op === '-') cur.bEnd = ++i;
    else cur.oEnd = ++j;
  }
  if (cur) hunks.push(cur);
  return hunks;
}

// ---- Drei-Wege-Zusammenführung ----------------------------------------------------------------------------------------

export interface MergeResult {
  doc: PMDoc;
  /** dieselbe Stelle unterschiedlich geändert: die App hat gewonnen */
  conflict: boolean;
}

/**
 * Änderungen Basis→mine und Basis→theirs zusammenlegen. `mine` = die App (später), `theirs` = der aktuelle Stand im
 * Dokument (Änderungen anderer seit der Basis).
 */
export function merge3(base: PMDoc, mine: PMDoc, theirs: PMDoc): MergeResult {
  const B = tokens(base);
  const A = tokens(mine);
  const C = tokens(theirs);
  const keys = (t: Tok[]) => t.map((x) => x.key);
  const kb = keys(B);
  const ha = diffKeys(kb, keys(A)).map((h) => ({ ...h, side: 'a' as const }));
  const hc = diffKeys(kb, keys(C)).map((h) => ({ ...h, side: 'c' as const }));
  const all = [...ha, ...hc].sort((p, q) => p.bStart - q.bStart || p.bEnd - p.bStart - (q.bEnd - q.bStart));
  const out: Tok[] = [];
  let pos = 0;
  let offA = 0;
  let offC = 0;
  let conflict = false;
  let i = 0;
  while (i < all.length) {
    const group = [all[i]!];
    let lo = all[i]!.bStart;
    let hi = all[i]!.bEnd;
    i++;
    while (i < all.length) {
      const h = all[i]!;
      const last = group[group.length - 1]!;
      // überlappt, oder fügt genau dort ein, wo die Gruppe endet bzw. eingefügt hat
      const joins = h.bStart < hi || (h.bStart === hi && (h.bStart === h.bEnd || last.bStart === last.bEnd));
      if (!joins) break;
      group.push(h);
      hi = Math.max(hi, h.bEnd);
      i++;
    }
    lo = Math.min(lo, ...group.map((h) => h.bStart));
    out.push(...B.slice(pos, lo));
    const ga = group.filter((h) => h.side === 'a');
    const gc = group.filter((h) => h.side === 'c');
    const delta = (hs: Hunk[]) => hs.reduce((s, h) => s + (h.oEnd - h.oStart) - (h.bEnd - h.bStart), 0);
    const regionA = A.slice(lo + offA, hi + offA + delta(ga));
    const regionC = C.slice(lo + offC, hi + offC + delta(gc));
    if (!gc.length) out.push(...regionA);
    else if (!ga.length) out.push(...regionC);
    else if (stableJson(keys(regionA)) === stableJson(keys(regionC))) out.push(...regionA);
    else if (lo === hi) out.push(...regionC, ...regionA); // beide nur eingefügt: beides behalten
    else {
      out.push(...regionA);
      conflict = true;
    }
    offA += delta(ga);
    offC += delta(gc);
    pos = hi;
  }
  out.push(...B.slice(pos));
  return { doc: fromTokens(out), conflict };
}

// ---- Fragment angleichen ----------------------------------------------------------------------------------------------

/** y-prosemirror hängt bei überlappenden Marks `--<hash>` an den Namen. */
const markName = (attr: string) => {
  const i = attr.indexOf('--');
  return i > 0 ? attr.slice(0, i) : attr;
};

type Run = { insert: string; attributes: Record<string, unknown> };
type Target = { kind: 'text'; runs: Run[] } | { kind: 'el'; node: PMNode };

const attrsOf = (marks: PMMark[] | undefined): Record<string, unknown> => {
  const a: Record<string, unknown> = {};
  for (const m of normMarks(marks)) a[m.type] = m.attrs ?? {};
  return a;
};

/** Kinder eines Knotens wie y-prosemirror: benachbarte Texte = ein Y.XmlText. */
function targetsOf(nodes: PMNode[] | undefined): Target[] {
  const out: Target[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      if (!n.text) continue;
      const last = out[out.length - 1];
      const run = { insert: n.text, attributes: attrsOf(n.marks) };
      if (last?.kind === 'text') last.runs.push(run);
      else out.push({ kind: 'text', runs: [run] });
    } else out.push({ kind: 'el', node: n });
  }
  return out;
}

/** Läufe eines Y.XmlText mit Mark-Namen ohne `--hash`. */
function runsOf(t: Y.XmlText): Run[] {
  const out: Run[] = [];
  for (const d of t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof d.insert !== 'string' || !d.insert) continue;
    const attributes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d.attributes ?? {})) if (v !== null && v !== undefined) attributes[markName(k)] = emptyAttrs(v) ? {} : v;
    out.push({ insert: d.insert, attributes });
  }
  return out;
}

const runsKey = (runs: Run[]) => {
  // gleich formatierte Nachbarn zusammen, damit die Aufteilung keine Rolle spielt
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && stableJson(last.attributes) === stableJson(r.attributes)) last.insert += r.insert;
    else merged.push({ insert: r.insert, attributes: r.attributes });
  }
  return stableJson(merged);
};

/** JSON eines Y-Kinds wie fragmentToJson (für den Vergleich mit dem Ziel). */
function childKey(c: unknown): string {
  if (c instanceof Y.XmlText) return `t${runsKey(runsOf(c))}`;
  if (c instanceof Y.XmlElement) return `e${stableJson(normalizeDoc({ type: 'doc', content: [elementJson(c)] }).content[0])}`;
  return `?`;
}

function elementJson(el: Y.XmlElement): PMNode {
  const node: PMNode = { type: el.nodeName };
  const attrs = el.getAttributes() as Record<string, unknown>;
  if (Object.keys(attrs).length) node.attrs = attrs;
  const content: PMNode[] = [];
  for (const c of el.toArray()) {
    if (c instanceof Y.XmlText) for (const r of runsOf(c)) content.push({ type: 'text', text: r.insert, marks: Object.entries(r.attributes).map(([type, a]) => (emptyAttrs(a) ? { type } : { type, attrs: a as Record<string, unknown> })) });
    else if (c instanceof Y.XmlElement) content.push(elementJson(c));
  }
  if (content.length) node.content = content;
  return node;
}

function targetKey(t: Target): string {
  if (t.kind === 'text') return `t${runsKey(t.runs)}`;
  return `e${stableJson(normalizeDoc({ type: 'doc', content: [t.node] }).content[0])}`;
}

function buildChild(t: Target): Y.XmlText | Y.XmlElement {
  if (t.kind === 'text') {
    const x = new Y.XmlText();
    x.applyDelta(t.runs.map((r) => (Object.keys(r.attributes).length ? { insert: r.insert, attributes: r.attributes } : { insert: r.insert })));
    return x;
  }
  const el = new Y.XmlElement(t.node.type);
  for (const [k, v] of Object.entries(t.node.attrs ?? {})) if (v !== null && v !== undefined) el.setAttribute(k, v as string);
  const kids = targetsOf(t.node.content).map(buildChild);
  if (kids.length) el.insert(0, kids);
  return el;
}

const compatible = (c: unknown, t: Target) => (t.kind === 'text' ? c instanceof Y.XmlText : c instanceof Y.XmlElement && c.nodeName === t.node.type);

function syncText(x: Y.XmlText, runs: Run[]) {
  // Zeichen mit Format vergleichen (Code-Einheiten; Ersatzpaare nicht trennen)
  const flat = (rs: Run[]) => {
    const chars: string[] = [];
    const fmt: string[] = [];
    for (const r of rs) {
      const f = stableJson(r.attributes);
      for (let i = 0; i < r.insert.length; i++) {
        chars.push(r.insert[i]!);
        fmt.push(f);
      }
    }
    return { chars, fmt };
  };
  const cur = flat(runsOf(x));
  const next = flat(runs);
  const same = (i: number, j: number) => cur.chars[i] === next.chars[j] && cur.fmt[i] === next.fmt[j];
  let p = 0;
  while (p < cur.chars.length && p < next.chars.length && same(p, p)) p++;
  let s = 0;
  while (s < cur.chars.length - p && s < next.chars.length - p && same(cur.chars.length - 1 - s, next.chars.length - 1 - s)) s++;
  // nicht mitten in einem Ersatzpaar schneiden
  const hi = (c: string | undefined) => !!c && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdbff;
  const lo = (c: string | undefined) => !!c && c.charCodeAt(0) >= 0xdc00 && c.charCodeAt(0) <= 0xdfff;
  while (p > 0 && hi(cur.chars[p - 1])) p--;
  while (s > 0 && lo(cur.chars[cur.chars.length - s])) s--;
  const delLen = cur.chars.length - p - s;
  if (delLen > 0) x.delete(p, delLen);
  // Einfügen mit genau den Marks des Ziels (ein leeres Attribut-Objekt nimmt geerbte Marks weg)
  let at = p;
  const end = next.chars.length - s;
  let j = p;
  while (j < end) {
    let k = j;
    while (k < end && next.fmt[k] === next.fmt[j]) k++;
    const text = next.chars.slice(j, k).join('');
    const attrs = JSON.parse(next.fmt[j]!) as Record<string, unknown>;
    // Marks des Nachbarn ausdrücklich abschalten, sonst erbt der Text sie
    x.insert(at, text, attrs);
    at += text.length;
    j = k;
  }
}

function syncElementAttrs(el: Y.XmlElement, attrs: Record<string, unknown> | undefined) {
  const cur = el.getAttributes() as Record<string, unknown>;
  const next = attrs ?? {};
  for (const k of Object.keys(cur)) if (!(k in next) || next[k] === null || next[k] === undefined) el.removeAttribute(k);
  for (const [k, v] of Object.entries(next)) if (v !== null && v !== undefined && stableJson(cur[k]) !== stableJson(v)) el.setAttribute(k, v as string);
}

function syncChildren(parent: Y.XmlFragment | Y.XmlElement, nodes: PMNode[] | undefined) {
  const targets = targetsOf(nodes);
  const cur = parent.toArray();
  const ck = cur.map(childKey);
  const tk = targets.map(targetKey);
  let p = 0;
  while (p < cur.length && p < targets.length && ck[p] === tk[p]) p++;
  let s = 0;
  while (s < cur.length - p && s < targets.length - p && ck[cur.length - 1 - s] === tk[targets.length - 1 - s]) s++;
  let curEnd = cur.length - s;
  let tEnd = targets.length - s;
  // Mittelteil: von vorne, dann von hinten passende Knoten an Ort und Stelle angleichen
  let i = p;
  while (i < curEnd && i < tEnd && compatible(cur[i], targets[i]!)) {
    syncNode(cur[i]!, targets[i]!);
    i++;
  }
  while (curEnd > i && tEnd > i && compatible(cur[curEnd - 1], targets[tEnd - 1]!)) {
    syncNode(cur[curEnd - 1]!, targets[tEnd - 1]!);
    curEnd--;
    tEnd--;
  }
  if (curEnd > i) parent.delete(i, curEnd - i);
  const fresh = targets.slice(i, tEnd).map(buildChild);
  if (fresh.length) parent.insert(i, fresh);
}

function syncNode(c: unknown, t: Target) {
  if (t.kind === 'text') syncText(c as Y.XmlText, t.runs);
  else {
    const el = c as Y.XmlElement;
    syncElementAttrs(el, t.node.attrs);
    syncChildren(el, t.node.content);
  }
}

/** Fragment gleich `doc` machen, mit möglichst kleinen Änderungen (im laufenden transact aufrufen). */
export function applyDocToFragment(f: Y.XmlFragment, doc: PMDoc) {
  syncChildren(f, normalizeDoc(doc).content);
}
