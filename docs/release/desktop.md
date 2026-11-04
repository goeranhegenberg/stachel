# Stachel-App für Windows und Linux

Auftrag Göran (2026-11-04): „Stachel muss auch als native Windows- und Linux-App verfügbar sein, und zwar am besten mit
einem Installer.“ Entscheidung: **Windows** = Microsoft Store (MSIX) + unsignierter `.exe`-Installer (kein bezahltes
Zertifikat); **Linux** = Snap Store + `.deb` + AppImage.

Es ist dieselbe Flutter-App wie auf Android (`flutter/app`, Paket-ID `com.intsode.stachel`, Name „Stachel“), mit denselben
Paketen `stachel_board` und `stachel_client`. Nur Fenster, Installer und ein paar Plattform-Weichen sind neu.

## 1. Was am Desktop anders ist

| Thema | Windows / Linux |
|---|---|
| Fenster | Titel „Stachel“, Start 1280 × 800, Mindestgröße 480 × 560 (`windows/runner/win32_window.cpp` `WM_GETMINMAXINFO`, `linux/runner/my_application.cc`); Größe, Position und „maximiert“ bleiben über einen Neustart (Registry `HKCU\Software\INTSODE\Stachel` bzw. `~/.config/stachel/window.ini`) |
| Maus und Tastatur | wie die Web-App: Mausrad zoomt am Zeiger (einstellbar: schwenken), Umschalt + Rad seitlich, Trackpad verschiebt, Ziehen wählt aus, Rechtsklick-Menüs als Popup, alle Tastenkürzel, großes Fenster mit Werkzeugleiste links – **`docs/features/desktop.md`** |
| Symbole | aus der Bildmarke (`web/public/favicon.svg`) gerechnet: `dart run tool/gen_desktop_icons.dart` in `flutter/app` → `windows/runner/resources/app_icon.ico` (16–256 px), `windows/packaging/stachel_logo.png` (MSIX), `linux/packaging/icons/hicolor/*/apps/com.intsode.stachel.png` |
| Nur ein Fenster | Ein zweiter Start (z. B. ein Link) reicht seinen Link an die laufende App weiter und endet (Windows `SendAppLinkToInstance` in `main.cpp`, Linux eindeutige `GApplication` mit `HANDLES_COMMAND_LINE`) |
| Links | `stachel://<host>/<pfad>` ist derselbe Link wie `https://<host>/<pfad>` (`lib/links.dart`), z. B. `stachel://stachel.intsode.com/b/<board>`. Registriert vom Installer (Registry `HKCU\Software\Classes\stachel`), vom MSIX (`protocol_activation`) und unter Linux über `MimeType=x-scheme-handler/stachel` in der `.desktop`-Datei. Ein `https://…`-Link als Programm-Argument (`stachel.exe https://stachel.intsode.com/b/<id>`) wird genauso geöffnet. Dass der Browser `https://`-Links direkt an die App gibt (wie Android App Links), gibt es am Desktop nicht |
| Teilen → Stachel | Android-Teilen-Ziel gibt es am Desktop nicht; stattdessen **Dateien aufs Fenster ziehen** (Bilder, PDFs, Textdateien) → „Auf welches Board?“ → sie landen in dessen Mitte (`lib/desktop.dart`, `desktop_drop`). Die Originale bleiben unberührt (Kopie im Temp-Ordner) |
| Kamera | gibt es nicht: „Foto aufnehmen“ ist ausgeblendet (`stachelHasCamera`), „Bild einfügen“ öffnet direkt den Dateidialog |
| Anmeldung merken | `flutter_secure_storage`: Windows mit DPAPI verschlüsselte Datei, Linux Schlüsselbund über libsecret (GNOME Keyring, KWallet). Ohne Schlüsselbund bleibt man nur bis zum Beenden angemeldet (nie Klartext) |
| PDFs | pdfrx mit PDFium (`pdfium.dll` / `libpdfium.so`, vom Build-Hook von `pdfium_dart` geladen, gleiche Version wie Android) |
| Zwischenablage | Text und Bilder; HTML zwischen Browser und App (Objekte kopieren) bisher nur Android |
| Benachrichtigungen | keine (wie in der Android-Stachel-App; Erwähnungen erscheinen beim Öffnen als Hinweis) |
| Daten | Windows `%APPDATA%\Stachel\Stachel`, Linux `~/.local/share/com.intsode.stachel` (Snap: im Snap-Ordner) |

## 2. Bauen (lokal)

Voraussetzungen Windows: Flutter 3.47.2, Visual Studio mit „Desktopentwicklung mit C++“, Inno Setup 6
(`winget install JRSoftware.InnoSetup`). Linux: Ubuntu 22.04 oder neuer mit
`clang cmake ninja-build pkg-config libgtk-3-dev libsecret-1-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev`.

