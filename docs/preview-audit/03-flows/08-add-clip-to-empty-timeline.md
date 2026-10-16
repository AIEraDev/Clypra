# Deliverable 03.08: Flow 8: Add a Clip to an Empty Timeline (Sticker, Text, Audio, Image, Video) and Show It (`08-add-clip-to-empty-timeline.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User drags sticker, text, or video asset onto empty timeline | `timelineStore.addClip (`src/store/timelineStore.ts:153`)` | tracks, clips (empty []) | clips = [newClip], epoch = epoch + 1 | Timeline duration expands from 0 to clip.duration | [CODE] |
| 2 | Evaluated scene cache generates initial scene | `evaluateTimelineSceneCached (`src/core/evaluation/evaluator.ts:1171`)` | time: 0, clips: [newClip], tracks | EvaluatedScene with single compositor layer | Builds layer snapshot for wgpu compositor / canvas readback | [CODE] |
| 3 | Native preview wakes from disabled idle state | `NativeProgramPreview render loop (`src/components/editor/preview/NativeProgramPreview.tsx:823`)` | clips.length (1 > 0) | forceRepaintNativeProgramPreview() | Removes 'No clips in sequence' placeholder DOM overlay | [CODE] |
| 4 | Initial frame paints to DOM canvas | `paintReadbackFrameToCanvas (`src/components/editor/preview/NativeProgramPreview.tsx:2410`)` | canvasEl, renderedFrame | ctx.drawImage() | User immediately sees the added sticker/text/video frame at 00:00 | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `empty-timeline-clip-added`, `first-scene-evaluated`, and `initial-frame-painted` records.
