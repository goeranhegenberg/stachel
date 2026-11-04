# Feature-Modul „versions“ – Versionsverlauf

Versionsverlauf: alle Stände eines Boards ansehen, wiederherstellen, als Kopie öffnen, benennen.
Server und API: `server/src/versions.ts`, Vertrag `docs/contract.md` §3 „Versionen“.

## Bedienung

- **Öffnen:** Board-Menü „···“ → „Versionsverlauf“ oder **Strg Alt H** (schaltet um). Seitenleiste `versions.history`.
- **Liste:** oben „Version speichern“ (Name eingeben, Enter), „Aktueller Stand“, darunter die Versionen nach Tagen
  („Heute“, „Gestern“, „Mittwoch, 28. Oktober“): Uhrzeit, Name (grün), wer geändert hat (Avatare in der festen
  Personenfarbe, `userColor`), Art („Bearbeitet von Mara und Jonas“, „Gespeichert von …“, „Sicherung vor dem
  Wiederherstellen“, „Jonas hat den Stand von gestern, 10:00 wiederhergestellt“) und Objektzahl. Aktualisiert sich alle
  30 s und beim Zurückkehren ins Fenster.
- **Vorschau:** Klick auf eine Version zeigt sie auf der Leinwand, schreibgeschützt: blauer Rahmen, Balken „Vorschau:
  Stand von …“ (oben mittig; am Handy unten), Werkzeuge/Kontextleiste/Rückgängig/Board-Menü ausgeblendet, Hand-Werkzeug
  (Ziehen verschiebt die Ansicht), Zoomen/Einpassen gehen, Tasten, Einfügen, Ablegen und Rechtsklick wirken nicht.
  Das Live-Board bleibt verbunden und wird nicht verändert; andere sehen davon nichts.
- **Unter dem gewählten Eintrag:** „Diese Version wiederherstellen“ (Bestätigung; alle sehen den Stand sofort, der
  vorige Stand wird vorher gesichert), „Als Kopie öffnen“ (neues Board „<Titel> (Stand 28.10., 14:20)“, wird geöffnet),
  „Version benennen“/„Umbenennen“ (leer = Name entfernen).
- **Zurück zum aktuellen Stand:** Balken-Knopf, Esc oder „Aktueller Stand“ in der Liste. Kamera bleibt, wo sie war.
- **Handy:** Die Liste ist ein Blatt unten; beim Wählen einer Version schließt sie sich, der Balken bietet „Versionen“,
  „Wiederherstellen“ und ✕.

## Umsetzung

- `index.ts` registriert Seitenleiste, Overlay-Slot `versions.layer`, Board-Menü `versions.history` (Reihenfolge 36,
  nur mit Board-ID) und Kürzel `versions.history`.
- Vorschau = eigene `PreviewSession` (`state.ts`, erbt von `LocalSession`, Bilder über `/api/images/…`, kein Hochladen)
  mit dem Yjs-Update der Version. Den Editor schaltet der Kern-Erweiterungspunkt `editor/ext/sessionOverride.ts` um:
  `EditorPage` baut den Editor mit der Ersatz-Sitzung neu auf, die Live-`SyncSession` bleibt bestehen. Was über den
  Neuaufbau hinweg bleiben soll (Kamera, offene Seitenleiste, Hinweis), steht in `pending` und wird im Slot beim
  Einhängen angewendet.
- Schreibschutz im Slot `PreviewLayer.tsx`: Fenster-Listener in der Capture-Phase (vor denen des Editors registriert)
  lassen nur Ansichts-Tasten durch; Eingaben in Seitenleiste, Balken und Dialogen bleiben normal. Änderungen könnten
  ohnehin nur das Wegwerf-Dokument im Browser treffen.
- Keine Y-Strukturen, Objektfelder oder Awareness-Felder.

## Tests

- Server: `server/test/versions.test.ts` (Ausdünnen, Inhalt übernehmen mit verbundenem zweitem Dokument, Takt mit eigener
  Uhr, HTTP: Vorschau-Inhalt, Wiederherstellen mit zwei verbundenen Clients, ohne offene Verbindung, benennen, Kopie).
- Web: `web/src/features/versions/versions.test.ts` (Tage, Zeiten, Beschreibungen).
- Root-E2E: `e2e/tests/versions.spec.ts` (Mara speichert, arbeitet weiter; Jonas sieht die alte Version schreibgeschützt,
  stellt sie wieder her, Mara sieht es live; Sicherung benennen, als Kopie öffnen; Handy). Screenshots
  `docs/screenshots/versions-*.png`.
