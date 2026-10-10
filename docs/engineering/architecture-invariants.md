# Clypra Architecture Contracts & Enforceable Invariants

## 1. Mission & Architectural Intent

Clypra is a high-performance cross-platform desktop non-linear video editor (NLE) built with Tauri v2, React 19, TypeScript 5.8, Rust, and wgpu.
To prevent AI coding agents and human contributors from making incompatible architectural decisions across sessions, this specification establishes **explicit, testable architecture contracts** across Clypra's core domains.

The governing principle of the Clypra harness is:
> **Do not try to make agents flawless through increasingly elaborate prompts. Make incorrect work difficult to merge, failures easy to diagnose, and architectural violations easy to detect.**

---

## 2. Seven Prioritized Architecture Contracts

### Domain 1: Timeline & Editing Operations
- **Contract**:
  - `PlaybackClock.ts` is the **single session authority** for playback time. No secondary clocks, intervals, or decoupled playback timers may be introduced.
  - `timelineStore` is the state authority for clips, tracks, transitions, and gaps.
  - All undoable edits must be dispatched through `historyStore.dispatch(command)` using the command pattern (`src/core/commands/`).
  - Timeline state is serialized to disk exclusively by `projectStore`; no other store performs disk I/O.
- **Invariants**:
  - `EvaluatedScene` emitted by `evaluateTimelineSceneCached()` is the universal rendering currency. Render loops must **never** read `timelineStore.getState()` directly.
  - `EvaluatedScene` is immutable once created.
  - SMPTE and timecode calculations must use integer frames and exact rational framerates without floating-point accumulation drift.

### Domain 2: Preview Architecture & Presenter Selection
- **Contract**:
  - Clypra defaults to the **Native GPU Preview Surface** (`NativeProgramPreview.tsx`), powered by `wgpu` (Metal on macOS, Direct3D 12 on Windows).
  - When native surface initialization fails or is disabled via `VITE_CLYPRA_NATIVE_SURFACE=0`, the application activates the **DOM/Canvas Readback Bridge** (`ProgramPreview.tsx`).
- **Invariants**:
  - The runtime presenter must be verified directly; agents must never infer the active preview path solely from environment variables.
  - `NativeProgramPreview.tsx` render loop uses closure variables. Mutations must be guarded with epoch counters, and `renderInFlight = false` must be reset across **all exit paths** (early returns, errors, cleanup).
  - Zero blocking GPU waits (`device.poll(Maintain::Wait)`) in per-frame rendering loops.
  - Zero `console.log` calls or non-essential Tauri IPC calls in `requestAnimationFrame` loops.
  - `ProgramPreview.renderLoop.test.ts` is append-only (current baseline: **156 tests**).

### Domain 3: Media Processing & FFmpeg Lifecycle
- **Contract**:
  - All native media decoding and encoding is managed by Tier 3 (Rust backend) utilizing FFmpeg 8.x / `ffmpeg-next` and VideoToolbox / MediaFoundation hardware acceleration.
  - Sidecar executables (`ffmpeg`, `ffprobe`) must be invoked through Tauri's managed sidecar APIs with platform-specific executable extensions (`.exe` on Windows).
- **Invariants**:
  - Media export runs concurrently with the UI. The export pipeline must **never** mutate timeline or project store state.
  - Active FFmpeg processes must support immediate cooperative cancellation and SIGKILL cleanup on cancel or window close.
  - Output files must be validated for header integrity, stream presence, and duration before declaring export success.

### Domain 4: Project Persistence & Data Recovery
- **Contract**:
  - Project persistence is owned strictly by `projectStore.ts`.
  - Schema versioning must be explicit (`schemaVersion: number`).
  - Migrations must be forward-only and non-destructive.
- **Invariants**:
  - Save operations must write to temporary files (`project.clypra.tmp`) and atomically rename to prevent corruption during crashes or power loss.
  - Autosaves are isolated from explicit user saves and stored under the recovery cache.
  - Unrecognized project fields must be preserved during schema round-trips to maintain backward compatibility.

### Domain 5: Frontend and Rust Boundary (Tauri IPC)
- **Contract**:
  - All communication between React and Rust traverses Tauri v2 commands and strongly typed events.
  - Rust commands must return `Result<T, String>` with actionable, structured error diagnostics.
- **Invariants**:
  - File path arguments passed from TypeScript to Rust must pass through `nativeCore.ts` path normalization.
  - All filesystem access must respect Tauri security capabilities (`src-tauri/src/commands/security.rs`).
  - IPC invocations must be batched with `Promise.all()` where ordering permits.
  - Asset paths: `MediaAsset.path` is empty (`""`) until probed; never pass empty paths to Rust IPC commands.

### Domain 6: Cross-Platform Behavior
- **Contract**:
  - Clypra targets macOS (`aarch64` / `x86_64`), Windows (`x86_64`), and Linux (`x86_64`).
  - WebViews: WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux.
- **Invariants**:
  - Zero OS branching in core timeline math, SMPTE conversion, or track composition.
  - File paths must never be manipulated via raw string concatenation with `/` or `\\`.
  - Independent 3-Gate Validation: Successful compilation or tests on macOS does not establish readiness on Windows or Linux.

### Domain 7: Internationalization & Accessibility
- **Contract**:
  - Clypra provides 100% feature parity across 9 first-party locales (`en`, `ru`, `es`, `ja`, `de`, `fr`, `ko`, `zh-CN`, `zh-TW`).
  - Semantic translation keys live in `src/i18n/catalogs/en.json`.
- **Invariants**:
  - Zero hardcoded user-facing strings in React JSX, tooltips, modals, or native menus.
  - 100% key and placeholder parity across all 9 catalogs enforced via `npm run i18n:check`.
  - Number and date formatting must use `Intl.NumberFormat` and `Intl.DateTimeFormat`.

---

## 3. Mechanically Enforceable Architecture Checks

| Invariant | Mechanical Rule | Enforcement Tool |
|---|---|---|
| **Render Loop Currency** | Prohibit `timelineStore.getState()` inside `NativeProgramPreview.tsx` | `scripts/harness/check-architecture.mjs` |
| **Store Isolation** | Prohibit store action files importing and invoking actions of other stores | `scripts/harness/check-architecture.mjs` |
| **Preview Test Baseline** | Prohibit deleting or skipping tests in `ProgramPreview.renderLoop.test.ts` (>= 156) | `scripts/harness/check-architecture.mjs` |
| **i18n Catalog Parity** | 100% key parity across all 9 supported locales | `npm run i18n:check` |
| **Documentation Links** | 0 broken local Markdown links in documentation | `npm run docs:check` |
| **Multi-Agent Skills Sync**| 100% sync between `.agents/skills/` and `.kiro/skills/` | `npm run skills:check` |
| **Strict Type Safety** | 0 TypeScript errors across the repository | `npx tsc --noEmit` |

---

## 4. Architectural Change Protocol (ADRs)

When a proposed change alters module boundaries, public interfaces, store ownership, asynchronous coordination, or project persistence schemas:
1. Author an Architectural Decision Record (ADR) under [`docs/architecture/adr/`](../architecture/adr/README.md).
2. Follow ADR template: Context, Decision, Consequences, Invariants, and Migration Strategy.
3. Update relevant contracts in this document.
4. Update mechanical enforcement checks in `scripts/harness/check-architecture.mjs`.
