# Vertrag: Zeitleiste (Modul „structure“, `web/src/features/structure/timeline/`)

Zeitleiste (Zeitachse mit Spuren), gedacht für die Event-Planung des Orga-Teams: Datumsachse oben, Spuren mit
Namen links, Einträge als Balken (Start bis Ende) oder Meilenstein (ein Tag, Raute). Alles ist optional – alte Boards
laden unverändert, ältere Clients blenden den unbekannten Typ aus (er bleibt im Dokument erhalten).

Dateien: `model.ts` (Datum, Raster, Packen, Treffer – ohne React/Yjs), `yjs.ts` (Y-Struktur, Änderungen),
`timeline.tsx` (Objekttyp, Ansicht, Inline-Bearbeitung), `gestures.ts` (Ziehen), `ui.tsx` (Kontextleiste, Menüs,
Dialog, Griffe, Kürzel, Notiz hineinziehen), `state.ts` (lokaler Zustand), `preview.tsx` (SVG für Galerie/Rahmen-Liste),
`template.ts` (Vorlage „Eventplanung-Zeitleiste“). Tests: `timeline.test.ts`, `web/e2e/structure-timeline.spec.ts`.

## Objekttyp `timeline` (in `doc.getMap("objects")`)

| Feld | Inhalt |
|---|---|
| `x`, `y`, `w`, `h` | wie alle Objekte; `w`/`h` folgen dem Inhalt (siehe Geometrie) |
| `tlStart` | erster sichtbarer Tag `YYYY-MM-DD` (fehlt: Montag dieser Woche) |
| `tlEnd` | letzter sichtbarer Tag einschließlich (fehlt: 8 Wochen ab `tlStart`; höchstens 1100 Tage) |
| `tlUnit` | Zeitskala `'day'` \| `'month'`; fehlt = Woche |
| `timeline` | Y.Map (siehe unten); im Schnappschuss die Lesekopie `{ lanes, names, items }` |

### Feld `timeline` (Y.Map)

| Schlüssel | Typ | Inhalt |
|---|---|---|
| `lanes` | `Y.Array<string>` | Reihenfolge der Spur-ids (mindestens eine) |
| `names` | `Y.Map<Y.Text \| string>` | Spurname je id |
| `items` | `Y.Map<Y.Map>` | je Eintrag eine Y.Map: `lane` (Spur-id), `start`, `end` (`YYYY-MM-DD`, einschließlich), `title` (`Y.Text`, alt: String), `color?` (fehlt = Blau `#1763b5`), `ms?` (`true` = Meilenstein, `end` = `start`) |

Zusammenführen: Jeder Eintrag ist eine eigene Y.Map, jedes Feld wird einzeln und nur bei Änderung geschrieben. Zwei
Personen können gleichzeitig verschiedene Einträge ziehen oder am selben Eintrag Datum und Titel ändern, ohne sich zu
überschreiben; gleichzeitiges Tippen im selben Titel führt `Y.Text` zusammen. Lesekopie tolerant (`safeTimeline`):
doppelte Spuren entfallen, Ende vor Anfang wird getauscht, Einträge einer (gleichzeitig) gelöschten Spur erscheinen in
der ersten Spur, kaputte Einträge werden übergangen. Kopieren/Einfügen baut aus der Lesekopie eine neue Y-Struktur
(`registerYField('timeline')`). Undo: alle Änderungen laufen über `store.transact` (ein Ziehen = ein Schritt).

### Geometrie

Gerechnet wird in inneren Einheiten: Namensspalte 168, Kopf 58 (zwei Zeilen), Spalte je Tag 40 (Tag) / 18 (Woche) /
5 (Monat), Spurhöhe aus den Zeilen (Balken 30, Zeile 38, mindestens 54). Überlappende Einträge einer Spur kommen in
neue Zeilen (gierig nach Anfang sortiert, wie Gantt); Meilensteine belegen zusätzlich Platz für ihren Titel. Das Objekt
zeigt die innere Fläche `W0 × H0` skaliert (`w / W0`, `h / H0`): Eckgriffe skalieren alles, jede Änderung setzt `w`/`h`
neu bei gleichem Maßstab. Passt `h` nach gleichzeitigen Änderungen zweier Personen nicht genau, wird nur leicht
gestreckt, bis die nächste Änderung die Größe neu setzt.

