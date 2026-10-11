# Engine Acceptance Harness

## Purpose

The engine acceptance command adds a focused regression gate for Clypra's existing timeline-time contract and the TypeScript timeline evaluation paths. It is intentionally additive: it does not replace `npm test`, the full verification harness, or platform-specific playback qualification.

## Run

```sh
npm run verify:engine
```

The command runs:

1. Rust property and regression tests scoped to `engine::types::tests` in `src-tauri`.
2. The existing media timeline evaluation regression suite.
3. The existing audio export-range and fade regression suite.

The Rust properties cover frame-index round trips across integer frame rates, common fractional frame rates, microsecond/seconds conversion, bounded time arithmetic, and invalid frame-rate handling. The generated arithmetic ranges are bounded to avoid testing signed-integer overflow, which is not part of the current `MediaTime` contract.

## Scope and limitations

A passing run is evidence for these specific invariants only. It does **not** establish real-time playback, decoder/seek correctness, deterministic export, CPU/GPU pixel parity, broad codec compatibility, or production readiness.

CLI/MCP parity is not included in this first gate: this repository snapshot does not expose a FilmCraft CLI/MCP command surface that can be driven alongside Clypra's engine. Add that gate only when both interfaces and a shared command contract are available. Compare canonical project state and rendered output rather than raw project-file hashes unless serialization is explicitly deterministic.

## Follow-up acceptance gates

- Clip activity boundaries: start inclusive, end exclusive.
- Trim/split invariants and undo/redo restoration.
- Audio/video source-time mapping under fractional frame rates and speed changes.
- Golden-frame rendering and CPU/GPU comparison with explicit color-space tolerances.
- Release-build seek latency, dropped-frame rate, sustained playback, and export throughput.
- Malformed or missing media handling and structured command errors.
