# Stachel – Vertrag (Server ↔ Web ↔ Apps)

Verbindlich für `server/`, `web/`, die Stachel-App und die App einer angebundenen Organisation (Modus `org`, §1). Änderungen hier zuerst, dann im Code.
Typen dazu: `shared/protocol.ts`.

## 0. Grundsätze

- Alles läuft unter **einem Origin** (`https://board.example.org`): HTTP-API unter `/api/*`,
  WebSocket unter `/sync` (Web) bzw. `/native/v1` (Apps, §8), Web-App unter `/` (Boards über `/?b=<id>`; andere Pfade ohne Punkt → 404-Seite im
  Stachel-Look mit Link zur Übersicht, nicht stillschweigend die Übersicht). Dev: Vite (5173) proxyt `/api` und `/sync` auf den Server (8095).
- JSON überall, Fehler immer `{ "ok": false, "error": "<code>", "message": "<deutscher Text für Menschen>" }`
  mit passendem HTTP-Status. Erfolg: `{ "ok": true, ... }`.
- Zeitstempel: ISO-8601 UTC **mit `Z`**.
- Server-Konfiguration per Env: `PORT` (8095), `PUBLIC_URL` (`https://board.example.org`), `STACHEL_AUTH` (`local` |
  `org`, §6), im Modus `org` die `STACHEL_ORG_*`-Werte (§1), `DATA_DIR` (`./data`), `COOKIE_SECURE` (`true` in Prod).

## 1. Sitzung

- Cookie **`stachel_session`**: zufällig (32 Byte, base64url), `HttpOnly`, `SameSite=Lax`, `Secure` wenn
  `COOKIE_SECURE`, `Path=/`, 30 Tage. Server speichert Sitzungen in SQLite (`sessions`): `id`, `user_key`,
  `name`, `is_orga`, `org_token`, `created_at`, `verified_at`, `expires_at`.
- **`org_token` verschlüsselt** (in `sessions`, `api_tokens`, `pairings`, `app_codes`): AES-256-GCM mit dem Schlüssel
  aus Env **`STACHEL_TOKEN_KEY`** (32 Byte, z. B. `openssl rand -base64 32`; in der `.env` der Instanz), gespeichert
  als `enc1:<base64url(iv|tag|ciphertext)>` (`server/src/token-crypt.ts`). Beim Start werden Klartext-Zeilen von früher
  verschlüsselt. Ohne Schlüssel Klartext (Tests/Dev; Modus org warnt im Log). Schlüssel weg/falsch → Nachprüfung
  scheitert, die Sitzungen enden (neu anmelden).
  Die Spalte hieß bis 11/2026 nach dem ersten Betreiber; der Server benennt sie beim Start um (Daten bleiben).
  Modus local: `local:<konto-id>` statt eines Tokens.
- `user_key`: Modus org = `id` aus dem Identitätsdienst (s. u., z. B. `m:12`), Modus local `u:<konto-id>`.
- **Nachprüfen:** ist `verified_at` älter als 6 h, prüft der Server bei `/api/auth/me` und beim WebSocket-Connect
  den gespeicherten `org_token` erneut beim Identitätsdienst (s. u.). `invalid`/`forbidden`/`pending` → Sitzung löschen
  (Nutzer ist abgemeldet). Netzfehler/5xx → Sitzung bleibt gültig (Ausfall des Identitätsdienstes sperrt niemanden aus).
- Zustandsändernde Requests (`POST/PATCH/DELETE` unter `/api`) außer `/api/auth/qr/approve`, `/api/auth/app-code` und `POST /api/auth/app-session` müssen den Header
  `X-Stachel: 1` tragen (einfacher CSRF-Schutz zusätzlich zu SameSite).

### Org-Token prüfen (Modus `org`, Server intern) – Vertrag mit dem Identitätsdienst der Organisation

Im Modus `org` meldet sich niemand bei Stachel selbst an: Eine externe Organisation (Verein, Firma, Veranstaltung …)
betreibt einen **Identitätsdienst**, ihre App bzw. ihr Login stellt Tokens aus („Org-Token“, für Stachel undurchsichtig).
Env der Instanz:

| Env | Pflicht | Bedeutung |
|---|---|---|
| `STACHEL_ORG_IDENTITY_URL` | ja (Modus org) | volle Adresse, die ein Org-Token prüft (s. u.); fehlt sie, startet der Server nicht |
| `STACHEL_ORG_LOGIN_URL` | nein | Passwort-Anmeldung über die Organisation (s. u.); leer = keine Passwort-Anmeldung (`POST /api/auth/password` und `app-session` mit `{username,password}` → 404 `not_found`) |
| `STACHEL_ORG_NAME` | nein | Name der Organisation in Texten („Mit {Name} anmelden“, Fehlermeldungen), Standard `Organisation`, ≤ 60 Zeichen |
| `STACHEL_ORG_APP_NAME` | nein | Name ihrer App in Texten („In der {App} öffnen“), Standard `{STACHEL_ORG_NAME}-App`, ≤ 60 Zeichen |
| `STACHEL_ORG_TIMEOUT_MS` | nein | Zeitlimit je Aufruf, Standard 8000 |

`STACHEL_AUTH` mit unbekanntem Wert (auch dem früheren Betreiber-Modus) bricht den Start mit Meldung ab.

**Token prüfen:** `GET {STACHEL_ORG_IDENTITY_URL}` mit `Authorization: Bearer <org-token>`, `Accept: application/json`
(keine Weiterleitungen) →

```jsonc
200 {"id": "m:12", "name": "Mara", "admin": false, "status": "active"}   // status: "active" | "pending" | "blocked"
```

- `id` (String, oder Zahl → String): **dauerhafte, eindeutige Kennung** der Person; Stachel nimmt sie unverändert als
  `user_key` (Boards, Favoriten, Kommentare hängen daran). 1–200 Zeichen ohne Leer-/Steuerzeichen, nicht mit `u:`
  oder `ai:` beginnend (vergeben Stachel selbst). Empfehlung `<art>:<nummer>`, z. B. `m:12`. Wer eine bestehende Instanz
  umstellt, liefert dieselben Kennungen wie bisher (`m:<id>` bzw. `a:<name>`), sonst gelten alle als neue Personen.
- `name`: Anzeigename (leer → `Team-Mitglied <id>`), höchstens 200 Zeichen werden übernommen.
- `admin`: `true` = Orga-Rechte in Stachel (`isOrga`: darf jedes Board verwalten, Papierkorb aller).
- `status`: `active` → angemeldet. `pending` → Fehler **403 `pending`** („Dein Konto bei {Org} wartet noch auf
  Freigabe.“). `blocked` (bzw. jeder andere Wert) → Fehler **403 `forbidden`** (Konto gesperrt bzw. ohne Zugang).
- HTTP **401** → Token ungültig: `invalid_token` bzw. beim Passwort-Login `invalid_credentials`; die App sollte sich nur
  bei `invalid_token` abmelden. HTTP **403** → `forbidden` (bzw. `pending`, wenn der Body `{"error":"pending"}` oder
  `{"status":"pending"}` ist). Netzfehler, Zeitüberschreitung, andere Status oder unbrauchbares JSON (z. B. `id` fehlt)
  → **502 `org_unreachable`** („{Org} ist gerade nicht erreichbar. Bitte versuch es gleich nochmal.“).
- Bei der Nachprüfung (§1) wird die Sitzung bei `invalid`, `forbidden` und `pending` gelöscht.

**Passwort-Anmeldung (optional):** `POST {STACHEL_ORG_LOGIN_URL}` mit `{"username", "password"}` (JSON) →
`200 {"token": "<org-token>"}`; danach „Token prüfen“ wie oben. 400/401 → `invalid_credentials`, 429 → `rate_limited`,
sonst bzw. ohne `token` → `org_unreachable`.

Die App der Organisation braucht nur ihr Org-Token: QR-Kopplung (§2 `qr/approve`), App-Code (§2), App-Sitzung (§8.1).

## 2. Auth-Endpunkte

| Methode + Pfad | Wer | Body | Antwort |
|---|---|---|---|
| `POST /api/auth/password` | Browser (nur mit `STACHEL_ORG_LOGIN_URL`) | `{username, password}` | 200 `{ok, user}` + Cookie · 401 `invalid_credentials` · 429 `rate_limited` · 404 `not_found` ohne Login-Adresse |
| `POST /api/auth/qr` | Browser | – | 200 `{ok, code, url, expires_at}` + Cookie `stachel_pair` |
| `GET /api/auth/qr/:code/wait` | Browser bzw. Stachel-App (`X-Stachel-App: 1`, §8.1) | – | Long-Poll ≤ 25 s: 200 `{ok, status:"pending"}` · 200 `{ok, status:"approved", user}` + Session-Cookie (Stachel-App: `{ok, status:"approved", user, token:"sts_…", expiresAt}` ohne Cookie) · 410 `expired` · 403 `wrong_browser` |
| `GET /api/auth/qr/:code/info` | **Org-App** | – + `Authorization: Bearer <Org-Token>` | 200 `{ok, browser, os, created_at, ip_hint}` · 401 `invalid_token` · 403 `pending`/`forbidden` · 404 `unknown_code` · 410 `expired` · 409 `already_used` · 429 `rate_limited` |
| `POST /api/auth/qr/approve` | **Org-App** | `{code}` + `Authorization: Bearer <Org-Token>` | 200 `{ok, name}` · 401 `invalid_token` · 403 `pending`/`forbidden` · 404 `unknown_code` · 410 `expired` · 409 `already_used` · 502 `org_unreachable` |
| `POST /api/auth/app-code` | **Org-App** | – + `Authorization: Bearer <Org-Token>` | 200 `{ok, code, url, expires_at}` · 401 `invalid_token` · 403 `pending`/`forbidden` · 502 `org_unreachable` · 429 `rate_limited` |
| `GET /auth/app?code=…[&b=<boardId>]` | WebView der App | – | 302 auf `/?app=1` bzw. `/?b=<boardId>&app=1` (Web merkt sich den App-WebView) + Session-Cookie · 410 HTML-Seite „Link abgelaufen“ |
| `GET /api/auth/me` | Browser | – | 200 `{ok, user}` · 401 `not_logged_in` |
| `POST /api/auth/logout` | Browser | – | 200 `{ok}` (Cookie gelöscht) |

Zusätzliche Fehler (alle Endpunkte, Format wie §0): 400 `invalid_input` (Body ungültig/leer), 403 `csrf`
(Header `X-Stachel` fehlt), 403 `pending` auch beim Passwort-Login, 502 `org_unreachable` (Identitätsdienst
nicht erreichbar bei Login/approve; der Code bleibt dann nutzbar). `wait` mit unbekanntem/verbrauchtem Code → 410 `expired`; mehr als 3 gleichzeitige `wait` auf denselben Code → 429
`rate_limited`. 403 `forbidden` (Konto gesperrt/ohne Team-Zugang, s. §1) bei Passwort-Login, `info`, `approve`, `app-code`.
IP-Limits zählen IPv6-Adressen je /64-Präfix.
`GET /api/health` → `{ok:true}` (ohne Sitzung, für Docker-Healthcheck).

- Alle Endpunkte dieses Abschnitts gibt es nur im Modus `org` (Modus local: 404, §6).
- **Passwort-Login:** Server ruft `POST {STACHEL_ORG_LOGIN_URL}` `{username,password}` → `{token}`, dann
  „Org-Token prüfen" (§1), legt Sitzung an. Rate-Limit pro IP: 10 **Fehlversuche** (falsches Passwort) / 5 min
  – erfolgreiche Anmeldungen zählen nicht, sonst wäre ein Orga-Treffen im selben WLAN nach 10 Anmeldungen ausgesperrt –
  und als Flutbremse 60 Versuche insgesamt / 5 min; zusätzlich
  10 Fehlversuche / 15 min je Benutzername (unabhängig von der IP, gegen verteiltes Raten).
- **QR-Login (wie WhatsApp Web):**
  1. Browser `POST /api/auth/qr` → Server legt Pairing an: `code` (24 Byte base64url), `pair_secret` (32 Byte,
     als Cookie `stachel_pair`, HttpOnly, 5 min), `expires_at` = jetzt + **2 min**. `url` = `{PUBLIC_URL}/qr/{code}`.
  2. Browser zeigt `url` als QR-Code, erneuert nach Ablauf automatisch (neues Pairing, alter Code verfällt).
  3. App scannt, erkennt `url` am Präfix `{PUBLIC_URL}/qr/`, holt optional `GET /api/auth/qr/:code/info`
     (Browser und System grob aus dem User-Agent, z. B. `Chrome`/`Windows`, sonst `null`; `created_at`;
     `ip_hint` = grobe Herkunft wie `203.0.x.x` bzw. `2001:db8:…`, nie die volle IP; verbraucht den Code nicht,
     Rate-Limit 60 / 5 min pro IP), fragt „Im Browser bei Stachel anmelden? Chrome auf Windows, eben erzeugt" und ruft
     `POST /api/auth/qr/approve` mit dem Code und ihrem **Org-Token** (`Authorization: Bearer`).
     Server prüft das Token (s. o.), markiert das Pairing als bestätigt und merkt sich Nutzer + Token.
  4. Browser-Long-Poll bekommt `approved`, nur wenn sein `stachel_pair`-Cookie zum Pairing passt
     (sonst 403 `wrong_browser`) → Server legt Sitzung an, setzt `stachel_session`, löscht `stachel_pair`.
     Ein Pairing ist genau einmal einlösbar.
- **App-Login (Stachel im WebView der Org-App, ohne QR):**
  1. App `POST /api/auth/app-code` mit ihrem **Org-Token** (`Authorization: Bearer`, kein
     `X-Stachel` nötig). Server prüft das Token wie bei `approve` (gleiche Fehler, Rate-Limit 60 / 5 min pro IP)
     und legt einen Einmal-Code an: 32 Byte base64url, in SQLite (`app_codes`) **nur als SHA-256-Hash** samt
     Nutzer + Token, gültig **60 s**, genau einmal einlösbar. `url` = `{PUBLIC_URL}/auth/app?code=<code>`.
  2. App lädt `url` im WebView (optional `&b=<boardId>`). Server löst den Code ein, ersetzt eine vorhandene
     Sitzung dieses WebViews, legt eine neue an (gleicher Nutzer, Org-Token für die Nachprüfung, §1),
     setzt `stachel_session` und antwortet 302 auf `/` bzw. `/?b=<boardId>` – `b` nur, wenn es dem
     Board-ID-Format `[A-Za-z0-9_-]{1,64}` entspricht (kein Open Redirect).
  3. Unbekannt/abgelaufen/verbraucht (oder Rate-Limit 120 / 5 min pro IP) → 410, kleine deutsche HTML-Seite
     „Link abgelaufen – in der App nochmal auf Stachel tippen“. Beide Antworten mit `Cache-Control: no-store`
     und `Referrer-Policy: no-referrer`. `HEAD` verbraucht keinen Code.
  4. Läuft die Sitzung im WebView ab (Seite zeigt die Anmeldung), holt die App beim nächsten Öffnen einfach
     einen neuen Code.
- `GET /qr/:code` (HTML, wenn jemand den QR mit der normalen Handy-Kamera scannt): kurze Seite
  „Öffne die {Org-App}, gehe dort zu Stachel und scanne den Code." Mit `?handy=1` (Rückfall-Seite von
  „In der {Org-App} öffnen“, wenn die App den Link auf demselben Handy nicht übernommen hat): Erklärung und Knopf
  zur Anmeldung im Browser. `{Org-App}` = `STACHEL_ORG_APP_NAME`.

### App-Links (Org-App bzw. Stachel-App übernimmt Stachel-Links)

- Modus `org`: Die App der Organisation (Paket/App-ID aus `STACHEL_ANDROID_PACKAGE` / `STACHEL_IOS_APP_ID`) öffnet
  `{PUBLIC_URL}/qr/<code>` (bestätigt den Code wie einen gescannten QR-Code) und `{PUBLIC_URL}/b/<id>` (öffnet das Board) direkt.