## Bedienung

- **Anlegen:** Werkzeug „Karte, Tabelle, Mindmap“ → „Zeitleiste“, Vorlage „Eventplanung-Zeitleiste“ (Planung).
- **Einträge:** Doppelklick in eine Spur (Länge je Skala 1/7/14 Tage), in der ausgewählten Zeitleiste in einer Spur
  aufziehen (Maus), Kontextmenü „Eintrag hier anlegen“, Knopf „Eintrag hinzufügen“ (heute bzw. Anfang, aktive Spur).
  Danach gleich den Titel tippen (Enter/Esc beendet).
- **Ziehen:** Eintrag ziehen verschiebt ihn (rastet auf Tage, Spur folgt dem Zeiger), Enden ziehen ändert die Länge,
  Esc bricht ab. Aktiver Eintrag: Griffe an beiden Enden (am Handy 44 px), Pfeile ←/→ einen Tag (Umschalt: Woche),
  ↑/↓ Spur wechseln, Entf löscht nur den Eintrag, Esc hebt ihn auf.
- **Kontextleiste:** Zeitskala Tag/Woche/Monat, Spur hinzufügen, Eintrag hinzufügen; mit aktivem Eintrag Farbe,
  Meilenstein, „Datum ändern“ (Dialog mit Titel, Beginn, Ende, Spur, Farbe), Eintrag löschen.
- **Kontextmenü:** auf Eintrag „Titel, Datum und Spur …“, „Farbe“, „Als Meilenstein/Als Balken“, „Eintrag löschen“;
  auf Spur „Spur umbenennen“, „Spur darunter einfügen“, „Spur nach oben/unten“, „Spur löschen“ (samt Einträgen; die
  letzte bleibt).
- **Spuren:** Doppelklick auf den Namen benennt um, „+ Spur“ unter der Zeitleiste, Griff ⋮⋮ zieht die Spur an eine andere
  Stelle.
- **Zeitraum:** linker/rechter Rand (Seitengriffe) holt Tage dazu bzw. nimmt sie weg (Tagesbreite bleibt). Liegen
  Einträge außerhalb, zeigt der Kopf „‹ 2“ bzw. „3 ›“ – Klick erweitert den Zeitraum bis dorthin.
- **Haftnotiz/Karte hineinziehen:** auf eine Spur gezogen (grüne Markierung) wird sie zum Eintrag mit ihrem Text und
  ihrer Farbe (ein Undo-Schritt holt die Notiz zurück).
- **Handy/Touch:** erst antippen wählt die Zeitleiste (ein Finger auf einer nicht ausgewählten verschiebt die Ansicht),
  dann ziehen Einträge und Griffe; langes Drücken auf einen Eintrag öffnet den Dialog.
- **Sonst:** Suche findet Spurnamen und Titel (`plainText`), Export PNG/PDF zeichnet die Zeitleiste wie im Editor,
  weit herausgezoomt nur Flächen (ohne Texte), ganz klein eine einfache Fläche.

## Lokaler Zustand (nicht im Dokument)

Aktiver Eintrag bzw. aktive Spur je Zeitleiste, Bearbeitungsziel, Entwürfe beim Ziehen (`state.ts`). Keine
Awareness-Felder, keine Erweiterungs-Maps.

## Native-Aktionen (App, docs/contract.md §8.12)

