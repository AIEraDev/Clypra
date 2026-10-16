# Deliverable 00: Subsystem Inventory (`00-inventory.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Total In-Scope Files: **109**  

## Top 10 Largest Files in Scope

| Rank | File Path | Line Count | Importers | Primary Responsibility |
| :---: | :--- | :---: | :---: | :--- |
| 1 | `src-tauri/src/commands/native_preview.rs` | 5988 | 0 | Tauri IPC command endpoints for native frame rendering, raster caches, and session telemetry |
| 2 | `src/components/editor/preview/NativeProgramPreview.tsx` | 5101 | 7 | Main desktop video preview surface, render loop coordination, presenter selection, and transport bindings |
| 3 | `src/components/editor/transform/TransformOverlay.tsx` | 2591 | 1 | Interactive canvas overlay rendering clip bounding boxes, transform handles, and aspect-locked scaling |
| 4 | `src/store/timelineStore.ts` | 2329 | 64 | Zustand store managing tracks, clips, transitions, gaps, and timeline mutation epoch |
| 5 | `src-tauri/src/commands/native_playback.rs` | 2294 | 0 | Tauri IPC command endpoints for Rust playback session configuration, demands, and play/pause/seek |
| 6 | `src/store/projectStore.ts` | 1964 | 47 | Zustand store managing project identity, persistence, aspect ratio, frame rate, and asset manifest |
| 7 | `src/lib/platform/tauri.ts` | 1653 | 41 | Exports isTauriRuntime, NativeMediaStream, AudioExtractionRequest |
| 8 | `src/core/runtime/ProjectSession.ts` | 1593 | 17 | Engine session coordinator binding timeline store, evaluated scene cache, and compositor instance |
| 9 | `src/components/editor/preview/nativeVideoPreview.ts` | 1492 | 7 | Low-level video frame bridge converting engine frames to native raster packets and DOM textures |
| 10 | `src/store/themeRegistry.ts` | 1391 | 1 | Exports UI_THEME_IDS, CLIP_PALETTE_IDS, isUiTheme |

## Circular Import Analysis

Detected via `npx -y madge --circular --extensions ts,tsx src/` across the repository root:

1. `src/components/editor/preview/NativeProgramPreview.tsx` ↔ `src/components/editor/preview/nativeTextPreview.ts`
   - *Cause:* `NativeProgramPreview` imports text rendering routines while `nativeTextPreview` imports `forceRepaintNativeProgramPreview` to trigger invalidations.
2. `src/core/playback/PreviewPlaybackScheduler.ts` ↔ `src/core/resources/PreviewMediaPool.ts`
   - *Cause:* Scheduler requests pool frame allocation while media pool queries active scheduler demands.
3. `src/lib/platform/tauri.ts` ↔ `src/lib/platform/nativeCore.ts`
   - *Cause:* `tauri.ts` wraps IPC invokes with typing from `nativeCore.ts`, while `nativeCore.ts` calls `invokeTauriCommand` from `tauri.ts`.
4. `src/store/timelineStore.ts` → `src/store/middleware/autoSaveMiddleware.ts` → `src/store/projectStore.ts` → `src/store/timelineStore.ts`
   - *Cause:* Timeline mutations trigger auto-save middleware which accesses projectStore to write project metadata, while projectStore references timelineStore for project hydration.
5. `src/store/middleware/autoSaveMiddleware.ts` ↔ `src/store/projectStore.ts`
   - *Cause:* Direct mutual dependency between auto-save persistence hook and project store root.

## Complete In-Scope File Inventory

