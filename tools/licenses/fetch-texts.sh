#!/usr/bin/env bash
# Lädt die Lizenzdateien, die nicht in node_modules bzw. im Pub-Cache liegen, in tools/licenses/texts/:
#   libvips/<lib>.txt  – Lizenzdateien der von sharp-libvips gebündelten Bibliotheken, je am exakten Upstream-Tag
#                        (Versionen aus versions.properties von lovell/sharp-libvips am Tag der sharp-libvips-Version
#                        in server/package-lock.json)
#   common/<id>.txt    – Standardtexte (GPL/LGPL/MPL/IPA), auf die THIRD_PARTY_NOTICES verweist
# Danach: node tools/licenses/third-party-notices.mjs (erzeugt THIRD_PARTY_NOTICES). Nur nötig, wenn sich die
# sharp-libvips-Version ändert; die Texte sind eingecheckt.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=tools/licenses/texts
CURL=(curl -fsSL --retry 3 --retry-delay 2)

SHARP_LIBVIPS=$(node -p "require('./server/package-lock.json').packages['node_modules/@img/sharp-libvips-linux-x64'].version")
echo "sharp-libvips $SHARP_LIBVIPS"
props=$("${CURL[@]}" "https://raw.githubusercontent.com/lovell/sharp-libvips/v${SHARP_LIBVIPS}/versions.properties")
eval "$(printf '%s\n' "$props" | grep -E '^VERSION_[A-Z0-9_]+=[A-Za-z0-9._-]+$')"

