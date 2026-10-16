# Clypra Program Preview Subsystem: As-Is Technical Audit

> [!WARNING]
> Preliminary agent notes. Not verified. Superseded by `docs/preview-audit/`.

## 1. System Scope & Boundaries

This audit documents the runtime architecture, state machines, IPC boundaries, and execution flows of Clypra's Program Preview subsystem (`v1.6.1`).

### Scope Boundaries
- **Included**:
  - `src/components/editor/preview/NativeProgramPreview.tsx`: The desktop render loop and presenter coordinator.
  - `src/components/editor/preview/useNativeSurfaceController.ts`: Operating system child window and surface lifecycle management.
  - `src/components/editor/preview/nativePreviewScheduler.ts`: Frame request generation and lookahead cache.
  - `src/components/editor/preview/adaptiveReadbackPolicy.ts`: Canvas readback rate and dimension throttling.
  - `src/components/editor/preview/previewHardwarePolicy.ts`: GPU tier classification and quality adjustments.
  - `src-tauri/src/commands/native_preview.rs`: Rust IPC handlers for native presentation and CPU frame readback.
  - `src-tauri/src/wgpu_compositor/`: Hardware-accelerated compositing pipelines.
- **Excluded**:
  - Web browser preview mode (HTML5 `<video>` preview path, isolated from desktop runtime).
  - Source monitor / asset inspection preview (`SourcePreview.tsx`).
  - Export composition and encoding pipelines (except shared compositor shader interfaces).

---

## 2. Evidence Tag Taxonomy

All claims, invariants, and behaviors in this audit are referenced using standard evidence tags:

| Tag Format | Source Type | Verification Mechanism |
| :--- | :--- | :--- |
| `[CODE:filepath#Lxxx]` | Source code repository | Line-range reference in version-controlled files |
| `[TEST:suiterange#testname]` | Automated test suite | Vitest, Playwright, or Cargo test suite execution |
| `[TELEMETRY:metric_name]` | Field telemetry | Production NDJSON telemetry schema field in `perf_logs/` |
| `[BENCHMARK:fixture]` | Automated benchmark | Output JSON from `scripts/benchmarks/` harness |
| `[UNMEASURED]` | Architectural property | Logical or systemic property lacking runtime timing instrumentation |

---

## 3. Audit Structure

The audit is organized into the following documents:

1. [`01-state-catalog.md`](./01-state-catalog.md): Complete ledger of closure variables, React state, refs, and backend atomics.
2. [`02-call-sites.md`](./02-call-sites.md): Explicit catalog of IPC invocations, clock subscriptions, and drawing calls.
3. [`03-flows/`](./03-flows/): Sequence and lifecycle documentation for:
   - [`01-playback-loop.md`](./03-flows/01-playback-loop.md): Continuous native playback and fallback loops.
   - [`02-pause-handover.md`](./03-flows/02-pause-handover.md): Atomic handover between native surface and canvas backing store.
   - [`03-scrub-settle.md`](./03-flows/03-scrub-settle.md): Dual-lane scrub resolution throttling and settlement.
   - [`04-overlay-rendering.md`](./03-flows/04-overlay-rendering.md): Text, sticker, and transform overlay compositing.
   - [`05-unch-sentinel.md`](./03-flows/05-unch-sentinel.md): The `UNCH` unchanged frame short-circuit protocol.
4. [`04-coverage-ledger.md`](./04-coverage-ledger.md): Mapping of architectural invariants and failure modes to automated tests.
5. [`05-verification.md`](./05-verification.md): Systematic evaluation of 25 core subsystem claims against evidence tags.
