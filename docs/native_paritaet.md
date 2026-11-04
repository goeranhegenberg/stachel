# Parität Web ↔ native App (Flutter)

Welche Objekttypen und Felder die Web-App kennt und ab welcher App-Version die native Darstellung (Flutter,
`flutter/packages/stachel_board`) sie kann. Vertrag: `docs/contract.md` §8, Konzept
`docs/native_flutter_konzept.md` §4.4.

**Pflicht bei jedem neuen Objekttyp oder Y-Feld im Web:** Zeile hier + Eintrag in `shared/native.ts`
(`NATIVE_OBJECT_TYPES` bzw. `NATIVE_Y_FIELDS`). Sonst scheitert `server/test/native-parity.test.ts`. Neue *einfache*
Felder (String/Zahl/Boolean/JSON) brauchen keinen Server-Code – der Schnappschuss reicht sie roh durch –, aber eine
Erwähnung hier, damit die App nachzieht. Bis die App einen Typ kann, zeigt sie einen grauen Platzhalter in Objektgröße
mit Typname und „Im Browser ansehen“.

Gemeinsame Felder aller Typen: `id`, `type`, `x`, `y`, `w`, `h`, `z`, `createdBy`, `updatedAt`, `locked`, `groupId`,
`hidden` (tools), `linkTo` (tools), `rotation` (sticky/shape/text/image/sticker/icon).

## Objekttypen

| Typ | Modul | Felder (außer den gemeinsamen) | Y-Felder → JSON | nativ (App) |
|---|---|---|---|---|
| `sticky` | Kern + shapes/richtext/tools | `color`, `text`, `content`, `fontSize` (fehlt = automatisch), `bold`, `italic`, `strike`, `align`, `valign`, `fontFamily`, `tags`, `stacked` (Notiz-Stapel mit `groupId`, Q2) | `content` → ProseMirror-JSON | ansehen E1 (1.22.0); E2: anlegen, Text (Rich-Text bleibt), Farbe/Schrift/Ausrichtung, Größe, Drehen |
| `text` | Kern + richtext | `color` (Textfarbe), `text`, `content`, `fontSize`, `bold`, `italic`, `strike`, `align`, `fontFamily`, `autoWidth` | `content` | ansehen E1 (1.22.0); E2: anlegen, Text (Rich-Text bleibt), Farbe/Schrift/Ausrichtung, Größe, Drehen |
| `shape` | Kern + shapes | `shape` (41 Formen, `shared/protocol.ts` + `web/src/features/shapes/model.ts`), `color`, `stroke`, `strokeWidth`, `dash`, `fillOpacity`, `text`, `content`, `fontSize`, `bold`, `italic`, `strike`, `align`, `valign`, `fontFamily` | `content` | ansehen E1 (1.22.0); E2: anlegen, Text (Rich-Text bleibt), Farbe/Schrift/Ausrichtung, Größe, Drehen |
| `connector` | Kern + shapes | `from`, `to` (`{objectId, side?}` bzw. `{x,y}`), `lineStyle`, `arrowStart`, `arrowEnd`, `capStart`, `capEnd`, `dash`, `color`, `strokeWidth`, `text`, `content` (Beschriftung), `labelPos`, `fontFamily` | `content` | ansehen E1 (1.22.0); E2: Plus-Griff legt an, löschen/duplizieren; **E3:** Werkzeug „Linie“, Plus-Griff/Andockpunkte ziehen (Einrasten an Seitenmitten, ins Leere = gleiche Form), Enden umhängen, Linienart, Spitzen (alle 9, `arrowStart/arrowEnd` mitgeschrieben), Strichart, Stärke, Farbe, Beschriftung (`text`-Op), umkehren |
| `pen` | Kern + tools | `points` (relativ zu x/y), `color`, `strokeWidth`, `marker` (Textmarker) | – | ansehen E1 (1.22.0); E2: verschieben, löschen, duplizieren, Ebene; **E3:** zeichnen (Finger im Stift-Werkzeug, nach einem Stylus nur Stylus), Textmarker, Radierer (ganze Striche), Farbe |
| `frame` | Kern + structure | `title`, `color`, `slide`, `frameGrid`, `frameGridLabels`, `notes` (Sprechernotizen, Q1) (liegt immer unten, §8.4 `below`) | – | ansehen E1 (1.22.0); E2: verschieben, Größe, löschen, duplizieren, Ebene; **E3:** anlegen („Rahmen n“, 640 × 420), benennen, Inhalt wandert mit, Rahmen-Liste; **Q1:** Sprechernotizen bearbeiten/beim Präsentieren sehen |
| `image` | Kern | `imageId` (`GET /api/images/:id?w=256\|1024`), `color` (Durchschnittsfarbe) | – | ansehen E1 (1.22.0); E2: verschieben, Größe, löschen, duplizieren, Ebene; **E3:** einfügen aus Kamera/Galerie (auf dem Gerät verkleinert, `color` berechnet, Größe 120–520 px wie das Web, Upload `POST /api/boards/:id/images`, offline wartend) |
| `sticker` | shapes | `emoji` oder `stamp` | – | ansehen E1 (1.22.0); E2: verschieben, Größe, löschen, duplizieren, Ebene |
| `icon` | shapes | `icon` (lucide-Name), `iconNode` (SVG-Knoten `[tag, attrs][]`), `color` | – | ansehen E1 (1.22.0); E2: verschieben, Größe, löschen, duplizieren, Ebene |
| `card` | structure | `text` (Titel), `desc` (Beschreibung), `status`, `due`, `tags`, `assignee` `{key,name}`, `color` (Streifen) | `desc` kann Y.Text sein → String | ansehen E1 (1.22.0); E2: verschieben, Größe, löschen, duplizieren, Ebene |
| `table` | structure | `table`, `tableHead`, `color` | `table` → `{rows, cols, cells, widths}` | ansehen E1 (1.22.0); E2: verschieben, Größe, löschen, duplizieren, Ebene |
| `mindnode` | structure | `text`, `content`, `color`, `mind` `{parent, order, side, collapsed, level, hidden}` | – | ansehen E1 (1.22.0); E2: verschieben, löschen, duplizieren, Ebene; **Mindmap wie im Web (App-Branch `feat/stachel-mindmap`, nächste Testversion; Op `mind` §8.6):** Unterthema/gleiche Ebene (Plus-Knöpfe, Kontextleiste), Text schreiben, Ein-/Ausklappen mit Anzahl, Löschen samt Unterthemen, Ziehen = Umhängen/Einsortieren, Wurzel nimmt die Mindmap mit, neue Mindmap + Vorlage, Aussehen je Ebene und Linien wie im Web |
| `timeline` | structure | `timeline`, `tlStart`, `tlEnd`, `tlUnit` | `timeline` → `{lanes, names, items}` | ansehen E1 (1.22.0); E2: verschieben, Größe, löschen, duplizieren, Ebene |
| `document` | documents | `docFile`, `docName`, `docCount`, `docPage`, `docPages`, `docRatios`, `imageId` (Bild der aktuellen Seite) | `docPages` → `{"0": imageId, …}` | ansehen E1 (1.22.0); E2: verschieben, Größe, löschen, duplizieren, Ebene |

