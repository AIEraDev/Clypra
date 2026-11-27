# Clypra Telemetry

Clypra uploads anonymous performance and error reports to help improve the app.
Uploads begin only after the first-run disclosure is shown. The disclosure has
equal **Keep sharing** and **Turn off** choices; pressing Escape keeps sharing.
You can change this at any time in Settings → Preview Diagnostics.

## Default and controls

For a new install with no saved choice, upload is enabled after the disclosure
has been shown and the default state is recorded as `consentState: "default"`.
An explicit **Keep sharing** choice is recorded as `consentState: "explicit-on"`.
An explicit opt-out prevents new uploads and retries, and removes completed
pending session files from the device.

To disable it for CI or contributor environments, set:
```
CLYPRA_DISABLE_TELEMETRY_UPLOAD=1
```

## What is collected

Each performance session report contains only diagnostic fields such as:
- Session ID (a random UUID generated at session open — not tied to your account or device)
- Frame stage timing percentiles (p50, p95, p99) in microseconds
- GPU adapter name, vendor ID, device ID, driver version, and backend (e.g. "Intel HD 520", `0x8086`, `0x9a49`, driver version, "d3d12") when the platform exposes them
- Preview quality tier and canvas dimensions
- UNCH / skipped-download counts
- Timeline zoom performance rollups (frame rate percentiles, spring settle time, discrete wheel delta buckets, DPR, and ruler/frame-cell timing aggregates — strictly zero PII)
- App version, build provenance, runtime flags, and consent state
- Bounded crash metadata when an error report is generated: error type, sanitized error text/stack, OS/WebView information, bounded memory fields, and recent lifecycle event types

The `mediaHash` header field is only populated when an operator explicitly
supplies the published W1-A fixture-pack hash for a validation run. Project
hashes are not uploaded.

### Windows video-path instrumentation

Schema-v2 sessions may include a `windows-video-path` record in the
`native.windows.video` scope. It is supplementary, metadata-only evidence for
the Windows DXGI zero-copy path and contains:

- event-site DXGI attempt/success/fallback counters, bounded HRESULT and
  import-duration histograms, and keyed-mutex observations. Keyed-mutex
  observations are tri-state: `keyedMutexPresent`, `keyedMutexAbsent`, and
  `keyedMutexUnprobed`; their sum equals `attempts`, and `unprobed` is used
  when an import failed before the resource could be inspected;
- observed decode adapter vendor/device IDs and default-device retry facts;
  `luidsEqual` remains `null` until it is measured;
- bounded legacy latch observations and ownership-hazard counters; and
- when `CLYPRA_DXGI_SCOPED_LATCH=1`, a `scopedLatch` object containing the
  experiment arm, scoped latch events, path-free stream-class keys, currently
  latched classes, breaker promotions, and re-probe attempt/success counts.
  Stream classes contain only codec, profile, bit depth, chroma format, and a
  size bucket; paths and media identifiers are not accepted;
- the existing frame-source totals.

The debug-only `force_dxgi_latch` command can mark a session as `synthetic` and
inject a small observation profile so the Rust → NDJSON → linter → ingest
contract can be checked on macOS. Synthetic records validate the telemetry
pipeline, not Windows hardware behavior. Upload requires the first-run
disclosure and remains controllable in Settings, and the separate `clypra-api`
ingest contract stores this record as supplementary
session evidence rather than treating it as a performance verdict.

### Windows video-path instrumentation

Schema-v2 sessions may include a `windows-video-path` record in the
`native.windows.video` scope. It is supplementary, metadata-only evidence for
the Windows DXGI zero-copy path and contains:

- event-site DXGI attempt/success/fallback counters, bounded HRESULT and
  import-duration histograms, and keyed-mutex observations. Keyed-mutex
  observations are tri-state: `keyedMutexPresent`, `keyedMutexAbsent`, and
  `keyedMutexUnprobed`; their sum equals `attempts`, and `unprobed` is used
  when an import failed before the resource could be inspected;
- observed decode adapter vendor/device IDs and default-device retry facts;
  `luidsEqual` remains `null` until it is measured;
- bounded latch observations and ownership-hazard counters; and
- the existing frame-source totals.

The debug-only `force_dxgi_latch` command can mark a session as `synthetic` and
inject a small observation profile so the Rust → NDJSON → linter → ingest
contract can be checked on macOS. Synthetic records validate the telemetry
pipeline, not Windows hardware behavior. Upload remains opt-in only, and the
separate `clypra-api` ingest contract stores this record as supplementary
session evidence rather than treating it as a performance verdict.

## What is NOT collected
- Project names, file paths, project hashes, or media content
- User account information
- Persistent installation identifiers by default
- Raw pointer coordinates, individual wheel event timestamps, or user interaction paths
- Hostnames or IP addresses (beyond standard TLS connection metadata)

## Retention

Session reports are retained for **90 days**, after which they are automatically deleted from both object storage and the database.

## Deletion

To request deletion of a session, note the Session ID shown in the Diagnostics tab and contact [support] or open a GitHub issue with the subject "Telemetry deletion request".
