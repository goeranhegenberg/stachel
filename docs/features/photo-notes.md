# Zettel abfotografieren (P10, Welle B, seit 2026-11-04)

Eine Wand mit Papier-Klebezetteln fotografieren → Stachel erkennt die einzelnen Zettel, ihre Farbe und ihren Text →
Vorschau zum Abwählen und Korrigieren → Haftnotizen in der Anordnung wie auf dem Foto, ein Rückgängig-Schritt.
Web, Stachel-App (Handy, Tablet, Desktop) und Org-App (über `stachel_client`) verhalten sich gleich.

## Ablauf

1. Board-Menü „**Zettel abfotografieren …**“ (`tools.photoNotes`, Web order 22; App `MenuSection.board`). Sichtbar nur,
   wenn der Server die Funktion anbietet (`GET /api/instance` → `photoNotes: true`), das Board online ist und man es
   bearbeiten darf (Web: Server antwortet sonst 403, App blendet aus).
2. Foto wählen: Web am Touch-Gerät „Foto aufnehmen“ (`<input type=file accept=image/* capture=environment>`) und „Aus
   der Galerie“, am Rechner „Foto auswählen“; App Kamera/Galerie (Desktop: Dateiauswahl, HEIC wird zu PNG).
3. `POST /api/boards/:id/photo-notes` mit dem Foto als Rohdaten → Antwort mit Zetteln, Farben, Texten und einer kleinen
   Vorschau des (gedrehten) Fotos.
4. Vorschau: Foto mit nummerierten Rahmen, darunter je Zettel Haken (übernehmen), Farbe (Notizfarben), Text (korrigieren).
5. „N Notizen anlegen“: Web `photoNoteObjects` (`web/src/features/tools/photoNotes.ts`) an der Bildmitte bzw. am nächsten
   freien Platz daneben (wie Vorlagen, `freeSpot`); App Web-Aktion `tools.photoNotes` `{notes, x, y}` → derselbe Code auf dem Server (`select`, `focus`, `toast`).

## Server (`server/src/photo-notes.ts`)

- **Zettel finden (Farbsegmentierung):** Foto mit EXIF-Drehung auf 2400 px, für die Suche auf 480 px. Papier = farbig
  (Sättigung ≥ 0,2, Helligkeit ≥ 0,32) oder deutlich heller als die Wand (Median des Bildrands; für weiße Zettel auf
  dunkler Wand). Kleine Löcher (Schrift) werden geschlossen, aber nur zwischen Bildpunkten gleichen Farbtons; Zusammenhang
  per Union-Find getrennt nach Farbton (< 22°) – so trennen sich aneinanderstoßende Zettel verschiedener Farbe. Filter:
  Fläche 0,15–40 % des Bilds, Seitenverhältnis 1 : 4 … 4 : 1, Füllgrad ≥ 50 %. Berührende gleichfarbige Zettel teilt ein
  Raster nach der Median-Zettelgröße. Reihenfolge = Leserichtung. Höchstens 60 Zettel.
- **Farbe:** Mittel der Papier-Bildpunkte → nächste der 36 Notizfarben im Lab-Raum (Helligkeit halb gewichtet, weil Fotos
  dunkler und blasser sind als das Papier).
- **Texterkennung:** **Tesseract 5** (`tesseract-ocr` mit `deu` + `eng` aus Debian, Apache-2.0) als eigener Prozess:
  alle Zettel-Ausschnitte (5 % Rand weg, Graustufen, Kontrast gestreckt, auf ~640 px skaliert) untereinander auf einem
  Blatt, ein Aufruf `tesseract stdin stdout -l deu+eng --psm 4 tsv` (ein Kern, 40 s Zeitlimit), Wörter über ihre Lage den
  Zetteln zugeordnet, Wörter mit Konfidenz < 30 fallen weg. Fehlt Tesseract, kommen Zettel und Farben ohne Text
  (`ocr: false`).
