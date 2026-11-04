# Vertrag: Feature-Modul „richtext“

Gehört dem Modul `web/src/features/richtext/`. Setzt den Abschnitt „Rich-Text“ aus `docs/contract.md` §4 um
(Feld `content`, Klartext-Spiegel `text`, Migration, Undo). Hier steht nur, was das Modul zusätzlich festlegt.

## Objektfelder (Module-Augmentation in `model.ts`)

| Feld | Typen | Bedeutung |
|---|---|---|
| `fontFamily` | sticky, text, shape, connector | `'condensed'` (Barlow Condensed), `'serif'` (Source Serif 4), `'mono'` (JetBrains Mono); fehlt = Barlow. Unbekannte Werte = Barlow. Alle Schriften self-hosted (`@fontsource`). |

Weiter genutzt (Kern-Felder): `fontSize` (bei Haftnotizen fehlt = automatisch), `align`, `valign`, `bold`, `italic`,
`strike` (Grundformat fürs ganze Objekt), `color` (bei `text` die Textfarbe).

## Inhalt `content` (Y.XmlFragment, y-prosemirror)

Knoten und Marks wie im Tiptap-StarterKit (`RICH_TEXT_NODES`/`RICH_TEXT_MARKS`), zusätzlich `horizontalRule`.
Attribute, die das Modul schreibt bzw. liest:

| Mark | Attribute |
|---|---|
| `textStyle` | `color` (CSS-Farbe `#rgb[a]`/`rgb()`), `fontSize` als **`<zahl>em`** relativ zur Objekt-Schriftgröße (nur Text und Form, für einen Textteil; skaliert beim Größerziehen mit). Andere Einheiten (`px`, `pt`, `rem`, `%` aus älteren Einfügungen) werden in Ansicht und Editor gleich angezeigt, aber nicht geschrieben. |
| `highlight` | `color`; fehlt = Gelb `#fff27a` |
| `link` | `href`, nur `http:`, `https:`, `mailto:`, `tel:` (Eingabe ohne Schema → `https://`). Unsichere Ziele werden weder gespeichert noch angezeigt. |
| `bold`, `italic`, `underline`, `strike`, `code` | – |

Knoten: `heading` (`level` 1–3), `orderedList` (`start`), `taskItem` (`checked`). Unbekannte Knoten/Marks zeigt das
Modul als Text an; beim Bearbeiten werden sie zu Absätzen bzw. fallen weg (der Text bleibt).

Das Format fürs ganze Objekt aus der Kontextleiste (ohne Bearbeitung) wirkt auf `content`: Unterstrichen, Markierung,
Liste schreiben Marks/Knoten über den ganzen Text; Textfarbe setzt bei `text` das Objektfeld `color` (Marks ohne Farbe),
sonst `textStyle.color` über den ganzen Text (andere `textStyle`-Attribute bleiben). Fett/Kursiv/Durchgestrichen
bleiben Objektfelder (wie Kern).

## Einfügen (Strg V beim Schreiben)

`paste.ts` bereinigt eingefügtes HTML in einem inerten Dokument (`DOMParser`), bevor ProseMirror es liest:
- Es bleiben nur Elemente, die der Editor kennt (Absätze, Überschriften, Listen, Zitat, Code, Links, Fett/Kursiv/…,
  Markierung). `script`, `style`, `iframe`, `object`, `img`, Formulare u. Ä. fallen samt Inhalt weg, alle anderen
  Elemente werden durch ihren Inhalt ersetzt. Attribute nur `href` (sicher, siehe oben), `start`, `data-type`,
  `data-checked`, `data-color`, `data-pm-slice` und ein auf Farbe/Größe/Fett/Kursiv/Durchgestrichen gekürztes `style`.
  Keine `on*`-Attribute, keine `javascript:`-Links.
- Word: `mso-list`-Absätze werden zu `bulletList`/`orderedList` (Ebenen verschachtelt, Aufzählungszeichen wie „·“
  bzw. „1.“ entfallen), `mso-highlight` und Hintergrundfarben von Textteilen zur Markierung (nächste der 6 Farben).
