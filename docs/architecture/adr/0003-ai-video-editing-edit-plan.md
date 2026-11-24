# ADR-0003: AI Video-Editing Automation Through a Validated Edit Plan

## Status

Proposed

## Context & Problem Statement

Clypra should let an AI agent edit a project on the user's behalf ("remove the
silences", "add captions", "cut this to 60 seconds") on desktop now and on
mobile once the native engine runs there. The editor already has most of the
substrate for this, but nothing yet defines how an agent is allowed to touch a
project, how its changes are checked, or how they are graded.

Verified facts (read from the repository at `perf/multi-tier-composite-automation`):

- Timeline edits are intent-based commands. `src/core/history/Command.ts`
  defines `Command` (`apply`, `invert`, optional `merge`, `undoable`) and
  `SerializableCommand` (`toJSON`/`fromJSON`). `Transaction` groups commands
  into one undo unit, and `CommandJournal` offers `execute`,
  `beginTransaction`, `commitTransaction` and `rollbackTransaction`.
- The UI reaches the journal through `useHistoryStore` in
  `src/store/historyStore.ts` (`execute`, `beginTransaction`,
  `commitTransaction`, `rollbackTransaction`). `AGENTS.md` invariant 3 names
  `historyStore.dispatch(command)`, but no `dispatch` exists. The documentation
  and the code disagree and the code is authoritative here.
- 46 command classes exist across 25 files under `src/core/history/commands/`, including
  `SplitClipCommand`, `TrimClipCommand`, `RippleDeleteCommand`,
  `RippleDeleteRangeCommand`, `MoveClipCommand`, `AddClipCommand`,
  `UpdateClipCommand`, `TransformClipCommand`, `AddTransitionCommand`, caption
  and sticker commands.
- Only 15 of the 25 command files implement `toJSON`. `RippleDeleteRangeCommand`,
  `DuplicateClipCommand`, `InsertEditCommand`, `SwapClipsCommand`,
  `TransformCommand` and the caption commands do not.
- Commands are stateful and permissive. `SplitClipCommand` assigns its output
  clip IDs inside `apply()` and returns the input state unchanged when the clip
  is missing or the split time is outside the clip. An invalid edit therefore
  does not fail: it silently does nothing.
- Commands take snapshots at construction (for example `originalClip`), so a
  command built against stale state is wrong.
- `src/core/history` has no Tauri or `invoke` imports. The command layer is
  platform-neutral TypeScript.
- `evaluateTimelineSceneCached()` is the single render currency
  (`EvaluatedScene`, invariant 2) and is pure TypeScript.
- On-device perception exists as Tauri commands: `detect_silence_ranges`
  (`silence_detector.rs`), `generate_auto_captions` (`captions.rs`, Whisper),
  and `auto_reframe.rs` (MediaPipe through ONNX).
- `deviceCapabilities.ts` defines desktop and mobile `PerformanceProfile`s.
- `agent-evals/` grades AI coding agents. It does not grade an AI that edits
  video.
- Mobile today is a frozen Capacitor shell with no native engine
  (`docs/legacy-retirement-checklist.md`); the Rust crate has no `android` or
  `ios` code paths.

Assumptions not yet verified:

- Every edit the agent will need can be expressed through existing commands.
  Confirmed so far: plain text clips are added with
  `history.execute(new AddClipCommand(textClip))` (`TextTab.tsx`), and the
  text style, captions and smart-overlay panels also reference the history
  store. Not yet confirmed: text effects and text templates beyond the initial
  add, and video effects. Phase 1 must audit which user-visible edits still
  bypass the history store.
- `timelineStore.epoch` ("increments on every timeline mutation") is a
  sufficient staleness token for `baseEpoch`. It is documented as a render
  cache-invalidation counter, so Phase 1 must confirm it also advances on
  undo/redo.
- A cloned timeline state can be evaluated cheaply enough for dry runs on a
  mid-range phone.

Constraints:

- The agent must never be able to damage a project beyond what one undo
  reverts, and must never reach outside the timeline (files, shell, network).
- Media-derived text (transcripts, captions, filenames, metadata) is untrusted
  input and can contain instructions aimed at the agent.
- Plans must behave identically on every platform; only capability limits may
  differ (invariant 11).

## Decision

Adopt an **Edit Plan** boundary. The agent never produces store mutations,
commands or pixels. It produces a declarative, versioned `EditPlan` that Clypra
validates, previews and compiles into existing commands inside one transaction.

### 1. The plan

```ts
interface EditPlan {
  schemaVersion: 1;
  planId: string;
  baseEpoch: number;          // timeline epoch the plan was written against
  intent: string;             // user request, for the journal label only
  ops: EditOp[];              // ordered; hard cap (initially 200)
}

type Target =
  | { clipId: string }
  | { track: string; atMs: number }                // clip covering this time
  | { track: string; index: number }               // ordinal on a track
  | { ref: string };                               // output of an earlier op

type EditOp =
  | { op: "split";        target: Target; atMs: number; as?: [string, string] }
  | { op: "trim";         target: Target; startMs?: number; endMs?: number }
  | { op: "deleteRange";  track: string; startMs: number; endMs: number; ripple: boolean }
  | { op: "move";         target: Target; toMs: number; toTrack?: string }
  | { op: "setVolume";    target: Target; gain: number }
  | { op: "addText";      track: string; atMs: number; durationMs: number; text: string; templateId?: string }
  | { op: "addCaptions";  trackId?: string; cues: Array<{ startMs: number; endMs: number; text: string }> }
  | { op: "addTransition"; between: [Target, Target]; kind: string; durationMs: number }
  | { op: "update";       target: Target; patch: AllowlistedClipPatch };
```

Design rules:

- **Times are milliseconds, never frame numbers.** The project timeline can run
  at 30 fps over 25 fps media, so frame indices are ambiguous across the
  stack. The compiler converts to frames once, using the project frame rate and
  the same frame-snapping logic the editing commands already use (for example in
  `SplitClipCommand`), rather than introducing a second conversion.
- **Symbolic references, not IDs the agent has to guess.** Output clips of a
  split get their IDs inside `apply()`, so later ops address them by
  `ref`/selector and the compiler resolves them from the working state after
  each step.
- **`update` takes an allowlisted patch**, not arbitrary clip fields. Each
  allowlisted key has a type and range in a single schema file.
- Unknown `op`, unknown fields and out-of-range values are rejected, never
  ignored.

### 2. Compile, dry-run, verify, apply

```
plan JSON
  → schema validation (types, ranges, op cap, allowlist)
  → compile against a CLONED working state, one op at a time
       (fresh command instances; selectors re-resolved after each op)
  → effect check per op (state actually changed as the op declared)
  → invariant check (bounds, overlaps, layer budget, capability profile,
       native-representable scene)
  → evaluateTimelineSceneCached() on sampled times (pure, no engine needed)
  → preview diff shown to the user
  → on approval: recompile with fresh instances against live state,
       beginTransaction → execute(...) → commitTransaction
       (rollbackTransaction on any failure)
```

- **Effect checking is required** because commands return unchanged state for
  invalid input. An op whose command leaves the state equal is a plan error,
  reported with the op index, not a success.
- **Dry run and real apply use separate command instances**, because commands
  carry mutable state (IDs assigned in `apply`).
- **Stale plans are rejected.** If the live epoch differs from `baseEpoch` the
  plan is recompiled and re-validated, or discarded, never applied blindly.
- The whole plan is **one transaction and therefore one undo step.** Inside a
  transaction the journal records commands before it considers coalescing, so
  500 ms coalescing cannot merge plan commands. Plan size is bounded so it also
  stays within the journal's history limit.
- Provenance is recorded on the transaction label and in telemetry:
  `source: "ai"`, model identifier, prompt hash. Prompt text is never logged
  with paths or personal data (invariant 14).

