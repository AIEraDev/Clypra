# Deliverable 06: Observed Architectural Seams & Coupling (`06-seams-observed.md`)

> Audited Commit: \`14cb64ed075908b8b0e71c998c637c35593c6ae1\`  
> Scope: Existing architectural separations, interfaces, ports, adapters, purity checks, coupling hot spots (>15 imports), and dual-imported modules across UI and engine layers.  
> Evidence Tag: \`[CODE]\` (verified directly against source code at HEAD).

---

## 1. Separated Subsystems & Pure Modules

| Seam / Module | Public API Surface | Importers (Count) | React Free? | Store Free? | Purity Verdict | Covering Test File |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`PlaybackClock.ts`** | `PlaybackClock`, `getPlaybackClock`, `resetPlaybackClock`, `PlaybackState` | 8 | **Yes** | **Yes** | **Pure Engine** | `src/core/playback/__tests__/PlaybackClock.test.ts` |
| **`calculator.ts`** | `calculateTransform`, `getDefaultConstraints`, `getCursorForHandle` | 2 | **Yes** | **Yes** | **Pure Math** | `src/components/editor/transform/__tests__/calculator.test.ts` |
| **`PreviewQualityManager.ts`** | `PreviewQualityManager`, `QualityPolicy` | 2 | **Yes** | **Yes** | **Pure Policy** | `src/components/editor/preview/__tests__/PreviewQualityManager.test.ts` |
| **`TransportAuthority.ts`** | `TransportAuthority`, `TransportState` | 4 | **Yes** | **Yes** | **Pure Adapter** | `src/core/playback/__tests__/replayBehavioralContract.test.ts` |
| **`AudioPreviewSyncEngine.ts`**| `AudioPreviewSyncEngine`, `SyncStatus` | 2 | **Yes** | **Yes** | **Pure Monitor** | `src/core/audio/__tests__/audioPreviewSyncContract.test.ts` |
| **`frame_scheduler.rs`** | `FrameScheduler`, `PresentationDecision` | 3 | **Yes** | **Yes** | **Pure Rust** | `src-tauri/src/wgpu_compositor/tests.rs` |
| **`evaluator.ts`** | `evaluateTimelineSceneCached`, `clearEvaluationCache` | 12 | **Yes** | **No** (imports `useEffectsStore`) | **Impure Engine** | `src/core/__tests__/adversarial.test.ts` |
| **`ProjectSession.ts`** | `ProjectSession`, `getActiveSessionOrNull` | 17 | **Yes** | **No** (imports `projectStore`, `timelineStore`) | **Impure Coordinator** | `src/core/runtime/__tests__/ProjectSession.test.ts` |

---

## 2. Coupling Hot Spots (Files Importing ≥ 15 Modules)

Files with excessive coupling across architectural boundaries:

| Rank | File Path | Total Imports | Architectural Risk |
| :---: | :--- | :---: | :--- |
| 1 | `src/components/editor/preview/NativeProgramPreview.tsx` | **64** | Central nexus of desktop preview, mixing React rendering, IPC calls, DOM canvas readback, audio hooks, and transport |
| 2 | `src/App.tsx` | 38 | Root layout component orchestrating modals, shortcuts, and editors |
| 3 | `src/components/editor/timeline/Timeline.tsx` | 31 | Complex timeline UI binding tracks, playhead, snapping, and dragging |
| 4 | `src/components/editor/PropertiesPanel.tsx` | 31 | Multi-tab property inspector binding clip, audio, and text stores |
| 5 | `src/components/editor/sidebar/tabs/CaptionsTab.tsx` | 29 | Whisper transcription UI coupled with caption store and audio runtime |
| 6 | `src/components/editor/preview/SourcePreview.tsx` | 26 | Standalone asset monitor binding HTML5 media elements to transport authority |
| 7 | `src/components/editor/transform/TransformOverlay.tsx` | 23 | Canvas overlay mixing pure 2D math with native surface lifecycle and history |
| 8 | `src/core/fonts/nativeFontRegistry.ts` | 23 | Font discovery service bridging system fonts to native SDF cache |
| 9 | `src/workers/templateRasterizer.worker.ts` | 23 | Web Worker offloading template rasterization to engine crate |
| 10 | `src/store/projectStore.ts` | 22 | Primary state store directly coupling persistence, crash recovery, and native surface lifecycle |

---

## 3. Dual-Imported Modules (Bridging UI Components and Low-Level Core)

Modules imported concurrently by high-level UI view components and low-level engine/platform layers, creating architectural gravity that resists decoupling:

1. **`src/core/playback/PlaybackClock.ts`**
   - *Imported by UI:* `src/components/editor/preview/NativeProgramPreview.tsx`, `src/components/editor/timeline/Playhead.tsx` `[CODE]`
   - *Imported by Core:* `src/core/playback/ProgramPlaybackContext.ts`, `src/components/editor/preview/nativePreviewScheduler.ts` `[CODE]`
2. **`src/core/runtime/nativeSurfaceLifecycle.ts`**
   - *Imported by UI:* `src/components/editor/transform/TransformOverlay.tsx`, `src/components/editor/timeline/Timeline.tsx`, `src/store/uiStore.ts` `[CODE]`
   - *Imported by Core:* `src/components/editor/preview/NativeProgramPreview.tsx`, `src/components/editor/preview/useNativeSurfaceController.ts` `[CODE]`
3. **`src/core/evaluation/evaluator.ts` (`evaluateTimelineSceneCached`)**
   - *Imported by UI:* `src/components/editor/preview/NativeProgramPreview.tsx`, `src/components/editor/scopes/VideoScopesModal.tsx` `[CODE]`
   - *Imported by Core:* `src/lib/export/videoExport.ts`, `src/core/thumbnails/ProjectThumbnailService.ts` `[CODE]`
4. **`src/lib/platform/nativeCore.ts`**
   - *Imported by UI:* `src/components/editor/preview/PreviewPanel.tsx` `[CODE]`
   - *Imported by Core:* `src/lib/platform/tauri.ts`, `src/core/audio/nativeAudioPreviewController.ts` `[CODE]`
`;

fs.writeFileSync(path.join(REPO_ROOT, "docs/preview-audit/06-seams-observed.md"), mdContent, "utf8");
console.log("Wrote 06-seams-observed.md successfully.");
