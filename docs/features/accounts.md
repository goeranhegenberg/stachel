# Eigene Konten und Board-Rechte (Modus `local`) und Anmeldung über eine Organisation (Modus `org`)

Stachel läuft aus **einem** Codestand in zwei Betriebsarten:

| Betriebsart | `STACHEL_AUTH` | Anmeldung | Wer sieht welche Boards |
|---|---|---|---|
| eigene Konten | `local` (Standard) | E-Mail + Passwort, Bestätigungsmail, Captcha | nur Besitzer:in und Personen, mit denen geteilt ist |
| Organisation | `org` | Identitätsdienst einer Organisation: QR-Code bzw. Link aus ihrer App, optional Benutzername + Passwort der Organisation (docs/contract.md §1/§2) | alle im Team alles |

Im Modus `org` ändert dieses Modul nichts (der Rechte-Guard ist ein No-op, die Konto-Routen gibt es nicht). Ein
unbekannter Wert für `STACHEL_AUTH` bricht den Start mit Meldung ab.

## Konfiguration (Env, siehe `.env.example`)

| Variable | Bedeutung |
|---|---|
| `STACHEL_AUTH` | `local` (Standard) oder `org` |
| `STACHEL_BRAND` | Name der Instanz in Oberfläche und Mails (Standard „Stachel“) |
| `STACHEL_IMPRINT_URL`, `STACHEL_PRIVACY_URL` | Links zu Impressum und Datenschutzerklärung (Fußzeile, Registrieren, Mails). Keine eigenen Rechtstexte im Code; eigene Seiten der Instanz aus `<DATA_DIR>/legal` (`docs/features/legal-pages.md`) füllen leere Variablen. |
| `STACHEL_TERMS_VERSION` | Fassung der Nutzungsbedingungen: wird bei der Registrierung gespeichert (`accounts.terms_version`), bei Änderung Dialog zur erneuten Zustimmung in Web und App (`GET/POST /api/account/terms`, `docs/features/legal-pages.md`). |
| `STACHEL_TERMS_URL` | Nutzungsbedingungen: Pflicht-Häkchen bei der Registrierung „Ich akzeptiere die Nutzungsbedingungen und bin mindestens 18 Jahre alt.“ (`terms: true`, gespeichert als `accounts.terms_accepted_at`; die Datenschutzerklärung ist nur ein Hinweis-Link, kein Häkchen). Leer = Häkchen ohne Link und Warnung beim Start. Link auch im Fuß und in Mails. |
| `STACHEL_SMTP_HOST`, `STACHEL_SMTP_PORT`, `STACHEL_SMTP_USER`, `STACHEL_SMTP_PASS`, `STACHEL_SMTP_FROM` | Mailversand. Strato: `smtp.strato.de`, `465` (implizites TLS). `FROM` z. B. `Stachel <noreply@intsode.com>` (muss zum Konto passen) |
| `STACHEL_SMTP_SECURE` | optional: `ssl` (Standard bei 465), `starttls` (Standard sonst), `none` (nur lokal) |
| `STACHEL_MAIL_MODE` | `smtp` (Standard) oder `log`: Mails nur nach `DATA_DIR/mail.log` (Tests, Sandbox). Ohne SMTP-Host wird ebenfalls nur geloggt (Warnung im Log). |
| `STACHEL_REGISTRATION` | `open` (Standard) oder `invite`: registrieren nur mit offener Board-Einladung |
| `STACHEL_CAPTCHA_MAX` | Schwierigkeit des Captchas (Standard 250000; im Mittel probiert der Browser die Hälfte durch, ≈ 0,2–1 s) |
| `STACHEL_ANDROID_PACKAGE`, `STACHEL_ANDROID_CERT_SHA256`, `STACHEL_IOS_APP_ID` | App-Links (`/.well-known/…`, Vertrag §2): im Modus local die Stachel-App (z. B. `com.intsode.stachel`), im Modus org die App der Organisation. **Kein Standard in keinem Modus** – ohne Werte gibt es keine App-Links (404), ohne Fingerabdruck keine `assetlinks.json`; im Modus org zeigt die Anmeldeseite den Knopf „In der {App} öffnen“ nur mit `STACHEL_ANDROID_PACKAGE` |
| `STACHEL_NATIVE_MIN_STACHEL_APP` | Mindestversion der Stachel-App (Native-API, Vertrag §8.2 `minApps.stachel`) |

