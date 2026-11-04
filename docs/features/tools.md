# Vertrag: Feature-Modul „tools“

Gehört dem Modul `web/src/features/tools/` (Werkzeuge, Export & Mobil). Hier stehen seine Objektfelder, Y-Strukturen,
lokalen Einstellungen und Server-Endpunkte (siehe docs/contract.md §3–§5).

## Objektfelder (Module-Augmentation in `features/tools/model.ts`)

| Feld | Typ | Bedeutung |
|---|---|---|
| `hidden` | `boolean` (optional) | Ausgeblendet: für alle unsichtbar, nicht anklickbar, nicht in Suche, Export und Vorschaubild. Wer „Ausgeblendete zeigen“ (Board-Menü) einschaltet, sieht es blass mit gestricheltem Rand und kann es wieder einblenden. Fehlt = sichtbar. Ältere Clients zeigen das Objekt normal. |
| `marker` | `boolean` (optional, nur `pen`) | Textmarker-Strich (Stift-Werkzeug → „Textmarker“): Deckkraft 0,45 und `mix-blend-mode: multiply`, Farben `#ffe14d` `#c9e14a` `#ec4e92` `#4fa3ff` `#ff9a3c`, Breiten 12/20/32. Ältere Clients zeigen einen deckenden Strich. |
| `linkTo` | `string` (optional, Objekt-id) | Link zu einem anderen Objekt bzw. Rahmen desselben Boards (nicht bei Verbinder/Stift). Knopf oben rechts am Objekt fährt hin und wählt das Ziel aus (auch in der Präsentation); fehlt das Ziel, zeigt der Knopf es pink und gibt einen Hinweis. Kopieren behält das Ziel. |
| `tags` | `{label, color}[]` (optional, nur `sticky`) | Notiz-Tags; gleiches Feld und Format wie die Tags von Karten (structure). Höchstens 8, Name ≤ 40 Zeichen. Die Tag-Liste des Boards ergibt sich aus allen Notizen und Karten (gleicher Name ohne Groß-/Kleinschreibung = ein Tag, erste Farbe gilt); keine eigene Y-Struktur. Kopie daneben (Plus-Griff/Tab) ohne Tags. |

Ersetzte Kern-Einträge: Objekttypen `pen` (Textmarker-Darstellung) und `sticky` (Tags unten auf der Notiz, eigene Ebene in
derselben Lage), Werkzeug `pen` (Modus Stift/Textmarker im Untermenü, Werkzeug-Optionen `pen.mode`, `pen.markerColor`,
`pen.markerWidth`, nur im Speicher). Alle anderen Funktionen (Format übertragen, Ebenen, Sperren) nutzen nur vorhandene Felder (`color`, `bold`, …, `z`, `locked`).

**Format übertragen** (Strg Alt C / Strg Alt V, Format-Pinsel) überträgt wie „Stil einfügen“ nur Formatfelder, nach
einer Positivliste je Typ (`STYLE_KEYS` in `formatPainter.tsx`): Haftnotiz `color`, Schrift (`fontSize`, `fontFamily`,
`bold`, `italic`, `strike`, `align`, `valign`); Text `color` + Schrift; Form zusätzlich `stroke`, `strokeWidth`, `dash`,
`fillOpacity` (nicht die Formart); Verbinder `color`, `strokeWidth`, `dash`, `lineStyle`, Spitzen, Schrift; Stift `color`,
`strokeWidth`, `marker`; Rahmen, Karte, Mindmap-Knoten, Icon nur `color`; Tabelle `color`, `tableHead`; unbekannte Typen
nur `color`. Inhalt, Tags, Person, Datum, Status, Beschreibung, Tabelleninhalt, Mindmap-Baum (`mind`), Links und Lage
bleiben immer. Zwischen verschiedenen Typen: Schriftfelder, die beide kennen, und die Farbe bei gleicher Art (Füllung bzw. Strich).

**Suche** (Strg F) findet Klartext, Rahmentitel, Tags (Notizen und Karten) und die zuständige Person einer Karte.

