# Vertrag: Feature-Modul „structure“

Gehört dem Modul `web/src/features/structure/` (dazu `web/src/editor/interaction/Frames.tsx`). Struktur:
Vorlagen, Mindmap, Karten, Tabellen, Rasterrahmen, Rahmen-Liste, Präsentation mit Folgen. Alle Felder sind optional;
alte Boards laden unverändert, ältere Clients ignorieren die neuen Typen (sie bleiben im Dokument erhalten).
Typen per Module-Augmentation in `features/structure/model.ts`.

## Objekttypen (in `doc.getMap("objects")`)

### `mindnode` – Mindmap-Knoten

| Feld | Bedeutung |
|---|---|
| `text` | Thema (Klartext) |
| `color` | Zweigfarbe (Wurzel: Füllung, Standard Schwarz; Hauptthemen: Rand und Linie; Unterthemen erben sie) |
| `mind.parent` | id des Elternknotens; fehlt bzw. existiert nicht = Wurzel. Zyklen (gleichzeitiges Umhängen): der kleinste Knoten im Kreis gilt als Wurzel |
| `mind.order` | Reihenfolge unter Geschwistern (Zahl, aufsteigend) |
| `mind.side` | `'l'` / `'r'` – Seite an der Wurzel (gesetzt an Hauptthemen; das Layout schreibt die geerbte Seite auch an Unterthemen) |
| `mind.collapsed` | Zweig eingeklappt |
| `mind.level`, `mind.hidden` | vom Layout geschrieben: Ebene (0 Wurzel, 1 Hauptthema, ≥ 2 Unterthema), versteckt in eingeklapptem Zweig |

- **Layout** (`mindmap/layout.ts`): Die Wurzel bleibt stehen, Zweige links/rechts als Baum, Teilbäume mittig zu ihrem
  Knoten (Abstände 64 / 16). Größe aus Text und Ebene (`mindmap/style.ts`). Wer etwas ändert, schreibt `x/y/w/h` und
  `mind` aller Knoten der Mindmap im selben Undo-Schritt nach; andere Clients rechnen nicht nach.
- Löschen nimmt die Unterthemen mit. Kopieren schreibt `mind.parent` um; ohne mitkopierten Eltern wird ein Knoten Wurzel.
- Linien zeichnet der Client (Welt-Ebene), sie sind nicht gespeichert.
- **Native-App** (Vertrag §8.6 `mind`): Der Server führt für die App genau `ops.ts` aus (React-frei; Textbreiten
  über `setTextMeasure` aus `editor/measureText.ts` = Schriftmaße aus dem Chromium statt Canvas). **ops.ts/layout.ts/style.ts
  bleiben deshalb ohne React- und Editor-Importe**; Änderungen daran → `tools/native-mind-fixtures.mts` neu (die App prüft
  ihren Port dagegen, docs/native_paritaet.md).

### `card` – Karte

| Feld | Bedeutung |
|---|---|
| `text` | Titel |
| `desc` | Beschreibung: **`Y.Text`** (live, gleichzeitiges Tippen wird zusammengeführt) oder – alte Karten, Kopien, ältere Clients – String. Beim Öffnen des Dialogs wird ein String zu `Y.Text` (Origin `structure:migrate`, nicht im Undo). Schnappschuss: immer String |
| `assignee` | `{ key, name }` – zuständige Person (`user_key` wie Vertrag §1) |
| `due` | Fälligkeit `YYYY-MM-DD` (überfällig = vor heute und nicht erledigt) |
| `tags` | `{ label, color }[]` |
| `status` | `'todo'` Offen · `'doing'` In Arbeit · `'blocked'` Blockiert · `'done'` Erledigt; fehlt = ohne |
| `color` | Farbstreifen links |

`h` folgt dem Inhalt (gemessen, wie bei Text). Zwischenablage-Text: Titel + Beschreibung.

Details-Dialog: Titel und Beschreibung sind live – fremde Eingaben erscheinen sofort im offenen Feld, die eigene
Schreibmarke bleibt an ihrer Stelle (`ytext.ts`). Die Beschreibung schreibt jede Eingabe als kleinste Änderung ins
`Y.Text`; der Titel bleibt das Kern-Feld `text` (String) und wird als Drei-Wege-Abgleich gegen den aktuellen Stand
geschrieben. Format übertragen ändert an Karten nur `color`.

