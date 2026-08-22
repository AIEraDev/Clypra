# Filmstrip Architecture & Caching Specification

This document defines the architecture, data structures, caching policies, and performance contracts for Clypra's native-backed filmstrip pipeline.

---

## 1. Core Architectural Decoupling

The fundamental principle governing filmstrip thumbnail extraction and presentation:

**Extraction and Presentation are completely decoupled systems.**

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. DATA EXTRACTION LAYER (Decoupled from Viewport & Zoom)                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ • Media Pool Import:                                                                   │
│   - Extracts ONLY 1 single poster frame (<150ms). Zero background decode storm.        │
│                                                                                        │
│ • Timeline Drop (Asset-Wide Coarse Baseline):                                          │
│   - Preloads a bounded Tier-0 coarse baseline across 100% of duration (≤300 tiles).    │
│   - Dispatches PLAYHEAD-FIRST (|t - t_playhead|): frame under playhead fills in <110ms.│
│   - When playhead is at clip start / 00:00, streams left-to-right from visible start.   │
│   - Memory footprint is strictly bounded (≤1.8 MB storage) even on 3-hour media.       │
│                                                                                        │
│ • Deep Zoom (Dense Layers):                                                            │
│   - Reactive high-density frames (L1=1.0s, L2=0.2s, L3=0.02s) decode only on demand.   │
│   - SRP assigns 1.0x normal zoom to L1 (1.0s) matching 50px visual slots 1:1.          │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. PRESENTATION LAYER (Pure Viewport Window Sampler)                                   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ • Render surface canvas is strictly bounded to [viewportWidth + overscan] (O(1) GPU).   │
│ • Pure horizontal scrolling is an O(1) cache blit — NEVER a decode-triggering event.   │
│ • Frame 0 on mount immediately paints warm L0 coarse baseline via FilmstripTileCache.  │
│ • Un-decoded dense slots sample resident coarse L0 tiles (bicubic stretch fallback).   │
│ • Cold un-decoded slots render a stylized diagonal hatch shimmer placeholder.          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Density Tier & Fixed-Grid Specification

Thumbnail intervals and dimensions are locked to deterministic fixed intervals across zoom tiers to ensure center tiles are reused during timeline zoom without regeneration storms:

| Spatial Tier | Dimensions | Base Interval | Target Zoom Scope | Visual Slot Match |
| :--- | :--- | :--- | :--- | :--- |
| **L0 (Coarse Baseline)** | $160 \times 90$ | $5.0\text{s}$ | Overview zoom ($0.1\times - 0.5\times$) | Wide overview fallback |
| **L1 (Standard)** | $240 \times 135$ | $1.0\text{s}$ | Standard editing ($0.5\times - 1.25\times$) | 1:1 match for $50\text{px}$ slots |
| **L2 (Fine)** | $320 \times 180$ | $0.2\text{s}$ | Detailed trimming ($1.25\times - 2.5\times$) | High precision scrubbing |
| **L3 (Sub-frame)** | $480 \times 270$ | $0.02\text{s}$ | Frame-accurate zoom ($2.5\times - 5.0\times$) | Frame-by-frame cuts |

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

Every thumbnail remains **100% rock-solid and stationary** in timeline space across arbitrary scroll speeds and viewport bounds.

---

## 3. Unified Canonical Cache Identity & Visual Invalidation

Both TypeScript and Rust compute a unified canonical tile key:

$$\text{canonicalTileKey} = \text{videoSourceId} : \text{spatialTier} : \text{timestampMs} : \text{v}(\text{effectGraphVersion})$$

### Invariants:
1. **Cross-Clip Deduplication**: Multiple clips referencing the same source video at timestamp $t$ resolve to the exact same canonical key $\implies$ **$1$ decode, $N-1$ zero-latency cache hits**.
2. **Visual Invalidation Safety**: Modifying color grading, LUTs, or visual filters increments `effectGraphVersion`. Stale memory/disk atlases are deterministically bypassed without visual ghosting.
3. **Session Persistence**: Project reopens check Rust's disk cache with this key, restoring warm tiles in **$<10\text{ms}$ with 0 FFmpeg decodes**.