Nur Modus `org` (Vertrag §1 „Org-Token prüfen“):

| Variable | Bedeutung |
|---|---|
| `STACHEL_ORG_IDENTITY_URL` | Pflicht: Adresse, die ein Org-Token prüft (`GET` mit `Authorization: Bearer` → `{id, name, admin, status}`) |
| `STACHEL_ORG_LOGIN_URL` | optional: Passwort-Anmeldung über die Organisation (`POST {username, password}` → `{token}`); leer = nur QR/App |
| `STACHEL_ORG_NAME` | Name der Organisation in Texten („Mit … anmelden“), Standard „Organisation“ |
| `STACHEL_ORG_APP_NAME` | Name ihrer App („In der … öffnen“), Standard „{STACHEL_ORG_NAME}-App“ |
| `STACHEL_ORG_TIMEOUT_MS` | Zeitlimit je Aufruf des Identitätsdienstes, Standard 8000 |
| `STACHEL_NATIVE_MIN_APP` | Mindestversion der App der Organisation (Native-API, `minApps.org`) |

`GET /api/instance` (ohne Sitzung) liefert `{auth, brand, imprintUrl, privacyUrl, termsUrl, registration, orgName,
orgAppName, orgPasswordLogin, orgAndroidPackage}` (die `org*`-Felder nur im Modus org, sonst `null`/`false`); die Web-App
wählt damit Anmeldeseite, Branding und Fußzeile und zeigt im Modus org „Mit {orgName} anmelden“, „In der {orgAppName}
öffnen“ (Android nur mit `orgAndroidPackage`) und die Passwort-Anmeldung nur bei `orgPasswordLogin`.

## Konten (server/src/accounts.ts)

- Tabelle `accounts` (`id`, `email` klein geschrieben und eindeutig, `name`, `password_hash`, `verified_at`,
  `privacy_accepted_at`, …), `account_tokens` (nur SHA-256 der Link-Tokens, Zweck `verify` 24 h bzw. `reset` 1 h,
  einmal einlösbar). Nie bestätigte Konten verschwinden nach 7 Tagen.
- Passwort: scrypt aus `node:crypto` (N = 2^15, r = 8, p = 1, Salz 16 Byte; Parameter stehen im Hash). Regeln
  (`passwords.ts`): mindestens 10 Zeichen, nicht in der Liste sehr häufiger Passwörter (auch „Passwort2024!“), keine
  Zeichenfolge/Wiederholung, nicht E-Mail oder Name.
- Sitzungen wie im Modus org (`sessions.ts`, Cookie `stachel_session`): `user_key` = `u:<id>`, im Feld `org_token` steht
  `local:<id>`; die Nachprüfung nach 6 h fragt das Konto statt des Identitätsdienstes (gelöscht/unbestätigt → abgemeldet).

