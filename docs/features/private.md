# Privater Modus und Präsentation (Sprechernotizen, Übergabe)

Modul `private` (`web/src/features/private/`, Server `server/src/private-mode.ts`) und Ergänzungen im Modul `structure`
(Rahmen/Präsentation). Gilt für Web, Apps (Native-API) und MCP.

## 1. Privater Modus – Verhalten

Vorbild ist das übliche Verhalten etablierter Whiteboards („verdeckt schreiben, gemeinsam aufdecken“):

- **Starten:** Wer das Board bearbeiten darf, startet ihn im Board-Menü („Privater Modus …“), wahlweise mit
  **„Namen anonym“** (Platzhalter und aufgedeckte Notizen ohne Autor) und **„Jede:r darf eigene aufdecken“**. Diese
  Person ist die **Moderation** (`by`).
- **Während er läuft:** Neue **Haftnotizen, Texte und Formen** (und Verbinder, die an einem privaten Objekt hängen)
  sieht nur, wer sie angelegt hat – auch Kopien, Duplikate und Eingefügtes dieser Typen. Die Person sieht sie normal
  (bearbeiten, verschieben, Farbe, Rückgängig) mit einem Schloss „Nur für dich“. **Alle anderen sehen an der Stelle einen
  grauen Platzhalter** in Größe und Lage des Objekts (mit Namen, außer anonym) – sie merken, dass geschrieben wird, aber
  nicht was. Ein Hinweisband zeigt „Privater Modus · Deine neuen Notizen sieht nur du · N verdeckt“.
  Was vorher schon auf dem Board stand, bleibt öffentlich; Bearbeitungen daran sind für alle sichtbar.
- **Aufdecken:** Die Moderation (oder die Besitzer:in des Boards; ist die Moderation nicht mehr auf dem Board, jede:r
  mit Bearbeiten-Recht) deckt auf – mit Countdown 3 s (sichtbar bei allen) oder sofort. Dann erscheinen alle
  verdeckten Objekte auf einmal an ihrer Stelle, der Modus endet. Mit „Jede:r darf eigene aufdecken“ kann jede Person
  ihre eigenen Objekte schon vorher aufdecken (der Modus läuft weiter).
- **Anonym:** aufgedeckte Objekte tragen kein `createdBy` (Autor-Anzeige leer), Platzhalter keinen Namen.
- Rückgängig nach dem Aufdecken nimmt das Aufdecken nicht zurück (Server-Schritt, wie Abstimmung/Timer).

## 2. Geheimhaltung – serverseitig, nicht nur in der Oberfläche

**Problem:** Yjs verteilt ein Dokument immer ganz – einzelne Teile eines Updates lassen sich nicht herausfiltern (die
Strukturen hängen über Vorgänger-IDs aneinander; fehlt etwas, bleibt beim Empfänger alles Folgende hängen).
Verschlüsseln bis zum Aufdecken taugt auch nicht: Rich-Text wird als CRDT live bearbeitet, Chiffretext ließe sich nicht
zusammenführen, und beim Aufdecken müsste ohnehin Klartext ins Dokument.

**Lösung: private Inhalte liegen gar nicht im Board-Dokument**, sondern je Person in einem **eigenen Yjs-Dokument
„Privat-Ablage“** auf dem Server:

| | Board-Dokument `board:<id>` | Privat-Ablage `private:<id>:<k>` |
|---|---|---|
| Wer verbindet | alle mit Zugriff | **nur die Person selbst** (`<k>` = base64url(UTF-8 user key); ihr KI-Token zählt als sie) |
| Inhalt | `objects` + Strukturen, dazu **`private.mode`**, **`private.hidden`** | `objects` (gleiches Format wie im Board) |
| Gespeichert | Tabelle `documents` | Tabelle `private_docs` (`board_id` mit `ON DELETE CASCADE`) |
| Versionen, Vorschaubild, Export anderer, MCP-Lesen, Native-Spiegel | ja | **nein** |

- Der Server liest jede Privat-Ablage und schreibt für die anderen nur **Platzhalter** ins Board-Dokument:
  `private.hidden` = `Y.Map` Objekt-ID → `{x, y, w, h, type, rotation?, by?, o}` (`by` = user key, fehlt bei anonym;
  `o` = undurchsichtiges Kürzel je Person und Board, HMAC – zählt „verdeckt je Person“, verrät niemanden). **Kein Text,
  keine Farbe, kein Rich-Text.**