mkdir -p "$OUT/libvips" "$OUT/common"
rm -f "$OUT"/libvips/*.txt

gh_raw() { echo "https://raw.githubusercontent.com/$1/$2/$3"; }
# name|URL[|URL…] – mehrere Dateien einer Bibliothek werden aneinandergehängt
LIBS=(
  "aom|https://aomedia.googlesource.com/aom/+/refs/tags/v${VERSION_AOM}/LICENSE?format=TEXT|https://aomedia.googlesource.com/aom/+/refs/tags/v${VERSION_AOM}/PATENTS?format=TEXT"
  "archive|$(gh_raw libarchive/libarchive "v${VERSION_ARCHIVE}" COPYING)"
  "cairo|https://gitlab.freedesktop.org/cairo/cairo/-/raw/${VERSION_CAIRO}/COPYING|https://gitlab.freedesktop.org/cairo/cairo/-/raw/${VERSION_CAIRO}/COPYING-MPL-1.1"
  "cgif|$(gh_raw dloebl/cgif "v${VERSION_CGIF}" LICENSE)"
  "exif|$(gh_raw libexif/libexif "v${VERSION_EXIF}" COPYING)"
  "expat|$(gh_raw libexpat/libexpat "R_${VERSION_EXPAT//./_}" expat/COPYING)"
  "ffi|$(gh_raw libffi/libffi "v${VERSION_FFI}" LICENSE)"
  "fontconfig|https://gitlab.freedesktop.org/fontconfig/fontconfig/-/raw/${VERSION_FONTCONFIG}/COPYING"
  "freetype|$(gh_raw freetype/freetype "VER-${VERSION_FREETYPE//./-}" LICENSE.TXT)|$(gh_raw freetype/freetype "VER-${VERSION_FREETYPE//./-}" docs/FTL.TXT)"
  "fribidi|$(gh_raw fribidi/fribidi "v${VERSION_FRIBIDI}" COPYING)"
  "glib|$(gh_raw GNOME/glib "${VERSION_GLIB}" LICENSES/LGPL-2.1-or-later.txt)"
  "harfbuzz|$(gh_raw harfbuzz/harfbuzz "${VERSION_HARFBUZZ}" COPYING)"
  "heif|$(gh_raw strukturag/libheif "v${VERSION_HEIF}" COPYING)"
  "highway|$(gh_raw google/highway "${VERSION_HIGHWAY}" LICENSE)"
  "imagequant|$(gh_raw lovell/libimagequant "v${VERSION_IMAGEQUANT}" COPYRIGHT)"
  "lcms|$(gh_raw mm2/Little-CMS "lcms${VERSION_LCMS}" LICENSE)"
  "mozjpeg|$(gh_raw mozilla/mozjpeg "${VERSION_MOZJPEG}" LICENSE.md)|$(gh_raw mozilla/mozjpeg "${VERSION_MOZJPEG}" README.ijg)"
  "pango|$(gh_raw GNOME/pango "${VERSION_PANGO}" COPYING)"
  "pixman|https://gitlab.freedesktop.org/pixman/pixman/-/raw/pixman-${VERSION_PIXMAN}/COPYING"
  "png|$(gh_raw pnggroup/libpng "v${VERSION_PNG}" LICENSE)"
  "rsvg|$(gh_raw GNOME/librsvg "${VERSION_RSVG}" COPYING.LIB)"
  "tiff|https://gitlab.com/libtiff/libtiff/-/raw/v${VERSION_TIFF}/LICENSE.md"
  "uhdr|$(gh_raw google/libultrahdr "v${VERSION_UHDR}" LICENSE)"
  "vips|$(gh_raw libvips/libvips "v${VERSION_VIPS}" LICENSE)"
  "webp|$(gh_raw webmproject/libwebp "v${VERSION_WEBP}" COPYING)|$(gh_raw webmproject/libwebp "v${VERSION_WEBP}" PATENTS)"
  "xml2|$(gh_raw GNOME/libxml2 "v${VERSION_XML2}" Copyright)"
  "zlib-ng|$(gh_raw zlib-ng/zlib-ng "${VERSION_ZLIB_NG}" LICENSE.md)"
)
for entry in "${LIBS[@]}"; do
  name=${entry%%|*}
  IFS='|' read -r -a urls <<<"${entry#*|}"
  file="$OUT/libvips/$name.txt"
  for u in "${urls[@]}"; do
    body=$("${CURL[@]}" "$u") || { echo "FEHLT: $name $u" >&2; exit 1; }
    # googlesource liefert ?format=TEXT base64-kodiert
    [[ $u == *format=TEXT ]] && body=$(printf '%s' "$body" | base64 -d)
    { [[ -s $file ]] && printf '\n\n'; printf '%s\n' "$body"; } >>"$file"
  done
  echo "ok  $name  (${urls[*]})"
done

# Standardtexte: zuerst das Original (gnu.org/mozilla.org), sonst die SPDX-Fassung (gleicher Text, SPDX-Formatierung)
SPDX=https://raw.githubusercontent.com/spdx/license-list-data/main/text
COMMON=(
  "GPL-2.0|https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt|$SPDX/GPL-2.0-only.txt"
  "GPL-3.0|https://www.gnu.org/licenses/gpl-3.0.txt|$SPDX/GPL-3.0-only.txt"
  "LGPL-2.1|https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt|$SPDX/LGPL-2.1-only.txt"
  "LGPL-3.0|https://www.gnu.org/licenses/lgpl-3.0.txt|$SPDX/LGPL-3.0-only.txt"
  "MPL-1.1|$SPDX/MPL-1.1.txt"
  "MPL-2.0|https://www.mozilla.org/media/MPL/2.0/index.txt|$SPDX/MPL-2.0.txt"
  "IPA|$SPDX/IPA.txt"
  "MIT|$SPDX/MIT.txt"
)
for entry in "${COMMON[@]}"; do
  id=${entry%%|*}
  IFS='|' read -r -a urls <<<"${entry#*|}"
  for u in "${urls[@]}"; do
    if "${CURL[@]}" --connect-timeout 15 -o "$OUT/common/$id.txt" "$u" 2>/dev/null; then
      echo "ok  common/$id  ($u)"
      continue 2
    fi
  done
  echo "FEHLT: common/$id" >&2
  exit 1
done
printf '%s\n' "$SHARP_LIBVIPS" >"$OUT/libvips/SHARP_LIBVIPS_VERSION"
