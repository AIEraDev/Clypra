# Deliverable 03.09: Flow 9: Cold Start of Playback with Audio (Project Already Loaded) (`09-cold-start-playback-audio.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User hits Spacebar immediately upon project open | `ConnectedProgramTransport.onPlayPause (`src/components/editor/preview/NativeProgramPreview.tsx:5022`)` | clock.state ('idle'), clips.length | transportPlay() | Initiates parallel audio and video playback pipelines | [CODE] |
| 2 | Audio engine begins cold stream initialization | `nativeAudioPreviewController.play (`src/core/audio/nativeAudioPreviewController.ts:250`)` | audioState ('idle') | transportQueue.push(start_native_audio) | Invokes Tauri IPC start_native_audio to start CPAL hardware output stream | [CODE] |
| 3 | PlaybackClock starts wall-clock extrapolation immediately | `PlaybackClock.play (`src/core/playback/PlaybackClock.ts:603`)` | this._position | this._state = 'playing', this._playStartMs = performance.now() | Video playback progresses smoothly without waiting for CPAL cold-start latency | [CODE] |
| 4 | First CPAL audio hardware packet arrives | `PlaybackClock.setNativeClockPosition (`src/core/playback/PlaybackClock.ts:470`)` | position, performance.now() | this._nativeClockPosition = position, this._nativeClockUpdateMs = now | Smoothly locks video presentation clock to physical hardware audio clock | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `cold-play-input`, `audio-ipc-dispatched`, `extrapolation-engaged`, and `first-cpal-sync` records.
