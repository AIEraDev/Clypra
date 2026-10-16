# Antigravity task: read-only as-is audit of the Clypra preview subsystem

You are auditing, not designing. Do **not** propose a redesign, do **not** refactor, do **not** fix bugs you find. The output of this task is a set of evidence-backed documents describing how the preview works today, so that an architecture can later be fitted to the real code instead of guessed.

## Hard rules

1. **Read-only on source.** Do not edit anything under `src/`, `src-tauri/`, `crates/`, `scripts/`, `tests/`, or CI config. You may only create files under `docs/preview-audit/`. Work on a new branch `docs/preview-as-is-audit`, open a PR, and **do not merge it**. Never push to `master`.
2. **Every claim needs a citation** in the form `path:line` (or `path:startLine-endLine`) at the current `HEAD`, plus the commit SHA you audited. A claim without a citation must be tagged `[UNKNOWN]` or `[INFERRED]`, never stated as fact.
3. **Tag the evidence type on every row:** `[CODE]` (read directly in source), `[LOG]` (taken from a recorded session NDJSON, cite the file and record), `[GIT]` (from blame or a commit message, cite the SHA), `[INFERRED]`, `[UNKNOWN]`.
4. **Read files completely, in chunks.** `NativeProgramPreview.tsx` is very large. Read every line of it. Keep a **coverage ledger** (`docs/preview-audit/coverage-ledger.md`): for each file, total lines and the exact line ranges you read. A file with unread ranges must say so; do not summarize code you did not read.
5. **Do not summarize with adjectives.** No "robust", "clean", "well-structured", "complete". Use tables, counts, and quotes of identifiers only.
6. **If something contradicts what you expected, report the contradiction** instead of smoothing it over.
7. **No self-certification.** Your final message must state what you did **not** determine, and the results of the verification pass (below).

## Scope (audit all of it)

- Frontend preview: `src/components/editor/preview/**`, `src/components/editor/transform/**`, `src/components/editor/viewport/**`, `src/components/editor/timeline/**` only where it touches playhead or playback.
- Playback and scheduling: `src/core/playback/**` (including `PlaybackClock.ts`), `src/core/scheduler/**` (including `FrameScheduler.ts`), `src/core/runtime/**` (including `nativeSurfaceLifecycle.ts`), any `ProjectSession`.
- Native bridge: `src/lib/platform/**` (including `nativeCore.ts`, `tauri.ts`), `useNativeSurfaceController.ts`, `previewOutputAdapters.ts`, any `nativeRasterBridge`.
- Audio preview: `src/core/audio/**` (including `nativeAudioPreviewController.ts`).
- State: `src/store/**` fields that preview, playback, selection, or viewport read or write (including `uiStore.ts`, `timelineStore.ts`, `projectStore.ts`).
- Rust: preview, native surface, native audio, and native frame service commands under `src-tauri/src/commands/` and `src-tauri/src/wgpu_compositor/`, and `crates/` native-core. Focus on IPC commands, global state (statics, atomics, `OnceLock`, `Mutex`), and emitted events.

## Deliverables (one file each, in `docs/preview-audit/`)

### 00-inventory.md
Table of every in-scope file: path, line count, one-line responsibility **taken from its exports and imports**, and its direct importers (count). Include the top 10 largest files. Include any circular imports (use `madge`, `dependency-cruiser`, or a throwaway script; do **not** add a dependency to the repo; run it via `npx` in a temp directory if needed and say how you ran it).

### 01-state-catalog.md (and `01-state-catalog.csv`)
A row for **every** piece of mutable preview-related state:
`name | kind (useState / useRef / module-level let / store field / Rust static / timer / listener) | declared at (path:line) | written at (all sites) | read at (all sites) | what real-world fact it represents | does another variable represent the same or an overlapping fact? (name it)`.
Include every boolean or enum that influences which presenter shows the frame, whether playback runs, whether audio starts, or whether a render is requested (for example `nativePlaybackPath`, `nativeDirectSurfacePath`, `nativeSurfaceShown`, `nativeSurfaceNeedsHide`, `pendingHandoverSurfaceHide`, `handoverSafetyTimer`, `presenterFallbackReason`, `isPlaying`, `renderInFlight`, and anything similar you find).
**Completeness check:** write a small throwaway script (commit it as `docs/preview-audit/tools/extract-state.mjs`) that extracts every `useState`, `useRef`, `let`, and `create(` field name from the in-scope files with a regex or the TypeScript compiler API, and diffs the result against the catalog. Report the number of names the script found, the number in the catalog, and list any missing. The target is zero missing.

### 02-owners.md
For each of the following, list **every call site** (`path:line`) and the enclosing function, and state how many distinct modules perform it:
- Starting, stopping, seeking, or ticking the playback clock.
- Calling `show`, `hide`, `present`, or resize on the native surface, and every write to the DOM canvas.
- Starting, stopping, or re-syncing native audio.
- Creating a render request or demand (frontend and the Rust entry points).
- Changing the playhead position in any store.
- Opening or closing anything that calls `hideNativeSurfaceWhenIdle` or `forceRepaintNativeProgramPreview`.
End with a table: *capability → number of writers → are they in more than one module?*