## Y-Strukturen

| Name | Typ | Inhalt | Rückgängig |
|---|---|---|---|
| `tools.settings` | `Y.Map` | `pattern`: `'dots'` (Standard) \| `'lines'` \| `'none'`; `color`: Hintergrundfarbe `#rrggbb` (Standard `#f3f3ef`); `lastPattern`: zuletzt gewähltes Muster vor „Raster aus“; `authors`: `true` = Autor:in an jeder Haftnotiz zeigen (Standard aus; Slot `collab.authors` im Modul collab zeichnet die Namen) | nein (`undo: false`) |

Fehlt die Map oder ein Wert (altes Board) bzw. ist ein Wert unbekannt, gilt der Standard. Board-Einstellungen gelten für alle.

## Lokale Einstellungen (nur dieser Browser)

- `localStorage['stachel:tools:prefs']` = `{ snap: boolean }` – Am Raster (24 Einheiten) einrasten beim Ziehen mit dem Zeiger.
- „Ausgeblendete zeigen“ gilt nur bis zum Neuladen (Speicher).

## Awareness

Keine eigenen Felder.

## Links

- Objekt-Link: `{PUBLIC_URL}/?b=<boardId>&o=<objektId>` – der Editor fährt nach dem Laden zum Objekt, wählt es aus und
  entfernt `o` aus der Adresszeile (Offline-Modus: `?offline=1&o=…`).
- Anmeldung am Handy/Tablet: Knopf „In der {App} öffnen“ (Modus org, Name aus `/api/instance`) verlinkt die Pairing-URL `{PUBLIC_URL}/qr/<code>`
  (aus `POST /api/auth/qr`); der Browser wartet wie beim QR-Code per Long-Poll. Die App der Organisation kann den Link als
  Deep-Link übernehmen (gleicher Ablauf wie beim Scannen, docs/contract.md §2).

## Server (docs/contract.md §3)

- `GET /api/boards/:id/thumbnail?v=<thumbnailAt>` – Vorschaubild (WebP 560 × 260), Tabelle `board_thumbnails` (Spalte
  `renderer`: 1 = früher vom Browser hochgeladen, 2 = Server). `PUT` wird nur noch quittiert (alte Clients).
- `POST /api/boards/:id/photo-notes` – Zettel abfotografieren (`docs/features/photo-notes.md`).
- `POST /api/boards/:id/duplicate` `{title?, template?}` – Kopie inkl. Live-Stand, Bilder (neue IDs) und Vorschaubild;
  `template: true` markiert die Kopie als Vorlage (Tabelle `board_templates`).
- `BoardInfo.thumbnailAt?`, `BoardInfo.template?` in `GET /api/boards`.
- Code: `server/src/thumbnails.ts`, `server/src/board-copies.ts`; Tests: `server/test/thumbnails.test.ts`.

Vorschaubilder erzeugt seit Welle B (P8) der **Server** (`ServerThumbnails` in `server/src/thumbnails.ts`): nach dem
Speichern eines Board-Dokuments 5 s Ruhe, höchstens einmal je Minute und Board, eins nach dem anderen; beim Start werden
fehlende und vom Browser stammende Vorschauen nachgeholt (`backfill`). Das SVG baut der React-freie Web-Code
`features/tools/thumbSvg.ts` (Notizen mit WCAG-Schrift, Formen, Text, Verbinder, Stift, Bilder als verkleinerte
Originale des Boards, Karten, Mindmaps, Rahmen mit Titel; Tabellen/Zeitleisten/Fremdtypen als Fläche mit Titel), sharp
rastert es mit den Barlow-Schriften aus `server/assets/fonts` (fontconfig im Temp-Ordner, `STACHEL_FONTS_DIR`).
**Lesbar:** Text mindestens 13 Bildpunkte (auf die Fläche gekürzt, sonst Balken), Rahmentitel immer, Maßstab mindestens
0,3 – größere Boards zeigen den Ausschnitt mit den meisten ganz sichtbaren Objekten. **Privat:** nur das Board-Dokument
(private Ablagen nie), ausgeblendete Objekte fehlen; Abruf nur mit Board-Recht. Browser und Apps laden nichts mehr hoch.
Tests: `server/test/thumbnails-render.test.ts`, `server/test/thumbnails.test.ts`.

