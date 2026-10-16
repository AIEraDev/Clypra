# Preview Subsystem State Catalog

This catalog documents all runtime state variables, React refs, closure flags, and backend atomics governing the Clypra Program Preview subsystem (`v1.6.1`).

---

## 1. Render Loop Closure Variables (`NativeProgramPreview.tsx`)

These variables are declared within the primary `useEffect` render loop closure (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1344-L1408]`). They maintain state across animation frames for the duration of an active project session without triggering React re-renders.

| Variable | Type | Declared Line | Lifecycle & Reset | Accessing / Mutating Call-Sites | Documented Failure Modes & Race Conditions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `renderInFlight` | `boolean` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1346]` | Set `true` at render start; reset in `finally` or early on native path; reset on unmount | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2748]`, `#L3550]`, `#L4470]` | If left `true` upon early return or unhandled rejection, subsequent animation frames are permanently blocked (`[TEST:ProgramPreview.renderLoop.test.ts#Invariant 7]`). |
| `frameScheduled` | `boolean` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1382]` | Set `true` when `requestAnimationFrame` queued; set `false` on tick callback | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2714]`, `#L4482]`, `#L4806]` | Double-RAF dispatch if mutated concurrently with clock subscription events. |
| `forceRenderNeeded` | `boolean` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1347]` | Initialized `true`; set by clock subscriber or seek events; reset after render pass | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2725]`, `#L4620]` | Failure to set prevents frame evaluation during static timeline mutations (clip color, text edits). |
| `nativeSurfaceShown` | `boolean` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1404]` | Set `true` on `first-native-frame-presented`; reset on pause handover completion or error | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1412]`, `#L3457]`, `#L4428]` | Stale `true` value prevents native surface show IPC invocation when resuming playback. |
| `pendingHandoverSurfaceHide` | `boolean` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1405]` | Set `true` on playback pause; set `false` once paused frame paints or watchdog expires | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3335]`, `#L3464]`, `#L4427]` | Race condition where rapid play/pause cycling causes canvas flicker if not cleared upon playback re-entry. |
| `handoverSafetyTimer` | `number \| null` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1406]` | Set to 1000ms timer on pause; cleared on paint completion or playback resumption | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3337]`, `#L3468]`, `#L4424]` | Timer leak if unmount occurs before paint without clearing (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L4808]`). |
| `lastRenderedFrameIndex` | `number` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1348]` | Initialized `-1`; updated after successful frame paint; reset on seek | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2730]`, `#L4435]` | False deduplication skips rendering if clock loops without index change. |
| `lastRenderedEpoch` | `number` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1349]` | Initialized `-1`; tracks timelineStore epoch to detect clip edits | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2775]`, `#L4440]` | Stale epoch renders cached scene after timeline mutation. |
| `nativePlaybackInFlight` | `Promise<void> \| null` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1366]` | Tracks async `submit_native_playback_demand` dispatch | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3540]` | Unhandled promise rejection causes unmonitored drop in playback pacing. |
| `adaptiveReadbackPolicy` | `AdaptiveReadbackPolicy` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1387]` | Instantiated on loop init; reset on resize or quality change | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2780]`, `#L4210]` | Over-throttling on low-tier hardware causes dropped readback frames during scrubbing. |

---

## 2. Component Refs (`NativeProgramPreview.tsx`)

| Ref Name | Type | Declared Line | Purpose | Access Sites |
| :--- | :--- | :--- | :--- | :--- |
| `canvasRef` | `useRef<HTMLCanvasElement \| null>` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L680]` | Reference to HTML5 `<canvas>` backing store for paused and fallback rendering | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1325]`, `#L4380]` |
| `renderStateRef` | `useRef<RenderStateSnapshot>` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L684]` | Synchronous mirror of clips, tracks, transitions, and project settings | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1353]`, `#L2770]` |
| `nativeDisplayedFrameRef` | `useRef<NativePreviewFrame \| null>` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L685]` | Holds the most recently delivered uncompressed frame payload or UNCH target | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2141]`, `#L4390]` |
| `lastPaintedFrameRef` | `useRef<FrameDimensions \| null>` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L690]` | Caches dimensions and pixel buffer of frame currently on canvas | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2155]`, `#L4400]` |
| `nativeSurfaceReadyRevisionRef`| `useRef<number>` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L698]` | Monotonically increasing revision counter signaled by surface controller | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1365]`, `#L3320]` |

---

## 3. Session & Playback Authority (`PlaybackClock.ts`)

| Property | Type | Authority | Mutating Call-Sites | Invariant |
| :--- | :--- | :--- | :--- | :--- |
| `currentTime` | `number` | `PlaybackClock` singleton | `[CODE:src/core/playback/PlaybackClock.ts#L120]` | Invariant 1: Single session authority. Must never be overridden by secondary clock. |
| `state` | `"playing" \| "paused" \| "stopped"` | `PlaybackClock` singleton | `[CODE:src/core/playback/PlaybackClock.ts#L180]` | Determines whether native direct presenter or canvas readback is engaged. |
| `rate` | `number` | `PlaybackClock` singleton | `[CODE:src/core/playback/PlaybackClock.ts#L210]` | Playback speed multiplier (0.5x, 1x, 2x, etc.). |

---

## 4. Backend Rust State & Atomics (`src-tauri/src/commands/native_preview.rs`)

| Symbol | Type | Declared Line | Purpose | Guarding Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| `LAST_PRESENTED_REQUEST` | `RwLock<Option<FrameRequest>>` | `[CODE:src-tauri/src/commands/native_preview.rs#L3919]` | Caches the most recent frame request delivered to native surface | Debug-only `#[cfg(debug_assertions)]` |
| `NativeFrameService` | `Mutex<NativeFrameService>` | `[CODE:src-tauri/src/commands/native_preview.rs#L4903]` | LRU frame cache, UNCH delivery tracking, and decode coordinator | Tokio asynchronous Mutex |
| `NativeSurfaceSession` | `Mutex<Option<SurfaceContext>>` | `[CODE:src-tauri/src/commands/native_preview.rs#L4650]` | OS child window handle, swapchain, and wgpu Device/Queue | Tokio asynchronous Mutex + Main thread dispatch |
| `DXGI_RUNTIME_DISABLED` | `AtomicBool` | `[CODE:src-tauri/src/wgpu_compositor/adapter_selector.rs#L45]` | Latch disabling DX12 shared texture import on repeated driver failure | Sequential consistency AtomicBool |
