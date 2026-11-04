# Stachel nativ in der Org-App – Konzept

Stand 2026-11-01 · Entscheidung Göran: Stachel kommt **nativ in Flutter** in die Org-App
(eigenes App-Repo der Organisation), **ohne WebView**, getestet, in Etappen an die internen Tester.
Dieses Dokument ist das Konzept, noch kein Code. Verbindlich bleibt `docs/contract.md`; die hier beschriebene
Native-API kommt dort als neuer §8 hinein, bevor sie gebaut wird.

**Umsetzungsstand (2026-11-01):** Server-Seite von E0 + E1 + E2 gebaut und live (`server/src/native/`, Vertrag §8):
App-Sitzung, `/api/native/info`, Gateway mit Schnappschuss/Patches/Resume/Anwesenheit, Ops (create/update/remove/order,
Rückgängig je Sitzung) und seit E2 die `text`-Op mit Rebase (`richmerge.ts`); seit E3 Kommentar-/Reaktions-Ops,
`presence.uploads` und der Posteingang `GET /api/native/v1/inbox` (Ergebnisse unter E3). Abweichungen vom Entwurf §4.3: `want` kennt `"ext"` statt `"comments"`,
`patch.ext` trägt geänderte Strukturen ganz, `base` der `text`-Op ist die Zahl `rev`; dazu (E2) `epoch` und `baseDoc`
an der `text`-Op und `ack.conflict`. App-Seite E2: Branch `feat/stachel-e2` im App-Repo der Organisation (Ergebnisse unter E2).

---

## 1. Ziel & Vision

**Das Team der Organisation hat Stachel in der Hosentasche.** Wer das Handy in der Hand hat (das ist die Mehrheit), soll
Boards ohne Login, ohne Browser und ohne Ruckeln ansehen, kurz etwas festhalten und mitarbeiten können – mit der
Bedienung, die man von Whiteboard-Apps am Handy kennt, und im Stachel-Look.

Was nativ mehr bringt als das Web am Handy (und warum sich der Aufwand lohnen muss):

| Gewinn | konkret |
|---|---|
| **Flüssig** | Pan/Zoom mit 60 fps auch bei 2 000+ Objekten (Impeller, eigener Szenen-Renderer statt DOM mit tausenden Knoten). Öffnen aus dem Cache sofort, live erst danach. |
| **Gesten** | Systemgesten ohne Browser-Konflikte (kein versehentliches Zurück-Wischen, kein Seiten-Zoom, keine Tastatur, die das Board verschiebt), Haptik beim Greifen/Einrasten. |
| **Angemeldet** | Ein Token für alles: das Team-Token der App wird still zur Stachel-Sitzung. Kein Cookie, kein Einmal-Link, kein „Link abgelaufen“. |
| **Offline lesen** | Zuletzt geöffnete Boards (und Favoriten mit Bildern) gehen auch ohne Netz – wichtig auf dem Festivalgelände in Tautenhain (Lageplan, Ablaufplan). |
| **Kamera & Teilen** | Foto direkt aufs Board (Whiteboard beim Treffen, Gelände, Material), später auch aus anderen Apps per „Teilen“. |
| **Mit der Org-App verzahnt** | Karte auf dem Board → **Aufgabe in der Org-App** (mit Rücklink aufs Objekt); Aufgabe/Termin/Hinweis öffnet das Board an der richtigen Stelle; **@Erwähnungen** als Handy-Benachrichtigung über den vorhandenen Hintergrund-Check; Board-Links (`/b/<id>`) aus Chat, Bot und Protokollen öffnen nativ. |

Bewusst **nicht** das Ziel: ein zweiter Desktop-Editor. Am Rechner bleibt die Web-App das Werkzeug; nativ heißt
„Handy zuerst“ (Tablets bekommen dieselbe Oberfläche, breiter).

---

## 2. Die Kernfrage: Sync/Transport

Stachel synchronisiert ein **Yjs-Dokument** je Board über **Hocuspocus** (`/sync`). Objekte liegen in
`doc.getMap('objects')` als `Y.Map` je Objekt; einige Felder sind selbst Y-Typen: `content` (Rich-Text,
`Y.XmlFragment` im y-prosemirror-Format), `table` (Y.Map mit Y.Arrays), `timeline` (Y.Map), `docPages` (Y.Map).
Feature-Module haben eigene Strukturen (`collab.comments`, `collab.votes`, `collab.timer`, …). Reihenfolge über
Fractional-Index `z`, Undo pro Person über `Y.UndoManager` mit eigenem Origin.

### 2.1 Option (a): Yjs/Hocuspocus nativ in Dart

Stand pub.dev (geprüft 2026-11-01):

| Paket | Stand | Bewertung |
|---|---|---|
| `yjs_dart` 1.1.15 | Reine Dart-Übersetzung von **yjs v14.0.0-22** (Vorabversion!) + y-protocols; 12 Versionen, alle zwischen 19. und 22.02.2026, seitdem keine Commits; 2 Sterne, 1 Autor; „Deltas in progress“ | vielversprechend, aber unreif; unser Server/Web nutzen **yjs 13.6.33** – Binärkompatibilität v14↔v13 im Detail ungeprüft |
| `hocuspocus_dart` 1.0.6 | Port des Hocuspocus-Providers, gleicher Autor, gleiche Woche; 20 Downloads/Monat | dito |
| `y_crdt` 0.2.0 | „Dart-Port“ über `wasm_run` (yrs als WASM in einer WASM-Laufzeit) | schwere Laufzeit auf dem Handy, 2 Versionen in 2 Jahren |
| `ydart` 0.0.1 | yrs-Bindung, eine Version 2023 | tot |
| eigene **yrs**-Bindung (Rust, `flutter_rust_bridge` 2.13) | yrs ist reif und aktiv (2,2 k Sterne, Push 09/2026), offizielles Yjs-Gegenstück | machbar, aber: Rust-Toolchain für 4 Android-ABIs + iOS im Codemagic-Build (Codemagic baut auf Macs, also möglich; +5–10 min Build, neue Fehlerklasse), eigene Bindung pflegen, Hocuspocus-Protokoll trotzdem selbst in Dart |

Das eigentliche Problem ist nicht das CRDT, sondern **alles darüber**: Der Rich-Text ist ein ProseMirror-Baum im
`Y.XmlFragment`. In Flutter gibt es **kein y-prosemirror** und keinen ProseMirror-Editor – wir müssten die
Bearbeitung (Quill-Delta ↔ XmlFragment, Marks, Listen, Aufgaben) selbst in Dart gegen das CRDT schreiben. Dazu
kämen Fractional-Index, Gruppen-Auflösung, Verbinder-Kaskaden beim Löschen, Tabellen-/Zeitleisten-Y-Strukturen,
Kommentar-Rechte – also eine zweite Implementierung der Schreibregeln, die das Web in `web/src/board` und den
Feature-Modulen hat. Und: **ein fehlerhafter CRDT-Client vergiftet das Dokument für alle** (ein falsch kodiertes
Update lässt sich nicht „zurückrollen“, alle Browser übernehmen es). Für einen Solo-Betrieb ist das das größte
denkbare Risiko.

### 2.2 Option (b): Native-API im Stachel-Server (Objekt-Ebene über WebSocket)

Der Server bleibt **der einzige, der Yjs schreibt**, mit genau dem Code, den Web und MCP schon nutzen. Die App spricht
JSON auf Objekt-Ebene:

- **Lesen:** beim Verbinden ein JSON-Schnappschuss des Boards (Y-Felder schon umgewandelt: `content` als
  ProseMirror-JSON, `table` als `TableData` …), danach **Objekt-Patches** (Feld setzen/entfernen, Objekt neu/weg).
- **Schreiben:** Operationen wie die API des Web-Stores (`createMany`, `updateMany`, `remove`, `bringToFront`,
  `sendToBack`, Rich-Text setzen, Undo/Redo). Der Server führt sie in einer Yjs-Transaktion mit einem **eigenen Origin je
  App-Sitzung** aus → alle Browser sehen die Änderung sofort, Undo nimmt nur die eigenen Schritte zurück, der
  Versionsverlauf nennt die Person.
- **Vorbild existiert:** Der MCP-Server (`mcp/`) macht genau das (Objekte lesen/anlegen/ändern über `BoardModel`, eigener
  Origin `AI_ORIGIN`, eigener UndoManager, Anwesenheit). `server/src/versions.ts` öffnet Dokumente schon heute per
  `hocuspocus.openDirectConnection` und ändert sie live. Der Native-Gateway ist die dritte Anwendung desselben Musters.

Konfliktsemantik: **last-writer-wins je Feld** in Server-Reihenfolge (das ist exakt die Yjs-Semantik für
`Y.Map`-Felder, die das Web heute schon hat). Rich-Text: der Server überträgt die Änderung **als minimalen Diff**
(`updateYFragment` aus y-prosemirror, gleicher Weg wie der Tiptap-Editor) ins Fragment, nicht als Ersetzen – Marks und
gleichzeitige Änderungen an anderen Absätzen bleiben erhalten (Details §4.6).

### 2.3 Option (c): Was es sonst noch gäbe

- **JS-Engine in der App** (`flutter_js`: QuickJS auf Android, JavaScriptCore ohne JIT auf iOS) mit dem echten
  `web/src/board`-Code + yjs + Hocuspocus-Provider, Rendering in Flutter. Volle CRDT-Treue und Offline, Code-Gleichheit
  der Datenschicht. Aber: zwei Laufzeiten in einer App, jede Änderung über eine Brücke serialisiert, Debugging über
  Sprachgrenzen, Interpreter-Tempo beim Laden großer Boards, `flutter_js` nur mäßig gepflegt. Spannend, für ein Solo-
  Projekt zu viel Mechanik.
- **Hybrid (b) jetzt, (a) später:** Die App kapselt den Transport hinter einer Schnittstelle `BoardSource`
  (Schnappschuss + Patches rein, Operationen raus). Sollte echtes Offline-Bearbeiten später Pflicht werden und
  `yjs_dart` gereift sein, lässt sich eine CRDT-Quelle dahinter einsetzen, ohne Renderer und Editor anzufassen.

### 2.4 Empfehlung: **(b) Native-API**, Transport hinter `BoardSource` gekapselt

Gründe:
1. **Sicherheit des gemeinsamen Dokuments:** nur der erprobte JS-Code schreibt Yjs; die App kann das Board nicht
   kaputt kodieren. Der Server validiert jedes Feld (Typ, Länge, endliche Zahlen) vor dem Schreiben.
2. **Rich-Text wird lösbar:** y-prosemirror läuft auf dem Server, die App arbeitet mit ProseMirror-JSON und dem schon
   vorhandenen `flutter_quill` (Delta ↔ PM-JSON ist eine überschaubare, gut testbare Abbildung).
