#!/usr/bin/env bash
# history_dossier.sh — one-shot "how did this come to be?" report for a file, directory or symbol.
#
# Usage:
#   history_dossier.sh <repo_path> <target> [--limit N]
#
#   <target> is one of:
#     - a file path        (relative to repo root)  -> follows renames, blame hot-spots, intent comments
#     - a directory path                            -> commit timeline, churn by month, top files
#     - anything else      (symbol / string / const)-> pickaxe: when it was introduced, changed, removed
#
# Read-only. Works with plain git + grep (no ripgrep / gh required).
# Output is plain text meant to be skimmed by Claude, then followed up with `git show <hash>`.

set -u

REPO="${1:-}"
TARGET="${2:-}"
LIMIT=15
if [ "${3:-}" = "--limit" ] && [ -n "${4:-}" ]; then LIMIT="$4"; fi

if [ -z "$REPO" ] || [ -z "$TARGET" ]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
if ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: $REPO is not a git repository" >&2; exit 2
fi
cd "$REPO" || exit 2

hr() { printf '\n== %s ==\n' "$1"; }
fmt='%h %ad %an | %s'
dfmt='--date=short'

if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  echo "WARNING: shallow clone — history is truncated. Run: git fetch --unshallow"
fi

hr "SNAPSHOT"
echo "repo:   $(pwd)"
echo "HEAD:   $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)  ($(git log -1 --format=%ad $dfmt))"
echo "target: $TARGET"

# PR / issue references pulled out of commit messages for a given log selection.
pr_refs() { # args: git log selection args
  git log "$@" --format='%h %s%n%b' 2>/dev/null \
    | grep -o '#[0-9]\{1,6\}' | sort | uniq -c | sort -rn | head -15 \
    | awk '{printf "  %s (x%s)\n", $2, $1}'
}

# Intent markers: comments that tend to explain WHY.
intent_markers() { # args: file(s)
  grep -nE 'INVARIANT|invariant|NOTE:|WHY|Why:|HACK|FIXME|TODO|XXX|DO NOT|do not |must not|never |deliberate|intentional|workaround|because|rationale|ADR|Bug [0-9]+|#[0-9]{2,6}' "$@" 2>/dev/null | head -40
}

if [ -f "$TARGET" ]; then
  hr "KIND: file"
  echo "commits touching it (following renames): $(git log --follow --oneline -- "$TARGET" | wc -l | tr -d ' ')"

  hr "ORIGIN (first commit, follows renames)"
  git log --follow --diff-filter=A $dfmt --format="$fmt" -- "$TARGET" | tail -1
  echo "--- rename / move trail:"
  git log --follow --name-status --format='%h %ad %s' $dfmt -- "$TARGET" \
    | grep -E '^R[0-9]+' | head -10 || true

  hr "LATEST $LIMIT COMMITS"
  git log --follow -n "$LIMIT" $dfmt --format="$fmt" -- "$TARGET"

  hr "BIGGEST CHANGES (by lines touched) — likely design moments"
  git log --follow --numstat --format='C %h %ad %s' $dfmt -- "$TARGET" \
    | awk '/^C /{h=$0; next} NF==3 && $1 ~ /^[0-9]+$/ {print $1+$2"\t"h}' \
    | sort -rn | head -8 | cut -c1-160

  hr "BLAME HOT-SPOTS (who/which commit owns the current lines; -w -C -C ignores moves)"
  git blame -w -C -C --line-porcelain -- "$TARGET" 2>/dev/null \
    | grep -E '^[0-9a-f]{40} ' | cut -d' ' -f1 | sort | uniq -c | sort -rn | head -8 \
    | while read -r n h; do
        printf '%5s lines  %s\n' "$n" "$(git log -1 --format="%h %ad %s" $dfmt "$h" | cut -c1-140)"
      done

  hr "PR / ISSUE REFS in this file's history"
  pr_refs --follow -- "$TARGET"

  hr "INTENT MARKERS in current file (comments that may explain why)"
  intent_markers "$TARGET"

  hr "REVERTS / FIXES touching it (churn signals a decision was wrong or fragile)"
  git log --follow -i -E --grep='revert|regress|hotfix|fix' --format="$fmt" $dfmt -n "$LIMIT" -- "$TARGET"

elif [ -d "$TARGET" ]; then
  hr "KIND: directory"
  echo "commits touching it: $(git log --oneline -- "$TARGET" | wc -l | tr -d ' ')"
  echo "files tracked:       $(git ls-files -- "$TARGET" | wc -l | tr -d ' ')"

  hr "ORIGIN (first commit)"
  git log --diff-filter=A $dfmt --format="$fmt" -- "$TARGET" | tail -1

  hr "LATEST $LIMIT COMMITS"
  git log -n "$LIMIT" $dfmt --format="$fmt" -- "$TARGET"

  hr "ACTIVITY BY MONTH"
  git log --format='%ad' --date=format:%Y-%m -- "$TARGET" | sort | uniq -c | tail -14 \
    | awk '{printf "  %s  %s\n", $2, $1}'

  hr "MOST-CHURNED FILES (candidates to read first)"
  git log --name-only --format= -- "$TARGET" | grep -v '^$' | sort | uniq -c | sort -rn | head -10

  hr "FILES DELETED HERE (abandoned designs)"
  git log --diff-filter=D --name-only --format='%h %ad %s' $dfmt -- "$TARGET" | head -30

  hr "PR / ISSUE REFS"
  pr_refs -- "$TARGET"

else
  hr "KIND: symbol / string (pickaxe)"
  echo "occurrences in HEAD:"
  git grep -n -F -- "$TARGET" 2>/dev/null | head -15
  echo "(total matching files: $(git grep -l -F -- "$TARGET" 2>/dev/null | wc -l | tr -d ' '))"

  hr "COMMITS THAT ADDED/REMOVED THE STRING (git log -S), oldest first"
  git log -S"$TARGET" --reverse $dfmt --format="$fmt" | head -"$LIMIT"
  echo "--- newest:"
  git log -S"$TARGET" $dfmt --format="$fmt" | head -5

  hr "COMMITS WHOSE MESSAGE MENTIONS IT"
  git log -i -F --grep="$TARGET" $dfmt --format="$fmt" | head -"$LIMIT"

  hr "WHERE IT WAS DELETED (files that no longer contain it)"
  git log -S"$TARGET" --diff-filter=D --name-only --format='%h %ad %s' $dfmt | head -15

  hr "PR / ISSUE REFS near this symbol"
  pr_refs -S"$TARGET"
fi

hr "NEXT STEPS (do these, the dossier is only a map)"
cat <<'EOF'
  1. git show --stat <hash>          for each origin / biggest-change / hot-spot commit
  2. read the commit BODY and the diff, not just the subject (agent-written subjects can overclaim)
  3. grep docs/ CHANGELOG.md AGENTS.md .agents/rules for the PR numbers and symbol names above
  4. confirm the code is still live: callers, cfg/feature flags, registration (lib.rs invoke_handler)
EOF
