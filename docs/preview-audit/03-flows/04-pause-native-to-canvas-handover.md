# Deliverable 03.04: Flow 4: Pause During Playback (Native-to-Canvas Handover) (`04-pause-native-to-canvas-handover.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User clicks Pause or presses Spacebar during playback | `ConnectedProgramTransport.onPlayPause (`src/components/editor/preview/NativeProgramPreview.tsx:5022`)` | clock.state ('playing') | transportPause() | Signals TransportAuthority to pause playback | [CODE] |
| 2 | PlaybackClock pauses transport | `PlaybackClock.pause (`src/core/playback/PlaybackClock.ts:620`)` | this._state, this._position | this._state = 'paused', this._playStartMs = null | Stops wall-clock extrapolation, notifies clock listeners | [CODE] |
| 3 | Render loop detects pause; engages handover latch | `NativeProgramPreview render loop (`src/components/editor/preview/NativeProgramPreview.tsx:1412`)` | isPlaying (false), surfaceShown (true) | nativeDirectSurfacePath = false, pendingHandoverSurfaceHide = true, handoverSafetyTimer = 1000ms | Keeps native OS child window visible to prevent black flash while canvas readback initiates | [CODE] |
| 4 | Paused readback frame renders to DOM canvas | `paintReadbackFrameToCanvas (`src/components/editor/preview/NativeProgramPreview.tsx:2410`)` | readbackFrameBuffer, canvasEl | ctx.drawImage(), canvasPaintStarted = true | Paints pixel-exact video frame into HTML5 canvas | [CODE] |
| 5 | First canvas frame confirmed painted; surface hidden | `handoverSurfaceHide (`src/components/editor/preview/NativeProgramPreview.tsx:4412`)` | canvasPaintStarted (true), pendingHandoverSurfaceHide (true) | pendingHandoverSurfaceHide = false, nativeSurfaceShown = false | Invokes Tauri IPC hide_native_surface() to drop OS child window | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `pause-transport`, `handover-latch-engaged`, `readback-paint-started`, and `surface-hidden` records.
