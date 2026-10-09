# Implementation Plan: Audio-Video Synchronization at Playback Start

## Root Cause Analysis

After reading the codebase, the root cause is **NOT** as initially hypothesized. The Bug 10 fix already addresses the wall-clock advancement issue. The actual problem is:

**The audio engine initialization takes ~555ms, but the synchronization issue manifests as persistent A/V drift because the initial seek command to align audio with video position occurs BEFORE the CPAL stream is actually ready to accept it.**

### Evidence from Code Exploration:

1. **`PlaybackClock.ts` (L494-508)**: When `play()` is called with `nativeClockAuthority=true`, the clock now correctly captures `_playStartMs` and `_playStartClockTime` for wall-clock extrapolation. This fixes the "video freezes until audio is ready" issue.

2. **`nativeAudioPreviewController.ts` (L478-493)**: The `initialize()` method performs these steps sequentially:
   ```typescript
   await syncNativeAudioTimeline(...)  // Async clip installation
   await configureNativePlayback(...) // Async IPC
   await seekNativeAudio(secondsToTicks(this.clock.time))  // ← Seek happens here
   if (this.clock.state === "playing") {
     const nativeState = await nativePlayFromAudio();
     this.adoptNativePosition(nativeState.audioPositionTicks);
   }
   ```
   The seek command at L488 is issued **before** `nativePlayFromAudio()` starts the CPAL stream. If the stream isn't running yet, the seek target is not properly anchored.

3. **`NativeProgramPreview.tsx` (L3162-3166)**: Video playback path is now independent:
   ```typescript
   const nativePlaybackPath =
     isTauriRuntime() &&
     Boolean(nativePlaybackRequest) &&
     isPlaying;
   ```
   No `nativeAudioClockReady` gate remains (removed in Bug 10). Video starts immediately.