### `table` – Tabelle

| Feld | Bedeutung |
|---|---|
| `table` | im Y.Map ein **`Y.Map`**: `rows: Y.Array<string>`, `cols: Y.Array<string>` (Zeilen-/Spalten-ids), `cells: Y.Map<Y.Text \| string>` (Schlüssel `${zeile}:${spalte}`; leere Zellen fehlen oder sind ein leeres `Y.Text`), `widths: Y.Map<number>` (relative Spaltenbreite je Spalten-id, fehlt = 1) |
| `tableHead` | `'row'` (Standard) · `'col'` · `'both'` · `'none'` – Kopfzeile/-spalte hervorheben |
| `color` | Farbe der Kopfzeile |

- Spaltenbreite = `w × Gewicht / Summe`. Zeilenhöhe = höchste umbrochene Zelle (15 px Barlow, Zeilenhöhe 1,35,
  Innenabstand 10/12, mindestens 42); `h` = Summe, beim Schreiben im selben `transact` nachgezogen.
- Gleichzeitiges Schreiben verschiedener Zellen, Zeilen und Spalten führt ohne Verlust zusammen. Eine bearbeitete Zelle
  ist ein `Y.Text`: Tippen zwei Personen gleichzeitig in dieselbe Zelle, wird zusammengeführt, und der offene
  Zelleneditor zeigt fremde Eingaben sofort. String-Zellen (alte Tabellen, Kopien, Vorlagen, ältere Clients) werden beim
  Start der Bearbeitung zu `Y.Text` (Origin `structure:migrate`, nicht im Undo); ältere Clients lesen `Y.Text` als String.
- Schnappschuss: Lesekopie `{ rows, cols, cells, widths }` über `registerYField('table', …)`; Kopieren/Einfügen baut
  daraus eine neue Y-Struktur.

### `timeline` – Zeitleiste

Spuren mit Einträgen (Balken/Meilensteine) auf einer Datumsachse; eigener Vertrag: `docs/features/timeline.md`
(Felder `tlStart`, `tlEnd`, `tlUnit`, `timeline`).

## Felder an Rahmen (`frame`)

| Feld | Bedeutung |
|---|---|
| `slide` | Position in Rahmen-Liste und Präsentation (Fractional-Index wie `z`). Rahmen mit `slide` zuerst (sortiert), danach Rahmen ohne `slide` in Lesereihenfolge (Zeilen oben → unten, links → rechts) |
| `notes` | Rahmen: Sprechernotizen (Klartext ≤ 20 000). Bearbeiten in der Rahmen-Liste (Notiz-Knopf je Rahmen); beim Präsentieren sieht nur die präsentierende Person sie. Übergabe der Präsentation (Awareness `structure.handover`, `structure.present.from`): `docs/features/private.md` §7 |
| `frameGrid` | Raster mit dieser Kantenlänge (Weltpunkte) im Rahmen |
| `frameGridLabels` | Spalten A, B, … und Zeilen 1, 2, … beschriften |

Rahmen-Formate (16:9 = 1280×720, 4:3 = 1024×768, A4 = 794×1123, A4 quer = 1123×794, Handy = 390×844,
Quadrat = 800×800) sind nur Größen beim Anlegen bzw. Ändern, kein eigenes Feld.

## Y-Strukturen

| Name | Inhalt | Undo |
|---|---|---|
| `structure.people` | `Y.Map<string>`: `user_key` → Name aller, die das Board geöffnet haben (Auswahl „zuständig“, dazu die Anwesenden) | nein |

## Awareness

| Feld | Inhalt |
|---|---|
| `structure.present` | `{ frameId, index, total, title }` während jemand präsentiert und „Andere folgen lassen“ an ist, sonst `null`. Andere zeigen „… präsentiert · Folgen“ und passen beim Folgen ihre Ansicht auf den Rahmen ein |

## Vorlagen

