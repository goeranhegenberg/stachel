#!/usr/bin/env bash
# Exports the current commit of this repository into a clone of the public repository and records it there as ONE new
# commit on top of its history (no force push). Steps and background: docs/open_source/publish.md ("Weitere Versionen").
#
#   tools/release/export-public.sh <public-clone> [-m <message>] [--tag vX.Y.Z] [--push]
#
#   <public-clone>  a clone of the public repository (created if missing: --remote <url>, default
#                   git@github.com:goeranhegenberg/stachel.git); must not lie inside this repository
#   -m <message>    first line of the commit message (default: "Stachel <tag> – sync" or "Sync")
#   -b <body>       commit message body (the internal state is appended)
#   --tag vX.Y.Z    also creates the annotated tag (after the commit)
#   --push          pushes main (and the tag) to origin – only after all checks passed
#   --no-export-check  skips the internal docs/open_source/check-export.sh (gitleaks/trufflehog not available)
#
# Checks (abort on any finding): the clone's main equals origin/main, the source tree is clean, the exclusion list
# (docs/open_source/publish-exclude.txt) is applied, tools/release/check-public-tree.sh reports nothing, and – if
# present – the internal docs/open_source/check-export.sh passes. File modes (executable bit) are taken from the
# source index, line endings stay LF (core.autocrlf=false), author/committer and the DCO sign-off use GIT_EXPORT_NAME /
# GIT_EXPORT_EMAIL (default: Göran Hegenberg <goeran@intsode.com>, like the public history).
set -eEuo pipefail

REPO=$(cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" && pwd)
OUT=""
MSG=""
BODY=""
TAG=""
PUSH=0
EXPORT_CHECK=1
REMOTE="git@github.com:goeranhegenberg/stachel.git"
while [ $# -gt 0 ]; do
  case "$1" in
    -m) MSG=${2:?-m needs a message}; shift 2 ;;
    -b) BODY=${2:?-b needs a text}; shift 2 ;;
    --tag) TAG=${2:?--tag needs vX.Y.Z}; shift 2 ;;
    --push) PUSH=1; shift ;;
    --no-export-check) EXPORT_CHECK=0; shift ;;
    --remote) REMOTE=${2:?--remote needs a URL}; shift 2 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) OUT=$1; shift ;;
  esac
done
[ -n "$OUT" ] || { echo "usage: $0 <public-clone> [-m <message>] [--tag vX.Y.Z] [--push]" >&2; exit 2; }
case "$TAG" in ''|v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "tag must look like vX.Y.Z: $TAG" >&2; exit 2 ;; esac

NAME=${GIT_EXPORT_NAME:-Göran Hegenberg}
EMAIL=${GIT_EXPORT_EMAIL:-goeran@intsode.com}
REV=$(git -C "$REPO" rev-parse --short HEAD)
step() { printf '\n== %s\n' "$*"; }

step "Source $REPO at $REV"
if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; then
  echo "source tree has uncommitted changes – commit first (only committed files are exported)" >&2
  exit 1
fi

step "Public clone $OUT"
OUT_ABS=$(mkdir -p "$OUT" && cd "$OUT" && pwd)
case "$OUT_ABS/" in "$REPO"/*) echo "the public clone must not lie inside the repository" >&2; exit 1 ;; esac
if [ ! -d "$OUT_ABS/.git" ]; then
  [ -z "$(ls -A "$OUT_ABS")" ] || { echo "$OUT_ABS exists, is not empty and not a git clone" >&2; exit 1; }
  git clone "$REMOTE" "$OUT_ABS"
fi
g() { git -C "$OUT_ABS" "$@"; }
g config core.autocrlf false
g config core.filemode false
g fetch -q origin
g checkout -q main
g merge -q --ff-only origin/main || { echo "main of the public clone has diverged from origin/main – resolve by hand" >&2; exit 1; }
[ -z "$(g status --porcelain)" ] || { echo "public clone has local changes – resolve by hand" >&2; exit 1; }
if [ -n "$TAG" ] && { g rev-parse -q --verify "refs/tags/$TAG" >/dev/null || g ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; }; then
  echo "tag $TAG exists already" >&2
  exit 1
fi

step "Export (git archive, without docs/open_source/publish-exclude.txt)"
# on any failure before the commit: back to the clone's HEAD, so the next run starts clean
cleanup() { g restore -q --source=HEAD --staged --worktree -- . 2>/dev/null; g clean -fdq; }
trap 'echo "aborted – public clone reset to its HEAD" >&2; cleanup' ERR
find "$OUT_ABS" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$REPO" -c core.autocrlf=false archive --format=tar HEAD |
  tar -x -C "$OUT_ABS" --anchored --exclude-from="$REPO/docs/open_source/publish-exclude.txt"
if grep -q $'\r' "$OUT_ABS/tools/release/check-public-tree.sh"; then
  echo "CRLF in the export (core.autocrlf?)" >&2
  exit 1
fi

step "Check: no operator references (tools/release/check-public-tree.sh)"
bash "$REPO/tools/release/check-public-tree.sh" "$OUT_ABS"
if [ "$EXPORT_CHECK" = 1 ] && [ -f "$REPO/docs/open_source/check-export.sh" ]; then
  step "Check: internal export checks (docs/open_source/check-export.sh)"
  bash "$REPO/docs/open_source/check-export.sh" "$OUT_ABS"
fi

step "Stage (file modes from the source index)"
g add -A
# executable bit exactly as in the source (Windows checkouts lose it; CI then fails with "Permission denied")
declare -A MODE=()
while read -r mode _ _ path; do MODE[$path]=$mode; done < <(git -C "$REPO" ls-files -s)
while read -r mode _ _ path; do
  want=${MODE[$path]:-}
  [ -n "$want" ] && [ "$want" != "$mode" ] || continue
  case "$want" in 100755) g update-index --chmod=+x -- "$path" ;; 100644) g update-index --chmod=-x -- "$path" ;; esac
done < <(g ls-files -s)
if g diff --cached --quiet; then
  echo "nothing changed since the last export"
  exit 0
fi
g diff --cached --stat | tail -1

trap - ERR
step "Commit"
[ -n "$MSG" ] || MSG=${TAG:+"Stachel ${TAG#v} – sync"}
[ -n "$MSG" ] || MSG="Sync"
args=(-m "$MSG")
[ -z "$BODY" ] || args+=(-m "$BODY")
args+=(-m "Exported from the internal repository (state $REV).")
g -c user.name="$NAME" -c user.email="$EMAIL" commit -q -s "${args[@]}"
g log --format='%h %an <%ae> | %s' -1
if [ -n "$TAG" ]; then
  g -c user.name="$NAME" -c user.email="$EMAIL" tag -a "$TAG" -m "Stachel ${TAG#v}"
  echo "tag $TAG"
fi

if [ "$PUSH" = 1 ]; then
  step "Push"
  g push origin main
  [ -z "$TAG" ] || g push origin "$TAG"
else
  echo
  echo "not pushed – check, then: git -C \"$OUT_ABS\" push origin main${TAG:+ && git -C \"$OUT_ABS\" push origin $TAG}"
fi