4. **The timing window**: Video starts playing using wall-clock at T=0. Audio initialization completes at T=555ms, then seeks to "current position" (which is 0 from the controller's perspective because it captured `this.clock.time` before play started), but the video has already advanced ~16-18 frames (at 30fps). Audio starts from position 0, video is at position ~555ms → permanent -555ms drift.

### The Real Bug:

The `seekNativeAudio(secondsToTicks(this.clock.time))` call in `initialize()` reads `this.clock.time` which is **the paused position**, not the **current playing position**. By the time the seek completes and `nativePlayFromAudio()` starts the stream, the video has advanced significantly.

## Solution Design

**Option A (Chosen): Read current clock position immediately before starting audio**

In `nativeAudioPreviewController.ts::initialize()`, replace the static seek with a dynamic one that reads `this.clock.time` (which now includes wall-clock extrapolation) immediately before issuing `nativePlayFromAudio()`.

**Why this works:**
- `PlaybackClock.time` getter (L272-296) already returns wall-clock extrapolated time when `_nativeClockAuthority=true` and `_playStartMs > 0`.
- The controller sets `this.clock.setNativeClockAuthority(true)` at L416 before any awaits.
- When `initialize()` reaches the final seek, `this.clock.time` will reflect the actual elapsed wall-clock time since `play()` was called.
- Audio then starts from the video's actual position, not from the stale paused position.

**Option B (Rejected): Defer video start until audio is ready**

This would regress Bug 10 and violate the architectural invariant: "Video playback is independent of audio readiness."

---

## Implementation Steps

- [ ] **1. Fix the initial audio seek position in `nativeAudioPreviewController.ts`**

  **Change:** In the `initialize()` method around L485-493, move the final `seekNativeAudio()` call to **immediately before** `nativePlayFromAudio()` so it reads the live wall-clock extrapolated position, not the stale paused position.

  **Rationale:** The current code reads `this.clock.time` once at the start of the play→initialize sequence (when time is paused), then seeks to that stale value after 555ms of async work. The fix reads `this.clock.time` again immediately before starting the CPAL stream, capturing the wall-clock extrapolation that has been running since `play()` was called.

  **Files:** `src/core/audio/nativeAudioPreviewController.ts`

  **Specific change:**
  ```typescript
  // BEFORE (lines 485-493):
  await seekNativeAudio(secondsToTicks(this.clock.time));  // ← Stale paused position
  await setNativeAudioSpeed(this.clock.speed);
  await setNativeAudioOutput(this.outputVolume, this.outputMuted);
  if (this.disposed) return false;
  if (this.clock.state === "playing") {
    await this.beginStartupProbe();
    const playStartedAt = performance.now();
    const nativeState = await nativePlayFromAudio();
    ...
  }
  
  // AFTER:
  await setNativeAudioSpeed(this.clock.speed);
  await setNativeAudioOutput(this.outputVolume, this.outputMuted);
  if (this.disposed) return false;
  if (this.clock.state === "playing") {
    await this.beginStartupProbe();
    // Read the LIVE clock position (includes wall-clock extrapolation since play())
    const livePosition = this.clock.time;
    await seekNativeAudio(secondsToTicks(livePosition));
    const playStartedAt = performance.now();
    const nativeState = await nativePlayFromAudio();
    ...
  } else {
    // Paused path: use the static paused position
    await seekNativeAudio(secondsToTicks(this.clock.time));
    await pauseNativeAudio();
  }
  ```

  **Verify:** 
  1. `npx tsc --noEmit` — must show zero TS errors
  2. `VITE_CLYPRA_NATIVE_SURFACE=1 pnpm tauri dev` — start playback from T=0, check audio starts synchronized
  3. Check session log: `av_drift.avg_micros` should be near 0, not -555000

---

- [ ] **2. Add the same fix to the "late audio install" path (Bug 9 continuation)**

  **Change:** In `nativeAudioPreviewController.ts::updateSource()` around L300-311, the same pattern exists:
  ```typescript
  if (wasResolving && this.clock.state === "playing" && this.active && !this.disposed) {
    const currentTime = this.clock.time;  // ← This is correct (live position)
    this.enqueueTransport(async () => {
      await seekNativeAudio(secondsToTicks(currentTime));  // ← Already using captured live time
      ...
    }, "seek-then-play");
  }
  ```
  This path is **already correct** because it captures `currentTime` from the live clock before enqueuing. No change needed, but add a comment to document why.

  **Files:** `src/core/audio/nativeAudioPreviewController.ts`

  **Verify:** Read the code to confirm the pattern is correct, add clarifying comment if needed.

---

- [ ] **3. Add the same fix to the play→pause→play transition in `handleClockState()`**

  **Change:** In `nativeAudioPreviewController.ts::handleClockState()` around L586-613, the play transition path:
  ```typescript
  if (state.state === "playing" && previous?.state !== "playing") {
    this.enqueueTransport(async () => {
      await this.beginStartupProbe();
      const seekStartedAt = performance.now();
      await seekNativeAudio(secondsToTicks(this.clock.time));  // ← Reads clock.time inside async callback
      ...
    }, "seek-then-play");
  }
  ```
  
  The `this.clock.time` read happens **inside** the async callback, which is correct — the transport queue may have delay, so reading the live position at execution time (not at enqueue time) is the right behavior.

  **Files:** `src/core/audio/nativeAudioPreviewController.ts`

  **Verify:** Confirm the code is correct; no change needed. Add clarifying comment documenting the timing contract.

---

- [ ] **4. Add telemetry to track the audio initialization latency and the initial seek offset**

  **Change:** In `nativeAudioPreviewController.ts::initialize()`, capture:
  - Time when `initialize()` starts
  - Time when CPAL stream is ready (before `nativePlayFromAudio()`)
  - The delta between paused position and live position at audio start
  - Add these to the existing `initializationUs` field or create a new telemetry event

  **Files:** `src/core/audio/nativeAudioPreviewController.ts`

  **Specific addition:**
  ```typescript
  const initStartMs = performance.now();
  const pausedPosition = this.clock.time;  // Capture before awaits
  // ... existing async initialization work ...
  if (this.clock.state === "playing") {
    const livePosition = this.clock.time;
    const positionDrift = livePosition - pausedPosition;
    // Log or emit telemetry: initializationUs, positionDrift
    await seekNativeAudio(secondsToTicks(livePosition));
    ...
  }
  ```

  **Verify:** Check session logs for the new telemetry fields; confirm `positionDrift` is non-zero (~555ms) before the fix, near-zero after.

---

- [ ] **5. Add test case: Bug 12 — Audio starts from video's actual position, not paused position**

  **Change:** Append a new `describe("Bug 12 — Audio starts at video position after initialization delay")` block to `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`.

  **Test scenario:**
  - Mock `PlaybackClock` with `nativeClockAuthority=true`
  - Mock `syncNativeAudioTimeline` to return after 500ms
  - Call `clock.play()` at T=0
  - Advance wall-clock by 500ms (simulating async initialization)
  - Verify that the seek command issued to CPAL uses `clock.time` (which should be ~500ms via wall-clock extrapolation), not 0

  **Files:** `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`

  **Test structure:**
  ```typescript
  describe("Bug 12 — Audio starts at video position after initialization delay", () => {
    it("FIXED: audio seeks to live wall-clock position, not stale paused position", async () => {
      const clock = new PlaybackClock();
      clock.setDuration(30);
      clock.setFrameRate(30);
      clock.setNativeClockAuthority(true);
      
      // Simulate: user presses play at T=0
      clock.play();
      const playStartMs = performance.now();
      
      // Simulate: audio initialization takes 500ms
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Clock should have advanced via wall-clock extrapolation
      const livePosition = clock.time;
      expect(livePosition).toBeGreaterThan(0.4);  // At least 400ms elapsed
      expect(livePosition).toBeLessThan(0.6);     // Not more than 600ms
      
      // Audio seek should use livePosition, not 0
      // (in the actual fix, this is the value passed to seekNativeAudio)
    });
    
    it("REGRESSION: seek-then-play still works correctly", async () => {
      // Verify that explicit seek→play doesn't break
    });
    
    it("REGRESSION: silent projects still play immediately", () => {
      // Verify that markNativeAudioUnavailable path still works
    });
  });
  ```

  **Verify:** `npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts` — new test must pass.

---

- [ ] **6. Verify the fix with a real session and performance logs**

  **Steps:**
  1. Build and run: `VITE_CLYPRA_NATIVE_SURFACE=1 pnpm tauri dev`
  2. Load a project with audio clips
  3. Press play from T=0
  4. Play for 10 seconds
  5. Check the performance log: `~/Library/Application Support/com.deenminder.clypra/perf_logs/session-*.ndjson`
  6. Extract `av_drift` metrics:
     ```bash
     cat session-*.ndjson | jq 'select(.kind == "native-sync") | .payload.av_drift'
     ```
  7. Verify:
     - `avg_micros` is within ±2000 (±2ms), not -555000
     - `max_micros` is within ±10000 (±10ms)
     - `p95` is within ±5000 (±5ms)

  **Files:** Performance logs (output only, not code changes)

  **Verify:** Session log shows healthy A/V sync metrics.

---

## Edge Cases & Constraints

### Edge Case 1: Seek-then-play (user seeks to T=5s, then plays)

**Behavior:** The clock will be paused at T=5s. When `play()` is called, `_playStartClockTime` is set to 5s. Wall-clock extrapolation starts from 5s. Audio initialization completes after 555ms, reads `clock.time` (now ~5.555s via extrapolation), seeks to 5.555s, starts playing. **This is correct.**

**Test:** Add a test case to Bug 12 describe block verifying this scenario.

### Edge Case 2: Silent projects (no audio clips)

**Behavior:** `syncNativeAudioTimeline()` returns 0 clips. The controller sets `_rendererState = "detached"` and does not call `nativePlayFromAudio()`. Video plays using wall-clock (no audio sync needed). `markNativeAudioUnavailable()` is no longer called (as of Bug 10 fix), but the video path is independent anyway.

**Test:** Verify the existing Bug 8A/8B/10 tests still pass (they cover this).

### Edge Case 3: Rapid seek during audio initialization

**Behavior:** If user seeks while `initialize()` is still in-flight, the `seekIntentRevision` gate in `handleClockState()` will enqueue a new seek command in the transport queue. The old `initialize()` seek will complete, but the new one will supersede it before `nativePlayFromAudio()` starts. **This is correct** — the transport queue is sequential.

**Test:** Add a test case simulating seek during initialization.

### Edge Case 4: Clock already initialized (project switch, replay after completion)

**Behavior:** `dispose()` is called before `initialize()`. The clock authority is released, `_playStartMs` is reset to 0. Next `initialize()` starts fresh. **This is correct.**

**Test:** Verify that replaying after completion works (covered by existing tests).

### Constraint 1: `PlaybackClock.ts` and `nativeAudioPreviewController.ts` are singletons

**Must restart dev server after changes** (per AGENTS.md rule 10). Add this to the verify steps.

### Constraint 2: Never call `invoke()` inside RAF callback for non-frame-essential work

The `seekNativeAudio()` call happens in `initialize()` and `handleClockState()`, both of which are **outside** the RAF render loop. **This is correct.**

### Constraint 3: The test file is append-only

The next describe block is Bug 12 (confirmed by grep: Bug 11 exists at L3203). Append the new test block; never modify existing tests.

---

## Build & Test Commands

```bash
# TypeScript check (must pass before commit)
npx tsc --noEmit

# Run the full render loop test suite (must pass: current baseline is 131 tests, will be ~134 after this fix)
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts

# Dev server with native surface enabled (MUST RESTART after changing PlaybackClock or nativeAudioPreviewController)
VITE_CLYPRA_NATIVE_SURFACE=1 pnpm tauri dev

# Extract A/V sync metrics from the latest session log
ls -lt ~/Library/Application\ Support/com.deenminder.clypra/perf_logs/ | head -2
cat ~/Library/Application\ Support/com.deenminder.clypra/perf_logs/session-*.ndjson | \
  jq -c 'select(.kind == "native-sync") | {avg: .payload.av_drift.avg_micros, p95: .payload.av_drift.p95, max: .payload.av_drift.max_micros}'
```

---

## Files Changed Summary

| File | Change |
|---|---|
| `src/core/audio/nativeAudioPreviewController.ts` | Move `seekNativeAudio()` to read live position before `nativePlayFromAudio()`; add telemetry |
| `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts` | Add Bug 12 describe block with 3 test cases |

---

## Expected Outcome

**Before fix:**
- Initial A/V drift: `-555000µs` (audio lags video by 555ms)
- Drift persists throughout playback
- Session logs show `requested_ticks=0, presented_ticks=0` at T=0, but video already at frame 16

**After fix:**
- Initial A/V drift: `±2000µs` (within 2ms tolerance)
- Drift stays bounded (adaptive drift compensation keeps it within ±10ms)
- Session logs show audio starts at the video's actual position (~555ms after play command)

**Test coverage:**
- Bug 12 describe block with 3 tests
- All existing Bug 8A/8B/9/10/11 tests still pass (no regressions)
- Total test count: 134 (was 131)

---

## Notes

- The Bug 10 fix already solved the "video freezes until audio is ready" issue by making `PlaybackClock.time` advance via wall-clock. This fix completes the synchronization by ensuring audio **joins** the timeline at the correct position, not at the stale paused position.
  
- The `_nativeClockAuthority` flag is set **before** any async work, so `clock.time` can extrapolate during the entire initialization window.
  
- The `seekNativeAudio()` call is an IPC command, not a synchronous CPU operation — it's safe to call it immediately before `nativePlayFromAudio()` without introducing jank.

- The fix applies to three code paths: initial play, late audio install (Bug 9), and play→pause→play. Only the first path needs a change; the other two are already correct but should have clarifying comments added.