3. **Ein Regelwerk:** Gruppen, Verbinder-Kaskade, Ebenen-Schlüssel, Kommentar-Rechte, Board-Rollen bleiben an einer
   Stelle. Neue Web-Funktionen brauchen in der App nur Darstellung und Bedienung, keine neue Datenlogik.
4. **Einfacher Client, schnellere Etappen:** E1 (nur lesen) ist fast reiner Renderer.
5. **Gleiches Muster wie MCP** – erprobt, mit Tests als Vorlage.

Risiken und Gegenmittel:

| Risiko | Gegenmittel |
|---|---|
| Kein echtes Offline-Bearbeiten | Offline **lesen** aus Cache (E1); kurze Aussetzer (Funkloch, Tunnel) per Warteschlange mit Op-IDs (E2); längeres Offline bewusst nur lesend, Banner „Offline – Stand von 14:32“ |
| Server-Last (Dokumente bleiben geladen, solange Apps verbunden sind) | wie Browser heute; ein gemeinsamer Spiegel je Board, nicht je Verbindung; Team ist klein |
| Gleichzeitiges Tippen in derselben Notiz (Web + App) | „Mara schreibt hier gerade“ (Awareness), Basis-Revision je Text-Op, Rebase auf dem Server (§4.6) |
| Latenz beim Bearbeiten | Optimistisch: die App zeigt jede eigene Änderung sofort, der Server bestätigt (§3.5) |
| Zwei Wege zum selben Dokument | Cross-Client-Tests Web ↔ App in jeder Etappe (§6.4) |

---

## 3. Architektur in Flutter

### 3.1 Pakete und Module

Neues lokales Paket **`packages/stachel_board`** (wie `packages/phone_calendar`): reines Dart/Flutter, kennt weder
`ApiService` noch App-Screens – dadurch schnell testbar und sauber getrennt. Die App bindet es in `lib/stachel/` ein.

```
packages/stachel_board/lib/
  protocol/      native_messages.dart (JSON-Typen §4.3), native_socket.dart (WebSocket, Ping, Wiederverbinden, Resume)
  model/         board_object.dart (unveränderlich, typisierte Getter über Map → unbekannte Felder bleiben erhalten)
                 board_state.dart (Basis-Schnappschuss + Patches, Rev/Epoche), pending.dart (optimistische Overlay-Ops)
                 rich_text.dart (ProseMirror-JSON-Modell), quill_bridge.dart (PM-JSON ↔ Quill-Delta)
                 board_source.dart (Schnittstelle: snapshot/patches rein, ops raus) + native_board_source.dart
  geometry/      shape_paths.dart (alle 41 Formen), connector_route.dart (gerade/gewinkelt/geschwungen, Andocken),
                 sticky_geom.dart, textfit.dart (Auto-Schriftgröße), spatial_grid.dart (Raster-Index wie Web), hit_test.dart
  render/        board_painter.dart (Szene), object_renderers/*.dart (Registry je Typ), text_cache.dart,
                 board_images.dart (Bildstufen ?w=256/1024, Auth-Header, Platten-Cache), lod.dart
  editor/        board_controller.dart (ChangeNotifier), camera.dart (ValueNotifier), gestures.dart (Zustandsautomat),
                 selection_overlay.dart, context_bar.dart, toolbar.dart, text_editor.dart (flutter_quill), presence_layer.dart
lib/stachel/     stachel_auth.dart (App-Sitzung §4.1), stachel_api.dart (REST: Boards, Favoriten, Bilder, SSE),
                 stachel_links.dart (App-Links, aus dem Branch), stachel_login.dart (QR-Login, aus dem Branch)
lib/screens/stachel/  stachel_home_screen.dart (Board-Liste), board_screen.dart (Editor), board_offline_banner.dart
```

**Zustand im Stil der App:** `setState` in Screens, `ChangeNotifier`-Controller für langlebige Logik (wie
`ChatController`, `MeetingUploads`). Hochfrequentes (Kamera, Zeiger, Drag-Vorschau) als eigene `ValueNotifier`, die
der Painter direkt als `repaint`-Listenable bekommt – kein Widget-Rebuild pro Frame. Kein neues State-Framework.

### 3.2 Rendering

- **Eine Szene, ein `CustomPainter`** für alle Objekte (nicht ein Widget je Objekt): Weltkoordinaten, Kamera als
  `canvas.transform`. Sichtbare Objekte über den **Raster-Index** (`spatial_grid.dart`, wie `api.hitTest`/`queryRect`
  im Web); Reihenfolge aus dem Schnappschuss (Rahmen unten, dann `z`, bei Gleichstand `id` – Byte-Vergleich, nicht
  `localeCompare`, Vertrag §4).
- **Bild-Cache je Objekt:** jedes Objekt wird als `ui.Picture` aufgezeichnet (Schlüssel: Objekt-Version + Detailstufe)
  und nur bei Änderung neu gebaut. Pan/Zoom zeichnet nur Pictures neu; während einer Geste darf der Painter die ganze
  sichtbare Szene als ein Picture wiederverwenden.
- **Detailstufen** wie `simpleStyle` im Web: unter ~30 % Zoom Flächen in Objektfarbe ohne Text, Bilder als
  Durchschnittsfarbe (`color`), Verbinder als einfache Linie; Text erst ab lesbarer Größe.
- **Text:** `TextPainter` in Weltgröße, einmal je (Inhalt, Breite, Schriftgröße) gelegt und gecacht, beim Zoomen nur
  skaliert (kein Relayout). Schrift **Barlow** ist in der App schon gebündelt. Rich-Text: PM-JSON → `TextSpan`-Baum
  (Absätze, Überschriften 1–3, Listen, Aufgaben mit Kästchen, Zitat, Code, Marks fett/kursiv/unterstrichen/
  durchgestrichen/Code/Link/Markierung/Textfarbe). Auto-Schriftgröße der Haftnotiz = Portierung von `textfit.ts`.
- **Bilder:** `GET /api/images/:id?w=256|1024` mit `Authorization: Bearer` (Stufe nach Objektbreite × Zoom × dpr wie im
  Web), dekodiert in `ui.Image`, Speicher-LRU + Platten-Cache. PDF-Dokumente sind auf dem Board Seitenbilder
  (`docPages` → Bild-IDs) und damit schon in E1 normal darstellbar.
- **Overlays als Widgets** über dem Painter: Auswahlrahmen, Griffe, Kontextleiste, Texteditor, Avatare, fremde Cursor,
  Kommentar-Pins. Sie folgen der Kamera über einen `ValueListenableBuilder`.
- **Unbekannte Typen** (neues Web-Feature, App noch alt): graue Fläche in Objektgröße mit Typname und „Im Browser
  ansehen“; Felder bleiben unangetastet (der Server ändert nur, was die App schickt).
- **Hit-Test:** Raster-Index → Kandidaten von oben nach unten → typgenau (Formpfad enthält Punkt, Verbinder/Stift:
  Abstand zur Linie ≤ 12 px Bildschirm, Rahmen nur über Titel bzw. als Hintergrund wie `hit: 'background'`).

Leistungsziel (Abnahme E1): Board mit 2 000 gemischten Objekten (wie `web/e2e/perf-scale.spec.ts`) auf einem
Mittelklasse-Android im Profil-Build mit ≥ 55 fps beim Pan, ≤ 1,5 s bis zum ersten Bild aus dem Cache.

### 3.3 Gesten am Handy (wie das Web am Touchscreen)

Wer zwischen Web und App wechselt, soll nichts umlernen. Das Web (`web/src/editor/Editor.tsx`) macht am Touchscreen:

| Geste | Wirkung |
|---|---|
| 1 Finger auf leerer Fläche ziehen | Ansicht verschieben (Auswahl weg) |
| 1 Finger auf **nicht ausgewähltem** Objekt ziehen | Ansicht verschieben (nicht das Objekt!) |
| 1 Finger **300 ms halten**, dann ziehen | Objekt greifen und verschieben (Haptik) |
| 1 Finger auf **ausgewähltem** Objekt ziehen | verschieben |
| Tippen | auswählen (Gruppe ganz); Tippen auf ausgewählte Notiz/Text/Form → Text bearbeiten |
| Doppeltippen auf leere Fläche | neue Haftnotiz an der Stelle (wie „Doppeltippen für eine Haftnotiz“) |
| 2 Finger | Zoomen + Verschieben (zweiter Finger bricht jede Ein-Finger-Geste ab) |
| Lange drücken auf leerer Fläche | Menü (Einfügen, Notiz hier, Alles auswählen); **lange drücken + ziehen** = Auswahlrechteck (neu, nur App) |
| Stift (S-Pen/Apple Pencil) | zeichnet, wenn das Stift-Werkzeug aktiv ist; Finger verschieben weiter |

Der Gesten-Automat (`gestures.dart`) ist reines Dart mit Eingabe-Ereignissen → Unit-testbar ohne Widgets.
Werkzeugleiste **unten** (Daumen): Auswählen · Notiz · Text · Form · Verbinder · Stift · Bild/Kamera · Mehr. Oben:
Zurück, Board-Titel, Anwesende, Rückgängig/Wiederholen, Menü. Kontextleiste über der Auswahl wie im Web (Farbe,
Schrift, Ebene, Löschen, Mehr). Beim Tippen in eine Notiz fährt die Kamera die Notiz über die Tastatur (wie
`zoomToEdit` im Web).

### 3.4 Einbindung in den Team-Bereich

- **Pin-Symbol oben in der Team-Leiste** (heute auf `main` noch `qr_code_scanner` → QR-Login; im Branch
  `push_pin_outlined` → Auswahl-Sheet) öffnet **direkt die native Board-Liste** – kein Zwischendialog.
- **Board-Liste** (`stachel_home_screen.dart`): Favoriten oben, „Zuletzt geöffnet“, alle Boards mit Vorschaubild,
  Suche nach Titel, live über `GET /api/boards/events` (SSE). Oben rechts Symbol **„Am Computer anmelden“** → der
  vorhandene QR-Scanner (QR-Login bleibt also eine Ebene tiefer, aber erreichbar). Unten „NEUES BOARD“.
- **Zusätzlich Kachel „Stachel“ unter Mehr** (bei Aufgaben/Umfragen/Protokollen/Kalender) – dort sucht man Arbeitswerkzeuge.
- **App-Links** `/b/<id>` (und `?o=<objekt>`) öffnen den nativen Board-Screen, `/qr/<code>` weiter den QR-Ablauf
  (`stachel_links.dart` aus dem Branch).
- **Aus dem Branch `feat/stachel-qr-login` übernehmen:** `stachel_login.dart` (approve, Fehlercodes, Info-Anzeige),
  `stachel_links.dart`, Manifest/Entitlements für App-Links, Tests. **Verwerfen:** `stachel_screen.dart`,
  `stachel_web.dart`, `webview_flutter`-Pins für Stachel. Das passiert in E0 als eigener Merge.