---

## 4. Multi-Tier Pyramid Fallback State Machine

When a timeline slot requires rendering at `targetTier`:

```text
                                  Requested targetTier (e.g. L2)
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                              [Exact Available]       [Exact Missing]
                                    │                       │
                              Draw exact tile         Search lower tiers (L1 → L0)
                              (No smoothing)                │
                                                ┌───────────┴───────────┐
                                                ▼                       ▼
                                         [Fallback Found]       [All Tiers Missing]
                                                │                       │
                                         Draw bicubic stretch   Draw stylized shimmer
                                         (Mark as fallback)     (Active indexing)
                                                │
                                       [Dense Tile Arrives]
                                                │
                                         In-place replacement
                                         (Clear fallback flag)
```

---

## 5. Performance Contracts & SLAs

| Metric | Target SLA | Verification Suite |
| :--- | :--- | :--- |
| **Media Bin Poster Frame** | $< 150\text{ms}$ | `filmstripLifecycle.test.ts` (`FILMSTRIP-001`) |
| **Visible Playhead First Frame** | $p50 < 30\text{ms}, p95 < 110\text{ms}$ | `filmstripPerformanceHarness.test.ts` (`FILMSTRIP-004`) |
| **In-Memory Tile Cache Lookup** | $< 0.01\text{ms}$ ($< 1\text{ms}$ hard SLA) | `filmstripPerformanceHarness.test.ts` (`FILMSTRIP-004`) |
| **Horizontal Scrolling Cache Hit Rate** | $100\%$ hits (0 decode latency) | `filmstripStressAndBudget.test.ts` (`FILMSTRIP-007`) |
| **Warm Session Reopen** | $< 10\text{ms}$, **0 video decodes** | `filmstripColdWarmChanged.test.ts` (Layer 3) |
| **Memory Footprint Under Stress** | $\le 100\text{MB}$ TS / $\le 300\text{MB}$ Rust | `filmstripMemoryStress.test.ts` (Layer 4) |
| **Lifecycle Cancellation** | Immediate abort on clip delete (0 leaks) | `filmstripLifecycleCancellation.test.ts` (Layer 5) |

---

## 6. Verification Architecture (5-Layer Matrix)

The test lab enforces the entire pipeline across 5 distinct validation layers:

1. **Layer 1: Fallback State Machine** ([`filmstripFallbackStateMachine.test.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/lib/filmstrip/__tests__/filmstripFallbackStateMachine.test.ts)) — Verifies exact, stretched coarse fallback, shimmer, and in-place replacement.
2. **Layer 2: Invalidation & Effect Versioning** ([`filmstripEffectInvalidation.test.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/lib/filmstrip/__tests__/filmstripEffectInvalidation.test.ts)) — Verifies `effectGraphVersion` cache key segregation and cross-clip deduplication.
3. **Layer 3: Flagship "Cold → Warm → Changed" Lifecycle** ([`filmstripColdWarmChanged.test.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/lib/filmstrip/__tests__/filmstripColdWarmChanged.test.ts)) — Verifies full 3-session workflow (Cold decode $\to$ Warm 0-decode restore $\to$ Zoom fallback $\to$ Effect change).
4. **Layer 4: Memory Boundedness Under Stress** ([`filmstripMemoryStress.test.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/lib/filmstrip/__tests__/filmstripMemoryStress.test.ts)) — Verifies $O(1)$ memory capping and LRU eviction across 100 clips and 30,000 tile operations.
5. **Layer 5: Lifecycle & Cancellation** ([`filmstripLifecycleCancellation.test.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/lib/filmstrip/__tests__/filmstripLifecycleCancellation.test.ts)) — Verifies immediate worker cancellation on clip deletion with 0 leaks.
