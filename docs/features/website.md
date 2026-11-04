# Produktseite und Web-App unter einem Pfad

Stand 2026-11-02. Auftrag (Göran): Stachel wird Open Source; auf `stachel.intsode.com` steht die Webseite des Projekts, die
App liegt unter `stachel.intsode.com/app`. Instanzen ohne Produktseite bleiben unverändert (App unter `/`).

Code: `server/src/site.ts` (Auslieferung, Weiterleitungen, Produktseite), `server/src/config.ts` (`normalizeBasePath`),
`web/src/router.ts` (`APP_BASE`, `appHref`, `boardHref`, `boardShareUrl`), Vorlage `web/public/landing/index.html`,
Bilder `web/public/landing/img/` (`tools/landing-screenshots.mts`).

## Einstellungen (Env)

| Variable | Standard | Wirkung |
|---|---|---|
| `STACHEL_BASE_PATH` | leer | Pfad der Web-App, z. B. `/app`. Leer = Web-App unter `/` wie bisher. Erlaubt: Pfadteile aus `A-Za-z0-9._~-`; Pfade, die der Server an der Wurzel braucht (`/api`, `/sync`, `/native`, `/.well-known`, `/mcp`, `/qr`, `/qr-fonts`, `/b`, `/verify`, `/reset`, `/auth`, `/landing`, `/assets`), brechen den Start mit Meldung ab. |
| `STACHEL_LANDING` | `0` | `1` = Produktseite unter `/`. Wirkt nur mit `STACHEL_BASE_PATH` (sonst Warnung im Log, `/` bleibt die App). |
| `STACHEL_REPO_URL` | leer | GitHub-Adresse für „Quellcode“/„Selbst hosten“ (nur http/https). Leer = „Der Quellcode erscheint in Kürze auf GitHub.“, kein `git clone` im Schnellstart. |
| `STACHEL_PLAY_URL` | leer | Play-Store-Eintrag. Leer = „Bald bei Google Play · Im Test“. |
| `STACHEL_IMPRINT_URL`, `STACHEL_PRIVACY_URL` | leer | wie bisher (instance.ts); die Produktseite verlinkt sie im Fuß. |
| `PUBLIC_URL` | | bleibt die **Domain ohne Pfad** (Origin für CSP, WebSocket-Origin, QR-Links, MCP-Adresse). |

stachel.intsode.com: `STACHEL_BASE_PATH=/app`, `STACHEL_LANDING=1`. Instanzen ohne Produktseite: nichts gesetzt.

## Was wohin gehört

- **Unter dem Pfad (`/app/…`):** nur die Web-App – `index.html`, `assets/…`, `favicon.svg`, pdf.js-Dateien – und ihre
  Seitenadressen (`/app/?b=<id>`, `/app/?konto=1`, `/app/?offline=1`, `/app/?verify=…`) sowie die Kurzlinks
  `/app/b/<id>`, `/app/verify/<token>`, `/app/reset/<token>`.
- **An der Wurzel (unverändert):** `/api/…`, `/sync` (Yjs), `/native/v1` (App-WebSocket), `/.well-known/…` (App-Links),
  `/mcp` (nginx → MCP-Container), `/qr/<code>` (App-Link im Modus org), `/qr-fonts/…`, `/auth/app`. Org-App,
  Stachel-App und MCP-Server sprechen den Server so weiterhin nur mit der Domain an; nichts an ihnen musste sich ändern.
- **Produktseite:** `/` (gefüllte Vorlage, br/gzip im Speicher, `Cache-Control: no-cache`), Bilder unter `/landing/img/`
  (1 Tag cachebar). Die Vorlage selbst ist nie roh abrufbar (`/landing/index.html` und `/app/landing/…` → 404).

Das Web-Bündel ist **pfadneutral** (Vite `base: './'`): Assets, Chunks, Worker (Captcha, pdf.js) und Schriften werden
relativ zur geladenen `index.html` geholt. Darum dient ein Docker-Image beiden Instanzen. Die Web-App liest ihre Basis
beim Laden aus `location.pathname` (`router.ts`, `baseOf`); Navigation und Links laufen über `appHref()`/`boardHref()`
statt fester `'/'` – **neue Navigation in der Web-App immer über diese Helfer**, sonst landet man unter stachel.intsode.com
auf der Produktseite. API-Aufrufe bleiben absolute `/api/…`-Pfade.

## Weiterleitungen (mit `STACHEL_BASE_PATH=/app`)

| Anfrage | Antwort |
|---|---|
| `/` | Produktseite (200) bzw. ohne `STACHEL_LANDING` → 302 `/app/` |
| `/?<irgendwas>` (alte App-Adressen `/?b=…`, `/?offline=1` des MCP-Renderers, `/?konto=1`, `/?verify=…`) | 302 `/app/?<irgendwas>` |
| `/app` | 301 `/app/` (Query bleibt) |
| `/b/<id>[?o=<obj>]`, `/app/b/<id>[?o=<obj>]` | 302 `/app/?b=<id>[&o=<obj>]` (ungültige ID → 404-Seite) |
| `/verify/<token>`, `/app/verify/<token>` | 302 `/app/?verify=<token>` (Modus local; ungültig → 404-Seite) |
| `/reset/<token>`, `/app/reset/<token>` | 302 `/app/?reset=<token>` |
| `/auth/app?code=…` (WebView der Org-App) | 302 `/app/?…&app=1` |
| `/qr/<code>` | bleibt die QR-Hinweisseite an der Wurzel (App-Link im Modus org), „Zurück“-Knopf → `/app/` |
| `/assets/…`, `/index.html`, unbekannte Pfade | 404-Seite mit „Zur Board-Übersicht“ → `/app/` |

