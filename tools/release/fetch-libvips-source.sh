#!/usr/bin/env bash
# Quellangebot für die LGPL-Bibliotheken im Image "stachel" (libvips und die von sharp-libvips gebündelten Bibliotheken,
# THIRD_PARTY_NOTICES Abschnitt 1): lädt genau die Upstream-Quellarchive und Patches, die das Build-Skript von
# lovell/sharp-libvips für die in server/package-lock.json verwendete Version herunterlädt (build/posix.sh am Tag
# v<version>, Versionen aus versions.properties), dazu das sharp-libvips-Repo selbst (Build-Skripte, Dockerfiles).
#
#   tools/release/fetch-libvips-source.sh [<ausgabe>]   → <ausgabe>/libvips-sources-<version>.tar + .sha256
#   tools/release/fetch-libvips-source.sh --check       → nur prüfen, dass jede URL erreichbar ist (kein Download)
#
# Die Release-CI (.github/workflows/release.yml) hängt das Archiv an jedes GitHub-Release v*.
set -euo pipefail
cd "$(dirname "$0")/../.."

CHECK=false
if [[ ${1:-} == --check ]]; then CHECK=true; shift; fi
OUT=${1:-dist}
CURL=(curl -fsSL --retry 3 --retry-delay 3 --connect-timeout 20)

lock() { node -p "(require('./server/package-lock.json').packages['node_modules/$1'] || {}).version"; }
VER=$(lock @img/sharp-libvips-linux-x64)
ARM=$(lock @img/sharp-libvips-linux-arm64)
[[ $VER == "$ARM" ]] || { echo "sharp-libvips: x64 $VER, arm64 $ARM – erwartet gleiche Version" >&2; exit 1; }
TAG=v$VER
RAW=https://raw.githubusercontent.com/lovell/sharp-libvips/$TAG
echo "sharp-libvips $TAG"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
"${CURL[@]}" -o "$WORK/versions.properties" "$RAW/versions.properties"
"${CURL[@]}" -o "$WORK/posix.sh" "$RAW/build/posix.sh"

# Versionen übernehmen (nur VERSION_X=wert, nichts anderes ausführen)
while IFS= read -r line; do
  [[ $line =~ ^(VERSION_[A-Z0-9_]+)=([A-Za-z0-9._-]+)$ ]] && printf -v "${BASH_REMATCH[1]}" '%s' "${BASH_REMATCH[2]}"
done <"$WORK/versions.properties"
# Hilfsfunktionen wie in build/posix.sh
without_patch() { echo "${1%.[[:digit:]]*}"; }
without_prerelease() { echo "${1%-[[:alnum:]]*}"; }

# Jede Download-Zeile des Build-Skripts: `$CURL https://… | tar …C ${DEPS}/<name>` bzw. `… | patch -p1` (Patch für den
# zuletzt geladenen Teil). Die URL wird nur ausgewertet, wenn sie außer ${VERSION_…}, ${VERSION_…//./x} und
# $(without_patch|without_prerelease $VERSION_…) nichts Ausführbares enthält.
SAFE='^https://[][A-Za-z0-9._~:/?#@!+,=%{}$() -]+$'
declare -a NAMES=() URLS=()
dep=sharp-libvips
while IFS= read -r line; do
  [[ $line =~ \$CURL[[:space:]]+(-O[[:space:]]+)?(https://.*)$ ]] || continue
  raw=${BASH_REMATCH[2]}
  raw=${raw%%|*}
  raw=${raw%"${raw##*[![:space:]]}"}
  [[ $raw =~ $SAFE ]] || { echo "unerwartete URL in posix.sh: $raw" >&2; exit 1; }
  rest=${raw//\$(without_patch \$VERSION_/}
  rest=${rest//\$(without_prerelease \$VERSION_/}
  [[ $rest != *'$('* && $rest != *' '* ]] || { echo "unerwartete Ersetzung in posix.sh: $raw" >&2; exit 1; }
  url=$(eval "printf '%s' \"$raw\"")
  base=${url##*/}
  if [[ $line =~ \$\{DEPS\}/([A-Za-z0-9_-]+) ]]; then
    dep=${BASH_REMATCH[1]}
    name="$dep-$base"
  elif [[ $line == *patch* ]]; then
    name="$dep-patch-$base"
  else
    # z. B. THIRD-PARTY-NOTICES.md vom Branch main → stattdessen die Fassung am Tag
    [[ $url == */sharp-libvips/main/* ]] && url=${url/\/main\//\/$TAG\/}
    name="sharp-libvips-$base"
  fi
  NAMES+=("$name")
  URLS+=("$url")
done <"$WORK/posix.sh"
NAMES+=("sharp-libvips-$TAG.tar.gz")
URLS+=("https://github.com/lovell/sharp-libvips/archive/refs/tags/$TAG.tar.gz")
echo "${#URLS[@]} Dateien (libvips ${VERSION_VIPS})"

if $CHECK; then
  bad=0
  for i in "${!URLS[@]}"; do
    # HEAD; manche Server (Gists, patch-diff) beantworten HEAD nicht sauber → dann 1 Byte per GET
    code=$(curl -sIL -o /dev/null -w '%{http_code}' --connect-timeout 20 "${URLS[$i]}" || true)
    [[ $code == 200 ]] || code=$(curl -sL -r 0-0 -o /dev/null -w '%{http_code}' --connect-timeout 20 "${URLS[$i]}" || true)
    printf '%s  %-52s %s\n' "$code" "${NAMES[$i]}" "${URLS[$i]}"
    [[ $code == 200 || $code == 206 ]] || bad=$((bad + 1))
  done
  ((bad == 0)) || { echo "$bad URL(s) nicht erreichbar" >&2; exit 1; }
  exit 0
fi

DIR="$OUT/libvips-sources-$VER"
rm -rf "$DIR" && mkdir -p "$DIR"
{
  echo "Source code of libvips ${VERSION_VIPS} and the libraries bundled in @img/sharp-libvips-linux-x64 / -linux-arm64 $VER"
  echo "(used by sharp in the Docker image ghcr.io/goeranhegenberg/stachel). Downloaded by tools/release/fetch-libvips-source.sh"
  echo "from the URLs in build/posix.sh of https://github.com/lovell/sharp-libvips/tree/$TAG; the build itself is described there"
  echo "(build.sh, platforms/linux-*/Dockerfile). The *-patch-* files are applied by posix.sh to the preceding source."
  echo "proxy-libintl is only built for musl/macOS and is not part of the glibc libraries in the image."
  echo "librsvg fetches its Rust dependencies from crates.io as pinned in its Cargo.lock."
  echo
  printf '%-56s %s\n' FILE URL
} >"$DIR/SOURCES.txt"
for i in "${!URLS[@]}"; do
  "${CURL[@]}" -o "$DIR/${NAMES[$i]}" "${URLS[$i]}"
  printf '%-56s %s\n' "${NAMES[$i]}" "${URLS[$i]}" >>"$DIR/SOURCES.txt"
  echo "ok  ${NAMES[$i]}"
done
(cd "$DIR" && sha256sum -- * >SHA256SUMS)
(cd "$OUT" && tar -cf "libvips-sources-$VER.tar" "libvips-sources-$VER" && sha256sum "libvips-sources-$VER.tar" >"libvips-sources-$VER.sha256")
rm -rf "$DIR"
ls -l "$OUT"/libvips-sources-"$VER".*
