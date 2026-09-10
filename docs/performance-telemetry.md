# Clypra Performance Telemetry Architecture

> **Last updated:** September 2026  
> **Status:** Production — session-file ingest model active

---

## 1. Overview

Clypra's telemetry system collects anonymous, strictly numerical performance data so engineers can maintain SLA budgets across a fragmented hardware and OS matrix. All data collection follows a **Zero-PII** privacy contract and a **one-row-per-session** storage model.

### SLA Budgets

| Metric                         | Target               |
| ------------------------------ | -------------------- |
| Timeline playback frame render | ≤ 16,667 µs (60 fps) |
| Cold keyframe seek latency     | ≤ 100 ms             |
| Dropped frame ratio            | ≤ 1%                 |
| A/V drift                      | ≤ ±16 ms             |

---

## 2. Zero-PII Privacy Guarantee

The following are **never** collected:

- Video pixel buffers, audio samples, image thumbnails
- File paths, project names, timeline labels, caption text
- Usernames, email addresses, IP addresses, device identifiers

The following are collected — all anonymous and numerical:

- Stage render timings (decode µs, compose µs, GPU queue µs, total frame µs)
- Seek latency durations and dropped frame ratios
- Hardware context: OS family, CPU cores, GPU model, graphics backend
- Video profile: codec, resolution bucket, bit depth, HDR format
- Workload mode: playback, seek, scrub, export, AI inference

---

## 3. End-to-End Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Clypra Desktop (Tauri)                        │
│                                                                  │
│  Playback / Seek Pipeline                                        │
│       │                                                          │
│       ▼  Adaptive Sampler (100% on drops/anomalies, 1% nominal) │
│  telemetryCollector.enqueueEvent()                               │
│       │  ─ maps to PerfLogKind                                   │
│       ▼                                                          │
│  perfLogService.enqueue()   ◄── playbackTrace events            │
│       │  ─ also receives native-sync polls (every 30s)          │
│       │  ─ also receives clypra://native-diagnostic events       │
│       │                                                          │
│  [NDJSON file on disk]  ← appended every 30s                    │
│  ~/Library/…/clypra/perf_logs/session-<epoch>-<uuid>.ndjson     │
│                                                                  │
│  On window close → perfLogService.closeAndUpload()              │
│       │                                                          │
│       ▼  Single HTTP POST (entire session file)                  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              Clypra Edge API (Cloudflare Worker)                 │
│                                                                  │
│  POST /performance/telemetry/ingest/session                      │
│       │                                                          │
│       ▼  performanceStorage.ingestSession()                      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐      │
│  │            session_perf_logs (Neon PostgreSQL)         │      │
│  │                                                        │      │
│  │  session_id     VARCHAR(128)                           │      │
│  │  app_version    VARCHAR(50)   ← indexed                │      │
│  │  os_family      VARCHAR(50)   ← indexed                │      │
│  │  gpu_vendor     VARCHAR(50)   ← indexed                │      │
│  │  gpu_model      VARCHAR(255)                           │      │
│  │  workload_modes TEXT[]                                 │      │
│  │  total_entries  INT                                    │      │
│  │  telemetry_events INT                                  │      │
│  │  entries        JSONB   ← complete session payload     │      │
│  │  received_at    TIMESTAMPTZ  ← indexed                 │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
│       ONE ROW PER SESSION                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              Analytics read path (GET comparison routes)         │
│                                                                  │
│  performanceStorage.getSessionEvents(filters)                    │
│  → queries session_perf_logs by indexed summary columns          │
│  → expands entries JSONB per row                                 │
│  → returns flat PerformanceEventPayload[]                        │
│  → feeds unchanged analytics engine functions                   │
│                                                                  │
│  GET /comparison/os, /comparison/hardware,                       │
│      /comparison/preview, /comparison/audio,                     │
│      /comparison/text, /comparison/releases,                     │
│      /comparison/exports, /comparison/sessions,                  │
│      /edge-cases/anomalies, /edge-cases/fallbacks,               │
│      /edge-cases/worst-performers, POST /comparison/matrix       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Session Log File Format

Each session accumulates a local **NDJSON** file (one JSON object per line, append-safe). The file is written by the Rust `open_perf_log_session` / `append_perf_log_entries` / `close_perf_log_session` commands and is never accessed on the hot render path.

