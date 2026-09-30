#!/bin/bash
# Collect performance baselines for Phase 0 decision gate
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

# Scenarios to benchmark
SCENARIOS=("playback" "scrub" "seek" "paused-interaction")
DURATION=30
RUNS=3

for scenario in "${SCENARIOS[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 Running scenario: ${scenario}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  OUTPUT_FILE="${OUTPUT_DIR}/${scenario}.json"
  
  cargo run --manifest-path src-tauri/Cargo.toml --bin clypra-engine-benchmark --release -- \
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
echo "  1. Copy performance reports from the app"
echo "  2. Run: npm run analyze-baseline -- ${OUTPUT_DIR}"
echo "  3. Compare with other GPU/backend combinations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
