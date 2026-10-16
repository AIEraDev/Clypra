# Deliverable 03.06: Flow 6: Edit the Project (Add, Delete, or Move a Clip, or Edit Text) During Playback (`06-edit-timeline-during-playback.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User drags clip or trims edge during active playback | `timelineStore.updateClip (`src/store/timelineStore.ts:155`)` | clips, epoch | clips = updatedClips, epoch = epoch + 1 | Increments timeline epoch for cache invalidation | [CODE] |
| 2 | AutoSave middleware detects mutation | `autoSaveMiddleware (`src/store/middleware/autoSaveMiddleware.ts:45`)` | state.epoch, projectStore.project | saveSnapshot() | Dispatches debounced crash recovery snapshot | [CODE] |
| 3 | Render loop observes epoch change | `NativeProgramPreview render loop (`src/components/editor/preview/NativeProgramPreview.tsx:823`)` | timelineStore.epoch | forceRepaintNativeProgramPreview() | Invalidates EvaluatedScene cache and triggers immediate frame re-evaluation | [CODE] |
| 4 | Audio preview sync queue receives clip update | `nativeAudioPreviewController.syncClips (`src/core/audio/nativeAudioPreviewController.ts:415`)` | timelineStore.clips | sourceSyncQueue.push(replace_native_audio_clips) | Reloads audio buffer schedule into Rust CPAL backend over IPC | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `clip-mutated`, `epoch-incremented`, `scene-cache-invalidated`, and `audio-clips-synced` records.
