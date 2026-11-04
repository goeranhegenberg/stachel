# Beispiel-Daten der Native-API (Apps)

Erzeugt vom **echten Server-Code** (`tools/native-fixtures.mts` startet `server/dist` im Modus org mit
Fake-Identitätsdienst, legt das Board wie ein Browser über `/sync` an und liest über `/native/v1`). Format:
`docs/contract.md` §8. Für Unit-/Golden-Tests in `flutter/packages/stachel_board` ohne Server.

| Datei | Inhalt |
|---|---|
| `all_types.welcome.json` | `welcome` des Boards „Alle Typen“: jeder Objekttyp des Web (alle 41 Formen, Verbinder gerade/gewinkelt/geschwungen/frei mit Spitzen und Beschriftung, Rich-Text mit allen Knoten und Marks, Haftnotiz quadratisch/rechteckig/nur Klartext, Text, Stift + Textmarker, Bild, Rahmen mit Raster, Sticker Emoji/Stempel, Icon, Karte, Tabelle, Mindmap, Zeitleiste, PDF-Dokument, Gruppe, gesperrt, ausgeblendet, Link, unbekannter Typ `future.widget`) samt `ext` (`collab.comments`, `collab.reactions`) |
| `all_types.patches.json` | 8 Patches typischer Web-Änderungen (Feld `step` = was passiert ist; nur hier zur Erklärung, nicht Teil des Protokolls) |
| `all_types.after_patches.objects.json` | Objekte nach Anwenden der Patches = frischer Schnappschuss (Zeichenreihenfolge) – Prüfstein für die Patch-Logik der App |

Feste Platzhalter statt wechselnder Werte: Board `board_all_types`, Bilder `img_photo`, `img_page0`, `img_page1`,
PDF `pdf_file`, Epoche `epoch_fixture`, `clientId` 1. Die Person ist `a:mara` (Mara, Orga).

## Neu erzeugen

```sh
npm --prefix server run build
server/node_modules/.bin/tsx tools/native-fixtures.mts            # schreibt hierher
server/node_modules/.bin/tsx tools/native-fixtures.mts --big 2000 --big 5000   # + big_2000/big_5000.welcome.json (nicht eingecheckt)
```

Große Boards sind deterministisch (`seedBig` in `server/test/native-seed.ts`: Raster, ≈ 50 % Haftnotizen, 20 % Formen,
10 % Text, 10 % Verbinder, 5 % Stift, 5 % Karten, ein Rahmen je 400 Objekte) und entstehen bei jedem Lauf gleich.

## Referenzwerte aus dem Web-Code (`web/`)

`tools/native-web-fixtures.mts` führt die **echten Web-Funktionen** aus (ohne Server und Browser) und schreibt nach
`web/`; die App prüft ihre Portierungen damit (`packages/stachel_board/test/web_reference_test.dart`, Konzept §6.2):

| Datei | Inhalt |
|---|---|
| `web/shapes.json` | alle registrierten Formen (`shapeKinds`): SVG-Pfad je 5 Größen × 3 Insets (Text gleich, auch Zahlenformat) und Textfläche (`shapeInsets`); eine Web-Form, die die App nicht kennt, lässt den Dart-Test scheitern |
| `web/connectors.json` | `connectorGeometry` für gerade/gewinkelte/geschwungene Verbinder: Seiten, automatische Seite, gedrehte Objekte, Umrisse (Ellipse, Raute, Sechseck), freie Enden, fehlendes Objekt |
| `web/order.json` | Zeichenreihenfolge (Rahmen zuerst, `z` byteweise, dann `id`) mit leeren/gleichen Schlüsseln |
| `web/mindmap.json` | Mindmap-Ops (Vertrag §8.6 `mind`): je Fall Ausgangsstand, Ops der App, Ergebnis des echten Web-Codes (`mindmap/ops.ts` samt Layout) mit den Schriftmaßen des Servers; dazu Knotengrößen und Textbreiten – erzeugt von `tools/native-mind-fixtures.mts` (`--tsconfig web/tsconfig.json`), geprüft von `mind_web_reference_test.dart` |

