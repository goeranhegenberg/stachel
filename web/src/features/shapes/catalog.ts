// Formen-Bibliothek (Formen-Panel): Einträge mit Name, Form, Startgröße, Abschnitt und Suchwörtern.
import type { ShapeKind } from '../../protocol';

export interface ShapeEntry {
  id: string;
  label: string;
  kind: ShapeKind;
  w: number;
  h: number;
  section: 'basic' | 'arrows' | 'flow';
  /** zusätzliche Suchwörter (klein) */
  keys?: string;
}

export const SECTIONS: { id: ShapeEntry['section']; label: string }[] = [
  { id: 'basic', label: 'Grundformen' },
  { id: 'arrows', label: 'Pfeile & Klammern' },
  { id: 'flow', label: 'Flussdiagramm' },
];

export const SHAPE_ENTRIES: ShapeEntry[] = [
  { id: 'rect', label: 'Rechteck', kind: 'rect', w: 180, h: 120, section: 'basic', keys: 'viereck kasten box quadrat' },
  { id: 'roundrect', label: 'Abgerundetes Rechteck', kind: 'roundrect', w: 180, h: 120, section: 'basic', keys: 'rund ecken karte' },
  { id: 'circle', label: 'Kreis', kind: 'ellipse', w: 140, h: 140, section: 'basic', keys: 'rund punkt' },
  { id: 'ellipse', label: 'Ellipse', kind: 'ellipse', w: 180, h: 120, section: 'basic', keys: 'oval rund' },
  { id: 'triangle', label: 'Dreieck', kind: 'triangle', w: 160, h: 140, section: 'basic' },
  { id: 'diamond', label: 'Raute', kind: 'diamond', w: 160, h: 140, section: 'basic', keys: 'rhombus' },
  { id: 'pentagon', label: 'Fünfeck', kind: 'pentagon', w: 150, h: 145, section: 'basic', keys: 'pentagon' },
  { id: 'hexagon', label: 'Sechseck', kind: 'hexagon', w: 170, h: 145, section: 'basic', keys: 'hexagon wabe' },
  { id: 'octagon', label: 'Achteck', kind: 'octagon', w: 150, h: 150, section: 'basic', keys: 'oktagon stopp' },
  { id: 'star', label: 'Stern', kind: 'star', w: 160, h: 152, section: 'basic', keys: 'favorit bewertung' },
  { id: 'parallelogram', label: 'Parallelogramm', kind: 'parallelogram', w: 190, h: 110, section: 'basic', keys: 'schief' },
  { id: 'trapezoid', label: 'Trapez', kind: 'trapezoid', w: 180, h: 110, section: 'basic' },
  { id: 'cylinder', label: 'Zylinder', kind: 'cylinder', w: 130, h: 150, section: 'basic', keys: 'tonne dose säule' },
  { id: 'cloud', label: 'Wolke', kind: 'cloud', w: 200, h: 130, section: 'basic', keys: 'idee gedanke' },
  { id: 'callout', label: 'Sprechblase', kind: 'callout', w: 190, h: 130, section: 'basic', keys: 'sprechen kommentar zitat' },
  { id: 'cross', label: 'Kreuz', kind: 'cross', w: 130, h: 130, section: 'basic', keys: 'plus erste hilfe' },
  { id: 'heart', label: 'Herz', kind: 'heart', w: 150, h: 135, section: 'basic', keys: 'liebe like' },
  { id: 'arrowRight', label: 'Pfeil rechts', kind: 'arrowRight', w: 190, h: 100, section: 'arrows', keys: 'weiter vor' },
  { id: 'arrowLeft', label: 'Pfeil links', kind: 'arrowLeft', w: 190, h: 100, section: 'arrows', keys: 'zurück' },
  { id: 'arrowDouble', label: 'Doppelpfeil', kind: 'arrowDouble', w: 210, h: 100, section: 'arrows', keys: 'beide richtungen austausch' },
  { id: 'arrowUp', label: 'Pfeil oben', kind: 'arrowUp', w: 100, h: 190, section: 'arrows', keys: 'hoch rauf steigen' },
  { id: 'arrowDown', label: 'Pfeil unten', kind: 'arrowDown', w: 100, h: 190, section: 'arrows', keys: 'runter fallen' },
  { id: 'chevron', label: 'Chevron', kind: 'chevron', w: 170, h: 100, section: 'arrows', keys: 'schritt phase prozess winkel' },
  { id: 'pentagonArrow', label: 'Schritt', kind: 'pentagonArrow', w: 180, h: 90, section: 'arrows', keys: 'pfeil phase etappe zeitstrahl' },
  { id: 'braceLeft', label: 'Klammer links', kind: 'braceLeft', w: 50, h: 200, section: 'arrows', keys: 'geschweifte gruppe' },
  { id: 'braceRight', label: 'Klammer rechts', kind: 'braceRight', w: 50, h: 200, section: 'arrows', keys: 'geschweifte gruppe' },
  { id: 'terminator', label: 'Start/Ende', kind: 'terminator', w: 180, h: 70, section: 'flow', keys: 'anfang ende terminator pille' },
  { id: 'process', label: 'Prozess', kind: 'rect', w: 180, h: 90, section: 'flow', keys: 'schritt aktion vorgang' },
  { id: 'decision', label: 'Entscheidung', kind: 'diamond', w: 180, h: 130, section: 'flow', keys: 'frage ja nein verzweigung' },
  { id: 'data', label: 'Daten', kind: 'parallelogram', w: 190, h: 90, section: 'flow', keys: 'eingabe ausgabe' },
  { id: 'document', label: 'Dokument', kind: 'document', w: 180, h: 110, section: 'flow', keys: 'datei bericht papier' },
  { id: 'database', label: 'Datenbank', kind: 'cylinder', w: 120, h: 140, section: 'flow', keys: 'speicher daten' },
  { id: 'predefined', label: 'Unterprozess', kind: 'predefined', w: 190, h: 90, section: 'flow', keys: 'vordefiniert prozess' },
  { id: 'manualInput', label: 'Manuelle Eingabe', kind: 'manualInput', w: 180, h: 100, section: 'flow', keys: 'tastatur eingeben' },
  { id: 'delay', label: 'Verzögerung', kind: 'delay', w: 170, h: 90, section: 'flow', keys: 'warten pause' },
  { id: 'junction', label: 'Verbindungsstelle', kind: 'ellipse', w: 70, h: 70, section: 'flow', keys: 'konnektor punkt kreis' },
  { id: 'preparation', label: 'Vorbereitung', kind: 'hexagon', w: 190, h: 90, section: 'flow', keys: 'sechseck initialisierung' },
  { id: 'manualOperation', label: 'Manuelle Tätigkeit', kind: 'manualOperation', w: 180, h: 90, section: 'flow', keys: 'hand arbeit operation' },
  { id: 'multiDocument', label: 'Mehrere Dokumente', kind: 'multiDocument', w: 190, h: 120, section: 'flow', keys: 'dateien stapel' },
  { id: 'display', label: 'Anzeige', kind: 'display', w: 190, h: 90, section: 'flow', keys: 'bildschirm monitor' },
  { id: 'storedData', label: 'Gespeicherte Daten', kind: 'storedData', w: 190, h: 90, section: 'flow', keys: 'speicher ablage' },
  { id: 'internalStorage', label: 'Interner Speicher', kind: 'internalStorage', w: 140, h: 120, section: 'flow', keys: 'speicher' },
  { id: 'card', label: 'Karte', kind: 'card', w: 170, h: 110, section: 'flow', keys: 'lochkarte' },
  { id: 'offPage', label: 'Seitenverweis', kind: 'offPage', w: 110, h: 110, section: 'flow', keys: 'andere seite sprung verweis' },
  { id: 'merge', label: 'Zusammenführen', kind: 'merge', w: 130, h: 110, section: 'flow', keys: 'dreieck mischen' },
  { id: 'extract', label: 'Auszug', kind: 'triangle', w: 130, h: 110, section: 'flow', keys: 'dreieck extrahieren' },
  { id: 'sort', label: 'Sortieren', kind: 'sort', w: 140, h: 130, section: 'flow', keys: 'raute ordnen' },
  { id: 'summing', label: 'Summe', kind: 'summing', w: 90, h: 90, section: 'flow', keys: 'und kreuz summenpunkt' },
  { id: 'or', label: 'Oder', kind: 'or', w: 90, h: 90, section: 'flow', keys: 'plus kreis' },
];

export const entryById = (id: string | undefined) => SHAPE_ENTRIES.find((e) => e.id === id);
/** erster Bibliothekseintrag einer Form (Name und Größe) */
export const entryOfKind = (kind: string | undefined) => SHAPE_ENTRIES.find((e) => e.kind === kind);

/** Suche: klein, Umlaute wie ae/oe/ue, alle Wörter müssen vorkommen. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .trim();
}

export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = normalize(fields.filter(Boolean).join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export const searchShapes = (query: string) => SHAPE_ENTRIES.filter((e) => matches(query, e.label, e.keys, e.kind));
