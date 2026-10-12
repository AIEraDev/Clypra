# Clypra Windows Telemetry & Reliability Daily Audit

**Date:** 2026-10-12 (2026-10-12T12:01:42.988Z)
**Target API:** `https://clypra-worker-api.abdulkabirmusa.com`

## 1. Executive Status & Alerts

⚠️ **5 ALERT(S) DETECTED**:
- ⚠️ Elevated Windows p95 seek latency: 2701.2 ms (Threshold: ≤ 2500 ms)
- ⚠️ GPU Cohort 'Intel(R) HD Graphics 530' bottleneck identified: 'decode' (p95 render: 1601.6 ms).
- ⚠️ GPU Cohort 'Intel(R) UHD Graphics 630' bottleneck identified: 'compose' (p95 render: 2701.2 ms).
- 🚨 GPU Cohort 'NVIDIA GeForce RTX 4060 Ti' (nvidia) has a 14.3% fallback rate (7 samples).
- ⚠️ GPU Cohort 'NVIDIA GeForce RTX 4060 Ti' bottleneck identified: 'decode' (p95 render: 4663.9 ms).

## 2. Platform Comparison (Windows vs Baseline macOS)

| Metric | Windows Production | Baseline macOS | Status |
| :--- | :--- | :--- | :--- |
| Total Recorded Samples | **59** | 5 | Sufficient Data |
| p50 Render Time | 428.0 ms | 0.7 ms | Bounded |
| p95 Render Time | 2701.2 ms | 576.0 ms | - |
| p95 Seek Latency | 2701.2 ms | 576.0 ms | Elevated |
| Fallback Rate (Bridge) | 1.69% | 0.00% | Within Budget |
| Relative Slowdown vs Mac | 4.69x | 1.0x | - |

## 3. Windows GPU Cohort Breakdown

| GPU Vendor / Model | Samples | Confidence | p50 Render | p95 Render | Fallback % | Bottleneck | Gate SLA |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **native-wgpu** (gpu) | 7 | 🟡 Low (<10) | 0.0 ms | 0.0 ms | 0.0% | none | ✅ Pass |
| **NVIDIA GeForce GTX 750 Ti** (nvidia) | 8 | 🟡 Low (<10) | 0.2 ms | 0.4 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 3050 Ti Laptop GPU** (nvidia) | 4 | 🟡 Low (<10) | 0.3 ms | 0.4 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 4070 SUPER** (nvidia) | 4 | 🟡 Low (<10) | 0.2 ms | 1.9 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 3080 Ti Laptop GPU** (nvidia) | 8 | 🟡 Low (<10) | 108.0 ms | 110.9 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce GTX 1050 Ti** (nvidia) | 2 | 🟡 Low (<10) | 133.7 ms | 133.7 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 3060** (nvidia) | 4 | 🟡 Low (<10) | 0.3 ms | 427.2 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 5070 Ti** (nvidia) | 5 | 🟡 Low (<10) | 260.1 ms | 465.4 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 4080** (nvidia) | 12 | 🟢 Sufficient | 418.9 ms | 478.6 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 2060 SUPER** (nvidia) | 3 | 🟡 Low (<10) | 13.9 ms | 485.8 ms | 0.0% | none | ❌ Fail |
| **Intel(R) Graphics** (intel) | 1 | 🟡 Low (<10) | 750.3 ms | 750.3 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 3060 Laptop GPU** (nvidia) | 11 | 🟢 Sufficient | 730.7 ms | 1182.2 ms | 0.0% | none | ❌ Fail |
| **Intel(R) UHD Graphics** (intel) | 1 | 🟡 Low (<10) | 1227.0 ms | 1227.0 ms | 0.0% | none | ❌ Fail |
| **Intel(R) HD Graphics 530** (intel) | 5 | 🟡 Low (<10) | 1384.0 ms | 1601.6 ms | 0.0% | decode | ❌ Fail |
| **Intel(R) UHD Graphics 630** (intel) | 4 | 🟡 Low (<10) | 2683.3 ms | 2701.2 ms | 0.0% | compose | ❌ Fail |
| **AMD Radeon(TM) Graphics** (amd) | 23 | 🟢 Sufficient | 415.0 ms | 3379.0 ms | 0.0% | none | ❌ Fail |
| **NVIDIA GeForce RTX 4060 Ti** (nvidia) | 7 | 🟡 Low (<10) | 492.3 ms | 4663.9 ms | 14.3% | decode | ❌ Fail |

## 4. Fallback Transitions & Root Causes

* **Transition:** `native-wgpu-preview -> native-preview-blocked` (Total count: 1, 100%)
  * **Top Reasons:** `sticker-or-raster-unsupported` (1x)
  * **Impacted Hardware:** NVIDIA GeForce RTX 4060 Ti on windows (1x)

## 5. Worst Performing Sessions (Triage Targets)

| Rank | GPU Model | Codec / Res | p95 Latency | Samples | Fallback Rate |
| :--- | :--- | :--- | :--- | :--- | :--- |
| #1 | **NVIDIA GeForce RTX 4060 Ti** (nvidia) | hevc / 4k | 6109.6 ms | 12 | 8.3% |
| #2 | **NVIDIA GeForce RTX 3060 Laptop GPU** (nvidia) | hevc / 4k | 4309.9 ms | 11 | 0.0% |
| #3 | **Intel(R) UHD Graphics** (intel) | hevc / 4k | 3381.6 ms | 4 | 0.0% |
| #4 | **AMD Radeon(TM) Graphics** (amd) | hevc / 4k | 3379.0 ms | 23 | 0.0% |
| #5 | **Intel(R) UHD Graphics 630** (intel) | hevc / 4k | 2849.3 ms | 6 | 0.0% |
| #6 | **NVIDIA GeForce RTX 4080** (nvidia) | hevc / 4k | 1988.0 ms | 15 | 0.0% |
| #7 | **Intel(R) HD Graphics 530** (intel) | hevc / 4k | 1601.6 ms | 4 | 0.0% |
| #9 | **NVIDIA GeForce RTX 2060 SUPER** (nvidia) | hevc / 4k | 485.8 ms | 3 | 0.0% |
| #10 | **NVIDIA GeForce RTX 5070 Ti** (nvidia) | hevc / 4k | 465.4 ms | 4 | 0.0% |

