# Program Preview Render Loop — Developer Guide

> **Primary file:** [`src/components/editor/preview/NativeProgramPreview.tsx`](../../src/components/editor/preview/NativeProgramPreview.tsx) (~5000 lines)  
> **Test file:** [`src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`](../../src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts) (106 tests)

This guide explains how the render loop works, what every major variable tracks, how to add fixes safely, and what invariants must be maintained.

---

## File Layout

```
NativeProgramPreview.tsx
├── L1    – L350    Module-level helpers and constants
│                   getWebViewReadbackLimit(), capWebViewRenderTarget(),
│                   NATIVE_BACKGROUND_MEDIA_LAYER_ID, etc.
├── L351  – L560    Module-level tracking state (shared across renders)
│                   hasRecordedTimelineEvaluate, lastRenderLoopError, etc.
├── L561  – L1303   Component state, refs, and effects
│                   useNativeSurfaceController hook wiring,
│                   telemetryCollector init, clock subscription setup
├── L1304 – L4663   ★ Main Tauri render loop useEffect ★
│   ├── L1331–L1410    Closure variables (reset per project open)
│   ├── L1411–L2709    Helper functions defined inside the effect
│   ├── L2710–L2770    renderLoop() preamble: mightNeedRender, renderTarget
│   ├── L2771–L2915    syncPreviewMedia (gated by needsSync — Bug 3 fix)
│   ├── L2916–L3030    evaluateTimelineSceneCached + rasterize pipeline
│   ├── L3031–L3260    NativeFrameRequest construction
│   ├── L3261–L3462    Path selection (native direct / native readback / bridge)
│   ├── L3463–L3600    Native surface dispatch (Bug 1 fix: early renderInFlight release)
│   ├── L3601–L4200    Bridge / readback path
│   ├── L4200–L4520    finally block: seek completion, scheduleNextFrame (Bug 2 fix)
│   └── L4520–L4663    Clock subscriber, watchdog, cleanup
└── L4663 – L4995   Additional effects and JSX
```

---

## Closure Variables

These variables live inside the `useEffect` closure. They persist across RAF ticks for the lifetime of the project session. They are **not React state** — mutating them does not trigger re-renders.

| Variable | Type | Reset trigger | Purpose |
|---|---|---|---|
| `renderInFlight` | `boolean` | Effect cleanup | Prevents concurrent render iterations. **Must be released early on native path.** |
| `frameScheduled` | `boolean` | Per tick | Prevents double-RAF. Set `true` when RAF is pending, `false` when callback fires. |
| `nativeSurfaceShown` | `boolean` | Effect cleanup | Whether `show_surface()` has been called. Used to avoid redundant show calls. |
| `lastNativePlaybackRequestKey` | `string \| null` | Seek / epoch change | Deduplicates consecutive identical demands on native path. |
| `nativePlaybackInFlight` | `boolean` | Per paused-seek completion | Guards the paused-seek IPC path against overlap. |
| `lastRenderedFrameIndex` | `number` | Seek | Frame deduplication on bridge path. |
| `lastRenderedEpoch` | `string` | Project open | Detects timeline changes. |
| `adaptiveReadbackPolicy` | `AdaptiveReadbackPolicy` | Effect cleanup | WebView FPS/resolution throttle. Only consulted on bridge path. |
| `targetGeneration` | `number` | Seek / epoch | Cancel token for in-flight IPC calls. Increment to invalidate stale work. |
| `forceRenderNeeded` | `boolean` | Per tick | Forces a render even when no tracked signals changed. Set by clock subscriber. |

---

## Invariants

### 1. `renderInFlight` must always be released

If `renderInFlight` is left `true` after a render iteration, the RAF is permanently blocked until the session ends. Every code path through `renderLoop()` must either:
- Return early **before** setting `renderInFlight = true` (no-op paths)
- Release `renderInFlight = false` **before** returning (early release — native path)
- Let the `finally` block release it (blocking paths)