- `private.mode` (`Y.Map`): `on` (bool), `by`, `byName`, `since` (ISO), `anonymous` (bool), `ownReveal` (bool),
  `revealAt` (ms Server-Uhr, solange der Countdown läuft).
- **Nur der Server schreibt** `private.mode` und `private.hidden`: Updates aus `/sync`, die eine der beiden Wurzeln
  berühren, verwirft er wie bei der Rolle „ansehen“ (`touchedRoots`, `server/src/sync.ts`). Platzhalter lassen sich so
  nicht fälschen, der Modus nicht am Server vorbei umschalten.
- **Aufdecken** (`server/src/private-mode.ts` `reveal`): Der Server öffnet alle Privat-Ablagen des Boards, kopiert jedes
  Objekt samt Y-Feldern (`Y.Map.clone()`, Rich-Text bleibt Rich-Text) mit gleicher ID ins Board-Dokument (bei anonym ohne
  `createdBy`), entfernt dann Platzhalter und Objekte aus der Ablage (erst Board, dann Ablage – kein Flackern).
- **Ohne laufenden Modus** bleibt nichts privat: kommt in eine Ablage etwas an (z. B. offline geschrieben und nach dem
  Aufdecken nachgereicht), deckt der Server es sofort auf.
- Board in den Papierkorb/gelöscht: Ablagen gehen mit (CASCADE); Konto löschen (`forget-person.ts`) löscht die Ablagen
  der Person; Datenexport der Person enthält ihre Ablagen.

**Warum das robust ist:** Fremde Clients bekommen private Inhalte nie über die Leitung – nicht im Web (Sync), nicht in
der App (Native-Spiegel kennt nur das Board-Dokument; eigene Objekte bekommt nur die eigene Verbindung), nicht im MCP.
Tests: `server/test/private-mode.test.ts` prüft auf Protokollebene (rohe Yjs-Updates einer zweiten Web-Verbindung und
alle JSON-Nachrichten einer zweiten Native-Verbindung), dass der Text bis zum Aufdecken nirgends vorkommt.

## 3. Web

- `BoardStore` (Kern, `web/src/board/store.ts`) kann eine **zweite Quelle** einhängen: `attachPrivate(doc)` und
  `setCreateRoute(fn)`. Schnappschuss = Board + Ablage (gleiche ID: Board gewinnt), Schreiben je Objekt in dessen
  Dokument (`mapOf(id)`, `docOf(id)`, `isPrivate(id)`), Rückgängig über beide (zwei UndoManager, der jüngste Schritt
  zuerst). Neue Objekte gehen in die Ablage, wenn `setCreateRoute` es sagt (`privateRoute` des Moduls).
- `SyncSession` verbindet die Ablage über denselben WebSocket (zweiter `HocuspocusProvider`), sobald `private.mode.on`
  gilt; die Sitzung bleibt bis zum Schließen.
- Modul `private`: Board-Menü „Privater Modus …“ (Dialog mit Optionen), Hinweisband mit Zähler und „Aufdecken“ bzw.
  „Meine aufdecken“, Countdown in der Mitte für alle, Platzhalter (Slot `world`), Schloss-Chip an eigenen privaten
  Objekten.
- Rich-Text schreibt über das Dokument des Objekts (`frag.doc`), nicht fest über das Board-Dokument.

## 4. REST (alle Clients: Web, Apps mit `sts_`, MCP mit API-Token + `X-Stachel: 1`)

`GET /api/boards/:id/private` → `{ok, state, mine}` (`mine` = Anzahl eigener verdeckter Objekte).
`POST /api/boards/:id/private` mit `X-Stachel: 1`, Rolle `edit`:

| `action` | weitere Felder | Wer | Fehler |
|---|---|---|---|
| `start` | `anonymous?`, `ownReveal?` (bool) | alle mit Bearbeiten | 409 `already_running` |
| `reveal` | `countdown?` 0–10 s (Standard 3) | Moderation, Besitzer:in, alle wenn Moderation weg | 409 `not_running`, 403 `not_facilitator` |
| `cancel` | – | wie `reveal` (Countdown abbrechen) | 409 `not_running` |
| `revealOwn` | – | jede:r, wenn `ownReveal` | 409 `not_running`, 403 `own_reveal_off` |

Antwort `{ok, state}` mit `state` = `private.mode` als JSON (`{on:false}` wenn aus).

## 5. Native-API (Vertrag §8, `features` enthält `"private"`)

