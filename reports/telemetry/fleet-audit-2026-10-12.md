# Clypra Multi-OS Fleet Telemetry & Reliability Daily Audit

**Date:** 2026-10-12 (2026-10-12T12:19:55.876Z)
**Fleet Telemetry API:** `https://clypra-worker-api.abdulkabirmusa.com`
**Target Platforms:** macOS (Metal/VideoToolbox), Windows (D3D12/wgpu), Linux (Vulkan/WebKitGTK)

> [!NOTE] Sample Definition & Statistical Invariants
> - **1 Sample** = 1 discrete 30-second telemetry rollup window (or benchmark/seek span).
> - **Minimum Statistical Validity Threshold**: ≥ 10 samples required for reliable percentile and fallback rate estimation. Cohorts with < 10 samples are marked `confidence: "low"` and SLA rate alerts are suppressed to prevent premature conclusions.
> - **Workload Isolation**: Frame render timing and drop ratios evaluate sustained playback. Seek latency is strictly isolated to explicit seek spans (`seek-warm` / `seek-cold`) and is reported as `N/A` when evaluating pure playback workloads.

## 1. Executive Summary & Gate SLA Status

⚠️ **3 ALERT(S) / ACTION ITEMS DETECTED**:
- ℹ️ [MACOS] Low sample count (5 samples < 10 min threshold). Percentiles and fallback rates are preliminary.
- ⚠️ [WINDOWS] p50 render time is 431.7 ms (SLA Budget: ≤ 33.3 ms)
- ℹ️ [LINUX] No session samples recorded in current fleet window (Telemetry under-represented).

## 2. Cross-OS Fleet Comparison Matrix (Windows vs macOS vs Linux)

| Metric / Invariant | macOS (Metal) | Windows (DirectX 12) | Linux (Vulkan) | Fleet SLA Standard |
| :--- | :--- | :--- | :--- | :--- |
| **Session Volume** | 5 samples (Preliminary) | 62 samples (Valid) | 0 samples | ≥ 10 samples for statistical validity |
| **p50 Render Time** | 0.7 ms | 431.7 ms | N/A | ≤ 16.6ms (Mac), ≤ 33.3ms (Win/Linux) |
| **p95 Render Time** | 576.0 ms | 4663.9 ms | N/A | ≤ 33.3ms (Mac), ≤ 100ms (Win/Linux) |
| **p95 Seek Latency** | N/A (Playback window) | N/A (Playback window) | N/A (Playback window) | ≤ 150ms (Mac), ≤ 2500ms (Win/Linux) |
| **Fallback Rate (Bridge)** | 0.00% | 1.61% | N/A | ≤ 1.0% (Mac), ≤ 5.0% (Win), ≤ 10.0% (Linux) |
| **Relative Index vs Mac** | 1.0x (Ref) | N/A (Requires ≥10 samples) | N/A (Requires ≥10 samples) | Baseline: macOS 1.0x (requires n≥10) |
| **SLA Gate Status** | ⚠️ Insufficient volume (n<10) | ❌ Review | N/A | Strict SLA Contract Budget |

## 3. Platform Deep Dives

### 3.1 macOS (Metal / VideoToolbox / Apple Silicon)
| Cohort | Samples | Confidence | p50 Render | p95 Render | Fallback % | Bottleneck | SLA Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Apple M1** | 8 | ⚠️ Low (n<10) | 0.8 ms | 576.0 ms | 0.0% | none | ⚠️ Insufficient volume |

