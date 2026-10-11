# Engine Acceptance Harness

## Purpose

Clypra has a fast, local regression command and a broader opt-in acceptance runner. The local command protects known time/timeline behavior; the acceptance runner also drives the real FilmCraft CLI and MCP interfaces against the same media fixture.

## Fast regression gate

```sh
npm run verify:engine
```

This runs Rust `engine::types::tests` plus the existing TypeScript media-timeline and audio-export/fade regression suites. The Rust tests cover `MediaTime` conversions, integer and common fractional frame rates, microsecond/seconds conversion, bounded arithmetic, invalid frame rates, and a comparison against FilmCraft's exact tick grid.

## Full FilmCraft acceptance gate

Build FilmCraft's CLI from a checkout containing the razor edit property test (currently PR [AIEraDev/filmcraft#1](https://github.com/AIEraDev/filmcraft/pull/1)):

```sh
cd /path/to/filmcraft
git checkout codex/acceptance-property-tests
cargo build --release -p filmcraft-cli
```

From the Clypra repository, run:

```sh
FILMCRAFT_REPO=/path/to/filmcraft \
FILMCRAFT_CLI=/path/to/filmcraft/target/release/filmcraft-cli \
CLYPRA_GOLDEN_FIXTURES=/path/to/clypra/fixtures/golden-project \
npm run verify:engine:acceptance
```

The `FILMCRAFT_CLI` setting is optional when the binary is available at `FILMCRAFT_REPO/target/release/filmcraft-cli`, `FILMCRAFT_REPO/target/debug/filmcraft-cli`, or on `PATH`. `FILMCRAFT_REPO` defaults to a sibling `../filmcraft` directory. Golden media defaults to `fixtures/golden-project`.

The first fixture must exist at `video_1080p_60fps_h264.mp4`. Generate Clypra's benchmark assets with `npm run benchmark:assets` when needed. The runner does not fabricate substitute media: missing binaries, source checkouts, fixtures, or canvas support are reported as blocked prerequisites.

### What the runner checks

1. Runs the Clypra `MediaTime` property tests and current TypeScript media-timeline/audio-fade regression suites.
2. Verifies the copied tick-grid constant against `crates/time/src/lib.rs` in FilmCraft.
3. Runs `filmcraft-time` and `filmcraft-edit` crate tests, including the razor property asserting tick-duration conservation, no split gap, source continuity, and sequence invariants.
4. Creates separate fresh projects through the CLI and MCP stdio tools using the same fixture, applies the same one-frame trim, and compares canonicalized sequence state. Volatile IDs, playhead, and selection are excluded; raw project-file hashes are not used.
5. Renders the same point through both interfaces and compares decoded RGBA pixels, not just PNG container bytes.
6. Sends an invalid trim to both surfaces and confirms it fails without changing canonical timeline state; the MCP process must remain responsive after the error.

The machine-readable result is written to `test-results/engine-acceptance.json`. To retain temporary project files and render outputs for diagnosis, set `KEEP_ENGINE_ACCEPTANCE_ARTIFACTS=1`.

## Local build dependencies

The Clypra Rust test target statically links FFmpeg. In a fresh checkout, provide a compatible static FFmpeg install via `FFMPEG_DIR` when the local machine does not already have it configured. Clypra's GitHub Actions Rust job builds/caches static FFmpeg and exports `FFMPEG_DIR` for its job.

The full acceptance runner is opt-in rather than part of default CI because it needs a separate FilmCraft checkout, a built FilmCraft CLI, and generated golden-media fixtures. Run the initial PR CI and the opt-in command on a machine with those prerequisites before treating the acceptance criteria as satisfied.

## Scope and limitations

This gate checks timing/edit invariants and CLI/MCP parity for one real H.264 fixture and one representative edit. It does **not** establish universal codec coverage, long-duration real-time playback, seek latency targets, A/V sync over extended playback, CPU/GPU parity across platforms, HDR/color accuracy, or production readiness. Performance and color thresholds should be baselined empirically on named hardware/builds before becoming release gates.

## Next acceptance gates

- More randomized trim/split/ripple sequences and undo/redo restoration.
- Multi-rate and VFR fixtures, GOP-seek accuracy, and stale-frame rejection under burst seeking.
- Audio/video source-time mapping under speed changes and sample-rate boundaries.
- CPU/GPU golden-frame comparison with documented platform-specific tolerances.
- Release-build p95 seek/playback/export timing, dropped frames, and memory stability.
- Missing/corrupt media and malformed command matrices, including structured errors and recovery.