```ts
// ✅ Correct: early release on native path (Bug 1 fix)
if (persistentNativePlaybackEligible) {
  void submitNativePlaybackDemand(...);
  renderInFlight = false;
  scheduleNextFrame();
  return; // finally still runs for tracing, but renderInFlight is already false
}

// ✅ Correct: finally block for blocking paths
try {
  await presentNativePlaybackFrame(...);
} finally {
  renderInFlight = false;
  scheduleNextFrame();
}
```

### 2. `scheduleNextFrame()` must be called exactly once per iteration

`scheduleNextFrame()` calls `requestAnimationFrame()` if no frame is already scheduled. Calling it twice per iteration is harmless (guarded by `frameScheduled`), but forgetting to call it stops the render loop entirely.

**Always call `scheduleNextFrame()` in the `finally` block**, plus optionally earlier on fast paths.

### 3. Never use `setTimeout` for frame scheduling

`setTimeout` is not VSync-aligned. Use `requestAnimationFrame` (via `scheduleNextFrame()`) always. This was Bug 2.

### 4. `syncPreviewMedia` must be gated by `needsSync`

`syncPreviewMedia` drives `PreviewPlaybackScheduler.reconcile()` — O(n×clips) per call. During steady playback no tracked signals change between frames. Gate it:

```ts
const needsSync = epochChanged || playbackStateChanged || isFirstFrame ||
  clipsChanged || tracksChanged || transitionsChanged || projectChanged;

if (needsSync && typeof capturedSession.syncPreviewMedia === "function") {
  capturedSession.syncPreviewMedia(...);
}
```

### 5. `adaptiveReadbackPolicy` is only valid on the bridge path

The policy is consulted at L3468–3470:

```ts
(!nativeReadbackFallbackPath ||
  !isPlaying ||
  adaptiveReadbackPolicy.canDispatchPlayback())
```

This guard is `true` (always permits) when `nativeReadbackFallbackPath = false` (i.e., the native surface path). Never move the policy check outside this guard.

### 6. `targetGeneration` must be incremented on seek or epoch change

`targetGeneration` is the cancel token for in-flight IPC calls. Stale work checks `isCurrent(generation)` before committing its result. If you forget to increment on seek, stale frames from before the seek can overwrite the new frame.

---

## Path Selection Reference

```ts
const nativeSurfaceUsable: boolean =
  surfaceReady &&
  !qualificationForcesWebView &&
  !EMBEDDED_PREVIEW_ONLY;

const nativeSurfaceCanOwnPlayback: boolean =
  nativeSurfaceUsable &&
  geometrySettled &&
  !nativePlaybackRenderFailed;

const nativeDirectSurfacePath = nativeSurfaceCanOwnPlayback; // full native
const nativeReadbackFallbackPath =                           // native but needs readback
  nativeSurfaceUsable && !nativeDirectSurfacePath;
// else: full bridge path (EMBEDDED_PREVIEW_ONLY or surface unavailable)
```

### Playing on native direct path

```
submitNativePlaybackDemand() → Rust NativeRenderSession → Metal present
                             ↑ fire-and-forget, renderInFlight released immediately
```

### Paused on native direct path

```
presentNativePlaybackFrame() → Tauri IPC → Rust render → Metal present
                             ↑ blocking await, renderInFlight released in finally
```

### Bridge (fallback) path

```
NativePreviewFrameScheduler.requestVisible() → Tauri IPC → renderNativeFrame
  → RGBA buffer → postMessage → drawNativeFrameToCanvas (putImageData)
  ↑ blocking await, rate-limited by AdaptiveReadbackPolicy
```

---

## How to Add a New Fix Safely

1. **Understand which path is affected.** Is it native-direct, native-readback, or bridge? Check the path selection variables above.

2. **Locate the fix in the loop's section map** (see File Layout above). Most native-path work is in L3463–3600.

3. **Check `renderInFlight` release.** If your change adds an `await`, make sure every exit path releases `renderInFlight`. Use the `finally` block or explicit early release.

4. **Write the test first.** Add a `describe` block to `ProgramPreview.renderLoop.test.ts`. The existing Bug 1–6 tests are the reference. Name tests `"FIXED: ..."` or `"REGRESSION: ..."` and include a comment explaining the root cause.