| Methode + Pfad | Body | Antwort |
|---|---|---|
| `GET /api/auth/captcha` | – | `{algorithm:"SHA-256", challenge, salt, maxnumber, signature}` (Rate-Limit 60 / 5 min je IP) |
| `POST /api/auth/register` | `{name, email, password, privacy:true, captcha, website}` | immer `{ok:true}` bei gültiger Eingabe (auch wenn die Adresse schon ein Konto hat) · 400 `invalid_input`/`invalid_email`/`weak_password`/`privacy_required`/`captcha_invalid` · 403 `registration_closed` · 429 |
| `POST /api/auth/verify` | `{token}` | `{ok, email}` · 410 `link_expired` |
| `POST /api/auth/resend` | `{email}` | immer `{ok:true}` |
| `POST /api/auth/login` | `{email, password}` | `{ok, user}` + Cookie · 401 `wrong_login` · 403 `not_verified` (nur bei richtigem Passwort) · 429 |
| `POST /api/auth/app-session` | `{email, password}` (Stachel-App, ohne `X-Stachel`) | `{ok, token:"sts_…", user, expiresAt}` ohne Cookie; Prüfungen, Sperren, Fehler wie `login` (Vertrag §8.1) |
| `POST /api/auth/forgot` | `{email}` | immer `{ok:true}` |
| `POST /api/auth/reset` | `{token, password}` | `{ok, email}` (alle Sitzungen beendet) · 400 `weak_password` · 410 `link_expired` |
| `GET /verify/:token`, `GET /reset/:token` | – | Mail-Links (App-Link der Stachel-App); ohne App 302 auf `/?verify=<token>` bzw. `/?reset=<token>` (ungültiges Format → 404-Seite) |
| `GET /api/account` | – | `{account:{key,name,email,createdAt}, boards:[{id,title,inTrash,people}]}` |
| `PATCH /api/account` | `{name}` | `{ok, user}` |
| `POST /api/account/password` | `{current, password}` | `{ok}` (andere Sitzungen beendet und getrennt, die eigene – Cookie bzw. App-Token – bleibt) · 403 `wrong_password` · 400 `weak_password` |
| `POST /api/account/delete` | `{password, boards: {<boardId>: "delete" \| <user_key>}}` | `{ok}` – eigene Boards an eine Person mit Zugriff übertragen oder endgültig löschen; Mitgliedschaften, Favoriten, Sitzungen, Einladungen, persönliche API-Tokens, Posteingang weg; auf verbliebenen Boards steht statt des Namens „Gelöschtes Konto“ (Kommentare, Reaktionen, Stimmen, Versionen …, `forget-person.ts`, Vertrag §6). Modus org: `{confirm: true}` = „Meine Daten bei Stachel löschen“ (`forget-routes.ts`). Anleitung öffentlich unter `/konto-loeschen` |

Konto-Routen (`/api/account…`) nehmen statt des Cookies auch `Authorization: Bearer sts_…` der Stachel-App (bei
schreibenden mit `X-Stachel: 1`), nicht aber API-Tokens (`stk_`). Die Teilen-Routen unten liegen im Sitzungs-Scope und
gehen damit ebenso.

Mail-Links: Bestätigen `{PUBLIC_URL}/verify/<token>`, Zurücksetzen `{PUBLIC_URL}/reset/<token>` (Token 32 Byte base64url).
Auf dem Handy öffnet der Link die Stachel-App (App-Link), sonst leitet der Server ins Web um (`/?verify=…`, `/?reset=…`;
die Web-App ist unverändert). Die Umleitung verbraucht den Token nicht, eingelöst wird erst mit `POST /api/auth/verify`
bzw. `/api/auth/reset`. Server-Log: Tokens in `/verify/…`, `/reset/…`, `?verify=`, `?reset=` werden geschwärzt.

Registrieren: Honigtopf-Feld `website` (gefüllt → Antwort wie Erfolg, nichts passiert). Gibt es die Adresse schon
(bestätigt), geht statt der Bestätigung eine Mail „Du hast schon ein Konto“ raus; unbestätigte Konten werden
überschrieben (aktivieren kann nur, wer das Postfach hat). scrypt läuft in jedem Zweig, Mails gehen im Hintergrund raus.
Rate-Limits: Registrieren 10 / h je IP und 3 / h je Adresse; Mails (erneut senden, vergessen) 10 / 15 min je IP und
3 / h je Adresse; Anmelden wie bisher (10 Fehlversuche / 5 min je IP, 10 / 15 min je Adresse, 60 Versuche / 5 min Flut).
Die Wege des Modus org (`/api/auth/password`, QR, App-Code, `/auth/app`, `/qr/*`) antworten im Modus local 404. App-Links
(`/.well-known/assetlinks.json`, `apple-app-site-association` mit `/b/*`, `/verify/*`, `/reset/*`) gelten im Modus local
der Stachel-App. `POST /api/auth/app-session` mit Org-Token (ohne Zugangsdaten) → 404.

