# Phase 0: Performance Baseline Collection

This directory contains baseline performance measurements for the Phase 0 decode decision gate.

## Directory Structure

```
benchmarks/
└── baselines/
    ├── hd520/          # Intel HD Graphics 520
    │   ├── dx12/
    │   │   └── 20260929_120000/
    │   │       ├── playback.json
    │   │       ├── scrub.json
    │   │       ├── seek.json
    │   │       └── paused-interaction.json
    │   └── vulkan/
    │       └── 20260929_120100/
    │           └── ...
    ├── gtx1650/        # NVIDIA GTX 1650
    │   ├── dx12/
    │   └── vulkan/
    └── m1/             # Apple M1
        └── metal/
```

## Collecting Baselines

### 1. Synthetic engine benchmark (optional)

```bash
# From clypra root directory
./scripts/collect-baselines.sh [gpu-name] [backend]

# Examples:
./scripts/collect-baselines.sh hd520 dx12
./scripts/collect-baselines.sh hd520 vulkan
./scripts/collect-baselines.sh gtx1650 dx12
./scripts/collect-baselines.sh m1 metal
```

This will:
- Run 3 benchmark iterations for each supported synthetic scenario (playback,
  scrub, cold seek, paused-quality recovery)
- Each scenario runs for 30 seconds
- Output saved to `benchmarks/baselines/{gpu}/{backend}/{timestamp}/`

This is a renderer/engine harness. It does **not** exercise the desktop
WebView readback or IPC path, so it must not be used to choose DX12 versus
Vulkan for the editor preview.

### 2. Desktop-session baseline (authoritative for preview)

Launch the desktop app separately for each requested Windows backend, run the
same fixed playback/scrub/paused-seek workload, then record the generated
session ID. The copied performance report must show the matching **actual**
backend before the session is accepted.

```powershell
$env:WGPU_BACKEND = "dx12"; .\Clypra.exe
$env:WGPU_BACKEND = "vulkan"; .\Clypra.exe
```

Create a manifest for the session analyzer:

```json
[
  { "id": "launch-dx12-session", "requestedBackend": "dx12" },
  { "id": "launch-vulkan-session", "requestedBackend": "vulkan" }
]
```

Then run:

```bash
cd clypra-api
npm run analyze -- --file sessions.json --output hd520-backends.json
```

The analyzer prints `requested` and `actual` backend and labels a mismatch.
Only matched sessions belong in a backend comparison.

### 3. Analyze Individual Synthetic Baseline

```bash
cd clypra-api
npm run analyze-baseline -- ../clypra/benchmarks/baselines/hd520/dx12/20260929_120000
```

Output includes:
- Median p95/p99 frame times
- Presented FPS
- P95 spread and regression tolerance
- Dominant stage per scenario (decode, demux, readback, IPC, composition, presentation)
- Recommended optimization priority

### 4. Compare Multiple Synthetic Baselines

```bash
cd clypra-api
npm run compare-baselines -- \
  ../clypra/benchmarks/baselines/hd520/dx12/20260929_120000 \
  ../clypra/benchmarks/baselines/hd520/vulkan/20260929_120100 \
  ../clypra/benchmarks/baselines/gtx1650/dx12/20260929_120200
```

Output includes:
- Side-by-side scenario comparison
- Relative performance (best vs worst)
- Per-configuration recommendations

## Understanding the Results

### Stage Identification

The benchmark measures p95 latency for each pipeline stage:

1. **Demux** - Media container demuxing
2. **Decode** - Video frame decoding (CPU or GPU)
3. **Render/Upload** - GPU texture upload and rendering
4. **Readback** - GPU → CPU pixel transfer
5. **IPC** - Inter-process communication to webview
6. **Composition** - WebView composition
7. **Presentation** - Final display

### Recommendations

- **prioritize-decode** 🎬
  - Decode/demux is the bottleneck
  - → Hardware decode, proxies, preview-resolution media

- **investigate-bridge** 🌉
  - Readback/IPC/presentation is the bottleneck
  - → Phase 2: Binary transport, non-blocking readback, frame queue

- **investigate-render-upload** 🎨
  - GPU render/upload is the bottleneck
  - → Optimize shader pipeline, reduce texture uploads

- **investigate-queue** ⏱️
  - Queue/scheduler is the bottleneck
  - → Bound and cancel in-flight work

- **warm-up-or-cache** 🔥
  - High initial latency, improves over time
  - → Pre-warm pipeline, cache decoded frames

- **collect-more-samples** 📊
  - Fewer than 30 samples
  - → Run longer benchmarks

### Regression Tolerance

The benchmark calculates automatic regression tolerance:
```
tolerance = max(10%, 2 × measured p95 spread)
```

This accounts for natural variance in the system and provides a threshold for detecting performance regressions.

## Phase 0 Decision Gate

Based on baseline evidence:

1. **Decode-dominant** systems:
   - Prioritize Phase 1: Hardware decode, proxy media, resolution optimization
   - Examples: Low-power CPUs, software decoders, 4K source media

2. **Bridge-dominant** systems:
   - Prioritize Phase 2: Binary transport, non-blocking readback
   - Examples: HD 520 (1.2s IPC wait), Windows systems without shared texture

3. **Mixed** systems:
   - Evaluate scenario-specific recommendations
   - May require parallel optimization tracks

## Example Workflow

```bash
# 1. Collect baselines for HD 520 with both backends
./scripts/collect-baselines.sh hd520 dx12
./scripts/collect-baselines.sh hd520 vulkan

# 2. Collect baselines for GTX 1650 with both backends
./scripts/collect-baselines.sh gtx1650 dx12
./scripts/collect-baselines.sh gtx1650 vulkan

# 3. Compare HD 520: DX12 vs Vulkan
cd clypra-api
npm run compare-baselines -- \
  ../clypra/benchmarks/baselines/hd520/dx12/20260929_120000 \
  ../clypra/benchmarks/baselines/hd520/vulkan/20260929_120100

# 4. Compare GPUs: HD 520 vs GTX 1650 (same backend)
npm run compare-baselines -- \
  ../clypra/benchmarks/baselines/hd520/dx12/20260929_120000 \
  ../clypra/benchmarks/baselines/gtx1650/dx12/20260929_120200

# 5. Make optimization decision based on dominant stage
```

## Next: Phase 2 Implementation

Once baselines show **bridge-dominant** systems (readback/IPC/present), implement:

1. **Binary Frame Transport**
   - Replace JSON base64 with binary protocol
   - ~75% bandwidth reduction

2. **Mode-Aware Delivery**
   - Playback: Latest-frame-wins (drop old frames)
   - Scrub: Supersede/cancel pending frames
   - Paused/Seek: Exact frame delivery

3. **Bounded Frame Queue**
   - 1-2 frame buffer maximum
   - Prevent memory bloat

4. **Non-Blocking Readback**
   - Triple-buffered ring
   - Renderer never waits for webview

5. **Adaptive Policy Cache**
   - Store GPU-specific tier on first run
   - Skip probing on subsequent launches
