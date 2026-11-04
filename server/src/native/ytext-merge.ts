// Klartext-Felder der App zusammenführen (Karten-Beschreibung und -Titel, Tabellenzellen; Paket P3, von P9 für
// Zeitleisten-Titel mitbenutzt): wie `richmerge.ts`, aber nur Zeichen ohne Marks.
//
// - mergeText(Basis, App, aktuell): beide Änderungen gegenüber der Basis Zeichen für Zeichen (Myers-Diff) zusammenlegen.
//   Getrennte Stellen bleiben beide; gleichzeitig an derselben Stelle eingefügter Text bleibt auch beide (erst der
//   vorhandene, dann der der App); nur wenn beide dieselbe Stelle unterschiedlich ändern, gewinnt die App (der spätere
//   Stand) und `conflict` ist gesetzt.
// - applyText(Y.Text, Ziel): schreibt nur den Unterschied ins Y.Text (gleiche Zeichen bleiben dieselben Yjs-Elemente,
//   Schreibmarken anderer bleiben stehen).
// Gezählt wird in Unicode-Zeichen (Emoji werden nie halbiert), geschrieben in UTF-16-Einheiten wie Yjs.
// Reine Funktionen ohne Web-Code. Die Web-Aktionen (web/src/features/<modul>/native.ts) bekommen sie über
// `ctx.text` (web/src/native/registry.ts, eingesetzt in web-impl.ts) – Web-Code importiert keinen Server-Code.
import { diffKeys } from './richmerge';

/** Was `applyText` von einem Y.Text braucht (ohne Yjs-Typen: Server- und Web-Yjs sind getrennte Pakete). */
export interface TextTarget {
  toString(): string;
  delete(index: number, length: number): void;
  insert(index: number, text: string): void;
}

export interface TextMerge {
  text: string;
  /** dieselbe Stelle unterschiedlich geändert: die App hat gewonnen */
  conflict: boolean;
}

interface Hunk {
  bStart: number;
  bEnd: number;
  oStart: number;
  oEnd: number;
}

const chars = (s: string) => Array.from(s);
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Änderungen Basis→mine und Basis→theirs zusammenlegen (`mine` = die App, `theirs` = der aktuelle Stand). */
export function mergeText(base: string, mine: string, theirs: string): TextMerge {
  if (mine === theirs || base === theirs) return { text: mine, conflict: false };
  if (base === mine) return { text: theirs, conflict: false };
  const B = chars(base);
  const A = chars(mine);
  const C = chars(theirs);
  const ha = diffKeys(B, A).map((h) => ({ ...h, side: 'a' as const }));
  const hc = diffKeys(B, C).map((h) => ({ ...h, side: 'c' as const }));
  const all = [...ha, ...hc].sort((p, q) => p.bStart - q.bStart || p.bEnd - p.bStart - (q.bEnd - q.bStart));
  const out: string[] = [];
  let pos = 0;
  let offA = 0;
  let offC = 0;
  let conflict = false;
  let i = 0;
  while (i < all.length) {
    const group = [all[i]!];
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
    const lo = Math.min(...group.map((h) => h.bStart));
    out.push(...B.slice(pos, lo));
    const ga = group.filter((h) => h.side === 'a');
    const gc = group.filter((h) => h.side === 'c');
    const delta = (hs: Hunk[]) => hs.reduce((s, h) => s + (h.oEnd - h.oStart) - (h.bEnd - h.bStart), 0);
    const regionA = A.slice(lo + offA, hi + offA + delta(ga));
    const regionC = C.slice(lo + offC, hi + offC + delta(gc));
    if (!gc.length) out.push(...regionA);
    else if (!ga.length) out.push(...regionC);
    else if (same(regionA, regionC)) out.push(...regionA);
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
  return { text: out.join(''), conflict };
}

/** Länge der ersten `n` Unicode-Zeichen in UTF-16-Einheiten. */
const units = (cs: readonly string[], n: number) => {
  let u = 0;
  for (let k = 0; k < n; k++) u += cs[k]!.length;
  return u;
};

/** Y.Text gleich `target` machen – nur die Unterschiede (von hinten nach vorn, damit die Stellen gültig bleiben). */
export function applyText(t: TextTarget, target: string): void {
  const cur = t.toString();
  if (cur === target) return;
  const a = chars(cur);
  const b = chars(target);
  const hunks = diffKeys(a, b);
  for (let k = hunks.length - 1; k >= 0; k--) {
    const h = hunks[k]!;
    const at = units(a, h.bStart);
    const del = units(a, h.bEnd) - at;
    if (del) t.delete(at, del);
    const ins = b.slice(h.oStart, h.oEnd).join('');
    if (ins) t.insert(at, ins);
  }
}

/**
 * Eingabe der App (`text`, ausgehend von `base`) in ein Y.Text übernehmen: Zusammenführen mit dem aktuellen Stand,
 * dann nur den Unterschied schreiben. Ohne `base` (unbekannt) gilt `text`, `conflict`, wenn der Stand abwich.
 */
export function mergeIntoYText(t: TextTarget, base: string | null | undefined, text: string): TextMerge {
  const cur = t.toString();
  const m = typeof base === 'string' ? mergeText(base, text, cur) : { text, conflict: cur !== text && cur !== '' };
  applyText(t, m.text);
  return m;
}