### 3. Tool surface for the agent

Separate from the UI command registry (`clipCommands.ts`, which carries icons,
shortcuts and `isEnabled`):

| Class | Tools | Side effects |
| --- | --- | --- |
| Read | `getTimelineSnapshot`, `getTranscript`, `getSilenceRanges`, `getShotList`, `getLoudness` | none |
| Verify | `evaluateScene(atMs[])`, `renderSampleFrame(atMs)` | none |
| Propose | `submitPlan(EditPlan)` | none until the user approves |

The agent has **no tool that writes to a project, filesystem, network or
process.** The only way a change lands is the user-approved plan.

Perception is computed locally by the existing commands and returned as compact
text (timestamped transcript, silence ranges, loudness curve, shot boundaries).
Media bytes never leave the device. Cloud planning is opt-in and shows the user
what is sent.

### 4. Trust and safety

- Transcript, caption and filename text is wrapped as quoted data in the
  agent's context and never concatenated into instructions.
- Because the agent has no side-effecting tools, a successful prompt injection
  can at worst propose a bad plan, which the user sees as a diff before apply.
- Hard caps: ops per plan, plans per session, total plan size.
- Destructive operations (deleting media, removing tracks) are excluded from
  the first op set.
- All new user-facing strings use `en.json` keys with parity across the nine
  locales (invariant 12).

### 5. Platform behavior

The plan format and the compiler are platform-neutral TypeScript. Platform
differences are limited to a **capability profile** derived from
`deviceCapabilities.ts` (maximum layers, proxy-only preview, maximum plan
cost). The compiler refuses or downgrades what the device cannot handle and
reports why. Timeline math contains no OS branching.

On mobile the plan layer can be built before the native engine, but previewing
and approving a plan requires a working preview there. That depends on the
mobile engine work recorded in the platform audit and is out of scope here.

### 6. Evidence and grading

- **Edit evals.** Fixtures pair a project with an instruction and a
  hand-written reference plan. Grading uses structural assertions (cut counts,
  no unintended gaps, caption coverage, nothing outside the allowed range),
  not pixel comparison. Model-planned output is graded against the same
  assertions. Results are recorded alongside the existing `agent-evals`
  conventions but in a separate directory, because these grade the editing
  agent, not coding agents.
- **Performance gate.** The edited project runs through `npm run perf:cycle`
  so an AI-built scene cannot silently break playback budgets.
- **Telemetry.** An `ai-plan` event in the v2 perf envelope: op counts,
  validation failures by class, effect-check failures, apply time, scene
  complexity before and after, approval or rejection.

## Alternatives Considered

- **Agent calls store actions or Tauri commands directly.** Simplest, but gives
  it write access with no preview, no single undo, and exposure to injected
  instructions. Rejected.
- **Agent emits raw `Command` JSON.** Reuses the command layer, but 10 of 25
  command files are not serializable, commands carry mutable state and
  construction-time snapshots, and IDs created in `apply()` cannot be known in
  advance. Rejected in favor of a plan that compiles to commands.
- **Agent edits the project file on disk.** Bypasses history, validation and
  the running editor's state. Rejected.
- **Agent drives the UI (clicks and keystrokes).** Slow, brittle, and
  platform-specific. Rejected for this feature; the debug scenario driver
  remains for performance testing only.
- **Send media or frames to a cloud model.** Higher capability but breaks the
  local-first privacy position and cost model. Deferred; frames may be offered
  later as explicit opt-in thumbnails.

## Consequences & Trade-offs

- **Positive**: one undo step per AI edit; every change is previewable and
  reversible; the agent cannot reach outside the timeline; the same plan format
  works on desktop and mobile; plans are testable without any model.
- **Negative / Costs**: an additional schema and compiler to maintain; the op
  set must grow with the editor; the effect check adds latency to every plan;
  serialization gaps in the command layer need closing for replay.
