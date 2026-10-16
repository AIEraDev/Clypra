# Preview Subsystem Test Coverage Ledger

This ledger maps architectural requirements, system invariants, failure modes, and user interactions within the preview subsystem to verified automated regression tests.

---

## 1. Architectural Invariant Coverage

| Invariant Number & Name | Target File / Boundary | Test Suite | Specific Tests | Verification Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Invariant 1: Single Time Source** | `src/core/playback/PlaybackClock.ts` | `replayBehavioralContract.test.ts` | 38 tests | Verifies clock monotonically advances and playhead never reads secondary time sources |
| **Invariant 2: EvaluatedScene Currency** | `src/core/evaluation/evaluateTimelineScene.ts` | `requestRoundTripFixture.test.ts` | 32 tests | Verifies preview consumes strictly immutable evaluated projections |
| **Invariant 6: Native Surface Invariant** | `src/components/editor/preview/NativeProgramPreview.tsx` | `ProgramPreview.renderLoop.test.ts` | Tests #101–#120 | Verifies native surface default and explicit WebGL/canvas fallback when disabled |
| **Invariant 7: Closure-Guarded Render Loop** | `src/components/editor/preview/NativeProgramPreview.tsx` | `ProgramPreview.renderLoop.test.ts` | Tests #1–#20 | Verifies `renderInFlight = false` is released on all exit paths |
| **Invariant 13: Active Presenter Verification** | `src/components/editor/preview/NativeProgramPreview.tsx` | `previewStateResetContract.test.ts` | 29 tests | Verifies presenter state resets properly on project open, close, and modal transition |
| **Invariant 16: Native UI Thread Safety** | `src-tauri/src/commands/native_preview.rs` | `compositor_roundtrip_fixture_tests.rs` | 14 tests | Verifies OS window management dispatches strictly via main thread |

---

## 2. Subsystem Behavioral Contract Suites

These five specialized behavioral test suites validate cross-subsystem interactions and state boundaries:

| Contract Suite File | Subsystem Boundary | Test Count | Assertion Focus |
| :--- | :--- | :--- | :--- |
| `src/core/playback/__tests__/replayBehavioralContract.test.ts` | Playback Engine & Clock | 38 tests | Replay state machine, loop boundary settling, playhead wrap-around |
| `src/core/audio/__tests__/audioPreviewSyncContract.test.ts` | Audio Engine & Preview Sync | 27 tests | Audio clock synchronization, drift detection, volume/mute state updates |
| `src/components/editor/preview/__tests__/previewStateResetContract.test.ts` | Program Preview Lifecycle | 29 tests | Canvas clear, surface release, watchdog cleanup on unmount |
| `src/features/text-effects/__tests__/textEditPreviewCycle.test.ts` | Text Effects & Overlays | 26 tests | Live text typing updates, font swap invalidate, bounding box calculations |
| `src/core/evaluation/__tests__/requestRoundTripFixture.test.ts` | Evaluated Scene Serialization | 32 tests | Roundtrip integrity of clip metadata, layers, and transform matrices |
| **Total Contract Tests** | | **152 tests** | |

---

## 3. End-to-End Pixel & Shader Suites

| Test Suite | Layer | Harness File | Verification Scope |
| :--- | :--- | :--- | :--- |
| **Layer A: Canvas Pixel Validation** | Playwright E2E | `tests/e2e/preview-canvas-pixel-validation.spec.ts` | Verifies canvas pixel colors, text raster rendering, sticker placement |
| **Layer B: GPU Shaders & Transforms** | Rust Cargo Test | `src-tauri/tests/compositor_raster_transform_tests.rs` | Headless Mesa Lavapipe / Metal validation of transform matrices |
| **Layer B: Multi-Track Compositing** | Rust Cargo Test | `src-tauri/tests/multi_track_compositor_tests.rs` | Z-index sorting, track opacity blending, video transition wipes |
| **Layer B: Request Roundtrip Fixture**| Rust Cargo Test | `src-tauri/tests/compositor_roundtrip_fixture_tests.rs` | Rust deserialize and wgpu pipeline compilation from JSON fixtures |
| **Layer C: Native Readback Harness** | Local Metal / DX12 | `scripts/harness/verify-native-preview-readback.mjs` | Offscreen frame readback on physical GPU surface (local only) |

---

## 4. Negative Control Mutation Matrix

The negative control verification harness (`scripts/harness/run-canary-mutations.mjs`) tests 11 intentional defect patches against the regression suites:

| Mutation Patch File | Affected Subsystem | Guarding Test Suite | Required Failure Signature |
| :--- | :--- | :--- | :--- |
| `broken-native-clock-clear.patch` | Playback Clock | `replayBehavioralContract.test.ts` | Assertion failure in clock reset |
| `broken-pause-frame-snap.patch` | Preview Handover | `previewStateResetContract.test.ts` | Assertion failure in pause state snap |
| `broken-replay-clock-reset.patch` | Replay Loop | `replayBehavioralContract.test.ts` | Assertion failure in loop boundary wrap |
| `broken-text-color-swap.patch` | Text Compositor | `requestRoundTripFixture.test.ts` | Assertion failure in RGB color channels |
| `broken-text-edit-resolve.patch` | Text Effects | `textEditPreviewCycle.test.ts` | Assertion failure in text geometry update |
| `broken-text-layer-drop.patch` | Evaluation Engine | `requestRoundTripFixture.test.ts` | Assertion failure in layer count |
| `layer-a-drop-text-raster.patch` | Overlay Rasterizer | `preview-canvas-pixel-validation.spec.ts`| Pixel assertion failure on canvas |
| `layer-b-drop-transform.patch` | Rust Compositor | `compositor_raster_transform_tests.rs` | Assertion failure in vertex buffer transform |
| `layer-b-flip-z-order.patch` | Rust Compositor | `compositor_raster_transform_tests.rs` | Assertion failure in layer ordering |
| `layer-b-ignore-opacity.patch` | Rust Compositor | `compositor_raster_transform_tests.rs` | Assertion failure in alpha blending |
| `audio-mixer-drop-pan.patch` | Rust Audio Engine | `src-tauri/src/audio/mixer.rs` | Assertion failure in stereo pan balance |
