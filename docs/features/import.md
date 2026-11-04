# Import aus Miro

Stachel übernimmt Boards aus Miro über die öffentliche REST-API v2 von Miro. Die Person stößt den Import selbst an,
nur für Boards, die ihr Zugang in Miro sehen darf. Es gibt keinen Hintergrundabgleich. „Miro“ ist eine Marke der
RealtimeBoard, Inc.; Stachel steht in keiner Verbindung zu Miro und nennt den Namen nur, um die Herkunft der Daten
anzugeben (kein Logo, keine Miro-Farben, kein „offiziell“/„Partner“).

Typen: `shared/import.ts`. Server: `server/src/import/` (Miro-spezifisch unter `import/miro/`). Web:
`web/src/features/import/`. Apps: `flutter/packages/stachel_client/lib/src/stachel_import*.dart`. MCP: Werkzeug
`import_miro_board`.

## 1. Zwei Wege

- **A) Persönliches Zugriffstoken** (immer, außer `STACHEL_IMPORT_MIRO_TOKEN=off`): Die Person legt in Miro eine eigene
  App an, installiert sie in ihrem Team und fügt das Token ein. Der Server prüft es sofort (`GET /v2/boards?limit=1`)
  und hält es **nur im Speicher** (Verbindung `conn`, 60 min, an die Person gebunden). Es kommt nie in die Datenbank
  oder ins Log und ist nach einem Neustart weg.
- **B) „Mit Miro verbinden“ (OAuth 2.0 Authorization Code mit PKCE S256 und `state`)**, nur wenn die Instanz eine
  eigene Miro-App hat (`MIRO_CLIENT_ID` und `MIRO_CLIENT_SECRET`). Scope nur `boards:read`. Das Access-Token bleibt im
  Speicher; gespeichert wird nur das **Refresh-Token**, verschlüsselt (AES-256-GCM, Schlüssel aus `STACHEL_TOKEN_KEY`,
  sonst aus `<DATA_DIR>/import-secret.key`; die Person (`user_key`) ist als zusätzliche Authentisierung gebunden, eine
  Zeile lässt sich keiner anderen Person unterschieben). „Verbindung trennen“ widerruft das Token bei Miro und löscht
  die Zeile; Konto löschen ebenso; nach 60 Tagen ohne Nutzung löscht der Server die Zeile (Miro lässt Refresh-Tokens
  nach 60 Tagen verfallen).

## 2. Endpunkte (alle mit Sitzung: Web-Cookie, App-Bearer `sts_…` oder API-Token `stk_…`; schreibend mit `X-Stachel: 1`)

| Methode + Pfad | Antwort |
|---|---|
| `GET /api/import/sources` | `ImportSources` – was die Instanz anbietet, ob die Person verbunden ist |
| `POST /api/import/miro/token` `{token}` | `{ok, conn, expiresAt}`; 400 `miro_token_invalid` (Miro lehnt ab), 403 `import_disabled`, 502 `miro_unavailable` |
| `POST /api/import/miro/oauth/start` `{client?: "web" \| "app"}` | `{ok, url}` – Miro-Freigabeseite; `state` (32 Byte Zufall, 10 min, einmalig) und PKCE-Verifier bleiben im Server. 404 `oauth_disabled` ohne Miro-App |
| `GET /api/import/miro/callback?code&state` (ohne Sitzungspflicht) | Miro leitet hierher. Gehört die Browser-Sitzung (Cookie) zur Person aus `state`: Code tauschen, Refresh-Token speichern, 302 zur Web-App `<STACHEL_BASE_PATH>/?import=miro`. Sonst (z. B. System-Browser der App) eine Bestätigungsseite „Miro-Zugang mit dem Stachel-Konto … verbinden?“ (Schutz davor, dass jemand einer anderen Person seinen Freigabe-Link unterschiebt); `POST /api/import/miro/callback` `{state, nonce}` (Formular, ohne `X-Stachel`, `nonce` nur auf dieser Seite) schließt ab und zeigt „Fertig – du kannst zur App zurückkehren“. Fehler (`error=access_denied`, abgelaufener `state`) → Web-App mit `?import=miro&error=<code>` bzw. Fehlerseite |
| `DELETE /api/import/miro/oauth` | Verbindung trennen (Widerruf bei Miro, Zeile löschen) → `{ok}` |
| `GET /api/import/miro/boards?conn=&query=&offset=` | `ImportRemoteBoards` (50 je Seite); 401 `miro_conn_expired` (Verbindung abgelaufen/unbekannt → neu verbinden) |
| `POST /api/import/miro/jobs` `{conn, boards: string[] (1–10), options?: ImportOptions}` | 202 `{ok, jobs: ImportJob[]}`; 403 `board_limit`, 429 `import_limit` (zu viele Importe heute) |
| `GET /api/import/jobs` | `{ok, jobs: ImportJob[]}` (eigene, 7 Tage, neueste zuerst) |
| `GET /api/import/jobs/:id` | `{ok, job: ImportJob}` (nur eigene, sonst 404) |
| `DELETE /api/import/jobs/:id` | abbrechen (`canceled`); ein halb gebautes Board gibt es nicht (das Board entsteht erst am Ende in einem Schritt) |

