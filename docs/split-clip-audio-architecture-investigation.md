# Split-Clip Audio Architecture Investigation

Date: 2026-08-24

This report investigates the current implementation without changing the existing seek/preroll fix in `src-tauri/src/audio/decoder.rs`.

## Part 1 — Playback decoder session model

### Finding

The native playback path is clip-ID-keyed decoded PCM, not a persistent decoder session keyed by source path.

The frontend builds one immutable native timeline snapshot from active audio clips, starts the native clock, clears the existing native clip list, and loads every snapshot clip concurrently ([nativeAudioTimeline.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/audio/nativeAudioTimeline.ts:59)). The Tauri load command opens/decodes one source path and installs the resulting clip into the clock mixer ([native_audio.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/commands/native_audio.rs:100)).

Each decode opens a fresh FFmpeg input and creates a `DecodedAudioClip` containing the clip ID, timeline position, source start, duration, and PCM samples ([decoder.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/audio/decoder.rs:71), [mixer.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/audio/mixer.rs:75)). The native clock stores `NativePcmClip` values in a mixer vector and replaces/removes them by clip ID ([native_audio.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/native_audio.rs:116)). There is no native source-path decoder pool or decoder-position LRU.

### Boundary behavior

`source_start_ticks` is applied during each clip's initial decode. The corrected global seek and preroll trimming are therefore exercised for every clip whose `trimIn` is nonzero, including every right-hand split piece ([decoder.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/audio/decoder.rs:118)).

Continuous playback does not reposition a shared decoder at a boundary. The mixer calculates each clip's source position from `timeline_ticks - timeline_start_ticks` and samples the already-decoded PCM ([native_audio.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/native_audio.rs:230)). Explicit seeks only move the native timeline clock ([native_audio.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/native_audio.rs:628)); they do not re-seek or mutate an FFmpeg decoder.

When a split is present, both halves can be installed simultaneously. They cannot interfere through a shared decoder cursor, but each half independently decodes its source range. The native mixer bounds resource usage at 64 clips and 512 MiB of PCM ([native_audio.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/native_audio.rs:10), [native_audio.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/native_audio.rs:151)). Native audio has no independent 2–3 second decoder lookahead; the separate video prewarm path is bounded at 1.5 seconds ([PreviewMediaPool.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/resources/PreviewMediaPool.ts:240)).

### Browser fallback

The browser path is separate. Its decoded `AudioBuffer` is cached by media/source key, while active playback voices are keyed by clip ID ([AudioEngine.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/audio/AudioEngine.ts:142)). A shared full-source buffer is safe because each voice starts at `trimIn + timeIntoClip` ([AudioEngine.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/audio/AudioEngine.ts:158)). It does not reproduce the native shared-decoder-position bug, although it can share an incorrectly selected buffer if a clip's `audioPath` differs from the media asset while retaining the same `mediaId`.

### Classification

The native architecture is orthogonal to the original wrong-time-base bug. The fix corrects initial clip-range decoding; continuous boundary playback succeeds because the native graph contains independently decoded clips and mixes them by timeline position. The tradeoff is redundant native decoding/PCM storage for multiple clips referencing one source.

## Part 2 — Waveform extraction

### Call sites and range behavior

The `extract_waveform_data` Tauri command is invoked from one frontend hook ([useWaveformData.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/timeline/useWaveformData.ts:90)); it is registered as a Tauri command ([lib.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/lib.rs:198)). Timeline video clips use `VolumeWaveform`, and audio clips use `TimelineWaveform`, with one waveform hook invocation per rendered clip ([Clip.tsx](/Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/timeline/Clip.tsx:815)).

The native command passes FFmpeg `-ss` and `-t` from the requested `start_time` and `duration` ([media.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/commands/media.rs:499)). Therefore the native waveform decode is scoped to the clip's visible trimmed range rather than intentionally decoding the entire source file.

The browser fallback is different: `decodeAudioData` loads the complete source buffer, then JavaScript slices `startSample..endSample` for bucket computation ([useWaveformData.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/timeline/useWaveformData.ts:118)). Thus the fallback performs full-file decode work even though the displayed waveform is trimmed.

### Split and caching behavior