- **Datenschutz:** Das Foto bleibt im Arbeitsspeicher und wird nach der Antwort verworfen – keine Datei, keine Tabelle,
  kein Protokoll des Inhalts (`Cache-Control: no-store`). Test: `photo-notes.test.ts` prüft Datenordner und Datenbank.
  Datenschutzerklärung: `deploy/intsode/legal/datenschutz.html` und Vorlage `deploy/legal-templates/datenschutz.html`
  §3.4 und Speicherdauer.
- **Grenzen:** Größe `STACHEL_PHOTO_NOTES_MAX_MB` (Standard 15 → 413), `STACHEL_PHOTO_NOTES_PER_HOUR` (Standard 30 je
  Person → 429 `rate_limited`), höchstens zwei Auswertungen gleichzeitig (sonst 503 `busy`), 60 MP Eingabe.
- **Abschalten:** `STACHEL_PHOTO_NOTES=0` (Route fehlt, `/api/instance` meldet `photoNotes: false`, Menüs blenden aus).
  `STACHEL_TESSERACT` (Programm, leer = ohne Texterkennung), `STACHEL_OCR_LANGS` (Standard `deu+eng`).

### Antwort

```json
{ "ok": true, "width": 2400, "height": 1800, "ocr": true, "preview": "data:image/jpeg;base64,…",
  "notes": [{ "x": 120, "y": 90, "w": 400, "h": 410, "color": "#fff27a", "rgb": "#f4de5d", "text": "Bühne", "conf": 88 }] }
```

Lage in Bildpunkten von `width × height` (das gedrehte, verkleinerte Foto, zu dem auch `preview` passt). Fehler:
400 `invalid_input`, 413, 415 `unsupported_type`, 429 `rate_limited`, 503 `busy`, 403/404 (Board-Rechte, access.ts).

## Warum Tesseract (Entscheidung Welle B)

Bedingungen: Open Source, mit Apache-2.0 verträglich, CPU, offline im Docker-Image, Image vertretbar groß.

| Kandidat | Handschrift | Größe im Image | Bewertung |
|---|---|---|---|
| **Tesseract 5 (LSTM), deu+eng** | schwach bis mittel (Druckbuchstaben gut) | ≈ 30 MB (Debian-Pakete samt Leptonica) | gewählt: klein, stabil, Apache-2.0, Deutsch inkl. Umlaute, ein `apt-get`, läuft auf amd64 und arm64 |
| PaddleOCR PP-OCRv5 über ONNX Runtime | besser (auch Handschrift-Daten im Training) | ≈ 60–150 MB (onnxruntime-node + Erkennungs- und Detektionsmodell) | Apache-2.0/MIT, aber deutlich größer, Lateinisch-Modell für Deutsch weniger erprobt, zweite Laufzeit im Server |
| TrOCR (handwritten) | gut für einzelne Zeilen | ≥ 300 MB Modell + Laufzeit | zu groß, nur Zeilen (braucht eigene Zeilenerkennung), CPU langsam |
| EasyOCR / docTR | mittel | PyTorch, > 1 GB | Python-Laufzeit im Node-Image unverhältnismäßig |

Klebezettel tragen meist wenige, große Wörter, oft in Druckschrift; die Vorschau macht das Korrigieren zum normalen
Schritt. Die Erkennung steckt hinter `OcrEngine` (`photo-notes.ts`) – ein späterer Wechsel (z. B. PaddleOCR) ändert nur
diese Stelle.

## Tests

- Server: `server/test/photo-notes.test.ts` (erzeugtes Wandfoto mit sechs Zetteln: Lage, Trennung verschiedenfarbiger
  Nachbarn, Farbe, EXIF-Drehung, TSV, Einstellungen, Route mit Grenzen/Rechten/Abschalter, nichts gespeichert; echter
  Tesseract-Lauf, wenn installiert), `server/test/native-act-tools.test.ts` (`tools.photoNotes`).
- Web: `web/src/features/tools/photoNotes.test.ts`, E2E `web/e2e/photo-notes.spec.ts` (Desktop + Handy mit echtem
  Sync).
- App: `flutter/packages/stachel_client/test/stachel_photo_notes_test.dart` (Menü, Ablauf mit `act`, Fehler, Golden).
