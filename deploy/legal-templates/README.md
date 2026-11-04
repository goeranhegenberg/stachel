# Vorlagen für Impressum, Datenschutzerklärung und Nutzungsbedingungen

Stachel bringt **keine** Rechtstexte mit. Wer eine Instanz öffentlich betreibt, braucht in der Regel eigene: ein
Impressum (in Deutschland § 5 DDG), eine Datenschutzerklärung (Art. 13 DSGVO) und – wenn sich Fremde registrieren
können – Nutzungsbedingungen (u. a. Art. 14 der Verordnung (EU) 2022/2065, „DSA“).

Die drei Dateien hier sind **Vorlagen ohne Gewähr und keine Rechtsberatung**. Sie beschreiben, was Stachel technisch
verarbeitet (Stand der Software), aber nicht deine Organisation, deine Dienstleister und deine Fristen.

1. Dateien nach `<DATA_DIR>/legal/` kopieren (im Container `/data/legal/`, anderer Ort: `STACHEL_LEGAL_DIR`):
   `impressum.html`, `datenschutz.html`, `nutzungsbedingungen.html`. Nur, was dort liegt, wird ausgeliefert.
2. Alle `[eckigen Klammern]` ersetzen, nicht Zutreffendes streichen, Fristen und Dienstleister prüfen. Den Kommentar am
   Anfang darfst du entfernen.
3. Die Seiten erscheinen ohne Neustart unter `/impressum`, `/datenschutz`, `/nutzungsbedingungen`. Fuß der Web-App,
   Registrierung, Produktseite, Apps und Mails verlinken sie automatisch, solange `STACHEL_IMPRINT_URL`,
   `STACHEL_PRIVACY_URL` bzw. `STACHEL_TERMS_URL` leer sind (sonst gelten die gesetzten Adressen).
4. Optional `STACHEL_TERMS_VERSION=<Datum>` setzen: Die Registrierung speichert die Fassung; ändert sich der Wert, fragt
   Stachel angemeldete Personen beim nächsten Öffnen erneut nach ihrer Zustimmung.

Format: HTML-Fragment (ohne `<html>`/`<head>`), erlaubt ist normales HTML; `<h1>` ist der Seitentitel, Tabellen in
`<div class="table">` einpacken. Platzhalter, die der Server füllt: `{{BRAND}}`, `{{ORIGIN}}`, `{{APP_URL}}`,
`{{IMPRINT_URL}}`, `{{PRIVACY_URL}}`, `{{TERMS_URL}}`, `{{DELETE_URL}}`, `{{TERMS_VERSION}}`. Skripte und fremde
Quellen (Bilder, Schriften von anderen Servern) bitte nicht einbinden – die Content-Security-Policy blockiert sie ohnehin.

Doku: `docs/features/legal-pages.md`.
