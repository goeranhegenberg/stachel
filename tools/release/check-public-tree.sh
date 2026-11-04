#!/usr/bin/env bash
# Prüft den öffentlichen Baum auf zwei Arten von Bezügen und gibt jeden Treffer als <datei>:<zeile>: <text> aus
# (Dateiinhalte als Text und Dateinamen, Groß-/Kleinschreibung egal). Exit 1 bei Treffern.
#
# 1. Betreiber-Projekt: Stachel ist ein unabhängiges Open-Source-Projekt; der Baum darf keine Bezüge auf ein bestimmtes
#    Betreiber-Projekt enthalten (Name, Domain, App-ID, Demo-Veranstaltung).
# 2. Vergleich mit einem fremden Whiteboard-Produkt (eingetragene Marke, docs/legal/marke.md §2, intern): Der Name darf
#    beschreibend vorkommen – als Herkunft der Daten beim Import (Code unter server/src/import/, web/src/features/import/,
#    stachel_import*, MCP-Werkzeug, docs/features/import.md, Selbsthoster-Doku, Fixtures). Verboten sind Vergleiche,
#    Nachbau-/Alternative-/Ersatz-Formulierungen und Dateinamen mit Vergleich (§ 6 UWG, § 23 MarkenG). Schwache Formen
#    („wie <Marke>“, „<Marke>-Stil“) sind in den Import-Pfaden erlaubt, weil sie dort die Daten beschreiben
#    („Lage wie in der Quelle“); starke Formen (statt, Alternative, Nachbau, besser als …) gelten überall.
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

m="mi"
M="${m}ro"                            # die fremde Marke
END='([^a-zäöüß]|$)'
# starke Formen: überall verboten
CMP_STRONG="${M}[ _-]?(alternative|nachbau|klon|clone|vergleich|ersatz|replacement|killer|artig[a-z]*|ähnlich[a-z]*|aehnlich[a-z]*|kürzel|kuerzel|look-?alike)${END}"
CMP_STRONG+="|(statt|anstatt|anstelle von|instead of|besser als|better than|alternative (zu|to)|ersatz für|ersatz fuer|replacement for|wechsle von|wechsel von|umstieg von|umsteigen von|switch(ing)? from|migrate from|nachbau von|klon von|clone of|vergleich mit|verglichen mit|compared to|comparison with|vs\.?|versus) ${M}${END}"
# schwache Formen: außerhalb der Import-Pfade verboten
CMP_WEAK="${M}[ _-]?(like|style|stil|maß|mass|verhalten|behaviou?r|optik|look|shortcuts?)${END}"
CMP_WEAK+="|(wie|like|as in|similar to|so wie|à la|a la)( in| bei| auf)? ${M}${END}"
# Import-Pfade (beschreibende Nennung erlaubt)
IMPORT_PATHS="(^|/)[^/]*import[^/]*(/|$)|(^|/)tools/${M}-fake|(^|/)fixtures?/|(^|/)[^/]*${M}[^/]*/"
# Dateinamen mit Vergleich
CMP_NAMES="${M}[_-]?(vergleich|nachbau|alternative|clone|klon|compare|comparison|parity|paritaet|vs)|(vergleich|nachbau|compare|comparison|parity|paritaet|feat[0-9]*)[_-]?${M}"

files=()
if [[ -e $ROOT/.git ]]; then
  excludes=()
  if [[ -f $ROOT/docs/open_source/publish-exclude.txt ]]; then
    while IFS= read -r line || [[ -n $line ]]; do
      line=${line%$'\r'}
      [[ -z $line || $line == \#* ]] && continue
      excludes+=("$line")
    done <"$ROOT/docs/open_source/publish-exclude.txt"
  fi
  while IFS= read -r -d '' f; do
    skip=0
    for pat in "${excludes[@]+"${excludes[@]}"}"; do
      # shellcheck disable=SC2053  # Muster wie bei tar --anchored --exclude-from (Platzhalter, auch über „/“)
      if [[ $f == $pat || $f == $pat/* ]]; then skip=1; break; fi
    done
    ((skip)) || files+=("$f")
  done < <(git -C "$ROOT" ls-files -z)
else
  while IFS= read -r -d '' f; do files+=("${f#./}"); done < <(cd "$ROOT" && find . \( -name .git -o -name node_modules -o \
    -name .dart_tool -o -name build -o -name dist -o -name .collected \) -prune -o -type f -print0 2>/dev/null)
fi

# grep über eine Dateiliste (Pfade relativ zu ROOT)
scan() { # <muster> <dateien…>
  local pat=$1; shift
  (($#)) || return 0
  (cd "$ROOT" && printf '%s\0' "$@" | xargs -0 -r grep -nIiE "$pat" -- 2>/dev/null)
}

hits=$(scan "$PATTERN" "${files[@]+"${files[@]}"}")
names=$(printf '%s\n' "${files[@]+"${files[@]}"}" | grep -iE "(^|/)[^/]*${NAME}[^/]*(/|$)" || true)

outside=()
for f in "${files[@]+"${files[@]}"}"; do
  [[ ${f,,} =~ $IMPORT_PATHS ]] || outside+=("$f")
done
cmp=$( { scan "$CMP_STRONG" "${files[@]+"${files[@]}"}"; scan "$CMP_WEAK" "${outside[@]+"${outside[@]}"}"; } | sort -u)
cmp_names=$(printf '%s\n' "${files[@]+"${files[@]}"}" | grep -iE "(^|/)[^/]*(${CMP_NAMES})[^/]*(/|$)" || true)

count() { printf '%s' "$1" | grep -c . || true; }
n_hits=$(count "$hits"); n_names=$(count "$names"); n_cmp=$(count "$cmp"); n_cmp_names=$(count "$cmp_names")
if ((n_hits + n_names + n_cmp + n_cmp_names == 0)); then
  echo "check-public-tree: keine Bezüge gefunden"
  exit 0
fi
[[ -n $hits ]] && printf '%s\n' "$hits"
[[ -n $names ]] && printf '%s\n' "$names" | sed 's/$/: (Dateiname)/'
((n_hits + n_names)) && echo "check-public-tree: $n_hits Zeilen und $n_names Dateinamen mit Bezug auf ein Betreiber-Projekt (${NAME}, Demo-Veranstaltung) – vor der Veröffentlichung entfernen" >&2
[[ -n $cmp ]] && printf '%s\n' "$cmp"
[[ -n $cmp_names ]] && printf '%s\n' "$cmp_names" | sed 's/$/: (Dateiname)/'
((n_cmp + n_cmp_names)) && echo "check-public-tree: $n_cmp Zeilen und $n_cmp_names Dateinamen vergleichen Stachel mit ${M^} (erlaubt ist nur die Herkunftsangabe „Import aus ${M^}“) – neutral formulieren bzw. Datei in docs/open_source/publish-exclude.txt" >&2
exit 1