Fortschritt fragen Web und App alle `IMPORT_POLL_MS` (1,5 s) ab. Fehlertexte sind deutsch und nennen Ursache und
nächsten Schritt (`message` wie überall, `sendError`).

## 3. Ablauf eines Imports (Job)

1. **read:** Board-Angaben, `/items` (alle Typen, Cursor-Seiten zu 50), `/connectors`, `/tags` und die Tags je
   Notiz/Karte, `/groups`, Mindmap-Knoten (`/v2-experimental/…/mindmap_nodes`; Fehler → überspringen + Bericht),
   Formen mit unbekanntem `shape` einzeln über `/v2-experimental/…/shapes/{id}`. `done/total` = gelesene Seiten.
2. **images:** Bilder (`format=original`) und Dokumente (PDF) laden: erst die API-Adresse mit Token
   (`redirect=false` → JSON `{url}`), dann die signierte Datei-Adresse **ohne** Token. SSRF-Schutz: nur `https:`,
   Host aus der Liste der Miro-Hosts (`MIRO_FILE_HOSTS` in `server/src/import/assets.ts`: `api.miro.com`, `miro.com`,
   `*.miro.com`, `*.miro.app`, `*.miroassets.com`, `*.mirostatic.com`; erweiterbar über `STACHEL_IMPORT_MIRO_HOSTS`;
   `miro.medium.com` gehört zu Medium und steht bewusst nicht darin), keine privaten/Loopback/Link-local/CGNAT/ULA-
   Adressen (DNS aufgelöst, **alle** Antworten geprüft, verbunden wird genau mit der geprüften Adresse), höchstens 3
   Weiterleitungen (jede neu geprüft), eine abgelaufene signierte Adresse (403) wird einmal neu geholt, Größe ≤ `STACHEL_UPLOAD_MAX_MB` (Abbruch
   beim Lesen), Zeitlimit 30 s. Danach dieselben Prüfungen wie ein Upload: Magic Bytes (`sniffImage`/`sniffPdf`),
   Pixel-Grenzen, Metadaten weg (`image-clean.ts`), Speicherquote der Person (`UploadLimits.fits`). Über der Quote
   oder kaputt → graues Rechteck „Bild nicht übernommen“ + Bericht. SVG/HEIC/TIFF/AVIF, die `sharp` lesen kann, werden
   als PNG übernommen (Bericht `image_converted`). 4 Downloads gleichzeitig. PDFs bekommen nur `docFile`; Seitenzahl und
   Seitenbilder erzeugt wie bei jedem PDF der erste Browser bzw. die erste App („Nachladen“, documents.md).
3. **build:** Das Board entsteht in **einem** Schritt: Yjs-Dokument mit dem Web-Store des Servers (`#stachel-web`,
   wie `NativeWriter`) aufbauen (Mindmaps über `mind.tree`), dann Board-Zeile, Dokument und Bild-Zeilen in einer
   Transaktion. Danach `created`-Ereignis und benannte Version „Import aus Miro (TT.MM.JJJJ)“ (scheitert sie, bleibt das
   Board). Abbruch vor diesem Schritt löscht schon geladene Dateien.

`sourceName` ist bis zum Ende von **read** leer (die Board-Liste des Clients kennt den Namen schon). Nach einem
Neustart des Servers sind wartende und laufende Aufträge `failed` („Bitte erneut verbinden …“), weil der Zugang zu Miro
nur im Speicher lag. Rückruf: Bei `client: "app"` und passender Sitzung im selben Browser zeigt der Server direkt die
Fertig-Seite statt zur Web-App zu leiten; ein unbekannter/abgelaufener `state` leitet mit Sitzung zur Web-App
(`error=state_expired`), sonst Fehlerseite. Fehlercodes in `?error=`: `access_denied`, `state_expired`, `oauth_failed`,
`miro_unavailable`.

