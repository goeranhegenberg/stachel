# Stachel – Funktionen im Überblick (Deutsch)

Online-Whiteboard für Teams mit Live-Zusammenarbeit, selbst gehostet, ohne Tracker und ohne externe Aufrufe. Läuft als
eigene Instanz mit Konten (`STACHEL_AUTH=local`, z. B. stachel.intsode.com) oder für das Team einer Organisation mit
Anmeldung über deren Identitätsdienst und App (`STACHEL_AUTH=org`). Englischer Einstieg, Schnellstart mit Docker und alle Einstellungen:
[`README.md`](../README.md); Selbst-Hosting: [`selfhosting.md`](selfhosting.md); Vertrag: [`contract.md`](contract.md),
Erweiterungspunkte des Editors: [`architecture.md`](architecture.md).

## Funktionen

**Board**
- Endlose Fläche mit Zoom (Mausrad, Strg + Rad, Pinch, `+`/`−`; Trackpad-Wischen verschiebt; Mausrad im
  Board-Menü bzw. in der Kürzel-Übersicht auf „Schwenken“ umstellbar; jede Raste zoomt gleich weit, auch bei
  Browser-Zoom und hoher Pixeldichte), Zoom-Menü an der Prozentanzeige (Einpassen, 50/100/200 %), Bildmitte bleibt beim
  Ändern der Fenstergröße bzw. Drehen des Handys, Auto-Schwenken beim Ziehen an den Bildrand, Minimap, Raster (Punkte/Linien/leer) und Hintergrundfarbe, Einrasten
  an Kanten, gleichen Abständen und am Raster.
- Haftnotizen (36 Farben als Raster: zwölf Farbtöne je hell, kräftig und dunkel; auf dunklen Notizen wird die Schrift automatisch weiß, berechnet nach
  WCAG-Kontrast; eigene Farbe per Spektrum oder Hex mit „zuletzt benutzt“; Quadrat oder Rechteck, Seitengriffe frei, Schrift passt sich an; Notiz-Stapel: eine Notiz auf eine andere ziehen, blättern, auffächern), Text, über 40 Formen
  (Grundformen, Pfeile, komplettes Flussdiagramm-Set), Verbinder (gerade/gewinkelt/geschwungen, zwischen zwei Objekten
  automatisch geschwungen, 9 Spitzen, Beschriftung, Andockpunkte, Ende umhängen),
  Stift, Textmarker (halbtransparent über Notizen und Text) und Radierer, Rahmen (Formate 16:9, A4, Handy …, Rasterrahmen), Bilder (Hochladen, Einfügen, Ziehen), Sticker, Emojis und Icons.
- PDFs aufs Board (Hochladen, Ziehen, Einfügen; bis 15 MB): Dokument mit Seitenleiste „‹ 3 / 12 ›“ am Objekt (Blättern
  sehen alle), Vollbild zum Durchblättern (Pfeiltasten, Wischen), Original herunterladen, „Alle Seiten aufs Board legen“
  (Seiten als Bilder im Raster daneben). Seiten rendert der Browser (pdf.js) und lädt sie als Bilder hoch.
- Karten (Person, Fälligkeit, Tags, Status), Tabellen, Mindmaps (Tab/Enter für Geschwister/Kinder), 27 Vorlagen mit Suche (Kanban, Retro,
  SWOT, Eisenhower, OKR, Personas, User-Journey, Entscheidungsmatrix; unter „Events“ Ablaufplan, Schichtpläne, Bühnenplan,
  Awareness-Konzept, Helfer-Briefing, Nachbesprechung, Budget …) an freiem Platz, eigene Boards als Vorlage speichern,
  eine Auswahl als eigene Vorlage speichern („Meine Vorlagen“, privat, auf allen Geräten); wer die Instanz betreibt, legt
  weitere Vorlagen als JSON-Dateien ab (Vorlagen der Instanz, [`selfhosting.md`](selfhosting.md)).
