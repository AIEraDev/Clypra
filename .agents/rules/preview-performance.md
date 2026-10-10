# Clypra — Preview Performance & Rendering Rules
# Loaded automatically from .agents/rules/ by all agent tools.
# Supplements AGENTS.md, .agents/skills/clypra-preview-performance-engineering/SKILL.md, and docs/preview/NATIVE_SURFACE_ARCHITECTURE.md.

## 1. Runtime Presenter Verification
- Clypra supports two preview paths:
  - **Native GPU Surface (Default)**: Hardware-accelerated wgpu surface (Metal on macOS, Direct3D 12 on Windows).
  - **DOM / Canvas Fallback**: Canvas-based readback bridge when native surface is unavailable or disabled via `VITE_CLYPRA_NATIVE_SURFACE=0`.
- Never infer which path is active solely from an environment variable or config setting. Always verify the initialized presenter and fallback status at runtime.

## 2. Correctness Before Speed
- A performance comparison is completely invalid if the compared implementations produce materially different output or omit compositing steps.
- Before claiming a performance win, verify that both paths render equivalent:
  - Frame selections and playback positions.
  - Video scaling, aspect ratios, and device pixel ratios.
  - Multi-track alpha compositing, overlays, text, and transitions.
  - Color space and pixel format representations.

## 3. End-to-End Metrics Over Microbenchmarks
- Evaluate preview performance based on total user-visible outcomes:
  - **Frame Pacing**: Median, p95, and p99 frame intervals, and frame deadline misses (< 16.67ms for 60fps).
  - **Interactive Latency**: Time from seek action to visible frame update, and play command to motion.
  - **Resource Stability**: Steady-state memory footprint and GPU buffer reuse across repeated scrubs.
- GPU timer queries alone do NOT equal end-to-end performance; CPU submission, IPC synchronization, and OS window presentation must all be accounted for.

## 4. Hot-Path Rendering Loop Invariants
- **No Blocking Waits**: Never introduce synchronous GPU waits or device stalls into per-frame render loops.
- **No Console Logging**: Never call `console.log` or verbose diagnostics in requestAnimationFrame or render loops.
- **No Non-Essential IPC**: Never dispatch non-essential Tauri IPC calls inside RAF loops.
- **Closure Discipline**: Guard stateful render loop variables with epoch counters and guarantee `renderInFlight = false` on every exit path (returns, catches, and error states).
- **Readback Minimization**: Eliminate synchronous GPU-to-CPU readbacks from the presentation hot path.
