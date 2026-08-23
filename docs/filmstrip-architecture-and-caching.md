# Filmstrip Architecture & Caching Specification

This document defines the architecture, data structures, caching policies, native decode pipelines, and performance contracts for Clypra's high-throughput, native-backed filmstrip engine.

---

## 1. Core Architectural Decoupling

The fundamental principle governing filmstrip thumbnail extraction and presentation:

**Extraction and Presentation are completely decoupled systems.**

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. DATA EXTRACTION LAYER (Decoupled from Viewport & Zoom)                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ • Media Pool Import (Eager Bounded Baseline Pre-warm):                                 │
│   - Extracts 1 poster frame (<150ms) + preloads bounded Tier-0 coarse baseline (≤300).│
│   - Bounded to 13–20 coarse tiles at low concurrency (2) to warm cache before timeline.│
│   - Stored in on-disk atlas and FilmstripTileCache for 0ms initial timeline drop.      │
│                                                                                        │
│ • Chunked Forward GOP Batch Decode (High-Throughput Native Extraction):                │
│   - Requests are grouped into sorted temporal chunks (8–16 tiles) in single IPC batch. │
│   - VideoDecoder acquires lock ONCE per chunk and performs ONE backward seek to GOP.   │
│   - Streams packets forward through GOP: each video packet is decoded EXACTLY ONCE.    │
│   - Rayon downsamples frames in parallel to pyramid tiers (L0–L3) via LANCZOS.         │
│   - Streams RenderArtifacts over Tauri Channel in real time as each frame is produced. │
│   - Mid-batch cancellation aborts decode immediately when epoch changes.               │
│                                                                                        │
│ • Memory-Shielded Cache Hierarchy (Tiered LRU with L0 Protection):                     │
│   - Coarse L0 baseline tiles act as a permanent fallback floor (≤1.8 MB per clip).     │
│   - High-density L1/L2/L3 tiles absorb 100% of LRU eviction pressure during deep zoom. │
│   - Hard ceiling across dozens of clips gracefully reclaims oldest L0 tiles in LRU.    │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. PRESENTATION LAYER (Pure Viewport Window Sampler)                                   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ • Render surface canvas is strictly bounded to [viewportWidth + overscan] (O(1) GPU).   │
│ • Pure horizontal scrolling is an O(1) cache blit — NEVER a decode-triggering event.   │
│ • Epoch-Safe Zero-Blank Continuous Zoom:                                               │
│   - Frame 0 synchronously publishes resident/stretched fallback tiles on epoch change. │
│   - WebGL & Canvas2D parity: un-decoded dense slots sample resident coarse L0 tiles.   │
│   - Unconditional debounce escape timer (150ms bound) prevents request starvation.     │
│   - Cold start (zero warm cache) packs 32x32 procedural shimmer quad into WebGL atlas. │
│ • Bidirectional Zoom Harmonization: Spring inertia tracks buttons, slider, and wheel.  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Density Tier & Fixed-Grid Specification

Thumbnail intervals and dimensions are locked to deterministic fixed intervals across zoom tiers to ensure center tiles are reused during timeline zoom without regeneration storms:

| Spatial Tier | Dimensions | Base Interval | Target Zoom Scope | Visual Slot Match |
| :--- | :--- | :--- | :--- | :--- |
| **L0 (Coarse Baseline)** | $160 \times 90$ | $5.0\text{s}$ | Overview zoom ($0.1\times - 0.5\times$) | Wide overview fallback floor |
| **L1 (Standard)** | $240 \times 135$ | $1.0\text{s}$ | Standard editing ($0.5\times - 1.5\times$) | 1:1 match for standard slots |
| **L2 (Fine)** | $320 \times 180$ | $0.2\text{s}$ | Detailed trimming ($1.5\times - 3.0\times$) | High precision scrubbing |
| **L3 (Sub-frame)** | $480 \times 270$ | $0.1\text{s}$ | Frame-accurate zoom ($3.0\times - 5.0\times$) | Frame-by-frame cuts |

### Bounded Coarse Tile Budget
For long media ($>25\text{ mins}$), the interval scales by an integer multiplier:
$$\text{multiplier} = \max\left(1, \left\lceil \frac{\text{duration}}{300 \times \text{baseInterval}} \right\rceil\right)$$
$$\text{interval} = \text{baseInterval} \times \text{multiplier}$$

*Guarantees total coarse tiles $\le 300$ and coarse cache footprint $\le 1.8\text{ MB}$ across all durations (10s to 3h).*

### Physical Timeline Coordinate Invariance
To eliminate thumbnail sliding or swimming during horizontal scrolling, tile slot positions inside the bounded render surface are mapped using physical timeline world coordinates rather than relative list indexes:
$$\text{clipLeftPx} = (t - \text{clipTrimIn}) \times \text{pixelsPerSecond}$$
$$\text{canvasLeftPx} = \text{clipLeftPx} - \text{renderWindowLeftPx}$$