## Export

Clientseitig, ohne externe Dienste: Objekte werden mit der Editor-Darstellung (`ObjectLayer`) in ein verstecktes
Element gerendert, als SVG-`foreignObject` mit eingebettetem CSS, Schriften (nur benutzte Barlow-Schnitte, latin/latin-ext)
und Bildern als data:-URLs gezeichnet. PNG über Canvas; PDF mit eigenem PDF-1.4-Schreiber (verlustfrei per Flate, sonst JPEG).
Bereiche: ganzes Board, Auswahl, ein Rahmen, alle Rahmen (PDF: eine Seite je Rahmen). Grenzen: 8192 px je Seite, 36 Mio. Pixel.

## Menüs

- Board-Menü („···“): Suchen, **Suchen und ersetzen** (Strg H), **Befehl suchen …** (Strg K), Exportieren, Link kopieren, **Board duplizieren** (öffnet die Kopie), **Als Vorlage
  speichern** (beides nur mit Server, `POST /api/boards/:id/duplicate`), Raster, Einrasten, Ausgeblendete,
  Board-Einstellungen, Tastenkürzel.
- Rechtsklick auf Objekte (am Handy langes Drücken): zusätzlich Ausschneiden, Ebenen schrittweise, Aus-/Einblenden,
  Format kopieren/einfügen, Link kopieren, „Link zu …“ (Ziel auf dem Board wählen, Zum Ziel springen, Link entfernen),
  Als Bild/Rahmen exportieren, **Clustern › Nach Farbe / Nach Tag / Nach Autor:in** (ab zwei beweglichen Einheiten) und
  **Typ wechseln › Haftnotiz / Form / Text / Karte** (Q3, siehe unten).
- Kontextleiste: „Tags“ (nur Haftnotizen: vorhandene Tags an-/abschalten, neuen Tag mit Farbe anlegen) und „Link zu Rahmen
  oder Objekt“ (Rahmen-Liste, Ziel auf dem Board wählen – nächster Klick, Esc bricht ab –, Link entfernen).
- Rechtsklick auf leere Fläche: zusätzlich Suchen, Exportieren, Raster, Hintergrund & Raster, Ausgeblendete zeigen,
  Rückgängig/Wiederholen.

## Native-Aktionen (App, docs/contract.md §8.12)

`web/src/features/tools/native-view.ts` (Paket P4), Test `server/test/native-act-view.test.ts`:

| Aktion | `args` | Undo | Ergebnis |
|---|---|---|---|
| `tools.settings` (Version 2) | `{pattern?: 'dots'\|'lines'\|'none', color?: '#rrggbb', toggleGrid?: true, authors?: boolean}` (mindestens eins; `toggleGrid` nicht mit `pattern`; `authors` seit Version 2 – die App zeigt den Schalter erst dann) | `none` (wie der Dialog) | `data` = Einstellungen danach `{pattern, color, authors}` |

Gleicher Code wie Dialog und Strg ': `settingsModel.ts` (`writeSettingsTo`, `toggleGridOf` merkt `lastPattern`; React-frei,
`settings.ts` reicht es an den Editor weiter). Die App liest `tools.settings` aus `ext` und zeichnet den Hintergrund
selbst (Punkte/Linien, Farbe, helles Muster auf dunklem Grund).

Paket P1 (Auswahl & Anordnen): `web/src/board/ops/native.ts` (Kern) und `web/src/features/tools/native.ts`, Tests
`server/test/native-act-core.test.ts`, `server/test/native-act-tools.test.ts`:

