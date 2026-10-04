#!/bin/bash
# Collect synthetic engine baselines for Phase 0.
#
# This does not launch the desktop WebView and therefore cannot validate
# GPU→CPU readback or IPC. Use the desktop session-ID workflow in
# benchmarks/README.md for DX12-vs-Vulkan preview comparisons.
#
# Usage: ./scripts/collect-baselines.sh [gpu-name] [backend]
# Example: ./scripts/collect-baselines.sh hd520 dx12

set -e

GPU_NAME=${1:-unknown}
BACKEND=${2:-default}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="benchmarks/baselines/${GPU_NAME}/${BACKEND}/${TIMESTAMP}"

mkdir -p "$OUTPUT_DIR"

echo "🎯 Collecting baselines for ${GPU_NAME} (${BACKEND})"
echo "📁 Output directory: ${OUTPUT_DIR}"
echo ""

# Scenario names are intentionally limited to the benchmark CLI contract.
SCENARIOS=("playback" "scrub" "seek-cold" "pause")
DURATION=30
RUNS=3

for scenario in "${SCENARIOS[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 Running scenario: ${scenario}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  OUTPUT_FILE="${OUTPUT_DIR}/${scenario}.json"
  
  cargo run --manifest-path src-tauri/Cargo.toml --example clypra-engine-benchmark --release -- \
    --scenario "$scenario" \
    --duration "$DURATION" \
    --runs "$RUNS" \
    --output "$OUTPUT_FILE"
  
  echo ""
  echo "✅ Saved to: ${OUTPUT_FILE}"
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Baseline collection complete!"
echo "📊 Results saved to: ${OUTPUT_DIR}"
echo ""
echo "Next steps:"
echo "  1. Run: npm run analyze-baseline -- ${OUTPUT_DIR}"
echo "  2. Compare synthetic engine runs with other configurations"
echo "  3. Use desktop session IDs for authoritative preview/IPC analysis"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
