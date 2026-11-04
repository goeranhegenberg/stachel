# Moderation im Betrieb (Meldungen bearbeiten, sperren, löschen)

Für Göran bzw. wer eine Stachel-Instanz betreibt. Hintergrund und Technik: `docs/features/moderation.md`.
Google Play erwartet, dass Meldungen „zeitnah“ bearbeitet werden – Ziel: **innerhalb weniger Tage**, bei offensichtlich
rechtswidrigen Inhalten sofort.

## Einrichtung (je Instanz, einmalig)

In der `.env` der Instanz (vorher sichern):

```
STACHEL_REPORT_EMAIL=goeran@intsode.com          # hierhin gehen neue Meldungen
STACHEL_ADMIN_TOKEN=<openssl rand -base64 36>    # Schlüssel für tools/admin.mts, mind. 32 Zeichen
```

Danach `docker compose up -d` im Verzeichnis der Instanz. Mails brauchen SMTP (`STACHEL_SMTP_*`) – auch auf einer
Instanz im Modus org, sonst landen sie nur in `data/mail.log` im Container-Volume.

Den Token lokal ablegen (nicht ins Repo), z. B. `~/secrets/stachel/admin_intsode.token` bzw. `admin_<instanz>.token`.

## Werkzeug

`tools/admin.mts` spricht über HTTPS mit der Admin-API der Instanz, läuft also vom eigenen Rechner (Node ≥ 22):

```
# PowerShell
$env:STACHEL_ADMIN_URL = 'https://stachel.intsode.com'
$env:STACHEL_ADMIN_TOKEN = Get-Content ~/secrets/stachel/admin_intsode.token
server/node_modules/.bin/tsx tools/admin.mts reports
```

oder mit Schaltern: `tsx tools/admin.mts --url https://board.example.org --token-file ~/secrets/stachel/admin_board.token reports`.
`--json` gibt die Rohdaten aus. `--help` zeigt alle Befehle.

## Ablauf bei einer neuen Meldung

1. Mail „Neue Meldung R-XXXXXXXX“ kommt an (Grund, Beschreibung, Beleg, Board, beteiligte Personen).
2. Ansehen: `tsx tools/admin.mts report R-XXXXXXXX` – zeigt den Beleg (Text zum Zeitpunkt der Meldung) und den jetzigen
   Stand des Boards. Wer das Board selbst nicht sehen darf (Modus local), hat mit dem Beleg genug in der Hand; sonst die
   Besitzer:in fragen bzw. das Board vorsorglich sperren (Schritt 3, `board_readonly`).
3. Entscheiden – **immer mit Begründung** (geht wörtlich an die Betroffenen, also sachlich und ohne Namen der meldenden
   Person):

   ```
   tsx tools/admin.mts decide R-XXXXXXXX content_removed --statement "Die Notiz enthält eine Beleidigung einer Person." --ground "Nutzungsbedingungen, Abschnitt Verbotene Inhalte"
   ```

   | Entscheidung | Was passiert |
   |---|---|
   | `no_action` | nichts; die meldende Person erfährt, dass kein Verstoß vorliegt |
   | `content_removed` | gemeldetes Objekt bzw. Kommentar wird gelöscht (erste Nachricht = ganzer Thread) |
   | `board_readonly` | Board für alle nur noch ansehen (bis `unlock-board`) |
   | `board_hidden` | Board für alle ausgeblendet, Daten bleiben (bis `unlock-board`) |
   | `board_deleted` | Board endgültig gelöscht (kein Papierkorb) |
   | `account_locked` | Konto der betroffenen Person gesperrt; andere Person: `--affected <schlüssel>` |

   `--no-apply` nur entscheiden (Maßnahme schon von Hand erledigt), `--no-notify` keine Mails (z. B. bei Spam-Konten).
4. Benachrichtigt werden automatisch die meldende Person (Ergebnis + Begründung) und bei einer Maßnahme die betroffene
   Person (Begründung nach DSA Art. 17 mit Rechtsbehelf). Im **Modus org** kennt Stachel keine Mail-Adressen: das
   Werkzeug sagt dann „bitte selbst informieren“ – kurz per Mail/Messenger mit derselben Begründung.
5. Beschwerde gegen eine Entscheidung (Mail an die Melde-Adresse mit der Nummer): neu prüfen, ggf.
   `reopen R-…` und anders entscheiden bzw. `unlock-board`/`unlock-account`.

## Weitere Befehle

| Befehl | Zweck |
|---|---|
| `reports [--all\|--closed]` | offene (alle/erledigte) Meldungen |
| `notify R-…` | Entscheidung erneut an beide Seiten schicken |
| `board <id>` | Titel, Besitzer:in, Sperre, Personen |
| `lock-board <id> --reason "…" [--hidden]` / `unlock-board <id>` | Board sperren ohne Meldung (z. B. Behördenhinweis) |
| `delete-board <id> --yes` | endgültig löschen |
| `people <name>` | Schlüssel einer Person finden (`u:…` im Modus local) |
| `lock-account <schlüssel> --reason "…"` / `unlock-account <schlüssel>` | Konto sperren: Anmeldung gesperrt, Sitzungen beendet, KI-Tokens gelöscht (bleiben nach dem Entsperren weg) |
| `locks` | alle Sperren und die Melde-Adresse |

## Hinweise

- Meldungen und Entscheidungen bleiben in der Tabelle `reports` (Nachweis, Beschwerden). Löschfrist: zusammen mit der
  Datenschutzerklärung festlegen (Vorschlag 1 Jahr nach Entscheidung).
- Behörden-/Gerichtsanordnungen (DSA Art. 9/10) wie eine Meldung behandeln: `lock-board`/`delete-board`, Antwort an die
  Behörde von Hand.
- Instanz im Modus org: Meldungen gehen derzeit ebenfalls an `goeran@intsode.com`; sobald die Organisation eine
  eigene Adresse nennt, `STACHEL_REPORT_EMAIL` dort umstellen.