Die Galerie (`templates/catalog.ts`) erzeugt gewöhnliche Objekte (Rahmen, Formen, Haftnotizen, Texte, Verbinder,
Karten, Tabellen, Mindmap-Knoten, Zeitleisten) und fügt sie wie Kopieren/Einfügen ein (ein Undo-Schritt): in der Bildschirmmitte,
wenn dort nichts liegt, sonst am nächsten freien Platz daneben (60 Punkte Abstand, `templates/place.ts`); die
Ansicht fährt hin bzw. zoomt heraus, bis die Vorlage ganz zu sehen ist. Keine eigenen Felder.

27 Vorlagen (Stand Q2, 2026-11): Kanban, Retrospektive, Mindmap, Flussdiagramm, Brainstorming, Eventplanung-Zeitleiste,
Wochenplan, SWOT; Kategorie „Events“ (Feste und Veranstaltungen): Veranstaltungs-Ablauf, Schichtplan, Lageplan,
Ablaufplan Veranstaltungstag, Schichtplan Aufbau & Abbau, Awareness-Konzept, Bühnenplan (mit Kanalliste), Helfer-Briefing,
Nachbesprechung, Budget-Übersicht (IDs unverändert, z. B. `festival`, `dayplan`, `festretro`); Methoden: Start, Stop, Continue, Brainstorming-Cluster, Kanban mit Backlog,
Eisenhower-Matrix, SWOT mit Strategien, Personas, User-Journey, OKR, Entscheidungsmatrix. Die **Suche** (Web und App
gleich, `matchesSearch`) findet Name, Beschreibung, Kategorie und die `keywords` einer Vorlage (z. B. „stage plot“,
„nutzwertanalyse“); die App bekommt die Stichwörter über die Web-Konstanten (`templates.list[].keywords`).

### Eigene Vorlagen („Auswahl als Vorlage speichern …“)

Kontextmenü auf Objekten (`structure.saveTemplate`, Reihenfolge 80; Web und App): Name (Vorschlag: Titel des ersten
Rahmens, sonst erste Textzeile), gespeichert wird die Auswahl samt allem, was ganz in gewählten Rahmen liegt, und den
Verbindern, deren beide Enden mitkommen (`templates/own.ts` `templateFromSelection`), im Format der Zwischenablage
(Schnappschuss-Objekte, Rich-Text als Dokument in `content`). Ablage auf dem Server je Person, privat, auf allen Geräten:
`/api/templates` (docs/contract.md §3 „Eigene Vorlagen“, `server/src/user-templates.ts`; höchstens 50 je Person,
500 Objekte und 250 000 Zeichen Einfüge-Argumente je Vorlage, damit die App sie einfügen kann). Die Galerie zeigt sie unter
**„Meine Vorlagen“** (letzte Kategorie, auch unter „Alle“; Vorschau, Einfügen wie eine Vorlage, Löschen). Bilder/PDFs
behalten ihre Datei-ID: auf einem anderen Board kopiert der Server die Datei wie beim Kopieren über Boards hinweg
(`server/src/image-binding.ts`), sofern man das Quell-Board noch sehen darf – sonst bleibt das Bild leer. Beim Konto
Löschen verschwinden die eigenen Vorlagen, „Meine Daten herunterladen“ enthält sie (`konto.json` `eigeneVorlagen`).

### Vorlagen der Instanz (Vorlagenpakete)

Wer eine Instanz betreibt, ergänzt die Galerie ohne Code: JSON-Dateien in `STACHEL_TEMPLATES_DIR` (Standard
`<DATA_DIR>/templates`, im Container `/data/templates`), Format wie `GET /api/templates` (docs/contract.md §3 „Vorlagen der
Instanz“, `server/src/template-packs.ts`, Anleitung in `docs/selfhosting.md`). Der Server liefert sie über
`GET /api/templates/instance`; die Galerie (`templates/packApi.ts`) zeigt sie unter der Kategorie der Instanz
(`STACHEL_TEMPLATES_CATEGORY`, vor „Meine Vorlagen“, auch unter „Alle“, Plakette mit dem Kategorienamen) und fügt sie wie
eigene Vorlagen ein; die App nimmt dieselbe Route und `structure.insert`. Ohne Dateien gibt es die Kategorie nicht.