- Schriftgrößen (`pt`, `px`, `em`, `rem`, `%`) werden relativ zur Grundgröße der Quelle (Word `p.MsoNormal`, sonst
  11 pt bei Word, 16 px aus dem Browser) in `em` umgerechnet (0,25–6 em; ≈ 1 em entfällt). In Haftnotiz und
  Beschriftung entfallen sie (dort gibt es keine Teil-Größen). `h4`–`h6` werden zu `h3`.
- Klartext: Zeilenenden `\r\n` werden zu `\n`. Tabs bleiben; sie sind höchstens eine Leerzeichenbreite breit
  (`tab-size: 1`, wie die Canvas-Messung der automatischen Schriftgröße).

## Schnappschuss und Kopieren

Feld-Codec `registerYField('content', contentCodec)`: Lesekopie = ProseMirror-JSON `{ type: 'doc', content }`;
Einfügen/Duplizieren baut daraus ein neues Fragment. `store.create({ …, content: <JSON> })` geht ebenso.

## Origins (Undo)

- `ySyncPluginKey` (y-prosemirror): eigene Eingaben im Editor, per `store.trackOrigin` im Board-Undo. Der
  Klartext-Spiegel `text` wird im selben Transact geschrieben.
- `'richtext:migrate'`: `content` aus `text` aufbauen bzw. reparieren, wenn nur eine Bearbeitung beginnt (nicht im
  Undo, der Text sieht vorher und nachher gleich aus). Bei einer Format-Änderung läuft die Migration im selben
  Undo-Schritt (`LOCAL_ORIGIN`).
- `'richtext:mirror'`: `text` nach fremden Änderungen nachziehen (nicht im eigenen Undo).

## Awareness

| Feld | Inhalt |
|---|---|
| `richtext.caret` | `{ id, anchor, head }` – Objekt, in dem die Person schreibt, Schreibmarke als Yjs-RelativePosition (JSON) im Fragment `content`; `null`, sobald sie nicht mehr schreibt. Andere zeigen Schreibmarke + Namen in ihrer Farbe. Die Apps setzen `anchor`/`head` = `null` (keine Schreibmarke). Auf dem Board steht über dem Objekt „Mara schreibt hier gerade …“ (Slot `richtext.writing`, `Writing.tsx`) für alle anderen, die es nicht selbst bearbeiten. |

## Y-Strukturen

Keine eigenen (alles liegt im Objekt).

## Bedienung

- Nur das bearbeitete Objekt hat einen Editor (Tiptap, lazy geladen); sonst statische Darstellung aus `content`.
- Schwebende Format-Leiste beim Schreiben (am Handy unten angedockt, über der Bildschirmtastatur): Schriftart,
  Absatz (Normaler Text, Überschrift 1–3, Zitat, Code-Block; nochmal derselbe Stil schaltet zurück), Größe (Haftnotiz: „Auto“ + feste Größen; Text/Form: mit Textauswahl nur für den Teil), Fett, Kursiv, Unterstrichen,
  Durchgestrichen, Textfarbe, Markierung, Link, Aufzählung, Nummerierung, Checkliste, Ausrichtung. Ohne Textauswahl
  gilt ein Format für den ganzen Text.
- Am Handy (< 700 px) passt die Leiste ohne Wischen: direkt Größe, Fett, Kursiv, Unterstrichen, Textfarbe, Markierung,
  Link und „Mehr“ (Absatz-Stil, Durchgestrichen, Listen, Ausrichtung, Schriftart). Sie sitzt über der Bildschirmtastatur
  (`visualViewport`: Höhe und `offsetTop`, auch bei Tastaturen, die nur den sichtbaren Ausschnitt verkleinern), Popover
  bleiben im sichtbaren Bereich (scrollen selbst), und das Board fährt mit, damit die Schreibmarke über Leiste und
  Tastatur sichtbar bleibt.