Because the `<canvas>` DOM element is positioned at `left: renderWindowLeftPx` inside the clip, `renderWindowLeftPx` cancels out identically:
$$\text{screenX} = \text{clipLeftPx}_{\text{DOM}} + \text{renderWindowLeftPx} + ((\text{t} - \text{trimIn}) \times \text{pps} - \text{renderWindowLeftPx}) \equiv \text{clipLeftPx}_{\text{DOM}} + (\text{t} - \text{trimIn}) \times \text{pps}$$

Every thumbnail remains **100% stationary** in timeline space across arbitrary scroll speeds and viewport bounds.

### Contiguous Zero-Gap Tile Coverage
To guarantee a seamless, continuous filmstrip with zero blank gaps between thumbnails, each tile's visual slot width is calculated directly from its temporal span:
$$\text{widthPx} = \text{thumbnailIntervalSeconds} \times \text{pixelsPerSecond}$$

Because consecutive tiles at timestamps $t_i$ and $t_{i+1} = t_i + \text{interval}$ are placed at $\text{leftPx}_{i+1} = \text{leftPx}_i + \text{widthPx}_i$, every tile touches its neighbor edge-to-edge with **zero dark gaps** across all zoom levels.

---

## 3. Tiered LRU Eviction & L0 Baseline Pinning

To prevent high-density zoom operations in sub-regions from evicting the coarse baseline tiles that the rest of the timeline depends on for cross-tier fallbacks, `FilmstripTileCache` implements a **Tiered LRU Eviction Policy with an Outer Project Ceiling**:

```text
                                 Memory Budget Exceeded
                                            │
                                            ▼
                    ┌───────────────────────────────────────────────┐
                    │ Pass 1: Scan for oldest non-L0 tile (L1–L3)   │
                    └───────────────────────┬───────────────────────┘
                                            │
                            ┌───────────────┴───────────────┐
                            ▼                               ▼
                      [Tile Found]                   [No Dense Tiles]
                            │                               │
                      Evict oldest L1–L3              Scan for oldest L0 tile
                      (L0 floor preserved)            (Multi-clip ceiling guard)
                                                            │
                                                      Evict oldest L0 tile
                                                      (Strict O(1) budget safety)
```

### Invariants:
1. **L0 Baseline Shielding**: As long as dense tiles ($L1, L2, L3$) exist in the cache, coarse $L0$ baseline tiles are completely shielded from eviction. A user zooming deep into minute 1 of a clip and generating hundreds of L3 tiles will never evict the L0 tiles for minute 10.
2. **Multi-Clip Hard Ceiling**: If a large project imports dozens of clips whose L0 tiles alone exceed `memoryBudgetBytes` (100 MB), Pass 2 evicts the oldest L0 tiles in LRU order, ensuring total memory is strictly bounded at all times.
3. **Clip Invalidation**: When a clip is deleted from the project, `invalidateClip(clipId)` immediately closes all associated bitmaps across all tiers with 0 memory leaks.

---

## 4. Native Chunked Batch Decode with Forward GOP Scanning

Sequential single-frame decoding suffers from high seek overhead and lock contention. The Clypra engine utilizes a **Chunked Forward GOP Packet Scanning Pipeline**:

```text
  Timestamps: [1.0s, 1.2s, 1.4s, 1.6s, 1.8s, 2.0s, 2.2s, 2.4s] (Single GOP: 1.0s–2.5s)
                                      │
                                      ▼
                        Acquire Decoder Mutex ONCE
                                      │
                                      ▼
                      av_seek_frame(1.0s, BACKWARD)
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
     [Feed Packet Forward]                           [Receive Decoded Frame]
              │                                               │
              │                                      Match Frame PTS to Targets
              │                                               │
              │                                      ┌────────┴────────┐
              │                                      ▼                 ▼
              │                                 [PTS Matched]     [PTS Skipped]
              │                                      │                 │
              │                               Convert RGBA        Drop frame
              │                                      │
              │                               Downsample Pyramid
              │                               (L0, L1, L2, L3)
              │                                      │
              │                               Stream RenderArtifact
              │                               over Tauri Channel
              │                                      │
              └────────────── Next Packet ───────────┘
                                      │
                      (All targets in chunk satisfied)
                                      │
                                      ▼
                         Release Decoder Mutex
```

### Key Performance Benefits:
1. **Seek Overhead Reduction**: Seeks are reduced from $N$ seeks to $\approx N / 12$ seeks (1 seek per chunk/GOP).
2. **Zero Redundant Packet Decodes**: In a 30-frame GOP, all target timestamps within that GOP are satisfied in a single linear packet scan. Every packet is decoded **exactly once**, delivering a **$5\times$ to $10\times$ raw decode throughput increase**.
3. **Real-Time Streaming**: Rather than waiting for the entire chunk to complete, `get_render_artifacts_batch` streams each frame over the Tauri `Channel<RenderArtifact>` the moment it is downsampled.
4. **Mid-Batch Cancellation**: If the user zooms or scrubs to a new location, the frontend cancels the channel, immediately aborting downstream processing.

