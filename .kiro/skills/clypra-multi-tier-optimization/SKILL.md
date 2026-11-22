---
name: clypra-multi-tier-optimization
description: >-
  Guides holistic, evidence-backed multi-tier performance and architecture discovery across Clypra's Three-Tier Compute
  Boundary (React UI, Web Workers, Rust native core) and IPC transport. Audits missing design patterns, zero-copy
  hardware paths, temporal/spatial indexing, SIMD vectorization, memory bandwidth, and serialization bottlenecks.
---

# Clypra Multi-Tier Performance & Architecture Optimization

## Mission & Scope

Act as a Principal Systems & NLE Performance Architect auditing Clypra across all computational tiers. Identify architectural patterns, data structures, zero-copy hardware paths, and low-latency transport designs that are **not currently used** in the codebase, but can yield order-of-magnitude improvements in throughput, latency, memory footprint, and frame pacing.

This skill bridges low-level hardware capabilities (Metal, DirectX 12, SIMD, atomics) with frontend rendering paradigms (Interval Trees, DOM virtualization, Signals, WebAssembly) while strictly adhering to Clypra's **Three-Tier Compute Boundary** (Architecture Invariant 9) and **Platform Contracts** (Architecture Invariants 1, 2, 6, 11, 16).

---

## The Three Tiers of Clypra

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 1: Frontend & UI State (React 19 / TypeScript / Zustand / DOM)    │
│   • Single PlaybackClock authority, timelineStore, EvaluatedScene      │
│   • Budget: < 2ms main-thread event loop execution                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ IPC / Message Passing
┌───────────────────────────────────┴────────────────────────────────────┐
│ Tier 2: Web Workers & Off-Thread Compute (OffscreenCanvas / Compute)   │
│   • Waveform LOD, Color Scopes, Subtitles, Text/Sticker Rasterizers   │
│   • Budget: < 12ms per scope / waveform slice                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Tauri IPC / Push Mailbox / Shared Mem
┌───────────────────────────────────┴────────────────────────────────────┐
│ Tier 3: Rust Native Engine (wgpu, VideoToolbox/D3D11VA, CPAL Audio)    │
│   • Hardware video decode, GPU multi-track compositor, audio clock    │
│   • Budget: < 100μs present, zero dropped frames at 4K 60fps           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## When to Activate This Skill

Activate this skill when:
- Conducting an end-to-end performance audit across the entire application stack.
- Seeking modern NLE architectural paradigms (used in DaVinci Resolve, Final Cut Pro, Premiere Pro, CapCut) not yet present in Clypra.
- Investigating memory bandwidth bottlenecks, GC churn, or unnecessary memory copies across threads or processes.
- Designing major subsystem overhauls (e.g. zero-copy GPU video import, timeline spatial indexing, Wasm compute offload).
- Structuring multi-phase performance engineering initiatives.

---

## The 6-Step Multi-Tier Investigation Workflow

When conducting a multi-tier optimization discovery, follow this sequence:

### 1. Reconstruct Data & Frame Flow Across Tiers
Trace a single user action (e.g., playhead scrub, clip trim, video playback tick) end-to-end:
- **Tier 1:** How is state queried and resolved? (e.g., `evaluateTimelineSceneCached`, linear vs indexed lookups).
- **Cross-Tier Boundary 1:** How does data cross from Main Thread to Web Workers? (Structured clone vs. Transferable vs. SharedArrayBuffer).
- **Cross-Tier Boundary 2:** How does data cross between Webview and Rust? (`invoke()` JSON vs. binary channels vs. shared memory).
- **Tier 3:** How are frames decoded, transferred to VRAM, composited, and presented? (CPU copies vs. GPU zero-copy sharing).

