---
name: clypra-composite-media-automation
description: >-
  Continuous automation, performance scenario benchmarking, and behavioral contract verification for Clypra's multi-layer composite media pipelines: text effects, text templates, audio keyframing/sync, image overlays, and concurrent multi-track video.
  Activate when adding or modifying text effects, text templates, audio preview/sync, image handling, multi-track video compositing, or performance acceptance scenarios.
---

# Clypra Composite Media & Continuous Automation Guide

## 1. Overview
Clypra renders complex timelines featuring concurrent video layers (A-roll, B-roll, PIP), static and animated image overlays, styled text effects, dynamic text templates, and multi-track audio with volume keyframes.

This skill governs how continuous automated testing, acceptance benchmarking, and regression prevention are maintained as new features are added across:
- **Text**: Text effects (fills, strokes, shadows, entrance/exit animations) and text templates (`kind: "text-template"`).
- **Audio**: Multi-track audio synchronization, ducking, volume keyframes, and fade curves.
- **Media & Multi-Medias**: Primary video streams and multi-track composite video layers.
- **Images**: Still image overlays (PNG/JPEG) with alpha transparency and canvas transforms.

---

## 2. Invariants & Architecture Rules

1. **EvaluatedScene Currency (Invariant 2)**:
   All preview and export pipelines consume `EvaluatedScene` emitted by `evaluateTimelineSceneCached()`. Never read raw `timelineStore` directly in render loops.
2. **Deterministic Time Authority (Invariant 1)**:
   `PlaybackClock.ts` is the single source of truth for playhead position. Audio keyframe gain and text animations must evaluate deterministically against the current clock time.
3. **Multi-Track Composite Layer Ordering**:
   Visual layers are evaluated with higher track indices appearing above lower tracks. `clipKind` identifies layer provenance (`video`, `image`, `text`, `text-template`).
4. **Append-Only Behavioral Contracts**:
   Behavioral contract suites guard against silent regressions. When modifying any composite subsystem, all contract suites must pass before declaring work complete.

---

## 3. Automation Assets & Fixtures

### Canonical Fixtures
- **Primary 25 fps Video**: `/Users/AIEraDev/Documents/clypra-fixtures/clip_1440p25_gop1s.mp4`
- **Secondary Video (PIP/B-roll)**: `/Users/AIEraDev/Documents/clypra-fixtures/sync_test.mp4`
- **Brand Image Overlay**: `/Users/AIEraDev/Documents/clypra-family/clypra/public/clypra.png`
- **Composite Project Fixture**: `scripts/perf/fixtures/project-composite-25fps.json` (also mirrored in OS application support directory).

### Scenario Runner Presets (`scripts/perf/run-preview-scenario.mjs`)
- `playback-steady-30s`: Standard 30-second single-stream playback.
- `playback-composite-30s`: 30-second multi-layer composite playback exercising text effects, templates, images, PIP video, and audio keyframe envelopes.
- `composite-scrub-sweep`: 40-step scrub sweep across composite timeline layers.

---

## 4. Verification & Quality Gates

When adding or touching text, audio, image, or multi-media features, execute the following suites:

```bash
# 1. Behavioral Contract Suites
npx vitest run src/core/playback/__tests__/replayBehavioralContract.test.ts
npx vitest run src/core/audio/__tests__/audioPreviewSyncContract.test.ts
npx vitest run src/components/editor/preview/__tests__/previewStateResetContract.test.ts
npx vitest run src/features/text-effects/__tests__/textEditPreviewCycle.test.ts
npx vitest run src/core/evaluation/__tests__/compositeMediaBehavioralContract.test.ts

# 2. Scenario Runner & Evaluator Tests
node --test scripts/perf/run-preview-scenario.test.mjs
node --test scripts/perf/evaluate-acceptance.test.mjs

# 3. TypeScript & Localization Integrity
npx tsc --noEmit
npm run i18n:check
```

---

## 5. Adding New Features: Step-by-Step Automation Protocol

When introducing a new capability to text, audio, images, or composite media:
1. **Extend Contract Test**: Add a test case in `compositeMediaBehavioralContract.test.ts` verifying that `evaluateTimelineSceneCached()` produces the expected layer metadata and transform.
2. **Update Project Fixture**: If the feature introduces new clip schema properties, update `scripts/perf/fixtures/project-composite-25fps.json` so the automated scenario runner exercises the new feature during desktop benchmark runs.
3. **Verify Acceptance Criteria**: Run `evaluate-acceptance.mjs` against the generated session log to ensure presentation ratio $\ge 95\%$, 0 zero-copy violations, and `c9_compositionRollup` reflects the active layers.
