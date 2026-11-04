#!/usr/bin/env bash
# Packs the built Linux bundle of the Stachel app (flutter build linux --release) as .deb and AppImage.
# Run in flutter/app on x86_64 Linux (Ubuntu 22.04 or newer; CI: .github/workflows/desktop.yml), docs/release/desktop.md:
#   linux/packaging/package.sh [deb|appimage|snap-prep|all]      (default: all = deb + AppImage)
# Needs: dpkg-deb (deb), curl + file (AppImage; appimagetool is downloaded, pinned by version and SHA-256).
# Output: build/linux/packages/stachel_<version>_amd64.deb, build/linux/packages/Stachel-<version>-x86_64.AppImage
# The Snap is built by snapcraft from the same bundle (snap/snapcraft.yaml).
set -euo pipefail
cd "$(dirname "$0")/../.."
what=${1:-all}

APP_ID=com.intsode.stachel
VERSION=$(sed -nE 's/^version:[[:space:]]*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' pubspec.yaml)
[[ -n $VERSION ]] || { echo "pubspec.yaml: no version x.y.z" >&2; exit 1; }
BUNDLE=build/linux/x64/release/bundle
[[ -x $BUNDLE/stachel ]] || { echo "$BUNDLE/stachel missing – first: flutter build linux --release" >&2; exit 1; }
OUT=build/linux/packages
PKG=linux/packaging
REPO=../..
mkdir -p "$OUT"

# icons, .desktop, AppStream and license files below <root>/usr/share
install_share() {
  local root=$1
  install -Dm644 "$PKG/$APP_ID.desktop" "$root/usr/share/applications/$APP_ID.desktop"
  install -Dm644 "$PKG/$APP_ID.metainfo.xml" "$root/usr/share/metainfo/$APP_ID.metainfo.xml"
  (cd "$PKG/icons" && find hicolor -name '*.png') | while read -r f; do
    install -Dm644 "$PKG/icons/$f" "$root/usr/share/icons/$f"
  done
  for f in LICENSE NOTICE THIRD_PARTY_NOTICES; do install -Dm644 "$REPO/$f" "$root/usr/share/doc/stachel/$f"; done
}

deb() {
  local root=$OUT/deb/stachel_${VERSION}_amd64
  rm -rf "$root"
  mkdir -p "$root/DEBIAN" "$root/opt/stachel" "$root/usr/bin"
  cp -a "$BUNDLE/." "$root/opt/stachel/"
  ln -s /opt/stachel/stachel "$root/usr/bin/stachel"
  install_share "$root"
  # Debian wants the license as usr/share/doc/<package>/copyright
  {
    echo "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/"
    echo "Upstream-Name: Stachel"
    echo "Source: https://github.com/goeranhegenberg/stachel"
    echo
    echo "Files: *"
    echo "Copyright: 2026 Göran Hegenberg"
    echo "License: Apache-2.0"
    echo " See /usr/share/doc/stachel/LICENSE; third-party components: /usr/share/doc/stachel/THIRD_PARTY_NOTICES"
  } >"$root/usr/share/doc/stachel/copyright"
  # GTK 3, EGL/GLES (Flutter engine), libsecret (login kept in the keyring), GStreamer (sounds, audioplayers) come
  # from the system (tested: Ubuntu 22.04 and 24.04)
  cat >"$root/DEBIAN/control" <<EOF
Package: stachel
Version: $VERSION
Architecture: amd64
Maintainer: Göran Hegenberg <goeran@intsode.com>
Installed-Size: $(du -sk "$root" | cut -f1)
Depends: libgtk-3-0t64 | libgtk-3-0, libegl1, libgles2, libsecret-1-0, libgstreamer1.0-0, libgstreamer-plugins-base1.0-0, libc6 (>= 2.35)
Recommends: gnome-keyring | kwalletmanager, gstreamer1.0-plugins-good, zenity | kdialog, xdg-utils
Section: graphics
Priority: optional
Homepage: https://github.com/goeranhegenberg/stachel
Description: Shared whiteboard for teams
 Stachel is an open-source online whiteboard: an endless canvas with sticky
 notes, shapes, text, connectors, pen, frames, images, PDFs, mind maps and
 comments. All changes reach everyone live. This is the desktop app; it
 connects to a Stachel server (default stachel.intsode.com).
EOF
  dpkg-deb --root-owner-group -Zxz --build "$root" "$OUT/stachel_${VERSION}_amd64.deb"
  echo "-> $OUT/stachel_${VERSION}_amd64.deb"
}

# appimagetool 1.9.1 (AppImage/appimagetool, MIT; embeds the type-2 runtime, MIT)
APPIMAGETOOL_URL=https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage
APPIMAGETOOL_SHA256=${APPIMAGETOOL_SHA256:-ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0}

appimage() {
  local dir=$OUT/Stachel.AppDir tool=$OUT/.tools/appimagetool-1.9.1-x86_64.AppImage
  rm -rf "$dir"
  mkdir -p "$dir" "$OUT/.tools"
  cp -a "$BUNDLE/." "$dir/"
  install_share "$dir"
  cp "$PKG/$APP_ID.desktop" "$dir/$APP_ID.desktop"
  cp "$PKG/icons/hicolor/256x256/apps/$APP_ID.png" "$dir/$APP_ID.png"
  ln -sf "$APP_ID.png" "$dir/.DirIcon"
  cat >"$dir/AppRun" <<'EOF'
#!/bin/sh
# Stachel AppImage: the Flutter bundle lies next to this file (stachel, lib/, data/)
HERE=$(dirname "$(readlink -f "$0")")
exec "$HERE/stachel" "$@"
EOF
  chmod +x "$dir/AppRun"
  if [[ ! -x $tool ]]; then
    curl -fsSL -o "$tool" "$APPIMAGETOOL_URL"
    chmod +x "$tool"
  fi
  echo "$APPIMAGETOOL_SHA256  $tool" | sha256sum -c --quiet -
  # no FUSE in containers/CI: the tool unpacks itself instead of mounting
  ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 VERSION=$VERSION "$tool" --no-appstream "$dir" "$OUT/Stachel-$VERSION-x86_64.AppImage"
  echo "-> $OUT/Stachel-$VERSION-x86_64.AppImage"
}

# license files for snapcraft (it only sees flutter/app, snap/snapcraft.yaml)
snap_prep() {
  mkdir -p build/linux/legal
  for f in LICENSE NOTICE THIRD_PARTY_NOTICES; do cp "$REPO/$f" build/linux/legal/; done
  echo "-> build/linux/legal (for snapcraft pack)"
}

case $what in
  deb) deb ;;
  appimage) appimage ;;
  snap-prep) snap_prep ;;
  all) deb && appimage ;;
  *) echo "usage: $0 [deb|appimage|snap-prep|all]" >&2; exit 2 ;;
esac
