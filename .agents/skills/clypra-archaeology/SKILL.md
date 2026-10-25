---
name: clypra-archaeology
description: Investigate HOW a part of Clypra (the open-source Tauri v2 + Rust + React video editor, github.com/AIEraDev/Clypra and sibling repos clypra-api, clypra-studio, clypra-packages) is implemented and WHY each design decision was made, by tracing code, git history, PRs, CHANGELOG, ADRs/docs, tests and benchmark evidence into an evidence-backed report. Use this whenever the user asks how something works in Clypra, why it was built that way, what the history or reasoning behind it is, whether something was deliberate or a bug, whether code is live or dead, what changed between versions, or wants a subsystem explained before changing it. Covers preview/native presenter, decode, audio, export/FFmpeg, timeline/filmstrip, text effects/templates, body effects, telemetry/benchmarks, API/Studio, i18n. Also use to fact-check an AI agent's claim about Clypra code ("✅ complete" vs real behaviour), even if the user never says "investigate" or "archaeology".
---

# Clypra Archaeology

Answer two questions about any part of Clypra, and keep them separate:

- **HOW** — the mechanism as it exists today: entry points, data flow, state ownership, boundaries, failure paths.
- **WHY** — the decisions behind that mechanism: the problem, the alternatives, the constraint that made this option win, and what it cost.

Code can only prove *what*. The *why* lives in history, docs, tests and measurements, and where none of those record it, the honest answer is "not recorded". That is the hard rule of this skill: **never manufacture a rationale.** A plausible-sounding but invented reason is worse than a gap, because the user will build on it (their workflow is Claude as architect, coding agents as implementers; agents regularly produce confident stories that the code contradicts).

## Ground rules (and why)

1. **Cite everything.** Each claim carries `path:line`, a commit hash, a PR/issue number, a doc section, or a measurement. Uncited claims are guesses, so label them as such.
2. **Use four confidence labels** on every decision and non-obvious claim:
   - **Confirmed** — stated in a primary source (commit body, ADR, PR text, code comment by the author) *and* consistent with the code.
   - **Supported** — strong circumstantial evidence from several independent sources (diff + test + changelog).
   - **Inferred** — your reconstruction; say what it rests on.
   - **Unknown** — no evidence found; say where you looked and who or what would settle it.
3. **Separate three timelines**: what the code does *now*, what it did *before*, and what the docs or agents *claim* it does. These drift apart constantly in a repo that moves this fast (v0.1.0-alpha in May 2026 to v1.6.x by October, thousands of commits). When they disagree, that disagreement is usually the most valuable finding.
4. **Treat every remembered fact as a hypothesis.** Notes, earlier chats and `references/clypra-map.md` are snapshots. Re-verify against the checkout before repeating them. Example of why: an earlier note said `EMBEDDED_PREVIEW_ONLY` was hardcoded `true`; the repo's own docs show it was later flipped to default `false`.
5. **Prove "live" before saying "live".** Code existing is not code running. Check callers, `cfg`/feature flags, env flags, and registration (for Tauri commands: `invoke_handler` in `src-tauri/src/lib.rs`). Dead, partially wired and flag-gated code is common here.
6. **Read-only by default.** Investigate without editing, formatting or committing, unless the user asks for a change. Always record the commit you investigated.
7. **Agent-written history needs skepticism.** Commit subjects and "Phase complete" summaries written by coding agents overclaim. Read the diff and the tests; a test edited in the same commit to make it pass is a red flag, not evidence.
8. **Dev builds, single sessions and one-off outliers are weak evidence** for performance or behaviour claims. Prefer release builds, paired/interleaved comparisons, and n > 1.

## Workflow

### 0. Frame the question
Restate in one line: subsystem, whether the user wants HOW, WHY or both, and depth (quick answer vs full report). If the scope is ambiguous, pick the most likely reading, state it, and proceed; ask at most one clarifying question, and only if two readings would send you down very different paths.

### 1. Get the code
- Look for an existing checkout first (current directory, `git rev-parse --show-toplevel`). Use it as-is and note `git rev-parse --short HEAD` plus branch and dirty state.
- If none exists and network is available: `git clone https://github.com/AIEraDev/Clypra.git` (full clone, not `--depth 1`: history *is* the evidence). If a clone is shallow, `git fetch --unshallow`.
- Sibling repos matter when a decision crosses a boundary (catalog API, Studio authoring, shared types/shaders). Fetch them only when the trail leads there.
- If you have no repo access at all, say so plainly and answer only from what the user provides, labelled Inferred.

### 2. Orient before diving
1. Read `references/clypra-map.md` to find the subsystem's starting files, intent docs and known invariants.
2. Read the **intent documents first** — they are the cheapest source of *why*: `AGENTS.md` (architectural invariants), `.agents/rules/*`, `docs/` (look for a file named after the subsystem), `docs/architecture/adr/`, and `CHANGELOG.md`.
3. Run the history helper on the main file, directory or symbol:
   `bash scripts/history_dossier.sh <repo> <path-or-symbol> --limit 15`
   It returns origin commit, rename trail, biggest changes, blame hot-spots, PR refs, intent comments and fix-churn. Treat it as a map, not an answer.