### Captcha (server/src/captcha.ts, web/src/pages/account/pow*.ts)

Proof-of-Work im ALTCHA-Format ohne Drittanbieter und ohne Cookie: Der Server signiert (HMAC, Schlüssel nur im Speicher)
eine Aufgabe `challenge = SHA-256(salt + n)` mit Ablauf im `salt` (10 min). Der Browser sucht `n` im Web Worker
(eigene SHA-256-Implementierung, `worker-src 'self'` reicht, kein `unsafe-eval`) und schickt `base64(JSON)` mit.
Für die Stachel-App: `GET /api/auth/captcha` → `{ok, algorithm:"SHA-256", challenge, salt, maxnumber, signature}`
(`challenge` = SHA-256 in Hex klein, `salt` ist ein String wie `<hex>?expires=<unix>`); `n` von 0 bis `maxnumber` so
suchen, dass `hex(SHA-256(utf8(salt + String(n)))) == challenge`, dann im Feld `captcha` von `register`:
`base64(JSON.stringify({algorithm, challenge, number: n, salt, signature}))` (Standard-Base64 mit `=`).
Jede Lösung gilt einmal (Tabelle `captcha_used`). Das Formular rechnet schon beim Öffnen im Hintergrund.

## Board-Rechte (server/src/access.ts, access-routes.ts)

Rollen `view` < `comment` < `edit` < `owner`. Besitzer:in = `boards.created_by` (Übertragen ändert das Feld). Weitere
Personen: `board_members` (Rolle), `board_invites` (E-Mail ohne Konto; nach der Bestätigung dieser Adresse automatisch
Mitglied), `board_links` (Freigabelink: jede **angemeldete** Person mit der Board-Adresse bekommt die Rolle; wer ihn
benutzt hat, steht in `board_link_visits` und sieht das Board unter „Mit mir geteilt“, solange der Link an ist).
Alle Tabellen hängen per `ON DELETE CASCADE` am Board.

**Eine Prüfung für alles:** `access.canAccessBoard(user, boardId, need)` (Vertrag: docs/contract.md §6).

| Weg | Durchsetzung |
|---|---|
| REST `/api/boards/:id…` | preHandler `registerAccessGuard` (vor dem Papierkorb-Guard): GET → `view`, sonst `edit`; Ausnahmen `ROUTE_ROLES` (Löschen `owner`, Favorit/Duplizieren `view`, Versionen `edit`). Ohne Zugriff 404, zu wenig Rechte 403 `no_permission` |
| Bilder/PDF `/api/images/:id`, `/api/files/:id` | Zugriff auf das Board des Bildes **oder** auf ein Board, das die ID enthält (Kopieren über Boards hinweg), Treffer gemerkt in `image_access` |
| Vorschaubilder | wie REST (`view` lesen, `edit` hochladen) |
| Papierkorb `/api/trash…` | nur eigene Boards (Liste gefiltert, Einzelrouten `owner`) |
| Übersicht `GET /api/boards` | nur Boards mit Zugriff, mit `role`; `?open=<id>` merkt einen Link-Besuch |
| Live-Übersicht (SSE) | Ereignisse nur zu Boards mit Zugriff; Rechteänderungen melden sich gezielt (`created` an die betroffene Person) |
| Personen `GET /api/users?board=<id>`, `GET /api/boards/:id/people` | nur Personen mit Zugriff (Erwähnungen, Zuständige); ohne `board`: Personen mit gemeinsamen Boards |
| Yjs (Hocuspocus) | `onAuthenticate`: ohne Zugriff `no_access`; `view` → `readOnly`; `comment` → jede Sync-Nachricht wird geprüft: nur Änderungen an `collab.comments`, `collab.reads` und `structure.people` (trägt sich beim Öffnen ein) werden übernommen, sonst wie `readOnly` verworfen (`updateTouchesOnly`: Update auf einer Kopie einspielen, geänderte Wurzel-Strukturen prüfen; Updates mit fehlenden Vorgängern abgelehnt) |
| Rolle geändert/entzogen | offene Verbindungen der Person zu diesem Board werden getrennt (Close 4000 `access_changed`), beim Neuverbinden gilt die neue Rolle |