5. **Run the full suite before and after.**
   ```bash
   npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts
   ```

6. **Do not introduce `setTimeout` for timing.** Use `requestAnimationFrame` or a `setInterval` watchdog via `armWatchdog()`.

---

## The `AdaptiveReadbackPolicy` — Quick Reference

**File:** [`adaptiveReadbackPolicy.ts`](../../src/components/editor/preview/adaptiveReadbackPolicy.ts)

```
Tiers:   [0]320px  [1]480px  [2]600px  [3]720px  [4]840px  [5]960px
FPS cap:    15       24       30        30        60        60
```

**Degradation:** 3 slow readbacks (>9ms) → drop one tier (lower resolution + lower FPS cap)  
**Recovery:** 30 fast readbacks (<9ms) → recover one tier

**Platform defaults** (from `defaultEmbeddedReadbackLimit()`):
- Windows: 480px → tier 1 → 24fps cap
- macOS ≤4 cores: 720px → tier 3 → 30fps cap
- macOS: 960px → tier 5 → 60fps cap

**This policy does not apply to the native surface path.**

---

## `NativePreviewFrameScheduler` — Quick Reference

**File:** [`nativePreviewScheduler.ts`](../../src/components/editor/preview/nativePreviewScheduler.ts)

The scheduler coordinates visible (user-requested) IPC calls with prefetch work for nearby frames.

| Method | Behaviour |
|---|---|
| `requestVisible(source)` | Returns a promise for the given frame. Cancels in-flight **visible** work for stale keys. Does NOT cancel in-flight **prefetch** work (Bug 5 fix). |
| `prefetch(sources[])` | Queues low-priority loads for nearby frames. Skipped if a visible load is pending or in-flight. |
| `setVisibleGeneration(n)` | Invalidates all queued work after a seek or epoch change. |
| `getCached(key)` | Synchronous cache lookup. Returns null on miss. |
| `dispose()` | Aborts all in-flight work. Rejects all pending promises. |

**Cancellation contract:**
- In-flight **visible** → aborted via `AbortController.abort()` when superseded
- In-flight **prefetch** → NOT aborted; completes and lands in cache
- **Pending visible** → rejected via `replacePending()` (DOMException AbortError, no signal)

---

## `PlaybackPushBridge` — Quick Reference

**File:** [`playbackPushBridge.ts`](../../src/components/editor/preview/playbackPushBridge.ts)

The push bridge receives binary frame packets sent directly from Rust over a push channel (no IPC request/response). Used on the bridge path during continuous playback.

```ts
receive(buffer: ArrayBuffer): boolean
  // Parses packet, calls paint(), updates tracking state SYNCHRONOUSLY (Bug 6 fix)
  // Returns false if generation doesn't match (stale packet from previous playback session)

flushWatermark(): void
  // Sends consumed delivery seq and painted frame ID back to Rust
  // Called on: first frame, every watermarkFrameInterval frames, or every watermarkIntervalMs
```

> [!WARNING]
> Do NOT wrap tracking state updates in `requestAnimationFrame` inside `receive()`. They are pure JS bookkeeping (no DOM access) and the extra RAF competes with the main render loop for VSync slots (Bug 6).

---

## Telemetry Emitted by the Render Loop

| Event | When | Key fields |
|---|---|---|
| `telemetryCollector.recordNativeFrame()` | Every native-surface present | `presenterMode`, `decodeUs`, `renderUs`, `presentUs` |
| `telemetryCollector.recordSeekSpan()` | Seek completion | `seekLatencyMs`, `isCold` |
| `telemetryCollector.recordFrameAnomaly()` | Frame interval > 1.5× nominal | `renderedFps`, `intervalMs` |
| `app.emit("native-playback-stats")` | Every 60 rendered frames (Rust) | `fps`, `hit_rate_percent`, `avg_total_ms` |

The `presenterFallbackReason` is set once per session at path selection (L3303–3320) and included in every telemetry event for that session.