### 3. Trace HOW
Follow **one concrete scenario end to end** rather than describing modules in the abstract (for preview: user presses play; for export: user clicks Export on a timeline with text; for a text effect: user applies it and scrubs). For each hop note:
- entry point and trigger, the data or message that crosses it, and who owns the state;
- boundaries crossed: React/Zustand → Tauri `invoke` / channel → Rust → wgpu / FFmpeg / cpal, and which thread or worker tier runs it;
- caches and their keys, epochs/generation counters, locks, backpressure;
- failure and fallback paths (these often hold the real design intent);
- what is configurable (flags, env vars, platform branches) and the default.

Then trace the same path for a *second* platform or mode if one exists (macOS/Windows, native surface/bridge fallback, desktop/Capacitor). Divergent logic for one operation is the project's named anti-pattern ("split-brain"), so look for it deliberately.

### 4. Dig for WHY
Search evidence in roughly this order of reliability, and stop digging a decision once you have a Confirmed source:

1. **Commit body and diff where the thing was introduced** (`git log -S`, `git log --follow --diff-filter=A`) — the author's words at the moment of choice.
2. **ADRs and design docs** under `docs/` — check their dates against the code history; docs go stale.
3. **PR / issue numbers** referenced in commits and `CHANGELOG.md` (the CHANGELOG entries often carry the symptom, root cause and PR in one paragraph).
4. **Comments and constants** — invariants, "must never", rationale comments, enum variants, thresholds with units.
5. **Tests** — names and assertions encode intent; regression tests name the bug they stop. Golden files and append-only suites mark behaviour the author refuses to lose.
6. **Deleted and replaced code** (`--diff-filter=D`, large negative diffs, reverts) — what was tried and abandoned is the best evidence for alternatives considered.
7. **Measurements** — benchmark reports, telemetry fields, perf-audit docs. Check method (build type, hardware, n, cold vs warm) before trusting a number.
8. **Sibling repos and issue discussions** when the trail crosses a repo boundary.

Decision signals worth chasing: a flag or constant that was flipped, a module that was rewritten, a duplicated implementation, a "temporary" bridge, an invariant added right after a bug, a doc that begins with "root cause".

### 5. Reconstruct each decision
Use the template in `references/decision-record-template.md`: Decision, Context, Alternatives, Why this won, Trade-offs accepted, Still true today?, Evidence, Confidence. Keep each record short. Most investigations yield 3–8 real decisions; do not pad with trivia.

When *why* is not recorded, write "Not recorded", give your best inference labelled **Inferred** with its basis, and name what would settle it (ask the author, run a specific experiment, read a specific external doc).

### 6. Pressure-test before reporting
Spend a moment trying to break your own story:
- Is there counter-evidence — a later commit that reversed this, or a caller that contradicts it?
- Do the docs, the code and the tests agree? If not, which is newest and which is authoritative?
- Did a "fix" actually change behaviour, or only telemetry and tests?
- Is anything you called live actually unwired, or anything called dead actually reached via a flag?
- What depends on this decision (blast radius if someone changes it)?

### 7. Report
Match the size to the question: a narrow "why is X like this?" gets a short answer in the same structure; a "walk me through subsystem Y" gets the full report. Default to the reply in chat; produce a file only if the user asks for one.

```
## Bottom line
3–5 sentences: how it works, the 1–3 decisions that matter most, and the biggest caveat.

## How it works (as of <short hash>, <date>)
The traced scenario, hop by hop, with path:line references. Add a small diagram when flow is non-obvious.

## Decisions
One record per decision (see template), each with a confidence label.

## Timeline
Only the commits/PRs that changed the design, newest last: hash · date · what changed · why (if known).

## Risks, inconsistencies, open questions
Split-brain, dead/unwired code, docs ≠ code, unverified assumptions, things only the author can answer.

## Method
Commit investigated, sources read, commands that mattered, and what you could NOT verify.
```

Write for a technical founder who knows the stack: no re-explaining Rust, React or Tauri basics. Lead with conclusions, link every claim to evidence, quote short snippets only when the exact wording is the evidence, and do not paste whole files.

## When the trail goes cold
Say so. Offer concrete next steps: a `git bisect` on the behaviour, a specific question for the author, a targeted benchmark, or the sibling repo to read next. A clearly marked gap lets the user decide what to do about it; a smoothed-over gap quietly misleads them.

## Reference files
- `references/clypra-map.md` — repo layout, subsystem starting points, intent docs, invariants, and past findings (snapshot; verify before use).
- `references/git-archaeology.md` — command cookbook for pickaxe, blame, rename-following, deleted code, bisecting intent.
- `references/decision-record-template.md` — decision record format plus a worked example.
- `scripts/history_dossier.sh` — history report for a file, directory or symbol.