| Aktion | `args` | Undo | Ergebnis |
|---|---|---|---|
| `core.group` | `{ids}` | `undo` | `select` = die gruppierten (≥ 2 ungesperrte, sonst `skipped`) |
| `core.ungroup` | `{ids}` | `undo` | `select` = `ids` |
| `core.align` | `{ids, mode: 'left'\|'hcenter'\|'right'\|'top'\|'vcenter'\|'bottom'}` | `undo` | `{}` bzw. `skipped` (< 2 Einheiten) |
| `core.distribute` | `{ids, axis: 'x'\|'y'}` | `undo` | `{}` bzw. `skipped` (< 3 Einheiten) |
| `tools.layerStep` | `{ids, dir: 1\|-1}` | `undo` | `{}` bzw. `skipped` (nichts Überlappendes in der Richtung) |
| `tools.copyStyle` | `{id}` | `none` (schreibt nichts) | `data` = Format `{type, fields}` (Positivliste je Typ), `toast` „Format kopiert.“ |
| `tools.pasteStyle` | `{ids, style}` oder `{ids, from}`, `painter?` | `undo` | `{}`; passt nichts: `toast` „Das Format passt nicht zu dieser Auswahl.“ (mit `painter`: „… zu diesem Objekt.“) |
| `tools.photoNotes` | `{notes: [{x,y,w,h,color,text}] (1–60), x, y}` (Zettel aus `POST …/photo-notes`, ggf. korrigiert; Mitte) | `undo` | `select` = `focus` = neue Notizen, `toast` „N Notizen angelegt.“ (`photoNotes.ts`, Welle B) |

Gleicher Code wie der Editor: Gruppen `board/ops/groups.ts`; Ausrichten/Verteilen `board/ops/arrange.ts`
(`arrangeUnits`, `arrangePatches` – Gruppen als Einheit, ohne Verbinder/Gesperrte, Rahmen nehmen Inhalt mit über
`movableObjects` in `board/ops/move.ts`; Editor `typeDef(o).container`, Server: Typen „unten“ = Rahmen); Ebenen
`layers.ts`; Format `style.ts` (`STYLE_KEYS`, `extractStyle`, `stylePatch`, `stylePatches`; `formatPainter.tsx` nutzt
es mit den Typ-Eigenschaften aus dem Register, der Server mit `CORE_STYLE_TRAITS` – `style.test.ts` hält beide gleich).
`style` wird auf die Positivliste des Vorbild-Typs beschnitten. Textbreite bei autoWidth wie `adjustPatch` des Typs
`text` (`adjustTextPatch` in `editor/interaction/textWidth.ts`, ohne Canvas über die Schriftmaße des Servers). Nicht auf dem
Server: das Nachmessen der Texthöhe nach dem Rendern (`remeasure`) – in der App noch offen.
Referenzwerte der App-Portierungen (Einrasten, Lasso, Raster, Größe ändern, Drehen): `tools/native-arrange-fixtures.mts` →
`docs/native_fixtures/web/arrange.json`.
Sperren, Ausblenden, „Link zu …“ und Tags schreibt die App direkt mit `update` (`locked`, `hidden`, `linkTo`, `tags`).

### Q3 „Bedienung“: Clustern, Suchen & Ersetzen, Typ wechseln, Befehlspalette (seit 2026-11-04)

Logik React-frei in `cluster.ts`, `replace.ts`, `convert.ts` (Editor: `organize.tsx`, `search.tsx`, `palette.tsx`; App:
dieselben Funktionen als Web-Aktion in `native-organize.ts`), Tests `web/src/features/tools/organize.test.ts`,
`server/test/native-act-organize.test.ts`, App `stachel_board` `test/features/commands/` (UI + live).

| Aktion | `args` | Undo | Ergebnis |
|---|---|---|---|
| `tools.cluster` | `{ids, by: 'color'\|'tag'\|'author'}` | `undo` | `select` = Bewegtes + Überschriften (IDs `<key>-1` …), `data` `{groups, rect}`; < 2 Einheiten: `skipped` + `toast` |
| `tools.replace` | `{ids, query, replace, first?}` (`ids` = Treffer der Suche in Lesereihenfolge ab dem aktuellen) | `undo` | `data` `{replaced, changed, locked}`, `toast` wie im Web („3 Stellen ersetzt.“ …); nichts: `skipped` |
| `tools.convert` | `{ids, to: 'sticky'\|'shape'\|'text'\|'card'}` | `undo` | `select` = `data.changed` = gewechselte IDs; nichts passt: `skipped` |

