# Legacy Retirement Checklist

Legacy code is removed only after the replacement gate passes and the audit
below is clean. Temporary migration adapters are allowed on the branch, but
they must have an owner and a deletion gate.

## Program path

- [ ] No hidden `<video>` element or browser frame-readiness dependency.
- [ ] No `PreviewMediaPool` ownership.
- [ ] No browser playback scheduler owns program frame selection.
- [ ] No `VideoTextureManager` video decode/compositing path.
- [x] Native surface receives the authoritative final frame for playback,
      pause, seek, scrub, and frame-step.
- [x] Desktop text is sent as typed snapshots; the desktop text raster bridge
      is no longer part of the native request path.

## Filmstrip and thumbnails

- [x] Tauri filmstrip requests use the versioned native frame service.
- [ ] Duplicate decoder commands are removed after the native service covers
      every thumbnail/source-still caller.
- [ ] Web and Capacitor adapters remain frozen and are not used to judge the
      desktop native migration.

## Playback and export

- [ ] Native audio output and sample-clock session pass A/V tests.
- [x] Native surface probe creates/configures the actual Tauri window surface
      without repainting the editor.
- [ ] Native surface/shared-texture playback passes the platform matrix
      (macOS, Windows, Linux X11, and Wayland hardware validation pending).
- [x] Export consumes the same versioned frame graph entry point as preview.
- [ ] Browser source-preview playback is removed.
- [ ] Legacy browser export frame pools are retired after native export coverage.

## Audit commands

Before deletion, run searches for `<video`, `VideoFrame`, `WebCodecs`, `MSE`,
`PreviewMediaPool`, `VideoTextureManager`, browser playback scheduler names,
and legacy export frame pools. Review every match by program/source/export
path; a global string match alone is not a sufficient audit.

## Performance telemetry — batch-ingest retirement

The old `POST /telemetry/ingest/batch` model has been replaced by the
session-file ingest model. The following items must be cleaned up before
the migration is considered complete.

### API (`clypra-api`)

- [ ] Delete `performanceStorage.persistToNeon()` and `persistToD1()` once
      `performance_telemetry_events` is confirmed empty of new writes.
- [ ] Drop the `performance_telemetry_events` table and remove it from
      `setupSchema` in `db.ts` once historical data has aged out (suggested:
      90 days after the `session-file` model goes live in production).
- [ ] Delete the deprecated forwarding stubs `getAllEvents()`,
      `getPreviewEvents()`, `getAudioEvents()`, `getTextEvents()` in
      `performanceStorageService.ts` after confirming no remaining callers.
- [ ] Remove unused `TelemetryBatchRequest` type from `types/performance.ts`
      after confirming no test or route references it.

### Desktop (`clypra`)

- [ ] Delete `saveToOfflineStorage()`, `drainOfflineQueue()`,
      `clearOfflineQueue()` from `telemetryCollector.ts` and remove the
      `clypra:telemetry:offline_queue` localStorage key.
- [ ] Delete `TelemetryTransportStatus.endpoint` field and
      `getTransportStatus()` method (or repurpose for `perfLogService`
      status) from `telemetryCollector.ts`.
- [ ] Delete the commented-out `DEFAULT_API_INGEST_URL` and
      `MAX_OFFLINE_BATCHES` constants from `telemetryCollector.ts`.
- [ ] Remove the no-op `setAppVersion()` method from `telemetryCollector.ts`
      after verifying no call sites remain.

### Studio (`clypra-studio`)

- [ ] Migrate all `recordStudioTextRender()` call sites in `clypra-studio`
      to the studio equivalent of `perfLogService.enqueue()`.
- [ ] Delete `clypra-studio/src/services/textPerformanceTelemetry.ts` after
      migration is complete.

### Deletion gate

All items above require:

1. `tsc --noEmit` passes on all three repos.
2. No references to the deleted symbol survive in source (grep audit).
3. `performance_telemetry_events` row count has not grown for ≥ 7 days.
