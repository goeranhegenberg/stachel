# Desktop: Maus und Tastatur

Auftrag Göran (2026-11-04): Die native Stachel-App für Windows und Linux soll sich mit Maus und Tastatur so bedienen
lassen wie die Web-App. Das Handy bleibt, wie es ist; was hier steht, greift bei Maus-Ereignissen (auch am Tablet mit
Maus), bei einer Hardware-Tastatur und im großen Fenster.

Code: `flutter/packages/stachel_board/lib/src/editor/desktop.dart` (`BoardDesktop`: Schalter, Leertaste, Mausrad),
`lib/src/features/desktop/` (`keyboard.dart` = `BoardKeyboard`, `shortcuts_help.dart` = Liste und Dialog
„Tastenkürzel“, `register.dart` = Werkzeug „Verschieben“ und Board-Menü „Tastenkürzel“).

## 1. Maus

Maus-Ereignisse (`PointerDeviceKind.mouse`) gehen in `BoardView` einen eigenen Weg (`_mouseDown`/`_mouseMove`/`_mouseUp`,
Zustandsmaschine `BoardGestures` mit `BoardPointer.mouse`/`pan`); Finger und Stift bleiben, wie sie sind. Vorbild ist
`web/src/editor/Editor.tsx` (Zeiger, Rad, Kontextmenü).

| Maus | Wirkung |
|---|---|
| Mausrad | **am Mauszeiger zoomen wie im Web** (Göran 04.11. abends: „die App soll sich wie die Web-Version verhalten“): je Raste e^0,12 ≈ 13 %, höchstens 3 Rasten je Ereignis (`WHEEL_STEP` in `Editor.tsx`). Einstellung „Mausrad: Zoomen / Schwenken“ im Dialog „Tastenkürzel“ und im Board-Menü (Eintrag „Mausrad“, wie `view.wheelMode` im Web), gespeichert unter `stachel.wheel` (Standard „Zoomen“; „Schwenken“ = Rad verschiebt die Ansicht) |
| Umschalt + Rad | seitlich verschieben (in beiden Einstellungen) |
| Strg (⌘) + Rad | am Mauszeiger zoomen, in beiden Einstellungen, je Raste gleich weit (e^0,35 ≈ 42 %, Rasten-Zähler wie `createNotchCounter`) |
| Trackpad | zwei Finger verschieben **immer**, Spreizen zoomt am Fingerpunkt (`PointerPanZoom…`, Windows-Präzisions-Touchpad, Linux-Touchpad). Das Web rät Maus oder Trackpad aus den Rad-Werten (`createWheelClassifier`); Flutter kennt das Gerät (`PointerDeviceKind`), darum zoomt ohne Strg nur ein echtes Mausrad |
| Links ziehen auf leerer Fläche | Auswahlrechteck sofort (statt Verschieben wie am Finger); Strg = Lasso, Umschalt = zur Auswahl dazu; nur ansehen/kommentieren: verschiebt |
| Links ziehen auf Objekt | verschiebt sofort (ein nicht gewähltes wird vorher gewählt, samt Gruppe); kein Halten nötig, keine Halte-Menüs |
| Alt + Ziehen | zieht eine Kopie (das Original bleibt); Alt beim Ziehen = Einrasten aus (`BoardEditor.snapOff`) |
| Klick · Umschalt + Klick | wählen · zur Auswahl dazu bzw. heraus |
| Doppelklick | Text bearbeiten (Notiz, Text, Form, Thema; Rahmentitel/Linienbeschriftung im Dialog); auf leerer Fläche neue Haftnotiz |
| Mittlere Taste + Ziehen · Leertaste + Ziehen · rechte Taste + Ziehen | Ansicht verschieben (auch über Objekten) |
| Rechtsklick | Objekt-Menü (Objekt wird vorher gewählt) bzw. Flächen-Menü als Popup am Mauszeiger (`showBoardPopup`), Untermenüs öffnen als eigenes Popup daneben; rechts in jeder Zeile das Tastenkürzel (`menuShortcuts`) |
| Board-Menü „⋮“ | in der Desktop-App als Popup oben rechts (mit den Gruppen-Überschriften) statt als Blatt |
| Hover | dünner blauer Rahmen um das Objekt unter dem Zeiger (nur Werkzeug Auswahl, nicht gewählt) |
| Zeiger | Größen-Pfeile an den Griffen (Ecken diagonal, Kanten waagerecht/senkrecht), Hand am Drehgriff und bei Leertaste/Werkzeug „Verschieben“, „greifen“ beim Verschieben, Bewegen-Kreuz über der Auswahl, Textcursor beim Text-Werkzeug, Fadenkreuz bei den Zeichen-Werkzeugen, Hand-Zeiger über Kommentar-Pins und Plus-Knöpfen |
| Klick aufs Board | holt die Tastatur zurück aufs Board (z. B. aus dem Suchfeld) |

