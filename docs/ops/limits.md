# Grenzen gegen Missbrauch (Quoten, Raten)

Umsetzung der Befunde UPL-2 und MAIL-1 aus dem internen Sicherheits-Review vom 2026-11-02. Code: `server/src/limits.ts`
(Werte), `server/src/upload-limits.ts` (Prüfung vor dem Lesen des Uploads), `server/src/access-routes.ts`
(Einladungen). Alle Werte kommen aus der Umgebung (`.env` der Instanz); `0` heißt ohne Grenze. Die Vorgaben passen
für kleine selbst betriebene Instanzen.

| Variable | Vorgabe | Wirkung | Antwort |
|---|---|---|---|
| `STACHEL_UPLOAD_MAX_MB` | 15 | größte Datei je Upload (Bild, PDF, PDF-Seite); nur 1–15 MB, Web und Apps prüfen vorab auf 15 MB | 413 `too_large` |
| `STACHEL_USER_QUOTA_MB` | 1024 | Speicher je Konto: Summe aller Bilder/PDFs, die die Person hochgeladen hat, inklusive Kopien beim Einfügen über Boards hinweg und beim Duplizieren | 413 `quota_exceeded` |
| `STACHEL_UPLOADS_PER_HOUR` | 300 | Uploads je Person und Stunde (jede PDF-Seite zählt) | 429 `rate_limited` |
| `STACHEL_MAX_BOARDS_PER_USER` | 500 | Boards, die eine Person besitzt, inklusive Papierkorb (Anlegen, Duplizieren, Version als Kopie) | 403 `board_limit` |
| `STACHEL_INVITES_PER_HOUR` | 60 | Einladungs-/Teilen-Mails je Konto und Stunde | 429 `rate_limited` |
| `STACHEL_INVITES_PER_DAY` | 200 | Einladungs-/Teilen-Mails je Konto und Tag | 429 `rate_limited` |
| `STACHEL_INVITES_PER_DAY_IP` | 300 | Einladungs-/Teilen-Mails je IP (IPv6: /64) und Tag, über alle Konten | 429 `rate_limited` |

Alle Antworten tragen einen deutschen Text (`message`), den Web (`web/src/api.ts`) und Apps
(`stachel_client`: Bilder, PDFs) anzeigen, z. B. „Dein Speicherplatz ist voll (1.024 MB von 1.024 MB belegt). Lösche
Boards, die du nicht mehr brauchst, und leere den Papierkorb, um Platz zu schaffen.“ Die Apps behandeln
`rate_limited` beim Bild-Upload wie ein Funkloch (bleibt in der Warteschlange und versucht es später erneut).

Hinweise:

- Die Quote ist eine weiche Grenze: geprüft wird vor dem Upload bzw. Duplizieren gegen den schon belegten Platz.
  Der Vorgang, der sie überschreitet, läuft noch durch; danach geht nichts Neues mehr, bis wieder Platz ist.
  Platz wird frei, wenn Boards endgültig gelöscht werden (Papierkorb leeren oder nach 30 Tagen), nicht schon beim
  Entfernen eines Bilds vom Board (Versionen können es noch zeigen).
- Raten und Einladungszähler liegen im Speicher und beginnen nach einem Neustart von vorn.
- Proxy: nginx muss Uploads bis zur eingestellten Größe plus etwas Rand annehmen (`client_max_body_size 16m`).

## Eigene Instanzen (Hetzner)

Die INTSODE-Instanzen (`stachel.intsode.com` und eine Instanz im Modus org) setzen großzügigere Werte in der jeweiligen `.env`:

```
STACHEL_USER_QUOTA_MB=5120
STACHEL_UPLOADS_PER_HOUR=1000
STACHEL_MAX_BOARDS_PER_USER=2000
```

Die Einladungsgrenzen bleiben auf den Vorgaben.