- **Rückfall „Im Browser öffnen“** (Board-Menü): Einmal-Code wie heute (`/api/auth/app-code`), aber im **System-Browser**
  per `url_launcher` – kein WebView. Hilft, solange eine Funktion nativ fehlt.

### 3.5 Datenfluss in der App

```
NativeSocket ──welcome/patch──▶ BoardState (Basis) ─┐
                                                    ├─▶ sichtbarer Stand = Basis + offene Ops ─▶ Painter/Overlays
BoardController ──op (mit req)───▶ Pending-Overlay ─┘
        │                                  ▲
        └──────── ops ──▶ NativeSocket ──ack(req, rev)─── entfernt Op aus dem Overlay
```

- Jede eigene Änderung gilt **sofort** (Overlay), der Server bestätigt mit `ack`. Kommt vorher ein fremder Patch für
  dasselbe Feld, gewinnt nach dem `ack` der Server-Stand (LWW); `nack` (z. B. Objekt inzwischen gelöscht) entfernt
  die Op mit kurzem Hinweis.
- Beim Ziehen gehen Zwischenstände gedrosselt (≤ 15/s) raus, damit alle die Bewegung live sehen (wie im Web); am Ende
  ein `step`-Marker → ein Undo-Schritt je Geste.

---

## 4. Server-Änderungen (Stachel-Repo)

### 4.1 Anmeldung: Org-Token → Stachel-App-Sitzung

Neu: **`POST /api/auth/app-session`** (Org-App, `Authorization: Bearer <Org-Token>`, kein `X-Stachel`
nötig – wie `app-code`). Prüft das Token wie `approve`/`app-code` (gleiche Fehler, gleiches Rate-Limit) und legt eine
**normale Stachel-Sitzung** an (Tabelle `sessions`, `org_token` für die Nachprüfung alle 6 h, 30 Tage), Antwort
`200 {ok, token: "sts_<32 Byte base64url>", user, expiresAt}`. Gespeichert wird nur der SHA-256-Hash (wie API-Tokens).

- `Authorization: Bearer sts_…` gilt für alle `/api`-Endpunkte mit Sitzungspflicht (mit `X-Stachel: 1` bei schreibenden,
  wie API-Tokens §7) und für den Native-WebSocket (§4.2). Identität = die Person selbst (nicht „KI (für …)“),
  „Zuletzt geöffnet“ zählt.
- `DELETE /api/auth/app-session` (Abmelden im Team-Bereich löscht auch die Stachel-Sitzung und den App-Cache).
- 401 `not_logged_in` → App holt einmal still eine neue Sitzung; Der Identitätsdienst antwortet `invalid_token` → `toTeamLogin`.
- Warum nicht das Org-Token direkt bei jedem Aufruf? Dann müsste der Server bei jedem Request (oder mit eigenem
  Cache) gegen den Identitätsdienst prüfen, und Org-Tokens laufen nach 7 Tagen ab. Die eigene Sitzung passt zum
  vorhandenen Modell (§1 Nachprüfen) und lässt das Identitätsdienst der Organisation **unverändert**.
- Für „Im Browser öffnen“: `GET /auth/app?code=…&b=<id>&browser=1` leitet ohne `app=1` weiter (die Web-App soll sich
  im System-Browser nicht als App-WebView verhalten).

### 4.2 Native-Gateway `wss://<origin>/native/v1`

Neues Modul `server/src/native/`:

| Datei | Aufgabe |
|---|---|
| `gateway.ts` | WebSocket-Upgrade auf `/native/v1` (eigener `WebSocketServer`, gleiche Origin-/Größen-Regeln wie `/sync`), Auth per `sts_`-Token, `access.roleOf` (Modus local: `view` = nur lesen), Ping/Pong, Abmelden/Sperre trennt (wie `/sync`) |
| `mirror.ts` | **ein Spiegel je Board**: `openDirectConnection(board:<id>, {user})` hält das Dokument geladen, `objects.observeDeep` (+ benötigte `collab.*`) → je Transaktion Feld-Diffs gegen die letzte JSON-Kopie → `patch` an alle App-Verbindungen; `rev`-Zähler + `epoch` (zufällig je Laden) + Ringpuffer der letzten 1 000 Patches / 10 min für Resume |
| `writer.ts` | **je App-Sitzung** ein Schreiber mit eigenem Origin (`{native: sessionId}`) und eigenem `Y.UndoManager` (`captureTimeout 600`, `stopCapturing` bei `step`). Schreibregeln = die des Web-Stores (`createMany`/`updateMany`/`remove` mit Verbinder-Kaskade und Gruppen-Auflösung, `keysAbove`/`keysBelow`, `updatedAt`, `createdBy`). Umsetzung: `web/src/board/store.ts` bekommt eine Option `origin` (Standard `LOCAL_ORIGIN`, Web unverändert) und wird serverseitig wiederverwendet; MCP-`BoardModel` ist der Rückfall. Der Server registriert dafür die Daten-Angaben **aller** Typen (`registerTypeInfo`: Rahmen `below`, Verbinder `dependent`/`move`, Feature-Typen wie in `mcp/src/kinds`), sonst blendet der Store sie aus |
| `validate.ts` | Prüfung jeder Op: bekannte Felder mit Typ/Länge (Text ≤ 20 000 Zeichen, Zahlen endlich, Farben `#rrggbb`, IDs `[A-Za-z0-9_-]{1,64}`), ≤ 500 Ops je Nachricht, unbekannte Felder nur mit Modul-Präfix erlaubt; Verstoß → `nack invalid_input`, nichts halb geschrieben |
| `richtext.ts` | PM-JSON → `updateYFragment` (y-prosemirror) mit Tiptap-Schema (StarterKit + Erweiterungen wie `web/src/features/richtext`), Klartext-Spiegel `text` im selben `transact` (Vertrag §4 „Rich-Text“) |
| `presence.ts` | Brücke zur Hocuspocus-Awareness: je App-Sitzung eine synthetische `clientID`, Zustand `{user:{key,name,color}, cursor, selection, since, client:'app'}` per `applyAwarenessUpdate` ins Dokument (alle 15 s erneuert, beim Trennen entfernt); fremde Awareness → `presence`-Nachrichten an die App |
| `serialize.ts` | Objekt → JSON wie `mcp/src/board/model.ts` `readObject` (tolerant, **unbekannte Typen bleiben drin**), Y-Felder über die vorhandenen Codecs (`fragmentToJson`, `tableToJson` …) |

Gemeinsamer Code wird wie beim MCP-Server per relativem Import aus `web/src/board` und `web/src/features/*/` genutzt
(nur React-freie Dateien). Neue Server-Pakete exakt pinnen: `y-prosemirror`, `prosemirror-model`, `@tiptap/core`,
`@tiptap/starter-kit` (+ was `richtext` an Erweiterungen nutzt) – Versionen wie in `web/package.json`.

### 4.3 Protokoll v1 (Entwurf für `docs/contract.md` §8)

JSON-Textrahmen, `permessage-deflate` an. Jede Nachricht hat `t`.

**App → Server**

```jsonc
{"t":"hello","proto":1,"board":"abc","app":"1.22.0+31","resume":{"epoch":"e7f…","rev":4711},"want":["objects","comments"]}
{"t":"ops","req":12,"ops":[
  {"op":"create","objects":[{"id":"n_8f…","type":"sticky","x":0,"y":0,"w":200,"h":200,"color":"#fff27a","text":""}]},
  {"op":"update","patches":{"n_8f…":{"x":40,"y":12},"c_1a…":{"color":"#1763b5","dash":null}}},   // null = Feld entfernen
  {"op":"remove","ids":["s_77…"]},
  {"op":"order","ids":["n_8f…"],"to":"front"},                                                       // front|back
  {"op":"text","id":"n_8f…","base":"r4711","doc":{"type":"doc","content":[…]}}                     // Rich-Text, §4.6
]}
{"t":"step"}                         // Undo-Schritt abschließen (Ende einer Geste)
{"t":"undo","req":13}  {"t":"redo","req":14}
{"t":"presence","cursor":{"x":1,"y":2},"selection":["n_8f…"],"editing":"n_8f…","viewport":{"x":0,"y":0,"w":390,"h":800,"z":0.8}}
{"t":"ping"}
```

**Server → App**

```jsonc
{"t":"welcome","proto":1,"epoch":"e7f…","rev":4711,"user":{"key":"m:12","name":"Mara","isOrga":false},"role":"edit",
 "color":"#1763b5","features":["objects","comments","undo"],"snapshot":{"objects":[…],"ext":{"collab.comments":{…}}},
 "peers":[…],"history":{"canUndo":false,"canRedo":false}}
{"t":"resumed","rev":4720,"patches":[…]}                 // statt welcome-Schnappschuss, wenn der Ringpuffer reicht
{"t":"patch","rev":4712,"by":"m:7","changes":[{"id":"n_8f…","set":{"x":40},"unset":["dash"]},{"id":"s_77…","removed":true},{"id":"t_1…","created":{…}}],"ext":{…}}
{"t":"ack","req":12,"rev":4712}   {"t":"nack","req":12,"error":"invalid_input","message":"…"}
{"t":"history","canUndo":true,"canRedo":false}
{"t":"presence","peers":[{"id":123,"key":"m:7","name":"Jonas","color":"#ec4e92","cursor":{…},"selection":[…],"editing":null,"client":"web"}]}
{"t":"event","type":"board.renamed","title":"…","titleSeq":5}   {"t":"event","type":"board.deleted","by":"…","byKey":"…"}
{"t":"pong"}   {"t":"error","error":"upgrade_required","message":"Bitte die Org-App aktualisieren."}
```

- Eigene Änderungen kommen als normaler `patch` zurück (mit `by` = eigener Key); die App ordnet sie über `ack.rev` zu.
- `req` steigt je App-Sitzung streng; der Server merkt sich die zuletzt ausgeführte `req` je Sitzung (auch über ein
  Resume hinweg). Nach einem Funkloch schickt die App offene Ops erneut, schon ausgeführte bekommen nur ein `ack` –
  nichts wird doppelt angelegt.
- Ablehnungen beim Verbinden wie `/sync`: Close mit Grund `not_logged_in`, `unknown_board`, `board_deleted`, `no_access`.
- Awareness-Abbildung im Gateway: `editing` ↔ `richtext.caret.id`, `viewport` ↔ `collab.viewport`, Folgen ↔
  `collab.follow` (docs/features/collab.md) – damit „Folgen“ und „Alle zu mir holen“ (E4b) auch gemischt Web/App gehen.
  Weitere Awareness-Felder reicht der Gateway roh unter `extra` durch.

### 4.4 Versionierung

- Pfad `/native/v1` + `hello.proto`; Server meldet `features`. Neue Felder/Nachrichten nur **additiv**, die App
  ignoriert Unbekanntes. Bruch → `/native/v2` parallel, v1 bleibt mindestens bis die letzte App-Version mit v1 aus den
  Stores ist (iOS-Review-Vorlauf!).