```powershell
cd flutter\app
powershell -ExecutionPolicy Bypass -File windows\installer\build.ps1 -Msix
#  → build\installer\Stachel-Setup-<version>.exe   (Inno Setup, pro Benutzer, ohne Adminrechte)
#  → build\windows\msix\stachel.msix              (unsigniert, nur für den Store)
```

```bash
cd flutter/app
flutter build linux --release
linux/packaging/package.sh all        # → build/linux/packages/stachel_<version>_amd64.deb, Stachel-<version>-x86_64.AppImage
linux/packaging/package.sh snap-prep  # Lizenzdateien für snapcraft
snapcraft pack                        # → stachel_<version>_amd64.snap (braucht LXD oder Multipass; sonst CI)
```

Die Version kommt überall aus `pubspec.yaml` (`version: x.y.z+n` → `x.y.z`; MSIX `x.y.z.0`).

**Windows-Installer** (`windows/installer/stachel.iss`): installiert pro Benutzer nach `%LOCALAPPDATA%\Programs\Stachel`
(keine UAC-Abfrage), Startmenü, Desktop-Verknüpfung auf Wunsch, Deinstallation über „Apps“, URL-Protokoll `stachel://`,
Lizenzseite (Apache-2.0), Deutsch und Englisch, Visual-C++-Laufzeit liegt neben der `stachel.exe` (kein extra
Redistributable nötig). Updates: neuen Installer drüber installieren (gleiche `AppId`, laufende App wird geschlossen).
Stille Installation: `Stachel-Setup-<version>.exe /VERYSILENT /CURRENTUSER`.
**Nicht signiert:** Windows SmartScreen zeigt beim ersten Start „Der Computer wurde durch Windows geschützt“ →
„Weitere Informationen“ → „Trotzdem ausführen“. Wer das nicht will, nimmt die Store-Version (dort signiert Microsoft).
Inno Setup 6.7 meldet beim Kompilieren „Non-commercial use only“ – Stachel ist nicht kommerziell; die Lizenz
(`tools/licenses/texts/innosetup.txt`) erlaubt die Weitergabe.

**Linux-Pakete:** `.deb` legt die App nach `/opt/stachel` (Aufruf `stachel`), Abhängigkeiten GTK 3, EGL/GLES, libsecret,
GStreamer aus der Distribution (getestet Ubuntu 22.04 und 24.04). Das AppImage enthält nur die App, GTK usw. kommen
vom System; ausführbar machen und starten (ohne FUSE: `--appimage-extract-and-run`). Der Snap (`snap/snapcraft.yaml`,
core22, strict, GNOME-Erweiterung) packt **denselben** Build; GTK, libsecret und GStreamer liefert das Laufzeit-Snap
`gnome-42-2204`.

## 3. CI (GitHub Actions, `.github/workflows/desktop.yml`)

- Tag `v*`: Windows-Job (Rauchtest, Installer, MSIX) und Linux-Job (Rauchtest unter Xvfb, deb, AppImage, Snap über
  `snapcore/action-build`), danach alles plus `SHA256SUMS-desktop.txt` an das GitHub-Release (`GITHUB_TOKEN`).
- Snap Store nur, wenn das Repository-Secret `SNAPCRAFT_STORE_CREDENTIALS` existiert: Tags mit `-` (z. B.
  `v1.3.0-rc.1`) → Kanal `edge`, sonst `candidate`. Nach `stable` schiebt Göran von Hand (`snapcraft release` oder
  Snapcraft-Dashboard), nachdem er die Version geprüft hat.
- Push auf `main`, der `flutter/app/windows|linux|snap` oder `pubspec.*` ändert, und „Run workflow“: nur bauen
  (Artefakte des Laufs), kein Release. „Run workflow“ mit `tag` hängt an ein bestehendes Release an; mit zusätzlich `ref` (z. B. `main`) wird dieser Stand gebaut statt
  des Tags – für Packaging-/CI-Korrekturen nach dem Tag (so geschehen bei v1.1.0: `.desktop`-`Version=1.5` kannte
  `desktop-file-validate` unter Ubuntu 22.04 nicht, jetzt `1.4`; `libunwind-14-dev` des Runner-Images blockierte GStreamer).
- Vor dem Release-Tag `THIRD_PARTY_NOTICES` nach `docs/open_source/publish.md` §1 neu erzeugen, wenn sich
  Abhängigkeiten geändert haben – die Installer liefern die Datei mit aus. Die Desktop-Bestandteile (VC-Laufzeit, Inno
  Setup, AppImage-Laufzeit, System-Bibliotheken unter Linux) stehen in `tools/licenses/components.json`.
- Der Store-Upload des MSIX passiert **nicht** automatisch (siehe 4.).

## 4. Microsoft Store – was Göran einmal tun muss

1. **Entwicklerkonto anlegen** (kostenlos für Einzelpersonen seit 2024): <https://storedeveloper.microsoft.com> →
   „Get started“ → mit dem Microsoft-Konto anmelden → Kontotyp **Individual** → Name, Adresse, Identitätsprüfung
   (Ausweis + Selfie über den verlinkten Dienst). Dauer: Minuten bis wenige Tage.
