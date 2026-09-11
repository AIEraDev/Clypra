perf(windows): Phase 0-1-2 — telemetry credibility, scrub pipeline, DXGI zero-copy
---
## Overview

Three phases of the Windows performance roadmap in a single reviewable branch. Each phase is a separate, independently bisectable set of commits.

**Root problem:** Windows users on discrete GPUs (AMD RX 580) showed ~1,274 ms P95 seek latency vs ~35 ms on Apple M1. Three root causes confirmed in code: PCIe round-trip from D3D11VA decode, sequential GOP delta-frame decode on seeks, and `SeekQuality` computed but never passed to the decoder.

---

## Phase 0 — Telemetry Credibility

### A/V drift suppression guard
`sync_metrics.rs` · `native_audio.rs` · `commands/native_preview.rs`

The reported macOS A/V drift (92.87 ms P50) was a measurement artifact: when
`audio_position_ticks == 0` (video-only projects, sessions paused before first
playback, silent post-start stalls), every frame timestamp was recorded as
drift rather than real A/V error. The existing `running` flag was also
insufficient — a CPAL stream can persist with no error while its callback has
silently stopped firing.

- `native_audio.rs`: add `clock_epoch` (Instant) and `last_callback_ns`
  (Arc<AtomicU64>) to `NativeAudioClockInner`; CPAL callback writes
  `last_callback_ns` lock-free (Relaxed) on every invocation. Add
  `interval_ring [AtomicU64; 8]` + `interval_cursor` — a lock-free ring buffer
  of inter-callback spacings in µs, written from the callback with no lock or
  allocation. `NativeAudioStatus` gains `clock_freshness_us: Option<u64>` and
  `median_callback_interval_us: Option<u64>`.
- `sync_metrics.rs`: add `DriftSuppressionConfig` (`staleness_multiplier=3.0`,
  `staleness_floor_us=50_000`) held behind `parking_lot::Mutex` so values can
  be updated at runtime without a release cut. `DriftAccumulator` gains
  `suppressed_count` + bounded `suppressed_p95` audit buffer.
  `record_with_freshness()` routes stale samples to the audit buffer; active
  `p95_abs_micros` is now clean. `DriftSnapshot` gains `suppressed_n`,
  `p95_abs_micros_suppressed`, and per-window `suppression_multiplier` /
  `suppression_floor_us` so post-ship queries know which threshold was active.
- `native_preview.rs`: replace `av_drift.record()` with
  `record_with_freshness()` passing `clock_freshness_us` and
  `median_callback_interval_us` from `NativeAudioStatus`.

**Notes:**
- For 512-frame/44.1 kHz buffers the adaptive term (~34.8 ms) falls below the
  50 ms floor, making the floor the effective threshold for that common cadence.
  Fleet buffer-size distribution query needed post-ship to confirm whether the
  adaptive term binds for any real cohort.
- Suppressed samples are auditable via `p95_abs_micros_suppressed` — expected
  to show large values (frame timestamps). Small values would indicate
  over-suppression and the floor needs tightening.
- Per-window config attribution: `suppression_multiplier`/`floor` on
  `DriftSnapshot` reflect config at snapshot time, not per-sample. Acceptable
  as long as config changes are discrete (release boundaries or diagnostic pushes).

**Verification:** 8/8 unit tests pass including a runtime config mutation test
that verifies both that updated thresholds take effect immediately and that each
snapshot records the config active at its reset point. Independently compiled
and run against the public repo commit `289cdf9`.

### Present mode preference
`commands/native_surface.rs`

Previous `choose_present_mode()` always selected strict Fifo (vsync), causing
a 60→30 fps stutter cliff on hybrid laptops when a frame missed vsync by <1 ms.

New priority: `Mailbox > FifoRelaxed > AutoVsync > Fifo > first available`.
Two unit tests added verifying Mailbox and FifoRelaxed are preferred when
present in the supported modes list.

### Pending perf log upload on startup
`diagnostics/perf_log.rs` · `diagnostics.rs` · `lib.rs` · `perfLogService.ts`