## Y-Felder (`registerYField` im Web)

| Feld | Typ im Dokument | JSON in §8.5 |
|---|---|---|
| `content` | `Y.XmlFragment` (y-prosemirror) | ProseMirror-JSON |
| `table` | `Y.Map` | `TableData` |
| `timeline` | `Y.Map` | `TimelineData` |
| `docPages` | `Y.Map<string>` | Seitennummer → Bild-ID |

## Feature-Strukturen (`ext`, §8.7)

`collab.comments`, `collab.reactions`, `collab.vote`, `collab.votes`, `collab.voteHistory`, `collab.timer`,
`collab.reads`, `structure.people` – nativ: lesen ab E1. **E3:** `collab.comments` (Pins, Thread lesen/schreiben/
antworten/bearbeiten/löschen/erledigen, @Erwähnung, Liste), `collab.reactions` (Chips, setzen/entfernen) und
`collab.reads` (Gelesen-Stand) über eigene Ops (Vertrag §8.6), Awareness `collab.uploads` über `presence.uploads`;
Erwähnungen/Zuweisungen als Benachrichtigung über `GET /api/native/v1/inbox` (§8.11). Abstimmung, Timer, Folgen: E4.
Neue Felder in diesen Strukturen bitte hier eintragen – die App schreibt sie optimistisch nach (`applyExtOp` in
`pending_ops.dart`), der Server mit dem Web-Code.

## Bearbeiten in der App (E2)

Die App schreibt nur über Ops (Vertrag §8.6) und immer nur die Felder, die sie ändert (`update` je Feld, `text` für
Rich-Text) – unbekannte Typen und Felder bleiben dadurch unangetastet. Neue Objekte legt sie mit den Standardwerten des
Web an (`create` in `web/src/editor/core/objectTypes.tsx`: Notiz 200×200 `#fff27a`, Text 28 px `autoWidth`, Form
180×120 mit Rand). Rich-Text bearbeitet sie auf dem ProseMirror-JSON: Knoten/Marks, die sie nicht kennt, bleiben
(Server `richmerge.ts`, App `rich_edit.dart`). **Neue Felder, die beim Anlegen/Kopieren gesetzt werden müssen**, oder
neue Regeln beim Löschen/Verschieben (wie die Verbinder-Kaskade, die der Server übernimmt) hier eintragen, damit die
App nachzieht.


## Mindmaps (Server-Feature `mind`, App-Branch `feat/stachel-mindmap`)

Die App schickt nur die Absicht (Vertrag §8.6 `mind`), der Server führt **denselben Mindmap-Code wie der Browser** aus
(`web/src/features/structure/mindmap/ops.ts`, über `server/src/native/web-impl.ts`) und schreibt Lage, Größe und `mind` aller
Knoten im selben Schritt – andere Clients rechnen fremde Änderungen nicht nach (structure.md). Die App rechnet dasselbe vorab
(Port in `packages/stachel_board/lib/src/mindmap/`, Schriftmaße `server/src/native/text-metrics.json`) und zeigt es sofort.
**Ändert sich der Mindmap-Code im Web** (Layout, Größen, Farben, Ziehen): `tools/native-mind-fixtures.mts` neu laufen lassen und
`docs/native_fixtures/web/mindmap.json` in die App kopieren (der Dart-Test `mind_web_reference_test.dart` zeigt jede Abweichung);
**neue Schrift/Schriftgröße im Mindmap-Stil**: `tools/text-metrics.mts` (laufender Stachel) und in der App
`dart run tool/gen_text_metrics.dart`.