- Zeitleiste (Tag/Woche/Monat, Wochenenden, Heute-Linie): Spuren umbenennen/umsortieren, Einträge per
  Doppelklick oder Aufziehen, ziehen (rastet auf Tage, auch in andere Spuren), Enden ziehen, Meilensteine, Datum per
  Dialog, Zeitraum über die Ränder; Haftnotizen auf eine Spur ziehen werden Einträge. Live für mehrere Personen
  (`features/timeline.md`).
  Karten-Details und Tabellenzellen live: mehrere Personen schreiben gleichzeitig, ohne dass Text verloren geht.
- Einfügen aus Excel/Google Tabellen als Tabelle oder eine Notiz je Zelle, mehrzeiliger Text als eine Notiz je Zeile
  (Abfrage beim Einfügen).
- Notiz-Tags (farbig, boardweit wiederverwendbar), Objekt-Links zu Rahmen oder anderen Objekten (Knopf springt hin, auch in
  der Präsentation).
- Plus-Griffe (Kopie daneben samt Verbinder), Gruppieren, Sperren, Ausblenden, Drehen (auch mehrere Objekte; rastet bei
  0°/90°/180°/270° ein, Winkelanzeige, Umschalt: 15°-Schritte), Ausrichten und Verteilen,
  Ebenen, Format übertragen, Kopieren/Einfügen auch zwischen Boards und in andere Programme, Rückgängig über alles.
- Auswahl per Rechteck oder Lasso (Auswahl-Werkzeug erneut anklicken → „Lasso“, oder Strg/⌘ beim Ziehen).
- Kontextleiste über der Auswahl (oben oder unten, wo sie am wenigsten verdeckt; was nicht passt, steht
  hinter „···“) und Rechtsklick-Menü mit Untermenüs („Ebene“, „Ausrichten“), die üblichen Whiteboard-Tastenkürzel (Übersicht mit `?`).
- Oberfläche ausblenden (Strg \ oder Board-Menü, nur das Board bleibt) und Vollbild über das Board-Menü.

**Tastenkürzel (Auszug)**

| Taste | Wirkung |
|---|---|
| `V` `H` `N` `T` `S` `L` `P` `E` `F` | Auswählen, Hand, Notiz, Text, Form, Verbinder, Stift, Radierer, Rahmen |
| `R` / `O` | Rechteck / Kreis |
| Strg + Ziehen | Lasso-Auswahl (bzw. Rechteck, wenn Lasso eingestellt ist) |
| `+` / `−`, Strg + / Strg − | Vergrößern / Verkleinern |
| Umschalt 1 / Umschalt 2 / Strg 0 bzw. Umschalt 0 | Alles einpassen / Auf Auswahl / 100 % |
| Strg Z / Strg Y, Strg D, Strg G / Strg Umschalt G | Rückgängig / Wiederholen, Duplizieren, Gruppieren / Lösen |
| Entf, Pfeile (Umschalt: 10er-Schritte), Leertaste + Ziehen | Löschen, Verschieben, Ansicht verschieben |
| Zeitleiste mit aktivem Eintrag: ← → (Umschalt: Woche), ↑ ↓, Entf, Esc | Eintrag um Tage bzw. in andere Spur, löschen, abwählen |
| Umschalt beim Größe ändern, Umschalt beim Ziehen, Alt + Ziehen | Seitenverhältnis halten, nur waagerecht/senkrecht, Kopie ziehen |
| Tab / Umschalt Tab (beim Schreiben) | Neue Notiz rechts / links am nächsten freien Platz |
| Strg \ | Oberfläche aus-/einblenden |
| Strg Alt H | Versionsverlauf |