- `GET /api/native/info` (ohne Sitzung) → `{ok, proto:[1], minApp:"1.22.0"}`; ältere App → Hinweis „Bitte App
  aktualisieren“ statt kaputter Darstellung.
- Neue Objekttypen im Web: Eintrag in `docs/features/<modul>.md` **plus** Zeile in `docs/native_paritaet.md`
  (Typ, Felder, App-Version, die ihn kann). Bis dahin zeigt die App den Platzhalter (§3.2).

### 4.5 Weitere Server-Punkte

- `GET /api/native/v1/inbox?since=<iso>` (E3): neue @Erwähnungen und Karten-Zuweisungen für die anfragende Person
  (der Server zieht sie beim Speichern aus `collab.comments` bzw. `assignee` in eine Tabelle `mentions`), damit der
  vorhandene Hintergrund-Check der App Benachrichtigungen zeigen kann – **ohne** Änderung am Identitätsdienst der Organisation.
- `tools/sandbox.mts`: Fake-Identitätsdienst-URL ausgeben, Mitglieder-Tokens (`addMember`) ausgeben, Option `--seed` legt ein
  Test-Board mit allen Objekttypen an (für App-Integrationstests).
- `tools/native-fixtures.mts` (§6.2): exportiert Referenzwerte aus dem Web-Code als JSON für die Dart-Tests.
- Tests: `server/test/native-*.test.ts` (Vitest).

### 4.6 Rich-Text-Bearbeitung

- App: Bearbeiten mit `flutter_quill` (schon in der App). Beim Öffnen PM-JSON → Delta, beim Tippen (entprellt 300 ms)
  und beim Schließen Delta → PM-JSON → `{"op":"text","id":…,"base":"r<rev>","doc":…}`.
- Server: `base` == letzte Revision, die `content` dieses Objekts geändert hat → `updateYFragment` + `text`-Spiegel in
  einem `transact`. Sonst **Rebase auf dem Server**: der Diff Basis→App wird als Schritt-Folge (Klartext-Positionen
  je Absatz, Marks je Bereich) auf den aktuellen Stand gelegt; nur bei echter Überlappung gewinnt der spätere Stand,
  und die App zeigt „Notiz wurde gleichzeitig geändert“. Das Ergebnis kommt als normaler Patch zurück, die App
  übernimmt es in den offenen Editor (Cursor bleibt über die Delta-Transformation an seiner Stelle).
- Die Basis-Revisionen je Objekt hält der Spiegel (`mirror.ts`) im Speicher; nach einem Server-Neustart (neue
  Epoche) gilt jede alte Basis als veraltet → Rebase-Weg.
- Objekte ohne `content` (alt, nur `text`): der Server baut `content` aus `text` im selben Schritt (Vertrag §4
  „Migration“).
- Normalfall verhindern: schreibt jemand im Web in der Notiz, steht das in dessen Awareness (`richtext.caret.id`,
  docs/features/richtext.md); der Gateway reicht es als `editing` weiter, die App öffnet die Notiz dann nur lesend mit
  „Mara schreibt hier gerade“. Umgekehrt setzt der Gateway für die App ein `richtext.caret` mit `id` (ohne
  Schreibmarke), damit das Web dasselbe zeigt.

---

## 5. Etappen mit Abnahme

Jede Etappe = ein App-Release an die internen Tester (Android direkt, iOS über Codemagic → TestFlight) und ein
Server-Deploy **vor** dem App-Release. Abnahme = alle Punkte grün, auf einem echten Android-Gerät geprüft, Screenshots
Web und App nebeneinander im Ticket.

### E0 – Vorarbeit (intern, kein Tester-Release)

- Branch `feat/stachel-qr-login` ohne WebView auf `main` (§3.4), Tests grün.
- Server: `app-session`, Gateway-Gerüst mit `welcome`/`patch` (nur lesen), `store.ts` mit `origin`-Option, Vertrag §8.
- App: Paket `packages/stachel_board` angelegt, `BoardSource`, Protokoll-Typen, Fixture-Pipeline (§6.2) läuft.
- **Leistungs-Spike:** 2 000/5 000 synthetische Objekte im Painter auf dem Android-Gerät messen. Erreicht er die Ziele
  aus §3.2 nicht, wird der Rendering-Ansatz vor E1 angepasst (nicht erst danach).

#### E0 – Ergebnisse App (Stand 2026-11-01, Branch `feat/stachel-native` im App-Repo der Organisation)

- **Umgesetzt:** Merge von `feat/stachel-qr-login` ohne WebView; Pin + Kachel „Stachel“ → Board-Liste (Favoriten,
  zuletzt geöffnet, Suche, Vorlagen getrennt, QR-Login dort, „Im Browser öffnen“ mit `browser=1`); App-Sitzung `sts_`
  gespeichert und beim Abmelden gelöscht; Paket `packages/stachel_board` mit Protokoll §8, `NativeBoardSource`
  (WebSocket, Resume, Ping, 4401 → neues Token), Modell aller 14 Typen, alle 41 Formen (gleiche SVG-Pfad-Texte wie
  das Web), Verbinder, Renderer (ein `CustomPainter`, Raster-Index, `ui.Picture` je Objektversion, höchstens 120 neue
  Pictures je Frame, flach unter 30 % Zoom), Kamera mit Pinch/Trägheit, Hit-Test, Board nativ ansehen (nur
  Test-Builds). Server-Fixtures `docs/native_fixtures/` laufen als Dart-Tests (8 Patches → exakt der frische
  Schnappschuss), Live-Test gegen die Sandbox grün.
- **Messung** (`packages/stachel_board/example/integration_test/board_perf_test.dart`, Profil-Build, je Szenario
  3–5 s): Pan bei 100 % und 50 % quer über das Board (neue Objekte kommen laufend ins Bild), Übersicht bei 15 %
  (flach, fast alles sichtbar), Pinch 10 % → 150 % → 10 %. Boards: Generator wie `web/e2e/perf-scale.spec.ts`
  („mixed“) und die Server-Boards „Groß 2000/5000“ der Sandbox über den echten WebSocket („server“).

  | Windows-Desktop, Profil, 1264×681 | erstes Bild | Pan 100 % fps / UI p90 / Raster p90 | Pan 50 % | Übersicht 15 % | Pinch | Frames > 16,7 ms |
  |---|---|---|---|---|---|---|
  | mixed 2 000 | 42 ms | 70 / 1,6 / 1,4 ms | 71 / 2,8 / 3,2 ms | 75 / 2,1 / 4,0 ms | 69 / 0,8 / 4,8 ms | 0 % |
  | mixed 5 000 | 48 ms | 69 / 2,7 / 1,4 ms | 69 / 4,0 / 3,2 ms | 78 / 2,1 / 4,2 ms | 67 / 0,8 / 4,3 ms | 0 % |
  | server 2 000 (WebSocket) | 153 ms (Laden 127 ms) | 69 / 0,8 / 1,3 ms | 69 / 0,9 / 2,3 ms | 78 / 2,2 / 4,5 ms | 67 / 1,0 / 3,2 ms | 0 % |
  | server 5 000 (WebSocket) | 71 ms (Laden 51 ms) | 68 / 1,1 / 1,7 ms | 71 / 1,3 / 2,8 ms | 76 / 2,9 / 5,0 ms | 67 / 1,2 / 3,3 ms | 0 % |

  Über zwei Läufe: längster UI-Frame 12 ms (Pan 50 % beim Aufzeichnen neuer Pictures), längster Raster-Frame 11 ms;
  das Laden des 5 000er-Boards über den WebSocket dauerte in der Sandbox 0,05–0,23 s, der Raster-Index 51 ms. Der Ansatz
  „ein Painter + Picture je Objekt + Detailstufe“ hält damit auf dem Desktop weite Reserve (Budget 16,7 ms).
- **Android-Messung (2026-11-01, Sony QV770AB4MQ, Profil, 432×936, Impeller/Vulkan, 120 Hz):**

  | Android, Profil | Laden | erstes Bild | Pan 100 % fps (> 16,7 ms) | Pan 50 % | Übersicht 15 % | Pinch | Pictures |
  |---|---|---|---|---|---|---|---|
  | mixed 2 000 | 20,6 ms | 167,5 ms | 122,9 (2,8 %, Build max 26 ms) | 120,4 (3,7 %) | 138,9 (0 %) | 112,7 (1,8 %, ein Raster-Ausreißer 145 ms) | 350 |
  | mixed 5 000 | 63,3 ms | 127,6 ms | 114,4 (5,9 %, Build p90 11,6 ms, max 31 ms) | 109,0 (6,6 %, Build max 48,5 ms) | 138,3 (0 %) | 125,5 (0,5 %) | 528 |

  Abnahme §3.2 erfüllt (≥ 55 fps beim Pan mit 2 000 Objekten, erstes Bild weit unter 1,5 s). Auffällig: Build p90
  ~11 ms bei 5 000 Objekten beim Pan auf 100 %/50 % (Aufzeichnen neuer Pictures, höchstens 120 je Frame) – Reserve bis
  16,7 ms ist da; Stellschraube falls nötig: weniger neue Pictures je Frame während einer Geste. Gerätetest: App-Link
  `https://board.example.org/b/<id>` öffnet das Board nativ im Release-Build 1.23.0.

### E1 – Ansehen & dabei sein

Abnahme:
- [x] Pin-Symbol im Team und Kachel unter Mehr öffnen die Board-Liste; Favoriten, „Zuletzt geöffnet“, Suche, Vorschaubilder; Stern setzen/entfernen; Liste aktualisiert sich live.
- [x] Board öffnet ohne Login-Schritt; Pan/Zoom flüssig (§3.2), Zoom 10–400 %, „Alles zeigen“, Doppeltippen mit 2 Fingern = zurück auf 100 %. *(flüssig: Windows und Android gemessen, §5 E0)*
- [x] **Alle Objekttypen** sichtbar: Haftnotiz (alle Formen), Text, alle 41 Formen, Verbinder (gerade/gewinkelt/geschwungen, Pfeilspitzen, gestrichelt, Beschriftung, angedockt), Stift, Rahmen (Titel, Raster), Bild (Stufen), Sticker/Stempel/Icon, Karte, Tabelle, Mindmap, Zeitleiste, PDF-Dokument (aktuelle Seite); Rich-Text mit Formatierung; Drehung; unbekannter Typ = Platzhalter.
- [x] Änderungen im Web erscheinen in der App in ≤ 1 s (gemessen im Cross-Client-Test).
- [x] Anwesenheit: Avatare oben, fremde Cursor/Auswahl in Personenfarbe; die App erscheint im Web als Person (nicht als KI).
- [x] Objekt antippen zeigt nur Auswahlrahmen + „Link kopieren“/„Im Browser öffnen“ (noch kein Bearbeiten).
- [x] App-Link `/b/<id>` und `?o=<objekt>` öffnen nativ an der richtigen Stelle.
- [x] Offline: zuletzt geöffnete Boards aus dem Cache mit Banner „Offline – Stand von …“; Wiederverbinden ohne Neuladen (Resume).
- [x] Board gelöscht/umbenannt während offen: Hinweis bzw. neuer Titel wie im Web.
- [ ] Tests §6 für E1 grün; Gerätetest-Checkliste abgehakt. *(Tests grün; Gerätetest + Android-Messung offen, s. u.)*