Sessions terminated abruptly (crash, force-quit, no network) left `.ndjson`
files on disk that were never uploaded.

- `upload_pending_perf_logs()` Tauri command: scans app data dir for `.ndjson`
  files not belonging to an active session and uploads each one.
- Successfully uploaded files are renamed to `.uploaded`; `purge_perf_logs()`
  cleans both extensions.
- `perfLogService.ts`: call `retryPendingUploads()` asynchronously after
  session open so prior offline sessions are ingested without blocking startup.

### Phase 1 verification script
`scripts/verify-telemetry-delta.mjs`

Queries `/comparison/os` and `/comparison/fleet-consistency`, computes deltas
against baseline production metrics, and validates against explicit Phase 1
falsification thresholds:

| Metric | Baseline | Target | Falsified if |
|---|---|---|---|
| Windows scrub P95 | 197 ms | < 30 ms | > 50 ms |
| Windows seek-cold P95 | 1,274 ms | < 250 ms | > 400 ms |
| Windows presentation wall time | 111 ms | < 15 ms | > 25 ms |
| Windows jank reduction | 23,975 events | > 70% reduction | < 70% |

Usage: `node scripts/verify-telemetry-delta.mjs [--api-url <url>] [--api-key <key>]`

---

## Phase 1 — SeekQuality End-to-End

**Problem:** `SeekQuality` (`"full"` / `"half"` / `"quarter"`) is computed
correctly in `seekController.ts` via `qualityForScrubVelocity()` and a parallel
`QualityTier` enum exists in Rust, but `FrameRequest.quality` was never read by
the decoder — full 4K frames were always decoded regardless of scrub velocity.
Two new fields (`is_scrubbing`, `allow_keyframe_approx`) needed to carry scrub
intent end-to-end.

### Contract + controller layer
`native_core/contracts.rs` · `seekController.ts` · `lib/platform/nativeCore.ts`

- `contracts.rs`: add `is_scrubbing: Option<bool>` and
  `allow_keyframe_approx: Option<bool>` to `FrameRequest` (both `#[serde(default)]`);
  derive `Default` on `QualityTier` (maps to `Full`); clear `is_scrubbing` in
  cache key normalisation so scrub frames do not pollute the exact-frame cache.
- `seekController.ts`: compute `isScrubbing` (true when `mode == "scrub"`)
  and `allowKeyframeApprox` (true during scrub — permits keyframe-only decode,
  false on release for exact frame); both propagate through `SeekIntent`.
- `nativeCore.ts`: add both fields to `NativeFrameRequest`.

### Frame request pipeline
`NativeProgramPreview.tsx` · `nativeVideoPreview.ts`

- `NativeProgramPreview.tsx`: pass `quality` from `latestSeekIntent` during
  scrub (overrides `renderTarget.quality` when `mode == "scrub"` and
  `quality != "full"`); forward `isScrubbing` and `allowKeyframeApprox`.
- `nativeVideoPreview.ts`: `buildNativeFrameRequest` accepts and spreads both
  new fields into the outgoing `NativeFrameRequest`.

### Stationary debounce
`components/editor/timeline/Playhead.tsx`

During active scrub the decoder returns keyframe approximations. When the
playhead stops moving the user expects the precise frame at that timestamp.

Add `stationaryTimerRef`: a 150 ms debounce that fires a follow-up seek with
`quality=full, allowKeyframeApprox=false` whenever the pointer has not moved
for 150 ms. Timer is cleared on every pointer move, pointer-up (which issues
its own exact seek), pointer cancel, window blur, and effect cleanup.

### Decoder data structures
`thumbnail_engine/decoder.rs`

- `CachedNv12Frame`: Arc-backed NV12 frame entry (Y plane, UV plane, dims,
  color metadata, PTS).
- `DecodeFrameOptions`: carries `allow_keyframe_approx` (skip delta-frame
  decode during active scrub, return nearest I-frame) and `quality`
  (`QualityTier`). Default is `Full`, exact frame.
- `VideoDecoder.raw_nv12_cache`: `VecDeque<CachedNv12Frame>` bounded at 16
  entries — back-and-forth scrubbing within a cached region costs 0 ms decode.
