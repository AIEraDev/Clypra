# Rendering and Performance Acceptance

## Purpose

This is an opt-in qualification suite for the FilmCraft engine candidate. It covers two implemented measurements separately: CPU-reference/GPU-compositor correctness in FilmCraft, and real-media decode throughput in Clypra. It deliberately does not label decode throughput as end-to-end playback performance.

## Run

    npm run verify:render-performance

Run from a configured development machine. The command writes a machine-readable report to test-results/render-performance-acceptance.json and per-source decoder reports beneath test-results/render-performance/.

Required inputs:

- A FilmCraft checkout at ../filmcraft, or set FILMCRAFT_REPO.
- A usable wgpu adapter for FilmCraft's GPU parity tests. If any tests print that no GPU adapter is available, the GPU gate is BLOCKED even if Cargo exits successfully; the test helpers otherwise return early and can look green.
- Clypra's generated golden media. Create it with npm run benchmark:assets if needed.
- Static FFmpeg build prerequisites needed to compile the Clypra decoder benchmark. Set FFMPEG_DIR where appropriate.
- A 4K60 source for actual 4K60 decoder throughput qualification. The checked-in golden corpus contains 4K30 HEVC, not 4K60.

## Configure source media

The defaults are:

- 1080p60 H.264: fixtures/golden-project/video_1080p_60fps_h264.mp4
- 4K30 HEVC: fixtures/golden-project/video_4k_30fps_hevc.mp4
- 4K60: supplied explicitly through CLYPRA_BENCH_4K60

Example:

    FILMCRAFT_REPO=/path/to/filmcraft \
    CLYPRA_BENCH_4K60=/media/real_4k60_hevc.mp4 \
    npm run verify:render-performance

By default, the runner requires hardware decoding and reports a BLOCKED gate if arm 1 falls back to software. Set CLYPRA_PERF_REQUIRE_HARDWARE=0 only when intentionally gathering a software-decoding baseline.

The benchmark uses 1,800 measured frames after 60 warm-up frames by default. Override with CLYPRA_BENCH_FRAMES, CLYPRA_BENCH_WARMUP, and CLYPRA_BENCH_DOWNLOAD_EVERY.

## What the suite measures

### Pillar 2: CPU/GPU render parity

The runner executes FilmCraft's CPU reference renderer tests and GPU compositor library tests. These exercise existing YUV normalization, transforms, compositing, blend modes, effects, and other CPU/GPU comparison cases. The GPU test suite's own tolerances remain authoritative; this runner does not invent a universal Delta E threshold. GPU-unavailable tests are BLOCKED rather than accepted as a pass.

### Pillar 3: Real-media decoder throughput

The runner invokes Clypra's decode-throughput-bench example in release mode against the actual selected media. It preserves the complete report, including source codec/dimensions/frame rate, OS/architecture, hardware decoder identity, sustained decode FPS, per-frame percentiles, and host-download costs for the software and hardware arms.

These are decoder throughput measurements. They do not include full timeline evaluation, effects composition, native-surface presentation deadlines, audio-master clock stability, or observed dropped visible frames.

Set CLYPRA_ENFORCE_REALTIME_DECODE=1 to enforce that the hardware decode/no-host-download arm sustains at least the source cadence. Without this setting, the result records whether the target was met but does not fail solely on that threshold; establish per-machine baselines before enabling strict targets.

## Decode-only mode versus release qualification

    CLYPRA_DECODE_ONLY=1 CLYPRA_REQUIRE_4K60=0 npm run verify:render-performance

This mode is for collecting CPU/GPU parity and available decoder-throughput data when no 4K60 source or full playback instrumentation is available. It explicitly marks end-to-end playback as SKIPPED. It must not be used as evidence that Clypra meets the 4K60 playback goal or as the migration gate for the primary desktop timeline.

Without decode-only mode, the suite reports end-to-end playback qualification as BLOCKED. That is intentional: the current decoder benchmark is not a real-time playback benchmark. The existing clypra-engine-benchmark runner uses synthetic surfaces and is not a substitute for a media-backed playback test.

## Remaining work before full Pillar 3 qualification

Build a real-media playback benchmark around Clypra's actual native preview path, not only the decoder. It must capture:

- A real 4K60 source and the selected hardware decoder/renderer adapter.
- Sustained wall-clock playback over a documented interval, with presented, late, repeated, obsolete, and dropped frame counts.
- P50/P95/P99 stage and end-to-end frame latency, including decode, composition, GPU wait, and present.
- Audio-master clock drift and recovery during seeks/transport changes.
- CPU/GPU/memory usage and hardware decode truth (no silent software fallback).
- The OS, GPU, driver, build commit, media hashes, and benchmark configuration.

Only then should the 4K60 playback gate be considered implemented. Do not tune or migrate the primary desktop timeline based solely on decode throughput.

## Interpretation

A completed decoder report is evidence that a specific media file was processed under a specific hardware/software configuration. It is not evidence of universal codec support or professional real-time playback. Retain the JSON artifacts for comparison between builds on the same machine and use measured, versioned baselines for future regression thresholds.