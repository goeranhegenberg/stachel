# Vertrag: Feature-Modul „shapes“

Gehört dem Modul `web/src/features/shapes/` (Formen-Bibliothek, Verbinder, Sticker, Icons). Alle Felder sind optional;
ältere Clients ignorieren sie bzw. zeigen den Kern-Fallback (siehe jeweils „Alte Clients“). Augmentation:
`web/src/features/shapes/model.ts`.

## Objekttypen

| Typ | Felder | Darstellung | Alte Clients |
|---|---|---|---|
| `sticker` | `emoji` (ein Emoji-Zeichen) **oder** `stamp` (Stempel-Id, s. u.); `x/y/w/h`, `rotation` | Emoji in der Emoji-Schrift des Systems bzw. Stempel als runde Plakette (SVG) | unbekannter Typ, bleibt erhalten |
| `icon` | `icon` (Name im Iconset, z. B. `tent`), `iconNode` (Zeichnung, s. u.), `color` (Strichfarbe), `strokeWidth` (Standard 2, im 24er-Raster) | SVG 24×24, skaliert auf `w/h` | unbekannter Typ, bleibt erhalten |

- Stempel-Ids: `like`, `heart`, `check`, `question`, `plusOne`, `star`, `exclaim`, `dislike`. Unbekannte Id → `like`.
- `iconNode`: Liste `[tag, attrs]` wie lucide (ISC, `lucide@1.61.0`), gespeichert **im Objekt**, damit das Board ohne
  Iconset-Daten darstellbar bleibt und Kopieren/Einfügen funktioniert. Beim Zeichnen werden nur `path`, `circle`, `rect`,
  `line`, `polyline`, `polygon`, `ellipse` mit Geometrie-Attributen (`d`, `cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `x1`…`y2`,
  `width`, `height`, `points`) und `fill` = `currentColor`/`none` übernommen; alles andere fällt weg.

## Formen (`shape`, `ShapeKindMap`)

Neu: `roundrect`, `pentagon`, `hexagon`, `octagon`, `star`, `parallelogram`, `trapezoid`, `cylinder`, `cloud`, `callout`,
`arrowRight`, `arrowLeft`, `arrowDouble`, `chevron`, `cross`, `braceLeft`, `braceRight` (ohne Füllung), `terminator`,
`document`, `predefined`, `manualInput`, `delay`, `arrowUp`, `arrowDown`, `pentagonArrow`, `heart`, `manualOperation`,
`offPage`, `merge`, `card`, `sort`, `multiDocument`, `display`, `storedData`, `internalStorage`, `summing`, `or`.
Flussdiagramm nutzt außerdem `rect` (Prozess), `diamond` (Entscheidung), `parallelogram` (Daten), `cylinder` (Datenbank),
`ellipse` (Verbindungsstelle), `hexagon` (Vorbereitung), `triangle` (Auszug).
Alte Clients: unbekannte Form → Rechteck (Kern `shapePath`).

| Feld | Typ | Bedeutung | Alte Clients |
|---|---|---|---|
| `fillOpacity` | 0…1 | Deckkraft der Füllung (fehlt = 1, 0 = ohne Füllung) | volle Füllung |
| `dash` | `'dashed'` \| `'dotted'` | Randart (zusätzlich zum Kern: gepunktet) | `dotted` = durchgezogen |

Rand: `stroke`, `strokeWidth` (0, 1, 2, 4, 8) wie im Kern. Füllfarbe `color` beliebig (#rrggbb, eigene Farbe per Farbwähler).

## Verbinder (`connector`)

| Feld | Typ | Bedeutung | Alte Clients |
|---|---|---|---|
| `capStart`, `capEnd` | `'none'` \| `'arrow'` \| `'triangle'` \| `'triangleOpen'` \| `'circle'` \| `'circleOpen'` \| `'diamond'` \| `'diamondOpen'` \| `'bar'` | Spitze an Anfang/Ende | `arrowStart`/`arrowEnd` |
| `labelPos` | 0…1 | Lage der Beschriftung entlang der Linie (gerade/gewinkelt: Längenanteil, geschwungen: Kurvenparameter); fehlt = 0,5 | Mitte |

- **Fallback:** Fehlt `capStart`/`capEnd`, gilt `arrowStart: true` → `triangle` (sonst `none`) bzw. `arrowEnd !== false` →
  `triangle` (sonst `none`). Wer eine Spitze setzt, schreibt `arrowStart`/`arrowEnd` passend mit (`none` → aus, sonst an)
  und lässt `capX` bei `triangle` weg.
- Richtung umkehren tauscht `from/to`, die Spitzen und `labelPos` → `1 − labelPos`.
- Neue Verbinder (Werkzeug, Andockpunkt, Plus-Griff) übernehmen die Voreinstellung des Werkzeugs (Linienart, Endspitze).
  Ohne gewählte Linienart (Standard, „automatisch“) wird ein Verbinder, dessen **beide Enden an Objekten hängen**,
  **geschwungen** (`lineStyle: 'curved'`), freie Linien bleiben gerade (Feld fehlt). Hängt man am freien Ende über
  „Form anhängen“ ein Objekt an, wird der Verbinder ebenfalls geschwungen. Eine im Werkzeug ausdrücklich gewählte
  Linienart gilt immer (nochmal klicken = wieder automatisch). Bestehende Verbinder ändern sich nicht
  (`newLineStyle` in `editor/core/tools.tsx`).
- Ende eines ausgewählten Verbinders ziehen: Andockpunkte in der Nähe erscheinen und rasten ein (`side` wird gesetzt),
  sonst heftet das Ende ans Objekt darunter (ohne `side`) bzw. bleibt frei; Esc bricht ab (ein Undo-Schritt).

## Haftnotiz-Farben

12 Farben (`STICKY_COLORS` in `shared/protocol.ts`, eine Quelle für Web, Server, MCP und App – die App liest sie aus
`docs/native_fixtures/web/constants.json` `colors.sticky`): Gelb, Grün, Rosa, Hellblau, Orange, Lila, Weiß (die alten sieben,
unverändert an ihrer Stelle), dazu Koralle `#ff9e8a`, Mint `#b9ecd8`, Türkis `#7fd6e0`, Mittelblau `#7fb2f0`, Steingrau
`#d4d4cc` – alle hell genug für schwarze Schrift. Notiz-Werkzeug und Kontextleiste zeigen sie in zwei Reihen zu sechs.

## Haftnotiz-Formen (`stickyShape.tsx`, `stickyGeom.ts`)

**Quadrat** und **Rechteck** (gleiche Höhe, Breite × 1,75; 199 bzw. 350 dp). Kein eigenes Feld: die Form
ergibt sich aus `w/h` (≈ 1 → Quadrat, ≈ 1,75 → Rechteck, sonst „frei“), alte Boards bleiben gültig und quadratisch.

- Kontextleiste „Form der Notiz“ (auch Mehrfachauswahl): setzt `w` neu, Höhe und Mitte bleiben (ein Undo-Schritt).
- Notiz-Werkzeug: Form unter den Farben; die zuletzt gewählte Form (Werkzeug oder Kontextleiste) gilt für neue Notizen,
  auch für „Form anhängen → Haftnotiz“. Tab, Plus-Griff, Strg D und Kopieren übernehmen `w/h` und damit die Form.
- Griffe: alle acht; Seitengriffe ändern Breite bzw. Höhe frei, Eckgriffe skalieren proportional (Umschalt erzwingt es).
- Autofit: Innenabstand und größte Schrift richten sich nach der kürzeren Seite (`stickyPadding(w, h)`,
  `stickyMaxFont` in `editor/textMeasure.ts`); quadratische Notizen rechnen wie bisher.

## Notiz-Stapel (`stack/`, Quick Win Q2)

Haftnotiz(en) so auf eine andere ziehen, dass die Mitte der gegriffenen in der inneren Hälfte der anderen liegt → sie
kommen auf deren Stapel (oberste andere sichtbare, ungesperrte Haftnotiz; nur wenn alles Bewegte Haftnotizen sind, höchstens
200). Ein Stapel ist eine **Gruppe** (`groupId`) aus Haftnotizen mit dem Feld **`stacked: true`** an derselben Stelle:
Klick wählt alle, Ziehen nimmt alle mit, Doppelklick wählt die oberste. Die abgelegten Notizen übernehmen Lage, Größe und
Drehung des Ziels und liegen oben (`bringToFront`); oben liegt die mit dem höchsten `z`. Ohne Gruppe ist `stacked`
bedeutungslos (eine allein übrig gebliebene Notiz verliert die Gruppe über `dissolveLoneGroups`). Rein additiv, alte
Clients sehen eine Gruppe übereinanderliegender Notizen.

- Darstellung: zwei Papierkanten (5 und 10 px versetzt, dieselbe Farbe etwas dunkler) unter jeder Stapel-Notiz
  (`StackedStickyView`), oben rechts in der obersten die Anzahl (Overlay-Slot `shapes.stacks`, ab 40 px Notizbreite).
- Blättern: Klick auf die Zahl bzw. Mausrad darüber = nächste Notiz; ganzer Stapel gewählt: „‹ n ›“ an der Zahl und in
  der Kontextleiste (`shapes.stack`, Ordnung 22) Vorige/Nächste Notiz, **Auffächern** (Raster ab der Stapel-Ecke, oberste
  zuerst, Abstand 24, Stapel aufgelöst) und **Oberste abnehmen** (rechts daneben). Eine einzelne Stapel-Notiz gewählt:
  „Vom Stapel nehmen“. Blättern tauscht nur die z-Werte der Mitglieder (der Stapel bleibt in der Ebenen-Reihenfolge).
- Eine Notiz aus dem Stapel herausziehen (vorher per Doppelklick einzeln gewählt) nimmt sie vom Stapel.
- Jede Aktion ist ein Rückgängig-Schritt; das Ablegen gehört zum Schritt der Bewegung.
- App: Papierkanten im Notiz-Renderer, Zahl mit ‹ › und Wischen (`features/stack/`), dieselbe Kontextleiste; nach dem
  Ziehen fragt die App `shapes.stackDrop` nur, wenn sich ein Stapel ändern kann (Dart-Port von `stackTarget`).

### Native-Aktionen (`stack/native.ts`, Test `server/test/native-act-stack.test.ts`)

| Aktion | Argumente | Rückgängig | Ergebnis |
| --- | --- | --- | --- |
| `shapes.stackDrop` | `{ids, grabbed?}` (nach dem Verschieben) | `undo` | `select` = neuer Stapel bzw. die herausgezogenen; `skipped` = nichts |
| `shapes.stackCycle` | `{id, dir: 1\|-1}` | `undo` | `data.top` = neue oberste |
| `shapes.stackSpread` | `{id}` | `undo` | `select` = alle (oberste zuerst) |
| `shapes.stackTake` | `{id, which?}` (Standard: oberste) | `undo` | `select` = die abgenommene |

## Y-Strukturen und Awareness

Keine. Werkzeug-Einstellungen (gewählte Form, Stempel/Emoji, Linienart neuer Verbinder, Notizform) sind lokal; „Zuletzt verwendete
Emojis“ liegen nur im Browser (`localStorage`, `stachel.shapes.recentEmoji`).

## Kern-Eingriff

`editor/core/tools.tsx`: `connectorDrag.gesture` (additiv). Darüber ersetzt das Modul das Ziehen von Verbindern aus
Andockpunkten und Plus-Griffen (Andockpunkte in der Nähe sichtbar und einrastend, Plus ins Leere → gleiche Form).
Das Umhängen von Verbinder-Enden übernimmt das Modul ohne Kern-Eingriff (Overlay-Slot `shapes.endDrag`, fängt
`pointerdown` auf den Griffen `from`/`to` in der Capture-Phase ab).
Notiz-Stapel: `ObjectTypeDef.afterMove` (additiv, `editor/ext/types.ts`; `Editor.tsx` ruft es nach dem Ziehen je Typ der
bewegten Objekte im Rückgängig-Schritt der Bewegung auf), App: `BoardRegistry.afterMoves` (`BoardEditor.dragEnd`).