- `try_extract_dxgi_shared_handle()` (Windows-only): returns a DXGI NT shared
  handle from a D3D11VA hardware frame without a CPU copy. Returns `None` on
  non-Windows or non-D3D11 frames. This is the Phase 2 zero-copy entry point
  in the decoder; callers fall back to the standard CPU path on `None`.

---

## Phase 2 — DXGI Zero-Copy (Windows discrete GPU)

**Problem:** D3D11VA decodes frames into GPU VRAM →
`av_hwframe_transfer_data` copies to CPU RAM → wgpu uploads back to GPU VRAM.
On discrete GPUs this PCIe round-trip costs 10–14 ms per frame, consuming the
entire 16.67 ms 60 fps budget before any composition work begins. On Apple M1
(unified memory) the round-trip does not exist.

### wgpu DXGI import path
`wgpu_compositor/dxgi_import.rs` (new) · `wgpu_compositor.rs` · `wgpu_compositor/adapter_selector.rs`

- `dxgi_import.rs`: Windows-only module. `D3d11SharedFrame` wraps a D3D11VA
  frame + DXGI NT shared handle. `import_into_wgpu()` opens the handle into
  the DX12 device, creates NV12 biplanar wgpu texture views (R8Unorm Y +
  Rg8Unorm UV), closes the handle, and returns `ImportedNv12Texture` for
  direct shader binding — no `av_hwframe_transfer_data`, no `queue.write_texture`.
- `wgpu_compositor.rs`: expose `dxgi_import` module (`#[cfg(target_os = "windows")]`).
  Add `render_nv12_from_imported_texture()` to `NativePreviewSession` — accepts
  `ImportedNv12Texture`, binds biplanar views into the existing YUV→RGBA
  pipeline. Non-Windows and CPU-upload paths unchanged.
- `adapter_selector.rs`: boost DX12 backend score +500 on Windows so the
  adapter supporting D3D11VA DXGI interop is preferred over Vulkan.
- `Cargo.toml`: add `windows = "0.58"` (Windows-only) with minimal feature set
  (`Win32_Foundation`, `D3D11`, `D3D12`, `Dxgi`, `Dxgi_Common`).

> **Gate:** Phase 2 production rollout requires:
> 1. Phase 1 measured shortfall — proceed only if Phase 1 recovers **<40%** of
>    the RX 580 seek-cold latency gap vs RTX 4060 Ti (H4 criterion, measured
>    via `SeekSnapshot` in `SyncMetricsRegistry`)
> 2. Track A fleet confirmation — `uniqueSessionCount` (clypra-api
>    `phase/0-perf-telemetry`) confirms RX 580 is a real user cohort at scale

---

## Commit Map

| Commit | Scope | Description |
|---|---|---|
| `7e99897` | `perf(telemetry)` | Phase 0 — A/V drift freshness suppression guard |
| `a69b268` | `feat(seek)` | Phase 1 — isScrubbing + allowKeyframeApprox through contract |
| `8220918` | `feat(decoder)` | Phase 1 — LRU NV12 cache + DecodeFrameOptions |
| `6000194` | `feat(scrub)` | Phase 1 — 150ms stationary exact-frame settle |
| `6f72ab7` | `feat(seek)` | Phase 1 — SeekQuality through frame request pipeline |
| `dd83efe` | `feat(wgpu/windows)` | Phase 2 — DXGI zero-copy import + DX12 adapter preference |
| `ab1178a` | `chore(config)` | App identifier update + config formatting |
| `eb642be` | `chore(deps)` | Cargo.lock resolution |
| `4979c63` | `perf(wgpu)` | Phase 0 — Mailbox/FifoRelaxed present mode preference |
| `2064e14` | `feat(telemetry)` | Phase 0 — pending perf log upload + verification script |

## Related PRs
- **clypra-api** `phase/0-perf-telemetry` — Track A `uniqueSessionCount` + `GET /comparison/fleet-consistency` endpoint
- **clypra-studio** `phase/0-perf-telemetry` — Track C GPU confidence column + workload-scope footnote
