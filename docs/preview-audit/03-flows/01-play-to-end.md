# Deliverable 03.01: Flow 1: Play from Paused to the End of the Timeline (`01-play-to-end.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User presses Spacebar or clicks Play button | `ConnectedProgramTransport.onPlayPause (`src/components/editor/preview/NativeProgramPreview.tsx:5022`)` | clock.state (`PlaybackClock.ts:180`), clips (`timelineStore.ts:82`) | transportPlay (`NativeProgramPreview.tsx:588`) | Dispatches transport play intent to TransportAuthority | [CODE] |
| 2 | TransportAuthority dispatches play command | `ProgramPlaybackContext.play (`src/core/playback/ProgramPlaybackContext.ts:20`)` | this.clock | this.clock.play() (`PlaybackClock.ts:603`) | Invokes PlaybackClock.play() | [CODE] |
| 3 | PlaybackClock transitions state machine | `PlaybackClock.play (`src/core/playback/PlaybackClock.ts:603`)` | this._state, this._position, this._duration | this._state = 'playing', this._playStartMs = performance.now(), this._playStartPosition = this._position | Notifies clock listeners, starts wall-clock extrapolation timer | [CODE] |
| 4 | Render loop observes isPlaying transition | `NativeProgramPreview render loop (`src/components/editor/preview/NativeProgramPreview.tsx:1410`)` | isPlaying, surfaceReady, nativeOnlyBlockersKeyRef.current | nativeDirectSurfacePath = true, nativeSurfaceShown = true, renderInFlight = true | Directs wgpu compositor to present frames directly to OS child window (Metal/DX12) | [CODE] |
| 5 | Clock time reaches duration threshold | `PlaybackClock.tick (`src/core/playback/PlaybackClock.ts:680`)` | this._position, this._duration | this._position = this._duration, this._state = 'paused' | Automatically pauses transport at timeline EOF, notifies listeners | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `playback-start`, `frame-presented`, and `playback-eof` records.
