# Stachel-App (eigenständig, Flutter) – Konzept

Auftrag Göran (2026-11-02): „Bitte mache auch eine Stachel-App, weil Stachel ja auch noch mal extra als Webplattform
verfügbar ist.“ – „Mach ein extra Paket, damit sich der Code zwischen der Org-App und der Stachel-App nicht doppelt.“

Ziel: eine eigene native App **„Stachel“** (Android zuerst, iOS später über Codemagic baubar), die sich wie die
Stachel-Web-App verhält – mit **genau einem** Flutter-Code für Board, Board-Liste und Zubehör, den die Org-App
und die Stachel-App gemeinsam benutzen.

## 1. Aufbau: zwei geteilte Pakete im Stachel-Repo, eine Quelle der Wahrheit

```
stachel/
  flutter/
    packages/stachel_board/    Board: Modell, Protokoll (§8), Renderer, Editor, Feature-Register (vorher App-Repo der Organisation/packages)
    packages/stachel_client/   App-Schicht: Board-Liste, Board-Bildschirm + Hosts, Boards-API, Sitzung, Caches, Offline,
                               Dokumente (pdfrx), Fotos, Teilen-Ziel (Dart-Teil), Posteingang-Abfrage, Teilen-Dialog
    app/                       die Stachel-App (Paket-ID com.intsode.stachel, Name „Stachel“)
```

- **Warum im Stachel-Repo?** Das Board ist Stachel; Vertrag (`docs/contract.md` §8), Server, Web und Beispiel-Daten
  (`docs/native_fixtures/`) liegen hier. Die Paket-Tests lesen die Beispiel-Daten jetzt **direkt** aus
  `docs/native_fixtures/` (keine Kopien mehr, `tools/native-*-fixtures.mts` schreiben nur noch dorthin).
- **Zwei Pakete statt einem:** `stachel_board` bleibt reines Board (kennt weder HTTP-Anmeldung noch Bildschirme);
  `stachel_client` ist alles, was eine App drumherum braucht. So kann das Board-Paket weiter für sich getestet werden.
- **Org-App** hängt per **git-Abhängigkeit mit fester Version** an beiden Paketen:

  ```yaml
  stachel_client:
    git: {url: https://github.com/goeranhegenberg/stachel.git, path: flutter/packages/stachel_client, ref: <commit>}
  ```

  Tags `flutter-pkg-<x.y.z>` auf stachel `main`; `ref` ist der **Commit** des Tags, für beide Pakete gleich (pub löst die
  Pfad-Abhängigkeit `stachel_client` → `stachel_board` auf den Commit auf, ein Tag-Name passt dann nicht dazu).
  `pubspec.lock` hält den aufgelösten Commit fest. Codemagic holt das Repo per SSH (Deploy-Key „Codemagic CI“ muss
  dafür auch im Projekt `intsode/apps/stachel` freigeschaltet sein).
- **Lokal entwickeln:** `pubspec_overrides.yaml` (offizieller pub-Mechanismus, wird automatisch gelesen) mit
  Pfaden auf `../stachel/flutter/packages/…`, im App-Repo der Organisation **gitignored**; Vorlage `pubspec_overrides.yaml.example`.
  Nie committen – sonst baut Codemagic gegen einen Pfad, den es nicht gibt.

## 2. Schnittstellen zwischen geteiltem Code und App

`stachel_client` kennt keine App. Jede App gibt ein `StachelClient`-Objekt hinein:

| Teil | Org-App | Stachel-App |
|---|---|---|
| `base` (Stachel-Server) | `https://board.example.org` | gewählte Instanz (Standard `https://stachel.intsode.com`) |
| `httpClient` | der der `ApiService` | eigener `http.Client` |
| `StachelAuth.loginKey` (bindet gespeicherte Sitzung, Liste, Offline-Daten an eine Anmeldung) | Org-Token (wie bisher gehasht → gespeicherte Sitzungen bleiben gültig) | `instanz + Konto` |
| `StachelAuth.newSession()` (neues `sts_…` nach 401) | `POST /api/auth/app-session` mit Org-Token | gibt es nicht (Anmeldung abgelaufen → Login-Seite) |
| `StachelAuth.loginLost(context)` | `toTeamLogin` | zurück zur Anmeldeseite der App |
| `openInBrowser` (Notausgang) | Einmal-Link `app-code` | einfache Board-URL im Browser |
| Erweiterungen (`StachelHooks`) | QR „Am Computer anmelden“ in der App-Leiste, „Als Aufgabe in der Org-App anlegen“ (Board-Register), Posteingang → Benachrichtigungen der Org-App, Fotos/Teilen aus deren Startseite | Konto-Menü (Name, Passwort, Abmelden, Konto löschen), Hinweis-Leiste für neue Erwähnungen |
| Look (`StachelStyle`) | Farben der Org-App, Barlow | Stachel-Web-Farben (Tinte `#0a0a0a`, Grün `#c9e14a`, Blau `#1763b5`, Pink `#ec4e92`), Barlow |
| Text „Bitte … aktualisieren“ | „die Org-App“ | „die Stachel-App“ |

