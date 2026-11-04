# Melden, Blockieren, Moderation

Pflicht für Google Play (UGC-Richtlinie: Melden von Inhalten **und** Personen; wegen @Erwähnungen und Einladungen auch
Blockieren) und für Hosting-Dienste nach dem DSA (Art. 16 Melde- und Abhilfeverfahren, Art. 17 Begründung). Hintergrund:
die interne Rechtsprüfung vom 2026-11-02. Betrieb (Admin-CLI):
`docs/ops/moderation.md`. Vertrag: `docs/contract.md` §6 „Melden, Blockieren, Moderation“, §8.15.

Gilt in beiden Betriebsarten (`STACHEL_AUTH=org` und `local`).

## Melden

| Wo | Web | Apps (stachel_client) |
|---|---|---|
| Objekt | Rechtsklick → „Melden …“ (`moderation.reportObject`) | Kontextmenü des Objekts → „Melden …“ |
| Kommentar | „Melden …“ unter fremden Nachrichten im Thread (`collab/CommentLayer.tsx`) | Nachrichten-Menü → „Melden …“ |
| Board | Board-Menü „···“ → „Board melden …“ (`moderation.reportBoard`) | Board-Menü → „Board melden …“ |
| Person | Anwesende (`collab/Presence.tsx`) und Teilen-Dialog (`sharing/ShareDialog.tsx`): „Melden …“ | Personenliste → „Person melden …“ |

Dialog: Grund (`illegal` Rechtswidriger Inhalt · `harassment` Belästigung, Hass oder Bedrohung · `spam` Spam oder
Betrug · `privacy` Persönliche Daten ohne Erlaubnis · `copyright` Urheberrecht oder Marke verletzt · `other` Etwas
anderes), Beschreibung (bei „rechtswidrig“/„anderes“ nötig, ≥ 10 Zeichen, DSA Art. 16 Abs. 2 a), Hinweis „ein Mensch
prüft, wer gemeldet wird, erfährt nicht von wem, Missbrauch kann zur Sperre führen“. Danach: Nummer `R-XXXXXXXX`, bei
Kommentaren/Personen „außerdem blockieren“.

Server (`server/src/reports.ts`): Tabelle `reports` mit Beleg (`evidence`: Text des Objekts bzw. der Kommentare zum
Zeitpunkt der Meldung), betroffener Person (`target_key`: gemeldete Person, Autor:in des Kommentars, Besitzer:in bei
Board-Meldungen; bei Objekten unbekannt – Objekte tragen keine Autorschaft), Mail an `STACHEL_REPORT_EMAIL` (sonst
`STACHEL_SMTP_FROM`) und Eingangsbestätigung an die meldende Person, wenn ihre Adresse bekannt ist (Modus local; im
Modus org gibt es nur die Bestätigung im Dialog). Rate-Limit 10 je Person, 30 je IP und Stunde.

## Blockieren

`server/src/blocks.ts`, Tabelle `user_blocks(user_key, blocked_key)`. Wer blockiert, bekommt von der Person:

- keine Einladungen/kein Teilen mehr (`access-routes.ts`: `POST /api/boards/:id/share` überspringt still),
- keine @Erwähnungen und Zuweisungen im Posteingang der Apps (`native/inbox.ts`, Filter beim Abruf – Aufheben zeigt
  sie wieder) und keine ungelesenen Erwähnungen im Web (`collab/comments.ts` `unreadMentions` über
  `moderation/blocked.ts`).

Mails zu Erwähnungen gibt es (noch) nicht; kommen welche dazu, müssen sie `user_blocks` prüfen. Die blockierte Person
erfährt nichts. Verwalten: Web – Personenliste (Anwesende, Teilen-Dialog) „Blockieren“/„Blockierung aufheben“, Konto-Seite
(Modus local) und Board-Menü „Blockierte Personen …“ (beide Modi); Apps – Personenliste, Übersicht-Menü „Blockierte
Personen“, Stachel-App zusätzlich Konto-Seite.

## Moderation (Betreiber:in)

`server/src/moderation.ts`: Admin-API `/api/admin/…` (nur mit `STACHEL_ADMIN_TOKEN`), Werkzeug `tools/admin.mts`.

- **Board-Sperre** (`board_locks`, `access.ts`): `readonly` – alle, auch die Besitzer:in, nur ansehen (REST 403, Yjs
  readOnly, Native-API `view`); `hidden` – für alle wie gelöscht (404, nicht in der Liste, Sync `no_access`), Daten
  bleiben für die Klärung. Offene Verbindungen werden getrennt. Web zeigt „Von der Moderation gesperrt“ (Slot
  `moderation.lock`).
- **Board löschen**: Papierkorb + endgültig löschen (`trash.purge`).
- **Inhalt entfernen** (`content_removed`): gemeldetes Objekt bzw. Kommentar (erste Nachricht = ganzer Thread) wird über
  eine Direktverbindung aus dem Board-Dokument gelöscht.
- **Konto-Sperre** (`account_locks`): Hooks an der Wurzel weisen Anfragen mit Sitzung und jede Anmeldung (alle Wege, auch
  über die Organisation) mit 403 `account_locked` ab; beim Sperren werden Sitzungen, persönliche API-Tokens und Verbindungen
  entfernt.
- **Entscheidung** (`POST /api/admin/reports/:id/decision`): Maßnahme ausführen, Meldung schließen, Mails mit Begründung
  (Art. 17 Abs. 3: Maßnahme und Umfang, Anlass, Begründung, Grundlage, „ein Mensch hat entschieden“, Rechtsbehelf:
  Beschwerde binnen sechs Monaten, Streitbeilegungsstelle Art. 21, Gericht) an die betroffene Person und das Ergebnis an
  die meldende Person (Art. 16 Abs. 5). Ohne Mail-Adresse (Modus org) nennt die Antwort, wen man selbst informieren
  muss.

## Tests

- Server: `server/test/moderation.test.ts` (Melden mit Beleg, Mails im Mail-Log, Eingaben, Zugriff, Rate-Limit;
  Admin-API: Token, Inhalt entfernen, Board sperren/ausblenden/entsperren, Konto sperren/entsperren, Board löschen;
  Blockieren: Liste, Posteingang, Einladungen; Modus org: Meldung, Sperre in REST/Liste/Live-Sync, Konto-Sperre).
- Web: `web/src/features/moderation/moderation.test.ts` (Eingaben, Body, Erwähnungsfilter, API), E2E-Smoke
  `web/e2e/moderation.spec.ts` (Objekt/Board melden, Sperr-Hinweis, blockierte Personen; Bilder
  `docs/screenshots/moderation-*.png`).
- Apps: Widget-Tests in `flutter/packages/stachel_client/test/`.