## Einfügen auf dem Board (`paste.tsx`)

Fremder Text mit Tabs (Excel, Google Tabellen, TSV; Felder in `"…"` dürfen Tabs und Zeilenumbrüche enthalten)
bzw. mit mindestens zwei nicht-leeren Zeilen öffnet „Einfügen als …“: **Tabelle** (erste Zeile als Kopfzeile, höchstens
300 × 40), **N Haftnotizen** (eine je Zelle im Raster der Tabelle bzw. eine je Zeile, höchstens 200) oder **Eine
Haftnotiz** (wie bisher, Tabs als Leerzeichen). Enter nimmt die erste Wahl, Esc fügt nichts ein. Eingefügt wird am
Mauszeiger (sonst Bildmitte), ausgewählt, ein Undo-Schritt. Eine Zeile, Bilder und Stachel-Objekte gehen wie bisher an
den Editor. Umsetzung ohne Kern-Änderung: Overlay-Slot mit `paste`-Beobachter in der Capture-Phase. Das Einfügen über
das Kontextmenü („Einfügen“) liest die Zwischenablage im Editor selbst und fragt nicht.

## Mindmap: leere neue Knoten

Ein über Tab, Enter, Plus oder Kontextleiste angelegter Knoten, der beim Ende der Bearbeitung leer ist und keine
Unterthemen hat, verschwindet wieder (Anlegen wird zurückgenommen, nicht wiederholbar) – ein versehentlicher Klick auf
„Unterthema anlegen“ hinterlässt so keinen leeren Knoten.

## Native-Aktionen (App, docs/contract.md §8.12)

`web/src/features/structure/frames/native.ts` (Paket P4), Test `server/test/native-act-frames.test.ts`:

| Aktion | `args` | Undo | Ergebnis |
|---|---|---|---|
| `frames.reorder` | `{id, to}` – Rahmen `id` an Platz `to` der Rahmen-Liste (zu groß = ans Ende) | `undo` (ein Schritt) | `data` = Rahmen-IDs in neuer Reihenfolge; unbekannter Rahmen → `skipped` |

Rechnet wie Ziehen am Griff in der Web-Liste (`order.ts`: `framesInOrder` aus dem aktuellen Stand, `movePatches` setzt
`slide`). Präsentation und „Andere folgen lassen“ brauchen keine Aktion: die App setzt `presence.extra`
`structure.present` (`{frameId, index, total, title}`) und liest es bei den anderen.

`web/src/features/structure/native.ts` und `table/native.ts` (Paket P3), Tests `server/test/native-act-structure.test.ts`,
`native-act-table.test.ts`. Derselbe React-freie Code wie im Browser: `templates/catalog.ts` + `place.ts` + `insert.ts`
(Einfügen wie `pasteObjects`: Mitte auf die Stelle, Klone mit neuen IDs, Verbinder/Mindmap-Eltern umgeschrieben),
`paste-model.ts`, `card/model.ts`, `table/yjs.ts` + `create.ts`. Neue Objekte, Zeilen und Spalten bekommen die festen IDs
`<key>-1`, `<key>-2` … (Reihenfolge wie die Aktion sie anlegt). Alle Aktionen: Undo `undo` (ein Schritt je Aktion bzw.
wie im Browser zusammengefasst), gesperrte oder fehlende Ziele → `skipped`.

