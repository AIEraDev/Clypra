# Deliverable 02: Owners & Call Sites (`02-owners.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Scope: Exact call sites (`path:line`), enclosing functions, distinct writer modules, and architectural capability boundaries.  
> Evidence Tag: `[CODE]` (verified directly against source tree at HEAD).

---

## Capability 1: Starting, Stopping, Seeking, or Ticking the Playback Clock

The canonical session clock is implemented in `src/core/playback/PlaybackClock.ts`. Transport calls (`play`, `pause`, `stop`, `seek`, `tick`) are executed at the following sites:

| Call Site | Enclosing Function / Scope | Operation | Evidence |
| :--- | :--- | :--- | :--- |
| `src/core/playback/ProgramPlaybackContext.ts:20` | `ProgramPlaybackContext.play()` | `this.clock.play()` | `[CODE]` |
| `src/core/playback/ProgramPlaybackContext.ts:24` | `ProgramPlaybackContext.pause()` | `this.clock.pause()` | `[CODE]` |
| `src/core/playback/ProgramPlaybackContext.ts:28` | `ProgramPlaybackContext.stop()` | `this.clock.stop()` | `[CODE]` |
| `src/core/playback/ProgramPlaybackContext.ts:32` | `ProgramPlaybackContext.seek(time)` | `this.clock.seek(time)` | `[CODE]` |
| `src/hooks/usePlaybackClock.ts:101` | `usePlaybackControls.play()` | `clock.play()` | `[CODE]` |
| `src/hooks/usePlaybackClock.ts:102` | `usePlaybackControls.pause()` | `clock.pause()` | `[CODE]` |
| `src/hooks/usePlaybackClock.ts:103` | `usePlaybackControls.stop()` | `clock.stop()` | `[CODE]` |
| `src/hooks/usePlaybackClock.ts:104` | `usePlaybackControls.seek(time)` | `clock.seek(time)` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:5033` | `ConnectedProgramTransport.onPlayPause` | `transportPause() : transportPlay()` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:5037` | `ConnectedProgramTransport.onSeek` | `transportSeek(...)` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:5060` | `ConnectedProgramTransport.onStepBack` | `transportSeek(...)` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:5068` | `ConnectedProgramTransport.onStepForward` | `transportSeek(...)` | `[CODE]` |
| `src/components/editor/timeline/Playhead.tsx:46` | `useTransportControls()` binding | `transportSeek` | `[CODE]` |
| `src-tauri/src/commands/native_playback.rs:1078` | `set_audio_playing` | `clock.pause()` | `[CODE]` |
| `src-tauri/src/commands/native_playback.rs:1475` | `native_play` | `clock.advance()` | `[CODE]` |
| `src-tauri/src/commands/native_playback.rs:1489` | `native_pause` | `clock.pause()` | `[CODE]` |
| `src-tauri/src/commands/native_playback.rs:1503` | `native_seek` | `clock.seek()` | `[CODE]` |
| `src-tauri/src/commands/native_playback.rs:1551` | `native_tick` | `clock.tick()` | `[CODE]` |

- **Distinct Modules Performing Clock Mutation:** 4 (`ProgramPlaybackContext.ts`, `usePlaybackClock.ts`, `NativeProgramPreview.tsx`, `native_playback.rs`).

---

## Capability 2: Calling Show, Hide, Present, or Resize on the Native Surface & DOM Canvas Writes

### Native Surface Operations (IPC & Lifecycles)
| Call Site | Enclosing Function / Scope | Operation | Evidence |
| :--- | :--- | :--- | :--- |
| `src/core/runtime/nativeSurfaceLifecycle.ts:94, 137-138` | `configureNativeSurface()` | `probeNativeSurface` / `resizeNativeSurface` | `[CODE]` |
| `src/core/runtime/nativeSurfaceLifecycle.ts:67` | `hideNativeSurfaceWhenIdle()` | `hideNativeSurface` | `[CODE]` |
| `src/components/editor/preview/useNativeSurfaceController.ts:145` | `syncSurfaceGeometry()` | `resize_native_surface` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:1425` | `renderLoop()` | `present_native_frame` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:4412` | `handoverSurfaceHide()` | `hide_native_surface` | `[CODE]` |
| `src-tauri/src/commands/native_surface.rs:634` | `probe_native_surface` | Surface probe & creation | `[CODE]` |
| `src-tauri/src/commands/native_surface.rs:669` | `resize_native_surface` | OS window resize | `[CODE]` |
| `src-tauri/src/commands/native_surface.rs:704` | `hide_native_surface` | Set visibility false | `[CODE]` |
| `src-tauri/src/commands/native_preview.rs:4840` | `present_native_frame` | wgpu swapchain present | `[CODE]` |