Ohne `STACHEL_BASE_PATH` gilt alles wie bisher (`/b/<id>` → `/?b=<id>`, `/app/…` ist 404).

## Links, die der Server erzeugt

Mit Pfad zeigen neue Links auf die Web-App unter dem Pfad (`appUrl` = `PUBLIC_URL` + `STACHEL_BASE_PATH` in `app.ts`):
Bestätigen `…/app/verify/<token>`, Passwort `…/app/reset/<token>`, „Schon ein Konto“ `…/app/?…`, geteilt
`…/app/b/<id>`, Einladung `…/app/?b=<id>&register=1&email=…`, Teilen-Dialog `url` = `…/app/b/<id>`. Die Web-App kopiert
Board-Links als `<Origin>/app/b/<id>` und Objekt-Links als `<Origin>/app/?b=<id>&o=<obj>`. Die Stachel-App erzeugt
weiter `/b/<id>`-Links (`stachel_client`, `stachelBoardUrl`) – die leiten weiter, ein neues Paket-Tag war nicht nötig.

## App-Links

- Android (Stachel-App, `flutter/app/android/.../AndroidManifest.xml`): `/b/`, `/verify/`, `/reset/` **und**
  `/app/b/`, `/app/verify/`, `/app/reset/` auf `stachel.intsode.com`. `assetlinks.json` gilt für die ganze Domain.
  Ältere App-Stände (ohne `/app/…`) öffnen neue Mail-Links im Browser – dort funktionieren sie über die Weiterleitung.
- iOS (`apple-app-site-association`): `well-known.ts` `appLinkPaths` listet die Pfade ohne und mit Präfix (QR nur an der Wurzel).
- `flutter/app/lib/links.dart` `appLinkFrom` nimmt Links mit und ohne `app`-Segment (`/app/b/…`, `/app/?b=…`,
  `/app/verify/…`, eingefügte Mail-Texte).
- App einer Organisation (Modus org): unverändert, solange die Instanz keinen Pfad setzt.

## Produktseite

Statisches HTML ohne JavaScript, CSS eingebettet, Schriften Barlow/Barlow Condensed von `/qr-fonts/` (vorgeladen), Bilder
WebP in zwei Breiten mit `srcset`, festen Maßen und `loading="lazy"` unterhalb der Startansicht – nichts von fremden
Servern (CSP `default-src 'self'` gilt auch hier). Abschnitte: Start (Im Browser öffnen, Android-App), Funktionen
(6 Kacheln + 3 Bildzeilen), Android-App, Selbst hosten (Docker-Schnellstart, Link ins README), „Fair gebaut“, Fuß mit
Impressum/Datenschutz/GitHub.

Vorlagen-Syntax (`fillLanding` in `site.ts`): `{{APP}}` (`/app/`), `{{ORIGIN}}`, `{{HOST}}`, `{{BRAND}}`, `{{REPO_URL}}`,
`{{PLAY_URL}}`, `{{IMPRINT_URL}}`, `{{PRIVACY_URL}}`, `{{TERMS_URL}}` (HTML-escaped); Blöcke `<!--#if repo-->…<!--#end repo-->` bzw.
`<!--#if !repo-->…<!--#end repo-->` für `repo`, `play`, `imprint`, `privacy`, `terms`, `legal`, `local` (Modus local:
Link „Konto löschen“). Nicht verschachteln.

Ansicht live: `docs/screenshots/website-landing-desktop.png` (ganze Seite, 1440 px) und `website-landing-handy.png` (390 px).

Bilder neu erzeugen (zeigt nebenbei, dass die App unter `/app` läuft): `cd e2e && npm run build`, dann im Repo
`server/node_modules/.bin/tsx tools/landing-screenshots.mts [port]`. Das Handy-Bild ist ein
Bildschirmfoto der Web-App am Handy.

Impressum, Datenschutz und Nutzungsbedingungen liefert der Server als eigene Seiten aus dem Datenordner der Instanz
(`docs/features/legal-pages.md`); die Produktseite verlinkt sie über dieselben Adressen.

**Offen / später:** englische Fassung (zweite Vorlage `landing/en.html` + Umschalter, `hreflang`); nginx setzt für stachel.intsode.com noch `X-Robots-Tag: noindex` – für eine
auffindbare Projektseite in der nginx-Konfiguration für `location = /` und `/landing/` entfernen.

## Tests

- Server: `server/test/site.test.ts` (Konfiguration, Vorlage, Auslieferung unter `/app`, alle Weiterleitungen, Wurzel-
  Pfade, App-Login, Modus local mit Mail-/Teilen-Links und AASA, Betrieb ohne Pfad unverändert).
- Web: `web/src/router.test.ts`, `features/tools/tools.test.ts` (Objekt-Link mit Basis).
- E2E: `e2e/tests/base-path.spec.ts` (echter Server mit `/app` + Produktseite: Landing → App, Mail-Link, Anmelden, Board,
  „Link kopieren“ = `/app/b/<id>`, alte Links, `/?offline=1`, kein fehlgeschlagener Abruf).
- App: `flutter/app/test/links_captcha_test.dart`; live `test/live_sandbox_test.dart` gegen
  `tools/sandbox.mts <port> --local --seed --base /app --landing` (in Git Bash `MSYS_NO_PATHCONV=1` davor, sonst wird
  `/app` zu einem Windows-Pfad).