### 2. Audit Missing Industry Paradigms
Evaluate the codebase against state-of-the-art NLE design patterns:
- **Tier 1:**
  - *Temporal Spatial Indexing:* Interval Trees / 1D Segment Trees for $O(\log N + K)$ clip querying instead of $O(N)$ scans.
  - *Timeline Windowing / Virtualization:* Culling off-screen clips/tracks or hybrid Canvas/WebGL timeline rendering.
  - *Evaluation Scratch Pools:* Pre-allocated object pools for `EvaluatedScene` to eliminate GC allocation churn.
  - *Signals:* Binding high-frequency numbers (playhead, meters, coordinates) directly to DOM styles without React reconciler diffs.
- **Tier 2:**
  - *WebAssembly + SIMD128:* Vectorized audio decimation and 3D pixel histogram binning.
  - *SharedArrayBuffer Ring Buffers:* Lock-free SPSC queues with Atomics for streaming telemetry, waveforms, and scopes.
  - *Elastic Worker Pools:* Work-stealing thread pools matching `navigator.hardwareConcurrency`.
- **Tier 3:**
  - *macOS Metal Zero-Copy:* `CVMetalTextureCache` / `IOSurface` import into `wgpu::Texture` (matching Windows `dxgi_import.rs`).
  - *Compressed GOP Bitstream Caching:* Caching NAL packets in RAM rather than 33MB decoded uncompressed 4K frames.
  - *Strict Real-Time Audio Constraints:* Wait-free atomics, zero memory allocations, and zero mutex locks in CPAL callbacks.
  - *Vectorized Audio DSP:* AVX2/NEON SIMD for multi-track gain, panning, and WSOLA time-stretching.
- **Cross-Tier IPC:**
  - *Tauri v2 Raw Binary Channels:* Eliminating Serde JSON serialization for binary data (waveforms, thumbnails, fallback frames).
  - *Memory-Mapped Shared Memory:* OS-level shared memory for frame readback.

### 3. Big-O Complexity and Memory Bandwidth Analysis
For every identified opportunity, quantify:
- **Time Complexity:** Algorithmic scaling relative to clip count ($N$), track count ($M$), or pixel resolution ($W \times H$).
- **Memory Bandwidth:** Gigabytes/sec moved across PCIe or unified memory buses (e.g. 4K 60fps NV12 = $\approx 746\text{ MB/s}$ per copy).
- **Garbage Collection Pressure:** Number and byte volume of transient allocations per second on the JavaScript heap.

### 4. Cross-Platform & Architectural Invariants Verification
Verify that proposed improvements respect Clypra's core contracts:
- Invariant 1: Single Time Authority (`PlaybackClock`).
- Invariant 2: EvaluatedScene currency.
- Invariant 6: Native preview surface is default; DOM/canvas is fallback.
- Invariant 9: Three-Tier Compute Boundary integrity.
- Invariant 11: Cross-Platform Contract (identical editing semantics across macOS, Windows, Linux).
- Invariant 16: Native UI Thread Safety (`run_on_main_thread`).

### 5. Synthesize Phased Architecture Roadmap
Organize discoveries into prioritized, orthogonal phases:
- **Phase 1:** Foundational physical bottlenecks (e.g. zero-copy GPU video import and binary IPC).
- **Phase 2:** Core algorithmic state & evaluation scalability (e.g. Interval Trees, zero-allocation pooling).
- **Phase 3:** Timeline rendering & DOM virtualization.
- **Phase 4:** Off-thread compute acceleration (Wasm SIMD + SharedArrayBuffer).
- **Phase 5:** Advanced caching & real-time audio safety.

### 6. Phase 1 Engineering Specification & Execution Plan
For the immediate phase:
- Enforce the **5-Phase Pairing Protocol**: Acknowledge & Analyze $\to$ Trade-Offs First $\to$ Spec, Then Task List $\to$ One Small Task at a Time $\to$ Write Code Last.
- Define explicit, measurable exit criteria (latencies, bandwidth savings, regression test suites).
- Detail atomic, sequenced tasks with verification commands.