Teilen-Routen (`access-routes.ts`; verwalten dürfen Besitzer:in und `edit`):

| Methode + Pfad | Body | Wirkung |
|---|---|---|
| `GET /api/boards/:id/share` | – | `{title, role, canManage, people:[{key,name,email,role,via}], invites, link, url}` (E-Mail-Adressen nur für Verwaltende) |
| `POST /api/boards/:id/share` | `{emails: string[] \| "a, b", role}` | mit Konto → Mitglied + Mail „geteilt“; ohne → Einladung + Mail mit Registrieren-Link (60 Adressen / h je Person) |
| `PATCH /api/boards/:id/members/:key` | `{role}` | Rolle ändern |
| `DELETE /api/boards/:id/members/:key` | – | Zugriff entziehen; eigener Schlüssel = Board verlassen (`{ok, left:true}`) |
| `DELETE /api/boards/:id/invites/:email` | – | Einladung zurückziehen |
| `PUT /api/boards/:id/link` | `{role \| null}` | Freigabelink an/aus |
| `POST /api/boards/:id/owner` | `{key}` | Besitz an eine Person mit Zugriff übertragen (nur Besitzer:in; die bisherige bleibt `edit`) |

## Oberfläche (web)

- `web/src/instance.ts`: `GET /api/instance` einmal je Seite; `App.tsx` wartet darauf und zeigt im Modus local
  `pages/account/LocalLoginPage.tsx` (Anmelden / Registrieren / Passwort vergessen, Links `/?verify=…`, `/?reset=…`,
  Einladung `/?b=…&register=1&email=…`) und die Konto-Seite `/?konto=1` (`AccountPage.tsx`).
- Board-Übersicht: Filter „Alle / Meine Boards / Mit mir geteilt / Favoriten“, „Teilen …“ im Karten-Menü, Rolle an
  der Karte, Name oben rechts führt zum Konto, Fußzeile mit Impressum/Datenschutz (`pages/account/boardsLocal.tsx`).
- Editor (Feature-Modul `features/sharing`): Knopf „Teilen“ oben rechts, Rollen-Hinweis „Nur ansehen“/„Kommentieren“,
  Schreibschutz wie die Versions-Vorschau (Werkzeugleiste aus, Hand-Werkzeug, Tasten/Einfügen/Ablegen/Doppelklick
  gesperrt; Kommentieren hat einen eigenen Knopf „Kommentar hinzufügen“). Rolle wird nach jedem Wiederverbinden neu
  geholt. Kein Zugriff → „Dieses Board ist nicht (mehr) mit dir geteilt“.

## Bedrohungen und Gegenmaßnahmen