- **Risks & Mitigations**:
  - A command the plan needs bypasses history. Mitigation: the phase 1 audit,
    and the op is not offered until it goes through the journal.
  - Silent no-op commands hide plan errors. Mitigation: mandatory effect check
    per op.
  - Dry-run cost on weak devices. Mitigation: sample the evaluation times and
    enforce the capability profile.
  - Documentation drift (`dispatch` versus `execute`). Mitigation: correct
    `AGENTS.md` invariant 3 in the same change that introduces the compiler.

## Verification & Migration Strategy

Phased, each phase merged and verified alone:

1. **Plan core, no model.** `EditPlan` schema, validator, compiler, effect
   check, transaction apply, and a history-bypass audit. Vitest with
   hand-written plans, including: split followed by a ref, stale `baseEpoch`,
   no-op op, over-cap plan, rollback on mid-plan failure, single-undo
   assertion.
2. **Read tools and a first use case built from existing perception:** remove
   silences and add captions, using `detect_silence_ranges` and
   `generate_auto_captions`.
3. **LLM planner** (opt-in, cloud) with the preview-and-approve UI.
4. **Eval suite and the performance gate**, plus `ai-plan` telemetry in the v2
   envelope.
5. **Mobile capability profile**, once a preview exists on the device.
   Optionally expose the same tools through a locally secured tool server so
   external agents can drive the desktop app.

Required checks per phase: `npx tsc --noEmit`, `npm run i18n:check`,
`npm run docs:check`, the history and evaluation Vitest suites, and
`npm run verify:fast`.

Migration: no project-file schema change. The plan is transient, and the
journal entry is an ordinary transaction. Rollback: remove the plan entry
point; existing history and commands are untouched.

## Open Questions

- Which text-effect, text-template and video-effect edits bypass
  `useHistoryStore` today?
  - **Plain text add** (`TextTab.tsx`): goes through `useHistoryStore` (`AddClipCommand`). **Yes.**
  - **Caption edits** (`CaptionsTab.tsx`): go through `useHistoryStore` (`AddCaptionCueCommand`, `BatchUpdateCaptionCuesCommand`, `UpdateCaptionCueCommand`, `AddClipCommand`). **Yes.**
  - **Chroma key / video-effect parameters** (`ChromaKeySection.tsx`): call `useTimelineStore((state) => state.updateClipChromaKey)` directly, bypassing `useHistoryStore`. **No** — must be wrapped in `UpdateClipCommand` before exposing as an AI op.
  - **Live property preview** (`usePropertyEditCoordinator.ts:66`): calls `useTimelineStore.getState().updateClip` with `_skipEpochIncrement: true` during drag/scrub preview, then commits via `useHistoryStore` (`execute(new TransformCommand(...))`) on release. **Yes (commit path).**
  - **Auto-created caption track rename** (`TextTab.tsx:207`, `CaptionsTab.tsx:209`): call `useTimelineStore.setState` only to rename a newly created `"text"` track immediately after `ensureTrackForType("text")`.
  - **Epoch on undo/redo**: Confirmed in `src/store/historyStore.ts` that `undo()`, `redo()`, and `rollbackTransaction()` all increment `timelineStore.epoch` monotonically.
- Should plan replay use `SerializableCommand`, and which of the 10
  non-serializable commands are worth converting first?
- What is the right default for the maximum ops per plan and per session?
  - General AI plans keep `EDIT_PLAN_MAX_OPS = 200`. Deterministic
    silence-removal plans (`buildRemoveSilencesPlan`) use
    `REMOVE_SILENCES_MAX_OPS = 1000` (with `maxOps` override) because all ops
    are `deleteRange` and long recordings frequently exceed 200 pauses.
  - `applyEditPlan` also accepts `isLiveEditActive` to reject plans while
    `usePropertyEditCoordinator` has an uncommitted `_skipEpochIncrement` drag
    or scrub in progress.
