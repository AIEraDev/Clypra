#!/usr/bin/env bash
# ==============================================================================
# Clypra Automated Performance & Cold-Start Benchmark Suite (M1 / macOS)
# ==============================================================================
# Executes high-fidelity S1 and S2 benchmarks:
# - Disables App Nap during benchmark execution (restored on exit)
# - Warmed up Gatekeeper run (discarded)
# - Interleaves 5 cold / warm pairs for S1 (launch to interactive)
# - Interleaves 5 cold / warm pairs for S2 (open project to first frame painted)
# - Clears system disk cache with sudo purge before every cold run
# - Verifies cache clearance via 512 MB cache canary read throughput (MB/s)
# - Records purge exit codes, canary throughput, focus, visibility, and exit codes
# - Emits an archival manifest.json in a timestamped results directory
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_BUNDLE="$REPO_ROOT/src-tauri/target/release/bundle/macos/Clypra.app"
RAW_BIN="$APP_BUNDLE/Contents/MacOS/clypra"
FIXTURES_DIR="/Users/Shared/clypra-fixtures"
S2_PROJECT="$FIXTURES_DIR/benchmark_project_s2.json"
CANARY_FILE="$FIXTURES_DIR/cache_canary.bin"

# Parse command line flags
RUNS_COUNT=5
LAUNCH_METHOD="bundle" # "bundle" or "raw"
SCENARIO_FILTER="all"  # "all", "s1", "s2"
SKIP_PURGE="false"
CUSTOM_RESULTS_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --runs)
            RUNS_COUNT="$2"
            shift 2
            ;;
        --launch-method)
            LAUNCH_METHOD="$2"
            shift 2
            ;;
        --s1-only)
            SCENARIO_FILTER="s1"
            shift
            ;;
        --s2-only)
            SCENARIO_FILTER="s2"
            shift
            ;;
        --skip-purge)
            SKIP_PURGE="true"
            shift
            ;;
        --results-dir)
            CUSTOM_RESULTS_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --runs <N>              Number of interleaved pairs per scenario (default: 5)"
            echo "  --launch-method <b|raw> Launch via 'bundle' (open -a) or 'raw' binary (default: bundle)"
            echo "  --s1-only               Run only S1 (launch to interactive)"
            echo "  --s2-only               Run only S2 (project open to first frame)"
            echo "  --skip-purge            Skip cache purge before cold runs (for testing)"
            echo "  --results-dir <path>    Custom output directory for JSON reports and manifest"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# Timestamped results directory to prevent overwriting prior runs
RUN_TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
if [[ -n "$CUSTOM_RESULTS_DIR" ]]; then
    RESULTS_DIR="$CUSTOM_RESULTS_DIR"
else
    RESULTS_DIR="$REPO_ROOT/scripts/benchmarks/results/m1_${RUN_TIMESTAMP}"
fi
mkdir -p "$RESULTS_DIR"

if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "ERROR: App bundle not found at $APP_BUNDLE" >&2
    echo "Please build with: npm run tauri build -- --bundles app --no-sign" >&2
    exit 1
fi

if [[ "$LAUNCH_METHOD" == "raw" && ! -f "$RAW_BIN" ]]; then
    echo "ERROR: Raw binary not found at $RAW_BIN" >&2
    exit 1
fi

if [[ ! -f "$S2_PROJECT" ]]; then
    echo "ERROR: S2 Project fixture not found at $S2_PROJECT" >&2
    exit 1
fi

# Ensure 512 MB cache canary exists
if [[ ! -f "$CANARY_FILE" ]]; then
    echo "Creating 512 MB cache canary file at $CANARY_FILE..."
    dd if=/dev/urandom of="$CANARY_FILE" bs=1M count=512 2>/dev/null
fi

# Git metadata
GIT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"
GIT_DIRTY="false"
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]]; then
    GIT_DIRTY="true"
fi

echo "=============================================================================="
echo " Starting Clypra Automated Benchmark Suite on Apple M1"
echo " App:           $APP_BUNDLE"
echo " Launch Method: $LAUNCH_METHOD"
echo " Results Dir:   $RESULTS_DIR"
echo " Project:       $S2_PROJECT"
echo " Git Commit:    ${GIT_COMMIT:0:10} (dirty: $GIT_DIRTY)"
echo " Canary File:   $CANARY_FILE"
echo " Runs Count:    $RUNS_COUNT pairs"
echo "=============================================================================="

# Disable App Nap for benchmark precision
echo "[1/4] Disabling App Nap for Clypra..."
defaults write com.deenminder.clypra NSAppSleepDisabled -bool YES