#### E1 – Ergebnisse App (Stand 2026-11-01, Branch `feat/stachel-native` im App-Repo der Organisation)

- **Board-Liste:** Antippen öffnet das Board **nativ** (auch in Release-Builds); „Im Browser öffnen“ und „Link kopieren“
  im Menü je Board, „Im Browser öffnen“ (Übersicht) oben. Live über SSE `GET /api/boards/events` (Bearer `sts_`):
  Umbenennen/Löschen sofort in der Liste, `created`/`updated`/`restored`/Wiederverbinden laden still neu, 401 → neue
  Sitzung. Liste und Vorschaubilder (je `thumbnailAt` auf der Platte) bleiben für offline; ohne Netz „Keine Verbindung –
  zeige gespeicherten Stand · Stand von …“. Zurück aus einem Board lädt „Zuletzt geöffnet“ neu.
- **Board:** App-Leiste mit Titel (live umbenannt), Avataren der Anwesenden (eine je Person, „+n“, Antippen = Liste
  mit „im Browser/in der App“), „Alles zeigen“, Menü (Im Browser öffnen, Link zum Board kopieren, Auf 100 % zoomen).
  Fremde Cursor mit Namensschild und fremde Auswahl in Personenfarbe; die eigene Anwesenheit geht gedrosselt (4/s) raus:
  Ausschnitt (`viewport`), Cursor = Mitte des Ausschnitts, Auswahl – im Web erscheint die Person (`client: app`).
  Doppeltippen mit zwei Fingern = 100 %. Objekt antippen → Feld mit „Link kopieren“ (`/b/<id>?o=<obj>`) und „Im Browser
  öffnen“.
- **Offline-Cache:** letzter bestätigter Stand je Board als Datei (`FileBoardCache`, höchstens 20 Boards / 40 MB, Kodieren
  im Hintergrund-Isolate), gespeichert 1 s nach dem ersten Live-Stand und 4 s nach Änderungen sowie beim Verlassen.
  Öffnen zeigt den Cache sofort („Stand von heute, 14:32 – wird aktualisiert …“) und verbindet mit `resume` ab dessen
  Revision → `resumed` mit nur den fehlenden Patches (gleiche Epoche) bzw. frischer Schnappschuss. Ohne Netz bleibt das
  Board lesbar („Keine Verbindung – zeige gespeicherten Stand“), verbindet sich selbst neu (1–15 s, beim Zurückkommen in
  die App sofort). Abmelden löscht Boards, Bilder, Vorschaubilder und Liste.
- **Bilder/PDF-Seiten:** `HttpBoardImages` mit Bearer, Speicher begrenzt nach dekodierter Größe (96 MB), Platte je Stufe
  (150 MB, älteste zuerst), offline ersatzweise die andere Stufe von der Platte, nach Fehler 15 s Pause (kein
  Anfrage-Sturm), 404 nie wieder; bis zum Laden Durchschnittsfarbe + Bild-Symbol.
- **`?o=<objekt>`:** Kamera auf das Objekt (höchstens 100 %), ausgewählt und pink hervorgehoben; fehlt es (laut Server,
  nicht nur laut Cache) → „Das verlinkte Objekt gibt es auf diesem Board nicht mehr.“ Server: `/b/<id>?o=` behält `o` beim
  Umleiten (Vertrag §2).
- **Referenzwerte aus dem Web-Code** (`tools/native-web-fixtures.mts` → `docs/native_fixtures/web/` → App
  `test/fixtures/web/`): alle 41 Formen × 15 Größen/Insets **textgleich** (615 Pfade + Textflächen), 328
  Verbinder-Geometrien, Zeichenreihenfolge – alles gleich. Auto-Schriftgrößen fehlen (Canvas-Messung im Browser).
- **Cross-Client gegen die Sandbox** (`native_cross_client_live_test.dart`, Gegenseite `tools/web-peer.mts` wie ein
  Browser): Web anlegen/verschieben/Text/löschen → in der App nach **28–30 ms** (Grenze 1 s) und gezeichnet; Web-Cursor nach
  ~120 ms in der App, App-Anwesenheit im Web als `a:mara` mit `client: app`, Cursor/Auswahl/`collab.viewport`; Funkloch
  während das Web ändert → `resumed` mit genau den fehlenden Patches, kein neuer Schnappschuss, auch aus dem Datei-Cache
  in einem neuen Controller; 4401 (kaputtes Token bzw. Sitzung am Server abgemeldet) → einmal neues Token, wieder live;
  Umbenennen während offen.
- **Tests:** Paket 108 (+ 8 Live-Tests gegen die Sandbox), App 610; `flutter analyze` sauber (App, Paket, example).
- **Offen für E1:** Android-Messung (QV770AB4MQ war nicht verbunden) und Gerätetest-Checkliste §6.5 (App-Link aus
  WhatsApp, Flugmodus an/aus, Hintergrund/Vordergrund, Drehen); Server-Deploy für `/b/<id>?o=` (ohne Deploy öffnet der
  Objekt-Link im Browser nur das Board).

### E2 – Bearbeiten (Kern)

Abnahme:
- [x] Haftnotiz anlegen (Doppeltippen, Werkzeug), Text, Form (Grundformen + zuletzt benutzte), alles auch per Plus-Griff daneben. *(Plus-Griff wie im Web an Notiz und Form)*
- [x] Auswählen (Tippen, Gruppe ganz, langes Drücken + Ziehen = Rechteck), Verschieben (Halten bzw. ausgewählt), Größe ändern, Drehen (mit Einrasten + Haptik), Löschen, Duplizieren, Ebene vorne/hinten, Sperren wird respektiert.
- [x] Text in Notiz/Text/Form bearbeiten mit Tastatur über dem Objekt; Formatierung vorhandener Notizen bleibt erhalten; „Mara schreibt hier gerade“. *(Tastatur und Haptik am Gerät noch prüfen)*
- [x] Farbe, Schriftgröße, Ausrichtung über die Kontextleiste.
- [x] Rückgängig/Wiederholen nimmt nur eigene Schritte zurück, eine Geste = ein Schritt; Web sieht alles live.
- [x] Kurzes Funkloch (≤ 2 min): Änderungen werden nachgereicht, nichts doppelt (`req`-Nummern, §4.3).
- [x] Neues Board anlegen, umbenennen.
- [x] Kein Datenverlust im Konflikt-Test (zwei Clients ändern dasselbe Objekt, §6.4). *(nur bei echter Überlappung im selben Wort gilt der spätere Stand, mit Hinweis – wie §4.6)*
- [ ] Gerätetest-Checkliste §6.5 und Android-Messung auf QV770AB4MQ *(Gerät war während E2 nicht verbunden)*.

#### E2 – Ergebnisse (Stand 2026-11-01; Server live, App Branch `feat/stachel-e2` im App-Repo der Organisation)

- **Server (live auf beiden INTSODE-Instanzen):** `text`-Op (Vertrag §8.6, `features` enthält
  `"text"`). Basis = `baseDoc` der App (empfohlen, eindeutig auch über Neustart/Epoche) bzw. der Stand zur Revision
  `base` (der Spiegel hält je Objekt die letzten 40 Rich-Text-Stände, `mirror.ts` `textAt`). Ohne Zwischenänderung gilt
  der App-Stand; sonst Drei-Wege-Zusammenführen (`server/src/native/richmerge.ts`): beide Dokumente als Zeichen-/
  Knoten-Folge mit Marks, Myers-Diff gegen die Basis; getrennte Stellen bleiben beide, gleichzeitig an derselben Stelle
  Eingefügtes auch (erst das vorhandene, dann das der App), nur dieselbe Stelle verschieden geändert → App gewinnt,
  `ack.conflict`. Ins `Y.XmlFragment` geht nur der Unterschied (gleiche Absätze bleiben dieselben Yjs-Elemente,
  Schreibmarken im Web bleiben stehen), `text` + `updatedAt` im selben Schritt; alte Objekte nur mit `text` bekommen ihr
  Fragment. Unbekannte Knoten, Marks und Attribute reicht der Server unverändert durch. Kein y-prosemirror/Tiptap im
  Server nötig (Abweichung von §4.2 `richtext.ts`). Web: „Mara schreibt hier gerade …“ über dem Objekt für alle, die
  es nicht selbst bearbeiten (Slot `richtext.writing`, `web/src/features/richtext/Writing.tsx`), auch für die App.
- **App – Bearbeiten:** `BoardController` zeigt eigene Änderungen sofort (`state` = `confirmed` + offene Ops), schickt
  sie mit zeitbasiert streng steigender `req` (auch über App-Starts hinweg), nimmt sie bei `ack` heraus (der eigene Patch
  kam vorher) bzw. bei `nack` zurück (Hinweis). Funkloch: Ops warten und gehen nach `welcome`/`resumed` mit derselben
  `req` noch einmal raus (der Server führt jede `req` einmal aus); bearbeiten geht offline bis 2 min weiter, dann
  „Bearbeiten pausiert“; Zurück mit wartenden Änderungen fragt nach. Ziehen/Griffe: Zwischenstände ≤ 15/s, zusammen-
  gefasst (nie ein schon gesendeter), am Ende `step` = ein Rückgängig-Schritt je Geste; immer nur geänderte Felder
  (unbekannte Felder und Typen bleiben am Server unberührt).
- **App – Gesten** (`editor/gestures.dart`, reiner Automat mit Tests): 1 Finger auf leerer Fläche bzw. nicht
  ausgewähltem Objekt = Ansicht, auf ausgewähltem = verschieben, 300 ms halten = greifen (Haptik), lange drücken auf
  leerer Fläche = Menü („Haftnotiz hier“, „Text hier“, „Alles auswählen“), halten + ziehen = Rechteck-Auswahl, 2 Finger
  = Zoom (beendet jede Ein-Finger-Geste, ein bleibender Finger schiebt weiter), Griffe sofort. Tippen wählt (Gruppe
  ganz), Tippen auf die ausgewählte Notiz/Text/Form = schreiben, Doppeltippen auf leere Fläche = neue Notiz. Griffe:
  Ecken/Seiten (Notiz quadratisch, Text-Ecke skaliert die Schrift, Text-Seite = feste Breite), Drehen mit Einrasten bei
  Vielfachen von 90° ± 5° wie das Web + Haptik, Plus = leere Kopie daneben mit geschwungenem Pfeil (`createSibling`).
  Gesperrte Objekte: wählbar, aber ohne Griffe, nicht verschieb-, lösch- oder beschreibbar.
