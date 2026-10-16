# Deliverable 05: Subsystem Contradictions & Dual Truths (`05-contradictions.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Scope: Concrete state disagreements, unreachable state combinations, duplicate sources of truth, dead state flags, and platform execution divergence.  
> Ranked By: Number of user flows impacted.  
> Evidence Tag: `[CODE]` (verified directly against source code at HEAD).

---

## 1. Top Five Highest-Ranked Contradictions

### Rank 1: Triplicate Sources of Playhead Time Position (Touches Flows: 1, 2, 3, 4, 9 — 5 Flows)
- **State Group:** `PlaybackClock._position` vs `PlaybackClock._nativeClockPosition` vs `Playhead.tsx` DOM position.
- **Writers:**
  - `PlaybackClock.ts:580` (`this._position = nextTime` in `PlaybackClock.seek() / tick()`) `[CODE]`
  - `PlaybackClock.ts:398` (`this._nativeClockPosition = position` in `setNativeClockPosition()`, written by CPAL audio thread callback / IPC poll) `[CODE]`
  - `Playhead.tsx:100` (Direct DOM mutation `el.style.left = pos` inside 60fps rAF loop, while React state subscription is throttled to 10fps) `[CODE]`
- **Concrete Disagreement:** During high-speed playback or seeking while playing, the hardware audio clock lags behind wall-clock extrapolation. If an audio poll arrives with an obsolete pre-seek timestamp before native seek finishes, the playhead marker snaps backward visually unless rejected by the `CLY-PERF-001` guard.
- **Evidence:** `src/core/playback/PlaybackClock.ts:251-275, 398-420`, `src/components/editor/timeline/Playhead.tsx:80-105` `[CODE]`.

---

### Rank 2: Asynchronous Transport State Split Between Frontend & Rust (Touches Flows: 1, 3, 4, 9 — 4 Flows)
- **State Group:** Frontend `PlaybackClock._state` (`"playing"`) vs Rust `PlaybackState.is_playing` (`false`).
- **Writers:**
  - `PlaybackClock.ts:603` sets `this._state = "playing"` synchronously on user input `[CODE]`
  - `src/core/audio/nativeAudioPreviewController.ts:506` invokes `nativePlayFromAudio()` to update Rust `PlaybackState` `[CODE]`
  - `src-tauri/src/commands/native_playback.rs:1475` sets Rust `PlaybackState.is_playing = true` asynchronously via IPC `[CODE]`
- **Concrete Disagreement:** When user triggers play, frontend clock starts ticking immediately and advances video time via wall-clock extrapolation (`_playStartMs`). However, Tauri IPC invocation `native_play(app, clock)` incurs cold latency (50–500ms). During this window, the frontend clock claims playback is active while the Rust decode and wgpu presentation pipeline are still idle.
- **Evidence:** `src/core/playback/PlaybackClock.ts:603`, `src/core/audio/nativeAudioPreviewController.ts:506`, `src-tauri/src/commands/native_playback.rs:1475` `[CODE]`.

---

### Rank 3: Surface Visibility Inversion During Pause Handover (Touches Flows: 4, 5, 6 — 3 Flows)
- **State Group:** `nativeDirectSurfacePath` (`false`) vs `nativeSurfaceShown` (`true`).
- **Writers:**
  - `NativeProgramPreview.tsx:3329` (`nativeDirectSurfacePath` evaluated false when `isPlaying` drops) `[CODE]`
  - `NativeProgramPreview.tsx:1412, 4402` (`pendingHandoverSurfaceHide = true` latches `nativeSurfaceShown = true`) `[CODE]`
- **Concrete Disagreement:** When playback pauses, `nativeDirectSurfacePath` turns `false` immediately to switch presenter to DOM canvas. However, `pendingHandoverSurfaceHide` holds the native OS child window (Metal/DX12) visible for up to 1000ms until the canvas paints. If the user clicks a clip during this 1000ms to open `TransformOverlay.tsx`, the native window sits physically above the WebView in OS window layering, occluding the transform handles.
- **Evidence:** `src/components/editor/preview/NativeProgramPreview.tsx:1412, 3329, 4402-4415` `[CODE]`.

---

### Rank 4: Audio Clip Timeline Synchronization Lag (Touches Flows: 6, 8, 9 — 3 Flows)
- **State Group:** `timelineStore.clips` (UI state) vs `nativeAudioPreviewController.activeClips` (Rust CPAL state).
- **Writers:**
  - `src/store/timelineStore.ts:155` (`updateClip` / `removeClip` updates clips instantly in Zustand) `[CODE]`
  - `src/core/audio/nativeAudioTimeline.ts:113` (calls IPC `replaceNativeAudioClips` to synchronize clips to CPAL) `[CODE]`
- **Concrete Disagreement:** Editing a clip (e.g. moving audio or splitting a video clip) during or immediately before playback updates UI state synchronously. Because audio synchronization is asynchronous and queued behind `sourceSyncQueue`, pressing Spacebar immediately plays audio from the old clip positions while preview video renders at the new position.
- **Evidence:** `src/store/timelineStore.ts:153-155`, `src/core/audio/nativeAudioTimeline.ts:105-115` `[CODE]`.

---

### Rank 5: Dead State Flag in NativeProgramPreview (`nativeOnlyBlockersKeyRef`) (Touches Flows: 1, 4 — 2 Flows)
- **State Flag:** `const nativeOnlyBlockersKeyRef = useRef<string>("")`.
- **Declaration:** `src/components/editor/preview/NativeProgramPreview.tsx:628` `[CODE]`
- **Read Site:** `src/components/editor/preview/NativeProgramPreview.tsx:3329` (`!nativeOnlyBlockersKeyRef.current`) `[CODE]`
- **Write Sites:** None found across the entire 5101 lines of `NativeProgramPreview.tsx`.
- **Concrete Disagreement:** The flag is documented as gating native direct surface presentation when non-renderable DOM overlays are active. Because no code path ever sets `.current` to any truthy string, the condition is permanently true, representing dead latch code.
- **Evidence:** `src/components/editor/preview/NativeProgramPreview.tsx:628, 3329` `[CODE]`.

---

## 2. Platform Runtime Behavior Divergence

| Subsystem | Tauri Desktop (macOS / Windows) | Web Canvas / Vitest Runtime | Mobile (Capacitor) | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **Video Surface** | Native OS child window (`NSView` / `HWND`) via Metal / DX12 | HTML5 `<canvas>` via 2D / WebGL readback | DOM canvas readback only | `NativeProgramPreview.tsx:1410` `[CODE]` |
| **Audio Engine** | Rust CPAL 0.18 + rtrb ring buffer + WSOLA | Web Audio API (`AudioContext`) | Web Audio API / Capacitor audio | `nativeAudioPreviewController.ts:120` `[CODE]` |
| **Decode Pipeline** | FFmpeg 8.x + VideoToolbox / DXVA | WebCodecs / HTMLMediaElement fallback | HTMLMediaElement | `nativeCore.ts:110` `[CODE]` |
| **Window Dispatch** | `window.run_on_main_thread()` required (Invariant 16) | Standard browser microtask queue | Capacitor plugin bridge | `native_surface.rs:180` `[CODE]` |
`;

fs.writeFileSync(path.join(REPO_ROOT, "docs/preview-audit/05-contradictions.md"), mdContent, "utf8");
console.log("Wrote 05-contradictions.md successfully.");