Die org-spezifischen Teile bleiben in der Org-App: QR-Freigabe (`stachel_login.dart` approve,
`StachelLoginScreen`), Einmal-Link für den Browser (`stachel_browser.dart`), App-Links auf `board.example.org`,
Aufgaben-Extra, Benachrichtigungen. Verhalten der Org-App ändert sich durch den Umzug **nicht**.

## 3. Anmeldung in der Stachel-App

Startseite „Anmelden“ mit zwei Wegen:

1. **Stachel-Konto** (Standard, `stachel.intsode.com`, Modus `local`): E-Mail + Passwort; „Konto anlegen“ (Name, E-Mail,
   Passwort, Datenschutz-Haken, Captcha); „Passwort vergessen“. Bestätigen/Zurücksetzen über den Mail-Link, der als
   App-Link direkt in der App landet (`/verify/<token>`, `/reset/<token>`); ohne App öffnet er die Webseite wie bisher.
   Zusätzlich lässt sich der Link aus der Mail in die App einfügen (Feld „Link aus der Mail“).
   **Captcha nativ:** Der Server gibt eine ALTCHA-Aufgabe (`GET /api/auth/captcha`: `algorithm` SHA-256, `challenge`,
   `salt`, `maxnumber`, `signature`); die App sucht wie der Web-Worker die Zahl `n` mit `SHA-256(salt + n) = challenge`
   (in einem Isolate, `package:crypto`) und schickt `base64(JSON{algorithm, challenge, number, salt, signature})`.
   Kein WebView, kein Drittanbieter.
2. **„Mit {Organisation} anmelden“** (`board.example.org`, Modus `org`), zwei Knöpfe:
   - **„Mit der Org-App“** (für alle, die sich per SMS anmelden): die Stachel-App holt einen QR-Code
     (`POST /api/auth/qr`), öffnet `https://board.example.org/qr/<code>` (App-Link → Org-App fragt „Im Browser bei
     Stachel anmelden?“ und bestätigt mit ihrem Team-Token) und wartet (`GET /api/auth/qr/<code>/wait` mit
     `X-Stachel-App: 1` → Antwort enthält dann ein `sts_…`-Token statt eines Cookies). Kein neuer Identitätsdienst der Organisation-Code.
   - **Benutzername + Passwort** (Admin-Login des Identitätsdienst der Organisations wie im Web).

**Server (Vertrag §8.1 erweitert):** `POST /api/auth/app-session` nimmt zusätzlich Zugangsdaten im Body:
Modus `local` `{email, password}` (Antworten wie `/api/auth/login`: `wrong_login`, `not_verified`, `rate_limited`),
Modus `org` `{username, password}` (wie `/api/auth/password`). Ergebnis jeweils `{ok, token: "sts_…", user, expiresAt}`.
Die Route gibt es damit in **beiden** Modi; das Bearer-Org-Token geht nur im Modus `org`.
Konto-Endpunkte (`/api/account…`) nehmen auch `Bearer sts_…` (Name, Passwort ändern, **Konto löschen in der App** –
Pflicht für den Play Store). Sitzungen laufen wie bisher 30 Tage, jede Nutzung verlängert.

## 4. Rechte (Modus local)

Die App zeigt die Rolle aus `welcome.role` bzw. `GET /api/boards` (`role`) wie das Web (`ReadOnlyGuard`):
- `view`: nur ansehen – keine Werkzeugleiste, keine Kontextleiste, kein Rückgängig, Kommentare nur lesen, Chip
  „Nur ansehen“. Antippen wählt weiter aus (Objekt-Menü mit „Link kopieren“, „Im Browser öffnen“, PDF ansehen).
- `comment`: wie view plus Kommentare („Kommentar hinzufügen“, „Kommentieren“, „Hier kommentieren“, antworten, eigene
  bearbeiten/löschen, erledigen), Chip „Kommentieren“. Der Server lässt dafür nur die Kommentar-Ops zu (`comment`,
  `reply`, `commentEdit`, `commentDelete`, `resolve`, `mentionsRead`), sonst `nack forbidden`.