- **App – Rich-Text** (`model/rich_edit.dart`, bewusst ohne flutter_quill): das Textfeld bearbeitet die Textblöcke des
  ProseMirror-JSON (dieselben, aus denen `plainOf` den Klartext macht); jede Änderung wird auf Zeichen mit ihren Marks
  abgebildet: Getipptes erbt die Marks davor (Links enden an ihrem Ende), Enter teilt den Absatz bzw. legt in Listen einen
  neuen Eintrag an (Aufgabe unerledigt), im Code-Block bleibt es Text, Rücktaste am Anfang verbindet Blöcke. Alles
  andere (unbekannte Marks/Knoten/Attribute, Listen-/Zitat-Struktur, Trennlinien) bleibt unangetastet. Das Textfeld
  liegt genau über dem Objekt (gleiche Fläche, Auto-Schriftgröße, Ausrichtung, Drehung; der Painter lässt dort den Text
  weg) und zeigt die Formatierung (fett, kursiv, Farbe, Überschrift …). `text`-Op entprellt 300 ms mit `baseDoc`; der
  zusammengeführte Stand kommt in den offenen Editor, sobald nichts Eigenes unterwegs ist (Schreibmarke bleibt). Im
  Editor nicht sichtbar: Aufzählungszeichen/Kästchen (die Liste bleibt erhalten). Format-Leiste für Textteile kommt mit E3.
- **App – Oberfläche:** Werkzeugleiste unten (Auswahl · Notiz · Text · Form · Rückgängig/Wiederholen) mit Hinweis
  „Tippe auf das Board …“, Kontextleiste über der Auswahl (Farbe, Schriftgröße inkl. „automatisch“, Ausrichtung,
  Bearbeiten, Duplizieren, nach vorne/hinten, Löschen, Link, Browser), beim Schreiben eine Leiste über der Tastatur mit
  FERTIG und „Jonas schreibt hier auch gerade“; schreibt jemand schon → „Mara schreibt hier gerade“ statt Editor.
  NEUES BOARD in der Liste (Titel, dann nativ geöffnet), Umbenennen im Board-Menü. Rolle `view`/`comment` = keine Werkzeuge.
- **Tests:** Server +15 (`native-text.test.ts`: Zusammenführen inkl. Zufall, kleinster Unterschied mit stehender
  Schreibmarke, Gateway schnell/Rebase per `baseDoc` und per Revision/Konflikt/alte Objekte/Rückgängig/Prüfung), Server
  gesamt 236 grün (nur das bekannte `security.test.ts` scheitert unter Windows). Web 322 (+1 `Writing.test.ts`).
  App-Paket 147 (+ 13 Live-Tests, davon 5 neu in `native_e2_live_test.dart`: App → Web mit Rich-Text, Rückgängig nur
  Eigenes, dieselbe Notiz gleichzeitig mit dem Web in zwei Absätzen bzw. im selben Wort, ein Objekt von zwei Apps + Web
  gleichzeitig, Funkloch ohne Doppeltes, „schreibt hier“ in beide Richtungen). App 619 (+9; Doku des App-Repos).
- **Offen:** Gerätetest (Tastatur über der Notiz, Haptik, Gesten mit echten Fingern, Funkloch per Flugmodus) und
  Android-Messung auf QV770AB4MQ (nicht verbunden); Sichtvergleich Web/App mit Screenshots (§6.3).

### E3 – Verbinden, Medien, Zusammenarbeit

Abnahme:
- [x] Verbinder ziehen (aus Andockpunkt/Plus-Griff), Enden umhängen, Stil/Pfeile/Beschriftung ändern.
- [x] Bild aus Galerie **und Kamera** (verkleinert, Durchschnittsfarbe, Platzhalter „lädt hoch …“ für alle).
- [x] Rahmen anlegen/benennen, Inhalt wandert mit, Rahmen-Liste zum Springen.
- [x] Rich-Text-Leiste: fett/kursiv/unterstrichen/durchgestrichen, Listen, Aufgaben (abhaken), Links, Text- und Markierfarbe. *(plus Überschrift 1–3; Aufzählungszeichen/Kästchen beim Schreiben weiter unsichtbar, s. u.)*
- [x] Stift (Finger im Stift-Werkzeug, Stylus), Radierer. *(plus Textmarker)*
- [x] Kommentare lesen/schreiben/erledigen, @Erwähnung; **Benachrichtigung** bei Erwähnung über den Hintergrund-Check.
- [x] Reaktionen setzen/sehen.
- [x] Team → „NEU ANLEGEN“ → „Foto aufs Board“ (Board wählen, Foto landet an freier Stelle).
- [x] (E2-Rest) Wartende Änderungen überleben das Verlassen des Boards und ein Beenden der App.
- [ ] Gerätetest §6.5 mit echten Fingern/Kamera/Stylus (Gerät war während E3 belegt, s. u.).

#### E3 – Ergebnisse (Stand 2026-11-01; Server live, App Branch `feat/stachel-e3` im App-Repo der Organisation)

- **Server (live auf beiden INTSODE-Instanzen, `features` + `comments`, `reactions`, `uploads`,
  `inbox`):** Ops `comment`/`reply`/`commentEdit`/`commentDelete`/`resolve`, `react`, `mentionsRead` (Vertrag §8.6) mit
  dem Code des Web-Moduls collab (`comments.ts` bekam optionale feste IDs; gleiche Y-Strukturen, ein Rückgängig-Schritt
  je Aktion, nur eigene Nachrichten bearbeiten/löschen, Wiederholung ohne Doppeltes). `presence.uploads` →
  Awareness `collab.uploads` (Web zeigt „Mara lädt hoch …“). **Posteingang** `GET /api/native/v1/inbox?since=` (§8.11,
  `server/src/native/inbox.ts`): Beobachter je geladenem Board auf `collab.comments` und `objects` legen neue
  @Erwähnungen und Karten-Zuweisungen (nicht die eigenen, nicht ohne Person wie bei Versionen) in die Tabelle `mentions`;
  die App fragt mit der Server-Zeit `now` weiter. Bilder über das vorhandene `POST /api/boards/:id/images` mit `sts_`.
- **App – Verbinder** (`editor/editor_tools.dart`, `BoardEditorTools`): Werkzeug „Linie“ (von Objekt/Board ziehen,
  angedockt ohne Seite wie das Web, automatisch geschwungen zwischen zwei Objekten, Linienart wählbar), Plus-Griff
  ziehen (auf ein Objekt = Verbinder, ins Leere = gleiche Form dort, verbunden), Andockpunkte an allen anderen
  andockbaren Objekten, Andockpunkte rasten in 22 px ein (`dropEnd`), Enden eines ausgewählten Verbinders umhängen (ein
  Schritt). Kontextleiste: Linienart, Spitze Anfang/Ende (alle 9, `arrowStart/arrowEnd` wie das shapes-Modul),
  Strichart, Stärke, Farbe, Beschriftung (über die `text`-Op), Richtung umkehren.
- **App – Stift/Textmarker/Radierer:** ein Finger zeichnet im Stift-Werkzeug (zweiter Finger bricht ab und zoomt), nach
  einem Stylus nur noch der Stylus (Finger verschieben); Strich wie `pen.ts` (RDP 0,6/Zoom, Box mit halber
  Strichbreite, 0,1-Raster), Farben/Breiten wie das Web, Textmarker `marker: true`; Radierer löscht ganze Striche
  (`penHit`), ein Schritt.
- **App – Rahmen:** Werkzeug unter „Mehr“ (640 × 420, „Rahmen n“), benennen über die Kontextleiste, ein ausgewählter
  Rahmen nimmt beim Ziehen mit, was ganz in ihm liegt (wie `movableSet`), Rahmen-Liste im Board-Menü (erst `slide`,
  dann Lesereihenfolge) springt hin.
- **App – Bilder:** „Bild“ → Kamera oder Galerie (`image_picker` 1.2.4, längste Seite 2048 px, JPEG 82 %, HEIC u. a.
  werden als PNG neu kodiert), Größe/Durchschnittsfarbe auf dem Gerät, Platzhalter an freier Stelle in der Bildmitte (für
  alle per `presence.uploads`, eigener mit Fortschritt), Upload in 64-KB-Stücken mit Fortschritt, dann das Bildobjekt
  (Web-Größe 120–520 px). **Offline-sicher:** Datei + Eintrag liegen auf dem Gerät (`stachel/uploads`,
  SharedPreferences), ohne Netz „Wartet auf Verbindung“, weiter beim nächsten Live (auch nach Verlassen/App-Ende, 7 Tage);
  schon hochgeladen → nur noch das Objekt. Abgelehnt (zu groß, falscher Typ) → Hinweis, Eintrag weg.
- **App – Kommentare & Reaktionen:** Pins (offen, pink bei ungelesener Erwähnung, Zahl der Nachrichten) und
  Reaktions-Chips unter Objekten ab 30 % Zoom (`render/collab_painter.dart`); Pin antippen → Thread (Antworten mit
  @-Vorschlägen aus `GET /api/users` + Anwesenden + Autor:innen, eigene bearbeiten/löschen, erledigen/wieder öffnen,
  „Auf dem Board zeigen“), Kommentar-Werkzeug bzw. „Kommentieren“ in der Kontextleiste, Liste im Board-Menü mit Offen/
  Erledigt/Alle, Pins ein-/ausblenden, „Du wurdest erwähnt · ANSEHEN“ (Lesen setzt `collab.reads`). Chip antippen bzw.
  „Reagieren“ (auch mehrere Objekte) schaltet die eigene Reaktion um. Alles optimistisch (ext-Overlay im Controller).
- **App – Format-Leiste** beim Schreiben (`RichEditDoc`): fett/kursiv/unterstrichen/durchgestrichen, Textfarbe
  (`textStyle.color`, andere Attribute bleiben), Markierung, Aufzählung/Nummerierung/Aufgaben (einpacken, wechseln,
  auspacken), Abhaken, Überschrift 1–3, Link (nur http/https/mailto/tel); ohne Auswahl wirkt sie auf den ganzen Text
  wie im Web; unbekannte Marks bleiben.
- **App – Benachrichtigung:** der Hintergrund-Check (WorkManager/BGAppRefresh) und jeder Start fragen den Stachel-
  Posteingang – nur mit vorhandener Stachel-Sitzung, erster Lauf nur Grundlinie; „Jonas hat dich in Stachel erwähnt“ /
  „… hat dir eine Karte zugewiesen“, Antippen öffnet das Board nativ am Objekt. Identitätsdienst der Organisation unverändert.
