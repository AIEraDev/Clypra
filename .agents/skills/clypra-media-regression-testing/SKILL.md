---
name: clypra-media-regression-testing
description: >-
  Guides AI agents through authoring, running, and diagnosing media, audio, timeline, and rendering regression tests in Clypra.
  Activate when changing media probing, audio-video synchronization, timeline gap/placement engines,
  EvaluatedScene generation, export pipeline, or native hardware surface interactions.
---

# Clypra Media & Audio Regression Testing Workflow

## Overview
This skill provides specific testing methodologies for Clypra's media, audio, timeline, and rendering subsystems.
Clypra coordinates between a TypeScript/React frontend and a Rust/wgpu/CPAL backend. Testing must prevent regressions across timeline mathematics, audio synchronization, clip boundaries, decoder readiness, and export encoding.

---

## When to Use This Skill
- Adding regression tests for timeline clip placement, snapping, trimming, or splitting.
- Verifying audio behavior for embedded video audio, detached audio, and standalone music tracks.
- Testing media probing, hydration timing, and missing/corrupted file fallbacks.
- Testing export pipeline logic, frame batching, and resolution calculations.
- Verifying PlaybackClock state transitions and AV drift prevention.

## When NOT to Use This Skill
- Simple UI styling or component layout tweaks unrelated to media playback.
- Pure documentation updates.

---

## Testing Priorities & Scenarios

### 1. Audio Synchronization & Hydration Testing
Ensure both Web Audio and native CPAL audio paths are validated:
- **Video with Embedded Audio**: Must resolve audio stream and populate active audio clips once probed.
- **Silent Video (No Audio Track)**: Must not block playback clock; `markNativeAudioUnavailable()` must allow video playback to proceed without stalling for audio clock positions.
- **Standalone Audio Tracks**: Must start, seek, and loop accurately alongside video tracks.
- **Hydration Race Conditions**: Test behavior when playback begins while `asset.path === ""` or `asset.streams === undefined`. Verify that clips are safely queued and synchronized once probe completes without freezing the UI or resetting playback time to 0.

### 2. Timeline Geometry & Invariants
Test pure timeline models without instantiating UI:
- **Clip Boundaries**: Verify `startTime`, `duration`, `sourceOffset` math across trims, slips, slides, and splits.
- **Gap Engine**: Test `detectGaps()`, `insertGapWithRipple()`, `removeGapWithRipple()`, and `packTrack()`. Ensure no negative clip durations or overlapping collisions on non-overlapping tracks.
- **SMPTE Timecode & Rational Time**: Test frame-accurate timecode conversions at 23.976, 24, 25, 29.97, 30, 59.94, and 60 fps.

### 3. Rendering & EvaluatedScene
- Test that `evaluateTimelineSceneCached(time)` produces the exact expected `EvaluatedScene`:
  - Active video/audio clips at time $T$.
  - Transform matrices, opacity, blend modes, and active keyframes.
  - Video transitions bridging incoming and outgoing clips.
- Verify scene immutability: tests must confirm that rendering does not alter store state.

### 4. Export & Native Process Management
- **Preflight Checks**: Verify `exportPreflight()` detects missing assets, zero-byte files, and invalid dimensions before launching FFmpeg.
- **Batching & Cancellation**: Verify that cancelling an export halts frame production, cleans up temporary directories, and does not deadlock.
- **Process Cleanup**: Ensure failed FFmpeg subprocesses terminate and release file locks.

---

## Fixture & Determinism Strategy
- **Synthetic Test Fixtures**: Prefer creating small, deterministic in-memory fixtures or minimal video/audio files generated via FFmpeg scripts (`scripts/generate-bench-fixtures.sh`).
- **Never Check In Large Media Files**: Keep repository size small and free from licensing conflicts.
- **Validate Properties, Not Binary Hashes**: Media encoding outputs can vary slightly across OS versions and FFmpeg builds. Assert stream metadata (duration, resolution, audio channels, codec, keyframe intervals) rather than brittle SHA256 checksums of encoded containers.

---

## Execution Commands
```bash
# Run timeline mathematical unit tests
npx vitest run src/lib/timeline/__tests__/
npx vitest run src/core/timeline/__tests__/

# Run audio synchronization unit tests
npx vitest run src/core/audio/__tests__/
npx vitest run src/core/media/__tests__/

# Run export pipeline tests
npx vitest run src/lib/export/__tests__/

# Run full render loop and playback clock regression suite
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts
```
