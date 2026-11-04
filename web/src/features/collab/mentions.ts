// @Erwähnungen: Eingabe erkennen, Namen einsetzen, erwähnte Personen bestimmen, Text in Abschnitte teilen.

export interface Person {
  key: string;
  name: string;
}

/** Offene Erwähnung vor dem Cursor („… @Ma|“) – Start des @ und bisher getippter Teil. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s|[(\[{"„]/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /[\n@]/.test(query) || /\s{2}/.test(query)) return null;
  return { start: at, query };
}

/**
 * Erwähnung schon fertig: „@Lena␠“ – der vollständige Name samt Leerzeichen dahinter. Dann keine Vorschläge mehr,
 * sonst übernähme jedes Enter den Namen erneut und der Kommentar ließe sich nie absenden.
 */
export function mentionDone(query: string, people: readonly Person[]): boolean {
  if (!/\s$/.test(query)) return false;
  const q = query.trim().toLocaleLowerCase('de');
  return !!q && people.some((p) => p.name.trim().toLocaleLowerCase('de') === q);
}

/** Passende Personen zur Eingabe (Anfang von Vor- oder Nachname zuerst). */
export function matchPeople(people: readonly Person[], query: string, limit = 6): Person[] {
  const q = query.trim().toLocaleLowerCase('de');
  if (!q) return people.slice(0, limit);
  const scored: [Person, number][] = [];
  for (const p of people) {
    const n = p.name.toLocaleLowerCase('de');
    const score = n.startsWith(q) ? 0 : n.split(/[\s-]+/).some((w) => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : -1;
    if (score >= 0) scored.push([p, score]);
  }
  return scored
    .sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name, 'de'))
    .slice(0, limit)
    .map(([p]) => p);
}

/** Name an der offenen Erwähnung einsetzen; liefert neuen Text und Cursor. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const ins = `@${name} `;
  // Rest des angefangenen Worts ersetzen, kein doppeltes Leerzeichen
  const after = text.slice(caret).replace(/^\S*/, '').replace(/^ /, '');
  return { text: text.slice(0, start) + ins + after, caret: start + ins.length };
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** Fundstellen „@Name“ (längste Namen zuerst, Wortgrenze dahinter). */
function findMentions(text: string, people: readonly Person[]): { start: number; end: number; person: Person }[] {
  const sorted = [...people].filter((p) => p.name.trim()).sort((a, b) => b.name.length - a.name.length);
  const hits: { start: number; end: number; person: Person }[] = [];
  const lower = text.toLocaleLowerCase('de');
  for (let i = lower.indexOf('@'); i >= 0; i = lower.indexOf('@', i + 1)) {
    if (i > 0 && isWordChar(text[i - 1])) continue;
    for (const p of sorted) {
      const n = p.name.toLocaleLowerCase('de');
      if (lower.startsWith(n, i + 1) && !isWordChar(text[i + 1 + n.length])) {
        hits.push({ start: i, end: i + 1 + n.length, person: p });
        break;
      }
    }
  }
  return hits;
}

/** userKeys aller im Text erwähnten Personen (ohne Doppelte). */
export function extractMentions(text: string, people: readonly Person[]): string[] {
  return [...new Set(findMentions(text, people).map((h) => h.person.key))];
}

/** Text in Abschnitte teilen, Erwähnungen markiert (zum Hervorheben). */
export function splitMentions(text: string, people: readonly Person[]): { text: string; key?: string }[] {
  const out: { text: string; key?: string }[] = [];
  let pos = 0;
  for (const h of findMentions(text, people)) {
    if (h.start > pos) out.push({ text: text.slice(pos, h.start) });
    out.push({ text: text.slice(h.start, h.end), key: h.person.key });
    pos = h.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}