- **Clustern** (`clusterInStore`): Einheiten = ungesperrte Objekte ohne Verbinder/Rahmen/Mindmap-Knoten, Gruppen ganz.
  Gruppen nach Farbe (ohne `color` = Farbe des Typs), erstem Tag (ohne Groß/Klein) bzw. `createdBy`; Reihenfolge = erstes
  Vorkommen in Lesereihenfolge, je Gruppe ein Raster mit round(√n) Spalten (Abstand 24 bei lauter Notizen, sonst 48),
  Gruppen nebeneinander (Abstand max(120, 4 × Abstand)) ab der linken oberen Ecke der Auswahl, darüber eine Überschrift
  (Text, Barlow Condensed 32 fett): Farbname (`CLUSTER_COLOR_NAMES` = `COLOR_NAMES` aus ui/a11y.ts), Tag, Name der Person
  (`structure.people`, Anwesende, eigene Sitzung; sonst „Unbekannt“). Freie Verbinder-Enden zwischen bewegten Objekten
  wandern mit. Das Raster ist `clusterLayout` – das MCP-Auto-Layout (`mcp/src/ops/layout.ts` `layoutClusters`, Modus
  `cluster`) rechnet damit, KI und Editor ordnen also gleich an.
- **Suchen & Ersetzen** (`replaceInStore`): Fundstellen wie die Suche (`ui/search.ts` `fold`: ohne Groß/Klein,
  Umlaut-tolerant), ersetzt in Text von Haftnotiz/Text/Form/Verbinder-Beschriftung (Rich-Text: je `Y.XmlText`, der Ersatz
  trägt die Marks des ersten Zeichens der Fundstelle, Klartext `text` folgt), Rahmentitel, Kartentitel und -beschreibung
  (Y.Text nur an den Fundstellen). Nicht: Tags, Tabellen, Mindmaps, Zeitleisten. Gesperrtes bleibt (gezählt). Vorschau
  „3 Stellen in 2 Objekten, 1 gesperrt“ (`replacePreview`); „Ersetzen“ (Enter) = erste Fundstelle ab dem aktuellen Treffer,
  „Alle“ (Strg Enter). Zeile nur mit Schreibrecht (nicht „Kann ansehen/kommentieren“, nicht in der Präsentation).
  Text-Objekte mit autoWidth bekommen ihre Breite (`adjustTextPatch`), Karten ihre Höhe (`cardContentHeight`).
- **Typ wechseln** (`convertInStore`): gleiches Y.Map (ID, Lage, Ebene, Gruppe, `createdBy`, Kommentare, Stimmen,
  Verbinder bleiben), nur Felder, die der neue Typ nicht kennt, fallen weg (Listen je Typ wie `docs/native_paritaet.md`).
  Notiz ↔ Form behält die Füllfarbe; Text-Objekte schreiben schwarz (28 bzw. die Schriftgröße); Karte: blauer Streifen,
  Breite ≥ 300, Titel = Klartext (Rich-Text fällt weg), Höhe gemessen; Karte → andere: Titel + Beschreibung als Text.
  Text → Notiz/Form: mindestens 200 × 200 bzw. 180 × 120. Gesperrtes bleibt.
- **Befehlspalette** (Strg K bzw. Strg Umschalt K, Board-Menü „Befehl suchen …“; auf einem gewählten Text bleibt
  Strg K „Link einfügen“): alle Befehle aus den Registern – Menü der Auswahl, Werkzeuge, Board-Menü, Menü der leeren
  Fläche, Kürzel mit Aktion –, Untermenüs flach („Typ wechseln › Form“), gleich benannte einmal; Filter wie die Suche,
  Wortanfang zuerst. App: Board-Menü „Befehl suchen …“ (Schnellzeile) öffnet dieselbe Liste ohne Kürzel-Gruppen.