- **App – Foto aufs Board:** Team → NEU ANLEGEN → „Foto aufs Board“: Kamera/Galerie, Board wählen (Favoriten und zuletzt
  geöffnete zuerst, Suche, offline die gespeicherte Liste), das Board öffnet nativ, das Foto landet an freier Stelle in
  der Mitte.
- **App – Warteschlange auf dem Gerät:** offene Ops je Board als Datei (`PendingStore`, `pending_<board>.json`, atomar
  geschrieben, 150 ms nach jeder Änderung, beim Pausieren und Verlassen); das nächste Öffnen zeigt sie sofort und sendet
  sie mit derselben `req` (älter als 48 h werden verworfen, Rückgängig/Wiederholen nicht gespeichert). Zurück fragt nicht
  mehr, ein Hinweis sagt „wird gesendet, sobald du das Board wieder öffnest“. Rückgängig/Wiederholen sitzen jetzt oben.
- **Tests:** Server +8 (`native-collab.test.ts`: Kommentar-Ops mit Web-Struktur, Rechte, Rückgängig, Prüfung, Reaktionen,
  Gelesen-Stand, Upload-Platzhalter, Posteingang Erwähnung/Zuweisung/Papierkorb/Fehler), gesamt 253 grün (nur das bekannte
  `security.test.ts` unter Windows). Web 322. App-Paket 179 (+32: `e3_model_test.dart`, `e3_editor_test.dart`, Golden
  `e3_overlays.png`, Golden „Alle Typen“ mit Kommentar-Pin neu) + 18 Live-Tests (5 neu in `native_e3_live_test.dart`:
  Verbinder beidseitig, Kommentare + Posteingang beidseitig, Reaktionen, Bild-Upload → Web lädt das Bild, Warteschlange
  über ein Verlassen hinweg; alle E1/E2-Live-Tests weiter grün). App 630 (+11 `stachel_e3_test.dart`).
- **Offen:** Gerätetest (Kamera-Rechte am Gerät, Stylus/Handballen, Verbinder mit echten Fingern, Benachrichtigung im
  Hintergrund mit echtem WorkManager-Lauf) – das Gerät war während E3 für die Android-Messung belegt. Beim Schreiben
  sind Aufzählungszeichen/Kästchen weiter nicht zu sehen (Listen bleiben erhalten). Pins lassen sich nicht ziehen
  (umhängen nur im Web). Reaktions-Chips erst ab 30 % Zoom.

### Mindmap-Parität (Stand 2026-11-02; Server live, App Branch `feat/stachel-mindmap` im App-Repo der Organisation)

Anlass: Göran am Handy (App 1.23.0): „Das mit den Mind Maps funktioniert noch nicht so wie im Internet.“ Bis dahin
konnte die App Knoten nur ansehen und wie Objekte verschieben/vergrößern/löschen – ohne Layout, Unterthemen,
Einklappen; Löschen ließ verwaiste Unterthemen stehen, Größe ziehen wurde vom nächsten Web-Layout überschrieben.

- **Architektur:** Die App schickt nur die Absicht (`{"op":"mind","do":"child"|"sibling"|"root"|"tree"|"text"|
  "collapse"|"remove"|"drop"|"layout"}`, Vertrag §8.6), der Server führt **den Mindmap-Code des Web** aus
  (`mindmap/ops.ts` samt Layout über `web-impl.ts` `WebMind`, Live-Stand innerhalb der Nachricht) – damit ist das
  Ergebnis per Konstruktion das des Browsers; andere Clients rechnen fremde Änderungen ohnehin nicht nach. Warum nicht
  in der App rechnen und `update` schicken: bei Gleichzeitigkeit würde die App auf veraltetem Stand Lagen überschreiben,
  und das Web bliebe die einzige Wahrheit für Layout-Regeln. Allgemeine Ops auf Knoten folgen auf dem Server den Regeln
  der Web-Laufzeit (Löschen mit Unterthemen, Wurzel verschieben/Duplikat/Text/Größe → Layout) – das hilft auch der
  installierten 1.23.0.
- **Textmaße:** Knotengrößen hängen an der Textbreite. Der Server misst wie Chromium: Zeichenbreiten +
  Unterschneidung je Paar + Ligaturen je Dreiergruppe der drei Mindmap-Schnitte (`tools/text-metrics.mts` →
  `server/src/native/text-metrics.json`, 176 KB; Abweichung zum Canvas < 0,01 px bei Alltagstext, nur Emoji weichen ab
  – je Betriebssystem ohnehin). Im Web dafür `editor/measureText.ts` (React-frei, `setTextMeasure`).
- **App:** sofortige Vorschau mit einem zeilengenauen Dart-Port von `ops.ts`/`layout.ts`/`style.ts` (JS-Rundung) und
  derselben Maß-Datei (`packages/stachel_board/lib/src/mindmap/`): `MindPlanner` rechnet das Server-Ergebnis vorab, die
  Op trägt es als Overlay bis zum Patch – kein Springen (live geprüft). Server ohne `mind`: die vorausberechneten Ops
  gehen als create/update. Bedienung: Knöpfe am Knoten wie im Web (+ an der Seite, Wurzel beidseitig, „−“, Zahl am
  eingeklappten Zweig, auch ohne Auswahl antippbar), Kontextleiste (Unterthema, Gleiche Ebene, Ein-/Ausklappen,
  Zweigfarben, Text bearbeiten, Löschen mit Rückfrage bei Unterthemen), Schreiben im Knoten (Klartext; Tastatur
  „weiter“ = Enter = gleiche Ebene; Leiste UNTERTHEMA/GLEICHE EBENE/FERTIG; neuer leer gelassener Knoten verschwindet),
  Ziehen = umhängen/einsortieren/Seite wechseln (eine Nachricht `update` + `drop`), Wurzel ziehen nimmt alles mit,
  Werkzeug MINDMAP (leer oder Vorlage „Sommerfest“), langes Drücken „Mindmap hier“, keine Größen-Griffe.
  Darstellung wie `structure.css`: Wurzel Pille Barlow Condensed 28, Hauptthema weiße Pille mit 2,5-px-Ring,
  Unterthema Unterstrich, Linien über den Objekten von Kante bzw. Unterstrich, Schatten, Platzhalter 40 %.
- **Web-Fix nebenbei:** eingeklappte Knoten auf der **linken** Seite zeigten im Web keine Zahl (nur die Wurzel sollte
  links keine haben) – behoben (`mindmap.tsx`), in App und Web gleich.
- **Tests:** Server `native-mind.test.ts` (9: Ergebnis = Web-Funktion auf eigenem Y.Doc für jede Aktion, Regeln für
  allgemeine Ops, IDs/Wiederholung, Rückgängig, Prüfung, Textmaße gegen Chromium-Messwerte); Root-E2E
  `e2e/tests/native-mind.spec.ts` (echter Browser + Native-Client: Browser-Mindmap kommt an, App-Ops erscheinen, das
  **eigene Layout des Browsers** (Canvas) ändert danach nichts, Tab im Browser am App-Knoten, Ziehen/Umhängen,
  Screenshot `docs/screenshots/native-mind-web.png`); Referenzfälle `docs/native_fixtures/web/mindmap.json`
  (24 Fälle, 48 Größen) → Dart `mind_web_reference_test.dart` (alles gleich); App-Paket `mind_editor_test.dart`
  (Knöpfe, Vorschau = Web-Rechnung, Schreiben/Enter/leer, Ziehen, Wurzel, Löschen, Duplikat, Werkzeug/Vorlage, ohne
  Feature, Golden `mindmap.png`), live `native_mind_live_test.dart` (Vorschau = Server-Ergebnis für jede Aktion,
  web-peer sieht dasselbe, Rückgängig, Mindmap aus dem Web); App `stachel_mindmap_test.dart` (Werkzeug, Kontext-/
  Schreibleiste, Rückfrage beim Löschen, langes Drücken, 360 dp).
- **Offen / am Gerät prüfen:** Knöpfe mit echten Fingern (Abstand 32 px), Tastatur „weiter“ auf Android/iOS,
  Pfeiltasten-Navigation entfällt am Handy. Merge mit `feat/stachel-e3` (beide ändern `board_editor.dart`,
  `board_view.dart`, Werkzeugleiste: MINDMAP gehört dort unter „MEHR“).

### E4 – volle Parität (Entscheidung Göran 2026-11-01)

„Die App soll sich allgemein so verhalten wie die Web-Version davon.“ Die frühere Regel „E4 nur nach Tester-Bedarf“
gilt nicht mehr: Ziel ist **volle Verhaltens-Parität**. Angepasst wird nur, was am Handy keinen Sinn ergibt
(Tastenkürzel → Menü-/Leisten-Einträge, Rechtsklick → langes Drücken, Hover → Info, Download → Teilen), und dann mit
gleichem Verhalten und Ergebnis. Was das Web berechnet (Layout, Vorlagen, Ausrichten, Struktur-Änderungen, Abstimmung,
Timer …), rechnet der Server mit dem Web-Code (Web-Aktionen, Op `act`), nicht die App nach.

Bestandsaufnahme (272 Verhaltensweisen, Stand App E2 + laufende E3/Mindmap), Datei-Zuständigkeiten und Wellen:
dem internen Paritäts-Audit (nicht veröffentlicht). Kurz: Fundament F1 (Server: Web-Aktionen, Schriftmaße, Anwesenheits-Felder,
Konstanten-Generator) und F2 (App: Register für Werkzeuge/Kontextleiste/Menüs, Gesten, Auswahl, `act`), danach
parallel P1 Auswahl & Anordnen, P2 Formen/Sticker/Icons, P3 Karten/Tabellen/Vorlagen, P4 Ansicht/Rahmen/Präsentation/
Suche, P6 Verwaltung/Versionen/Export, dann P5 Workshop, P7 PDF/Teilen-Ziel, P8 Rich-Text-Rest/Barrierefreiheit,
P9 Zeitleiste (≈ 46 PT). **F1 ist live (2026-11-02):** Op `act` mit Register `web/src/native/registry.ts`, Stubs aller
Pakete im Sammel-Import `web/src/native/actions.ts`, `welcome.actions`/`ack.results` (Vertrag §8.12), `presence.extra`
(§8.4), Schriftmaße aller Schnitte und Web-Konstanten `docs/native_fixtures/web/constants.json` (§8.13). Die App-Extras von früher bleiben drin („Als Aufgabe in der Org-App anlegen“, Offline-Schalter je
Board, Teilen-Ziel). Weiter nicht nativ: Konten-Modus `local` (Teilen, Konto, Registrierung), Mausrad-/Tastatur-
Eigenheiten.

---

## 6. Teststrategie

### 6.1 Unit-Tests (Dart, `packages/stachel_board/test/`)