- `ext` enthält `private.mode` und `private.hidden` wie jede Struktur (Schnappschuss/Patches).
- **Eigene private Objekte:** neue Server-Nachricht `{"t":"private","objects":[…Objekt-JSON §8.5, unten nach oben…]}` =
  die **ganze** eigene Ablage. Kommt nach `welcome`/`resumed`, bei jeder Änderung der Ablage (gedrosselt) und **vor dem
  `ack`** einer ops-Nachricht, die die Ablage geändert hat. Ältere Apps ignorieren unbekannte `t`.
- **Ops:** Solange `private.mode.on` gilt, legt `create` Objekte der Typen `sticky`, `text`, `shape` (und Verbinder an
  privaten Objekten) in der eigenen Ablage an. `update`, `remove`, `order`, `text` auf IDs der eigenen Ablage schreiben
  dorthin; `undo`/`redo` gehen über beides. Patches gibt es dafür nicht (nur `private`), `ack.rev` bleibt der Stand des
  Boards.
- Steuern über REST §4 (die App zeigt die Knöpfe wie das Web).

## 6. MCP

Werkzeug `private_mode` (`status` | `start` | `reveal` | `reveal_own` | `cancel`), `read_board` meldet den Modus und die
Zahl verdeckter Objekte. Der Assistent sieht wie jeder andere Client nur Platzhalter. Was er während des Modus anlegt, ist
öffentlich (er schreibt ins Board-Dokument) – das steht in der Werkzeug-Beschreibung.

## 7. Präsentation: Sprechernotizen und Übergabe

- **Sprechernotizen** je Rahmen: Feld **`notes`** (Klartext ≤ 20 000) am `frame`. Bearbeiten in der Rahmen-Liste
  (Notiz-Knopf je Rahmen) bzw. am Handy im Rahmen-Blatt. Beim Präsentieren sieht **nur die präsentierende Person** die
  Notizen des aktuellen Rahmens (aufklappbar über der Präsentationsleiste); Mitlesende sehen sie nicht.
- **Übergabe:** In der Präsentationsleiste „Übergeben an …“ → Liste der Anwesenden. Awareness
  `structure.handover` = `{to: <user key>, id: <≤16 Zeichen>, index, frameId}` (das Angebot; `null` = zurückgezogen).
  Bei der Person erscheint „Mara möchte dir die Präsentation übergeben – Übernehmen / Ablehnen“. Übernehmen = selbst ab
  diesem Rahmen präsentieren mit `structure.present.from` = `clientId` der bisherigen Person; diese beendet ihre
  Präsentation, sobald sie das sieht, und folgt der neuen. Wer der alten Person folgte, folgt automatisch der neuen.
  Ablehnen schließt nur den Hinweis.
- Native: `structure.present` darf `from` (ganze Zahl ≥ 0) tragen, `structure.handover` ist in `presenceExtra`.

## 8. Grenzen und Entscheidungen

- **Was verdeckt ist:** nur neu angelegte Haftnotizen, Texte, Formen (auch Kopien/Eingefügtes) und Verbinder an privaten
  Objekten. Bilder, Rahmen, Karten, Tabellen, Mindmaps, Stift bleiben öffentlich (Vorlagen mit Rahmen funktionieren so
  weiter). Bearbeiten vorhandener öffentlicher Objekte ist sichtbar.
- **Was andere trotzdem merken:** Lage, Größe, Typ und (außer anonym) die Person – wie bei üblichen Whiteboards „hier
  schreibt gerade jemand“. Auswahl und Schreibmarke der Person (Awareness) nennen nur Objekt-IDs, keinen Inhalt.
- **Rückgängig** nach dem Aufdecken nimmt das Aufdecken nicht zurück (Server-Schritt). Frühere eigene Schritte an den
  privaten Objekten haben dann keine Wirkung mehr (die Ablage ist leer) – das Objekt ist ab jetzt ein normales.
- **Versionen** sichern nur das Board-Dokument (also nie private Inhalte). Eine wiederhergestellte alte Version kann
  `private.mode` auf einen älteren Stand setzen; läuft der Modus danach nicht mehr, deckt der Server bei der nächsten
  Änderung einer Ablage deren Inhalt auf (nichts geht verloren).
- **Web, eine Kleinigkeit:** die automatische Breite von Text mit `autoWidth` nach reinen Format-Änderungen zieht das
  Rich-Text-Modul nur für Board-Objekte nach (`watchTextWidths` beobachtet das Board-Dokument); beim Tippen passt sie.
- **Ohne Server** (`?offline=1`, Versions-Vorschau) gibt es den Modus nicht (Board-Menü-Eintrag fehlt).