- Modus `local` (§6): Die Stachel-App (`com.intsode.stachel`) öffnet `{PUBLIC_URL}/b/<id>`, `{PUBLIC_URL}/verify/<token>`
  (E-Mail bestätigen) und `{PUBLIC_URL}/reset/<token>` (Passwort zurücksetzen); `/qr/*` gibt es dort nicht. Ohne
  `STACHEL_ANDROID_PACKAGE` bzw. `STACHEL_IOS_APP_ID` gibt es in keinem Modus App-Links (404); die `components` bzw.
  Pfade richten sich nach dem Modus.
- `GET /.well-known/assetlinks.json` (Android; ohne Sitzung/CSRF, keine Weiterleitung, `application/json`,
  `Cache-Control: public, max-age=300`): `[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":
  "android_app","package_name":"<STACHEL_ANDROID_PACKAGE>","sha256_cert_fingerprints":[…]}}]`. Fingerabdrücke aus
  `STACHEL_ANDROID_CERT_SHA256` (kommagetrennt, `AA:BB:…`, 32 Byte; ungültige werden ignoriert), Paket
  `STACHEL_ANDROID_PACKAGE`. Kein Paket oder keine gültigen Fingerabdrücke → 404.
- `GET /.well-known/apple-app-site-association` (iOS, gleiche Header): `{"applinks":{"details":[{"appIDs":
  ["<STACHEL_IOS_APP_ID>"],"components":[{"/":"/qr/*"},{"/":"/b/*"}]}]}}` (Modus org; ohne App-ID 404). Modus local:
  `components` `[{"/":"/b/*"},{"/":"/verify/*"},{"/":"/reset/*"}]` (Stachel-App, z. B. `com.intsode.stachel`).
- `GET /b/<id>[?o=<objekt>]` → 302 auf `/?b=<id>[&o=<objekt>]` (nur gültige Board-IDs `[A-Za-z0-9_-]{1,64}`, sonst
  404-Seite; `o` nur im selben Format, sonst weggelassen). „Link zum Board kopieren“ erzeugt `/b/<id>`; die App kopiert
  Objekt-Links als `/b/<id>?o=<objekt>` (öffnet am Handy die App, sonst im Browser das Objekt).
- **Web-App unter einem Pfad** (`STACHEL_BASE_PATH`, z. B. `/app` auf stachel.intsode.com; `docs/features/website.md`):
  Nur die Web-App und ihre Seitenadressen liegen dann unter dem Pfad (`/app/?b=<id>`), API, `/sync`, `/native/v1`,
  `/.well-known/…`, `/mcp` und `/qr/<code>` bleiben an der Wurzel. `/b/<id>` und `/app/b/<id>` → 302 `/app/?b=<id>[&o=…]`,
  `/` mit Query → 302 `/app/?…`, `/app` → 301 `/app/`. Der Server erzeugt Links mit Pfad (`/app/b/<id>`, Mail-Links
  `/app/verify/<token>`, `/app/reset/<token>`); die Pfade ohne Präfix bleiben gültig. App-Links: Android-Manifest und
  AASA (`components` zusätzlich `/app/b/*`, `/app/verify/*`, `/app/reset/*`) nehmen beide Formen. Mit `STACHEL_LANDING=1`
  ist `/` die Produktseite (Bilder unter `/landing/img/`).
- Knopf „In der {Org-App} öffnen“ auf der Anmeldeseite (Handy/Tablet, nur Modus org mit `orgAndroidPackage` aus
  `/api/instance`): **Android** `intent://<host>/qr/<code>#Intent;
  scheme=https;package=<orgAndroidPackage>;S.browser_fallback_url=<{PUBLIC_URL}/qr/<code>?handy=1>;end` (Chrome
  übernimmt App-Links auf derselben Domain sonst nicht). **iOS**: kein Knopf (Safari übernimmt Universal Links auf
  derselben Domain nicht), die Passwort-Anmeldung steht oben. **Computer**: QR-Code wie bisher.
- Die Web-App erkennt das WebView der App nur an `?app=1` aus `/auth/app` (nicht an einer allgemeinen WebView-Kennung
  im User-Agent, die auch die In-App-Browser von Instagram usw. tragen).

## 3. Boards

| Methode + Pfad | Antwort |
|---|---|
| `GET /api/boards` | `{ok, boards: BoardInfo[]}` (zuletzt geändert zuerst) |
| `POST /api/boards` `{title}` | 201 `{ok, board}` |
| `PATCH /api/boards/:id` `{title}` | `{ok, board}` mit `titleSeq` (Reihenfolge der Umbenennung, wie `board.renamed` §4) |
| `DELETE /api/boards/:id` | `{ok, board: TrashedBoardInfo}` — nur Ersteller:in oder `is_orga`; sonst 403 `forbidden`. Verschiebt das Board in den **Papierkorb** (s. u. „Papierkorb“); endgültig erst dort bzw. nach 30 Tagen |
| `POST /api/boards/:id/images` (multipart, Feld `file`, max 15 MB, png/jpeg/webp/gif, max 20 000 px je Seite und 100 Mio. Pixel) | 201 `{ok, image: {id, url, width, height}}` – gespeichert **ohne Metadaten** (`server/src/image-clean.ts`): EXIF inkl. GPS, XMP, IPTC, Kommentare, PNG-Textfelder, Anhänge hinter dem JPEG-Ende fallen verlustfrei weg; hat das Bild eine EXIF-Drehung, wird es einmal gedreht neu kodiert (`width`/`height` = so wie angezeigt). Farbprofil (ICC) bleibt. Nicht lesbar → 415 `unsupported_type`. Schon gespeicherte Originale bereinigt der Server einmalig beim Start (Marker `DATA_DIR/images-clean-v1.done`) |
| `GET /api/images/:id` | Bilddatei (nur mit Sitzung), `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: … sandbox` (gilt auch fürs Vorschaubild) |
| `GET /api/images/:id?w=256` bzw. `?w=1024` | verkleinerte Fassung (WebP, Breite `w`, EXIF-Drehung angewandt), gleiche Header; beim ersten Abruf einmal erzeugt und unter `data/image-variants/` abgelegt. Original (gleicher Typ wie hochgeladen) bei GIF, bei Bildern bis `w` px Breite und wenn das Verkleinern fehlschlägt. Andere `w` → 400 `invalid_input` (nur feste Stufen). Der Editor wählt die Stufe nach Bildschirmgröße (Objektbreite × Zoom × devicePixelRatio) |
| `POST /api/boards/:id/files` (multipart, Feld `file`, PDF, max 15 MB; geprüft per Magic Bytes `%PDF-` und `%%EOF`) | 201 `{ok, file: {id, url, bytes}}` – Original-PDF eines Dokuments (docs/features/documents.md); liegt in `images` mit `mime` `application/pdf`, gilt also beim Löschen/Duplizieren wie ein Bild. Die Seiten lädt der Browser als Bilder hoch. Kein PDF → 415 `unsupported_type`, zu groß → 413 `too_large` |
| `GET /api/files/:id[?download=1&name=<Dateiname>]` | die PDF (nur mit Sitzung, nur PDF-Einträge, sonst 404), `application/pdf`, `Content-Disposition: inline` bzw. mit `download=1` `attachment` samt Dateiname (`filename*` UTF-8), Cache- und CSP-Header wie Bilder |
| `PUT /api/boards/:id/thumbnail` (Body = Bild, `Content-Type` image/png, image/jpeg oder image/webp; max 512 KB, max 2000 px je Seite) | `{ok, thumbnailAt}` – Vorschaubild ersetzen |
| `GET /api/boards/:id/thumbnail?v=<thumbnailAt>` | Bild; mit passendem `v` `private, max-age=31536000, immutable`, sonst `private, no-cache`; 404 ohne Vorschaubild |
| `POST /api/boards/:id/duplicate` `{title?, template?}` | 201 `{ok, board}` – Kopie samt Inhalt (Live-Stand), Bildern (neue IDs) und Vorschaubild |
| `GET /api/users` | `{ok, users: {key, name}[]}` – alle, die sich je bei Stachel angemeldet haben (nach Name sortiert; für @Erwähnungen) |
| `PUT /api/boards/:id/favorite` · `DELETE /api/boards/:id/favorite` | `{ok, favorite}` – Stern der anfragenden Person setzen/entfernen (doppelt ist harmlos); 404 bei unbekanntem Board |
| `GET /api/boards/events` | Server-Sent Events (`text/event-stream`, `X-Accel-Buffering: no`, Herzschlag alle 25 s, `retry: 3000`): je Ereignis `data: <JSON>` – `{type:"created", id}`, `{type:"renamed", id, title, titleSeq}`, `{type:"deleted", id, by, byKey}` (in den Papierkorb verschoben), `{type:"restored", id, by, byKey}` (wiederhergestellt), `{type:"purged", id}` (endgültig gelöscht), `{type:"updated", id}` (Inhalt gespeichert bzw. neues Vorschaubild, höchstens alle 15 s je Board); unbekannte Typen → Liste neu laden |
| `GET /api/trash` | `{ok, boards: TrashedBoardInfo[]}` – alle Boards im Papierkorb, zuletzt gelöschtes zuerst |
| `GET /api/trash/:id` | `{ok, board: TrashedBoardInfo}`; 404 `not_found`, wenn es nicht (mehr) im Papierkorb liegt |
| `GET /api/trash/:id/thumbnail?v=<thumbnailAt>` | Vorschaubild eines Boards im Papierkorb (Header wie `GET /api/boards/:id/thumbnail`) |
| `POST /api/trash/:id/restore` | `{ok, board: BoardInfo}` – zurück in die Liste; 403 `forbidden` ohne Recht, 404 `not_found` |
| `DELETE /api/trash/:id` | `{ok}` – endgültig löschen; 403 `forbidden` ohne Recht, 404 `not_found` |
| `DELETE /api/trash` | `{ok, purged}` – Papierkorb leeren: alle Boards, die die Person verwalten darf (Orga: alle) |

Alle Board-/Bild-/Personen-Endpunkte brauchen eine Sitzung (401 `not_logged_in`). Jeder angemeldete Mensch darf alle
Boards sehen und bearbeiten (ein Team) – im Modus `org`; im Modus `local` gelten Board-Rechte (§6). `updated_at` eines Boards setzt der Sync-Server beim Speichern.
Personen: Der Server merkt sich jede Anmeldung (Passwort, QR) und jedes `/api/auth/me` in der Tabelle `users`
(`key`, `name`, `first_seen`, `last_seen`; Name wird aktualisiert). Sitzungen verfallen, die Einträge bleiben.
Persönlich (nur `GET /api/boards`, je anfragender Person): `favorite: true` (Stern) und `openedAt` (ISO, zuletzt im
Editor geöffnet = letzte WebSocket-Anmeldung, höchstens einmal je Minute gespeichert). Die Übersicht zeigt Favoriten oben
und sortiert auf Wunsch nach „Zuletzt geöffnet“; beides bleibt im Papierkorb erhalten und verschwindet erst mit dem
endgültigen Löschen.
**Live-Übersicht:** Die Übersicht hört auf `GET /api/boards/events` und übernimmt Umbenennen/Löschen direkt; bei
`created`/`updated`/`deleted`/`restored`/`purged` (Papierkorb) und nach einem Wiederverbinden lädt sie die Listen neu.
Vorschaubilder & Vorlagen: `BoardInfo` (Liste, `duplicate`) trägt optional `thumbnailAt` (Stand des Vorschaubilds;
fehlt = keins) und `template: true` (Board ist eine Vorlage). Das Vorschaubild rendert der Browser aus dem Board
(`docs/features/tools.md`). `duplicate` ohne `title` heißt „<Titel> (Kopie)“; `template: true` speichert die Kopie als
Vorlage (gleicher Titel); die Kopie einer Vorlage ist ein normales Board (gleicher Titel). Vorschaubild und
Vorlagen-Markierung verschwinden mit dem Board. `template` kein Boolean bzw. leeres Vorschaubild → 400 `invalid_input`.
Bilder gehören einem Board (`images.board_id`), werden aber board-unabhängig per ID ausgeliefert. Kopieren/Einfügen
über Boards hinweg übernimmt deshalb einfach die `imageId` (keine Kopie der Datei). Beim Löschen eines Boards prüft der
Server beim **endgültigen** Löschen, ob ein anderes Board (Live-Stand bzw. gespeicherter Stand, auch im Papierkorb) ein Objekt mit dieser `imageId` enthält; dann geht
das Bild auf dieses Board über (zuletzt geändertes zuerst) statt gelöscht zu werden. Nur noch im Rückgängig-Verlauf oder
in der Zwischenablage stehende Bilder zählen nicht. `duplicate` kopiert dagegen die Bilddateien (neue IDs).
**Papierkorb** (`server/src/trash.ts`, Oberfläche `web/src/pages/trash.tsx`):
- Löschen setzt in `boards` die Spalten `deleted_at`, `deleted_by`, `deleted_by_name` (additive Migration beim Start;
  bestehende Boards haben `NULL` = nicht gelöscht). Inhalt, Bilder samt Varianten, Vorschaubild, Vorlagen-Markierung,
  Favoriten, „zuletzt geöffnet“ und Versionen bleiben unverändert liegen; Wiederherstellen holt das Board damit vollständig
  zurück (gleiche ID, Links gehen wieder). Die letzten Änderungen offener Editoren speichert der Server beim Trennen noch.
- `TrashedBoardInfo` (`shared/protocol.ts`) = `BoardInfo` + `deletedAt`, `deletedBy` (user key), `deletedByName`,
  `purgeAt` (= `deletedAt` + `TRASH_DAYS` = 30 Tage) und `canManage` (anfragende Person darf wiederherstellen/endgültig
  löschen: wer es angelegt hat, wer es gelöscht hat, Orga). Den Papierkorb sehen alle (ein Team).
- Boards im Papierkorb erscheinen nicht in `GET /api/boards` (also auch nicht unter Favoriten/„Zuletzt geöffnet“).
  Alle Routen `/api/boards/:id…` (umbenennen, löschen, Bilder hochladen, Vorschaubild, duplizieren/Vorlage, Favorit,
  Versionen …) antworten **410 `in_trash`** („Dieses Board liegt im Papierkorb.“). `GET /api/images/:id` liefert Bilder
  weiter aus (andere Boards können sie per Kopieren/Einfügen zeigen). Der Editor wird mit `board_deleted` abgelehnt (§4).
- **Endgültig löschen** (von Hand oder automatisch): Der Server sucht stündlich (und kurz nach dem Start) Boards, deren
  `deleted_at` älter als 30 Tage ist, und löscht Board, Dokument, Vorschaubild, Vorlagen-Markierung, Favoriten,
  Besuche, Versionen und die Bilder des Boards samt Varianten (`data/images/<id>`, `data/image-variants/<id>-*.webp`).
  Bilder, die ein anderes Board noch nutzt – auch eines im Papierkorb –, gehen auf dieses über (wie unten beschrieben).
- Übersicht: Bereich „Papierkorb“ unter den Boards (aufklappbar, Zustand je Gerät), nach dem Löschen unten der Hinweis
  „Board gelöscht · Rückgängig“ (8 s). Editor: Link/Kurzlink/„zuletzt geöffnet“ auf ein Board im Papierkorb bzw. live
  gelöscht → Hinweis mit wer/wann, „Wird endgültig gelöscht in N Tagen“ und „Wiederherstellen“ für Berechtigte; stellt
  jemand anderes es wieder her (`restored`), wird daraus „Board ist wieder da“ mit „Board öffnen“.

