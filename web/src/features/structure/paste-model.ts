// „Einfügen als …“ ohne React: Tabellendaten (Excel, Google Tabellen, TSV) bzw. mehrzeiligen Text erkennen und daraus
// eine Tabelle, Haftnotizen je Zelle/Zeile oder eine Haftnotiz bauen. Der Dialog (paste.tsx) und die Web-Aktion der App
// (native.ts, `structure.paste`) benutzen dieselben Funktionen.
import { nanoid } from 'nanoid';
import type { BoardObject } from '../../protocol';
import type { Point } from '../../board/geometry';
import { tableFrom } from './table/model';
import { newTable } from './table/create';

/** Haftnotiz, wie das Notiz-Werkzeug sie anlegt (Größe, Farbe; Lage wird gesetzt). */
export type NoteBase = Partial<BoardObject> & { w: number; h: number };

/** mehr Notizen bzw. Zellen auf einmal nicht (Versehen beim Einfügen eines ganzen Dokuments) */
export const MAX_NOTES = 200;
export const MAX_ROWS = 300;
export const MAX_COLS = 40;
const NOTE_GAP = 20;

/** Zeilenenden vereinheitlichen, abschließende Leerzeile (Excel) weg. */
const clean = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');

/** Nicht-leere Zeilen (für „eine Notiz je Zeile“). */
export const pasteLines = (text: string) =>
  clean(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Tabellendaten (Tab-getrennt wie aus Excel/Google Tabellen, Felder mit Zeilenumbruch in "…"), sonst null.
 * Mindestens eine Zeile muss zwei Spalten haben.
 */
export function parseTsv(text: string): string[][] | null {
  const s = clean(text);
  if (!s.includes('\t')) return null;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i <= s.length) {
    let cell = '';
    if (s[i] === '"') {
      // Feld in Anführungszeichen: "" = ein Anführungszeichen, Tabs/Zeilenumbrüche gehören zum Feld
      i++;
      while (i < s.length) {
        if (s[i] === '"' && s[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else if (s[i] === '"') {
          i++;
          break;
        } else cell += s[i++];
      }
      while (i < s.length && s[i] !== '\t' && s[i] !== '\n') cell += s[i++];
    } else {
      while (i < s.length && s[i] !== '\t' && s[i] !== '\n') cell += s[i++];
    }
    row.push(cell.trim());
    if (i >= s.length || s[i] === '\n') {
      rows.push(row);
      row = [];
    }
    i++;
  }
  if (!rows.some((r) => r.length > 1)) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<string>(cols - r.length).fill('')]);
}

/** Was eingefügt werden kann. */
export interface PasteChoice {
  table: string[][] | null;
  lines: string[];
}

/** Braucht der Text eine Abfrage (Tabelle oder mehrere Zeilen)? */
export function pasteChoice(text: string): PasteChoice | null {
  const table = parseTsv(text);
  const lines = pasteLines(text);
  if (!table && lines.length < 2) return null;
  return { table, lines };
}

const asObject = (o: Partial<BoardObject>): BoardObject => ({ z: '', createdBy: '', updatedAt: '', ...o, id: nanoid() }) as BoardObject;

/** Haftnotizen im Raster (`cols` Spalten); eingefügt wird um die Mitte der Einfüge-Stelle. */
export function notesGrid(base: NoteBase, texts: string[], cols: number): BoardObject[] {
  const step = { x: base.w + NOTE_GAP, y: base.h + NOTE_GAP };
  const out: BoardObject[] = [];
  texts.slice(0, MAX_NOTES).forEach((t, i) => {
    if (!t) return;
    out.push(asObject({ ...base, x: (i % cols) * step.x, y: Math.floor(i / cols) * step.y, text: t.slice(0, 2000) }));
  });
  return out;
}

/** Tabelle aus Zeilen (erste Zeile als Kopfzeile). */
export function tableObject(rows: string[][], at: Point = { x: 0, y: 0 }): BoardObject {
  const data = rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS));
  const cols = Math.max(1, ...data.map((r) => r.length));
  const w = Math.min(1600, Math.max(320, cols * 150));
  return asObject(newTable(at, tableFrom(data), w));
}

/** Alles als eine Haftnotiz (wie bisher); Tabs als Leerzeichen, sonst stimmen Messung und Darstellung nicht überein. */
export function singleNote(base: NoteBase, text: string): BoardObject {
  return asObject({ ...base, text: clean(text).replace(/\t/g, '  ').slice(0, 2000) });
}

/** Haftnotizen aus der Abfrage (Tabelle: je Zelle in Spalten wie die Tabelle, Text: je Zeile im Quadrat-Raster). */
export function notesOf(base: NoteBase, choice: PasteChoice): BoardObject[] {
  const { table, lines } = choice;
  return table ? notesGrid(base, table.flat(), table[0].length) : notesGrid(base, lines, Math.ceil(Math.sqrt(lines.length)));
}

/** Anzahl Notizen, die „N Haftnotizen“ anlegt. */
export const notesCount = (choice: PasteChoice) => Math.min(MAX_NOTES, choice.table ? choice.table.flat().filter(Boolean).length : choice.lines.length);