### File location

```
macOS:   ~/Library/Application Support/com.clypra.app/perf_logs/
Windows: %APPDATA%\com.clypra.app\perf_logs\
```

File name: `session-<epoch_ms>-<short_uuid>.ndjson`

### Entry structure

Each line:

```json
{
  "kind": "frontend-rollup",
  "session_id": "launch-1725890442123-ab3f7",
  "timestamp_epoch_ms": 1725890472000,
  "payload": { ... PerformanceEventPayload ... }
}
```

### Entry kinds

| Kind                | Payload type              | Description                                         |
| ------------------- | ------------------------- | --------------------------------------------------- |
| `frontend-rollup`   | `PerformanceEventPayload` | 30s frame render rollup window                      |
| `seek-span`         | `PerformanceEventPayload` | Cold / warm seek latency event                      |
| `export-span`       | `PerformanceEventPayload` | Export transcode completion                         |
| `audio-snapshot`    | `PerformanceEventPayload` | Audio engine health window                          |
| `text-rollup`       | `PerformanceEventPayload` | Text renderer window                                |
| `fallback-event`    | `PerformanceEventPayload` | WebGPU→WebGL or HW→SW fallback                      |
| `ai-inference`      | `PerformanceEventPayload` | Whisper / auto-reframe / silence detection          |
| `native-sync`       | `SyncMetricsSnapshot`     | A/V drift, frame pacing, seek correctness from Rust |
| `native-diagnostic` | `NativeDiagnostic`        | Warnings / errors from the Tauri event bridge       |
| `playback-trace`    | `PlaybackTraceEvent`      | State transitions, dropped frames, slow stages      |

---

## 5. Client-Side Components

### `perfLogService.ts` (`src/services/perfLogService.ts`)

Singleton service. Opened at app init, closed on window exit.

| Method                   | When called                                            | What it does                                                                         |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `openSession(sessionId)` | App mount (`initializeApp`)                            | Calls `open_perf_log_session` Rust command; starts flush timer and sync-metrics poll |
| `enqueue(entry)`         | `telemetryCollector.enqueueEvent()`, `tracePlayback()` | Adds entry to in-memory queue                                                        |
| `closeAndUpload()`       | Window close, `visibilitychange: hidden`               | Flushes queue, calls `close_perf_log_session`, calls `upload_perf_log_session`       |
| `getSessionId()`         | Any service needing session context                    | Returns current `sessionId`                                                          |

Flush cadence: every **30 s** in production, **5 s** in development.

### `telemetryCollector.ts` (`src/services/telemetryCollector.ts`)

Collects frame events and routes them to `perfLogService`. The old `POST /telemetry/ingest/batch` network path is **removed**. `flushQueued()` drains the in-memory queue without sending to the API.

Adaptive sampling:

- **1%** on nominal smooth frames (totalTimeUs ≤ 16,667, no drops)
- **100%** on anomalies (drop ratio > 5%, frame time > 16,667 µs, seek > 100 ms)
- **100%** on fallback events (flushed immediately)

### `appVersion.ts` (`src/lib/app/appVersion.ts`)

Shared version resolver. Reads from `@tauri-apps/api/app`'s `getVersion()` — the authoritative source tied to `tauri.conf.json` / `Cargo.toml`. Result cached for the process lifetime. Called by both `telemetryCollector` and `perfLogService`. `primeAppVersion()` is called at app startup in `main.tsx` to warm the cache before any event is collected.

### Rust commands (`src-tauri/src/diagnostics/perf_log.rs`)

| Command                                                     | Description                                       |
| ----------------------------------------------------------- | ------------------------------------------------- |
| `open_perf_log_session(session_id)`                         | Creates NDJSON file; returns `PerfLogSessionInfo` |
| `append_perf_log_entries(session_id, entries)`              | Appends NDJSON lines; async, non-blocking         |
| `close_perf_log_session(session_id)`                        | Flushes and closes file; returns file path        |
| `upload_perf_log_session(file_path, api_base_url, api_key)` | Reads completed file, POSTs to `/ingest/session`  |
| `list_perf_log_files()`                                     | Returns metadata for all on-disk log files        |
| `purge_perf_logs(max_age_days?)`                            | Deletes files older than N days (default 7)       |