### DOM Canvas Writes (Web Canvas Fallback & Readback)
| Call Site | Enclosing Function / Scope | Operation | Evidence |
| :--- | :--- | :--- | :--- |
| `src/components/editor/preview/NativeProgramPreview.tsx:2410` | `paintReadbackFrameToCanvas()` | `ctx.drawImage(frameBitmap, 0, 0)` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:2425` | `paintReadbackFrameToCanvas()` | `ctx.putImageData(imageData, 0, 0)` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:2435` | `clearCanvas()` | `ctx.clearRect(0, 0, width, height)` | `[CODE]` |
| `src/components/editor/preview/canvasBackground.ts:42` | `drawCanvasBackground()` | `ctx.fillRect(0, 0, w, h)` | `[CODE]` |

- **Distinct Modules Performing Surface/Canvas Mutation:** 6 (`nativeSurfaceLifecycle.ts`, `useNativeSurfaceController.ts`, `NativeProgramPreview.tsx`, `canvasBackground.ts`, `native_surface.rs`, `native_preview.rs`).

---

## Capability 3: Starting, Stopping, or Re-syncing Native Audio

Native audio preview is managed by `src/core/audio/nativeAudioPreviewController.ts` interfacing with Rust CPAL via Tauri IPC commands in `src-tauri/src/commands/native_audio.rs`:

| Call Site | Enclosing Function / Scope | Operation | Evidence |
| :--- | :--- | :--- | :--- |
| `src/core/audio/nativeAudioPreviewController.ts:250` | `NativeAudioPreviewController.play()` | `start_native_audio` | `[CODE]` |
| `src/core/audio/nativeAudioPreviewController.ts:285` | `NativeAudioPreviewController.pause()` | `pause_native_audio` | `[CODE]` |
| `src/core/audio/nativeAudioPreviewController.ts:312` | `NativeAudioPreviewController.stop()` | `stop_native_audio` | `[CODE]` |
| `src/core/audio/nativeAudioPreviewController.ts:340` | `NativeAudioPreviewController.seek(time)` | `seek_native_audio` | `[CODE]` |
| `src/core/audio/nativeAudioPreviewController.ts:415` | `NativeAudioPreviewController.syncClips()` | `replace_native_audio_clips` | `[CODE]` |
| `src/core/playback/AudioPreviewSyncEngine.ts:88` | `AudioPreviewSyncEngine.checkSync()` | Drift measurement & seek resync | `[CODE]` |
| `src-tauri/src/commands/native_audio.rs:29` | `start_native_audio` | CPAL stream play | `[CODE]` |
| `src-tauri/src/commands/native_audio.rs:70` | `pause_native_audio` | CPAL stream pause | `[CODE]` |
| `src-tauri/src/commands/native_audio.rs:110` | `seek_native_audio` | Ring buffer seek | `[CODE]` |
| `src-tauri/src/commands/native_audio.rs:209` | `replace_native_audio_clips` | Clip timeline reload | `[CODE]` |

- **Distinct Modules Performing Audio Mutation:** 3 (`nativeAudioPreviewController.ts`, `AudioPreviewSyncEngine.ts`, `native_audio.rs`).

---

## Capability 4: Creating a Render Request or Demand (Frontend & Rust)

Frame requests originate from user timeline navigation or clock ticks, and pass through demand dispatchers:

| Call Site | Enclosing Function / Scope | Operation | Evidence |
| :--- | :--- | :--- | :--- |
| `src/components/editor/preview/NativeProgramPreview.tsx:1450` | `renderLoop()` | `render_native_preview_frame` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:1620` | `requestPausedReadback()` | `render_native_preview_frame` | `[CODE]` |
| `src/components/editor/preview/nativePreviewScheduler.ts:125` | `schedulePreviewRender()` | `requestNativePreviewRender` | `[CODE]` |
| `src/core/playback/PreviewPlaybackScheduler.ts:180` | `PreviewPlaybackScheduler.requestFrame()` | Frame allocation request | `[CODE]` |
| `src-tauri/src/commands/native_playback.rs:1448` | `submit_native_playback_demand` | Rust frame demand submission | `[CODE]` |
| `src-tauri/src/commands/native_preview.rs:2090` | `render_native_preview_frame` | Rust async preview compositor render | `[CODE]` |
| `src-tauri/src/commands/native_preview.rs:2329` | `render_native_project_frame` | Full project frame render | `[CODE]` |
| `src-tauri/src/wgpu_compositor/frame_scheduler.rs:280` | `FrameScheduler.schedule_frame()` | Hardware queue dispatch | `[CODE]` |

- **Distinct Modules Creating Demands:** 5 (`NativeProgramPreview.tsx`, `nativePreviewScheduler.ts`, `PreviewPlaybackScheduler.ts`, `native_playback.rs`, `native_preview.rs`).

---

## Capability 5: Changing the Playhead Position in Any Store

In strict adherence to Clypra **Architecture Invariant 1** (*Single Time Source: PlaybackClock.ts is the sole session authority for playback position. Never create secondary clocks*):

- **Zustand Stores (`uiStore.ts`, `timelineStore.ts`, `projectStore.ts`):** **0 writers.** No store holds or mutates playhead position.
- **Component DOM Writers:** `src/components/editor/timeline/Playhead.tsx:100` reads `getPlaybackClock().time` imperatively inside an active rAF loop and directly mutates `el.style.left` without triggering React re-renders.
- **Clock Singleton:** All position state changes occur strictly in `PlaybackClock.ts` via `this._position` (`seek`, `tick`, or CPAL audio callback `setNativeClockPosition`).

| Store / Component | Line | Writer Action | Evidence |
| :--- | :--- | :--- | :--- |
| `src/store/timelineStore.ts` | Lines 1–2329 | No playhead position fields exist | `[CODE]` |
| `src/store/uiStore.ts` | Lines 1–323 | No playhead position fields exist | `[CODE]` |
| `src/store/projectStore.ts` | Lines 1–1964 | No playhead position fields exist | `[CODE]` |
| `src/components/editor/timeline/Playhead.tsx` | Line 100 | Direct DOM mutation (`el.style.left`) from `clock.time` | `[CODE]` |
| `src/core/playback/PlaybackClock.ts` | Line 580 | `this._position = nextTime` | `[CODE]` |

- **Distinct Modules Mutating Store Playhead:** **0** (stores do not hold playhead).
- **Distinct Modules Mutating PlaybackClock Position:** **1** (`src/core/playback/PlaybackClock.ts`).

---

## Capability 6: Calling `hideNativeSurfaceWhenIdle` or `forceRepaintNativeProgramPreview`

These two critical synchronization triggers ensure that the native hardware child window drops beneath the DOM during idle editing and that canvas/preview repaints occur immediately on layout/project changes:

| Call Site | Enclosing Function / Scope | Function Called | Evidence |
| :--- | :--- | :--- | :--- |
| `src/components/editor/timeline/Timeline.tsx:129` | `handleTimelineClick` | `hideNativeSurfaceWhenIdle()` | `[CODE]` |
| `src/components/editor/timeline/Timeline.tsx:131` | `handleTimelineClick` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/transform/TransformOverlay.tsx:608` | `handlePointerDown` | `hideNativeSurfaceWhenIdle()` | `[CODE]` |
| `src/components/editor/transform/TransformOverlay.tsx:610` | `handlePointerDown` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/store/uiStore.ts:275` | `openSettingsModal()` | `hideNativeSurfaceWhenIdle()` | `[CODE]` |
| `src/store/uiStore.ts:286` | `toggleExportModal()` | `hideNativeSurfaceWhenIdle()` | `[CODE]` |
| `src/store/projectStore.ts:1726` | `closeProject()` | `hideNativeSurfaceWhenIdle()` | `[CODE]` |
| `src/store/projectStore.ts:668` | `loadProject()` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/screens/EditorScreen.tsx:40` | `onLayoutMount` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/TopBar.tsx:67` | `handleProjectTitleChange` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/layout/LayoutPresetMenu.tsx:28` | `selectPreset` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:610` | `onSessionChange` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:637` | `onAspectChange` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:791` | `onQualityChange` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:823` | `onTimelineEpochChange` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:831` | `onClipSelectionChange` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/preview/NativeProgramPreview.tsx:1105` | `useNativeSurfaceController.onSurfaceReady` | `forceRepaintNativeProgramPreview()` | `[CODE]` |
| `src/components/editor/preview/nativeTextPreview.ts:380` | `invalidateTextCache()` | `forceRepaintNativeProgramPreview()` | `[CODE]` |

- **Distinct Modules Calling `hideNativeSurfaceWhenIdle`:** 4 (`Timeline.tsx`, `TransformOverlay.tsx`, `uiStore.ts`, `projectStore.ts`).
- **Distinct Modules Calling `forceRepaintNativeProgramPreview`:** 8 (`Timeline.tsx`, `TransformOverlay.tsx`, `projectStore.ts`, `EditorScreen.tsx`, `TopBar.tsx`, `LayoutPresetMenu.tsx`, `NativeProgramPreview.tsx`, `nativeTextPreview.ts`).

---

## Architectural Ownership Summary Table

| Capability | Total Call Sites | Number of Distinct Writer Modules | Multiple Modules? | Primary Owner Module |
| :--- | :---: | :---: | :---: | :--- |
| **1. Playback Clock Mutation** | 18 | 4 | **Yes** | `src/core/playback/PlaybackClock.ts` |
| **2. Native Surface / Canvas Mutation** | 13 | 6 | **Yes** | `src/components/editor/preview/NativeProgramPreview.tsx` |
| **3. Native Audio Transport & Sync** | 10 | 3 | **Yes** | `src/core/audio/nativeAudioPreviewController.ts` |
| **4. Render Demand Creation** | 8 | 5 | **Yes** | `src/components/editor/preview/NativeProgramPreview.tsx` |
| **5. Store Playhead Mutation** | 0 | 0 | **No** (stores do not hold playhead) | None (sole authority is `PlaybackClock.ts`) |
| **6. Surface Idle Hide & Force Repaint** | 18 | 9 | **Yes** | Split across UI dialogs, timeline interactions, and layout presets |
