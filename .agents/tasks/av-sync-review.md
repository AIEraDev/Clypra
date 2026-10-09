# Audio-video synchronization fix — wall-clock gate removal

This change removes the audio-readiness gate that blocked video playback during the ~555ms CPAL initialization window, causing 16-18 frames of drift at project start. The PlaybackClock now extrapolates time forward from a wall-clock anchor captured at `play()`, allowing video to advance immediately while audio initializes asynchronously.

The fix touches three architectural layers: the Rust IPC boundary (silent-project fallback), the TypeScript clock authority (wall-clock extrapolation), and the React render loop (gate removal). A filter was added to `getActiveAudioClips()` to prevent empty asset paths from reaching Rust and triggering false "no clips installed" signals that would freeze video.

**Watch for:** Missing test coverage (confirmed — no new tests added), one stale assignment in `NativeProgramPreview.tsx` that breaks the playback-key tracking contract, and the `useAudioSyncEngine` conditional removal that looks like unrelated refactoring bundled into the AV-sync fix.

**Verdict**: CHANGES_REQUESTED

## High-level view

The core mechanism is wall-clock extrapolation in `PlaybackClock.time`: when `_nativeClockAuthority` is set but CPAL hasn't delivered its first position sample, the getter computes `_playStartClockTime + elapsed * _speed` from a `performance.now()` anchor captured in `play()`. This is architecturally sound — video must never wait for audio — but the extrapolation path has no upper bound and could drift indefinitely if CPAL never sends a sample.

The Rust `native_play_from_audio` command now has a fallback arm that starts video with a zeroed FrameTime when `audio_clock_time()` returns `Err`. This is the silent-project path: no clips installed, no CPAL stream, video plays from wall-clock. The fallback is correct but asymmetric: `native_tick_from_audio` uses `unwrap_or_else` to supply the same fallback, while `native_play_from_audio` uses a match arm. Both work, but the inconsistency makes the error-handling strategy less obvious.

The render loop removed all `nativeAudioClockReady` guards. Video now starts immediately when the surface is ready, regardless of whether CPAL has delivered a position sample. This is the intended behavior, but one line was missed: `lastNativePlaybackRequestKey` is assigned _before_ the snapshot-ready check, violating the contract that the key is only set after a successful demand submission. This breaks duplicate-demand suppression and could cause Rust to receive redundant IPC calls for the same frame.

The `getActiveAudioClips()` filter removes clips with empty paths before the config reaches Rust. Without this filter, unhydrated assets pass `clipHasAudio()` (unprobed fallback returns true) but have no resolvable path, causing `replaceNativeAudioClips` to silently drop them and report `installedClips=[]` even when the timeline contains audio. The controller then sets the audio-unavailable flag and video stays gated. The filter is correct, but it's a defensive patch for a broader asset-hydration race that could surface elsewhere.

The `useAudioSyncEngine` change removes a condition that skipped `updateSource()` when `!adapterRef.current.isActive`. The removed guard looks unrelated to the audio-readiness gate problem — it's not clear why starting the audio sync earlier would affect the 555ms CPAL delay. The commit message doesn't mention it, and the change could regress the "adapter not active" behavior if that guard was intentional. This looks like unrelated refactoring bundled into the AV-sync fix.

No tests were added. The review prompt requested 4 test scenarios (play-from-0, seek-then-play, silent-project fallback, rapid-seek) to verify the wall-clock extrapolation and fallback paths. The test file exists and has 155 test cases, but the diff shows no additions. The baseline was 131 tests; the current count is higher because prior bugs added tests, but this specific fix added none.

## Details

<details>
<summary>Issues (8)</summary>