Die Einführung beim ersten Board zeigt in der Desktop-App ([`BoardDesktop.enabled`], von `flutter/app/lib/main.dart`
gesetzt) vier Karten mit Maus statt Fingern: Mausrad (Text folgt der Einstellung, Standard „Mausrad = zoomen, Umschalt +
Mausrad = seitlich verschieben“), Objekte ziehen, Ziehen = auswählen, Rechtsklick = Menü (`GestureOnboarding.desktopCards`); der Menü-Eintrag heißt dort „Einführung Maus und Tastatur“.

## 2. Tastatur

`BoardKeyboard` liegt um die Board-Fläche und hat den Fokus, sobald das Board offen ist oder angeklickt wird. Die
Reihenfolge ist die des Webs (`editor/core/shortcuts.ts`, `Editor.tsx` `keyRef.down`): beim Schreiben nur die
Schreib-Kürzel, auf dem Board erst die Kürzel, dann die eigenen Tasten des Editors (Leertaste, Bild ↑/↓, Entf, Esc,
Enter, Tab, Pfeile, Tippen), dann die „späten“ Kürzel (+, −, ?, /, R, O), zuletzt die Werkzeug-Tasten. Strg (am Mac ⌘)
muss genau stimmen, Umschalt/Alt nur, wenn das Kürzel sie nennt; Kürzel mit mehr Zusatztasten gehen vor. Ein anderes
Textfeld (Suche, Kurznachricht, Dialog) behält seine Tasten. Mit Rolle „Ansehen“/„Kommentieren“ wirken nur Kürzel, die
nichts ändern (Kommentar-Werkzeug C mit Kommentarrecht).