---

## 6. API Endpoints

### Active ingest endpoint

```
POST /performance/telemetry/ingest/session
```

**Request body:**

```typescript
{
  entryCount: number;          // total entries (used for quick validation)
  entries: SessionPerfLogEntry[];
}
```

**Response (202 Accepted):**

```typescript
{
  status: "accepted";
  sessionId: string;
  receivedAt: string; // ISO 8601
  totalEntries: number;
  telemetryEvents: number; // entries expanded to PerformanceEventPayload
  auditRows: number; // session_perf_logs rows written (always 1)
  skipped: number; // entries that failed validation
  persistenceStatus: "saved" | "partial" | "failed";
  storage: "neon" | "d1" | "neon+d1" | "none";
}
```

Entry size cap: **50,000 entries** per session (413 if exceeded).

### Tombstoned endpoints (410 Gone)

These endpoints were active before the session-file model. They now return `410 Gone` with a pointer to `/ingest/session`. Any stale client will receive an actionable error rather than silently writing data.

| Endpoint                       | Reason                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| `POST /telemetry/ingest/batch` | Was the source of 500+ rows/session. Replaced by `/ingest/session`. |
| `POST /benchmarks/submit`      | No live callers. Benchmark data belongs in the session file.        |
| `POST /benchmarks/evaluate`    | No live callers. SLA evaluation applied inside `ingestSession()`.   |

### Analytics read endpoints

All read from `session_perf_logs` via `getSessionEvents()`. No reads from `performance_telemetry_events`.

| Endpoint                           | Description                                                         |
| ---------------------------------- | ------------------------------------------------------------------- |
| `GET /comparison/os`               | Cross-OS p50/p95/p99 render time, dropped frame ratio, seek latency |
| `GET /comparison/hardware`         | GPU tier ranking by primary bottleneck stage                        |
| `GET /comparison/preview`          | DOM/WebView vs native child-surface comparison                      |
| `GET /comparison/audio`            | Audio engine callback health and underrun rates                     |
| `GET /comparison/text`             | Text renderer cohort analysis by kind / phase / renderer path       |
| `GET /comparison/video-profiles`   | Codec × resolution × bit-depth impact matrix                        |
| `GET /comparison/releases`         | Build-over-build regression (p95 render time delta, p-value)        |
| `GET /comparison/exports`          | Export transcode throughput, real-time factor                       |
| `GET /comparison/sessions`         | Session rollup aggregations, jank distributions, A/V drift          |
| `POST /comparison/matrix`          | Arbitrary multi-dimensional cohort query                            |
| `GET /edge-cases/anomalies`        | Statistically anomalous device/driver/video cohorts                 |
| `GET /edge-cases/fallbacks`        | Hardware fallback frequency and top impacted devices                |
| `GET /edge-cases/worst-performers` | Slowest hardware configurations by pipeline stage                   |
| `GET /benchmarks/suites`           | Static benchmark test manifests                                     |
| `GET /benchmarks/baselines`        | SLA budget constants                                                |

---

## 7. Database Schema

### `session_perf_logs` (primary performance store)

```sql
CREATE TABLE session_perf_logs (
  id                SERIAL PRIMARY KEY,
  session_id        VARCHAR(128)   NOT NULL,
  app_version       VARCHAR(50),                    -- indexed
  app_environment   VARCHAR(50)    DEFAULT 'production', -- indexed
  os_family         VARCHAR(50),                    -- indexed
  gpu_vendor        VARCHAR(50),                    -- indexed
  gpu_model         VARCHAR(255),
  workload_modes    TEXT[],
  total_entries     INT            NOT NULL DEFAULT 0,
  telemetry_events  INT            NOT NULL DEFAULT 0,
  skipped           INT            NOT NULL DEFAULT 0,
  entries           JSONB,                          -- complete session payload
  received_at       TIMESTAMPTZ    DEFAULT NOW()    -- indexed
);
```

Summary columns (`os_family`, `gpu_vendor`, `app_version`, `app_environment`, `received_at`) are extracted at ingest from the first well-formed telemetry entry. Dashboard `WHERE` clauses hit B-tree indexes on these columns — no JSONB scan is needed for the most common filter patterns.

Analytics queries expand `entries` inline:

