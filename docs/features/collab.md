# Vertrag: Feature-Modul „collab“

Gehört dem Modul `web/src/features/collab/` (Zusammenarbeit auf dem Board). Siehe docs/contract.md §4/§5.
**Keine neuen Objektfelder oder -typen** – alles liegt in eigenen Y-Strukturen neben `objects`. Fehlt eine Struktur
(altes Board), gilt sie als leer. Kaputte/fremde Einträge werden beim Lesen übersprungen, nicht gelöscht.

## Funktionen

| Funktion | Bedienung |
|---|---|
| Kommentare | Werkzeug „Kommentar“ (Taste **C**), Rechtsklick „Kommentieren“ / „Hier kommentieren“. An ein Objekt geheftet (Pin wandert mit) oder frei auf dem Board; Pin ziehen = umhängen. Thread mit Antworten, Bearbeiten, Löschen, **@Erwähnung** (Vorschläge mit Pfeiltasten, Enter/Tab; danach sendet das nächste Enter; Esc schließt erst die Vorschläge, dann den Entwurf), „erledigt“ (Antwort öffnet wieder). Rückgängig je Aktion. Löscht jemand den Thread, während ich antworte: Hinweis, mein Entwurf bleibt als neuer Kommentar an derselben Stelle offen und liegt in der Zwischenablage. |
| Kommentar-Panel | Knopf oben rechts mit Zähler (offene Threads; pink `@` bei ungelesener Erwähnung), Filter Offen/Erledigt/Alle mit Zahlen, Pins ein/aus (auch Board-Menü). |
| „Du wurdest erwähnt“ | Hinweis oben mittig, sobald ungelesene Erwähnungen da sind – auch beim nächsten Öffnen des Boards (Gelesen-Stand im Dokument). „Ansehen“ springt zum Thread. |
| Reaktionen | Kontextleiste „Reagieren“ (Emoji-Auswahl, auch für mehrere Objekte). Chips unter dem Objekt mit Zahl, Namen beim Überfahren; Klick schaltet die eigene Reaktion um. |
| Abstimmung | Knopf oben rechts bzw. Board-Menü: Titel, Stimmen pro Person, Dauer (1–10 Min. oder ohne), mehrere Stimmen je Objekt. Klick auf Objekte stimmt ab, Rechtsklick/− nimmt zurück. **Anonym** (keine Namen im Dokument und im Ergebnis); sonst zeigt das Ergebnis die Namen je Objekt. Ende per Zeit oder „Beenden“ (startende Person; ist sie nicht mehr auf dem Board, übernimmt jede:r Anwesende Beenden/Schließen) → Ergebnis mit Rangfolge (gleiche Stimmen = gleicher Platz), Zahlen an den Objekten, Archiv „Frühere Abstimmungen“ (max. 20). |
| Timer | Knopf oben rechts (Restzeit + Fortschritt für alle), Voreinstellungen 1–30 Min., ±1 Min., Pause/Weiter, +1/+5 Min., Ende mit Ton (3 Töne, Web Audio, je Browser stumm schaltbar) und Hinweis „Zeit ist um!“. Am Handy/in der Präsentation als Chip oben mittig. |
| Anwesenheit | Avatare oben rechts mit Status-Punkt (aktiv / inaktiv nach 2 Min. ohne Eingabe oder Tab im Hintergrund / „gleich zurück“). Liste: Status setzen, hinspringen, folgen, wer wem folgt. |
| Folgen | Klick auf einen Avatar springt hin und folgt dem Ausschnitt (farbiger Rahmen, Leiste „Du folgst …“). Eigene Geste, Mausrad, Pfeiltasten oder Esc beenden. Geführte Person sieht „… folgt dir“. Kurze Aussetzer (WLAN, Server-Neustart) überstehen das Folgen: bis 12 s „Verbindung zu … kurz weg“, danach (nur bei eigener Verbindung) „… ist nicht mehr auf dem Board – Folgen beendet“. |
| Alle zu mir holen | Board-Menü bzw. Anwesenden-Liste: alle anderen springen auf meinen Ausschnitt (Hinweis „… hat dich zu sich geholt“). |
| Laserpointer | Werkzeug „Laserpointer“: Spur verblasst nach 0,9 s, die anderen sehen sie (auch in der Präsentation); der Name steht am Mauszeiger, nicht doppelt am Laser. |
| Autor einer Notiz | Maus 0,6 s über einer Haftnotiz: unten rechts „von Mara“ bzw. „von dir“ (nicht bei Touch, Ziehen, Bearbeiten). |
| Autor:in an allen Notizen | Board-Einstellung „Autor:in an Haftnotizen zeigen“ (`tools.settings.authors`, für alle): an jeder Haftnotiz im Bild klein unten links der echte Name (auch der eigene), ab 60 px Notizbreite, nicht beim Präsentieren und nicht an der Notiz, in der gerade geschrieben wird (Slot `collab.authors`, `authorLabels.ts`); das „von …“ beim Überfahren entfällt dann. |
| Uploads der anderen | Lädt jemand ein Bild hoch, sehen alle sofort einen Platzhalter „Mara lädt hoch …“ (Awareness `collab.uploads`). |
| Cursor-Chat | Taste **/** öffnet ein Feld am eigenen Mauszeiger; die anderen sehen den Text live (mit Tipp-Punkten) in der eigenen Farbe am Zeiger. Enter: bleibt 5 s stehen, Esc: verwerfen. Nicht gespeichert. |

## Y-Strukturen

| Name | Typ | Rückgängig | Inhalt |
|---|---|---|---|
| `collab.comments` | `Y.Map<threadId, Y.Map>` | ja | Thread: `x`, `y` (Weltposition, bei Objekt-Kommentar Rückfall), optional `objectId` + `dx`, `dy` (Abstand zur linken oberen Ecke, auf die Größe begrenzt), `resolved` (bool), `resolvedBy` (userKey), `createdBy`, `createdAt` (ISO), `messages`: `Y.Array<{id, by (userKey), name, text, at (ISO), mentions?: userKey[], edited?: ISO}>`. Erste Nachricht löschen = Thread löschen. |
| `collab.reactions` | `Y.Map<"objectId\|emoji\|userKey", {o, e, u, n, at}>` | ja | eine Reaktion je Objekt, Emoji und Person (`n` = Name, `at` = ISO). Reaktionen gelöschter Objekte werden nicht angezeigt. |
| `collab.vote` | `Y.Map`, Schlüssel `session` | nein | `{id, title, perPerson, multi, endsAt (ms\|null), startedBy, startedByName, startedAt (ms), ended, anonymous?}`; fehlt = keine Abstimmung. |
| `collab.votes` | `Y.Map<"sessionId\|voter\|objectId", {n, name?}>` | nein | Stimmen der laufenden/beendeten Sitzung; beim Start/Schließen geleert. `voter` = userKey, bei `anonymous` `anon-<Prüfsumme aus sessionId und userKey>` ohne `name` (anonym in der Oberfläche; wer alle userKeys kennt, kann zurückrechnen). |
| `collab.voteHistory` | `Y.Array<{id, title, at (ISO), voters, total, ranking: {objectId, votes, rank}[]}>` | nein | neueste zuerst, höchstens 20; nur Abstimmungen mit Stimmen. |
| `collab.timer` | `Y.Map`, Schlüssel `timer` | nein | `{state: 'idle'\|'running'\|'paused', endsAt (ms), remaining (ms), duration (ms), by (Name), run (Zähler je Start)}`. |
| `collab.reads` | `Y.Map<userKey, ISO>` | nein | Gelesen-Stand der Erwähnungen je Person („Du wurdest erwähnt“ beim nächsten Öffnen). |

Zeiten in ms beziehen sich auf die Uhr des Clients (leichte Abweichungen zwischen Geräten sind hinnehmbar).

## Awareness-Felder (flüchtig)

| Feld | Wert |
|---|---|
| `collab.follow` | userKey der Person, der ich folge, oder `null` |
| `collab.viewport` | `{x, y, w, h}` mein Weltausschnitt – nur solange mir jemand folgt, sonst `null` |
| `collab.summon` | `{id, rect: {x, y, w, h}, ts}` „Alle zu mir holen“; neue `id` = neuer Aufruf, beim ersten Sehen nur frisch (< 8 s) |
| `collab.laser` | `{s, p: [x, y, …], g?: number[]}` – `s` Nummer des letzten Punkts, `p` die letzten ≤ 24 Punkte, `g` Nummern, die einen neuen Strich beginnen; `null` nach dem Verblassen |
| `collab.status` | `'active' \| 'idle' \| 'away'` |
| `collab.chat` | Cursor-Chat: `{text, typing?}` am eigenen Mauszeiger (Taste `/`); `typing` solange getippt wird, nach Enter 5 s stehen, dann `null` |
| `collab.uploads` | laufende Bild-Uploads `[{x, y, w, h, color}]` (Weltkoordinaten, höchstens 10 werden gezeigt) oder `null`; setzt der Editor |

## Server

`GET /api/users` (docs/contract.md §3): alle, die sich je angemeldet haben – Vorschläge für @Erwähnungen, ergänzt um
Anwesende und Kommentar-Autor:innen. Offline (`?offline=1`) wird die Liste nicht geladen.

Die Apps (nativ, docs/contract.md §8.6/§8.11) schreiben Kommentare, Reaktionen und `collab.reads` über eigene Ops
mit diesem Code (`comments.ts`/`reactions.ts`, feste IDs der App), melden Uploads als `collab.uploads`; der Server legt
neue Erwähnungen und Karten-Zuweisungen für den Hintergrund-Check der App in der Tabelle `mentions` ab.

## Native-Aktionen (App, docs/contract.md §8.12)

`web/src/features/collab/native.ts` (Paket P5), Test `server/test/native-act-collab.test.ts`. Gleicher Code wie die
Web-Oberfläche (`voting.ts`, `timer.ts`, `comments.ts`); jedes Ergebnis trägt `data.now` (Server-Zeit in ms), damit die
App Restzeiten von Timer und Abstimmung mit der Uhr des Servers rechnet.

| Aktion | `args` | Undo | Ergebnis |
|---|---|---|---|
| `collab.vote.start` | `{title ≤ 80, perPerson 1–20, minutes: 1\|3\|5\|10\|null, multi, anonymous}` | `none` | `select: []`, `data.id`; läuft schon eine: `skipped` + Hinweis |
| `collab.vote.cast` | `{objectId, delta: 1\|-1}` | `none` | `data.outcome` `added`/`removed`/`none-left`/`not-running` (+ Web-Hinweis bei `none-left`); Verbinder/Stift/Rahmen/fehlend: `skipped` |
| `collab.vote.end` | `{}` | `none` | wie `endVote` (Beenden bzw. Ablauf – jeder Client) |
| `collab.vote.close` | `{}` | `none` | wie `closeVote` (Archiv, gelöschte Objekte zählen nicht) |
| `collab.timer.start` / `.add` | `{ms 1000–10 800 000}` | `none` | `data` = Timer danach (`by` = Name der Person) |
| `collab.timer.pause` / `.resume` / `.stop` | `{}` | `none` | `data` = Timer danach |
| `collab.commentMove` | `{thread, x, y, objectId?}` | `undo` | Pin gezogen: `moveThread(anchorAt(p, Objekt))`, Abstand zur Ecke aus dem Server-Stand; fehlender Thread: `skipped` |

Wer eine Abstimmung beenden/schließen darf (Startende bzw. alle, wenn sie weg ist), entscheidet wie im Web die
Oberfläche. Die Awareness-Felder setzt die App über `presence.extra` (`server/src/native/presence.ts`, `collab.laser`
mit `g`).

## Ersetzte Kern-Einträge

- Slot `core.presence` (Anwesenheit oben rechts): `EditorPage` zeigt die Kern-Anzeige nur, wenn er fehlt.