| Gruppe | Tasten | Wirkung |
|---|---|---|
| Werkzeuge | V · H · N · T · S · L · P · E · F · C | Auswählen · Verschieben (Hand) · Haftnotiz · Text · Form · Verbinder · Stift · Radierer · Rahmen · Kommentar |
| Werkzeuge | R / O | Form-Werkzeug mit Rechteck / Kreis |
| Bearbeiten | Strg Z · Strg Y / Strg Umschalt Z | Rückgängig · Wiederholen |
| Bearbeiten | Strg C / X / V | Kopieren / Ausschneiden / Einfügen (am Mauszeiger, sonst Mitte der Ansicht) |
| Bearbeiten | Strg D · Strg A | Duplizieren · Alles auswählen |
| Bearbeiten | Strg G · Strg Umschalt G | Gruppieren · Gruppierung lösen (Web-Aktionen `core.group`/`core.ungroup`) |
| Bearbeiten | Entf / Rücktaste | Auswahl löschen (Mindmap-Themen samt Unterthemen, ohne Rückfrage wie im Web) |
| Bearbeiten | Enter | gewähltes Objekt bearbeiten (Notiz, Text, Form, Mindmap-Thema; Rahmentitel/Linienbeschriftung im Dialog) |
| Bearbeiten | Tippen | Zeichen auf einer gewählten Notiz/Text/Form/Thema beginnt das Schreiben mit diesem Zeichen |
| Bearbeiten | Esc | Format-Pinsel/Zielwahl beenden → Suche schließen → zurück zu Auswahl → Auswahl aufheben; beim Schreiben: Schreiben beenden |
| Bearbeiten | ← → ↑ ↓ (Umschalt: 10) | Auswahl um 1 bzw. 10 Punkte verschieben (Rahmen mit Inhalt) |
| Bearbeiten | Tab / Umschalt Tab | auf dem Board: nächstes/voriges Objekt wählen; beim Schreiben: nächste Haftnotiz (in einer Liste: ein-/ausrücken) |
| Bearbeiten | Strg B / I / U · Strg Umschalt S | Fett / Kursiv / Unterstrichen · Durchgestrichen – beim Schreiben für die Textauswahl, sonst für die ganzen gewählten Objekte |
| Bearbeiten | Strg K | beim Schreiben Link für die Auswahl; auf einem gewählten Objekt mit Text „Link für den Text“; sonst Befehlspalette |
| Bearbeiten | Strg Alt C / V | Format kopieren / einfügen |
| Ansicht | Strg K / Strg Umschalt K | Befehl suchen (Palette) |
| Ansicht | Strg F · Strg H | Auf dem Board suchen · Suchen und ersetzen |
| Ansicht | Leertaste + Ziehen | Ansicht verschieben (`BoardDesktop.spaceDown`) |
| Ansicht | Umschalt 1 · Umschalt 2 | Alles einpassen · Auf Auswahl zoomen |
| Ansicht | + / = · − (auch mit Strg) | Vergrößern / Verkleinern (Zoomstufen der Zoomleiste) |
| Ansicht | Strg 0 / Umschalt 0 | Zoom 100 % |
| Ansicht | Strg ' | Raster ein/aus |
| Ansicht | Bild ↑ / Bild ↓ | vorheriger / nächster Rahmen (höchstens 200 %) |
| Ansicht | Strg \ (deutsch: Strg #) | Oberfläche aus-/einblenden |
| Ansicht | F11 | Vollbild |
| Ansicht | Strg Alt H | Versionsverlauf |
| Ansicht | ? / Strg / | Tastenkürzel (Dialog mit Filter und Schalter „Mausrad: Zoomen / Schwenken“) |
| Anordnen | Strg ] / Strg [ · Strg Umschalt ] / [ | eine Ebene nach vorne/hinten · ganz nach vorne/hinten |
| Anordnen | Strg Umschalt L · Strg Umschalt H | Sperren/Entsperren · Ausblenden/Einblenden |
| Mindmap | Tab · Enter | Unterthema · Thema auf gleicher Ebene (auch beim Schreiben) |
| Mindmap | Pfeiltasten | zwischen Themen wechseln (am Rand nichts; die Wurzel bewegt sich mit ↑/↓ samt Mindmap) |
| Mindmap | Strg . | Zweig ein-/ausklappen |
| Zusammenarbeit | / | Kurznachricht am Mauszeiger |
| Präsentation | → ↓ Bild ↓ Leertaste Enter · ← ↑ Bild ↑ Rücktaste · Pos1 / Ende · Esc | weiter · zurück · erster/letzter Rahmen · beenden |

Beim Schreiben bleiben Strg Z/Y, Strg A, Pfeile, Pos1/Ende usw. beim Textfeld.

**Nicht nativ** (bewusst): `Alt + Ziehen` (Kopie ziehen) und `Alt beim Ziehen` (Einrasten aus) gehören zur Maus (§1);
die Zeitleisten-Tasten des Webs (Entf/Pfeile/Esc auf einem gewählten Zeitleisten-Eintrag) – die App bearbeitet
Einträge im Blatt. Markdown-Kürzel beim Schreiben (`- `, `1. `, `# ` …) hat das Textfeld selbst (P8).
Abweichung vom Web: das Werkzeug „Verschieben“ (H) hebt die Auswahl auf (im Web bleibt sie).

## 3. Großes Fenster und Tablet

Ab `BoardDesktop.isWide` (Fenster mindestens 900 × 520, auch Tablets – UX-Review P12) legt sich das Board wie im Web aus;
schmaler bleibt alles wie am Handy.

- **Werkzeugleiste links** (`BoardSideToolbar`, `editor/ui/board_toolbar.dart`): schwebende Leiste am linken Rand mit
  allen Werkzeugen (auch denen unter „Weitere Werkzeuge“ und der Hand), Tooltips mit der Web-Taste („Haftnotiz (N)“),
  Rückgängig/Wiederholen unten (bleiben sichtbar, die Werkzeuge scrollen im niedrigen Fenster). Die Optionen des aktiven
  Werkzeugs stehen in einem Feld rechts daneben. Keine Leiste unten.
- **Kontextleiste schwebt** (`BoardFloatingContextBar`, `editor/ui/board_context_bar.dart`): mittig über der Auswahl
  (Abstand für den Drehgriff), ohne Platz darüber darunter, immer im Bild und frei von der Werkzeugleiste; eine Zeile
  Symbol-Knöpfe mit Tooltips, Rest unter „Mehr“; folgt Kamera und Auswahl, beim Ziehen/Drehen/Größe-Ändern weg.
- **Seitenleisten** (`editor/ui/board_side_panel.dart`): Kommentare und Rahmen öffnen rechts (380 px, volle Höhe,
  ✕/Esc/Klick daneben schließt); andere Blätter von unten höchstens 640 px breit (`BoardUi.wideSheetWidth`).
- **Board-Liste** ab 600 dp als Raster aus Karten (Spalten ab 340 px).
- Beim Schreiben bleibt die Schreibleiste unten.

## 4. Fenster

- Größe, Position und „maximiert“ bleiben über einen Neustart erhalten: Windows `HKCU\Software\INTSODE\Stachel`,
  Wert `WindowPlacement` (`windows/runner/win32_window.cpp`, gespeichert bei `WM_DESTROY`, beim ersten Bild wieder
  gesetzt; liegt der Platz auf keinem Bildschirm mehr, kommt das Fenster an die Standard-Stelle; der Installer löscht den
  Schlüssel beim Deinstallieren). Linux `~/.config/stachel/window.ini` (`linux/runner/my_application.cc`; unter Wayland
  bestimmt der Compositor die Position).
- Mindestgröße 480 × 560 (wie bisher), Start ohne gespeicherten Stand 1280 × 800.
- F11 schaltet „Vollbild“ der Board-Ansicht (Leisten weg); ein echtes randloses Fenster gibt es noch nicht.

## 5. Tests

- `flutter/packages/stachel_board/test/desktop_mouse_test.dart` (Maus: Rad zoomt, Umschalt + Rad, Einstellung
  „Schwenken“, Strg + Rad, Trackpad-Wischen und -Spreizen, Rechteck/Lasso,
  Ziehen, Alt-Kopie, Umschalt-Klick, Doppelklick, Leertaste/mittlere/rechte Taste, Rechtsklick-Menüs, Zeiger und Hover)
  und `desktop_keyboard_test.dart` (Kürzel mit echten Tasten-Ereignissen).
- `flutter/packages/stachel_client/test/desktop_menus_test.dart` (Popups am Mauszeiger mit Tastenkürzeln, Untermenü,
  Board-Menü in der Desktop-App samt Eintrag „Mausrad“, Tasten am Board-Bildschirm, Einführung) und `desktop_layout_test.dart` (großes Fenster).
- Echte Windows-App: `flutter/app/integration_test/desktop_smoke_test.dart` (Aufruf in `docs/release/desktop.md` §6) mit
  Bildschirmfotos nach `docs/screenshots/desktop/`: Anmeldung, Board-Liste, Einführung, Board, Auswahl mit schwebender
  Kontextleiste, Rechtsklick auf Objekt bzw. Fläche, Befehlspalette, Tastenkürzel, Dunkelmodus (mit Menü).
