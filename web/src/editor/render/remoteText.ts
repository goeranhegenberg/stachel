// Gleichzeitiges Bearbeiten desselben Textes (bis Y.Text kommt, Vertrag v2).

/** Eigener und fremder Stand zusammengeführt: der fremde Text geht nicht verloren, sondern kommt als neue Zeile dazu. */
export function mergeRemoteText(own: string, foreign: string | null): string {
  if (foreign === null || foreign === own || own.includes(foreign)) return own;
  if (!own.trim() || foreign.includes(own)) return foreign;
  return `${own}\n${foreign}`;
}