### 3.2 Windows (DirectX 12 / wgpu / Heterogeneous GPUs)
| Cohort | Samples | Confidence | p50 Render | p95 Render | Fallback % | Bottleneck | SLA Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **NVIDIA GeForce GTX 750 Ti** (nvidia) | 8 | ⚠️ Low (n<10) | 0.2 ms | 0.4 ms | 0.0% | none | ⚠️ Insufficient volume |
| **NVIDIA GeForce RTX 3050 Ti Laptop GPU** (nvidia) | 4 | ⚠️ Low (n<10) | 0.3 ms | 0.4 ms | 0.0% | none | ⚠️ Insufficient volume |
| **NVIDIA GeForce RTX 4070 SUPER** (nvidia) | 4 | ⚠️ Low (n<10) | 0.2 ms | 1.9 ms | 0.0% | none | ⚠️ Insufficient volume |
| **NVIDIA GeForce RTX 3080 Ti Laptop GPU** (nvidia) | 8 | ⚠️ Low (n<10) | 108.0 ms | 110.9 ms | 0.0% | none | ⚠️ Insufficient volume |
| **NVIDIA GeForce GTX 1050 Ti** (nvidia) | 2 | ⚠️ Low (n<10) | 133.7 ms | 133.7 ms | 0.0% | none | ⚠️ Insufficient volume |
| **NVIDIA GeForce RTX 3060** (nvidia) | 4 | ⚠️ Low (n<10) | 0.3 ms | 427.2 ms | 0.0% | none | ⚠️ Insufficient volume |
| **NVIDIA GeForce RTX 5070 Ti** (nvidia) | 5 | ⚠️ Low (n<10) | 260.1 ms | 465.4 ms | 0.0% | none | ⚠️ Insufficient volume |
| **NVIDIA GeForce RTX 4080** (nvidia) | 12 | ✅ Sufficient | 418.9 ms | 478.6 ms | 0.0% | none | ❌ Review |
| **NVIDIA GeForce RTX 2060 SUPER** (nvidia) | 3 | ⚠️ Low (n<10) | 13.9 ms | 485.8 ms | 0.0% | none | ⚠️ Insufficient volume |
| **Intel(R) Graphics** (intel) | 1 | ⚠️ Low (n<10) | 750.3 ms | 750.3 ms | 0.0% | none | ⚠️ Insufficient volume |
| **NVIDIA GeForce RTX 3060 Laptop GPU** (nvidia) | 10 | ✅ Sufficient | 730.7 ms | 1182.2 ms | 0.0% | none | ❌ Review |
| **Intel(R) UHD Graphics** (intel) | 1 | ⚠️ Low (n<10) | 1227.0 ms | 1227.0 ms | 0.0% | none | ⚠️ Insufficient volume |
| **Intel(R) HD Graphics 530** (intel) | 5 | ⚠️ Low (n<10) | 1384.0 ms | 1601.6 ms | 0.0% | decode | ⚠️ Insufficient volume |
| **Intel(R) UHD Graphics 630** (intel) | 4 | ⚠️ Low (n<10) | 2683.3 ms | 2701.2 ms | 0.0% | compose | ⚠️ Insufficient volume |
| **AMD Radeon(TM) Graphics** (amd) | 23 | ✅ Sufficient | 415.0 ms | 3379.0 ms | 0.0% | none | ❌ Review |
| **NVIDIA GeForce RTX 4060 Ti** (nvidia) | 7 | ⚠️ Low (n<10) | 492.3 ms | 4663.9 ms | 14.3% | decode | ⚠️ Insufficient volume |
| **NVIDIA GeForce RTX 3050** (nvidia) | 6 | ⚠️ Low (n<10) | 5053.2 ms | 5053.2 ms | 0.0% | readback | ⚠️ Insufficient volume |

### 3.3 Linux (Vulkan / WebKitGTK / VA-API)
*Linux sessions are currently under-represented in the opt-in fleet (<10 samples). Linux defaults remain on the conservative DOM bridge path until opt-in canary data verifies native Vulkan stability.*

## 4. Fleet Fallback Transitions & Root Causes

* **Transition:** `native-wgpu-preview -> native-preview-blocked` (Count: 1, 100% of all fallbacks)
  * **Trigger Codes:** `sticker-or-raster-unsupported` (1x)
  * **Impacted OS & Hardware:** **NVIDIA GeForce RTX 4060 Ti** on windows (1x)

## 5. Cross-Platform Worst Performing Sessions (Triage Queue)

| Rank | Platform | GPU Model | Codec / Resolution | p95 Latency | Samples | Fallback Rate |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| #1 | **windows** | **NVIDIA GeForce RTX 4060 Ti** (nvidia) | hevc / 4k | 6109.6 ms | 12 | 8.3% |
| #2 | **windows** | **NVIDIA GeForce RTX 3050** (nvidia) | hevc / 4k | 5053.2 ms | 4 | 0.0% |
| #3 | **windows** | **NVIDIA GeForce RTX 3060 Laptop GPU** (nvidia) | hevc / 4k | 4309.9 ms | 11 | 0.0% |
| #4 | **windows** | **Intel(R) UHD Graphics** (intel) | hevc / 4k | 3381.6 ms | 4 | 0.0% |
| #5 | **windows** | **AMD Radeon(TM) Graphics** (amd) | hevc / 4k | 3379.0 ms | 23 | 0.0% |
| #6 | **windows** | **Intel(R) UHD Graphics 630** (intel) | hevc / 4k | 2849.3 ms | 6 | 0.0% |
| #7 | **windows** | **NVIDIA GeForce RTX 4080** (nvidia) | hevc / 4k | 1988.0 ms | 15 | 0.0% |
| #8 | **windows** | **Intel(R) HD Graphics 530** (intel) | hevc / 4k | 1601.6 ms | 4 | 0.0% |
| #9 | **windows** | **NVIDIA GeForce RTX 3050** (nvidia) | hevc / 1080p | 629.2 ms | 3 | 0.0% |
| #10 | **macos** | **Apple M1** (apple) | hevc / 4k | 576.0 ms | 5 | 0.0% |

## 6. Fleet Workload Distribution & Unique Sessions

- **Total Ingested Telemetry Events:** 158
- **Total Unique Reporting Sessions:** 10

| Workload Mode | Sample Windows | Unique Sessions | Mode Share % |
| :--- | :--- | :--- | :--- |
| **playback** | 124 | 10 | 78.5% |
| **scrub** | 27 | 1 | 17.1% |
| **export-transcode** | 2 | N/A | 1.3% |
| **shader-composition** | 5 | 1 | 3.2% |

## 7. Fleet Aggregate Session Health

- **Total Rollup Sessions Recorded:** 48
- **Accumulated Program Frames Rendered:** 667
- **Average Jank Events / Session:** 0.96
- **Fleet Average Frame Cache Hit Ratio:** 75.0%

