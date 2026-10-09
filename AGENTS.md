# Clypra — Agent Rules (AGENTS.md)
# Loaded automatically by: Antigravity, KIRO, Codex, Cursor, Copilot, and all AGENTS.md-aware tools.

## What this project is
Clypra is a native desktop video editor — `v1.5.9`, macOS/Windows.
Stack: **Tauri 2.x** (Rust backend) + **React 18** (TypeScript frontend) + **wgpu/Metal** renderer.
Monorepo root: this directory. Rust crate: `src-tauri/`. Frontend: `src/`.

---

## Non-negotiable rules every agent must follow

### 1. Read the skill before starting any non-trivial task
`.agents/skills/clypra-dev/SKILL.md` covers the entire system: stores, types, rendering pipeline,
audio, export, AI features, IPC, telemetry, and architectural invariants.
Always read it before making architectural decisions or implementing new subsystems.

### 2. Fix discipline — one bug = one fix + one test
- Every production code change that fixes a bug **must** have a corresponding test appended to
  `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`.
- Tests are appended in `describe("Bug N — <title>", () => { ... })` blocks.
- Never skip a test. Never delete an existing test. Current baseline: **131 tests**.
- Run `npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`
  before finishing — all tests must pass.

### 3. TypeScript must compile clean
- Run `npx tsc --noEmit` after every change. Zero `error TS` lines required.
- Vite silently serves stale bundled code when TS errors exist. This is the #1 cause
  of "my fix isn't working" — the code was never compiled.

### 4. EvaluatedScene is the rendering currency
- All render paths (preview, export, thumbnail, filmstrip) consume `EvaluatedScene`
  produced by `evaluateTimelineSceneCached()`.
- Never re-read `timelineStore` directly inside a render hot path.

### 5. Timeline mutations go through commands
- Any mutation that should be undoable must use `historyStore.dispatch(command)`.
- Direct array mutations on `timelineStore` clips/tracks bypass undo history.

### 6. Asset paths are async — never assume they are resolved
- `asset.path` is `""` until the probe completes. Guard before passing to Rust.
- `getActiveAudioClips()` enforces `.filter(c => Boolean(c.path))` — do not remove this.

### 7. IPC is expensive — batch and debounce
- Every `invoke()` costs 0.5–2ms warm, 50–500ms cold.
- Never call `invoke()` inside a RAF callback for non-frame-essential work.

### 8. Never mutate shared state inside a RAF callback without an epoch guard
- The preview render loop in `NativeProgramPreview.tsx` uses closure variables.
- Every mutation must be guarded by the epoch/generation counter.
- `renderInFlight` must be reset in every exit path. Missing reset = permanent freeze.

### 9. Native surface requires the env flag
- `EMBEDDED_PREVIEW_ONLY = import.meta.env.VITE_CLYPRA_NATIVE_SURFACE !== "1"`
- To test the native path: `VITE_CLYPRA_NATIVE_SURFACE=1 pnpm tauri dev`
- Default dev/prod builds use the web-canvas path — do not change this default.

### 10. Singleton services require a full dev server restart after changes
- `PlaybackClock.ts` and `nativeAudioPreviewController.ts` are module-level singletons.
- HMR cannot update them. Always restart after changes to these files.

### 11. Preserve all existing comments and docstrings
- Do not remove comments unrelated to your change.
- Do not rewrite JSDoc blocks you did not touch.

---

## Key commands
```bash
pnpm dev                                    # web-canvas dev server
VITE_CLYPRA_NATIVE_SURFACE=1 pnpm tauri dev # native surface dev server
npx tsc --noEmit                            # TypeScript type check
npx vitest run src/.../__tests__/ProgramPreview.renderLoop.test.ts
pnpm test                                   # all JS tests
cargo test --manifest-path src-tauri/Cargo.toml  # Rust tests
pnpm tauri build                            # production build
```

## Key docs
- `.agents/skills/clypra-dev/SKILL.md` — full system reference (read this first)
- `docs/preview/NATIVE_SURFACE_ARCHITECTURE.md` — native render path deep dive
- `docs/preview/RENDER_LOOP_DEVELOPER_GUIDE.md` — closure invariants
- `docs/preview/PERFORMANCE_ANALYSIS_AND_ROUTING.md` — A/B perf data