Grenzen: je Person 1 laufender Import, je Instanz `STACHEL_IMPORT_CONCURRENCY` (2); `STACHEL_IMPORTS_PER_DAY` (20)
Boards je Person und Tag; `STACHEL_IMPORT_MAX_OBJECTS` (20 000) Objekte und `STACHEL_IMPORT_MAX_IMAGES` (1 000)
Bilder je Board, der Rest kommt in den Bericht. Board-Zahl zählt gegen `STACHEL_MAX_BOARDS_PER_USER`.

**Ratenlimits von Miro:** Der Client liest `X-RateLimit-Remaining/-Reset`, wartet bei knappem Rest vorab und bei `429`
mit exponentiellem Backoff (1, 2, 4 … 60 s bzw. `Retry-After`, höchstens 6 Versuche); `5xx` ebenso. `401` → Job
`failed` „Die Verbindung zu Miro ist abgelaufen …“.

## 4. Abbildung (Kurzfassung; Einzelheiten und Begründungen in `server/src/import/miro/map.ts`)

| Miro | Stachel | Treue |
|---|---|---|
| `sticky_note` | `sticky` (Rich-Text, `align`/`valign`, Tags) | Farbe: **nächste Farbe der aktuellen Notizpalette** (`STICKY_COLORS`, Abstand im Lab-Raum, berechnet – wächst die Palette, passt es automatisch besser) bzw. Originalfarbe mit Option `keepColors` |
| `shape` (21 Formen + Flussdiagramm) | `shape` (Füllung, Rand, Strich-Art, Schriftgröße, Textfarbe, Ausrichtung) | exakt bis ähnlich, unbekannt → `rect` + Bericht |
| `text` | `text` (Schriftgröße, Farbe, Ausrichtung); Hintergrundfüllung → Form ohne Rand dahinter | exakt bis ähnlich |
| `card`, `app_card` | `card` (Titel, Beschreibung, Fälligkeit, Farbe, Tags; App-Karten-Felder als Zeilen) | ähnlich, Zuständige nicht (Personendaten) |
| `frame` | `frame` (Titel, Farbe); Kinder aus `parent_top_left` in absolute Lage | exakt |
| `image` | `image` (Original geladen, Upload-Prüfungen) | exakt |
| `document` (PDF) | `document` | exakt; andere Dateitypen → Bericht |
| `embed`, `preview` | `text` mit Link (nur `https:`) | ähnlich |
| `connector` | `connector` (Enden, Seiten, Linienart, Spitzen, Farbe, Strich, Beschriftung) | exakt bis ähnlich |
| Gruppen | gleiche `groupId` | exakt |
| Mindmap-Knoten | `mindnode` (Stachel ordnet neu an) | ähnlich |
| Tabellen, Kommentare, Freihand, Kanban, Zeitleisten, Abstimmungen … | – | liefert die Miro-API nicht → fester Hinweis im Bericht |

z-Reihenfolge: Rahmen unten, dann in der Reihenfolge, in der `/items` sie liefert (Miro liefert sie in Ebenenfolge),
Verbinder oben. Lage: Miro gibt die Mitte an (`x = cx − w/2`), 1 Miro-Einheit = 1 Stachel-Einheit.

## 5. Konfiguration (`.env`, auch `docs/selfhosting.md`)

```
STACHEL_IMPORT=on                 # off = Import ganz aus
STACHEL_IMPORT_MIRO_TOKEN=on      # off = kein Einfügen persönlicher Tokens
MIRO_CLIENT_ID=                   # beide gesetzt = „Mit Miro verbinden“
MIRO_CLIENT_SECRET=
MIRO_REDIRECT_URI=                # Vorgabe <PUBLIC_URL>/api/import/miro/callback (genau so in der Miro-App eintragen)
STACHEL_IMPORT_CONCURRENCY=2
STACHEL_IMPORTS_PER_DAY=20
STACHEL_IMPORT_MAX_OBJECTS=20000
STACHEL_IMPORT_MAX_IMAGES=1000
STACHEL_IMPORT_MIRO_HOSTS=        # zusätzliche erlaubte Datei-Hosts (kommagetrennt, `*.` erlaubt)
# nur Tests/Entwicklung (Fake-Miro): REST-API bzw. Freigabeseite unter dieser Adresse; genau deren Host ist dann
# auch über http und auf lokalen Adressen erlaubt
STACHEL_IMPORT_MIRO_API_BASE=
STACHEL_IMPORT_MIRO_AUTH_BASE=
```

