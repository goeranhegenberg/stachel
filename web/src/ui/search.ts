// Suche ohne Groß/Klein und Umlaut-tolerant: „Gelände", „gelande" und „gelaende" finden dasselbe.

interface Folded {
  text: string;
  /** je Zeichen in `text`: Start- und Endindex (exklusiv) im Original */
  start: number[];
  end: number[];
}

/** Faltet einen Text für die Suche und merkt sich, woher jedes Zeichen kommt. */
export function fold(s: string): Folded {
  let text = '';
  const start: number[] = [];
  const end: number[] = [];
  let i = 0;
  for (const ch of s) {
    const len = ch.length;
    let f = ch === 'ß' || ch === 'ẞ' ? 'ss' : ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    // „ae/oe/ue" wie „ä/ö/ü" behandeln: das e nach a/o/u fällt weg
    if (f === 'e' && text.length > 0 && 'aou'.includes(text[text.length - 1]!) && end[end.length - 1] === i) {
      end[end.length - 1] = i + len;
      f = '';
    }
    // je UTF-16-Einheit, damit indexOf-Positionen passen
    for (let k = 0; k < f.length; k++) {
      start.push(i);
      end.push(i + len);
    }
    text += f;
    i += len;
  }
  return { text, start, end };
}

/** Normalisierte Suchanfrage (Leerzeichen zusammengefasst). */
export const foldQuery = (q: string) => fold(q.trim().replace(/\s+/g, ' ')).text;

/** Fundstelle im Original als [von, bis) oder null. */
export function findMatch(haystack: string, query: string): [number, number] | null {
  const q = foldQuery(query);
  if (!q) return null;
  const f = fold(haystack);
  const at = f.text.indexOf(q);
  if (at < 0) return null;
  return [f.start[at]!, f.end[at + q.length - 1]!];
}
