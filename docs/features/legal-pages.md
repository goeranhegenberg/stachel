# Rechtstexte der Instanz: Impressum, Datenschutz, Nutzungsbedingungen

Stand 2026-11-04. Code: `server/src/legal-pages.ts` (Seiten, Rahmen, Standard-Links), `server/src/accounts.ts`
(Fassung der Nutzungsbedingungen, `GET/POST /api/account/terms`), Web `web/src/pages/account/TermsGate.tsx`, App
`flutter/app/lib/screens/terms_dialog.dart`. Vorlagen für Betreiber: `deploy/legal-templates/`.

## Grundsatz

Stachel ist Open Source und bringt **keine** Rechtstexte eines Betreibers mit. Jede Instanz legt ihre eigenen Texte als
HTML-Fragmente in ihren Datenordner; ohne Dateien gibt es die Seiten nicht (404) und es bleibt bei den Links aus der
`.env`. So landet nie der Text eines anderen Betreibers (z. B. von stachel.intsode.com) auf einer fremden Instanz.

| Datei in `<DATA_DIR>/legal/` (`STACHEL_LEGAL_DIR`) | Seite | Link-Variable (Vorrang) |
|---|---|---|
| `impressum.html` | `/impressum` | `STACHEL_IMPRINT_URL` |
| `datenschutz.html` | `/datenschutz` | `STACHEL_PRIVACY_URL` |
| `nutzungsbedingungen.html` | `/nutzungsbedingungen` | `STACHEL_TERMS_URL` |

- Liegt eine Datei vor und ist die Variable leer, setzt `applyLegalDefaults` (beim Start, `config.ts`) die Variable auf
  `PUBLIC_URL/<seite>`. Damit verlinken `/api/instance`, Fuß der Web-App, Registrierung, Produktseite, `/konto-loeschen`,
  Apps und Mails die eigene Seite. Eine gesetzte Variable gewinnt (Text liegt woanders).
- Die Seiten liegen immer an der Wurzel; mit `STACHEL_BASE_PATH=/app` leitet `/app/<seite>` per 301 dorthin. Die Namen
  (und `konto-loeschen`) sind als `STACHEL_BASE_PATH` verboten.
- Rahmen wie `/konto-loeschen` (`legalFrame`): statisch, kein JavaScript, Schriften von `/qr-fonts`, keine fremden
  Quellen; Fuß mit den anderen Rechtsseiten, „Konto löschen“ (Modus local) und „Zu Stachel“. Titel = erste `<h1>`.
- Platzhalter (HTML-escaped): `{{BRAND}} {{ORIGIN}} {{APP_URL}} {{IMPRINT_URL}} {{PRIVACY_URL}} {{TERMS_URL}}
  {{DELETE_URL}} {{TERMS_VERSION}}`. Ein BOM am Anfang wird entfernt.
- Dateien werden bei jeder Anfrage per `stat` geprüft und bei Änderung (mtime/Größe) neu gelesen – kein Neustart nötig.
  Nur die Standard-Links (oben) entstehen beim Start: wer eine Datei **neu** anlegt, startet einmal neu oder setzt die
  Variable.
- Inhalt ist vertrauenswürdig (gehört dem Betreiber, liegt auf seinem Server) und wird nicht bereinigt.

## Fassung der Nutzungsbedingungen (`STACHEL_TERMS_VERSION`)

- Wert 1–40 Zeichen `[A-Za-z0-9._-]`, z. B. `2026-11-04`; sonst bricht der Start ab. Leer = keine Fassungen.
- Registrierung speichert `accounts.terms_accepted_at` und `accounts.terms_version` (Spalte wird nachgerüstet).
- `GET /api/account/terms` (Cookie oder `sts_`, Modus local) → `{ok, url, version, acceptedVersion, acceptedAt, pending}`;
  `pending` = Fassung gesetzt und ungleich der akzeptierten (auch bei Konten ohne Fassung, also von vor der Einführung).
- `POST /api/account/terms {accept: true, version}` speichert die Zustimmung; `version` muss die geltende sein, sonst 409
  `terms_changed`; ohne `accept` 400 `terms_required`.
- Web: `App.tsx` fragt nach der Anmeldung, bei `pending` liegt der Dialog `TermsGate` über Übersicht/Editor (nicht über der
  Konto-Seite – dort kann man stattdessen das Konto löschen). „Abmelden“ meldet ab.
- App: `root.dart` `_terms()` nach dem Anmelden und beim Zurückkehren in die App, Dialog `TermsDialog` (nicht
  wegklickbar); „Abmelden“ meldet ab mit Hinweis.
- Datenexport (`konto.json`) enthält `nutzungsbedingungenFassung`.
- Ablauf einer Änderung (Betrieb): neue Datei hochladen, mindestens vier Wochen vorher per Mail ankündigen
  (Nutzungsbedingungen § 11.2), am Stichtag `STACHEL_TERMS_VERSION` erhöhen und den Container neu starten.

## Tests

`server/test/legal-pages.test.ts` (Konfiguration, Auslieferung, Weiterleitung, Fassung/erneute Zustimmung),
`e2e/tests/legal.spec.ts` (echter Server mit Produktseite: Seiten ohne fremde Anfragen, Links, Dialog nach neuer
Fassung), `flutter/app/test/app_test.dart` Gruppe „Nutzungsbedingungen“.

## stachel.intsode.com

Die Texte von stachel.intsode.com pflegt der Betreiber außerhalb dieses Repos; auf dem Server liegen sie wie oben
beschrieben in `<DATA_DIR>/legal/`.
