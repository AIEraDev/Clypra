# Deliverable 04: Workarounds, Latches, and Safety Timers (`04-workarounds.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Scope: Every timer, retry, safety timeout, latch, guard flag, or comment containing words like `workaround`, `hack`, `race`, `flash`, `stale`, `TODO`, `FIXME`, or `safety`.  
> Evidence Tags: `[CODE]` (verified in source code), `[GIT]` (verified via git blame / log commit SHA).

---

## Catalog of Workarounds & Latches

### 1. Handover Safety Timer (1000ms Pause-to-Canvas Fallback)
- **Location:** `src/components/editor/preview/NativeProgramPreview.tsx:1406-1415` `[CODE]`
- **What It Guards Against:** Prevents permanent UI deadlock / frozen surface if DOM canvas readback fails to paint after playback pauses. When transitioning from native hardware surface playback to paused state, the native surface remains visible until the first canvas frame paints. If readback stalls, this 1000ms timer forces `hide_native_surface()`.
- **Commit SHA & Message:** `8d388a5e` — `fix(preview): latch native surface during paused readback handover and increase timeout` `[GIT]`
- **Linked Issue / PR:** PR #489 (Preview blanking on pause)
- **Covering Test:** `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts:1105-1285` (`ProgramPreview RAF Loop — Native Surface Early renderInFlight Release`) `[CODE]`

---

### 2. Pause Handover Surface Latch (`pendingHandoverSurfaceHide`)
- **Location:** `src/components/editor/preview/NativeProgramPreview.tsx:1412`, `4402-4415` `[CODE]`
- **What It Guards Against:** Prevents black flash during the transition from native Metal/DX12 surface playback to DOM canvas readback. Latches the native surface visible until `canvasPaintStarted = true` confirms that the first paused frame has physically painted into the HTML5 `<canvas>`.
- **Commit SHA & Message:** `83834cee` — `feat: enforce native UI thread safety (Invariant 16), cold-start frame retention, and preview stability` `[GIT]`
- **Linked Issue / PR:** PR #524 / PR #525 (Native UI thread safety & preview stability)
- **Covering Test:** `src/components/editor/preview/__tests__/previewStateResetContract.test.ts:85` `[CODE]`

---

### 3. Seek Timeout Safety Valve (`SEEK_TIMEOUT_MS = 500ms`)
- **Location:** `src/core/playback/PlaybackClock.ts:50, 878-890` `[CODE]`
- **What It Guards Against:** Prevents playback freeze if native audio/video decoder fails to emit a `completeSeek()` response over Tauri IPC. After 500ms, the clock forcefully clears `_activeSeekId` and resumes normal ticking.
- **Commit SHA & Message:** `c3fef89d` — `fix(playback): prevent audio poll IPC latency from snapping clock backwards during forward playback` `[GIT]`
- **Linked Issue / PR:** PR #472 (Audio-video seek desynchronization)
- **Covering Test:** `src/core/playback/__tests__/PlaybackClock.test.ts:360-410` (`CLY-PERF-001: rejects stale in-flight native audio poll`) `[CODE]`

---

### 4. Wall-Clock Extrapolation Audio Decoupling (`_playStartMs`)
- **Location:** `src/core/playback/PlaybackClock.ts:251-275` `[CODE]`
- **What It Guards Against:** Prevents video playback from freezing while asynchronous audio clips hydrate and decode. The clock extrapolates timeline position from system wall-clock elapsed time (`performance.now()`) until CPAL audio hardware clock updates arrive.
- **Commit SHA & Message:** `dad1f2ae` — `fix: address review findings for audio-video sync` `[GIT]`
- **Linked Issue / PR:** PR #465 (Audio sync drift on clip boundary)
- **Covering Test:** `src/core/playback/__tests__/replayBehavioralContract.test.ts:140` `[CODE]`

---

### 5. Render Loop Closure Guard (`renderInFlight`)
- **Location:** `src/components/editor/preview/NativeProgramPreview.tsx:1400-1430` `[CODE]`
- **What It Guards Against:** Architecture Invariant 7 violation. Ensures asynchronous Tauri `invoke()` calls do not interleave or pile up in the browser event loop if frame rendering takes longer than a 16.6ms rAF budget. Guarded by closure variable `renderInFlight` and reset across all exit paths.
- **Commit SHA & Message:** `f0e31423` — `perf(preview): defer text prewarm 250ms after first frame; newly added clips use background prewarm` `[GIT]`
- **Linked Issue / PR:** PR #501 (Preview frame pacing optimization)
- **Covering Test:** `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts:1241` (`FIXED: renderInFlight released after demand submit`) `[CODE]`

