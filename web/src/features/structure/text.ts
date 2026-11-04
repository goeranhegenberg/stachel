// Zeilenumbruch wie im Browser (grob): für Höhen von Mindmap-Knoten, Tabellenzeilen und Vorschauen.

export type Measure = (s: string) => number;

/** Text in Zeilen umbrechen (Absätze an \n, Wörter an Leerzeichen, überlange Wörter zeichenweise). */
export function wrapText(text: string, maxW: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(?<=\s)/);
    let line = '';
    for (const word of words) {
      const next = line + word;
      if (!line || measure(next.trimEnd()) <= maxW) {
        line = next;
        if (measure(line.trimEnd()) > maxW) {
          // ein einzelnes Wort ist breiter als die Zeile: zeichenweise teilen
          let part = '';
          for (const ch of line) {
            if (part && measure(part + ch) > maxW) {
              out.push(part);
              part = '';
            }
            part += ch;
          }
          line = part;
        }
        continue;
      }
      out.push(line.trimEnd());
      line = word.trimStart();
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Breiteste Zeile. */
export const widest = (lines: string[], measure: Measure) => lines.reduce((m, l) => Math.max(m, measure(l)), 0);