The split command creates two new clips, preserving the source path and assigning left/right trim ranges ([SplitClipCommand.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/history/commands/SplitClipCommand.ts:55)). The waveform cache key includes resolved path, source start, source duration, and bucket count ([useWaveformData.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/timeline/useWaveformData.ts:79)). Consequently, a cold-cache split creates two waveform requests, one per resulting range. An N-way split creates N requests for N distinct ranges:

- Native/Tauri: N bounded-range FFmpeg decodes.
- Browser fallback: N full-source `decodeAudioData` operations followed by N range slices.

Exact duplicate requests can share the existing 50-entry LRU cache, but there is no coarse source-wide waveform cache analogous to the filmstrip L0 cache. This is an efficiency finding, not a playback-correctness defect.

The separate media-card waveform implementation also decodes through Web Audio, but it is not a call site of `extract_waveform_data` and is unrelated to split-clip timeline rendering ([MediaCardWaveform.tsx](/Users/AIEraDev/Documents/clypra-family/clypra/src/components/ui/cards/MediaCardWaveform.tsx:32)).

## Part 3 — Detached audio isolation

`DetachAudioCommand` creates an audio-kind clip, sets `audioPath` to the selected source asset path, retains `detachedFromClipId`, and mutes the original video clip ([DetachAudioCommand.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/history/commands/DetachAudioCommand.ts:51)). Native timeline audio prioritizes `clip.audioPath` over the media asset path ([audioClips.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/timeline/audioClips.ts:82)). Waveform rendering also prioritizes the explicit path ([Clip.tsx](/Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/timeline/Clip.tsx:849)). For the built-in detach command, the explicit path currently equals the original video asset path by design.

Detached audio does not enter the visual compositor: the evaluator explicitly skips `clip.kind === "audio"` before creating media layers ([evaluator.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/evaluation/evaluator.ts:225)), and the preview media pool similarly excludes audio-kind clips from video bindings ([PreviewMediaPool.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/resources/PreviewMediaPool.ts:409)). Existing evaluator and preview-pool regression tests pass.

### Latent divergence

The canonical evaluator's audio-layer construction requires an asset and resolves `sourcePath` from `asset.path`, ignoring `clip.audioPath` ([evaluator.ts](/Users/AIEraDev/Documents/clypra-family/clypra/src/core/evaluation/evaluator.ts:313)). This does not affect the current native preview path, which uses `getActiveAudioClips`, nor the current detach command, because both paths are equal today. It is a latent correctness gap for any audio-kind clip backed by a video asset whose explicit `audioPath` differs from that asset. No fix was applied during this investigation because the reproduced detach scenarios did not demonstrate wrong audible content in the active playback path.

## Part 4 — Reproduction matrix

The deterministic headless reproduction is implemented in [split_investigation_tests.rs](/Users/AIEraDev/Documents/clypra-family/clypra/src-tauri/src/audio/split_clip_investigation_tests.rs:1). It generates a temporary six-second A/V fixture with 440 Hz, 880 Hz, and 1760 Hz source regions, then validates source-frequency identity and amplitude.

| Scenario | Headless result | Classification |
| --- | --- | --- |
| One split, continuous playback | Correct first tone followed by second tone | Fix holds |
| Two splits, continuous playback | Correct tones across both boundaries | Fix holds |
| Independent same-source clips | Each clip plays its configured source range | No shared-position interference |
| Immediate seek into second half | Starts in the second tone region | Fix holds |
| Detached audio then split/seek | Uses explicit audio path and correct source range | Isolated from visual path |
| Rapid scrubbing across boundary | Repeated timeline mixing selects the correct tone with no stale half | No stale decoder cursor |

The focused Rust test passed, including the scoped waveform assertion. TypeScript typecheck passed, and the targeted Vitest suite passed 153 tests. Manual audible Tauri playback was not executable through the available non-interactive tool interface; the report therefore records the deterministic native decoder/mixer observations rather than claiming an unperformed listening session.

## Follow-up scope

1. Consider a source-keyed/coarse waveform cache to avoid repeated full-file browser fallback decodes and repeated bounded native decodes.
2. Align evaluator audio-layer path resolution with `audioClips.ts` so explicit `audioPath` is authoritative for audio-kind clips.
3. Add an interactive desktop smoke test to CI or the QA checklist for the six audible scenarios.