Weitere Fehler: 404 `not_found` (Board/Bild unbekannt), 410 `in_trash` (Board im Papierkorb), 400 `invalid_input` (Titel kein String bzw. > 120 Zeichen;
`POST` ohne Titel → „Unbenanntes Board"), 413 `too_large`, 415 `unsupported_type` (Typ per Magic Bytes geprüft).

### Versionen (Versionsverlauf, `server/src/versions.ts`)

| Methode + Pfad | Antwort |
|---|---|
| `GET /api/boards/:id/versions` | `{ok, versions: BoardVersionInfo[]}` (neueste zuerst) |
| `GET /api/boards/:id/versions/:vid` | Inhalt als Yjs-Update (`application/octet-stream`, kompakter Neuaufbau ohne Verlauf; mit `Accept-Encoding: br` direkt Brotli mit `Content-Encoding: br`), `Cache-Control: private, max-age=31536000, immutable` – für die Vorschau |
| `POST /api/boards/:id/versions` `{name}` | 201 `{ok, version}` – „Version speichern“: aktueller Stand mit Namen (1–120 Zeichen). Ist der Stand seit der letzten Version unverändert und diese unbenannt, bekommt sie den Namen |
| `PATCH /api/boards/:id/versions/:vid` `{name}` | `{ok, version}` – benennen/umbenennen; `""` bzw. `null` entfernt den Namen (dann wieder ausdünnbar) |
| `POST /api/boards/:id/versions/:vid/restore` | `{ok, backup, restored, changed}` – erst Sicherung des aktuellen Stands (`kind: "backup"`, `null`, wenn eine Version ihn schon kennt), dann wird das **Live-Dokument** auf den Inhalt der Version gebracht (normale Yjs-Änderung des Servers: alle Verbundenen sehen es sofort, auch ohne offene Verbindung wird gespeichert), danach `restored` (`kind: "restored"`, `restoredFrom` = Zeit der Version). `changed: false` = Inhalt war schon gleich |
| `POST /api/boards/:id/versions/:vid/copy` `{title?}` | 201 `{ok, board}` – neues Board mit dem Inhalt der Version (Bilder kopiert, neue IDs; ohne Titel „<Titel> (alte Version)“) |

`BoardVersionInfo` (`shared/protocol.ts`): `id`, `createdAt`, `kind` (`auto` | `manual` | `backup` | `restored`), `name`
(null = unbenannt), `people` (`{key,name}[]`: wer seit der vorigen Version geändert hat, aus der Sync-Sitzung), `by`
(wer gespeichert/wiederhergestellt hat), `restoredFrom`, `objects` (Anzahl in `objects`), `bytes` (Speicher, komprimiert).
Rechte wie Board-Bearbeitung (jede Sitzung). Fehler: 404 `not_found` (Board bzw. Version unbekannt, Version eines anderen
Boards, Board im Papierkorb), 400 `invalid_input` (Name leer/zu lang/kein Text), 401, 403 `csrf`.

- **Takt:** Eine automatische Version entsteht, wenn sich das Dokument seit der letzten Version geändert hat (Abdruck aus
  Zustandsvektor + Löschmenge): höchstens alle **10 Minuten** ab der ersten Änderung, solange jemand das Board offen hat,
  sofort wenn die **letzte Person geht**, und beim Laden, wenn keine Version den gespeicherten Stand kennt (erstes Öffnen
  eines älteren Boards, Absturz). Leere neue Boards bekommen keine Version.
- **Ausdünnen** (bei jeder neuen Version und stündlich): jünger als 24 h alle; bis 30 Tage die jüngste je Stunde; bis
  1 Jahr die jüngste je Tag; ältere werden gelöscht. Benannte Versionen bleiben immer.
- **Speicher:** Tabelle `board_versions`, je Version der Inhalt als frisch aufgebautes Yjs-Dokument (ohne Grabsteine)
  Brotli-komprimiert. Endgültig gelöschte Boards verlieren ihre Versionen (Papierkorb leeren/Ablauf, stündliches Aufräumen).
- **Wiederherstellen** ändert nur abweichende Einträge (Objekte feldweise, Rich-Text/Listen als Ganzes) in allen
  Strukturen (`objects`, `collab.*` …). Clients können es nicht mit Strg Z zurücknehmen, dafür gibt es die Sicherung.

### Eigene Vorlagen („Auswahl als Vorlage speichern …“, `server/src/user-templates.ts`)

Je Person privat (Schlüssel der Sitzung), gerätübergreifend; Browser-Cookie, App-Sitzung (Bearer `sts_…`) oder API-Token,
schreibend mit `X-Stachel: 1`. Inhalt = Objekte im Format der Zwischenablage (`BoardObject[]` aus dem Schnappschuss,
Rich-Text als Dokument in `content`); eingefügt wird im Client wie „Einfügen“ (Web) bzw. mit der Web-Aktion
`structure.insert` (App, `docs/features/structure.md`).

| Methode + Pfad | Antwort |
|---|---|
| `GET /api/templates` | `{ok, templates: {id, name, createdAt, objects}[]}` – eigene, neueste zuerst |
| `POST /api/templates` `{name, objects}` | `{ok, template}` – Name 1–80 Zeichen (Leerraum zusammengefasst), 1–500 Objekte mit `id` (eindeutig), `type`, `x`/`y`/`w`/`h`; `JSON.stringify({json: JSON.stringify(objects)})` ≤ 250 000 Zeichen (Grenze der Native-API für `args`) |
| `DELETE /api/templates/:id` | `{ok}` – nur eigene, sonst 404 `not_found` |

Fehler: 400 `invalid_input` (Name, Objekte), 400 `too_large` (zu viele Objekte bzw. zu groß), 409 `limit` (schon
50 eigene Vorlagen), 401, 403 `csrf`. Konto löschen entfernt sie, „Meine Daten herunterladen“ enthält sie
(`eigeneVorlagen`). Bilder/PDFs behalten ihre Datei-ID (Kopie fürs Ziel-Board über `image-binding.ts`).

### Vorlagen der Instanz (`server/src/template-packs.ts`)

Wer die Instanz betreibt, legt zusätzliche Vorlagen als `*.json` in `STACHEL_TEMPLATES_DIR` (Standard
`<DATA_DIR>/templates`, im Container `/data/templates`); alle sehen sie in der Galerie unter der Kategorie
`STACHEL_TEMPLATES_CATEGORY` (Standard `STACHEL_BRAND`, wenn nicht „Stachel“, sonst „Weitere Vorlagen“). Format je Datei:
`{"templates": [{id?, name, desc?, keywords?, objects}]}`, eine Liste davon oder eine einzelne Vorlage – also auch genau das,
was `GET /api/templates` liefert. Geprüft wie eigene Vorlagen (Name, 1–500 Objekte, Größe); ungültige Dateien bzw. Vorlagen
werden mit Warnung im Log übersprungen, höchstens 200 Vorlagen, Dateien ≤ 5 MB. Der Server liest den Ordner neu, wenn sich
Dateien geändert haben (höchstens alle 30 s geprüft, kein Neustart nötig).

| Methode + Pfad | Antwort |
|---|---|
| `GET /api/templates/instance` | `{ok, category, templates: {id, name, desc, keywords, objects}[]}` – `id` = `<dateiname>.<id bzw. name>` (klein, eindeutig); leere Liste ohne Ordner/Dateien |

Mit Sitzung (Cookie, Bearer `sts_…` oder `stk_…`), sonst 401. Clients zeigen die Kategorie nur, wenn `templates` nicht leer
ist, und fügen ein wie eigene Vorlagen (Web: „Einfügen“, App: Web-Aktion `structure.insert`).

### Import (`docs/features/import.md`, `server/src/import/`)

Boards aus Miro übernehmen (REST-API v2, nur auf Wunsch der Person). Typen `shared/import.ts`, Einzelheiten, Fehlercodes,
Grenzen und Daten in `docs/features/import.md` §2–§6. Mit Sitzung (Cookie, Bearer `sts_…` oder `stk_…`), schreibend mit
`X-Stachel: 1`; Ausnahme ist nur `POST /api/import/miro/callback` (Formular der Bestätigungsseite, abgesichert über
`state` + `nonce`).

| Methode + Pfad | Antwort |
|---|---|
| `GET /api/import/sources` | `ImportSources` (`miro.enabled/token/oauth/connected`) |
| `POST /api/import/miro/token` `{token}` | `{ok, conn, expiresAt}` – Token nur im Speicher (60 min); 400 `miro_token_invalid`, 403 `import_disabled`, 502 `miro_unavailable` |
| `POST /api/import/miro/oauth/start` `{client?}` | `{ok, url}` – Miro-Freigabeseite; 404 `oauth_disabled` |
| `GET /api/import/miro/callback?code&state` (ohne Sitzungspflicht) | 302 zur Web-App `?import=miro[&error=]` bzw. Bestätigungs-/Fertig-/Fehlerseite (HTML) |
| `POST /api/import/miro/callback` `state, nonce` (Formular) | Fertig- bzw. Fehlerseite (HTML) |
| `DELETE /api/import/miro/oauth` | `{ok}` – Widerruf bei Miro, gespeicherte Verbindung gelöscht |
| `GET /api/import/miro/boards?conn=&query=&offset=` | `ImportRemoteBoards`; 401 `miro_conn_expired` |
| `POST /api/import/miro/jobs` `{conn, boards, options?}` | 202 `{ok, jobs}`; 403 `board_limit`, 429 `import_limit` |
| `GET /api/import/jobs`, `GET /api/import/jobs/:id` | `{ok, jobs}` (7 Tage) bzw. `{ok, job}`; fremde → 404 |
| `DELETE /api/import/jobs/:id` | `{ok, job}` – abbrechen (`canceled`) |

## 4. Echtzeit (Hocuspocus)

- WebSocket `wss://<origin>/sync`, Hocuspocus-Protokoll, Dokumentname **`board:<boardId>`**.
- `onAuthenticate`: Session-Cookie aus dem Upgrade-Request; ungültig → Verbindung abgelehnt.
  Unbekanntes Board → abgelehnt. Der Provider bekommt dann `authenticationFailed` mit `reason`
  `"not_logged_in"` (→ zur Anmeldung) bzw. `"unknown_board"` (Board gelöscht/gibt es nicht).
  Upgrade mit fremdem `Origin` → HTTP 403.
- **Board gelöscht (in den Papierkorb), während es offen ist:** Der Server schickt allen Editoren des Boards die
  Stateless-Nachricht `board.deleted` (mit Namen), schließt dann ihre WebSockets (Close `4404`, Grund `board_deleted`) und
  lehnt Wiederverbinden mit dem Grund **`board_deleted`** ab, solange das Board im Papierkorb liegt (nach dem endgültigen
  Löschen noch 24 h, danach bzw. nach einem Neustart `unknown_board`). Der Client fragt `GET /api/trash/:id` und zeigt
  „Board wurde von <Name> in den Papierkorb verschoben“ (bzw. „Du hast …“, ohne Namen „Dieses Board liegt im
  Papierkorb“) mit Frist, „Zur Übersicht“ und für Berechtigte „Wiederherstellen“ (lädt danach neu); er lässt nichts mehr
  bearbeiten. Ist es nicht (mehr) im Papierkorb: „Board nicht verfügbar“.
- **Stateless-Nachrichten** des Servers (Hocuspocus `stateless`, JSON): `{type:"board.deleted", by, byKey}` und
  `{type:"board.renamed", title, titleSeq}`. `titleSeq` steigt streng; ein Client übernimmt einen Titel (auch aus der
  eigenen PATCH-Antwort) nur, wenn seine Nummer größer ist als die zuletzt gesehene – bei gleichzeitigem Umbenennen
  zeigen so alle den Titel, den der Server zuletzt gespeichert hat.
- **Verbindung prüfen:** Der Server pingt jeden WebSocket alle 5 s und trennt nach zwei verpassten Antworten (≤ 10 s:
  die Person verschwindet aus der Anwesenheit). Der Client schickt alle 4 s die Stateless-Nachricht
  `{type:"ping"}`, der Server antwortet nur dieser Verbindung `{type:"pong"}`. Hat der Server schon einmal geantwortet und
  kommt 9 s lang nichts, gilt die Verbindung als getrennt („Offline“, neu verbinden). Das `offline`-Ereignis des Browsers
  schaltet sofort auf „Offline“, `online` verbindet sofort neu.
- Nachrichten höchstens 16 MB; ohne gültige Sitzung beim Upgrade höchstens 64 KB (reicht für die Anmeldung, größere
  → Close 1009). Logout trennt die offenen Verbindungen dieser Sitzung; zusätzlich prüft der Server offene
  Verbindungen alle 5 min nach (Sitzung abgelaufen/gelöscht/Token gesperrt → Close 1008, der Client sieht beim
  Wiederverbinden `not_logged_in`).
- Awareness: Ein Client darf nur eigene Einträge (eigene Yjs-`clientID`s) setzen oder entfernen; `user.key` und
  `user.name` müssen der Sitzung entsprechen (wie `/api/auth/me`), `user.color` ein String (≤ 64). Sonst schließt der
  Server die Verbindung zu diesem Dokument (Close 1008), die Awareness wird nicht verteilt.
- Persistenz: SQLite (Yjs-State je Dokument), debounced. **Herunterfahren** (SIGTERM/SIGINT): neue WebSocket-Upgrades
  bekommen sofort HTTP 503 (der Client verbindet sich später neu), offene Verbindungen werden getrennt und ausstehende
  Speichervorgänge sofort ausgeführt; was danach noch geladen ist, schreibt der Server direkt in SQLite, bevor er endet.
  Änderungen, die der Server bestätigt hat, gehen so nicht verloren; was der Client noch nicht senden konnte, schickt er
  nach dem Wiederverbinden (CRDT).

### Yjs-Dokument

- `doc.getMap("objects")`: `Y.Map<string, Y.Map<unknown>>`, Schlüssel = Objekt-`id` (nanoid).
  Felder je Objekt siehe `BoardObject` in `shared/protocol.ts`. Text von Haftnotiz/Text/Form/Verbinder liegt als
  Klartext im Feld `text`; Rich-Text zusätzlich in `content` (siehe „Rich-Text“ unten).
- Objekttypen und Formen sind erweiterbar (`ObjectTypeMap`, `ShapeKindMap` in `shared/protocol.ts`). Clients
  ignorieren Objekte unbekannten Typs (sie bleiben im Dokument erhalten und werden nicht gelöscht).
- Reihenfolge: Feld `z` (Fractional-Index-String nach `fractional-indexing`, Byte-weise lexikografisch sortiert, nicht
  `localeCompare`; neu = über allem). Neue Schlüssel können ein **zufälliges Kürzel** (bis 3 Zeichen aus
  `1-9A-Za-z`) tragen, damit zwei Clients, die gleichzeitig „über allem“ anlegen, verschiedene Schlüssel bekommen
  (`web/src/board/fractional.ts`). Clients müssen solche und auch gleiche Schlüssel vertragen (gleiche `z` → Reihenfolge
  nach `id`) und dürfen nicht abstürzen, wenn ein Schlüssel nicht dem Format entspricht.
- Optionale Felder (fehlen = Standard, ältere Clients ignorieren sie):
  - `groupId`: Objekte mit gleicher `groupId` bilden eine Gruppe (Klick wählt alle, Doppelklick das einzelne).
    Kopieren/Duplizieren vergibt neue `groupId`s.
  - Formatierung fürs ganze Objekt (sticky/text/shape): `bold`, `italic`, `strike` (boolean),
    `align` (`left`|`center`|`right`), `valign` (`top`|`middle`|`bottom`, sticky/shape).
    Bei Haftnotizen überschreibt ein gesetztes `fontSize` die automatische Größe.
  - Formen: `stroke`, `strokeWidth` (0 = ohne Rand), `dash: 'dashed'` = gestrichelter Rand.
  - Verbinder: `lineStyle` (`straight`|`elbow`|`curved`), `arrowStart`, `arrowEnd`, `dash` (`solid`|`dashed`|`dotted`),
    `text` = Beschriftung in der Linienmitte. Neue Verbinder zwischen zwei Objekten schreibt der Client als `curved`,
    sofern im Werkzeug nichts anderes gewählt ist (fehlendes Feld bleibt `straight`).
  - Haftnotiz: Form nur über `w/h` (Quadrat `w = h`, Rechteck `w = 1,75 · h`, sonst frei), kein eigenes Feld.
  - Verbinder-Ende `{ objectId, side? }`: `side` (`n`|`e`|`s`|`w`) heftet das Ende fest an diese Seitenmitte
    (gesetzt beim Ziehen aus einem Andockpunkt bzw. Plus-Griff, beim Plus-Klick an beiden zugewandten Seiten).
    Fehlt es, wählt der Client die nächstliegende Seite (gewinkelt/geschwungen) bzw. den Strahl Mitte–Mitte (gerade).
    Umhängen eines Endes auf ein anderes Objekt setzt `side` zurück.
  - Bild: `color` = Durchschnittsfarbe (beim Hochladen gemessen; Fläche beim Herauszoomen und beim Laden).
  - `text` mit `autoWidth: true`: Breite folgt dem Inhalt, bis jemand am Seitengriff zieht.
  - `rotation`: Grad im Uhrzeigersinn um die Mitte (sticky/shape/text/image); `x/y/w/h` beschreiben das ungedrehte Rechteck.
- Änderungen eines Nutzers in `doc.transact(..., LOCAL_ORIGIN)`; Undo/Redo pro Nutzer über
  `Y.UndoManager` mit `trackedOrigins: new Set([LOCAL_ORIGIN])` (weitere Origins, z. B. y-prosemirror, per
  `store.trackOrigin`).

#### Rich-Text

- Feld **`content`** (`RICH_TEXT_FIELD`) im Objekt-Y.Map von `sticky`, `text`, `shape` und `connector` (Beschriftung):
  ein **`Y.XmlFragment` im y-prosemirror-Format** (Kinder = Blockknoten, Text als `Y.XmlText` mit Marks als
  Formatierungsattributen) – damit direkt mit Tiptap/ProseMirror + y-prosemirror bearbeitbar, live für alle.
- Knoten/Marks heißen wie im Tiptap-StarterKit (`RICH_TEXT_NODES`, `RICH_TEXT_MARKS`): mindestens `paragraph`,
  `heading` (`level` 1–3), `bulletList`, `orderedList`, `listItem`, `taskList`/`taskItem` (`checked`), `blockquote`,
  `codeBlock`, `hardBreak`; Marks `bold`, `italic`, `strike`, `underline`, `code`, `link` (`href`), `highlight`
  (`color`), `textStyle` (`color`). Erweiterungen nur additiv; Clients überspringen Unbekanntes und behalten den Text.
- **`text` bleibt der Klartext-Spiegel:** Wer `content` ändert, schreibt im selben `transact` den Klartext nach
  `text` (Blöcke/Listeneinträge mit `
` getrennt). Suche, Zwischenablage, Screenreader, Vorschaubilder,
  automatische Schriftgröße und ältere Clients arbeiten so weiter.
- **Migration:** Objekte ohne `content` zeigen `text` wie bisher. Beim ersten Bearbeiten mit Rich-Text baut der Client
  `content` aus `text` (je Zeile ein `paragraph`), im selben Undo-Schritt wie die Bearbeitung. Kein Massen-Umbau beim Laden.
- **Alter Client hat nur `text` geändert** (Klartext von `content` ≠ `text`): `text` gilt; `content` wird beim
  nächsten Bearbeiten neu aus `text` aufgebaut.
- Das Format fürs ganze Objekt (`bold`, `italic`, `strike`, `align`, `valign`, `fontSize`, `color`) bleibt das
  Grundformat; Marks in `content` gelten zusätzlich für ihren Textbereich.
- Kopieren/Duplizieren: Der Schnappschuss enthält `content` nur als Lesekopie; ihr Format legt der Feld-Codec fest
  (`registerYField('content', …)` in `web/src/board/store.ts`). Das Rich-Text-Modul liefert ProseMirror-JSON
  (`{ type: 'doc', content: [...] }`) und baut daraus beim Einfügen ein neues `Y.XmlFragment`. Ohne Rich-Text-Modul:
  XML-String, beim Einfügen weggelassen (der Klartext bleibt).
- Rückgängig: y-prosemirror schreibt mit Origin `ySyncPluginKey`; das Modul nimmt ihn per `store.trackOrigin` in den
  Board-UndoManager auf (kein eigener `yUndoPlugin`), damit Strg Z auf dem Board auch Text zurücknimmt.

#### Weitere Y-Strukturen (Feature-Module)

- Neben `objects` legen Feature-Module eigene benannte Strukturen an, Name **`<modul>.<zweck>`**
  (z. B. `collab.comments`, `collab.votes`), über `store.extMap(name)` / `store.extArray(name)`. Diese sind
  standardmäßig Teil von Rückgängig/Wiederholen (`{ undo: false }` für z. B. Timer/Zähler). Fehlt eine Struktur
  (altes Board), gilt sie als leer. Der Server speichert das Dokument als Ganzes und kennt die Strukturen nicht.
- Jedes Modul beschreibt seine Strukturen und Objektfelder in `docs/features/<modul>.md` (siehe §5).
- **Ausnahme privater Modus** (`docs/features/private.md`): `private.mode` und `private.hidden` schreibt **nur der
  Server**; Sync-Updates von Clients, die eine der beiden Wurzeln berühren, verwirft er (wie „ansehen“). Private Objekte
  liegen nicht im Board-Dokument, sondern im Dokument **`private:<boardId>:<base64url(user key)>`** (gleiches Format wie
  `objects`), das nur die Person selbst öffnen darf (sonst `no_access`, auch bei Rolle ansehen/kommentieren); der Client
  verbindet es über denselben WebSocket. REST `GET|POST /api/boards/:id/private` steuert den Modus.

### Awareness

`provider.setAwarenessField("user", AwarenessState["user"])` sowie Felder `cursor` (Board-Koordinaten oder null),
`selection` (Objekt-IDs) und `since` (ms, Zeitpunkt des Betretens nach der Uhr des Clients).
**Farbe je Person** (`user.color`): eindeutig unter den Anwesenden – wer kommt, nimmt die erste freie der
12 Farben (`PRESENCE_COLORS` in `web/src/board/session.ts`, Blau und Pink zuerst); bei gleicher Farbe weicht
aus, wer später kam (`since`, bei Gleichstand behält die kleinere `clientId`). Eigene weitere Tabs übernehmen die Farbe
des ältesten Tabs und zeigen beim selben Menschen keinen „fremden“ Cursor und keine fremde Auswahl. Personen ohne
Anwesenheit (Kommentar-Pins, Avatare in Listen) behalten die feste Farbe aus `user_key` über `USER_COLORS`.
Feature-Module setzen eigene Felder mit Modul-Präfix (`session.setLocalField('collab.follow', …)`); andere Clients
lesen sie unter `Peer.extra` und ignorieren Unbekanntes.
KI-Assistenten (MCP, §7) sind Anwesende mit `user.key` `ai:<user_key>` und Name „KI (für <Name>)“; ihr `cursor` und ihre
`selection` zeigen, woran sie gerade arbeiten.

## 5. Feature-Module (Web)

Die Web-App ist in Kern und Feature-Module geteilt (`docs/architecture.md`). Jedes Modul dokumentiert seine
Datenfelder, Y-Strukturen und Awareness-Felder in einer eigenen Datei, damit parallel gearbeitet werden kann:

| Modul | Vertrag |
|---|---|
| richtext | `docs/features/richtext.md` (Umsetzung des Abschnitts „Rich-Text“) |
| shapes | `docs/features/shapes.md` |
| collab | `docs/features/collab.md` |
| structure | `docs/features/structure.md` |
| tools | `docs/features/tools.md` |
| versions | `docs/features/versions.md` |
| documents | `docs/features/documents.md` (PDF-Dokumente: Objekttyp `document`, `docPages` als Y.Map, Server §3 `/files`) |
| mcp | `docs/features/mcp.md` (KI-Zugang: Tokens im Board-Menü; keine Objektfelder, MCP-Server unter `mcp/`, §7) |

Neue Objektfelder/-typen: per Module-Augmentation in `web/src/features/<modul>/model.ts`
(`declare module '…/shared/protocol' { interface BoardObject { … } }`), nicht in `shared/protocol.ts`.

## 6. Instanzen, eigene Konten und Board-Rechte (`STACHEL_AUTH`)

Ein Codestand, zwei Betriebsarten (Env `STACHEL_AUTH`, Standard `local`; unbekannter Wert → Start bricht ab).
Ausführlich: `docs/features/accounts.md`.

- **`org`** (Anmeldung über den Identitätsdienst einer Organisation, §1): Anmeldung wie §1/§2, jedes angemeldete
  Mitglied sieht und bearbeitet alle Boards. Nichts aus diesem Abschnitt ändert dort Verhalten.
- **`local`** (z. B. stachel.intsode.com): eigene Konten (E-Mail + Passwort, Bestätigungsmail, Captcha), Boards
  gehören jemandem und sind nur für geteilte Personen sichtbar. Org-Endpunkte (§2: Passwort, QR, App-Code,
  `/auth/app`, `/qr/*`) antworten 404. Die App-Links (§2, für die Stachel-App) und `POST /api/auth/app-session` mit
  E-Mail + Passwort (§8.1) gibt es auch hier.

### Zentrale Rechteprüfung (für alle Zugriffswege: REST, Bilder, SSE, Yjs, API-Tokens/MCP)

`server/src/access.ts`, Instanz `App.access` (`BoardAccess`):

```ts
type BoardRole = 'owner' | 'edit' | 'comment' | 'view';          // Rangfolge view < comment < edit < owner
access.canAccessBoard(user: { key: string; isOrga?: boolean }, boardId: string, need: BoardRole): boolean
access.roleOf(user, boardId): BoardRole | null                    // null = kein Zugriff bzw. Board unbekannt
access.yjsMode(role): { readOnly: boolean; commentOnly: boolean } // so behandelt sync.ts eine Verbindung
```

- `org`: jede Sitzung hat `edit` auf jedes Board (`owner` = Ersteller:in oder `isOrga`).
- `local`: `owner` = `boards.created_by`; sonst Rolle aus `board_members` bzw. Freigabelink (`board_links`, nur
  angemeldet). Boards im Papierkorb: nur `owner`.
- Wer einen neuen Zugriffsweg baut (z. B. persönliche API-Tokens für den MCP-Server), löst das Token zu einem
  `user_key` auf und fragt **nur** diese Funktion. Die HTTP-Routen unter `/api/boards/:id…` prüft ein zentraler
  `preHandler` (`registerAccessGuard`): `GET` braucht `view`, alles andere `edit`, Ausnahmen in `ROUTE_ROLES`
  (`access.ts`). Neue Routen unter `/api/boards/:id/…` sind damit automatisch geschützt.
- Yjs: `view` → Hocuspocus-`readOnly`; `comment` → nur Änderungen an `collab.comments`, `collab.reads` und
  `structure.people` werden übernommen (Server prüft jede Nachricht), alles andere wird verworfen. Ohne Zugriff lehnt
  `onAuthenticate` mit Grund **`no_access`** ab. Ändert sich die Rolle, trennt der Server die Verbindungen der Person zu
  diesem Board (Close `4000` `access_changed`); beim Neuverbinden gilt die neue Rolle.
- `access.local` = Modus local. In Tests/Werkzeugen: `App.access`.

### Endpunkte (Einzelheiten: `docs/features/accounts.md`)

- Immer, ohne Sitzung: `GET /api/instance` → `{ok, auth: "org"|"local", brand, imprintUrl, privacyUrl, termsUrl, registration,
  orgName, orgAppName, orgPasswordLogin, orgAndroidPackage}` (`termsUrl` = `STACHEL_TERMS_URL` oder null). Nur Modus
  org: `orgName` = `STACHEL_ORG_NAME`, `orgAppName` = `STACHEL_ORG_APP_NAME`, `orgPasswordLogin` = `STACHEL_ORG_LOGIN_URL`
  gesetzt (bool), `orgAndroidPackage` = `STACHEL_ANDROID_PACKAGE` oder null; Modus local: `null`/`false`. Oberflächen
  zeigen damit „Mit {orgName} anmelden“, „In der {orgAppName} öffnen“ und die Passwort-Anmeldung nur bei `orgPasswordLogin`.
- Nur Modus local: `GET /api/auth/captcha`, `POST /api/auth/register|verify|resend|login|forgot|reset`,
  `GET|PATCH /api/account`, `GET /api/account/export`, `GET|POST /api/account/terms`, `POST /api/account/password|delete`; Teilen: `GET|POST /api/boards/:id/share`,
  `PATCH|DELETE /api/boards/:id/members/:key`, `DELETE /api/boards/:id/invites/:email`, `PUT /api/boards/:id/link`,
  `POST /api/boards/:id/owner`, `GET /api/boards/:id/people`. Neue Fehlercodes: `captcha_invalid`, `weak_password`,
  `terms_required`, `invalid_email`, `registration_closed`, `wrong_login`, `not_verified`, `link_expired`,
  `wrong_password`, `no_permission`.
- **Stachel-App:** Konto- und Teilen-Endpunkte nehmen statt des Cookies auch `Authorization: Bearer sts_…` (§8.1), bei
  schreibenden mit `X-Stachel: 1`. Passwort ändern mit App-Token beendet alle anderen Sitzungen (Cookies, andere
  App-Tokens) und trennt deren Verbindungen; die eigene App-Sitzung bleibt. Konto löschen geht damit auch in der App.
  Persönliche API-Tokens (`stk_`, §7) gelten für `/api/account…` nicht. Passwort zurücksetzen bzw. ändern löscht auch alle
  persönlichen API-Tokens der Person.
- **Konto löschen** (`POST /api/account/delete`, Modus local, mit Passwort): eigene Boards löschen oder übertragen, dann
  `forgetPerson` (`server/src/forget-person.ts`): persönliche API-Tokens (Verbindungen getrennt), eigener Posteingang
  (`mentions`), und auf allen verbliebenen Boards wird der Name der Person durch **„Gelöschtes Konto“** ersetzt (ihr
  KI-Assistent: „KI (für Gelöschtes Konto)“) – in Kommentaren (`collab.comments` `messages[].name`), Reaktionen
  (`collab.reactions` `n`), Abstimmung (`collab.vote` `startedByName`, `collab.votes` `name`), Timer (`collab.timer` `by`,
  per Namensgleichheit), „zuständig“-Liste (`structure.people`), Erwähnungen anderer (`mentions.by_name`), Ersteller:in
  (`boards.created_by_name`) und im Versionsverlauf (`people`, `by_name` und die gesicherten Stände selbst, kompakt neu
  geschrieben). Gespeicherte Dokumente enthalten den alten Namen danach nicht mehr (Yjs-GC). Web, Native-API (Spiegel,
  Schnappschüsse, Versions-Vorschau) und MCP lesen dieselben Strukturen. Der `user_key` bleibt als zufällige Kennung.
  Freitext (z. B. „@Name“ in fremden Kommentaren) bleibt unverändert.
- **Registrieren** (`POST /api/auth/register`): Pflichtfeld `terms: true` = „Ich akzeptiere die Nutzungsbedingungen und bin
  mindestens 18 Jahre alt.“ (sonst 400 `terms_required`; das frühere `privacy: true` reicht nicht mehr). Gespeichert als
  `accounts.terms_accepted_at` (und `privacy_accepted_at` = Datenschutz-Hinweis gezeigt). Die Datenschutzerklärung ist nur ein
  Hinweis-Link, keine Einwilligung (docs/legal/datenschutz.md §14).
- **Nutzungsbedingungen** (`GET /api/account/terms`, Modus local, Cookie oder `Bearer sts_…`) → `{ok, url, version,
  acceptedVersion, acceptedAt, pending}`; `pending` = `STACHEL_TERMS_VERSION` gesetzt und noch nicht akzeptiert → Web und
  App zeigen einen Zustimmungsdialog. `POST /api/account/terms {accept: true, version}` speichert die Zustimmung (400
  `terms_required` ohne `accept`, 409 `terms_changed` bei anderer Fassung). Die Registrierung speichert die geltende Fassung.
- **Rechtsseiten** (ohne Sitzung): `/impressum`, `/datenschutz`, `/nutzungsbedingungen` nur, wenn die Instanz die Texte in
  `<DATA_DIR>/legal` hinterlegt (sonst 404), `docs/features/legal-pages.md`.
- **Meine Daten herunterladen** (`GET /api/account/export`, Modus local, Cookie oder `Authorization: Bearer sts_…`, nicht
  `stk_`): 200 `application/zip` (`Content-Disposition: attachment; filename="stachel-daten-JJJJ-MM-TT.zip"`) mit `LIESMICH.txt`,
  `konto.json` (Konto, eigene Boards, Mitgliedschaften, Favoriten, zuletzt geöffnet, verschickte offene Einladungen,
  KI-Zugänge ohne Geheimnis, Erwähnungen) und je eigenem Board `boards/<Titel> (<id>)/board.json` (`{board, dateien,
  objects, ext}` – Objekte und Feature-Strukturen wie §8.5/§8.14, Live-Stand) samt `dateien/<bildId>.<endung>`.
  Höchstens 3 je Stunde und einer gleichzeitig je Konto (429 `rate_limited`), 401 `not_logged_in` (`server/src/legal.ts`).
- **„Meine Daten bei Stachel löschen“** (Modus **org**): `POST /api/account/delete` mit `{confirm: true}`, Cookie
  oder `Authorization: Bearer sts_…` (nicht `stk_`), `X-Stachel: 1` → 200 `{ok}` · 400 `invalid_input` (ohne
  `confirm: true`) · 401 `not_logged_in` · 429 `rate_limited`. Löscht alle Sitzungen der Person (samt gespeichertem
  Org-Token), QR-Kopplungen, App-Codes, Favoriten, „zuletzt geöffnet“, `users`-Eintrag und alles aus
  `forgetPerson` wie oben; trennt ihre Verbindungen, löscht das Cookie. Boards bleiben beim Team, das Konto bei der
  Organisation bleibt (verwaltet ihr Identitätsdienst). Web: `/?konto=1` („Meine Daten“), Stachel-App: Konto-Seite.
- **`GET /konto-loeschen`** (beide Modi, ohne Sitzung, auch unter `STACHEL_BASE_PATH`): öffentliche HTML-Seite, wie man
  Konto bzw. Daten in App und Web löscht und was gelöscht wird (Pflichtlink für Google Play, `server/src/forget-routes.ts`).
- Modus local verändert: `GET /api/boards` liefert nur Boards mit Zugriff und je Board `role` (`BoardInfo.role`);
  `?open=<id>` vermerkt, dass die Person ein Board über den Freigabelink geöffnet hat (Editor). `GET /api/users?board=<id>`
  nur Personen mit Zugriff. `GET /api/trash` nur eigene Boards. SSE nur Ereignisse zu Boards mit Zugriff.
- Mail-Links: `{PUBLIC_URL}/verify/<token>` (24 h), `{PUBLIC_URL}/reset/<token>` (1 h) – App-Links der Stachel-App
  (§2); ohne App leitet der Server mit 302 auf `/?verify=<token>` bzw. `/?reset=<token>` der Web-App um (`Cache-Control:
  no-store`, `Referrer-Policy: no-referrer`, verbraucht nichts; Token-Format `[A-Za-z0-9_-]{20,100}`, sonst 404-Seite).
  `token` = 32 Byte base64url (43 Zeichen), einlösen mit `POST /api/auth/verify {token}` bzw. `POST /api/auth/reset
  {token, password}`. Einladung `{PUBLIC_URL}/?b=<id>&register=1&email=<adresse>`, geteilt `{PUBLIC_URL}/b/<id>` (behält
  `?o=<objekt>`). Konto-Seite: `/?konto=1`.

### Melden, Blockieren, Moderation (beide Modi; `docs/features/moderation.md`, Betrieb `docs/ops/moderation.md`)

Google Play UGC und DSA Art. 16/17. Konstanten/Typen: `shared/moderation.ts`. Sitzung nötig (Cookie, `Bearer sts_`,
`stk_`), schreibend mit `X-Stachel: 1`.

- **`POST /api/reports`** `{boardId, objectId?, commentId? (Thread in collab.comments), messageId?, userKey?, reason,
  text?}`; `reason` ∈ `illegal|harassment|spam|privacy|copyright|other`, `text` ≤ 2000, bei `illegal`/`other` ≥ 10
  Zeichen. Nur auf Boards mit Zugriff. → 201 `{ok, report:{id:"R-XXXXXXXX", createdAt}, mailed}` · 400 `invalid_input`
  bzw. `text_required` · 404 `not_found` (Board/Objekt/Kommentar/Person unbekannt oder kein Zugriff) · 429 `rate_limited`
  (10 je Person, 30 je IP und Stunde). Der Server speichert einen Beleg (Text des Objekts bzw. Kommentars), mailt an
  `STACHEL_REPORT_EMAIL` (sonst `STACHEL_SMTP_FROM`) und – nur mit bekannter Adresse (Modus local) – eine
  Eingangsbestätigung an die meldende Person (`mailed: true`).
- **`GET /api/blocks`** → `{ok, blocked:[{key, name, at}]}`; **`PUT /api/blocks/:key`** blockieren (400 bei sich selbst),
  **`DELETE /api/blocks/:key`** aufheben – beide mit der neuen Liste. Wirkung: Einladungen/Teilen dieser Person kommen
  nicht an (`POST /api/boards/:id/share` überspringt mich still), ihre @Erwähnungen und Zuweisungen fehlen im Posteingang
  (§8.11) und zählen im Web nicht als ungelesen. Die blockierte Person erfährt nichts.
- **`GET /api/boards/:id/moderation`** → `{ok, lock: null | {mode:"readonly", reason}}`. Moderations-Sperre eines Boards
  (`board_locks`): `readonly` = alle (auch Besitzer:in) nur `view` – REST, Yjs (readOnly), Native-API (`nack forbidden`);
  Modus org antwortet REST mit 403 `board_locked`; `hidden` = für alle wie nicht vorhanden (404, Liste ohne das Board,
  Sync `no_access`). `access.connectRole` liefert die Rolle für Sync/Native in beiden Modi.
- **Gesperrtes Konto** (`account_locks`): jede Anfrage mit seiner Sitzung → 403 `account_locked` (Sitzung gelöscht),
  jede Anmeldung (`/api/auth/…`, alle Wege) → 403 `account_locked`; beim Sperren werden Sitzungen, API-Tokens und
  Verbindungen entfernt.
- **Admin-API** `/api/admin/…` nur mit `Authorization: Bearer <STACHEL_ADMIN_TOKEN>` (≥ 32 Zeichen, sonst gibt es sie
  nicht): Meldungen listen/ansehen/entscheiden (`POST /api/admin/reports/:id/decision {decision, statement, ground?,
  affectedKey?, apply?, notify?}` mit `decision` ∈ `no_action|content_removed|board_readonly|board_hidden|board_deleted|
  account_locked`; schreibt der meldenden Person (Art. 16 Abs. 5) und der betroffenen (Art. 17) mit Begründung und
  Rechtsbehelf), Boards sperren/entsperren/löschen, Konten sperren/entsperren, Personen suchen. Werkzeug:
  `tools/admin.mts`.

## 7. KI-Zugang (MCP): persönliche API-Tokens

Ein KI-Assistent (MCP-Server unter `mcp/`, Bedienung und Tools: `docs/features/mcp.md`) arbeitet mit einem
**persönlichen API-Token** wie die Person, der es gehört. Server: `server/src/api-tokens.ts`.

| Methode + Pfad | Wer | Antwort |
|---|---|---|
| `GET /api/tokens` | Cookie-Sitzung | `{ok, tokens: ApiTokenInfo[], mcpUrl}` – eigene Tokens, neueste zuerst |
| `POST /api/tokens` `{label?}` | Cookie-Sitzung | 201 `{ok, token: ApiTokenInfo, secret, mcpUrl}` – `secret` (`stk_` + 32 Byte base64url) gibt es **nur hier** |
| `DELETE /api/tokens/:id` | Cookie-Sitzung | `{ok}` – widerrufen; offene Sync-Verbindungen des Tokens werden getrennt; 404 `not_found` bei fremden/unbekannten |
| `GET /api/tokens/me` | Token | `{ok, user: {key,name,isOrga}, ai: {key,name,isOrga}, token: {id,label}}` |

- `ApiTokenInfo` = `{id, label, hint (letzte 4 Zeichen), createdAt, lastUsedAt, expiresAt}`. **Ablauf:** ein Token, das
  12 Monate nicht benutzt wurde, gilt nicht mehr (401) und wird stündlich gelöscht; `expiresAt` = (`lastUsedAt` bzw.
  `createdAt`) + 365 Tage. Jede Nutzung schiebt es hinaus. `label` ≤ 60 Zeichen (fehlt =
  „KI-Assistent“), höchstens 20 Tokens je Person (409 `too_many`). Tokens verwalten geht nur mit Cookie-Sitzung, nicht
  mit einem Token (403 `forbidden`). `mcpUrl` = Env `MCP_PUBLIC_URL`, sonst `{PUBLIC_URL}/mcp`.
- **Benutzen:** Header `Authorization: Bearer stk_…` statt Cookie – für alle Endpunkte mit Sitzungspflicht (§3, mit
  `X-Stachel: 1` bei schreibenden) und beim WebSocket-Upgrade auf `/sync` (dann gilt die große Nachrichtengrenze wie mit
  Sitzung). Rechte = die der Person (zentrale Prüfung §6). Unbekanntes/widerrufenes Token → 401 `not_logged_in` bzw.
  Sync-Ablehnung `not_logged_in`.
- **Speicher:** Tabelle `api_tokens` nur mit SHA-256-Hash; dazu Nutzer, Name, Orga, das Org-Token der anlegenden
  Sitzung (Modus local: Konto; verschlüsselt wie §1) für die Nachprüfung: wie Sitzungen alle 6 h (§1); ungültig/gesperrt
  → Token gelöscht. Konto löschen bzw. „Meine Daten löschen“, Passwort zurücksetzen/ändern löschen alle Tokens der Person (§6).
  `last_used_at` höchstens einmal je Minute. Kein Ablaufdatum.
- **Im Board:** Der Sync-Server gibt einer Token-Verbindung die Identität `user = { key: "ai:<user_key>", name:
  "KI (für <Name>)" }`. Damit erscheint der Assistent in Anwesenheit, Versionsverlauf usw. als eigene Person mit eigener
  Farbe; seine Awareness muss genau diese Angaben tragen (§4). Objekte, die er anlegt, haben `createdBy` = `user_key` der
  Person. „Zuletzt geöffnet“ zählt nicht.

## 8. Native App-Schnittstelle (v1)

Für Stachel **nativ in einer App** (Flutter, ohne WebView; Konzept `docs/native_flutter_konzept.md`). Die App
spricht **kein Yjs**: Der Server bleibt einziger Yjs-Schreiber und liefert JSON auf Objekt-Ebene (Schnappschuss +
Feld-Patches). Server-Code: `server/src/native/`. Seit der eigenständigen **Stachel-App** (Flutter, `com.intsode.stachel`,
Konzept `docs/stachel_app_konzept.md`) in beiden Modi: die App einer Organisation („Org-App“, bindet das Flutter-Paket
`stachel_client` ein) nur im Modus `org` (Org-Token), Stachel-App im Modus `local` (E-Mail + Passwort) bzw. `org`
(Benutzername + Passwort über `STACHEL_ORG_LOGIN_URL` oder QR über die Org-App).
Typen/Konstanten für Server und Tests: `shared/native.ts`. Beispiel-Daten: `docs/native_fixtures/` (§8.9).
Parität Web ↔ App: `docs/native_paritaet.md` (§8.10).

### 8.1 App-Sitzung (Org-Token bzw. Zugangsdaten → Stachel-Token `sts_…`)

| Methode + Pfad | Wer | Antwort |
|---|---|---|
| `POST /api/auth/app-session` | Org-App, `Authorization: Bearer <Org-Token>`, ohne Body (kein `X-Stachel` nötig, wie `app-code`) – **nur Modus org** | 200 `{ok, token: "sts_…", user: {key,name,isOrga}, expiresAt}` · 401 `invalid_token` · 403 `pending`/`forbidden` · 502 `org_unreachable` · 429 `rate_limited` (60 / 5 min je IP) · Modus local: 404 `not_found` (mit Authorization-Header) bzw. 400 `invalid_input` (ganz ohne) |
| `POST /api/auth/app-session` | Stachel-App, Modus **local**: JSON `{email, password}` (kein `X-Stachel` nötig) | 200 wie oben · 400 `invalid_input` (Feld fehlt/leer) · 401 `wrong_login` · 403 `not_verified` (nur bei richtigem Passwort) · 429 `rate_limited` – Prüfungen, Sperren und Codes **wie `POST /api/auth/login`** (dieselbe Funktion, dieselben Zähler) |
| `POST /api/auth/app-session` | Stachel-App, Modus **org**: JSON `{username, password}` (über `STACHEL_ORG_LOGIN_URL`) | 200 wie oben · 400 `invalid_input` · 401 `invalid_credentials` · 403 `pending`/`forbidden` · 429 `rate_limited` · 502 `org_unreachable` · 404 `not_found` ohne Login-Adresse – **wie `POST /api/auth/password`** |
| `GET /api/auth/qr/:code/wait` | Stachel-App mit `X-Stachel-App: 1` und Cookie `stachel_pair` (Modus org) | wie §2, bei `approved` aber `{ok, status:"approved", user, token:"sts_…", expiresAt}` statt Sitzungs-Cookie |
| `GET /api/auth/me` | App mit `Authorization: Bearer sts_…` | 200 `{ok, user, expiresAt}` (prüft wie bei Cookies alle 6 h das Org-Token nach) · 401 `not_logged_in` |
| `DELETE /api/auth/app-session` | App mit `Authorization: Bearer sts_…` und `X-Stachel: 1` | 200 `{ok}` (auch wenn die Sitzung schon weg ist) – löscht die Sitzung und trennt ihre Native-Verbindungen |

- Body mit `password`, `email` oder `username` = Zugangsdaten (das Bearer-Token zählt dann nicht). Zusätzlich zur
  Login-Sperre gilt die Bremse 60 / 5 min je IP für alle Aufrufe der Route.
- **QR-Anmeldung der Stachel-App** (Modus org, „Mit der {Org-App}“): `POST /api/auth/qr` mit `X-Stachel: 1` →
  `{code, url, expires_at}` + `Set-Cookie: stachel_pair=<geheim>; Path=/api/auth/qr; HttpOnly; Max-Age=300`. Die App merkt
  sich den Cookie-Wert und schickt ihn bei jedem `GET /api/auth/qr/<code>/wait` als `Cookie: stachel_pair=<geheim>` mit,
  dazu `X-Stachel-App: 1` (ohne Cookie → 403 `wrong_browser`). Die App öffnet `url` (`{PUBLIC_URL}/qr/<code>`, App-Link der
  Org-App, die bestätigt) und pollt `wait` (≤ 25 s je Aufruf, bei `pending` sofort wieder; 410 `expired` → neuen
  Code holen, Codes gelten 2 min). `approved` liefert das `sts_`-Token (Sitzung wie beim Bearer-Weg, Nachprüfung über das
  Org-Token der bestätigenden App) und löscht `stachel_pair`; einmal einlösbar.
- Das Token ist eine **normale Stachel-Sitzung** (Tabelle `sessions`, nur der SHA-256-Hash von `sts_<32 Byte base64url>`
  wird gespeichert, dazu das Org-Token für die Nachprüfung §1; Modus local: `local:<konto-id>` wie beim Cookie-Login,
  die Nachprüfung fragt das Konto). Identität = die Person selbst (Modus org die `id` des Identitätsdienstes,
  Modus local `u:<id>`; nicht „KI (für …)“); sie erscheint in `GET /api/users`, „Zuletzt geöffnet“ zählt
  (beim Öffnen über §8.4).
- **Laufzeit:** 30 Tage ab Anlegen; jede Nachprüfung (spätestens alle 6 h bei `GET /api/auth/me` bzw. beim Verbinden
  über §8.4) verlängert auf 30 Tage ab dann. Meldet der Identitätsdienst das Token ungültig/gesperrt → Sitzung gelöscht.
- **Benutzen:** `Authorization: Bearer sts_…` gilt für alle Endpunkte mit Sitzungspflicht (§3: Boards, Bilder
  `GET /api/images/:id?w=256|1024`, Vorschaubilder, Favoriten, SSE `GET /api/boards/events`, Personen …), mit
  `X-Stachel: 1` bei schreibenden (wie API-Tokens §7) – und für den WebSocket §8.4. Ein Cookie wird nie gesetzt. Im
  Modus local zusätzlich Konto (`GET|PATCH /api/account`, `POST /api/account/password|delete`) und Teilen (§6).
- **App-Ablauf:** beim Start/Öffnen des Team-Bereichs vorhandenes `sts_`-Token benutzen; bekommt die App 401
  `not_logged_in` (HTTP) bzw. Close-Grund `not_logged_in` (WebSocket), holt sie **einmal still** ein neues Token per
  `POST /api/auth/app-session`. Antwortet das mit 401 `invalid_token`, ist das Org-Token selbst ungültig →
  `toTeamLogin` (nur dann abmelden; `forbidden`/`pending`/`org_unreachable` zeigen einen Hinweis). Abmelden im
  Team-Bereich ruft `DELETE /api/auth/app-session` und löscht den App-Cache der Boards.
- **„Im Browser öffnen“** (Notausgang bis E2): `POST /api/auth/app-code` (§2), dann im **System-Browser**
  `{url}&b=<boardId>&browser=1` öffnen. `browser=1` leitet auf `/?b=<id>` bzw. `/` **ohne** `app=1` weiter (die Web-App
  verhält sich dann nicht wie im App-WebView).

### 8.2 `GET /api/native/info` (ohne Sitzung)

`200 {ok, proto: [1], minApp: string|null, minApps: {org: string|null, stachel: string|null}, path: "/native/v1",
features: string[], actions: {<name>: <version>}, presenceExtra: string[], limits: {maxOps, maxMessageBytes, maxTextLength}}`
– `Cache-Control: no-cache`. Mindestversion je App: `minApps.org` (Env `STACHEL_NATIVE_MIN_APP`, z. B. `"1.22.0"`) für
die Org-App, `minApps.stachel` (Env `STACHEL_NATIVE_MIN_STACHEL_APP`) für die Stachel-App; `null` = keine. `minApp` =
`minApps.org` (älteres Feld, bleibt). Ältere App zeigt „Bitte die {Org-App} (bzw. Stachel-App) aktualisieren“
statt kaputter Darstellung. Unterstützt der Server die eigene `proto`-Version nicht (nicht in
`proto`), gilt dasselbe. `features` und `actions` (Web-Aktionen mit Version, §8.12) wie in `welcome` (§8.4),
`presenceExtra` = Awareness-Felder, die die App über `presence.extra` setzen darf (§8.4).

### 8.3 Board-Liste (vorhandene Endpunkte, §3)

Keine eigenen Endpunkte: `GET /api/boards` (mit `favorite`, `openedAt`, `thumbnailAt`, `template`, zuletzt geändert
zuerst), `PUT|DELETE /api/boards/:id/favorite`, `GET /api/boards/:id/thumbnail?v=<thumbnailAt>`, `POST /api/boards`
`{title}`, `PATCH /api/boards/:id` `{title}`, Live-Liste über `GET /api/boards/events` (SSE). **Favoriten** = `favorite`,
**„Zuletzt geöffnet“** = nach `openedAt` absteigend (nur Boards mit `openedAt`), **Suche** = in der App über `title`
(Groß/klein egal; die Liste ist klein). Vorlagen (`template: true`) zeigt die App wie das Web getrennt bzw. gar nicht.

### 8.4 WebSocket `wss://<origin>/native/v1`

- **Verbinden:** WebSocket-Upgrade auf `/native/v1` mit `Authorization: Bearer sts_…` (empfohlen; alternativ `token`
  im `hello`). Fremder `Origin` (falls gesendet) → HTTP 403, Server fährt herunter → HTTP 503 (später neu verbinden).
  Textrahmen mit JSON, `permessage-deflate` an. Jede Nachricht hat `t`; unbekannte `t` und unbekannte Felder werden auf
  beiden Seiten **ignoriert** (nur additive Erweiterungen in v1). **Ein Board je Verbindung.**
- Nachrichten der App höchstens **4 MB**; ohne gültiges Token im Upgrade-Header (Anmeldung nur über `hello.token`)
  gilt für die ganze Verbindung höchstens 64 KB je Nachricht. Erste Nachricht muss binnen 10 s `hello` sein.
- **Lebenszeichen:** Server pingt (WebSocket-Ping) alle 10 s und trennt nach zwei verpassten Antworten. Die App schickt
  alle 10 s `{"t":"ping"}` → `{"t":"pong"}`; kommt 25 s lang nichts, verbindet sie neu (mit `resume`).
- **Ablehnen/Trennen:** zuerst `{"t":"error","error":"<code>","message":"<deutsch>"}`, dann Close mit Code + Grund:

| Close | Grund (`error`) | Bedeutung | App |
|---|---|---|---|
| 4401 | `not_logged_in` | Token ungültig/abgelaufen/abgemeldet | einmal neues Token (§8.1), dann neu verbinden |
| 4404 | `unknown_board` | Board gibt es nicht | „Board nicht verfügbar“ |
| 4410 | `board_deleted` | Board liegt im Papierkorb (vorher kommt live `event board.deleted`) | Hinweis wie Web (§3 Papierkorb, `GET /api/trash/:id`) |
| 4403 | `no_access` | keine Rechte (Modus local) | Hinweis |
| 4000 | `access_changed` | Rolle geändert | neu verbinden |
| 4426 | `upgrade_required` | `hello.proto` bzw. App-Version zu alt | „Bitte App aktualisieren“ |
| 4400 | `invalid_input` | Protokollfehler (kein/kaputtes `hello`, kein JSON, zu groß) | Fehler melden, nicht endlos neu verbinden |
| 4429 | `rate_limited` | zu viele Nachrichten | nach ≥ 5 s neu verbinden |
| 1001 | `server_restart` | Server startet neu | nach 1–3 s neu verbinden (Resume schlägt dann fehl → Schnappschuss) |
| 1013 | `too_slow` | App liest nicht schnell genug (Sendepuffer > 8 MB) | neu verbinden mit `resume` |

#### App → Server

```jsonc
{"t":"hello","proto":1,"board":"abc","app":"1.22.0+31","client":"org","resume":{"epoch":"Xy…","rev":4711},"want":["objects","ext"]}
{"t":"presence","cursor":{"x":1,"y":2},"selection":["n_8f…"],"editing":"n_8f…","viewport":{"x":0,"y":0,"w":390,"h":800}}
{"t":"ops","req":12,"ops":[ … §8.6 … ]}
{"t":"step"}                          // Undo-Schritt abschließen (Ende einer Geste)
{"t":"undo","req":13}  {"t":"redo","req":14}
{"t":"ping"}
```

- `hello`: `proto` (Pflicht, 1), `board` (Board-ID `[A-Za-z0-9_-]{1,64}`), `app` (Version `x.y.z[+build]`, für die
  Mindestversion), `client` (optional: `"org"` = Standard, auch bei fehlendem/unbekanntem Wert, bzw. `"stachel"` –
  wählt `minApps.org` bzw. `minApps.stachel`, §8.2; zu alt → 4426 `upgrade_required` mit „Bitte die {Org-App}
  aktualisieren.“ bzw. „Bitte die Stachel-App aktualisieren.“), `resume` (optional, letzter bekannter Stand), `want` (optional; `"objects"` immer, `"ext"` = alle
  Strukturen der Feature-Module, oder einzelne Namen wie `"collab.comments"`; Standard `["objects","ext"]`), `token`
  (nur ohne Authorization-Header).
- `presence`: Teil-Aktualisierung (fehlende Felder bleiben, `null` löscht): `cursor` Board-Koordinaten, `selection`
  ≤ 200 Objekt-IDs, `editing` Objekt-ID, in deren Text die Person schreibt (→ Awareness `richtext.caret` ohne
  Schreibmarke, das Web zeigt „schreibt hier“), `viewport` `{x,y,w,h}` in Board-Koordinaten (→ `collab.viewport`,
  für „Folgen“). Höchstens ~20/s (mehr wird gedrosselt, der letzte Stand gilt). Seit E3 (`features` enthält
  `"uploads"`): `uploads` = laufende Bild-Uploads `[{x, y, w, h, color?}]` (Weltkoordinaten, höchstens 10, `[]`/`null`
  = keine) → Awareness `collab.uploads`, das Web zeigt „Mara lädt hoch …“ an der Stelle (docs/features/collab.md).
- `presence.extra` (seit F1, `features` enthält `"extra"`): weitere Awareness-Felder der Feature-Module wie das Web sie
  setzt, als Teil-Aktualisierung je Schlüssel (fehlend = bleibt, `null` = entfernen). Nur diese Schlüssel (Liste auch in
  `/api/native/info` `presenceExtra`); unbekannte Schlüssel und ungültige Werte ignoriert der Server still:

  | Schlüssel | Wert (wie im Web, `docs/features/collab.md` bzw. `structure.md`) |
  |---|---|
  | `collab.status` | `"active"` \| `"idle"` \| `"away"` (App im Hintergrund = `idle`) |
  | `collab.follow` | user key der Person, der ich folge (≤ 200 Zeichen) |
  | `collab.summon` | `{id, rect:{x,y,w,h}}` „Alle zu mir holen“ (`id` ≤ 16 Zeichen, neue `id` je Holen); `ts` setzt der **Server** (Server-Uhr, das Web nimmt nur frische < 8 s) |
  | `collab.laser` | `{s, p:[x,y, x,y, …]}` Laserspur (`s` = laufende Nummer des letzten Punkts, ganze Zahl ≥ 0; `p` ≤ 400 Zahlen, Weltkoordinaten) |
  | `collab.chat` | `{text, typing?}` Kurznachricht am eigenen Zeiger (`text` ≤ 120 Zeichen, `typing` bool) |
  | `structure.present` | `{frameId, index, total, title, from?}` Präsentation läuft (`frameId` Objekt-ID, `index`/`total` ganze Zahlen ≥ 0, `title` ≤ 300; `from` = clientId der Person, von der übernommen wurde) |
  | `structure.handover` | `{to, id, index, frameId}` Angebot „Präsentation übergeben“ an user key `to` (`id` ≤ 16 Zeichen), `docs/features/private.md` §7 |

  Beispiel: `{"t":"presence","extra":{"collab.status":"idle","collab.laser":null}}`. Die Felder anderer kommen wie bisher
  roh unter `peers[].extra`.

#### Server → App

```jsonc
{"t":"welcome","proto":1,"epoch":"Xy…","rev":4711,
 "board":{"id":"abc","title":"Sommerfest"},
 "user":{"key":"m:12","name":"Mara","isOrga":false},"role":"edit","color":"#1763b5","clientId":123456,
 "features":["objects","ext","presence","ops","undo","text","mind","act","extra"],"below":["frame"],
 "actions":{"table.addRow":1,"structure.template":1},
 "snapshot":{"objects":[{…Objekt-JSON §8.5…}],"ext":{"collab.comments":{…}}},
 "peers":[…],"history":{"canUndo":false,"canRedo":false}}
{"t":"resumed","proto":1,"epoch":"Xy…","rev":4720,"board":{…},"user":{…},"role":"edit","color":"#1763b5","clientId":123456,
 "features":[…],"below":["frame"],"actions":{…},"patches":[{…patch ohne "t"…}],"peers":[…],"history":{…}}
{"t":"patch","rev":4712,"by":"m:7","changes":[
   {"id":"n_8f","set":{"x":40,"content":{"type":"doc","content":[…]}},"unset":["dash"]},
   {"id":"s_77","removed":true},
   {"id":"t_1","created":{…Objekt-JSON…}}],
 "ext":{"collab.comments":{…ganze Struktur…}}}
{"t":"ack","req":12,"rev":4712}   {"t":"ack","req":12,"rev":4712,"conflict":["n_8f"]}   {"t":"nack","req":12,"error":"invalid_input","message":"…","index":3}
{"t":"ack","req":15,"rev":4720,"results":{"0":{"select":["k1-1","k1-2"],"focus":["k1-1","k1-2"]}}}   // mit Web-Aktionen (§8.12)
{"t":"history","canUndo":true,"canRedo":false}
{"t":"presence","peers":[{"id":987,"key":"m:7","name":"Jonas","color":"#ec4e92","client":"web","since":1730000000000,
   "cursor":{"x":10,"y":20},"selection":["n_8f"],"editing":null,"extra":{"collab.status":"active"}}]}
{"t":"event","type":"board.renamed","title":"…","titleSeq":5}
{"t":"event","type":"board.deleted","by":"Mara","byKey":"m:12"}
{"t":"pong"}
{"t":"error","error":"upgrade_required","message":"Bitte die Vereins-App aktualisieren."}
```

- **Schnappschuss** (`welcome.snapshot`): `objects` = alle Objekte in **Zeichenreihenfolge von unten nach oben**
  (Typen aus `below` – Rahmen – zuerst, dann `z` Byte-weise aufsteigend, bei gleichem `z` nach `id` Byte-weise; das ist
  dieselbe Regel, nach der die App nach Patches neu sortiert, §4). `ext` = Feature-Strukturen nach `want` (§8.7).
- **Patches:** je Yjs-Transaktion, die etwas Sichtbares ändert, genau ein `patch`; `rev` steigt je Patch um 1
  (innerhalb einer `epoch`). Jede Änderung eines Objekts: `created` (ganzes Objekt), `removed`, oder `set` (geänderte
  Felder mit **ganzem** neuen Wert – auch `content`, `table`, `from` usw.) + `unset` (entfernte Felder). Felder, die die
  App nicht kennt, übernimmt sie trotzdem in ihr Objekt (nie wegwerfen). `by` = `user_key` der Person, deren Änderung
  das war (`ai:<key>` für KI-Assistenten, die eigene bei eigenen Ops), `null` = Server (z. B. Version wiederhergestellt).
- **Resume:** `epoch` ist zufällig je Laden des Boards im Server (Neustart, Board länger als 10 min ohne App
  geschlossen → neue Epoche). Stimmt `hello.resume.epoch` und liegen alle Patches nach `resume.rev` noch im
  Ringpuffer (die letzten 1 000 Patches bzw. 10 min), antwortet der Server mit `resumed` und genau diesen Patches
  (`patches: []`, wenn nichts fehlt); sonst mit `welcome` und vollem Schnappschuss. Die App wendet `resumed.patches`
  der Reihe nach auf ihren gespeicherten Stand an.
- **Anwesenheit:** `welcome`/`resumed` tragen `peers`; danach `presence` mit der **ganzen** Liste bei jeder Änderung
  (höchstens 10/s). Ohne die eigene Verbindung (`clientId`), aber mit anderen Geräten/Tabs derselben Person.
  `client`: `web` | `app` | `ai`. `editing` aus `richtext.caret.id` des Web. Weitere Awareness-Felder roh unter `extra`.
  Die App erscheint im Web als die Person selbst (Awareness `user` = Sitzung, Farbe wie Web: erste freie Farbe aus
  `PRESENCE_COLORS`, bei eigenen Tabs deren Farbe; `client: "app"`, alle 15 s erneuert, beim Trennen sofort entfernt).
- **Privater Modus** (seit `features` enthält `"private"`, `docs/features/private.md` §5): Mit Rolle `edit`/`owner`
  kommt nach `welcome`/`resumed` immer `{"t":"private","objects":[…Objekt-JSON…]}` = die **ganze** eigene Privat-Ablage
  (unten nach oben), danach bei jeder Änderung und **vor dem `ack`** einer ops-Nachricht, die sie geändert hat. Solange
  `ext["private.mode"].on` gilt, legt `create` Haftnotizen, Texte, Formen (und Verbinder an privaten Objekten) dort an;
  `update`/`remove`/`order`/`text`/`undo`/`redo` wirken auf die Ablage, wenn die ID dort liegt (kein `patch` dafür, `ack.rev`
  = Stand des Boards). Platzhalter fremder privater Objekte stehen in `ext["private.hidden"]`.
- **Rolle** (`role`, nur im Modus local anders als `edit`/`owner`): `owner`/`edit` = alles. `comment` = nur die
  Kommentar-Ops `comment`, `reply`, `commentEdit`, `commentDelete`, `resolve`, `mentionsRead` (schreiben nur
  `collab.comments`/`collab.reads` – wie das Web unter dieser Rolle, §6); jede andere Op (auch `react`, `mind`, `act`) in
  einer `ops`-Nachricht → `nack forbidden` mit `index` der ersten verbotenen Op und Meldung „Du darfst hier nur
  kommentieren.“, nichts aus der Nachricht wird geschrieben; `undo`/`redo` ebenso `nack forbidden`. `view` = alle `ops`,
  `undo`, `redo` → `nack forbidden` „Du darfst dieses Board nur ansehen.“ Anwesenheit (`presence`) geht für alle Rollen.
- `board.renamed`: Titel nur übernehmen, wenn `titleSeq` größer als der zuletzt gesehene (§4); `welcome.board.title` ist
  der Stand beim Verbinden. `board.deleted`: danach Close 4410.

### 8.5 Objekt-JSON

- Alle Felder des Objekt-Y.Map **roh** (wie im Dokument, keine Standardwerte eingesetzt), `id` = Schlüssel in
  `objects`. Objekte ohne `type` (String) lässt der Server weg (das Web ignoriert sie auch). **Unbekannte Typen und
  Felder** kommen unverändert mit (die App zeigt einen Platzhalter, §8.10).
- Felder, die im Dokument selbst Y-Typen sind, kommen als festes JSON:

| Feld | im Dokument | JSON |
|---|---|---|
| `content` (sticky/text/shape/connector, §4 „Rich-Text“) | `Y.XmlFragment` | ProseMirror-JSON `{"type":"doc","content":[…]}`: Knoten `{type, attrs?, content?}`, Text `{type:"text", text, marks?:[{type, attrs?}]}`; Namen wie `RICH_TEXT_NODES`/`RICH_TEXT_MARKS` (+ `horizontalRule`); Attribute wie gespeichert (z. B. `heading.attrs.level`, `taskItem.attrs.checked`, `link.attrs.href`, `textStyle.attrs.color`/`fontSize`, `highlight.attrs.color`) |
| `table` (table) | `Y.Map` | `{rows:[id], cols:[id], cells:{"<row>:<col>": text}, widths:{<col>: Gewicht}}` (bereinigt wie `safeTable`) |
| `timeline` (timeline) | `Y.Map` | `{lanes:[id], names:{<lane>: text}, items:{<id>: {lane,start,end,color?,ms?,title}}}` (bereinigt wie `safeTimeline`) |
| `docPages` (document) | `Y.Map` | `{"0": imageId, "1": …}` |
| `desc` (card) u. a. | `Y.Text` | String |
| sonstige Y-Typen | – | `toJSON()` (XmlFragment als ProseMirror-JSON) |

- **App-seitige Standardwerte** wie `normalize` im Web: fehlende/ungültige `x`/`y` = 0, `w`/`h` = 100 (mindestens 1),
  `z` = `""`. Rich-Text gilt nur, wenn sein Klartext (`plainOf`, Blöcke/Listeneinträge mit `\n`) gleich `text` ist,
  sonst zeigt die App `text` (§4 „Alter Client“).
- Felder je Typ: `shared/protocol.ts` + `docs/features/*.md`; Überblick und App-Stand in `docs/native_paritaet.md`.

### 8.6 Operationen (App → Server)

`{"t":"ops","req":<int>,"ops":[…]}` – alle Ops einer Nachricht laufen **in einer Yjs-Transaktion** (ein Undo-Schritt,
außer die App teilt mit `step`), werden **vorher vollständig geprüft** (Fehler → `nack`, nichts geschrieben) und danach
mit `ack {req, rev}` bestätigt (`rev` = Stand nach den eigenen Änderungen; der zugehörige `patch` mit `by` = eigener
Key kommt vorher). Schreibregeln = die des Web-Stores (`web/src/board/store.ts`): `createdBy`/`updatedAt` setzt der
Server, Löschen nimmt angedockte Verbinder mit und löst Gruppen mit nur einem Mitglied auf, Ebenen über Fractional-Index.

```jsonc
{"op":"create","objects":[{"id":"n_8f","type":"sticky","x":0,"y":0,"w":200,"h":200,"color":"#fff27a","text":"Hallo"}]}
{"op":"update","patches":{"n_8f":{"x":40,"y":12},"c_1a":{"color":"#1763b5","dash":null}}}   // null = Feld entfernen
{"op":"remove","ids":["s_77"]}
{"op":"order","ids":["n_8f"],"to":"front"}                                                  // front | back
{"op":"text","id":"n_8f","base":4711,"epoch":"Xy…","baseDoc":{…},"doc":{"type":"doc","content":[…]}} // Rich-Text
{"op":"mind","do":"child","id":"n_1","new":"n_2"}                                      // Mindmap (unten)
{"op":"act","name":"table.addRow","args":{"id":"t_1","at":2},"key":"k_7f"}             // Web-Aktion (§8.12)
```

- `create`: `id` **Pflicht** (von der App erzeugt, `[A-Za-z0-9_-]{1,64}`); gibt es die ID schon, wird das Objekt
  übersprungen (Wiederholung nach Funkloch legt nichts doppelt an). Neue Objekte liegen über allem. `content` als
  ProseMirror-JSON baut der Server als Fragment und setzt `text` = Klartext im selben Schritt.
- `update`: nur vorhandene Objekte (fehlende → übersprungen); `id`, `type`, `createdBy`, `updatedAt`, `z` sind nicht
  änderbar (Ebenen über `order`). `content` ersetzt den Rich-Text ganz (+ `text`); feine Text-Bearbeitung mit
  Gleichzeitigkeit kommt als `text`-Op.
- `text` (seit E2, `features` enthält `"text"`): Rich-Text eines Objekts bearbeiten, **ohne** gleichzeitige Eingaben
  anderer zu überschreiben. Felder: `id`, `doc` (neuer Stand der App, ProseMirror-JSON wie §8.5), `base` (`rev`, auf dem
  die App zu bearbeiten begann), optional `epoch` (Epoche dieser `rev`) und `baseDoc` (der Stand, von dem die App
  ausging – **empfohlen**, dann ist die Basis auch über Neustart/neue Epoche hinweg eindeutig). Der Server:
  1. Basis = `baseDoc`, sonst der Rich-Text des Objekts zur Revision `base` (der Spiegel kennt die letzten 40 Stände je
     Objekt; nur bei gleicher bzw. fehlender `epoch`). Als Stand gilt immer `content`, wenn sein Klartext `text` ist,
     sonst `text` als Absätze (§4 „Alter Client“).
  2. Hat seit der Basis niemand den Text geändert → `doc` gilt. Sonst **Rebase**: beide Änderungen (Basis→App,
     Basis→aktuell) werden Zeichen für Zeichen (mit Marks) bzw. Knoten für Knoten zusammengelegt; Änderungen an
     verschiedenen Stellen bleiben beide, gleichzeitig an derselben Stelle eingefügter Text auch (erst der vorhandene,
     dann der der App). Nur wenn beide dieselbe Stelle unterschiedlich geändert haben, gilt die App (der spätere Stand)
     und `ack` meldet `conflict: ["<id>"]` (App zeigt „Notiz wurde gleichzeitig geändert“). Basis unbekannt (alte Epoche
     ohne `baseDoc`) → `doc` gilt, `conflict`, wenn der aktuelle Stand abwich.
  3. Ins `Y.XmlFragment` geht nur der Unterschied (gleiche Absätze/Texte bleiben dieselben Yjs-Elemente, Schreibmarken im
     Web bleiben stehen), `text` (Klartext) und `updatedAt` im selben Schritt; ohne Fragment (altes Objekt) wird es
     angelegt. Unbekannte Knoten, Marks und Attribute reicht der Server unverändert durch – die App muss sie behalten.
  Gelöschtes Objekt → `ack` ohne Änderung. Ein Undo-Schritt wie jede Op. Prüfung: `doc`/`baseDoc` Dokumente mit
  `type` je Knoten, Text-Knoten mit `text`, Tiefe ≤ 64, Klartext ≤ 20 000 Zeichen, ≤ 256 KB.
- **Kommentare, Reaktionen, Gelesen-Stand** (seit E3, `features` enthält `"comments"` bzw. `"reactions"`): schreiben
  `collab.comments`, `collab.reactions`, `collab.reads` genau wie das Web-Modul collab (docs/features/collab.md, derselbe
  Code: `web/src/features/collab/comments.ts`, `reactions.ts`); Person = die Sitzung (`by`, `name`), Zeiten setzt der
  Server. IDs (`thread`, `msg`) erzeugt die App (`[A-Za-z0-9_-]{1,64}`): eine Wiederholung (gleiche IDs, auch nach einem
  Server-Neustart) legt nichts doppelt an. Je Op ein eigener Rückgängig-Schritt (wie im Web).

  ```jsonc
  {"op":"comment","thread":"t_1","msg":"m_1","at":{"x":150,"y":60,"objectId":"n_8f","dx":50,"dy":10},"text":"@Jonas Strom klären","mentions":["m:7"]}
  {"op":"reply","thread":"t_1","msg":"m_2","text":"Mach ich","mentions":[]}       // öffnet einen erledigten Thread wieder
  {"op":"commentEdit","thread":"t_1","msg":"m_2","text":"Mach ich morgen","mentions":[]}   // nur eigene Nachrichten
  {"op":"commentDelete","thread":"t_1","msg":"m_2"}   // ohne `msg` bzw. erste Nachricht = ganzer Thread (nur wer ihn begann)
  {"op":"resolve","thread":"t_1","resolved":true}
  {"op":"react","ids":["n_8f"],"emoji":"👍","on":true}   // eigene Reaktion setzen (`on:false` entfernen)
  {"op":"mentionsRead","at":"2026-11-01T12:00:00.000Z"}  // collab.reads der Person (ohne Rückgängig, nie später als jetzt)
  ```

  `at` eines Kommentars: Board-Stelle, mit `objectId` an das Objekt geheftet (`dx`/`dy` = Abstand zu dessen linker
  oberer Ecke, Pin wandert mit). `text` 1–5 000 Zeichen (nicht nur Leerzeichen), `mentions` ≤ 50 user keys (die App
  ermittelt sie wie das Web aus „@Name“, Personen aus `GET /api/users`). Fremde Nachrichten bearbeiten/löschen, Ops
  auf gelöschte Threads/Nachrichten: `ack` ohne Änderung. `emoji` ≤ 16 Zeichen ohne `|`.
- **Mindmaps** (seit Feature `mind`): Der Server führt den Mindmap-Code des Web aus (`web/src/features/structure/mindmap/ops.ts`
  samt automatischem Layout, docs/features/structure.md) – das Ergebnis ist genau das, was ein Browser für dieselbe Aktion
  schreibt (Lage/Größe/`mind` aller Knoten der Mindmap im selben Schritt). Größen aus dem Text wie im Browser: Schriftmaße
  `server/src/native/text-metrics.json` (im Chromium gemessen, `tools/text-metrics.mts`; die App rechnet mit derselben Datei
  vor, `tools/native-mind-fixtures.mts` = Referenzfälle). IDs neuer Knoten erzeugt die App; gibt es sie schon, passiert nichts
  (Wiederholung nach Funkloch). Fehlende Knoten → nichts. Alle Mindmap-Ops einer Nachricht sehen den Stand der Ops davor.

  ```jsonc
  {"op":"mind","do":"child","id":"n_1","new":"n_2","side":"l"}  // Unterthema (Plus/Tab); `side` nur an der Wurzel (Standard r); klappt einen eingeklappten Zweig auf
  {"op":"mind","do":"sibling","id":"n_2","new":"n_3"}           // Thema auf gleicher Ebene darunter (Enter); an der Wurzel nichts
  {"op":"mind","do":"root","new":"n_0","x":0,"y":0,"text":""}    // neue Mindmap, Mitte der Wurzel bei x/y
  {"op":"mind","do":"tree","new":"t","x":0,"y":0,"tree":{"text":"Festival","children":[{"text":"Technik","side":"l"}]}}
                                                                 // neue Mindmap aus Baum (Vorlage); Unterthemen bekommen `t-1`, `t-2` … (≤ 400 Knoten, ≤ 10 Ebenen, Text ≤ 500)
  {"op":"mind","do":"text","id":"n_2","text":"Programm"}        // Text (Klartext, kein Rich-Text) + Layout
  {"op":"mind","do":"collapse","id":"n_1","collapsed":true}     // Zweig ein-/ausklappen (Zielzustand)
  {"op":"mind","do":"remove","ids":["n_1"]}                     // samt Unterthemen, Rest neu angeordnet
  {"op":"mind","do":"drop","ids":["n_2"]}                       // Ende einer Ziehgeste: auf einem Knoten → dort einhängen (Zweigfarbe), sonst nach Höhe einsortieren / Seite der Wurzel wechseln
  {"op":"mind","do":"layout","ids":["n_0"]}                     // Mindmaps dieser Knoten neu anordnen
  ```

  Ziehen = `update` mit der Lage, am Ende der Geste in **derselben** Nachricht `drop` (ein Rückgängig-Schritt).
  **Allgemeine Ops auf Knoten** folgen den Regeln der Web-Laufzeit (auch für ältere Apps): `remove` nimmt die Unterthemen
  mit und ordnet neu an, `create` von Knoten (Duplikat; `mind.parent` wie das Web umschreiben, ohne Eltern = Wurzel) ordnet
  an, `update` von `text`/`w`/`h`/`mind` oder der Lage einer Wurzel ordnet an (Größe lässt sich nicht frei ändern), die Lage
  eines Unterthemas bleibt bis `drop`.
- **Prüfung:** IDs wie oben; `type` `[a-z][A-Za-z0-9_.-]{0,31}`; Zahlen endlich (`x`/`y` |…| ≤ 10 000 000, `w`/`h`
  0 < … ≤ 1 000 000); Texte ≤ 20 000 Zeichen; Farbfelder (`color`, `stroke`, Tag-Farben) `#rgb`/`#rrggbb`/`#rrggbbaa`;
  bekannte Felder mit Typ (Liste in `server/src/native/validate.ts`), unbekannte Felder nur mit Modul-Präfix
  (`<modul>.<feld>`, z. B. `tasks.taskId`); JSON je Objekt ≤ 256 KB, Tiefe ≤ 10; höchstens **500** Einträge
  (Objekte + Patches + IDs) je Nachricht, höchstens 30 `ops`-Nachrichten/s.
- **Idempotenz:** `req` steigt je App-Sitzung (Token) streng. Der Server merkt sich die letzte ausgeführte `req` je
  Sitzung und Board (auch über Wiederverbinden hinweg, solange der Server läuft); eine schon ausgeführte `req` bekommt nur
  `ack` mit aktuellem `rev`. Nach einem Server-Neustart sichern `create` mit fester ID und feldweises `update` dasselbe.
- **Fehler** (`nack.error`): `invalid_input` (mit `index` der Op), `forbidden` (Rolle), `unsupported` (Op bzw.
  Web-Aktion unbekannt, Version zu alt oder noch nicht freigeschaltet, mit `index`), `rate_limited`, `too_large`.
- **Rückgängig:** je App-Sitzung und Board ein eigener Verlauf (nur eigene Änderungen, Origin je Sitzung), `step`
  schließt einen Schritt ab (Ende einer Geste), `undo`/`redo` → `ack` bzw. `nack` (`nothing`, wenn nichts da ist);
  `history` nach jeder Änderung des Verlaufs. Im Versionsverlauf (§3) erscheint die Person.

### 8.7 Feature-Strukturen (`ext`)

Alle benannten Strukturen außer `objects` (§4 „Weitere Y-Strukturen“, z. B. `collab.comments`, `collab.reactions`,
`collab.votes`, `collab.timer`) als JSON (`Y.Map` → Objekt, `Y.Array` → Liste, Y.Text → String, darin enthaltene Y-Typen
ebenso). Im Schnappschuss alle gewünschten (§8.4 `want`), im Patch unter `ext` jede geänderte Struktur **ganz**
(`null` = leer/entfernt). Formate je Struktur: `docs/features/<modul>.md`. Direkt in `ext` schreibt die App nicht;
Kommentare, Reaktionen und der Gelesen-Stand gehen über eigene Ops (§8.6, seit E3).

### 8.8 Geplant

- Weitere Web-Aktionen (§8.12) je Paket des (internen) Paritäts-Audits (P1–P9); die App
  erkennt sie an `welcome.actions`.

### 8.9 Beispiel-Daten für App-Tests

- `docs/native_fixtures/all_types.welcome.json`: `welcome` eines Boards mit **allen Objekttypen** (alle Formen,
  Verbinder-Varianten, Rich-Text mit allen Knoten/Marks, Tabelle, Zeitleiste, PDF-Dokument, Mindmap, Karte, Sticker,
  Icon, Stift, Bild, Rahmen, ein unbekannter Typ) – erzeugt aus dem echten Server-Code.
- `docs/native_fixtures/all_types.patches.json`: Folge typischer Patches (Web ändert/löscht/legt an) auf dieses Board;
  `all_types.after_patches.objects.json` = erwarteter Stand danach.
- `docs/native_fixtures/README.md`: Erzeugen (`tools/native-fixtures.mts`), große Boards (2 000 / 5 000 Objekte) per
  `--big`, Sandbox mit Fake-Identitätsdienst (Modus org) und festen Org-Tokens `sandbox-<name>` (`tools/sandbox.mts --seed`).

### 8.10 Parität

Jeder neue Objekttyp und jedes neue Y-Feld im Web braucht eine Zeile in `docs/native_paritaet.md` (Typ, Felder,
ab welcher App-Version nativ dargestellt). Der Server-Test `server/test/native-parity.test.ts` scheitert, wenn das Web
einen Typ (`defineObjectType`) oder ein Y-Feld (`registerYField`) definiert, das dort oder in `shared/native.ts` fehlt.
Bis die App einen Typ kann, zeigt sie einen grauen Platzhalter in Objektgröße mit „Im Browser ansehen“.

### 8.11 Posteingang der App: `GET /api/native/v1/inbox?since=<iso>`

Für den Hintergrund-Check der Apps (Benachrichtigung bei @Erwähnung bzw. Zuweisung, Konzept §4.5) – der
Identitätsdienst der Organisation bleibt unverändert. Sitzung nötig (`Authorization: Bearer sts_…`; Cookie geht auch), sonst 401.

`200 {ok, now, items:[{id, type:"mention"|"assign", boardId, boardTitle, objectId, threadId, by, byKey, text, at}]}`

- `since` (ISO-Zeit in UTC mit `Z`, sonst 400 `invalid_input`): nur Einträge, die der Server **nach** `since` zuerst
  gesehen hat; ohne `since` die der letzten 7 Tage. Älteste zuerst, höchstens 50. Die App merkt sich `now` als nächstes
  `since` (Server-Uhr, keine Lücken durch die Uhr des Handys); beim ersten Abruf nur Grundlinie, keine Benachrichtigung.
- `mention`: eine Kommentar-Nachricht nennt die Person in `mentions` (nicht die eigene Nachricht); `objectId` = Objekt
  des Threads (`null` = frei auf dem Board), `threadId`, `by`/`byKey` = wer geschrieben hat, `text` = Nachricht (≤ 200
  Zeichen), `at` = Zeit der Nachricht. `assign`: eine Karte (`card`) bekommt die Person als `assignee` – angelegt oder
  geändert durch jemand anderen; `text` = Kartentitel. Jede Nachricht/Person bzw. Karte/Person höchstens einmal.
- Der Server sieht Einträge beim Bearbeiten (Beobachter je geladenem Board auf `collab.comments` und `objects`, Tabelle
  `mentions`, `server/src/native/inbox.ts`); Änderungen ohne Person (z. B. Version wiederhergestellt) zählen nicht, alte
  Stände werden nicht nachgetragen. Boards im Papierkorb erscheinen nicht; Einträge verfallen nach 60 Tagen. Modus local:
  nur Boards mit Zugriff.

### 8.12 Web-Aktionen: Op `act` (seit F1, `features` enthält `"act"`)

Alles, was das Web **berechnet** (Lage, Größe, Layout, Vorlagen, Ausrichten, Tabellen-/Zeitleisten-Struktur,
Abstimmung, Timer …), rechnet die App nicht nach: Sie bittet den Server, eine **Web-Aktion** auszuführen – derselbe
React-freie Code aus `web/src`, den der Browser für diese Aktion aufruft (Grundsatz aus dem internen
Paritäts-Audit). Das Ergebnis im Dokument ist damit genau das des Browsers.

```jsonc
{"t":"ops","req":15,"ops":[
  {"op":"act","name":"structure.template","args":{"template":"retro","x":0,"y":0},"key":"k1","v":1}
]}
// → patch(es) mit by = eigener Key, dann:
{"t":"ack","req":15,"rev":4720,"results":{"0":{"select":["k1-1","k1-2"],"focus":["k1-1","k1-2"],"toast":"Vorlage eingefügt."}}}
```

- **`name`** `<modul>.<aktion>` bzw. `<modul>.<bereich>.<aktion>` (`^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*){1,3}$`, ≤ 64
  Zeichen), Modul = Besitzer der Logik im Web: `core`, `tools`, `structure`, `card`, `table`, `timeline`, `frames`,
  `documents`, `collab`, `richtext`, `mind` (`dev` nur in der Sandbox). Welche es gibt: `welcome.actions` /
  `resumed.actions` / `GET /api/native/info` `actions` = `{"<name>": <version>}`.
- **`args`** (Objekt, Standard `{}`): je Aktion beschrieben im Abschnitt „Native-Aktionen“ von
  `docs/features/<modul>.md`. JSON ≤ 256 KB, Tiefe ≤ 10. Die Aktion prüft sie vollständig, **bevor** irgendetwas der
  Nachricht geschrieben wird.
- **`key`** (optional, empfohlen; `[A-Za-z0-9_-]{1,40}`, von der App je Aktion neu erzeugt): feste IDs für alles, was
  die Aktion anlegt (`<key>-1`, `<key>-2`, … in der Reihenfolge der Aktion, bzw. wie die Aktion es beschreibt) und
  Gedächtnis: dieselbe `key` auf demselben Board wird **nicht noch einmal ausgeführt**, das `ack` trägt das gemerkte
  Ergebnis (solange der Server läuft, die letzten 1 000 je Board). Nach einem Server-Neustart verhindern die festen IDs
  Doppeltes (Aktionen legen eine schon vorhandene ID nicht noch einmal an). Ohne `key` vergibt der Server IDs.
- **`v`** (optional, Standard 1): Version, die die App mindestens braucht. Ist die des Servers kleiner bzw. kennt er
  die Aktion nicht → `nack unsupported` mit `index` (nichts geschrieben). **Versionen:** Eine Aktion bekommt neue
  optionale `args`/Ergebnis-Felder ohne neue Version; ändert sich die Bedeutung, steigt die Version (der Server nimmt
  ältere `v` weiter an, solange die Aktion es beschreibt) oder es gibt einen neuen Namen. Die App blendet Funktionen,
  deren Aktion fehlt oder zu alt ist, **aus** (kein Fehler).
- **Ausführung:** Ops einer Nachricht der Reihe nach. Eine Aktion läuft **wie im Browser** – nicht in der Transaktion
  der übrigen Ops, sondern mit ihren eigenen Schreibschritten auf dem aktuellen Stand (sie sieht alles, was die Ops
  davor geschrieben haben). Eine Nachricht mit `act` kann daher mehrere `patch` erzeugen; `ack` kommt nach allen, `rev`
  = Stand danach. Person = die Sitzung (Versionsverlauf, `by`), Zeiten setzt der Server.
- **Rückgängig** (je Aktion festgelegt, steht in der Doku): `undo` = gehört zum laufenden Rückgängig-Schritt der
  Sitzung wie jede Op (die App trennt mit `step`; schließt der Web-Code selbst einen Schritt ab, tut er es hier auch);
  `none` = nicht rückgängig zu machen, wie im Web (z. B. PDF blättern, Abstimmung, Timer, Board-Hintergrund).
- **Ergebnis** `ack.results` = `{"<index der Op>": Ergebnis}` für jede `act`-Op der Nachricht (auch bei
  Wiederholung mit gleicher `key`). Ergebnis-Felder (alle optional, wie das Web nach der Aktion handelt):
  `select` (IDs, die danach gewählt sind), `focus` (IDs bzw. `{x,y,w,h}`, auf die die Kamera einpasst), `edit` (ID,
  deren Text sofort bearbeitet wird), `toast` (Hinweistext des Web, deutsch), `data` (aktionsspezifisch), `skipped:
  true` (nichts zu tun, z. B. Ziel inzwischen gelöscht), `error: "failed"` + `message` (Fehler im Web-Code – sollte nie
  vorkommen; die übrigen Ops der Nachricht gelten). Eine schon ausgeführte `req` (Wiederholung nach Funkloch) bekommt
  `ack` mit den gemerkten `results` (die letzten 100 `req` je Sitzung und Board, solange der Server läuft); danach
  bzw. nach einem Neustart hilft die `key` (siehe oben, ohne `results`, wenn auch sie vergessen ist).
- **Zählung:** eine Aktion zählt als 1 Eintrag (große Aktionen mehr, steht in der Doku) für die 500 je Nachricht.
- **Rolle:** wie alle Ops (`comment`/`view` → `nack forbidden`). **Offline:** die App stellt Aktionen in ihre
  Warteschlange und zeigt bis zum `ack` „wird ausgeführt, sobald online“ (keine lokale Vorschau).
- **Sandbox-Aktion** `dev.note` (nur mit Env `STACHEL_NATIVE_DEV_ACTIONS=1`, z. B. `tools/sandbox.mts`): legt eine
  Haftnotiz an – zum Testen der App ohne echte Aktion. `args {x, y, text?}`, Undo `undo`, neue ID `<key>-1`,
  Ergebnis `{select:[id], focus:[id], edit:id, toast:"Notiz angelegt."}`.

**Neue Aktion anlegen (Server):** im Web-Modul, dem die Logik gehört, `web/src/features/<modul>/native.ts` (Kern:
`web/src/board/ops/native.ts`) mit `defineNativeAction(name, {version, undo, args, run})` aus
`web/src/native/registry.ts` (Prüf-Helfer in `web/src/native/args.ts`); die Sammel-Datei `web/src/native/actions.ts`
importiert schon alle Paket-Dateien (nicht ändern). `run(store, args, ctx)` bekommt den `BoardStore` der Sitzung und
`ctx` = `{user, now, id(n), exists(id), measure}`; der Code muss React-frei sein. Test
`server/test/native-act-<modul>.test.ts` (Ergebnis = dieselbe Web-Funktion direkt auf einem Browser-Store), Doku in
`docs/features/<modul>.md` „Native-Aktionen“.

### 8.13 Schriftmaße und Web-Konstanten für die App

- **Schriftmaße** `server/src/native/text-metrics.json` (`tools/text-metrics.mts`, im Chromium mit den Schriften der
  Web-App gemessen; Server und App rechnen damit wie `measureText` im Browser): `{version, size, chars, fonts, aliases}`.
  `fonts["<Familie>|<Gewicht>"]` bzw. `fonts["<Familie> Italic|<Gewicht>"]` = `{widths, pairs, triples}` (Breiten in
  1/`size` em je Zeichen aus `chars`, Unterschneidung je Paar, Ligaturen je Dreiergruppe); Familien `Barlow`,
  `Barlow Condensed`, `Source Serif 4`, `JetBrains Mono`, Gewichte 400–900 in Hunderterschritten, normal und kursiv.
  `aliases["<Schlüssel>"] = "<Schlüssel>"`, wenn der Browser für diesen Schnitt dieselbe Schriftdatei nimmt wie für einen
  anderen (z. B. `JetBrains Mono|500` → `JetBrains Mono|400`). Breite = Summe Zeichenbreiten (+ Paar + Dreiergruppe,
  in dieser Reihenfolge) / `size` × Schriftgröße; Zeichen ohne Eintrag: Emoji (≥ U+1F000, U+2600–27BF) 1,25 em,
  CJK (U+2E80–FFEF) 1 em, sonst 0,56 em. Familie aus dem CSS-Namen (erster Name der Liste, Anführungszeichen weg,
  Groß/klein egal): enthält `condensed` → Barlow Condensed, `serif` → Source Serif 4, `mono` → JetBrains Mono, sonst
  Barlow. Gewicht auf Hunderter gerundet, 400–900; Schlüssel erst in `fonts`, dann über `aliases`. Gleich ist ein Schnitt,
  wenn die Zeichen bis U+00FF und die Unterschneidung gleich sind (Zeichen ohne eigene Glyphe nimmt der Browser aus
  Systemschriften – die drei Mindmap-Schnitte `Barlow Condensed|700`, `Barlow|600`, `Barlow|500` sind unverändert).
- **Web-Konstanten** `docs/native_fixtures/web/constants.json` (`tools/native-web-constants.mts`, aus dem Web-Code
  erzeugt; `server/test/native-constants.test.ts` scheitert, wenn die Datei nicht mehr zum Web passt): Farbpaletten,
  Schriftgrößen, Formen-Katalog, Stempel/Emoji/Icons, Vorlagen-Liste, Karten-Status, Zeitleisten- und Mindmap-Farben,
  Reaktions-Emojis, Timer-Voreinstellungen, Rahmen-Formate, Hinweistexte. Die App erzeugt daraus
  `lib/src/web/web_constants.g.dart` statt Werte abzuschreiben (Inhalt je Schlüssel: README in `docs/native_fixtures/`).

### 8.14 Versions-Vorschau der App: `GET /api/native/v1/boards/:id/versions/:vid/snapshot` (seit P6)

Inhalt einer Version (§3 „Versionen“) als Objekt-JSON, damit die App sie ohne Yjs schreibgeschützt zeigen kann (Web:
Yjs-Update `GET /api/boards/:id/versions/:vid` + lokale Sitzung). Sitzung nötig (`Bearer sts_…`, Cookie geht auch), sonst
401; Modus local: nur Boards mit Zugriff.

`200 {ok, board:{id,title}, version:{…BoardVersionInfo…}, below:["frame"], snapshot:{objects:[…], ext:{…}}}`

- `snapshot` hat dieselbe Form wie `welcome.snapshot` (§8.4): `objects` in Zeichenreihenfolge (Objekt-JSON §8.5, Y-Felder
  über dieselben Codecs), `ext` = **alle** Feature-Strukturen mit Inhalt (§8.7). Die App baut daraus eine zweite,
  schreibgeschützte Board-Quelle; das Live-Board bleibt verbunden.
- 404 `not_found`: Board gibt es nicht (auch: im Papierkorb), Version gibt es nicht (mehr) bzw. gehört zu einem anderen
  Board. `Cache-Control: private, no-cache` (der Name einer Version kann sich ändern).
- Alles andere (Liste, speichern, benennen, wiederherstellen, als Kopie) über die Endpunkte aus §3; ebenso Papierkorb,
  Duplizieren/Vorlagen, Vorschaubild (`PUT /api/boards/:id/thumbnail`) und KI-Zugang (`/api/tokens`, mit `sts_` erlaubt –
  nur API-Tokens `stk_` dürfen keine Tokens verwalten). Server: `server/src/native/version-snapshot.ts`, Route in
  `native/routes.ts`; Test `server/test/native-versions.test.ts`.

### 8.15 Melden und Blockieren aus den Apps

Die Apps (Stachel-App, Org-App über `stachel_client`) nutzen dieselben REST-Endpunkte wie das Web (§6 „Melden,
Blockieren, Moderation“) mit `Authorization: Bearer sts_…` und `X-Stachel: 1`: `POST /api/reports`, `GET|PUT|DELETE
/api/blocks…`, `GET /api/boards/:id/moderation`. Jede Instanz schickt Meldungen an ihr eigenes
`STACHEL_REPORT_EMAIL` (Orga). Ein gesperrtes Board liefert im `welcome` die Rolle `view` (Ops → `nack forbidden`), ein
ausgeblendetes `no_access`; ein gesperrtes Konto bekommt 403 `account_locked` bzw. `not_logged_in`.
