#!/usr/bin/env bash
# Holt aus den gebauten Images, was THIRD_PARTY_NOTICES beschreibt – genau das, was ausgeliefert wird:
#   <out>/server/   package.json + Lizenzdateien aus /app/server/node_modules (Image stachel)
#   <out>/mcp/      dasselbe aus /app/node_modules (Image stachel-mcp)
#   <out>/web-licenses.txt   /app/web/dist/licenses.txt (vom Vite-Plugin aus dem echten Bündel erzeugt)
#   <out>/facts.json         Node.js-, Debian-, Chromium-Version und Pfade der Lizenzdateien in den Images
# Aufruf: tools/licenses/collect-images.sh <stachel-image> <stachel-mcp-image> [<out>]
# Docker darf entfernt laufen (DOCKER_HOST=ssh://user@host). Danach: node tools/licenses/third-party-notices.mjs
set -euo pipefail
export MSYS_NO_PATHCONV=1  # Git Bash unter Windows: /app/… nicht in Windows-Pfade umschreiben
IMG=${1:?Image stachel fehlt}
MCP=${2:?Image stachel-mcp fehlt}
OUT=${3:-tools/licenses/.collected}
rm -rf "$OUT" && mkdir -p "$OUT/server" "$OUT/mcp"

# nur package.json und Lizenz-/Hinweisdateien (klein), ohne Testordner
pick='find . \( -name package.json -o -iname "licen[cs]e*" -o -iname "copying*" -o -iname "notice*" -o -iname "thirdpartynotices*" -o -name versions.json \) -type f -not -path "*/test/*" | tar -cf - -T -'
docker run --rm --entrypoint sh "$IMG" -c "cd /app/server/node_modules && $pick" | tar -xf - -C "$OUT/server"
docker run --rm --entrypoint sh "$MCP" -c "cd /app/node_modules && $pick" | tar -xf - -C "$OUT/mcp"
docker run --rm --entrypoint cat "$IMG" /app/web/dist/licenses.txt >"$OUT/web-licenses.txt"

# Fakten: Node.js, Debian, Chromium-Ordner (Playwright legt ihn je Architektur anders an)
facts() {
  docker run --rm --entrypoint sh "$1" -c '
    printf "{\"node\":\"%s\",\"debian\":\"%s\",\"debianPackages\":%s,\"nodeLicense\":\"%s\"" \
      "$(node -p process.version)" "$(cat /etc/debian_version)" "$(dpkg-query -W | wc -l)" \
      "$(test -f /usr/local/LICENSE && echo /usr/local/LICENSE)"
    if [ -d /ms-playwright ]; then
      lic=$(find /ms-playwright -name "LICENSE*" -type f | head -1)
      printf ",\"chromiumLicense\":\"%s\",\"chromiumAbout\":\"%s\",\"chromiumLicenseBytes\":%s" \
        "$lic" "$(dirname "$lic")/ABOUT" "$(wc -c <"$lic")"
      printf ",\"playwrightBrowsers\":%s" "$(cat /app/node_modules/playwright-core/browsers.json | tr -d "\n")"
      printf ",\"ffmpegRemoved\":%s" "$(ls -d /ms-playwright/ffmpeg* >/dev/null 2>&1 && echo false || echo true)"
    fi
    printf "}"'
}
printf '{"stachel":%s,"mcp":%s}\n' "$(facts "$IMG")" "$(facts "$MCP")" >"$OUT/facts.json"
echo "gesammelt in $OUT: $(find "$OUT/server" -name package.json | wc -l) + $(find "$OUT/mcp" -name package.json | wc -l) package.json"