| Path | Lines | Direct Importers | One-Line Responsibility (from exports/imports) |
| :--- | :---: | :---: | :--- |
| `crates/clypra-native-core/src/font_registry.rs` | 350 | 0 | Internal runtime helper |
| `crates/clypra-native-core/src/glyph_cache.rs` | 712 | 0 | Internal runtime helper |
| `crates/clypra-native-core/src/lib.rs` | 106 | 0 | Internal runtime helper |
| `crates/clypra-native-core/src/sdf.rs` | 186 | 0 | Internal runtime helper |
| `src-tauri/src/commands/native_audio.rs` | 519 | 0 | Tauri IPC command endpoints for CPAL audio playback stream, volume, speed, and clip buffer loading |
| `src-tauri/src/commands/native_playback.rs` | 2294 | 0 | Tauri IPC command endpoints for Rust playback session configuration, demands, and play/pause/seek |
| `src-tauri/src/commands/native_preview.rs` | 5988 | 0 | Tauri IPC command endpoints for native frame rendering, raster caches, and session telemetry |
| `src-tauri/src/commands/native_surface.rs` | 869 | 0 | Tauri IPC command endpoints for native window child surface creation, resizing, and probing |
| `src-tauri/src/commands/playback_push_mailbox.rs` | 318 | 0 | Zero-copy lock-free mailbox for streaming push frames from Rust to native compositor |
| `src-tauri/src/wgpu_compositor/frame_scheduler.rs` | 609 | 0 | Rust wgpu compositor frame scheduler coordinating presentation pacing and frame deadlines |
| `src/components/editor/preview/adaptiveReadbackPolicy.ts` | 166 | 1 | Dynamic readback resolution and throttle policy adapting to system frame rate and load |
| `src/components/editor/preview/AspectSelector.tsx` | 125 | 1 | Exports AspectSelector |
| `src/components/editor/preview/AudioSourcePreview.tsx` | 45 | 1 | Exports AudioSourcePreview |
| `src/components/editor/preview/canvasBackground.ts` | 103 | 3 | Exports getCanvasBackgroundLayer |
| `src/components/editor/preview/ImageSourcePreview.tsx` | 19 | 1 | Exports ImageSourcePreview |
| `src/components/editor/preview/nativePreviewScheduler.ts` | 237 | 1 | Frontend frame tick scheduler coordinating rAF loops and IPC render requests |
| `src/components/editor/preview/NativeProgramPreview.tsx` | 5101 | 7 | Main desktop video preview surface, render loop coordination, presenter selection, and transport bindings |
| `src/components/editor/preview/nativeStickerPreview.ts` | 244 | 3 | Sticker asset raster loader and composition coordinator |
| `src/components/editor/preview/nativeTextPreview.ts` | 1306 | 3 | Text effect and template preview rasterizer interfacing with SDF font engine and cache |
| `src/components/editor/preview/nativeVideoPreview.ts` | 1492 | 7 | Low-level video frame bridge converting engine frames to native raster packets and DOM textures |
| `src/components/editor/preview/playbackPushBridge.ts` | 167 | 1 | Exports PlaybackPushWatermark, PlaybackPushPacket, PlaybackPushBridgeOptions |
| `src/components/editor/preview/PlaybackQualitySelector.tsx` | 105 | 0 | Exports PlaybackQualitySelector |
| `src/components/editor/preview/PlaybackSpeedSelector.tsx` | 77 | 1 | Exports PlaybackSpeedSelector |
| `src/components/editor/preview/previewHardwarePolicy.ts` | 457 | 2 | Hardware capability probes detecting GPU backend, Metal/DX12 readiness, and fallback flags |
| `src/components/editor/preview/previewMediaSync.ts` | 39 | 1 | Exports PREVIEW_MEDIA_LOOKAHEAD_SECONDS, PREVIEW_MEDIA_RETENTION_SECONDS, getPreviewMediaSyncClips |
| `src/components/editor/preview/previewMode.ts` | 5 | 0 | Exports PREVIEW_MODE, PreviewMode |
| `src/components/editor/preview/PreviewMonitorWorkspace.tsx` | 63 | 0 | Exports PreviewMonitorOrientation, PreviewMonitorWorkspace |
| `src/components/editor/preview/PreviewPanel.tsx` | 33 | 3 | Exports PreviewPanel |
| `src/components/editor/preview/PreviewQualityManager.ts` | 211 | 2 | Exports PreviewRenderProfile, PreviewQualityManager |
| `src/components/editor/preview/PreviewTransport.tsx` | 305 | 2 | Exports PreviewTransport |
| `src/components/editor/preview/ProgramPreview.tsx` | 36 | 1 | Exports ProgramPreview |
| `src/components/editor/preview/SourcePreview.tsx` | 949 | 3 | Exports SourcePreview |
| `src/components/editor/preview/SpatialMotionPath.tsx` | 456 | 1 | Exports SpatialMotionPath, ConnectedSpatialMotionPath |
| `src/components/editor/preview/StickerSourcePreview.tsx` | 161 | 1 | Exports StickerSourcePreviewHandle, StickerSourcePreview |
| `src/components/editor/preview/TextSourcePreview.tsx` | 259 | 1 | Exports resolveTextSourcePreviewConfig, TextSourcePreview |
| `src/components/editor/preview/useNativeSurfaceController.ts` | 288 | 1 | React hook tracking native surface viewport geometry, visibility, and resize synchronization |
| `src/components/editor/preview/VideoSourcePreview.tsx` | 37 | 1 | Exports VideoSourcePreview |
| `src/components/editor/preview/VolumeControl.tsx` | 106 | 1 | Exports VolumeControl |
| `src/components/editor/preview/WebGLUnavailableError.tsx` | 49 | 0 | Exports WebGLUnavailableError |
| `src/components/editor/timeline/Clip.tsx` | 1334 | 1 | Exports Clip |
| `src/components/editor/timeline/ClipFilmstrip.tsx` | 633 | 1 | Exports clearFilmstripFrameCache, ClipFilmstripProps, ClipFilmstripInner |
| `src/components/editor/timeline/GapIndicator.tsx` | 118 | 1 | Exports GapIndicatorProps, GapIndicator |
| `src/components/editor/timeline/InlineKeyframeLane.tsx` | 525 | 1 | Exports InlineKeyframeLane |
| `src/components/editor/timeline/Playhead.tsx` | 535 | 1 | Interactive timeline playhead marker with high-frequency rAF DOM position updates |
| `src/components/editor/timeline/Timeline.tsx` | 1084 | 2 | Exports Timeline |
| `src/components/editor/timeline/TimelineRuler.tsx` | 574 | 1 | Exports TimelineRuler |
| `src/components/editor/timeline/Track.tsx` | 659 | 1 | Exports Track |
| `src/components/editor/transform/calculator.ts` | 475 | 2 | Mathematical formulas for 2D affine bounding box transforms, handle hit-testing, and cursor mapping |
| `src/components/editor/transform/TransformOverlay.tsx` | 2591 | 1 | Interactive canvas overlay rendering clip bounding boxes, transform handles, and aspect-locked scaling |
| `src/components/editor/viewport/SafeOverlay.tsx` | 86 | 1 | Broadcast safe-area guideline overlay displaying 90% action-safe and 80% title-safe margins |
| `src/components/editor/viewport/ViewportControls.tsx` | 192 | 1 | Interactive pan/zoom event handlers and keyboard shortcuts for viewport canvas manipulation |
| `src/core/audio/AudioBufferPool.ts` | 211 | 2 | Exports AudioBufferPoolStats, AudioBufferPool |
| `src/core/audio/AudioEngine.ts` | 476 | 4 | Exports ActiveVoice, AudioEngineOptions, AudioEngineTelemetrySnapshot |
| `src/core/audio/AudioFXNodeChain.ts` | 352 | 1 | Exports AudioFXNodeChain, evaluateKeyframes |
| `src/core/audio/AudioPlaybackAdapter.ts` | 212 | 1 | Exports AudioPlaybackSource, AudioDiagnosticsSnapshot, AudioPlaybackAdapter |
| `src/core/audio/audioRuntime.ts` | 107 | 4 | Exports AudioPrewarmItem, AudioPrewarmResult, getSharedAudioEngine |
| `src/core/audio/effectiveAudioState.ts` | 123 | 7 | Exports EffectiveAudioState, evaluateAudioKeyframes, evaluateFadeCurve |
| `src/core/audio/nativeAudioPreviewController.ts` | 1276 | 1 | Dual-queue audio preview controller interfacing with Rust CPAL backend and managing clip synchronization |
| `src/core/audio/nativeAudioTimeline.ts` | 174 | 1 | Exports NATIVE_AUDIO_TIME_SCALE, NativeAudioTimelineClip, NativeAudioTimelineSnapshot |
| `src/core/audio/waveformService.ts` | 354 | 3 | Exports NativeWaveformRequest, BrowserWaveformRequest, cacheWaveformData |
| `src/core/playback/AudioPreviewSyncEngine.ts` | 140 | 0 | Audio-video sync calibration monitor tracking clock drift and scheduling catch-up seeks |
| `src/core/playback/audioTrace.ts` | 82 | 4 | Exports AudioTraceEvent, traceAudioEvent, dumpAudioTrace |
| `src/core/playback/cutoutPipelineTrace.ts` | 188 | 4 | Exports CutoutPipelineStage, CutoutTraceEvent, isCutoutDebugEnabled |
| `src/core/playback/frameSkipping.ts` | 208 | 1 | Exports FrameSkipConfig, FrameSkipResult, calculateFrameSkip |
| `src/core/playback/index.ts` | 45 | 5 | Internal runtime helper |
| `src/core/playback/nativePerfTelemetry.ts` | 551 | 4 | Exports NativeFrontendPerfSample, NativeFrontendStagePercentiles, NativeFrontendModeStats |
| `src/core/playback/nativePlaybackSnapshot.ts` | 49 | 1 | Exports buildNativePlaybackSnapshotKey |
| `src/core/playback/PlaybackClock.ts` | 1083 | 15 | Single session authority for playback position, state machine, seek dispatch, and clock subscriptions |
| `src/core/playback/PlaybackContext.ts` | 32 | 4 | Exports PlaybackContextType, PlaybackContextStateSnapshot, PlaybackContextListener |
| `src/core/playback/playbackTrace.ts` | 207 | 6 | Exports tracePlayback, traceSlowPlaybackStage, PlaybackTraceEvent |
| `src/core/playback/previewOutputAdapters.ts` | 22 | 1 | Exports PreviewOutputAdapter, NativeSurfaceOutput, WebViewCanvasOutput |
| `src/core/playback/previewPerformanceContract.ts` | 177 | 5 | Exports PreviewPerformanceScenario, PreviewPerformancePath, PreviewPerformanceSampleKind |
| `src/core/playback/PreviewPlaybackScheduler.ts` | 411 | 1 | Exports SeekReason, MediaAction, MediaElementState |
| `src/core/playback/ProgramPlaybackContext.ts` | 75 | 2 | Exports ProgramPlaybackContext |
| `src/core/playback/seekController.ts` | 242 | 4 | Exports SeekMode, SeekQuality, SeekSource |
| `src/core/playback/SourcePlaybackContext.ts` | 250 | 2 | Exports SourcePlaybackContext |
| `src/core/playback/TransportAuthority.ts` | 313 | 4 | Exports AuthorityContextSwitchListener, AuthorityStateListener, TransportEventKind |
| `src/core/runtime/AppLifecycleCoordinator.ts` | 145 | 4 | Exports AppLifecycleState, LifecycleListener, AppLifecycleCoordinator |
| `src/core/runtime/CrashRecoveryService.ts` | 148 | 3 | Exports RecoverySnapshot |
| `src/core/runtime/nativeDiagnostics.ts` | 69 | 1 | Exports NativeDiagnostic, getNativeDiagnostics, clearNativeDiagnostics |
| `src/core/runtime/nativeSurfaceLifecycle.ts` | 358 | 13 | OS-level child window surface readiness, probe polling, and idle hiding logic |
| `src/core/runtime/ProjectSession.ts` | 1593 | 17 | Engine session coordinator binding timeline store, evaluated scene cache, and compositor instance |
| `src/core/runtime/ProjectStateReset.ts` | 466 | 1 | Exports ResetOptions, ResetResult |
| `src/lib/platform/deviceCapabilities.ts` | 277 | 1 | Exports DeviceCapabilities, PerformanceProfile, isMobile |
| `src/lib/platform/dxgiLatchCodes.ts` | 38 | 1 | Exports DXGI_LATCH_REASON_CODES, DxgiLatchReasonCode, RUST_DXGI_LATCH_REASON_CODES |
| `src/lib/platform/nativeCore.ts` | 1013 | 18 | Exports NATIVE_CORE_CONTRACT_VERSION, NATIVE_CORE_TIME_SCALE, EMBEDDED_PREVIEW_ONLY |
| `src/lib/platform/pathConversion.ts` | 83 | 12 | Exports toNativePath, isWebviewOrExternalUrl |
| `src/lib/platform/tauri.ts` | 1653 | 41 | Exports isTauriRuntime, NativeMediaStream, AudioExtractionRequest |
| `src/lib/platform/windowPlatform.ts` | 8 | 2 | Exports isMacOSPlatform |
| `src/lib/platform/windowState.ts` | 119 | 3 | Exports WindowGeometrySnapshot |
| `src/store/cameraStore.ts` | 131 | 2 | Exports CameraPreviewState, CameraState, useCameraStore |
| `src/store/captionStore.ts` | 164 | 4 | Exports WhisperModelSize, ModelDownloadStatus, ModelDownloadState |
| `src/store/dragStateStore.ts` | 117 | 1 | Exports ClipDropAction, useDragStateStore |
| `src/store/exportHistoryStore.ts` | 50 | 1 | Exports ExportHistoryEntry, useExportHistoryStore |
| `src/store/exportStore.ts` | 77 | 0 | Exports ExportPhase, ExportState, useExportStore |
| `src/store/favoritesStore.ts` | 109 | 9 | Exports useFavoritesStore |
| `src/store/historyStore.ts` | 197 | 28 | Exports useHistoryStore |
| `src/store/mediaJobStore.ts` | 118 | 3 | Exports MediaJob, useMediaJobStore |
| `src/store/middleware/autoSaveMiddleware.ts` | 100 | 4 | Exports useTimelineStore, suspendAutoSave, resumeAutoSave |
| `src/store/presetStore.ts` | 133 | 1 | Exports TextPreset, usePresetStore |
| `src/store/projectStore.ts` | 1964 | 47 | Zustand store managing project identity, persistence, aspect ratio, frame rate, and asset manifest |
| `src/store/recordingStore.ts` | 64 | 5 | Exports RecordingResult, RecordingState, useRecordingStore |
| `src/store/settingsStore.ts` | 202 | 18 | Exports useSettingsStore, initSettings |
| `src/store/settingsTypes.ts` | 86 | 2 | Exports Theme, UiTheme, ClipPalette |
| `src/store/shortcutStore.ts` | 572 | 4 | Exports KeyBinding, ShortcutAction, ShortcutPreset |
| `src/store/themeRegistry.ts` | 1391 | 1 | Exports UI_THEME_IDS, CLIP_PALETTE_IDS, isUiTheme |
| `src/store/timelineDraftStore.ts` | 136 | 1 | Exports TimelineGestureType, DraftClipDescriptor, SnapGuideDescriptor |
| `src/store/timelineStore.ts` | 2329 | 64 | Zustand store managing tracks, clips, transitions, gaps, and timeline mutation epoch |
| `src/store/uiStore.ts` | 323 | 43 | Zustand store managing UI selection, active panel, modal visibility, and source preview mode |
