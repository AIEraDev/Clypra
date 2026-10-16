# Deliverable 03.02: Flow 2: Replay After Reaching the End (`02-replay-after-end.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User presses Spacebar when playhead is at duration end | `ConnectedProgramTransport.onPlayPause (`src/components/editor/preview/NativeProgramPreview.tsx:5022`)` | clock.state, clock.time, duration | transportSeek(0), transportPlay() | Rewinds clock position to 0 and starts playback | [CODE] |
| 2 | Seek to 0 resets clock authority | `PlaybackClock.seek (`src/core/playback/PlaybackClock.ts:470`)` | this._state, this._duration | this._position = 0, this._activeSeekId = generateSeekId() | Dispatches IPC seek command to native video and CPAL audio backends | [CODE] |
| 3 | Seek completes and play state activates | `PlaybackClock.play (`src/core/playback/PlaybackClock.ts:603`)` | this._position | this._state = 'playing', this._playStartMs = performance.now() | Restarts wall-clock frame progression from 0.00s | [CODE] |
| 4 | Render loop re-engages direct native surface | `NativeProgramPreview render loop (`src/components/editor/preview/NativeProgramPreview.tsx:1410`)` | isPlaying, surfaceReady | nativeDirectSurfacePath = true, nativeSurfaceShown = true | Hardware swapchain presents frame 0 on OS child window | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `seek-zero-dispatched`, `seek-resolved`, and `playback-restarted` records.
