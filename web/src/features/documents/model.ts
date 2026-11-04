// Datenmodell des Moduls „documents“ (Vertrag: docs/features/documents.md): PDF-Dokument als Objekttyp `document`.
// Alle Felder optional – alte Boards laden unverändert, ältere Clients blenden den unbekannten Typ aus.

declare module '../../../../shared/protocol' {
  interface ObjectTypeMap {
    document: true;
  }
  interface BoardObject {
    /** document: ID der Original-PDF (`GET /api/files/:id`) */
    docFile?: string;
    /** document: Dateiname, wie hochgeladen („Lageplan 2027.pdf“) */
    docName?: string;
    /** document: Seitenzahl */
    docCount?: number;
    /** document: aktuelle Seite (0-basiert, für alle gleich); fehlt = 0 */
    docPage?: number;
    /**
     * document: Bild-ID je Seite. Im Y.Map ein `Y.Map<string>` (Schlüssel = Seitennummer ab 0 als Text), damit
     * mehrere Clients gleichzeitig fehlende Seiten nachtragen können; im Schnappschuss eine Lesekopie `{ "0": id, … }`.
     */
    docPages?: Record<string, string>;
    /** document: Seitenverhältnis Breite/Höhe je Seite (3 Nachkommastellen), beim Hochladen gemessen */
    docRatios?: number[];
  }
}

export const DOC_TYPE = 'document';
export const DOC_PAGES_FIELD = 'docPages';
/** Größe der Original-PDF (wie Bilder: nginx nimmt höchstens 16 MB je Anfrage) */
export const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** mehr Seiten werden nicht übernommen (Speicher, Hochladezeit) */
export const MAX_PAGES = 300;
/** längere Seitenkante der Seitenbilder in Pixeln (lesbar in der Vollbild-Ansicht, ≈ 150–300 KB je Seite als WebP) */
export const PAGE_PX = 1800;
/** höchstens so viele Pixel je Seitenbild (sehr breite Pläne) */
export const PAGE_MAX_PIXELS = 4_000_000;
