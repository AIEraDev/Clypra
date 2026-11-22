# ADR-0002: Portable Performance Evidence and Offline Analysis

## Status

Accepted

## Context & Problem Statement

Clypra's native preview now records real Metal zero-copy activity, but the
current session evidence is difficult to compare across platforms. Decoder
identity, stream metadata, transfer paths, and workload rollups can describe
different requests in the same session. Platform-specific counters also make
Windows hybrid-GPU and Linux dma-buf failures hard to diagnose without access
to the original machine.

Verified constraints from the M1 session:

- Hardware decode and Metal presentation can be zero-copy while decode latency
  still causes scrub and seek misses.
- Steady playback, scrub, cold seek, and filmstrip work have materially
  different latency distributions.
- A frame path must distinguish shared-surface zero-copy, GPU copy, and CPU
  download; "hardware accelerated" alone is insufficient.
- Test environments may not have the target GPU, so evidence must be useful
  without claiming hardware support from compilation or software adapters.

## Decision

Adopt a versioned, platform-neutral performance evidence contract owned by the
Rust native telemetry boundary and consumed by an offline analyzer.

Each frame event will expose these normalized facts:

```json
{
  "schemaVersion": 2,
  "decode": "hw|sw",
  "handoff": "zero_copy|gpu_copy|cpu_download",
  "api": "metal|d3d11|vaapi_dmabuf|nvdec|software",
  "decodeAdapter": {},
  "renderAdapter": {},
  "workload": "playback|scrub|cold_seek|filmstrip",
  "requestId": "...",
  "generation": 0,
  "frameIndex": 0
}
```

Platform-specific details are nested in adapter and environment objects. The
contract records vendor/device IDs, driver version, compositor session where
available, and whether decode and render use the same adapter. Surface-sharing
paths remain separate from GPU-copy and CPU-download paths.

The native collector remains allocation-bounded on hot paths. It records fixed
size samples into bounded per-context buffers, aggregates workload percentiles,
and flushes on a timer and during panic handling. Correlation IDs and transfer
call-site labels are retained through aggregation.

An independent `clypra-perf` analyzer will read NDJSON and emit:

1. a human-readable Markdown report;
2. machine-readable JSON with schema and verdict fields;
3. a non-zero exit code for invariant violations; and
4. an optional Perfetto trace export.

The analyzer will enforce, at minimum:

- hardware-decoded playback frames must not have playback-site CPU transfers;
- zero-copy with different decode/render adapters must be classified as a
  cross-adapter GPU copy, not shared-surface zero-copy;
- `unknown` paths and missing correlation IDs are telemetry defects;
- bottleneck attribution must choose decode, queue, GPU, present, or IPC from
  measured stage percentiles rather than aggregate means.

### Provenance and trust

Every v2 record carries a schema version, session sequence, producer scope, and
timestamp. Sessions begin with a `session-header` containing the build profile,
git identity, FFmpeg identity, system fingerprint, and resolved diagnostic
flags. Preview transitions are emitted as `preview-context` records; frame
records reference the context and stream key rather than repeating an inferred
presenter label.

The analyzer lints before it summarizes. It verifies monotonic sequence and
timestamps, declared preview contexts and stream keys, and session identity
consistency. A legacy wrapped file may still be read, but it receives an
`untrusted` evidence grade until it has been migrated. A trusted claim such as
"P010 zero-copy verified" requires a declared Main10/P010 stream, a matching
per-frame stream key, a native Metal/D3D/VAAPI path, and reconciled counters.

Capability status is maintained separately for each platform, API, codec, bit
depth, and range as `verified`, `supported-with-limitations`, `unverified`, or
`known-broken`. Unverified hardware paths default to the existing CPU fallback
for that stream; until a CPU P010 path is validated, its telemetry must retain
the `capability-unverified` reason rather than claiming 10-bit parity. The process-level `auto` policy tries the platform's best
verified native candidate first (Metal on macOS, DXGI on Windows, and the
platform adapter on Linux when implemented), then demotes to CPU/software when
the stream probe or import fails. `CLYPRA_DECODE_PATH` remains an explicit
diagnostic override; it is never required for normal hardware acceleration.

The evidence workflow is deliberately phased. Phase 1 adds provenance and
measurement foundations without changing scheduling: machine power/thermal
state, scenario and experiment-arm identity, a process-exit `session-footer`,
request joins, stream-keyed summaries, and lookahead invalidation causes. Phase
2 uses the feature-gated deterministic scenario driver and a three-arm A/B
experiment (baseline behavior, dirty recovery enabled, dirty recovery
disabled). Each arm is run interleaved at least five times after one warm-up;
the decision rule is fixed before collection and reports stale-display/drop
rate before interpreting decoder incidents. Lookahead scheduling is not
rewritten until those counters identify topology-wide invalidation as the
dominant cause.

The canonical event envelope is described by the checked-in
`scripts/perf/perf-v2.schema.json`. JSON Schema validates record shape;
`clypra-perf lint` owns cross-record invariants such as stream/context joins,
footer completion, counter reconciliation, and build provenance. The
`session-footer` is emitted on application shutdown (not merely project close)
so a project-close marker cannot certify an incomplete process session.

## Alternatives Considered

- **Keep platform-specific counters only**: rejected because aggregates cannot
  distinguish shared surfaces from cross-adapter copies and cannot be compared
  across OSes.
- **Send raw frame data to the frontend for analysis**: rejected because it
  increases IPC and memory traffic precisely where preview performance is most
  sensitive.
- **Analyze logs only in the desktop app**: rejected because it prevents
  validation on machines that cannot reproduce the target hardware path and
  couples diagnostics to the UI lifecycle.

## Consequences & Trade-offs

- **Positive**: Windows and Linux testers can provide actionable evidence from
  one self-contained report; CI can validate schema and analyzer behavior with
  synthetic logs; platform adapters share one product-level contract.
- **Positive**: Workload-specific percentiles expose GOP pre-roll and scrub
  supersession without blending them into steady playback.
- **Negative / Costs**: The schema and analyzer become compatibility surfaces;
  schema versioning, fixture maintenance, and privacy review are required.
- **Risks & Mitigations**: Missing or stale platform metadata is treated as an
  analyzer error, not silently inferred. Logs remain opt-in, path-redacted,
  stream-key hashed, bounded, and rotated.

## Verification & Migration Strategy

1. Keep the current telemetry fields during migration and add normalized fields
   alongside them; do not invalidate existing local logs.
2. Add deterministic Rust/TypeScript tests for schema serialization,
   workload-specific aggregation, and invariant verdicts.
3. Add golden NDJSON fixtures for all-CPU, Metal, D3D11 shared-handle,
   cross-adapter GPU-copy, dma-buf, unknown-path, and malformed cases.
4. Add a macOS self-test fixture first, then Windows D3D11VA and Linux VAAPI/
   dma-buf probes behind their platform adapters.
5. Update `docs/engineering/platform-compatibility.md` with independent
   verification status; a successful macOS run never promotes another platform
   to verified.
6. Roll back by ignoring normalized fields and retaining the existing CPU
   fallback if an adapter or analyzer regression is found.