**Text (Rich-Text)**
- Fett, kursiv, unterstrichen, durchgestrichen **für einzelne Wörter**, Textfarbe, Markierung in 6 Farben, Links,
  Schriftgröße je Wort (Text und Form), Aufzählung, Nummerierung, Checkliste, Ausrichtung, 4 Schriftarten,
  Überschrift 1–3, Zitat und Code-Block (Leiste oder `# `, `> `, ` ``` `).
- Checkliste auf dem Board mit einem Klick abhaken, ohne zu bearbeiten.
- Einfügen aus Word und Browser: Listen, Markierung und Schriftgrößen bleiben erhalten, alles andere wird bereinigt.
- Passt sehr langer Text auch in kleinster Schrift nicht in die Notiz, blendet sie unten aus und scrollt beim Schreiben.
- Am Handy passt die Format-Leiste ohne Wischen (Rest unter „Mehr“) und bleibt über der Bildschirmtastatur.
- Live: mehrere Personen schreiben gleichzeitig in dieselbe Notiz, fremde Schreibmarken mit Namen.

**Zusammenarbeit**
- Live-Cursor (eindeutige Farbe je Person), Anwesenheit mit Status, Folgen (übersteht kurze Aussetzer), „Alle zu mir
  holen“, Laserpointer, Cursor-Chat (Taste `/`), Autor einer Haftnotiz beim Überfahren.
- Kommentare mit Pins, Antworten und @Erwähnung („Du wurdest erwähnt“), Reaktionen, Abstimmung (auch anonym) mit
  Ergebnis und Archiv, gemeinsamer Timer.
- Board-Titel live bei allen; wird ein offenes Board gelöscht, sehen alle „Board wurde von … in den Papierkorb
  verschoben“ (mit „Wiederherstellen“ für Berechtigte).
- Übersicht live (neue, umbenannte, gelöschte Boards ohne Neuladen), Favoriten (Stern, oben), „Zuletzt geöffnet“.
- Papierkorb: Löschen verschiebt ein Board in den Papierkorb unten in der Übersicht („Board gelöscht ·
  Rückgängig“), dort 30 Tage wiederherstellbar – vollständig mit Inhalt, Bildern, Kommentaren, Favoriten –, dann löscht
  der Server es endgültig samt Bildern. „Endgültig löschen“ und „Papierkorb leeren“ mit Bestätigung. Links auf ein Board
  im Papierkorb zeigen den Hinweis statt des Boards (`server/src/trash.ts`, `web/src/pages/trash.tsx`).
- Versionsverlauf (Board-Menü bzw. Strg Alt H): Stachel sichert automatisch alle 10 Minuten, während
  gearbeitet wird, und wenn alle das Board verlassen; dazu „Version speichern“ mit Namen. Liste nach Tagen mit Zeit,
  Personen und Name; Klick zeigt die Version schreibgeschützt auf der Leinwand (das Live-Board läuft unverändert weiter),
  „Diese Version wiederherstellen“ (alle sehen es sofort, der vorige Stand wird vorher gesichert), „Als Kopie öffnen“,
  „Version benennen“. Ausdünnen: 24 h alle, bis 30 Tage stündlich, bis 1 Jahr täglich, benannte nie
  (`server/src/versions.ts`, `web/src/features/versions/`, `features/versions.md`).
- Präsentation über die Rahmen-Liste, andere folgen lassen; am Handy/Tablet blättert Wischen bzw. Tippen links/rechts.
  Sprechernotizen je Rahmen (sieht beim Präsentieren nur die präsentierende Person), Übergabe der Präsentation an eine
  andere anwesende Person („Übergeben an …“, sie übernimmt ab dem aktuellen Rahmen, Mitlesende folgen weiter).
- Privater Modus (Board-Menü, für Retros und Ideensammlungen): neue Notizen, Texte und Formen sieht nur, wer sie
  schreibt; die anderen sehen graue Platzhalter. Die Moderation deckt alles auf einmal auf (Countdown 3 s), wahlweise
  „Namen anonym“ und „Jede:r darf eigene vorher aufdecken“. Geheim bleibt es wirklich: der Server schickt den Inhalt
  niemandem sonst (eigene Privat-Ablage je Person, `docs/features/private.md`).
- Löscht jemand die Notiz, in der man gerade schreibt, endet die Bearbeitung mit dem Hinweis „Von … gelöscht“.

**Werkzeuge**
- Suche auf dem Board (Strg F, auch Tags und zuständige Personen), Export als PNG/PDF (Board, Auswahl, Rahmen, alle Rahmen als Seiten), lesbare Vorschaubilder in der
  Übersicht (rendert der Server aus dem Board, auch für nie geöffnete Boards; private Notizen erscheinen nie), Board duplizieren, Objekt-Links.
- **Zettel abfotografieren:** Foto einer Wand mit Klebezetteln (am Handy direkt die Kamera) → der eigene Server erkennt die
  Zettel, ihre Farbe und ihren Text (Tesseract, offline, kein Cloud-Dienst; das Foto wird nicht gespeichert) → Vorschau zum
  Abwählen und Korrigieren → Haftnotizen in der Anordnung wie auf dem Foto, ein Rückgängig-Schritt. Web, App und Desktop;
  abschaltbar (`STACHEL_PHOTO_NOTES=0`), [`features/photo-notes.md`](features/photo-notes.md).
- Handy und Tablet: Werkzeugleiste unten, Bottom-Sheets, langes Drücken öffnet das Menü, Griffe mit großer
  Trefferfläche, Pinch zoomt nur das Board (nie die Seite), Stift mit Palm-Rejection (aufliegender Handballen zählt nicht).
- Jede Bildschirmgröße (Handy hoch/quer, Tablet, niedrige Fenster, Browser-Zoom bis 200 %, 4K): Leisten bleiben im Bild
  und überlappen nicht, Dialoge scrollen bei wenig Höhe (Titel und Knöpfe bleiben stehen), „Alles einpassen“ lässt
  Übersichtskarte und Leisten frei, Hinweise sprechen am Touch-Gerät von Tippen statt Klicken. Prüfung: `web/e2e/layout4.spec.ts`.

**Anmeldung im Modus org** ([`features/accounts.md`](features/accounts.md)): QR-Code aus der App der Organisation (wie
WhatsApp Web), direkt in der App (WebView mit Einmal-Code) oder, falls die Organisation es anbietet, Benutzername +
Passwort der Organisation. Name der Organisation und ihrer App stellt die Instanz ein (`STACHEL_ORG_NAME`,
`STACHEL_ORG_APP_NAME`).

**Eigene Instanz mit Konten** (`STACHEL_AUTH=local`, z. B. stachel.intsode.com; [`features/accounts.md`](features/accounts.md)):
Registrieren mit Name, E-Mail, Passwort und Datenschutz-Zustimmung, Captcha ohne Drittanbieter (Proof-of-Work),
Bestätigungsmail, Passwort vergessen, Konto-Seite (Name, Passwort, Konto löschen mit Übertragen der eigenen Boards).
Boards gehören jemandem: Teilen per E-Mail (auch an Personen ohne Konto) mit „Kann bearbeiten / kommentieren /
ansehen“, Freigabelink für angemeldete Personen, Besitz übertragen; Übersicht mit „Meine Boards“, „Mit mir geteilt“,
„Favoriten“; Impressum/Datenschutz in der Fußzeile. Die Rechte prüft der Server überall (REST, Bilder, Live-Übersicht, Sync).

**KI-Zugang (MCP)** ([`features/mcp.md`](features/mcp.md)): Ein KI-Assistent wie Claude gestaltet Boards
live mit – Notizen im Raster, Texte, Formen, Rahmen, Karten, Tabellen, Kanban, Mindmaps aus einer Gliederung, Verbinder
mit Andockseite/Beschriftung/Linienart, Ändern, Ausrichten, Auto-Layout (Raster, Fluss, Baum, Cluster), Kommentare,
Rückgängig und Bildschirmfotos der echten Darstellung zur Kontrolle. Er erscheint als „KI (für Mara)“ mit Cursor.
Persönliches Token im Board-Menü „···“ → „KI-Zugang (MCP) …“, dort steht die fertige Einrichtung für Claude Code
(`claude mcp add --transport http stachel https://board.example.org/mcp --header "Authorization: Bearer stk_…"`)
und Claude Desktop.

**Native-API für Apps** ([`docs/contract.md`](contract.md) §8, Konzept
[`docs/native_flutter_konzept.md`](native_flutter_konzept.md)): Die Stachel-App bzw. die App einer Organisation holt mit
Zugangsdaten bzw. ihrem Org-Token eine Stachel-Sitzung
(`POST /api/auth/app-session`) und spricht über `wss://…/native/v1` JSON statt Yjs – Schnappschuss, Feld-Patches,
Wiederaufnehmen nach Funklöchern, Anwesenheit (im Web als Person mit Cursor) und Ops. Beispiel-Daten für App-Tests:
[`docs/native_fixtures/`](native_fixtures/README.md); was die App schon kann: [`docs/native_paritaet.md`](native_paritaet.md).

## Aufbau

| Ordner | Inhalt |
|---|---|
| `shared/` | Gemeinsame Typen und Konstanten (`protocol.ts`) |
| `server/` | Node 22 + Fastify + Hocuspocus (Yjs), SQLite, Bilder; liefert im Betrieb `web/dist` aus |
| `web/` | Vite + React + TypeScript; Editor-Kern (`src/editor`) und Feature-Module (`src/features/<modul>`) |
| `e2e/` | Ende-zu-Ende-Tests gegen den echten Server (zwei Browser, Neustart) |
| `mcp/` | MCP-Server für KI-Assistenten (stdio + Streamable HTTP, Bildschirmfotos per Headless-Chromium) |
| `docs/` | Vertrag, Architektur, Modul-Verträge (`features/`), Screenshots |

## Entwicklung

Node 22 (`nvm use 22`). Getrennte Pakete, je Ordner `npm ci`.

```bash
# Server (Port 8095) mit eigenen Konten; Mails samt Links landen in server/data/mail.log
cd server && npm ci && printf 'STACHEL_AUTH=local\nSTACHEL_MAIL_MODE=log\n' > .env && npm run dev
# (Modus org stattdessen: STACHEL_AUTH=org und STACHEL_ORG_IDENTITY_URL=<Identitätsdienst>, siehe features/accounts.md)
# Web (Port 5173, proxyt /api und /sync auf den Server)
cd web && npm ci && npm run dev
```

Ohne Server: `http://localhost:5173/?offline=1` (lokales Board, `&demo=1` mit Beispielinhalt).

## Tests

```bash
cd server && npm test                    # Vitest: API, Auth, QR, Sync, Vorschaubilder
cd web && npm test                       # Vitest: Store, Geometrie, Module
cd web && npx playwright test --workers=1 # E2E im Browser (Vite, Fake-API, Test-Sync-Server)
cd e2e && npm ci && npm run build && npx playwright test   # echter Server + web/dist, Fake-Identitätsdienst
cd mcp && npm ci && npm test             # MCP: Markdown, Validierung, Layout; Integration gegen echten Server (nach e2e-Build)
```

- Ports der Web-E2E per `PW_PORT` (Sync-Specs nehmen über `web/e2e/syncServer.ts` einen freien Port), der Root-E2E per `E2E_PORT` (Standard 8397).
- Die Root-E2E startet den gebauten Server selbst (eigenes `DATA_DIR` im Temp-Ordner), meldet sich per Passwort und per
  QR an (Bestätigung wie die App per Request), arbeitet mit zwei Browsern auf einem Board und startet den Server neu.
- Auf schwachen Rechnern schwere Läufe nacheinander: `flock /tmp/stachel-heavy.lock <befehl>`.
- Screenshots landen in `docs/screenshots/` (`live-*` aus der Root-E2E).

Betrieb mit Docker: [`selfhosting.md`](selfhosting.md).
