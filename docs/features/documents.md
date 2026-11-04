# Vertrag: Feature-Modul „documents“ (PDF auf dem Board)

Gehört dem Modul `web/src/features/documents/` und `server/src/documents.ts`. Eine PDF liegt als
Dokument-Objekt auf dem Board, zeigt die aktuelle Seite und lässt sich direkt am Objekt durchblättern (für alle), im
Vollbild lesen (nur bei mir), herunterladen und als einzelne Seitenbilder aufs Board legen („Expand pages“).
Server-Endpunkte: docs/contract.md §3.

## Bedienung

- **Einfügen:** Werkzeugleiste „Bild einfügen (auch PDF)“ (Dateiauswahl nimmt `application/pdf,.pdf`, auch im WebView einer
  App), Ziehen & Ablegen aus dem Dateimanager, Strg V einer kopierten Datei. Bis 15 MB, höchstens 300 Seiten
  (mehr: die ersten 300 mit Hinweis). Passwortgeschützte oder kaputte PDFs lehnt schon der Browser mit Hinweis ab.
- **Am Objekt:** Dateiname rechts über dem Dokument, Seitenleiste „‹ 3 / 12 ›“ unten im Dokument (gleich groß bei jedem
  Zoom, ab 120 px Bildschirmbreite, auch in der Präsentation). Blättern ist **geteilter Zustand** und kein Undo-Schritt.
- **Kontextleiste** (ein Dokument ausgewählt): ‹ Seite ›, „Vollbild ansehen“, „PDF herunterladen“, „Alle Seiten aufs Board
  legen“; dieselben drei Einträge im Rechtsklick-Menü.
- **Vollbild** (lokal): Pfeiltasten, Bild auf/ab, Leertaste, Pos1/Ende, Wischen am Handy, Esc schließt. Ändert die
  Seite am Objekt nicht.
- **Alle Seiten aufs Board:** Seitenbilder als normale Bilder (`image`) rechts neben dem Dokument, oben bündig, Breite wie
  das Dokument, etwa so viele Spalten wie Zeilen (höchstens 10); ein Undo-Schritt, danach ausgewählt.
- Größe ändern (Seitenverhältnis fest, Eckgriffe), drehen, verbinden, kommentieren, sperren, kopieren wie andere Objekte.

## Objekttyp `document` (Module-Augmentation in `features/documents/model.ts`)

| Feld | Typ | Bedeutung |
|---|---|---|
| `docFile` | `string` | ID der Original-PDF (`GET /api/files/:id`) |
| `docName` | `string` | Dateiname wie hochgeladen (Anzeige, Download, Suche/Zwischenablage als Klartext) |
| `docCount` | `number` | Seitenzahl |
| `docPage` | `number` (optional, 0-basiert) | aktuelle Seite für alle; fehlt/ungültig = begrenzt auf 0 … `docCount − 1` |
| `docPages` | im Y.Map ein **`Y.Map<string>`**: Seitennummer (ab 0, als Text) → Bild-ID; im Schnappschuss `{ "0": id, … }` | Seitenbilder (`images`, normale Bild-Pipeline mit Stufen `?w=256/1024`). Eigene Y.Map, damit mehrere Clients gleichzeitig verschiedene fehlende Seiten nachtragen, ohne sich zu überschreiben. Kopieren/Einfügen baut eine neue Y.Map (`registerYField('docPages')`). |
| `docRatios` | `number[]` | Seitenverhältnis Breite/Höhe je Seite (3 Nachkommastellen); andere Formate werden im Objekt eingepasst |
| `imageId` | `string` (optional) | **Spiegel** der Bild-ID der aktuellen Seite. Damit zeigen Export (PNG/SVG/PDF), Vorschaubild und die Bild-Verwaltung des Servers ohne Sonderweg die aktuelle Seite. Fehlt, solange die aktuelle Seite noch kein Bild hat. |

Ältere Clients blenden den unbekannten Typ aus (er bleibt im Dokument). Alte Boards sind nicht betroffen.

**Schreibregeln:** Blättern (`docPage` + `imageId` + `updatedAt`) und das Nachtragen einer Seite (`docPages[i]`, bei der
aktuellen Seite auch `imageId`) schreiben mit eigenem Origin `documents` – nicht im UndoManager (Strg Z nimmt weder
Blättern noch nachgeladene Seiten zurück). Eine schon eingetragene Seite wird nie überschrieben (wer zuerst kommt). Passt
`imageId` nicht zur aktuellen Seite (gleichzeitiges Blättern und Nachtragen), stellt es der nächste Client, der das
Dokument sieht, richtig (`repairMirror`).

## Seitenbilder: im Browser gerendert

