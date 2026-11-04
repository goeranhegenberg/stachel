#!/usr/bin/env bash
# Stachel ist ein unabhängiges Open-Source-Projekt: Der öffentliche Baum darf keine Bezüge auf ein bestimmtes
# Betreiber-Projekt enthalten (Name, Domain, App-ID, Demo-Veranstaltung). Prüft Dateiinhalte (Text) und Dateinamen,
# Groß-/Kleinschreibung egal, und gibt jeden Treffer als <datei>:<zeile>: <text> aus. Exit 1 bei Treffern.
#
#   tools/release/check-public-tree.sh [<baum>]      (Standard: Repo-Wurzel; CI: .github/workflows/ci.yml)
#
# Ist <baum> ein Git-Arbeitsbaum, zählen nur eingecheckte Dateien, und was docs/open_source/publish-exclude.txt
# ausschließt (interne Unterlagen, gehen nicht in den öffentlichen Export), wird übersprungen – geprüft wird also, was
# der Export nach docs/open_source/publish.md §2 enthielte. Ein exportierter Baum (ohne .git) wird vollständig geprüft.
#
# Die Suchbegriffe stehen zusammengesetzt im Skript, damit es sich nicht selbst findet.
set -uo pipefail
ROOT=${1:-$(cd "$(dirname "$0")/../.." && pwd)}
k="kak"
NAME="${k}tingo"                      # deckt auch <name>.com/.de und com.goeranhegenberg.<name> ab
EVENT="festival[ _-]?2027"
PATTERN="${NAME}|${EVENT}"

if [[ -e $ROOT/.git ]]; then
  excludes=()
  if [[ -f $ROOT/docs/open_source/publish-exclude.txt ]]; then
    while IFS= read -r line || [[ -n $line ]]; do
      line=${line%$'\r'}
      [[ -z $line || $line == \#* ]] && continue
      excludes+=("$line")
    done <"$ROOT/docs/open_source/publish-exclude.txt"
  fi
  files=()
  while IFS= read -r -d '' f; do
    skip=0
    for pat in "${excludes[@]+"${excludes[@]}"}"; do
      # shellcheck disable=SC2053  # Muster wie bei tar --anchored --exclude-from (Platzhalter, auch über „/“)
      if [[ $f == $pat || $f == $pat/* ]]; then skip=1; break; fi
    done
    ((skip)) || files+=("$f")
  done < <(git -C "$ROOT" ls-files -z)
  hits=$(cd "$ROOT" && printf '%s\0' "${files[@]+"${files[@]}"}" | xargs -0 -r grep -nIiE "$PATTERN" -- 2>/dev/null)
  names=$(printf '%s\n' "${files[@]+"${files[@]}"}" | grep -iE "(^|/)[^/]*${NAME}[^/]*(/|$)" || true)
else
  hits=$(grep -rnIiE "$PATTERN" "$ROOT" \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.dart_tool --exclude-dir=build --exclude-dir=dist \
    --exclude-dir=.collected 2>/dev/null | sed "s#^$ROOT/##")
  names=$(find "$ROOT" \( -name .git -o -name node_modules -o -name .dart_tool -o -name build -o -name dist \) -prune -o \
    -iname "*${NAME}*" -print 2>/dev/null | sed "s#^$ROOT/##")
fi

n_hits=$(printf '%s' "$hits" | grep -c . || true)
n_names=$(printf '%s' "$names" | grep -c . || true)
if ((n_hits + n_names == 0)); then
  echo "check-public-tree: keine Bezüge gefunden"
  exit 0
fi
[[ -n $hits ]] && printf '%s\n' "$hits"
[[ -n $names ]] && printf '%s\n' "$names" | sed 's/$/: (Dateiname)/'
echo "check-public-tree: $n_hits Zeilen und $n_names Dateinamen mit Bezug auf ein Betreiber-Projekt (${NAME}, Demo-Veranstaltung) – vor der Veröffentlichung entfernen" >&2
exit 1