2. **Namen reservieren:** <https://partner.microsoft.com/dashboard/apps-and-games/overview> → „Neues Produkt“ →
   „MSIX- oder PWA-App“ → Name **Stachel** → „Produktnamen reservieren“.
3. **Drei Werte kopieren:** im Produkt → „Produktverwaltung“ → **„Produktidentität“**:
   - `Package/Identity/Name` (z. B. `12345Goeran.Stachel`) → `identity_name`
   - `Package/Identity/Publisher` (`CN=…` mit GUID) → `publisher`
   - `Package/Properties/PublisherDisplayName` → `publisher_display_name`

   und in `flutter/app/pubspec.yaml` unter `msix_config` die Platzhalter (`PLATZHALTER…`, `CN=00000000-…`) ersetzen,
   committen. (Die Werte sind nicht geheim.)
4. **Erste Einreichung:** MSIX aus dem GitHub-Release (`Stachel-<version>-x64.msix`) oder lokal per
   `build.ps1 -Msix` → im Partner Center „Einreichung starten“ → Pakete hochladen, Preis „kostenlos“, Alterseinstufung
   (Fragebogen: Nutzer-Inhalte/Chat → „Benutzerinteraktion“), Datenschutz-URL, Store-Eintrag (Texte wie
   `docs/store/play_listing_de.md`, Bildschirmfotos 1366 × 768 oder größer). Die Fähigkeit `runFullTrust` muss begründet
   werden: „Desktop-App (Flutter/Win32), braucht Netzwerk und Dateizugriff für Bilder/PDFs“.
5. Spätere Versionen: Version in `pubspec.yaml` erhöhen, Tag → CI baut das MSIX → im Partner Center neue Einreichung
   mit dem neuen Paket.

## 5. Snap Store – was Göran einmal tun muss

1. Ubuntu-One-Konto: <https://login.ubuntu.com> (kostenlos), damit bei <https://snapcraft.io/account> anmelden und den
   Entwickler-Vertrag annehmen.
2. Snap-Namen registrieren (auf einem Rechner mit snapcraft, z. B. Ubuntu oder WSL: `sudo snap install snapcraft --classic`):
   ```bash
   snapcraft login
   snapcraft register stachel
   ```
   Ist „stachel“ vergeben: anderen Namen wählen (z. B. `stachel-board`) und in `flutter/app/snap/snapcraft.yaml` `name:`
   anpassen.
3. Zugangsdaten für CI erzeugen und als Secret hinterlegen:
   ```bash
   snapcraft export-login --snaps=stachel --channels=edge,candidate --acls=package_access,package_push,package_update,package_release --expires="2027-12-31" -
   ```
   Die Ausgabe (eine lange Zeile) auf GitHub unter Settings → Secrets and variables → Actions → „New repository secret“
   als **`SNAPCRAFT_STORE_CREDENTIALS`** speichern. Ab dem nächsten Tag lädt CI den Snap hoch.
4. **Schlüsselbund-Zugriff:** Die Schnittstelle `password-manager-service` wird nicht automatisch verbunden. Ohne sie
   bleibt man nur bis zum Beenden angemeldet. Entweder Nutzer:innen verbinden sie einmal
   (`sudo snap connect stachel:password-manager-service`), oder Göran beantragt im Forum <https://forum.snapcraft.io>
   (Kategorie „store-requests“) „auto-connect password-manager-service for stachel“ mit der Begründung „stores the login
   token of the user's own account via libsecret, nothing else“. Ebenso prüft der Store den `dbus`-Slot
   (`com.intsode.stachel`, für „nur ein Fenster“) beim ersten Upload von Hand.
5. Nach Prüfung in `candidate`: `snapcraft release stachel <revision> stable`.

## 6. Tests

- `flutter analyze` (App, `stachel_client`), `flutter test test/desktop_test.dart` (Links `stachel://`, Dateitypen).
- Rauchtest auf dem echten Desktop (echte Plugins, echtes Fenster):
  ```bash
  MSYS_NO_PATHCONV=1 server/node_modules/.bin/tsx tools/sandbox.mts 8871 --local --seed
  cd flutter/app && flutter test integration_test/desktop_smoke_test.dart -d windows \
    --dart-define=STACHEL_BASE=http://127.0.0.1:8871 --dart-define=STACHEL_SHOTS=<ordner>
  ```
  Ohne `STACHEL_BASE` nur die Anmeldeseite (so läuft er in der CI, Linux unter `xvfb-run`). Mit Sandbox geht er danach
  Maus und Tastatur durch (Auswahl, Rechtsklick-Menüs, Befehlspalette, Tastenkürzel, Dunkelmodus,
  `docs/features/desktop.md`); die Bilder von Windows liegen in `docs/screenshots/desktop/`.
- Linux-Pakete wurden in Wegwerf-Containern (`ubuntu:22.04`, `ubuntu:24.04`) installiert und unter Xvfb gestartet.