- Markierung (Textmarker) in 6 Farben, Textfarbe in 8 Farben je Textteil, live für alle.
- Kürzel beim Schreiben: Strg B/I/U, Strg Umschalt S, Strg K (Link), `- `/`1. `/`[ ] ` + Leertaste (Listen), `# `/`> `/` ``` ` (Überschrift, Zitat, Code),
  Tab/Umschalt Tab rückt Listen ein, Strg Z/Y nur für diese Bearbeitung, Esc bzw. Strg Enter beendet
  (Beschriftung: auch Enter). Ist ein Menü der Leiste offen (Farbe, Markierung, Größe …), schließt Esc zuerst nur das
  Menü. Auf dem Board: Strg B/I/U/Umschalt S fürs ganze Objekt, Strg K öffnet die
  Bearbeitung mit allem markiert und dem Link-Feld (Link für den ganzen Text).
- Links sind auf dem Board klickbar; ein Klick fragt „Link öffnen?“ (Doppelklick bearbeitet).
- Kästchen einer Checkliste: Ein Klick auf dem Board hakt ab bzw. zurück, ohne Auswahl und ohne Bearbeitung (setzt
  `checked` am `taskItem` im Fragment, ein Undo-Schritt; Klartext bleibt gleich). Gesperrte Objekte nicht.
- Haftnotiz, deren Text selbst in der kleinsten Schrift nicht passt: In der Ansicht wird unten abgeschnitten und
  ausgeblendet (Klasse `rt-clip`), beim Bearbeiten scrollt der Text in der Notiz und die Schreibmarke bleibt sichtbar.
- Text mit `autoWidth`: Misst der Rich-Text anders als die Canvas-Messung des Kerns (Listen, Kästchen, Marks,
  Schriftart), zieht das Modul die Breite nach jeder eigenen Änderung aus dem DOM nach (`fit.ts`, `watchTextWidths`).

## Native-Aktionen (App, docs/contract.md §8.12)

`web/src/features/richtext/native.ts` (Paket P8), Test `server/test/native-act-richtext.test.ts`. Rechnen mit
`whole.ts` (`markAllIn`, `setTextColorIn`, `listAllIn`, `toggleTaskIn` – die Store-Varianten der Kontextleiste aus `ops.ts`,
ohne Editor-Register und React, damit der Server sie mitbauen kann);
Ziele wie `textTargets` (nicht gesperrt, Typ mit Text; ohne Editor-Register über `CORE_STYLE_TRAITS`).

| Aktion | `args` | Undo | Ergebnis |
|---|---|---|---|
| `richtext.whole` | `{ids, op: 'underline', value: bool}` · `{ids, op: 'color' \| 'highlight', value: '#rrggbb' \| null}` · `{ids, op: 'list', value: 'bulletList' \| 'orderedList' \| 'taskList', on?}` · `{ids, op: 'link', value: Eingabe \| null}` | `undo` (ein Schritt) | `list`: `data.changed` = geänderte IDs (die App misst Text-Objekte nach, das Web misst im DOM); `link`: `data.href` (wie `normalizeHref`), ungültig → `skipped` + Hinweis „Das ist kein gültiger Link.“; nichts mit Text → `skipped` |
| `richtext.toggleTask` | `{id, index}` – Kästchen Nummer `index` in Dokument-Reihenfolge | `undo` | `data.checked` = neuer Stand; gesperrt/kein Kästchen → `skipped` |

`color` wie die Leiste: Text-Objekte ändern ihre Objektfarbe (`null` = `#0a0a0a`) und verlieren Farben im Text, alle
anderen bekommen `textStyle.color` über den ganzen Text (Teil-Größen bleiben). `list` ohne `on` schaltet wie die
Leiste (alle schon diese Liste → zurück zu Absätzen). `link` schreibt das Mark mit den Attributen der Tiptap-Erweiterung
(`target`, `rel`, `class`, `title`) – wie Strg K auf dem Objekt.