---

## 5. Epoch-Safe Zero-Blank Continuous Zoom Pipeline

During continuous zoom gestures (mouse wheel spin or trackpad pinch), the engine ensures the filmstrip **never flickers or displays blank frames**:

```text
               Zoom Gesture Event (Wheel / Pinch)
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
     Publish Synchronous              Coalesce Backend
     Resident Fallback                Decode Dispatch
               │                               │
  ┌────────────────────────────┐  ┌────────────────────────────┐
  │ 1. Frame 0: Lookup best    │  │ 1. RAF-throttled velocity  │
  │    resident fallback from  │  │    convergence check       │
  │    FilmstripTileCache      │  │ 2. Unconditional escape    │
  │ 2. WebGL/Canvas2D parity:  │  │    timer (max 150ms bound) │
  │    Draw stretched L0 quad  │  │ 3. Dispatch chunked batch  │
  │ 3. If zero warm cache,     │  │    request for missing     │
  │    draw procedural shimmer │  │    dense target tiles      │
  └────────────────────────────┘  └────────────────────────────┘
```

### Invariants:
1. **Synchronous Fallback Publication**: When `epochId` bumps on zoom, `FilmstripCache` immediately queries `FilmstripTileCache.findBestFallback()` and emits the stretched fallback array synchronously on Frame 0 before any new decodes occur.
2. **WebGL / Canvas2D Parity**: Both render surfaces implement identical fallback search logic, ensuring hardware-accelerated WebGL renders the bicubic stretched coarse tile seamlessly.
3. **Unconditional Escape Timer**: Continuous high-velocity wheel spinning coalesces backend requests, but an unconditional 150ms escape timer guarantees that requests are dispatched even if the gesture does not settle to zero velocity.
4. **Cold-Start Procedural Shimmer**: On project import before any tiles are decoded, `WebGLRasterSurface` packs a 32x32 RGBA procedural diagonal hatch pattern into the texture atlas and draws shimmer quads on Frame 0, completely eliminating flat teal blanks.

---

## 6. Bidirectional Timeline Zoom Synchronization

To guarantee seamless interoperability between interactive UI controls (toolbar zoom buttons, slider, `Shift+Z` Fit Sequence) and gesture inputs (mouse wheel, trackpad pinch), `TimelineZoomSpring` operates under a **Bidirectional Harmonization Architecture**:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                           useTimelineStore                               │
│                         (pixelsPerSecond)                                │
└──────────────────────┬────────────────────────────▲──────────────────────┘
                       │                            │
             Store Subscription              Spring Frame Tick
            (isApplyingFrame=false)        (isApplyingFrame=true)
                       │                            │
                       ▼                            │
┌───────────────────────────────────────────────────┴──────────────────────┐
│                         TimelineZoomSpring                               │
│  • Interrupts in-flight animations when external controls change PPS.    │
│  • Synchronizes currentPps & targetPps to external store immediately.    │
│  • getCurrentPps() falls back to store when spring is idle.             │
│  • Clamps per-frame exponential factor to prevent zoom jumps.            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Verification Architecture & SLA Matrix

| Subsystem | Metric | Target SLA | Verification Suite |
| :--- | :--- | :--- | :--- |
| **Media Bin Poster Frame** | Initial extraction latency | $< 150\text{ms}$ | `filmstripLifecycle.test.ts` (`FILMSTRIP-001`) |
| **Playhead First Frame** | Playhead visible frame | $p50 < 30\text{ms}, p95 < 110\text{ms}$ | `filmstripPerformanceHarness.test.ts` (`FILMSTRIP-004`) |
| **Tile Cache Lookup** | In-memory lookup latency | $< 0.01\text{ms}$ ($< 1\text{ms}$ hard SLA) | `filmstripPerformanceHarness.test.ts` (`FILMSTRIP-004`) |
| **Horizontal Scrolling** | Cache hit rate during scroll | $100\%$ hits (0 decode latency) | `filmstripStressAndBudget.test.ts` (`FILMSTRIP-007`) |
| **L0 Cache Protection** | L0 survival under dense flood | $100\%$ resident (0 L0 evictions) | `FilmstripTileCacheL0Pinning.test.ts` |
| **End-to-End Fallback** | Stretched L0 render mid-zoom | Fallback quad drawn (0 shimmers) | `FilmstripTileCacheL0Pinning.test.ts` |
| **Continuous Zoom Parity** | WebGL/Canvas2D fallback | Zero blanks during deep zoom | `ClipFilmstrip.integration.test.tsx` |
| **Chunked Batch Decode** | Forward GOP scan & streaming | Single seek per chunk, 0 packet dupes | `cargo test --lib thumbnail_engine` (82 tests) |
| **Zoom Synchronization** | Wheel vs Button harmony | Exact PPS continuity (0 jumps) | `useTimelineZoomSpring.test.ts` |