| `web/view.json` | Ansicht der App (Paket P4): Such-Faltung je Zeichen (`fold`, ohne Hangul – rechnet die App nach Formel), `findMatch`-Fälle, Suchtext je Objekttyp und Treffer in Lesereihenfolge (`searchText`, `findHits`), `readingOrder`, Rahmen-Liste (`framesInOrder` mit `slide`) und Formate beim Aufziehen (`presetRect`), Zoom-Stufen (`nextZoomStep`) und `fitRect`, Board-Hintergrund (Farben, Namen, Muster, `isDark`) – erzeugt von `tools/native-view-fixtures.mts` (`--tsconfig web/tsconfig.json`), geprüft von `test/features/view/view_web_reference_test.dart` (Faltungstabelle: `dart run tool/gen_view_fixtures.dart`) |
| `web/constants.json` | Konstanten der Web-App (Vertrag §8.13): `colors` (brand, sticky, user, presence, shape mit Namen, mind, timeline), `fonts`, `fontSizes` (text, richText), `eraserSizes`, `shapes` (sections, entries mit Start-Größe/Stichwörtern, capStyles), `stickers` (sizes, stamps als SVG-Knoten `[tag, attrs, kinder]` mit viewBox 64, emojiGroups, iconGroups, icons mit `node`), `templates` (categories, list mit `contains` je Typ), `card.statuses`, `timeline` (units, dayPx, newLen, Monate/Wochentage, layout, limits), `mind` (styles, colors, placeholder), `reactions`, `timer` (presetsMin, maxMs), `frames` (presets, gridSizes) – erzeugt von `tools/native-web-constants.mts`, geprüft von `server/test/native-constants.test.ts` |

Nicht dabei: Auto-Schriftgrößen (`stickyFontSize`/`shapeFontSize` brauchen die Canvas-Textmessung des Browsers; die
Schriftmaße `server/src/native/text-metrics.json` decken seit F1 alle Schnitte ab, Vertrag §8.13).

```sh
server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-web-fixtures.mts
server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-web-constants.mts
server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-view-fixtures.mts
# Schriftmaße (Web-App unter einer URL, z. B. Sandbox oder `python -m http.server 8655` in web/dist):
server/node_modules/.bin/tsx tools/text-metrics.mts http://127.0.0.1:8655
# dann docs/native_fixtures/web/*.json nach flutter/packages/stachel_board/test/fixtures/web/ kopieren
```

## Web-Gegenseite für Cross-Client-Tests (`tools/web-peer.mts`)

Ein Hocuspocus-Client wie der Browser (Passwort-Login, Standard `jonas`), der JSON-Befehle zeilenweise von stdin liest
(`open`, `set`, `create`, `delete`, `awareness`, `peers`, `get`, `close`) und je Befehl eine JSON-Zeile antwortet. Die
App startet ihn im Live-Test `packages/stachel_board/test/native_cross_client_live_test.dart` (Web ändert → App in
≤ 1 s, Anwesenheit beide Richtungen, Funkloch → `resumed`, 4401, Umbenennen). Wichtig: die Awareness `user` muss genau
der Sitzung entsprechen (`/api/auth/me`), sonst trennt der Server (`awareness_user_mismatch`).

## Gegen den echten Server (Sandbox)

```sh
npm --prefix server run build        # für die Web-Oberfläche zusätzlich: cd e2e && npm run build
server/node_modules/.bin/tsx tools/sandbox.mts 8600 --seed [--host 0.0.0.0]
```

- Stachel `http://127.0.0.1:8600`, Native-API `ws://127.0.0.1:8600/native/v1`, Fake-Identitätsdienst
  `http://127.0.0.1:8601` (`GET /me`, `POST /login`, Vertrag §1; in `sandbox.json` als `orgBase`).
- Org-Tokens für `POST /api/auth/app-session`: `sandbox-mara`, `sandbox-jonas`, `sandbox-lena` (gleiche Person wie der
  Passwort-Login `mara`/`kaktus-123` im Web, `a:<name>`) bzw. `sandbox-member-<name>` (Team-Mitglied `m:101`…`m:103`).
  Die App kann sich auch selbst am Fake anmelden: `POST <orgBase>/login {username, password}` → `token`.
- `--seed` legt „Alle Typen“ (mit echten Bildern und PDF), „Groß 2000“ und „Groß 5000“ an; IDs und alle Daten stehen in
  `<Daten>/sandbox.json` (Pfad wird ausgegeben, mit `--info <datei>` an fester Stelle).
- `--host 0.0.0.0`: Handy im WLAN erreicht die Sandbox unter `http://<PC-IP>:8600`.