Modell (Schnappschuss + Patches, Overlay/Ack/Nack, LWW, Resume), Protokoll-Codec (jede Nachricht hin und zurück),
Raster-Index, Hit-Test, Gesten-Automat (Ereignisfolgen → Aktionen, inkl. 300-ms-Halten und zweiter Finger),
PM-JSON ↔ Quill-Delta (Rundreise für jeden Knoten/Mark aus `RICH_TEXT_NODES`/`RICH_TEXT_MARKS`), Kamera-Mathematik.

### 6.2 Referenzwerte aus dem Web-Code (gegen Abweichungen)

`tools/native-fixtures.mts` führt die **echten** Web-Funktionen aus und schreibt JSON nach
`flutter/packages/stachel_board/test/fixtures/web/`: Formpfade aller Formen für mehrere Größen, Verbinder-
Routen (alle Stile, Seiten, Andock-Fälle), Auto-Schriftgrößen von Haftnotizen, Ebenen-Sortierung mit kaputten/
gleichen Schlüsseln, Rich-Text → Klartext. Die Dart-Tests vergleichen mit Toleranz. Ändert jemand die Web-Geometrie,
fällt die App-Abweichung beim nächsten Fixture-Lauf auf. Ein **Paritäts-Wächter** (Fixture `types.json` = alle im Web
registrierten Objekttypen und Formen) lässt einen Dart-Test scheitern, sobald ein Typ ohne nativen Renderer und ohne
Eintrag in `docs/native_paritaet.md` auftaucht.

### 6.3 Widget- und Golden-Tests

Board-Screen mit Fake-`BoardSource`: Gesten → gesendete Ops, Ack/Nack-Anzeigen, Offline-Banner, Fehlerseiten.
Golden-Bilder je Objekttyp und Detailstufe (Barlow per `FontLoader` geladen; Goldens nur unter Windows erzeugen und
prüfen, Tag `golden`). Zusätzlich ein **Sichtvergleich**: dasselbe Seed-Board als Web-Screenshot (Playwright,
Offline-Modus) und als Flutter-Golden nebeneinander in `docs/screenshots/native-*.png` – kein Pixelvergleich, aber Pflicht
zur Abnahme jeder Etappe.

### 6.4 Integration gegen den echten Server (Sandbox)

- Sandbox (geprüft 2026-11-01, läuft): `cd e2e && npm run build`, dann
  `server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8600` → `http://127.0.0.1:8600`, Logins `mara`/`jonas`/`lena`,
  Passwort `kaktus-123` (Passwort-Login liefert `a:mara`, Orga). Für die App braucht es das Org-Token aus dem
  Fake-Backend → Sandbox-Erweiterung §4.5.
- **Server-Tests** (`server/test/native-*.test.ts`): App-Client (ws) + Web-Client (`@hocuspocus/provider`) im selben
  Test: Op → Yjs-Stand → Patch, Validierung, Undo je Sitzung, Kaskaden, Presence-Brücke in beide Richtungen,
  Resume, Rechte (`view` im Modus local), Abmelden trennt.
- **Dart-Live-Tests** (`flutter test test/stachel/live_sandbox_test.dart --dart-define=STACHEL_BASE=http://127.0.0.1:8600`,
  ohne Gerät): echtes `NativeBoardSource` gegen die Sandbox; Gegenseite ist `tools/web-peer.mts` (Hocuspocus-Client,
  liest JSON-Befehle von stdin: anlegen, verschieben, tippen, erwarten). **Beide Richtungen:** Web legt an → App sieht;
  App verschiebt/tippt → Web sieht; beide ändern dasselbe Feld → beide landen beim selben Stand; App offline, Web
  ändert, App kommt zurück → Resume ohne Verlust.
- Schwere Läufe nicht auf dem Laptop, sondern auf einem Build-Server.

### 6.5 Gerätetest (Android, jede Etappe)

`integration_test/stachel_e2e_test.dart` auf dem Gerät gegen die Sandbox (`--dart-define=STACHEL_BASE=http://<PC-IP>:8600`)
plus Checkliste von Hand: fps im Profil-Build (Performance-Overlay) auf dem 2 000er-Board, alle Gesten aus §3.3,
Tastatur über Notizen, Kamera-Upload, Flugmodus an/aus, App-Link aus WhatsApp, Hintergrund/Vordergrund, Bildschirm
drehen. iOS: Testflight-Build durch einen Tester mit derselben Checkliste.

---

## 7. Risiken, offene Fragen, Aufwand

### 7.1 Risiken

| Risiko | Wahrscheinlichkeit / Wirkung | Gegenmittel |
|---|---|---|
| **Pflegeaufwand doppelt:** das Web wächst wöchentlich (Runden 4 und 5 in einer Woche), die App läuft hinterher | hoch / hoch | Server-Datenregeln nur einmal (Option b); Platzhalter für Unbekanntes; Paritäts-Wächter + `docs/native_paritaet.md`; seit 2026-11-01 volle Parität (E4) mit Web-Aktionen (Server rechnet mit Web-Code) und Konstanten-Generator |
| Darstellung weicht vom Web ab (Formen, Verbinder, Textgröße) | mittel / mittel | Referenzwerte aus dem Web-Code (§6.2), Sichtvergleich je Etappe |
| Leistung auf schwachen Androids mit vielen Bildern | mittel / hoch | Spike in E0, Detailstufen, Bildstufen, Picture-Cache |
| Gleichzeitiges Tippen in derselben Notiz | niedrig / mittel | Hinweis + Basis-Revision + Rebase (§4.6) |
| Server-Code-Wiederverwendung über Ordnergrenzen (`web/src` im Server) | mittel / niedrig | wie MCP bewährt; nur React-freie Dateien; Server-Typecheck in CI |
| Hocuspocus-Interna (DirectConnection, Awareness) ändern sich bei Updates | niedrig / mittel | Versionen exakt gepinnt, Presence-Brücke mit eigenem Test |

### 7.2 Offene Fragen an Göran (mit Empfehlung)

1. **Wie weit soll nativ gehen?** Volle Web-Parität bedeutet ~32 000 Zeilen Web-Editor ein zweites Mal.
   *Empfehlung:* E1–E3 fest zusagen („Handy-Stachel“: ansehen, festhalten, mitarbeiten), E4-Pakete nur nach
   Rückmeldung der Tester. Am Rechner bleibt das Web.
2. **Offline bearbeiten nötig?** *Empfehlung:* nein – offline lesen (Cache) + kurze Funklöcher überbrücken reicht für
   das Team. Wenn das Festivalgelände echtes Offline-Arbeiten verlangt, erst dann `yjs_dart` erneut prüfen (die App
   ist dafür über `BoardSource` vorbereitet).
3. **Einstieg:** *Empfehlung:* Pin-Symbol oben öffnet direkt die Board-Liste (QR-Login als Symbol dort), zusätzlich
   Kachel „Stachel“ unter Mehr. Kein Auswahl-Sheet mehr.
4. **Was passiert bis E2 mit dem Bearbeiten in der App?** *Empfehlung:* Branch `feat/stachel-qr-login` ohne WebView
   mergen und „Im Browser öffnen“ (System-Browser, automatisch angemeldet) als Notausgang anbieten – kein WebView, wie
   entschieden, aber niemand steht ohne Bearbeiten da.
5. **Benachrichtigungen bei @Erwähnung/Zuweisung:** über das Identitätsdienst der Organisation (Posteingang, Push – Backend-Änderung)
   oder App fragt Stachel im Hintergrund-Check? *Empfehlung:* App fragt Stachel (`/api/native/v1/inbox`); das
   Identitätsdienst der Organisation bleibt unverändert, wie im Stachel-Konzept festgelegt.

### 7.3 Aufwand (Personentage konzentrierte Arbeit, agentengestützt)

| Etappe | Server | App | Summe | Kalender bei Vollzeit |
|---|---|---|---|---|
| E0 Vorarbeit | 3–4 | 3–4 | 6–8 PT | ~1,5 Wochen |
| E1 Ansehen | 4–5 | 12–15 | 16–20 PT | ~3,5 Wochen |
| E2 Bearbeiten | 3–4 | 10–13 | 13–17 PT | ~3 Wochen |
| E3 Verbinden/Medien | 3–4 | 12–15 | 15–19 PT | ~3,5 Wochen |
| E4a–d Parität | 4–6 | 25–35 | 29–41 PT | 6–8 Wochen |
| **E0–E3** | | | **50–64 PT** | **~11 Wochen** |
| **mit E4** | | | **79–105 PT** | **17–19 Wochen** |

Größte Unsicherheiten: Leistung (E0-Spike), Rich-Text-Bearbeitung (E2), Verbinder-Bedienung am Handy (E3).

---

## 8. Selbstkritik (drei schwächste Stellen dieses Konzepts – und was geändert wurde)

1. **Schwäche: Jedes Öffnen hätte das ganze Board neu übertragen.** Ein 5 000-Objekte-Board sind mehrere MB JSON –
   im Festival-Funkloch unbrauchbar, und jedes Wiederverbinden nach einem Tunnel ebenso.
   *Geändert:* Rev/Epoche + Ringpuffer im Gateway (`mirror.ts`), `hello.resume` → `resumed` mit nur den fehlenden
   Patches; Schnappschuss nur, wenn der Puffer nicht reicht oder der Server neu gestartet ist (§4.2, §4.3), dazu
   `permessage-deflate` und Anzeige aus dem Cache, während geladen wird. Abnahme E1 prüft das Resume.

2. **Schwäche: Rich-Text-Konflikte waren mit „minimaler Diff“ schöngeredet.** `updateYFragment` macht das Fragment
   gleich dem Stand der App – hat jemand im Web in der Zwischenzeit in dieselbe Notiz getippt, würde der Diff dessen
   Eingabe wieder entfernen.
   *Geändert (§4.6):* jede `text`-Op trägt die Basis-Revision des Objekts; direkt angewandt wird nur ohne
   Zwischenänderung, sonst Rebase auf dem Server, bei echter Überlappung sichtbarer Hinweis statt stillem Verlust.
   Den Normalfall verhindert die Anwesenheit: schreibt jemand im Web in der Notiz (`richtext.caret`), öffnet die App
   sie nur lesend mit „Mara schreibt hier gerade“ – und umgekehrt.

3. **Schwäche: Die Wartungslast war als Risiko genannt, aber ohne Mechanismus.** Das Web bekommt fast wöchentlich neue
   Typen und Felder; ohne Wächter würde die App still falsch darstellen oder Felder „vergessen“.
   *Geändert:* Paritäts-Wächter-Test aus den Web-Fixtures (§6.2), Pflichtzeile in `docs/native_paritaet.md` bei
   jedem neuen Typ (§4.4), serverseitige Feld-Patches statt Objekt-Ersetzen (die App kann unbekannte Felder gar nicht
   löschen), Platzhalter + „Im Browser ansehen“ für Unbekanntes, und Frage 1 an Göran macht die Parität zur bewussten
   Entscheidung statt zum Automatismus.