### 03-flows/*.md (one file per flow)
For each flow, a numbered step table: `step | trigger | function and path:line | state read | state written | external effect | evidence tag`. Flows:
1. Play from paused to the end of the timeline.
2. Replay after reaching the end.
3. Seek while playing.
4. Pause during playback (including the native-to-canvas handover).
5. Open a menu, dropdown, or modal during playback and close it again.
6. Edit the project (add, delete, or move a clip, or edit text) during playback.
7. Open a source preview (asset preview) from program preview and return.
8. Add a clip to an **empty** timeline (sticker, text, audio, image, video) and show it.
9. Cold start of playback with audio (project already loaded).
10. Native surface device loss or window resize or move during playback.
For flows with recorded sessions (look in `perf_logs/`, `reports/`, `test-results/scenarios/`), cite log records for each step. If no log exists for a flow, say `[INFERRED from code]` and list what would need to be captured. **Do not run or instrument the app to create logs in this task.**

### 04-workarounds.md
Every timer, retry, safety timeout, "latch", guard flag, or comment containing words like "workaround", "hack", "race", "flash", "stale", "TODO", "FIXME", "safety". For each: location, what it guards against, the commit that introduced it (`git blame` or `git log -S`, cite the SHA and message), the linked issue or PR if any, and whether a test covers it (cite the test or write `none found`).

### 05-contradictions.md
Concrete findings only:
- Pairs or groups of state that can disagree, and a code path that makes them disagree (cite both writers).
- State combinations reachable by the flows that no code path handles.
- Duplicated sources of truth (for example playhead time in the clock, a store, and the audio position) and which one each consumer reads.
- Dead code or flags that are written but never read, or read but never written.
- Behaviour that differs between Tauri runtime, web/test runtime, and mobile (Capacitor) builds.
Rank each finding by how many flows it touches. State the evidence tag for each.

### 06-seams-observed.md
What is **already** separated today: existing interfaces, ports, adapters, and pure modules (for example `PlaybackClock`, `FrameScheduler`, `PreviewQualityManager`, `ProjectSession`, `evaluateTimelineSceneCached`, the command/history layer). For each: public API surface (exported function names and types), who imports it, whether it imports React or a store (a purity check), and its test coverage by file. Also list the coupling hot spots: files that import more than 15 in-scope modules, and any module imported by both view components and low-level code.

### 07-rust-surface.md
Table of IPC commands in scope (name, arguments, return type, file:line) and every piece of global mutable state in Rust that preview or audio depend on (`static`, `OnceLock`, atomics, `Mutex`) with who writes and reads it, and every event emitted to the frontend with its payload type. Mark which commands are debug-only and how they are gated.

### 08-open-questions.md
Everything you could not determine, each with the file or log that would answer it.

### coverage-ledger.md
Per file, lines read versus total lines. Totals at the bottom.

## Process

1. Start with the inventory and the coverage ledger. Read in order: state stores, `PlaybackClock`, scheduler, native bridge, audio controller, then `NativeProgramPreview.tsx` completely, then the transform overlay and viewport code, then the Rust commands.
2. Build the state catalog while reading, not afterwards from memory.
3. Write the flows only after the catalog and owner tables exist, and reuse their identifiers.
4. Use `git blame` and `git log -S` for the workarounds file; cite SHAs.
5. Run the completeness script and fix the catalog until it reports zero missing names.

## Verification pass (required before you report)

Pick **25 claims at random** from across the deliverables (at least 5 from each of: state catalog, owners, flows, workarounds, contradictions). For each, re-open the cited file at the cited line and confirm it. Write the results in `docs/preview-audit/verification.md`: claim, citation, confirmed or wrong, and the correction. Report the pass rate. Fix every wrong claim in the deliverables and say what changed.

## Definition of done (all must be true; show the evidence)

- All ten deliverables plus the ledger and the verification file exist under `docs/preview-audit/`, on the PR branch.
- The completeness script reports zero names missing from the catalog (paste its raw output).
- Every in-scope file appears in the ledger, and any unread range is listed with a reason.
- The verification pass has 25 checked claims and its pass rate is stated; wrong claims are corrected.
- No file outside `docs/preview-audit/` changed (paste `git diff --stat origin/master...HEAD`).
- The PR is open and **not merged**.

## Final message format

1. The audited commit SHA and the PR link.
2. A table of deliverables with row counts.
3. The coverage totals and the verification pass rate.
4. A list of everything marked `[UNKNOWN]` or `[INFERRED]`, grouped by deliverable.
5. The five highest-ranked contradictions from `05-contradictions.md`, one line each with citations.
6. Nothing else. No recommendations, no redesign, no statements that the code is "good" or "ready".