| Bedrohung | Maßnahme |
|---|---|
| Bots legen Konten an / Mail-Bombing | PoW-Captcha (einmal gültig, 10 min), Honigtopf, Rate-Limits je IP und Adresse, Mails nur an die eingegebene Adresse |
| Konto-Aufzählung | Registrieren, Erneut senden, Passwort vergessen antworten gleich; scrypt in jedem Zweig, Mails asynchron; Login-Fehler einheitlich (nur „nicht bestätigt“ bei richtigem Passwort). Rest-Risiko: der Teilen-Dialog zeigt, ob eine eingeladene Adresse schon ein Konto hat (wie in gängigen Whiteboards üblich), begrenzt auf 60 / h |
| Passwort raten | Sperre je Adresse und je IP (IPv6 /64), scrypt, Liste häufiger Passwörter |
| Gestohlene Datenbank | Passwörter scrypt, Link-Tokens und Sitzungen nur als SHA-256 |
| Link abgefangen | Tokens 24 h bzw. 1 h, einmalig, nach Gebrauch aus der Adresszeile entfernt; Reset beendet alle Sitzungen |
| CSRF | wie bisher: `SameSite=Lax` + Header `X-Stachel` für alle ändernden `/api`-Aufrufe (auch Konto, Teilen) |
| Rechte umgehen (REST, Bilder, SSE, Yjs) | zentrale Prüfung, Guard für alle `/api/boards/:id…`-Routen (auch künftige), readOnly/Kommentar-Filter im Sync, 404 statt 403 ohne Zugriff |
| Kommentieren-Rolle schreibt Objekte | Server prüft jede Yjs-Nachricht; was mehr als Kommentare ändert, wird verworfen (auch verschachtelt, Löschungen, fehlende Vorgänger) |
| Header-Injection in Mails | Adressen streng geprüft, Betreff ohne Zeilenumbrüche, Namen in HTML escaped |
| Zugangsdaten in Logs | SMTP-Fehler nennen nie Benutzer/Passwort; Mail-Log nur im Modus `log` |
| Freigabelink geleakt | nur angemeldete Konten, abschaltbar (sperrt sofort, offene Verbindungen werden getrennt); Board-IDs sind zufällig (72 Bit) |

Bekannte Grenzen: Wer mit „Kommentieren“ trotzdem ein Objekt ändert (manipulierter Client), dessen spätere Updates
derselben Sitzung hängen an diesem verworfenen Update (Yjs-Uhr) – erst ein Neuladen hilft. Die Oberfläche bietet
Bearbeiten deshalb gar nicht an. Verbindungen über API-Tokens (MCP) werden bei Rechteänderungen nicht aktiv getrennt
(die Rolle gilt ab der nächsten Verbindung).

## Tests

- Server: `test/accounts.test.ts` (Registrieren, Captcha ungültig/gefälscht/wiederverwendet, Honigtopf, Bestätigung,
  keine Aufzählung, Sperre, Reset, Konto), `test/access.test.ts` (Rechte je Rolle über REST, Bilder, Personen, SSE,
  Yjs readOnly/Kommentar-Filter, Link, Einladung, Besitz, Papierkorb, Konto löschen), `test/mailer.test.ts` (SMTP gegen
  Fake-Server, MIME, Header-Injection, Modus org unverändert). Hilfen: `test/local-helpers.ts`.
- Web: `pages/account/pow.test.ts` (SHA-256, Lösung).
- Root-E2E `e2e/tests/accounts.spec.ts` (echter Server, Mail-Log): registrieren → Link aus dem Log → anmelden → Board
  teilen → zweite Person sieht es, „Ansehen“ kann nicht bearbeiten, „Kommentieren“ nur kommentieren, „Bearbeiten“
  schreibt; Fremde ohne Zugriff; Konto; Handy. Screenshots `docs/screenshots/accounts-*.png`.
- Server: `test/stachel-app.test.ts` (Stachel-App: App-Sitzung mit Zugangsdaten beider Modi samt Sperre, QR mit
  `X-Stachel-App`, Konto/Teilen mit Bearer sts_, Passwort ändern mit eigener App-Sitzung, Rollen view/comment/edit in der
  Native-API, `client`/`minApps`, App-Links und Mail-Links im Modus local).
- Sandbox: `server\node_modules\.bin\tsx.cmd tools/sandbox-open.mts 8616` (Konten mara/jonas/lena@example.org,
  Passwort „Kaktus-Wüste-2026“, Mails in `<Daten>/mail.log`). Für die Stachel-App: `tools/sandbox.mts <port> --local
  --seed` (Konten owner/edit/comment/view@sandbox.test, Passwort „Stachel-Probe-2026“, ein geteiltes Board, sts_-Tokens
  und Mail-Log-Pfad in der Ausgabe und in `sandbox.json`).
