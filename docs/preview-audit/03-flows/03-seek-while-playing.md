# Deliverable 03.03: Flow 3: Seek While Playing (`03-seek-while-playing.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User drags timeline playhead during active playback | `Playhead.tsx onScrubUpdate (`src/components/editor/timeline/Playhead.tsx:48`)` | pixelsPerSecond, clockState.time | transportUpdateScrub(newTime) | Sends new timeline position to transport authority | [CODE] |
| 2 | PlaybackClock receives mid-playback seek | `PlaybackClock.seek (`src/core/playback/PlaybackClock.ts:470`)` | this._state, this._activeSeekId | this._position = newTime, this._activeSeekId = id, this._seekTimeoutTimer = 500ms | Resets extrapolation baseline (_playStartMs), schedules native decoder seek IPC | [CODE] |
| 3 | Audio preview controller handles transport seek | `nativeAudioPreviewController.seek (`src/core/audio/nativeAudioPreviewController.ts:340`)` | audioState, activeClips | transportQueue.push(seek_native_audio) | Dispatches ring buffer seek to CPAL stream over IPC | [CODE] |
| 4 | Stale audio sample rejection guard executes | `PlaybackClock.setNativeClockPosition (`src/core/playback/PlaybackClock.ts:485`)` | this._activeSeekId, sample.position | Dropped if sample timestamp predates seek invocation (CLY-PERF-001) | Prevents playhead from jumping backwards to pre-seek audio position | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `scrub-update`, `clock-seek-inflight`, and `stale-sample-dropped` records.