- pdf.js (`pdfjs-dist` 6.4.299, exakt gepinnt) wird erst beim ersten PDF nachgeladen (eigene Pakete `pdf-*.js`, Worker
  `pdf.worker.min-*.mjs` per `?url`, Standardschriften/CMaps/WebAssembly-Dekoder als Build-Dateien über eine eigene
  `BinaryDataFactory` in `pdfAssets.ts`). CSP: `worker-src 'self'` genügt; `script-src` enthält `'wasm-unsafe-eval'`
  (nur WebAssembly, kein `eval`) für JBIG2-/JPEG-2000-Bilder in gescannten PDFs.
- Hochladen: PDF im Browser öffnen (prüft Format/Passwort) → Original hochladen (`POST /api/boards/:id/files`) →
  Seitenverhältnisse aller Seiten → Seite 1 rendern (längere Kante 1800 px, höchstens 4 Mio. Pixel, weiß hinterlegt,
  WebP 0,85; Safari: JPEG 0,88) und über `POST /api/boards/:id/images` hochladen → Objekt anlegen (ein Undo-Schritt). Die
  übrigen Seiten folgen im Hintergrund nacheinander (die aktuelle zuerst). Während des Uploads zeigt ein Platzhalter
  „wird vorbereitet …“ die Stelle (nur bei mir).
- **Nachladen:** Fehlt die aktuelle Seite eines sichtbaren Dokuments 1,5 s lang (Hochladende:r hat das Board verlassen,
  großes PDF), holt jeder Client das Original, rendert die Seite und trägt sie ein. Ebenso beim Blättern auf eine fehlende
  Seite, im Vollbild und vor „Alle Seiten aufs Board“. Doppelte Arbeit zweier Clients kostet höchstens ein überzähliges
  Bild; eingetragen bleibt das erste.
- Geöffnete PDFs bleiben 60 s im Speicher (Blättern ohne neuen Download), danach freigegeben.
- Das Board selbst rendert nur Bilder (eine Seite je Dokument, Stufe nach Bildschirmgröße, `loading="lazy"`): 100-seitige
  PDFs bremsen weder Zeichnen noch Export oder Vorschaubilder.

## Server (`server/src/documents.ts`)

- Original-PDFs liegen in der Tabelle `images` (`mime = 'application/pdf'`, `width`/`height` 0) unter `data/images/`. So
  gelten Board löschen/Papierkorb, Duplizieren, Versionen und „von einem anderen Board noch genutzt“ ohne Sonderweg auch für
  PDFs. `board-copies.ts` kennt dafür neben `imageId` auch `docFile` und die Werte von `docPages`.
- Prüfung: Magic Bytes `%PDF-1.x`/`%PDF-2.x` am Anfang und `%%EOF`; höchstens 15 MB (wie Bilder, nginx nimmt 16 MB).
- Abruf nur mit Sitzung; `Content-Security-Policy: … sandbox`, `X-Content-Type-Options: nosniff`, privat cachebar.

## Native-Aktionen (App, docs/contract.md §8.12)

`web/src/features/documents/native.ts` (Paket P7), Test `server/test/native-act-documents.test.ts`. Die App rendert die
Seiten selbst (PDFium über `pdfrx`, gleiche Regeln: längere Kante 1800 px, ≤ 4 MP, weiß, JPEG 0,88) und lädt Original
(`POST /api/boards/:id/files`) und Seitenbilder (`…/images`) mit ihrem Bearer-Token hoch; das Dokument legt sie mit der
normalen `create`-Op an (`docPages` als Objekt, der Server baut die Y.Map). Was das Web am Yjs-Dokument rechnet, läuft
als Web-Aktion mit diesem Code:

| Aktion | `args` | Undo | Ergebnis |
|---|---|---|---|
| `documents.page` | `{id, page}` | `none` (Origin wie `setPage`) | Seite wechseln (begrenzt, `imageId`-Spiegel); `data` = `{page, imageId}` (`null` = Bild fehlt, die App erzeugt es) |
| `documents.addPage` | `{id, page, imageId}` | `none` | `fillPage` (wer zuerst kommt) + `repairMirror`; `data` = `{imageId, missing}` (gültige Bild-ID, noch fehlende Seiten) |
| `documents.repair` | `{id}` | `none` | `repairMirror`; Spiegel stimmt schon → `skipped` |
| `documents.expand` | `{id}` | `undo` (ein Schritt) | Bilder nach `expandLayout`, `select`, `focus` = Dokument + Seiten, `toast` wie das Web; fehlen Seiten → `skipped` mit `data.missing` (die App erzeugt sie vorher wie `fillMissing`); gesperrt → `skipped` |

## Erweiterungspunkt (Kern)

`defineFileHandler({ id, accept, match, add })` (`editor/ext`): Dateiauswahl, Ablegen und Einfügen geben passende Dateien
an das Modul, Bilder bleiben beim Kern. Das Modul ersetzt außerdem die Beschriftung des Kern-Werkzeugs `image`.

## Nicht umgesetzt

- Text markieren/durchsuchen im PDF, Links und Formulare in der PDF (Seiten sind Bilder).
- Herunterladen im WebView einer App braucht dort einen Download-Handler (die Web-App liefert `Content-Disposition:
  attachment` mit Dateinamen).