Server: `config.import` (`loadImportConfig` in `server/src/config.ts`).

Eigene Miro-App einrichten: `docs/selfhosting.md` Abschnitt „Import aus Miro“.

## 6. Daten

- Tabelle `import_jobs` (id, user_key, source, source_board, source_name, board_id, status, phase, report JSON,
  error, Zeiten): Bericht für die Person, 7 Tage sichtbar, nach 30 Tagen gelöscht; mit dem Konto gelöscht, in „Meine
  Daten“ enthalten.
- Tabelle `import_links` (user_key, provider, refresh_token verschlüsselt, created_at, used_at): nur Weg B. Immer
  verschlüsselt (`imp1:`-Format, AES-256-GCM, AAD = Anbieter + `user_key`), Schlüssel per HKDF-SHA256 aus
  `STACHEL_TOKEN_KEY`, ohne ihn aus `<DATA_DIR>/import-secret.key` (beim ersten Start erzeugt, Rechte 0600; mit dem
  Datenordner sichern). Wechselt der Schlüssel, sind gespeicherte Verbindungen unlesbar und werden verworfen (neu
  verbinden). Access-Tokens nur im Speicher bis zum Ablauf; Miro rotiert das Refresh-Token bei jedem Erneuern.
- Persönliche Tokens (Weg A) und OAuth-`state` (mit PKCE-Verifier, Person, Client, Sitzungs-Hash, ggf. Code bis zur
  Bestätigung) nur im Speicher.
- Logs: nur Job-ID, Zahlen, Fehlerklassen – keine Inhalte, Tokens, Codes oder signierten Adressen.
- Aus Miro werden **keine Personendaten** übernommen (keine Ersteller, Zuständigen, Mitglieder).

## 7. Testen

- Server-Tests (`server/test/import-*.test.ts`): Client (Seiten, Ratenlimit, Backoff mit falscher Uhr, 401), OAuth
  (state, PKCE, Rückruf mit/ohne passende Sitzung, Bestätigungsseite, nonce, CSRF-Ausnahme), Verbindungen
  (verschlüsselt, AAD, Widerruf, Konto löschen), SSRF (fremder Host, private Adresse, Weiterleitung, Größe, Typ), Aufträge
  Ende zu Ende gegen den Fake (Board mit Objekten, Version, Bericht, Abbruch, Grenzen, Neustart, Token nie im Log), dazu
  `import-miro-*.test.ts` für die Abbildung.
- **Fake-Miro** `server/test/fake-miro.ts` (Klasse `FakeMiro`): REST-API v2 lesend, `redirect=false` → `{url}` auf
  sich selbst (`/files/…?sig=ok`, ohne Token), `/oauth/authorize` (leitet sofort mit Code zurück; `deny` = Ablehnen),
  `/v1/oauth/token` mit PKCE-Prüfung und rotierendem Refresh-Token, `/v2/oauth/revoke`, Fehler (`fail(re, status)`),
  Verzögerung (`delayMs`), Mitschnitt (`requests`). Boards aus `server/test/fixtures/miro/<board>/` (Format dort im
  README) und aus dem Code.
- **Für Hand-, E2E- und App-Tests** als eigener Prozess: `server/node_modules/.bin/tsx tools/miro-fake.mts 8791`
  (Token `fake-token`, OAuth-App `fake-client`/`fake-secret`, Fixture-Boards + Beispiel-Board `demo1` mit Bild und PDF).
  Stachel dazu mit `STACHEL_IMPORT_MIRO_API_BASE=http://127.0.0.1:8791` und `STACHEL_IMPORT_MIRO_AUTH_BASE=http://127.0.0.1:8791`
  (für „Mit Miro verbinden“ zusätzlich `MIRO_CLIENT_ID=fake-client`, `MIRO_CLIENT_SECRET=fake-secret`) starten, z. B. in
  der Sandbox (`tools/sandbox.mts`, Env vorher setzen).
- **Gegen das echte Miro:** Sandbox mit `MIRO_CLIENT_ID`/`MIRO_CLIENT_SECRET` einer eigenen Miro-App (Redirect
  `http://localhost:<port>/api/import/miro/callback`) bzw. ein persönliches Token über `POST /api/import/miro/token`.
