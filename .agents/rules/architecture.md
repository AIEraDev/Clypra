# Clypra — Architectural Constraints
# Loaded automatically from .agents/rules/ by all agent tools.
# These supplement AGENTS.md with low-level implementation constraints.

## Data flow — timeline → rendering
- `timelineStore` is the source of truth for clip/track state.
- All rendering consumes `EvaluatedScene` from `evaluateTimelineSceneCached()`.
- Never bypass the evaluator. Never access `timelineStore.getState()` inside a render loop.
- `EvaluatedScene` is immutable once created — never mutate it after evaluation.

## Timeline mutations
- Mutations must go through `historyStore.dispatch(command)` to be undoable.
- Use commands in `src/core/commands/` as templates.
- Timeline state is serialized by `projectStore` only — no other store writes to disk.
- `timelineDraftStore` is for preview-mode edits that haven't been committed yet.

## Asset paths
- `MediaAsset.path` is `""` until the asset probe completes. Never pass `""` to Rust.
- `getActiveAudioClips()` enforces path filtering — the `.filter(c => Boolean(c.path))` must remain at the end of the chain.
- `updateSource()` re-syncs when state changes — this is how late-hydrating assets get picked up.

## Render loop (NativeProgramPreview.tsx)
- The render loop is a closure. All state lives in `let` variables above the function definition.
- Never introduce `this` references or class state inside the loop body.
- `renderInFlight` must be reset to `false` in EVERY exit path (early returns, catch blocks, finally).
- `scheduleNextFrame()` must be called in EVERY exit path that expects the loop to continue.
- `lastNativePlaybackRequestKey` is set AFTER `submitNativePlaybackDemand()` succeeds — never before.
- Every new stateful closure variable needs an epoch guard and a reset in the cleanup function.

## PlaybackClock
- Single source of truth for playback time. One instance per app session (module-level singleton).
- `hasNativeClockPosition` returns true when EITHER a real position was received OR `markNativeAudioUnavailable()` was called.
- `nativeAudioWasUnavailable` getter — read BEFORE calling `clearNativeAudioUnavailable()` to detect the transition.
- `setNativeClockAuthority(false)` clears both `_nativeClockPosition` and `_nativeAudioUnavailable`.
- Never call `setNativeClockPosition()` from outside `NativeAudioPreviewController` or the Rust sync path.
- After ANY change to `PlaybackClock.ts`, restart the dev server.

## Audio engine (NativeAudioPreviewController)
- `seekNativeAudio()` is edge-triggered per `seekIntentRevision`. Never call it in a polling loop.
- `updateSource()` is the re-sync path when timeline edits or asset hydration changes clips.
- `initialize()` sets `nativeClockAuthority(true)` before any await — prevents Web Audio clock race.
- Call `markNativeAudioUnavailable()` when `syncNativeAudioTimeline()` returns zero clips.
- Call `clearNativeAudioUnavailable()` (with `wasUnavailable` check) when clips later install.
- If `wasUnavailable && clock.state === "playing"`: immediately enqueue seekNativeAudio + nativePlayFromAudio to prevent seek-back to position 0.

## Audio clip resolution (getActiveAudioClips / audioClips.ts)
- Filter: `.filter(config => Boolean(config.path))` must remain at the end of the chain.
- An empty path means the asset hasn't hydrated yet — do NOT pass it to Rust IPC.
- `clipHasAudio()` intentionally returns `true` for unprobed assets (UI safety, prevents flicker). This is correct behaviour — the path filter is the enforcement boundary.

## Export pipeline
- Export must not mutate `timelineStore` state during a render.
- Always call `exportPreflight()` before starting encoding.
- Progress is reported via `ExportProgress` callbacks — never block the React render thread.
- Frame batching (`frameBatching.ts`) is mandatory for fps > 30 — never submit frames one-by-one.

## IPC discipline (Tauri bridge)
- Never call `invoke()` inside a RAF callback for non-frame-essential work.
- Batch related IPC calls with `Promise.all()` where ordering allows.
- Cold IPC calls (first call after process start) can take 50–500ms. Don't assert tight timing.
- All Tauri file path arguments go through `nativeCore.ts` path conversion — never pass raw JS `string` paths directly without conversion.
- IPC security (`src-tauri/src/commands/security.rs`) validates all paths — never bypass.

## Zustand store discipline
- Each store owns exactly one domain (see §5 of SKILL.md for ownership table).
- Do not read one store from inside another store's action function — pass required data as arguments.
- `settingsStore` state is persisted. Do not store ephemeral session state there.
- UI-only state (panel widths, modal open/closed) belongs in `uiStore`, not `timelineStore`.

## TypeScript / build
- `npx tsc --noEmit` must pass with 0 errors before any commit or dev server restart.
- Vite serves stale bundles silently when TS errors exist.
- Do not use `any` casts to silence TS errors in production code. Fix the types.
- Do not remove type imports without checking they are truly unused.

## Workers
- Web Workers (`src/workers/`) must not import React or access the DOM directly.
- All worker↔main thread communication goes through typed message channels defined in `src/workers/types.ts`.
- Never share mutable state between main thread and workers — use `postMessage` copies or `SharedArrayBuffer` with explicit locks.

## Testing
- `ProgramPreview.renderLoop.test.ts` is append-only. Baseline: **156 tests, 0 failures**.
- Every bug fix needs a test in a `describe("Bug N — Title")` block.
- `PlaybackClock`, `PlaybackPushBridge`, `NativePreviewFrameScheduler` are directly instantiable in tests — no mocking needed.
- For Rust: property-based tests (proptest) for data structures; integration tests for engine pipelines; golden frame tests for compositor output.
