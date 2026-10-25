# Git archaeology cookbook

All commands are read-only. Replace `<path>`, `<sym>`, `<hash>`. The container may lack `rg` and `gh`; use `git grep` and plain `git`.

## Contents
1. Origin and evolution of a file
2. When did a symbol/string appear, change, vanish
3. Who owns the current lines, and why
4. Deleted and abandoned code
5. Commit message, body and diff reading
6. PR / issue / changelog trails
7. Finding the commit that changed behaviour
8. Checking that code is live
9. Pitfalls

## 1. Origin and evolution of a file
```bash
git log --follow --diff-filter=A --format='%h %ad %an | %s' --date=short -- <path> | tail -1   # first commit
git log --follow --name-status --format='%h %ad %s' --date=short -- <path> | grep -E '^R|^[0-9a-f]{8} '   # renames
git log --follow --numstat --format='C %h %s' -- <path>     # size of each change (design moments = big diffs)
git log --follow --format='%h %ad %s' --date=short -- <path>   # full timeline
```
`--follow` works for one file at a time. For a directory, use plain `git log -- <dir>`.

## 2. Symbol / string lifecycle (pickaxe)
```bash
git log -S'<sym>' --reverse --format='%h %ad %s' --date=short            # commits that change the COUNT of occurrences
git log -G'<regex>' --format='%h %ad %s' --date=short -- <path>          # commits whose diff matches a regex (catches edits, not just add/remove)
git log -S'<sym>' --diff-filter=D --name-only --format='%h %s'           # where it was deleted
git log -L:'<function_or_regex>':<path>                                 # full history of one function
git log -i -F --grep='<sym>' --format='%h %ad %s' --date=short           # commits that MENTION it in the message
```
`-S` finds when a string was added or removed; use `-G` when the line was modified in place (e.g. a constant's value or a flag's condition flipped).

## 3. Blame, ignoring noise
```bash
git blame -w -C -C -L <start>,<end> -- <path>     # -w ignore whitespace, -C -C follow code moved across files
git blame -w -C -C --line-porcelain -- <path> | grep -E '^[0-9a-f]{40} ' | cut -d' ' -f1 | sort | uniq -c | sort -rn | head
```
Blame shows who last touched a line, not who decided. Jump to the *previous* meaningful version with `git blame <hash>^ -- <path>` and repeat until you reach the introduction.
Large mechanical commits (formatting, renames, moves) pollute blame; note them and skip past.

## 4. Deleted and abandoned code
```bash
git log --diff-filter=D --name-only --format='%h %ad %s' --date=short -- <dir>   # files removed
git show <hash>^:<path>                                                         # file as it was before removal
git log --stat --format='%h %s' -- <dir> | awk '/deletion/ && $0 ~ /[0-9]{3,} deletions/'   # large removals
git log -i -E --grep='revert|rollback|retire|remove|drop|replace|supersede' --format='%h %ad %s' --date=short -- <dir>
```
What was removed and *why it was removed* is the best evidence for "alternatives considered". Also grep `docs/legacy-retirement-checklist.md`-style files for retirement rationale.

## 5. Reading a commit properly
```bash
git show -s --format='%h %ad %an%n%s%n%n%b' --date=short <hash>   # message + body only
git show --stat <hash>                                            # which files, how much
git show <hash> -- <path>                                         # the actual diff for one file
git show <hash> --format= -- '*test*'                             # did tests change with the code? how?
```
Checks: Does the body explain *why* or just *what*? Did the same commit edit a test to match new behaviour? Is the subject larger than the diff (agent overclaim)? Is it a squash of many unrelated changes?

## 6. PR, issue and changelog trails
```bash
git log --format='%h %s%n%b' | grep -o '#[0-9]\{2,6\}' | sort | uniq -c | sort -rn | head    # most-referenced PRs
git log -i --grep='#<num>' --format='%h %ad %s' --date=short
grep -n '#<num>' CHANGELOG.md docs -r
git grep -n 'CLY-BUG-0[0-9]*' -- CHANGELOG.md docs
```
Without `gh` or network you cannot read PR discussion; say that, and rely on commit bodies, CHANGELOG paragraphs and docs. If network is available, the PR page is `https://github.com/AIEraDev/Clypra/pull/<num>`.

## 7. Finding when behaviour changed
```bash
git bisect start <bad> <good>        # then: git bisect run <test-command>
git log --since='2026-09-01' --until='2026-09-30' --format='%h %ad %s' --date=short -- <dir>
git diff <tagA>..<tagB> --stat -- <dir>
git tag --sort=-creatordate | head   # release boundaries for "what changed between versions"
```
Only bisect when you have a deterministic test. Never check out or reset the user's working tree; use `git worktree add ../clypra-bisect <hash>` for historical builds, then remove the worktree.

## 8. Is it live?
```bash
git grep -n -F '<fn_or_type>' -- 'src/*' 'src-tauri/src/*' 'crates/*'     # all references
git grep -n 'invoke_handler\|generate_handler' src-tauri/src/lib.rs        # are Tauri commands registered?
git grep -n 'cfg(\(feature\|target_os\|debug_assertions\)' -- <path>       # conditional compilation
git grep -n 'import.meta.env.VITE_' -- src                                 # build-time flags
git grep -n '<sym>' -- '*test*'                                            # only referenced by tests = likely dead in prod
```
Then read the call site and confirm its guard conditions evaluate true under default config.

## 9. Pitfalls
- A shallow clone silently truncates every command above. Check `git rev-parse --is-shallow-repository`.
- `git log -S` is slow on huge repos; narrow with a path.
- Rename detection is heuristic; a rewritten file may show as delete + add. Search by symbol as well as by path.
- Squash merges hide intermediate reasoning; the PR description may hold what the commit doesn't.
- Commit dates are author dates and can be rewritten by rebases; order by topology when it matters (`--topo-order`).
- Author names include bots and agents; do not attribute a design decision to a person without a source saying so.