| Aktion | `args` | Ergebnis |
|---|---|---|
| `structure.template` | `{template, x, y}` – Vorlagen-ID (`TEMPLATES`), Bildmitte der App | `select` = alle neuen Objekte, `data.rect` = Umriss an der Einfüge-Stelle (Bildmitte bzw. nächster freier Platz, 60 Abstand); die App fährt hin bzw. zoomt nur heraus wie `insertAtFreeSpot`. Kosten = Zahl der Objekte |
| `structure.insert` | `{json, x, y}` – Objekte einer eigenen Vorlage (`GET /api/templates`) als JSON-Text (≤ 250 000 Zeichen; Rich-Text ist tiefer verschachtelt, als `args` erlauben), Bildmitte der App | wie `structure.template` (`select`, `data.rect`); Objekte werden wie im Browser gesäubert (`cleanTemplateObjects`: bekannte Typen, gültige Lage, einfache Feldnamen, Rich-Text nur als Dokument, ohne `z`/Ersteller:in/Sperre); nichts Brauchbares bzw. kein JSON → `skipped`. Kosten = Zahl der Objekte (≤ 500) |
| `structure.paste` | `{text, as: "table"\|"notes"\|"note", x, y, color?, w?, h?}` – eingefügter Text (≤ 200 000), Wahl aus „Einfügen als …“, Einfüge-Stelle, Notiz wie das Notiz-Werkzeug der App (Standard 200² gelb) | `select` = neue Objekte; Tabelle ohne Tabellendaten bzw. Notizen ohne Zeilen → `skipped`. Kosten `notes` = Zahl der Notizen (≤ 200) |
| `structure.toCard` | `{ids}` – Auswahl; umgewandelt werden nur ungesperrte Haftnotizen | `select` = Karten (Lage, Breite ≥ 300, Text bleibt, Höhe aus dem Inhalt), Notizen weg; keine passende → `skipped` |
| `structure.people` | `{}` | eigener Name in `structure.people` (Auswahl „Zuständig“, wie beim Öffnen im Browser); Undo `none`; schon drin → `skipped` |
| `card.title` | `{id, base?, text}` – neuer Titel der App, `base` = Stand, von dem sie ausging | Titel = Drei-Wege-Zusammenführung mit dem aktuellen Stand (`data.conflict` = dieselbe Stelle anders geändert, die App gewinnt); Höhe aus dem Inhalt |
| `card.desc` | `{id, base?, text}` – Beschreibung | wie `card.title`, aber ins `Y.Text` `desc` nur der Unterschied (alter String wird `Y.Text`); gleichzeitiges Tippen im Browser bleibt |
| `table.setCell` | `{id, r, c, base?, text}` – Zeilen-/Spalten-ID der Zelle | Zelle als `Y.Text` zusammengeführt (wie `card.desc`), Tabellenhöhe aus den umbrochenen Zellen; Zelle fehlt → `skipped` |
| `table.addRow` / `table.addCol` | `{id, after?}` – aktive Zeile/Spalte (fehlt = am Ende) | neue Zeile `data.row` bzw. Spalte `data.col` (= `<key>-1`; Spalte so breit wie der Durchschnitt, Tabelle breiter) |
| `table.removeRow` / `table.removeCol` | `{id, row}` / `{id, col}` | die letzte Zeile/Spalte bleibt (`skipped`); Spalte: Tabelle schmaler |
| `table.resizeCol` | `{id, i, px}` – Grenze nach Spalte `i`, `px` = Breiten aller Spalten nach dem Ziehen | nur Spalten `i`/`i+1` ändern ihr Gewicht, Gesamtbreite bleibt; falsche Spaltenzahl → `skipped` |
| `table.setHead` | `{id, head: "row"\|"col"\|"both"\|"none"}` | `tableHead` (`row` = Feld weg) und Höhe neu (Kopfzeile fett) |

Klartext-Zusammenführen (`card.*`, `table.setCell`, später Zeitleisten-Titel): `server/src/native/ytext-merge.ts` (wie
`richmerge.ts`, aber Zeichen ohne Marks; Web-Code bekommt es über `ctx.text`). Kartenhöhe ohne Browser:
`cardContentHeight` (`card/model.ts`) rechnet das Layout von `.structure-card__inner` mit den Schriftmaßen nach (Titel
17/600 umbrochen, Beschreibung höchstens 4 Zeilen, Fußzeile mit Umbruch); die App rechnet mit derselben Formel. Status,
Person, Fälligkeit, Tags, Farbe und Spaltenkopf-Farbe schreibt die App mit `update` (+ `h` der Karte), Karten/Tabellen
legt sie mit `create` an (Werkzeug „Karte, Tabelle, Mindmap“). Vorschaubilder der Galerie in der App:
`docs/native_fixtures/web/templates.json` (`tools/native-template-fixtures.mts`, festes Datum, feste IDs).
