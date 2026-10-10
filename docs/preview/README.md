# Preview System Documentation

This directory contains technical documentation for Clypra's Program Preview subsystem.

## Documents

| Document | Contents |
|---|---|
| [NATIVE_SURFACE_ARCHITECTURE.md](./NATIVE_SURFACE_ARCHITECTURE.md) | Full architecture reference: presenter modes, enabling native surface, render loop diagrams, A/B performance gate results, all 6 bug records with diffs and test counts, telemetry format, key files table, platform scope. |
| [PERFORMANCE_ANALYSIS_AND_ROUTING.md](./PERFORMANCE_ANALYSIS_AND_ROUTING.md) | Decision record: why the bridge was always used (root cause), what was measured on bridge, the A/B measurement methodology and results, the native-first routing decision with reasoning, Windows gate conditions, open questions. |
| [RENDER_LOOP_DEVELOPER_GUIDE.md](./RENDER_LOOP_DEVELOPER_GUIDE.md) | Working in the render loop: file layout by line range, all closure variables, invariants that must be maintained, path selection reference, how to add a new fix safely, quick references for AdaptiveReadbackPolicy / NativePreviewFrameScheduler / PlaybackPushBridge. |

## Quick links

- **Run dev (native surface default):** `pnpm tauri dev`
- **Force bridge fallback in dev:** `VITE_CLYPRA_NATIVE_SURFACE=0 pnpm tauri dev`
- **Run regression suite:** `npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`
- **Session logs:** `~/Library/Application Support/com.deenminder.clypra/perf_logs/`
- **Main render loop:** [`src/components/editor/preview/NativeProgramPreview.tsx`](../../src/components/editor/preview/NativeProgramPreview.tsx)

## Status

| Item | State |
|---|---|
| Native surface — macOS Metal | ✅ Enabled and A/B validated |
| Bugs 1–6 — render loop fixes | ✅ All fixed, 106 tests passing |
| Windows native surface gate | ⏳ In progress (4-week window) |
| VideoToolbox zero-copy import | 🔲 Not yet confirmed |
| Linux native surface | ❌ Not planned (bridge only) |