```sql
-- Example: all events from the last 30 days on Windows
SELECT entries
FROM session_perf_logs
WHERE received_at >= NOW() - INTERVAL '30 days'
  AND os_family = 'windows'
ORDER BY received_at DESC
LIMIT 200;
```

The application layer (TypeScript) then expands the JSONB array and feeds the `PerformanceEventPayload[]` to the analytics engine functions (`generateOSComparison`, `detectAnomalies`, etc.) unchanged.

### `performance_telemetry_events` (historical, no new writes)

The old expanded-row table is preserved for historical data. No new rows are written. It will be dropped in a future migration once the oldest retained data ages out.

---

## 8. Session Lifecycle

```
App launch
  └─ main.tsx: primeAppVersion()
  └─ App.tsx initializeApp(): perfLogService.openSession("launch-<epoch>-<uuid>")
       └─ Rust: open_perf_log_session → creates NDJSON file

During session
  └─ Every frame anomaly / rollup window / seek / export:
       telemetryCollector.enqueueEvent() → perfLogService.enqueue()
  └─ Every 30s: perfLogService flush timer → append_perf_log_entries (Rust)
  └─ Every 30s: sync-metrics poll → get_sync_metrics_snapshot → enqueue native-sync entry
  └─ On native-diagnostic event: enqueue native-diagnostic entry
  └─ On tracePlayback(): enqueue playback-trace entry

Window close (any exit path)
  └─ perfLogService.closeAndUpload()
       ├─ Flush remaining queue → append_perf_log_entries (Rust)
       ├─ close_perf_log_session (Rust) → returns file path
       └─ upload_perf_log_session (Rust) → POST /telemetry/ingest/session
            └─ ingestSession():
                 ├─ Extract summary columns from first telemetry entry
                 └─ Write ONE row to session_perf_logs

Visibility hidden (tab switch / OS sleep)
  └─ main.tsx visibilitychange: perfLogService.closeAndUpload() [best-effort]
```

---

## 9. App Version Resolution

All telemetry entries are stamped with the live app version via `getAppVersionSync()` from `src/lib/app/appVersion.ts`. This reads from `@tauri-apps/api/app`'s `getVersion()` which is derived from `tauri.conf.json` at build time — the same source the Settings → About screen uses. The value is cached after the first resolution so it is never read more than once per process.

**Do not hardcode version strings in telemetry code.** The `setAppVersion()` method on `telemetryCollector` is a no-op kept for compatibility; it does nothing.

---

## 10. File Retention & Housekeeping

Log files are retained on disk for **7 days** by default. `purge_perf_logs(max_age_days?)` deletes files older than the threshold and is safe to call at any time — it skips files belonging to open sessions.

Files that fail to upload (e.g. no network at close time) remain on disk. `list_perf_log_files()` returns their paths and sizes so a future session or manual tooling can retry the upload.

---

## 11. Deprecated Caller Checklist

The following code is marked `@deprecated` and must be removed in a follow-up:

| File                                                     | Symbol                                                                | Action                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `clypra/src/services/telemetryCollector.ts`              | `saveToOfflineStorage`, `drainOfflineQueue`, `clearOfflineQueue`      | Delete methods and localStorage key `clypra:telemetry:offline_queue`                                            |
| `clypra/src/services/telemetryCollector.ts`              | `TelemetryTransportStatus.endpoint`                                   | Remove field; delete `getTransportStatus()` or repurpose for perfLogService status                              |
| `clypra-studio/src/services/textPerformanceTelemetry.ts` | Entire file                                                           | Migrate `recordStudioTextRender` call sites to the studio equivalent of `perfLogService.enqueue()`, then delete |
| `clypra-api/src/services/performanceStorageService.ts`   | `getAllEvents`, `getPreviewEvents`, `getAudioEvents`, `getTextEvents` | Delete after confirming no remaining callers outside the deprecated forwarding stubs                            |
| `clypra-api/src/services/performanceStorageService.ts`   | `persistToNeon`, `persistToD1`                                        | Delete after `performance_telemetry_events` table is dropped                                                    |
| `clypra-api/src/utils/db.ts`                             | `performance_telemetry_events` table creation                         | Drop table and remove from `setupSchema` once historical data ages out                                          |