---

### 6. Global Repaint Latch (`_pendingForceRepaint`)
- **Location:** `src/components/editor/preview/NativeProgramPreview.tsx:325-345` `[CODE]`
- **What It Guards Against:** Prevents blank preview canvas when `forceRepaintNativeProgramPreview()` is called before the preview React component has mounted (e.g. during project hydration, modal dismissals, or layout preset switches). Latches the request into a module-level variable until the render loop registers its wake callback.
- **Commit SHA & Message:** `af7a7d87` — `fix(preview): blank canvas on project open / modal close / session switch` `[GIT]`
- **Linked Issue / PR:** PR #480 (Blank preview canvas on open)
- **Covering Test:** `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts:2527` `[CODE]`

---

### 7. Playhead Paint Jitter React Throttling Bypass
- **Location:** `src/components/editor/timeline/Playhead.tsx:80-105` `[CODE]`
- **What It Guards Against:** Bypasses React's 10fps throttled store subscription during playback to eliminate a 113ms paint-jitter observed on Apple Silicon. Directly reads `getPlaybackClock().time` imperatively inside an active `requestAnimationFrame` loop and writes `el.style.left` to the DOM without React re-renders.
- **Commit SHA & Message:** `ae05833c` — `perf(playback): smooth playhead paint, filmstrip prewarm, cross-clip lookahead` `[GIT]`
- **Linked Issue / PR:** PR #512 (Playhead jitter on high refresh rate displays)
- **Covering Test:** `none found` (Manual visual verification on macOS) `[CODE]`

---

### 8. Native Audio Controller Dual-Cadence Polling (33ms vs 250ms)
- **Location:** `src/core/audio/nativeAudioPreviewController.ts:475-495` `[CODE]`
- **What It Guards Against:** Reduces IPC and CPU overhead while paused by throttling position and status polling to 4Hz (250ms), while accelerating polling to ~30Hz (33ms) during active playback.
- **Commit SHA & Message:** `09d1c3a8` — `fix(audio): resolve AU-1 through AU-6 in native audio pipeline` `[GIT]`
- **Linked Issue / PR:** PR #455 (Native audio pipeline stability)
- **Covering Test:** `src/core/audio/__tests__/audioPreviewSyncContract.test.ts:45` `[CODE]`

---

### 9. Idle Surface Auto-Hiding (`hideNativeSurfaceWhenIdle`)
- **Location:** `src/core/runtime/nativeSurfaceLifecycle.ts:67-160` `[CODE]`
- **What It Guards Against:** Prevents native Metal/DX12 OS child window from remaining floating above WebView modals, dialogs, dropdowns, or timeline click targets when playback is stopped.
- **Commit SHA & Message:** `94377852` — `feat(runtime): versioned native-surface coordinator with centralized configure/resize/present/release` `[GIT]`
- **Linked Issue / PR:** PR #510 (Native surface occlusion of dropdowns)
- **Covering Test:** `src/components/editor/preview/__tests__/previewStateResetContract.test.ts:112` `[CODE]`

---

### 10. Desktop Native Surface Readback Test Guard (`isE2EPreviewReadbackTest`)
- **Location:** `src/components/editor/preview/NativeProgramPreview.tsx:1350-1370` `[CODE]`
- **What It Guards Against:** In CI/E2E environments where headless or virtual display servers cannot present native child windows, forces fallback to DOM canvas readback by checking environment variables (`VITE_CLYPRA_NATIVE_SURFACE=0` or `PLAYWRIGHT_TEST`).
- **Commit SHA & Message:** `83834cee` — `feat: enforce native UI thread safety (Invariant 16), cold-start frame retention, and preview stability` `[GIT]`
- **Linked Issue / PR:** PR #524
- **Covering Test:** `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts:1898` `[CODE]`

---

## Summary Statistics

| Metric | Value |
| :--- | :--- |
| **Total Workarounds / Latches Cataloged** | 10 |
| **Safety Timers** | 2 (`handoverSafetyTimer: 1000ms`, `SEEK_TIMEOUT_MS: 500ms`) |
| **State Latches** | 3 (`pendingHandoverSurfaceHide`, `_pendingForceRepaint`, `canvasPaintStarted`) |
| **Concurrency / Closure Guards** | 2 (`renderInFlight`, `renderLoopEpoch`) |
| **Covered by Automated Tests** | 9 / 10 (90%) |
| **Missing Automated Test** | 1 (`Playhead.tsx` rAF DOM left bypass) |