1. **No test coverage for this fix** — The review prompt requested 4 scenarios: play-from-0 (wall-clock extrapolation before CPAL sample), seek-then-play (extrapolation anchor reset), silent-project (fallback FrameTime), rapid-seek (extrapolation doesn't drift). None were added. Add tests to `ProgramPreview.renderLoop.test.ts` under `describe("Bug <N> — audio-readiness gate removal", ...)` before merging.

2. **Stale key assignment breaks duplicate suppression (likely)** — `lastNativePlaybackRequestKey = requestKey` on line 3474 was moved outside the snapshot-ready check. The old code set the key only after `submitNativePlaybackDemand()` succeeded. The new code sets it before checking `nativePlaybackRenderSnapshotKey === snapshotKey`, meaning a frame that fails the snapshot check still updates the key and blocks the next attempt. Move the assignment back inside the `if` block that calls `submitNativePlaybackDemand()`, or confirm the move was intentional and document why.

3. **Unbounded extrapolation if CPAL never sends a sample (possible)** — The wall-clock path in `PlaybackClock.time` (lines 239-241 in the diff context) has no fallback if `_playStartMs` is set but CPAL initialization silently fails. The clock extrapolates indefinitely from the stale anchor, accumulating drift. Add a staleness check: if `performance.now() - _playStartMs > CPAL_INIT_TIMEOUT_MS` and `_nativeClockPosition` is still null, log a warning and fall back to returning `_time` instead of extrapolating. The 555ms target is a good threshold; 1000ms is safer.

4. **Asymmetric fallback handling in Rust (confirmed)** — `native_play_from_audio` uses a `match` arm for the audio-unavailable fallback (lines 1557-1573), while `native_tick_from_audio` uses `unwrap_or_else` (lines 1616-1617). Both produce the same zeroed FrameTime, but the pattern mismatch makes the error-handling strategy less obvious. Unify them: either use `unwrap_or_else` in both (more concise) or use `match` in both (more explicit). Not blocking, but worth cleaning up.

5. **`useAudioSyncEngine` condition removal looks unrelated (likely)** — The removed guard `if (!adapterRef.current.isActive) return;` (line 337 in audioClips change context) doesn't appear connected to the CPAL initialization delay or the audio-readiness gate. The commit message doesn't mention it, and the change could regress whatever behavior that guard was protecting. If the guard was blocking `updateSource()` when the adapter wasn't active, removing it might cause spurious IPC calls or state corruption. Confirm this was intentional and explain why it's part of the AV-sync fix, or move it to a separate commit.

6. **Empty-path filter is a defensive patch, not a root fix (confirmed)** — The `.filter(c => Boolean(c.path))` at the end of `getActiveAudioClips()` prevents unhydrated assets from reaching Rust, but it doesn't solve the root cause: assets with pending probes pass `clipHasAudio()` and look installed until the path check fails. If Rust or another consumer expects all clips returned by `getActiveAudioClips()` to have valid paths, the probe-pending state should be reflected in `clipHasAudio()` or filtered earlier in the pipeline. Not blocking for this PR (the filter does prevent the freeze), but document this as a known gap.

7. **`presenterFallbackReason` codes changed without migration (confirmed)** — The telemetry enum added `"embedded-only-flag"`, `"qualification"`, and `"surface-not-ready"`, and kept `"policy-override"` for backwards-compat. The comment says "so A/B sessions are distinguishable from bridge-only builds," but older perf logs use `"policy-override"` for multiple failure modes. If telemetry analysis depends on these codes, the new granularity will fragment the data. Not blocking, but flag it if the analysis pipeline expects stable enum values.

8. **TypeScript compilation evidence missing** — The review prompt says to check `/Users/AIEraDev/Documents/clypra-family/clypra/.agents/tasks/impl-note.md` for `tsc --noEmit` evidence. That file doesn't exist. AGENTS.md says TypeScript must compile clean before finishing. Run `npx tsc --noEmit` and confirm zero errors, or provide the impl-note showing it was already done.

</details>

<details>
<summary>Details</summary>

## Wall-clock extrapolation in PlaybackClock

The time getter has three paths: CPAL position extrapolation (highest accuracy), wall-clock extrapolation (new fallback for the pre-CPAL window), and frozen-time fallback. The wall-clock path triggers when `_nativeClockAuthority` is true but `_nativeClockPosition` is null, computing `_playStartClockTime + elapsed * _speed` from the `performance.now()` anchor captured in `play()`.

The risk is unbounded drift if CPAL initialization fails silently. The code assumes CPAL will either succeed and call `setNativeClockPosition`, or fail loudly and clear `_nativeClockAuthority`. If CPAL gets stuck in a state where it never sends a sample but also doesn't report failure, the clock extrapolates indefinitely from a stale anchor. The 555ms measured delay is the normal case; a stuck CPAL stream could drift seconds or minutes. A staleness check (e.g., `if (elapsed > 1.0) log warning and return _time`) would bound the failure mode.

## Rust silent-project fallback

The `native_play_from_audio` command wraps `audio_clock_time()` in a `match` and provides a fallback arm that starts playback with `FrameTime::new(0, 0, DEFAULT_TIME_SCALE)` when audio is unavailable. The fallback FrameTime is always zero, but the JS frame time in each `NativePlaybackDemand` is authoritative, so video starts from wherever the playhead was.

The asymmetry with `native_tick_from_audio` is confusing. The tick command uses `unwrap_or_else` (one line), while the play command uses a 14-line match arm with a comment. Both produce the same fallback, but the pattern mismatch makes it harder to see that the two paths handle audio-unavailable identically. Unifying them (both use `unwrap_or_else`, or both use explicit match arms with the same comment) would clarify the design.

## Render loop gate removal

The `nativeAudioClockReady` variable and all its usages were removed from `NativeProgramPreview.tsx`. Video now starts as soon as the surface is ready, without waiting for CPAL.

The stale assignment on line 3474 is a regression. The old code set `lastNativePlaybackRequestKey = requestKey` inside the `if` block that calls `submitNativePlaybackDemand()`. The new code moves the assignment outside the snapshot-ready check, so a frame that doesn't pass the `nativePlaybackRenderSnapshotKey === snapshotKey` guard still updates the key. The next RAF tick sees the key matches and skips submission, even though no demand was ever sent. This breaks duplicate suppression.

## Audio clip path filter

The `getActiveAudioClips()` function now filters out clips with empty paths before returning. Unhydrated assets pass `clipHasAudio()` (the unprobed fallback returns true) but have `asset.path === ""`. Rust's `replaceNativeAudioClips` silently drops clips with empty paths, producing `installedClips=[]` even when the timeline contains audio. The controller sees zero clips, calls `markNativeAudioUnavailable()`, and video freezes waiting for an audio-ready signal that will never come.

The filter is a defensive patch, not a root fix. The real issue is that `clipHasAudio()` returns true for unprobed assets, and the probe state isn't reflected in the clip config. If the asset hydration race surfaces elsewhere (export, thumbnail generation), the same empty-path problem could recur.

## Seek-then-play failure modes

If `seek()` happens during playback (without pausing), `_playStartClockTime` isn't updated, and the extrapolation keeps running from the old anchor until CPAL delivers a new position sample. This could cause a brief discontinuity: video jumps forward by the seek delta, but the clock lags behind until CPAL catches up.

The rapid-seek scenario is safe if `seek()` resets `_nativeClockPosition` to null. If it doesn't, the clock getter might extrapolate from a stale CPAL sample instead of using the wall-clock path, causing video to jump back to the pre-seek position.

## Test coverage gap

The review prompt requested 4 test scenarios: play-from-0, seek-then-play, silent-project fallback, and rapid-seek. None were added. The test file has 155 test cases, but the extra tests came from prior bugs (Bug 8A, Bug 8B, Bug 10), not from this fix.

The existing tests cover `markNativeAudioUnavailable()` and the `hasNativeClockPosition` getter, but they don't cover the wall-clock extrapolation path in `PlaybackClock.time`. That's the core of this fix: time advances from `_playStartMs` even when `_nativeClockPosition` is null.

## TypeScript compilation

The review prompt says to check `impl-note.md` for `tsc --noEmit` evidence. That file doesn't exist. Run `npx tsc --noEmit` and confirm zero errors.

</details>

---

## File map

<details>
<summary>10 files changed</summary>

- `src-tauri/src/commands/native_playback.rs` — Added silent-project fallback in `native_play_from_audio` and `native_tick_from_audio`
- `src/components/editor/preview/NativeProgramPreview.tsx` — Removed all `nativeAudioClockReady` gates; video starts immediately when surface is ready
- `src/components/editor/preview/nativePreviewScheduler.ts` — Clarified comment about prefetch non-abort behavior (no functional change)
- `src/components/editor/preview/playbackPushBridge.ts` — Removed RAF wrapper from tracking state updates (perf optimization, unrelated to AV-sync)
- `src/core/playback/PlaybackClock.ts` — Added `_playStartMs`, `_nativeAudioUnavailable`, and wall-clock extrapolation path in `time` getter
- `src/core/timeline/audioClips.ts` — Added `.filter(c => Boolean(c.path))` to prevent empty paths from reaching Rust
- `src/hooks/useAudioSyncEngine.ts` — Removed `isActive` guard and `currentSource !== source` check (unclear why)
- `src/lib/platform/nativeCore.ts` — Changed `EMBEDDED_PREVIEW_ONLY` from `true` to env-flag check (enables native surface A/B testing)
- `src/services/telemetryCollector.ts` — Added granular `presenterFallbackReason` codes
- `src/vite-env.d.ts` — Documented all `VITE_CLYPRA_*` env vars (good practice, unrelated to AV-sync)

Full diff: `git diff HEAD` (10 files, +209/-66)

</details>