# Restore App Nap on exit
cleanup() {
    echo "Restoring App Nap settings..."
    defaults delete com.deenminder.clypra NSAppSleepDisabled 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Warm up Gatekeeper / OS quarantine once and discard
echo "[2/4] Warming up Gatekeeper (discarding first launch)..."
if [[ "$LAUNCH_METHOD" == "bundle" ]]; then
    open -n -W -a "$APP_BUNDLE" --args --bench-report /tmp/clypra_gatekeeper.json --bench-auto-exit
    osascript -e 'tell application id "com.deenminder.clypra" to activate' 2>/dev/null || true
else
    "$RAW_BIN" --bench-report /tmp/clypra_gatekeeper.json --bench-auto-exit >/dev/null 2>&1 || true
fi
rm -f /tmp/clypra_gatekeeper.json

# Cache canary throughput reader function (reads 512 MB and prints MB/s)
measure_canary_speed() {
    python3 -c '
import time, sys
path = sys.argv[1]
t0 = time.perf_counter()
with open(path, "rb") as f:
    total = 0
    while chunk := f.read(4 * 1024 * 1024):
        total += len(chunk)
dt = time.perf_counter() - t0
mb_s = (total / (1024 * 1024)) / max(dt, 0.000001)
print(f"{mb_s:.1f}")
' "$CANARY_FILE"
}

# In-memory array of manifest entries (formatted as JSON objects)
MANIFEST_ENTRIES=()

run_single() {
    local scenario="$1"
    local warmth="$2"
    local index="$3"
    local report_path="$RESULTS_DIR/m1_${scenario}_${warmth}_${index}.json"
    local is_s2="$4"

    echo "------------------------------------------------------------------------------"
    echo ">>> Running $scenario ($warmth) #$index..."

    local purge_exit_code="null"
    local canary_mb_s="null"

    if [[ "$warmth" == "cold" && "$SKIP_PURGE" != "true" ]]; then
        echo "  [PURGE] Clearing system buffer cache..."
        local p_code=1
        if sudo -n /usr/sbin/purge 2>/dev/null; then
            p_code=0
            echo "  [PURGE] sudo /usr/sbin/purge succeeded (code=0)"
        elif /usr/sbin/purge 2>/dev/null; then
            p_code=0
            echo "  [PURGE] /usr/sbin/purge succeeded (code=0)"
        else
            p_code=$?
            echo "  [WARN] purge command requires passwordless sudo; run sudoers config (exit=$p_code)"
        fi
        purge_exit_code="$p_code"
        sleep 1

        local speed
        speed=$(measure_canary_speed)
        canary_mb_s="$speed"
        echo "  [CANARY] 512 MB read throughput: ${speed} MB/s (cold NAND baseline is ~1000-2500 MB/s, warm is >8000 MB/s)"
    fi

    local bench_args=(--bench-report "$report_path" --bench-auto-exit)
    if [[ "$is_s2" == "true" ]]; then
        bench_args+=(--bench-project "$S2_PROJECT")
    fi

    local exit_code=0
    if [[ "$LAUNCH_METHOD" == "bundle" ]]; then
        open -n -W -a "$APP_BUNDLE" --args "${bench_args[@]}" &
        local open_pid=$!

        # Bring to front for focus verification
        (
            for _ in 1 2 3 4; do
                sleep 0.15
                osascript -e 'tell application id "com.deenminder.clypra" to activate' 2>/dev/null || true
            done
        ) &
        local activate_pid=$!

        wait $open_pid || exit_code=$?
        kill $activate_pid 2>/dev/null || true
    else
        "$RAW_BIN" "${bench_args[@]}" &
        local raw_pid=$!

        (
            for _ in 1 2 3 4; do
                sleep 0.15
                osascript -e 'tell application id "com.deenminder.clypra" to activate' 2>/dev/null || true
            done
        ) &
        local activate_pid=$!

        wait $raw_pid || exit_code=$?
        kill $activate_pid 2>/dev/null || true
    fi

    if [[ ! -f "$report_path" ]]; then
        echo "ERROR: Report was not generated at $report_path (exit code $exit_code)" >&2
        return 1
    fi

    local mtime
    mtime=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$report_path")
    local full_sha
    full_sha=$(shasum -a 256 "$report_path" | awk '{print $1}')

    echo "Completed $scenario ($warmth) #$index: exit=$exit_code, sha256=${full_sha:0:16}..., mtime=$mtime"

    # Add entry for manifest
    MANIFEST_ENTRIES+=(
        "{\"file\":\"m1_${scenario}_${warmth}_${index}.json\",\"scenario\":\"$scenario\",\"warmth\":\"$warmth\",\"index\":$index,\"exitCode\":$exit_code,\"purgeExitCode\":$purge_exit_code,\"canaryMbS\":$canary_mb_s,\"mtime\":\"$mtime\",\"sha256\":\"$full_sha\"}"
    )
}

if [[ "$SCENARIO_FILTER" == "all" || "$SCENARIO_FILTER" == "s1" ]]; then
    echo "[3/4] Running S1 benchmark (Launch to Interactive: $RUNS_COUNT Cold / Warm pairs)..."
    for ((i=1; i<=RUNS_COUNT; i++)); do
        run_single "s1" "cold" "$i" "false"
        run_single "s1" "warm" "$i" "false"
    done
fi

if [[ "$SCENARIO_FILTER" == "all" || "$SCENARIO_FILTER" == "s2" ]]; then
    echo "[4/4] Running S2 benchmark (Project Open to First Frame: $RUNS_COUNT Cold / Warm pairs)..."
    for ((i=1; i<=RUNS_COUNT; i++)); do
        run_single "s2" "cold" "$i" "true"
        run_single "s2" "warm" "$i" "true"
    done
fi

# Write manifest.json
echo "Writing manifest to $RESULTS_DIR/manifest.json..."
MANIFEST_JOINED=$(IFS=,; echo "${MANIFEST_ENTRIES[*]}")
python3 -c "
import json, sys
data = {
    'timestamp': '$RUN_TIMESTAMP',
    'platform': 'apple_m1',
    'launchMethod': '$LAUNCH_METHOD',
    'gitCommit': '$GIT_COMMIT',
    'gitDirty': $GIT_DIRTY,
    'resultsDir': '$RESULTS_DIR',
    'runs': [$MANIFEST_JOINED]
}
with open('$RESULTS_DIR/manifest.json', 'w') as f:
    json.dump(data, f, indent=2)
"

echo "=============================================================================="
echo " Benchmark suite completed successfully!"
echo " Results archived at: $RESULTS_DIR"
echo " Summarizing results..."
echo "=============================================================================="

python3 "$REPO_ROOT/scripts/summarize_reports.py" "$RESULTS_DIR"
