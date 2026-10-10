---
name: performance-reliability-engineering
description: >-
  Guides measurement-driven performance optimization, memory leak prevention, and reliability engineering in Clypra.
  Activate when diagnosing playback stutter, frame drops, high memory usage, IPC bottlenecks,
  Web Worker queue latency, export stalls, or GPU resource exhaustion.
---

# Performance and Reliability Engineering Workflow

## Mission & Scope

Clypra demands 60fps interactive responsiveness during timeline scrubbing and playback while concurrently managing multi-gigabyte media decoding, Web Worker scopes analysis, and native GPU compositing.

Performance and reliability engineering must be **measurement-driven and evidence-based**. Speculative optimizations frequently introduce cache invalidation bugs, memory leaks, resource exhaustion, and subtle race conditions.

---

## When to Activate This Skill

Activate this skill when:
- Investigating playback stutter, jank events, or dropped frames during preview.
- Optimizing memory footprint or addressing leaks across long editing sessions.
- Addressing IPC throughput limits between the React frontend and Rust backend.
- Tuning Web Worker latency (Scopes, Waveform generation, Text rasterization).
- Managing media decoding lifecycles, thumbnail tile generation, or mmap caches.
- Profiling and improving export throughput or frame batching.
- Investigating resource exhaustion or bottlenecks across CPU, memory, disk, or GPU.

## When NOT to Activate This Skill
- Initial feature design before a functional baseline exists (get it working and correct first).
- Pure styling, typography, or UI copy changes.
- Writing static unit tests for domain logic.

---

## The Required 8-Step Optimization Process

Before modifying code for performance, work through these 8 steps:

1. **Define the Observable Problem**:
   State the concrete, measurable performance or reliability defect with metrics:
   - *Weak*: "The timeline feels laggy when zooming."
   - *Rigorous*: "When zooming in on a 40-clip timeline, frame rate drops from 60fps to 18fps, producing 14 dropped frames in `frontend-rollup` telemetry because filmstrip tile requests are dispatched synchronously on every scroll delta."
2. **Establish the Workload & Baseline**:
   Identify the exact test scenario: clip count, video codec, timeline duration, resolution (1080p vs 4K), zoom level. Record the current baseline measurement before making any changes.
3. **Inspect & Measure the Actual Bottleneck**:
   Profile first. Read existing telemetry logs (`~/Library/Application Support/com.deenminder.clypra/perf_logs/` on macOS; `native-sync`, `seek-span`, `engine-telemetry`). Identify whether the bottleneck is CPU-bound, GPU-bound, memory-bound, disk-bound, or IPC latency.
4. **Identify Constraints & Latency Budgets**:
   Establish the relevant resource constraint (e.g. $<2\text{ms}$ main-thread event loop, $<12\text{ms}$ color scopes worker, $<100\,\mu\text{s}$ wgpu present).
5. **Evaluate Concurrency, Caching, Buffering & Scheduling**:
   Evaluate whether caching, buffering, or scheduling is the right mechanism, accounting for ownership, invalidation, and memory overhead.
6. **Implement the Smallest Justified Improvement**:
   Modify only the verified bottleneck. Never perform broad speculative refactorings under the banner of optimization.
7. **Validate Functional Correctness First**:
   Run the full regression suite to guarantee the change introduced zero regressions in playback, audio sync, or timeline math:
   ```bash
   npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts
   npx tsc --noEmit
   ```
8. **Compare Results with Baseline & Report Methodology**:
   Re-measure the workload under identical conditions. Report the before/after delta, measurement methodology, hardware environment, and any limitations.

---

## Media Engineering Trade-offs: Interactive Latency vs Background Throughput

Distinguish between two fundamentally different performance profiles in an NLE:

| Dimension | Interactive Preview (Playback / Scrub) | Background Export (Rendering) |
|---|---|---|
| **Primary Goal** | Lowest interactive latency ($<16\text{ms}$) | Maximum throughput across duration |
| **Frame Dropping** | Permitted (dropping intermediate scrub frames keeps UI responsive) | Strictly forbidden (every frame must be rendered) |
| **Pipeline Strategy** | Latest-only queues, debouncing, minimal buffering | Deep batching (4–8 frames), pipeline saturation, multi-threaded encode |
| **Memory Policy** | Bounded ring buffers to avoid stale frame backlog | Memory buffers sized for continuous pipeline feeding |

---

## Performance Fallacies to Avoid

- **Fallacy 1: Caching is always beneficial**.
  *Reality*: Unbounded caches cause memory leaks; stale caches cause subtle visual bugs. Every cache must have an explicit owner, a memory/entry budget, and a deterministic invalidation trigger.
- **Fallacy 2: More threads always improve performance**.
  *Reality*: Thread contention, context switching, and lock synchronization often degrade real-time performance.
- **Fallacy 3: Asynchronous execution automatically improves responsiveness**.
  *Reality*: Out-of-order responses, race conditions, and uncontrolled promise accumulation create UI jank and memory bloat.

---

## Reliability, Back-Pressure & Resource Lifecycle

- **Cache Ownership & Invalidation**: Every cache must have an explicit owner, an eviction policy (LRU, TTL, or memory cap), and an invalidation rule on clip edits or project close.
- **Back-Pressure & Queue Bounding**: Rapid user gestures (scrubbing, zooming) must use `LatestOnlyQueue` or debouncing to drop obsolete requests. Avoid unbounded task queues.
- **Cancellation & Orphan Work**: When a user seeks or closes a project, in-flight prefetch requests and background worker tasks must be cleanly aborted. Never allow cancelled work to run to completion.
- **Resource Disposal**: Web Workers must respond to `{ type: 'DISPOSE' }` and terminate cleanly. GPU textures and render pipelines must be destroyed on unmount. FFmpeg processes must terminate on export cancellation or app exit.
- **Graceful Fallbacks**: Hardware decode failure must fall back to software decode without crashing or corrupting project state.

---

## Performance Thresholds & Claims

- Only introduce performance thresholds or benchmark gates when a **reliable baseline and controlled measurement environment** exist.
- Never add arbitrary, unseeded benchmark gates or make unsupported performance claims without reproducible test evidence.