- `edit`/`owner`: wie bisher (die Org-App hat immer `edit`). Die Rolle liegt mit im Board-Cache.
- **Board-Liste:** Rolle neben dem Titel, Menü nach `ROUTE_ROLES` (Umbenennen ab edit, Löschen nur Besitzer:in).
- **Teilen-Dialog** (Board-Menü und ⋮ der Liste) wie im Web für alle Rollen sichtbar: verwalten (Personen/Rollen,
  Einladen per E-Mail, offene Einladungen, Freigabelink an/aus mit Rolle) dürfen Besitzer:in und `edit`, Besitz
  übertragen nur die Besitzer:in; alle sehen Personen und Link und können das Board verlassen.
  Paritäts-Audit Abschnitt R (R01–R09 ✓, R10 Listenfilter „Alle / Meine / Mit mir geteilt / Favoriten“ offen).

## 5. App-Links und Signatur

- `stachel.intsode.com`: `/b/<id>`, `/verify/<token>`, `/reset/<token>` → Stachel-App (`autoVerify`).
  `board.example.org` bleibt bei der Org-App (keine doppelten Ansprüche auf einen Host).
- Server liefert `/.well-known/assetlinks.json` jetzt **auch im Modus local** (bisher 404) für
  `STACHEL_ANDROID_PACKAGE=com.intsode.stachel` und den SHA-256 des **neuen Upload-Schlüssels** (liegt außerhalb von git), dazu später der Play-App-Signing-Schlüssel aus der Play Console.
- Mail-Links im Modus local: `{PUBLIC_URL}/verify/<token>` bzw. `/reset/<token>` (Server leitet auf `/?verify=…` bzw.
  `/?reset=…` um – das Web bleibt unverändert).

## 6. Mindest-Version je App

`hello` bekommt das optionale Feld `client` (`"org"` Standard, `"stachel"`); `STACHEL_NATIVE_MIN_APP` gilt nur für die
Org-App, `STACHEL_NATIVE_MIN_STACHEL_APP` für die Stachel-App (`/api/native/info` → `minApps`).

## 7. Umsetzung (Stand 2026-11-02)

- Pakete `flutter/packages/stachel_board` und `flutter/packages/stachel_client`; die Org-App hängt per git-Tag
  `flutter-pkg-1.0.0` daran (Branch `feat/stachel-shared` im App-Repo der Organisation).
- App `flutter/app` (Dart-Paket `stachel`): `lib/app_session.dart` (`StachelAppClient`, gespeicherte Anmeldung),
  `lib/auth_api.dart` (Konto-/Login-Requests), `lib/captcha.dart` (ALTCHA im Isolate), `lib/links.dart` (App-Links und
  eingefügter Mail-Link), `lib/root.dart` (Anmeldung ↔ Board-Liste, Links, Teilen-Ziel, neue Erwähnungen als Hinweis
  beim Öffnen), `lib/screens/` (Anmelden, Registrieren, Bestätigen, Passwort vergessen/neu, Mit der Organisation, Konto).
  User-Agent `StachelApp/<version> (<os>)`: die Org-App fragt dann „In der Stachel-App anmelden?“.
- Tests: `test/app_test.dart` (alle Abläufe gegen einen Fake-Server), `test/links_captcha_test.dart`, live gegen die
  Sandbox `test/live_sandbox_test.dart` (`tools/sandbox.mts <port> --local --seed`, dann
  `--dart-define=STACHEL_SANDBOX=http://127.0.0.1:<port> --dart-define=STACHEL_SANDBOX_MAILS=<daten>/mail.log`).
- Signatur: Upload-Schlüssel außerhalb von git (Gradle liest `android/key.properties` oder
  `~/secrets/stachel/key.properties`), SHA-256 `F9:E7:0D:…:ED:2F:97` steht auf stachel.intsode.com in
  `STACHEL_ANDROID_CERT_SHA256`. Nach dem ersten Play-Upload den App-Signing-Schlüssel aus der Play Console dort
  ergänzen (kommagetrennt), sonst verifizieren die App-Links bei Installationen aus Play nicht.

## 8. Was bewusst (noch) nicht

- Keine Push-Benachrichtigungen in der Stachel-App (Erwähnungen erscheinen beim Öffnen als Hinweis); später möglich.
- Kein Play-Upload durch Claude (Göran legt die Play-App an).
- iOS: Projekt ist baubar vorbereitet (Bundle-ID `com.intsode.stachel`), Signierung/Codemagic-Workflow folgt.
