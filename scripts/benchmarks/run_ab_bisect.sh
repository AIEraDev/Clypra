#!/usr/bin/env bash
# ==============================================================================
# Clypra Launch Milestone A/B Bisect (89accd5e vs HEAD)
# ==============================================================================
# Runs 5 interleaved warm S1 launches for both 89accd5e and HEAD under
# identical conditions, comparing all milestones and quiescence timing.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BUNDLE_A="/tmp/Clypra_89accd5e.app"
BUNDLE_B="/tmp/Clypra_HEAD.app"
RESULTS_DIR="$REPO_ROOT/scripts/benchmarks/results/ab_bisect"

mkdir -p "$RESULTS_DIR"
rm -f "$RESULTS_DIR"/*.json

if [[ ! -d "$BUNDLE_A" ]]; then
    echo "ERROR: Bundle A not found at $BUNDLE_A" >&2
    exit 1
fi
if [[ ! -d "$BUNDLE_B" ]]; then
    echo "ERROR: Bundle B not found at $BUNDLE_B" >&2
    exit 1
fi

echo "=============================================================================="
echo " Starting S1 Warm A/B Bisect: 89accd5e vs HEAD"
echo " Bundle A (89accd5e): $BUNDLE_A"
echo " Bundle B (HEAD):     $BUNDLE_B"
echo " Results:             $RESULTS_DIR"
echo "=============================================================================="

# Disable App Nap for benchmark precision
defaults write com.deenminder.clypra NSAppSleepDisabled -bool YES
cleanup() {
    defaults delete com.deenminder.clypra NSAppSleepDisabled 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Warm up Gatekeeper for both bundles once
echo "Warming up bundles..."
open -n -W -a "$BUNDLE_A" --args --bench-report /tmp/warmup_a.json --bench-auto-exit >/dev/null 2>&1 || true
open -n -W -a "$BUNDLE_B" --args --bench-report /tmp/warmup_b.json --bench-auto-exit >/dev/null 2>&1 || true
rm -f /tmp/warmup_a.json /tmp/warmup_b.json

run_variant() {
    local label="$1"
    local bundle="$2"
    local index="$3"
    local report_path="$RESULTS_DIR/${label}_warm_${index}.json"

    echo ">>> Running $label #$index..."
    open -n -W -a "$bundle" --args --bench-report "$report_path" --bench-auto-exit &
    local open_pid=$!

    # Gentle single activate after 100ms
    sleep 0.1
    osascript -e 'tell application id "com.deenminder.clypra" to activate' 2>/dev/null || true

    local exit_code=0
    wait $open_pid || exit_code=$?

    if [[ ! -f "$report_path" ]]; then
        echo "ERROR: Report not generated at $report_path" >&2
        return 1
    fi
}

echo "Running 5 interleaved pairs..."
for i in {1..5}; do
    run_variant "89accd5e" "$BUNDLE_A" "$i"
    run_variant "head"     "$BUNDLE_B" "$i"
done

echo "=============================================================================="
echo " Bisect complete. Generating comparison table..."
echo "=============================================================================="

python3 -c "
import json, glob
import numpy as np
from pathlib import Path

def parse_runs(prefix):
    files = sorted(glob.glob('$RESULTS_DIR/' + prefix + '_warm_*.json'))
    data = []
    for f in files:
        with open(f) as fp:
            d = json.load(fp)
        cs = d.get('coldStart') or d
        m = cs.get('milestones', {})
        data.append({
            'preMainMs': cs.get('preMainMs') or m.get('preMainMs') or 0,
            'navigationStartMs': m.get('navigationStartMs') or 0,
            'domContentLoadedMs': m.get('domContentLoadedMs') or 0,
            'appMountedMs': m.get('appMountedMs') or 0,
            'shellPaintedMs': m.get('shellPaintedMs') or 0,
            'quiescenceWaitMs': m.get('quiescenceWaitMs') or 0,
            'interactiveMs': (m.get('interactiveAtUs') or 0) / 1000.0,
            'c0_gpu_init': cs.get('aggregates', {}).get('c0_gpu_init', {}).get('totalWorkUs', 0) / 1000.0,
        })
    return data

a_runs = parse_runs('89accd5e')
b_runs = parse_runs('head')

metrics = ['preMainMs', 'navigationStartMs', 'domContentLoadedMs', 'appMountedMs', 'shellPaintedMs', 'quiescenceWaitMs', 'interactiveMs', 'c0_gpu_init']

print(f'{\"Metric\":<22} | {\"89accd5e Median (IQR)\":<25} | {\"HEAD Median (IQR)\":<25} | {\"Delta (HEAD - A)\":<18}')
print('-' * 95)

for m in metrics:
    a_vals = [r[m] for r in a_runs]
    b_vals = [r[m] for r in b_runs]
    a_med = np.median(a_vals)
    a_iqr = np.percentile(a_vals, 75) - np.percentile(a_vals, 25)
    b_med = np.median(b_vals)
    b_iqr = np.percentile(b_vals, 75) - np.percentile(b_vals, 25)
    diff = b_med - a_med
    ratio = b_med / a_med if a_med > 0 else 1.0
    print(f'{m:<22} | {a_med:7.1f} ms (IQR: {a_iqr:5.1f})     | {b_med:7.1f} ms (IQR: {b_iqr:5.1f})     | {diff:+7.1f} ms ({ratio:.2f}x)')
"