`web/src/features/structure/timeline/native.ts` (Paket P9), Test `server/test/native-act-timeline.test.ts`. Derselbe
React-freie Code wie im Browser (`yjs.ts`: `addItem`, `patchItem`, `addLane`, `moveLane`, `removeLane`, `setRange`,
`setUnit`, `editTimeline`; `model.ts`: `toggleMsPatch`, `dayPatch`, `extendRange`, `droppedItem`, die auch Kontextleiste,
Dialog, „‹ n“ und `dropInto` benutzen). Jede Aktion ist ein Rückgängig-Schritt (`undo`), die Größe (`w`/`h`) folgt dem neuen
Layout bei gleichem Maßstab; gesperrte oder fehlende Zeitleiste, Eintrag bzw. Spur → `skipped`. Neue Einträge/Spuren
bekommen die festen IDs `<key>-1` … Titel und Spurnamen: Eingabe der App (`text`, ausgehend von `base`) wird mit dem
aktuellen `Y.Text` zusammengeführt (`ctx.text`, server/src/native/ytext-merge.ts; `data.conflict` = dieselbe Stelle anders
geändert, die App gewinnt). Tage immer `YYYY-MM-DD`.

| Aktion | `args` | Ergebnis |
|---|---|---|
| `timeline.addItem` | `{id, lane, start, end, title?, color?, ms?}` – Tage rechnet die App wie `newItemAt` (Standardlänge je Skala) | `data.key` = `<key>-1`; unbekannte Spur → erste |
| `timeline.patchItem` | `{id, key, start?, end?, lane?, color?: Farbe\|null, ms?}` – Ziehen, Spur, Farbe (`null` = Standard-Blau); `ms` schaltet wie die Kontextleiste um (Balken bekommt die Standardlänge) | nur Geänderte geschrieben |
| `timeline.setDay` | `{id, key, which: "start"\|"end", day}` – Dialog | wie `dayPatch`: Beginn behält die Länge, Ende ≥ Beginn, Meilenstein ein Tag |
| `timeline.removeItem` | `{id, key}` | – |
| `timeline.setTitle` | `{id, key, base?, text}` (≤ 200) | `data.conflict`; Meilenstein-Titel ändert das Packen (Höhe) |
| `timeline.addLane` | `{id, after?, name?}` – unter der aktiven Spur bzw. am Ende | `data.lane` = `<key>-1`; 40 Spuren → `toast` „Mehr Spuren gehen nicht.“, `data.lane` = null |
| `timeline.setLaneName` | `{id, lane, base?, text}` (≤ 200) | `data.conflict` |
| `timeline.moveLane` | `{id, lane, to}` – Index in der neuen Reihenfolge („nach oben/unten“, Griff ⋮⋮) | gleicher Platz → `skipped` |
| `timeline.removeLane` | `{id, lane}` – samt Einträgen | letzte Spur → `skipped` |
| `timeline.setRange` | `{id, extend: "before"\|"after"}` (Knopf „‹ n“/„n ›“) oder `{id, start, end}` | höchstens 1100 Tage; gleich → `skipped` |
| `timeline.setUnit` | `{id, unit: "day"\|"week"\|"month"}` | Woche = Feld entfernt |
| `timeline.adopt` | `{ids}` – nach dem Verschieben (erst die Bewegung, dann die Aktion): Haftnotizen/Karten, deren Mitte auf einer Spur der obersten ungesperrten Zeitleiste liegt | Einträge `<key>-1` … (Text, Farbe, Tag unter der Mitte), Notizen weg (ein Schritt), `select` = Zeitleiste, `toast` wie im Browser, `data` = `{timeline, key}` des letzten; keine passende → `skipped`. Kosten = Zahl der `ids` |

Die Seitengriffe schreibt die App selbst als `update` (`tlStart`/`tlEnd`, `x`, `w`, `h` wie `resize` im Browser; Portierung
mit Referenzwerten aus `tools/native-timeline-fixtures.mts` → `docs/native_fixtures/web/timeline.json`), eine neue Zeitleiste
als `create` wie `newTimeline`.
