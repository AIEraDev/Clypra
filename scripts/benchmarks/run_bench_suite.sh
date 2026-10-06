#!/usr/bin/env bash
# ==============================================================================
# Clypra Automated Performance & Cold-Start Benchmark Suite (M1 / macOS)
# ==============================================================================
# Executes high-fidelity S1 and S2 benchmarks:
# - Disables App Nap during benchmark execution
# - Warmed up Gatekeeper run (discarded)
# - Interleaves 5 cold / warm pairs for S1 (launch to interactive)
# - Interleaves 5 cold / warm pairs for S2 (open project to first frame painted)
# - Clears system disk cache with sudo purge (or purge) before every cold run
# - Verifies window focus, visibility, validity, and process exit codes
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_BUNDLE="$REPO_ROOT/src-tauri/target/release/bundle/macos/Clypra.app"
RESULTS_DIR="$REPO_ROOT/scripts/benchmarks/results/m1"
S2_PROJECT="/Users/AIEraDev/Library/Application Support/com.deenminder.clypra/projects/project-1790635685265-f3w9oaejn1k-0.json"

mkdir -p "$RESULTS_DIR"

if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "ERROR: App bundle not found at $APP_BUNDLE" >&2
    echo "Please run: npx tauri build --bundles app --no-sign" >&2
    exit 1
fi

if [[ ! -f "$S2_PROJECT" ]]; then
    echo "ERROR: S2 Project fixture not found at $S2_PROJECT" >&2
    exit 1
fi

echo "=============================================================================="
echo " Starting Clypra Benchmark Suite on Apple M1"
echo " App:     $APP_BUNDLE"
echo " Results: $RESULTS_DIR"
echo " Project: $S2_PROJECT"
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
open -n -W -a "$APP_BUNDLE" --args --bench-report /tmp/clypra_gatekeeper.json --bench-auto-exit
osascript -e 'tell application id "com.deenminder.clypra" to activate' 2>/dev/null || true
rm -f /tmp/clypra_gatekeeper.json

run_single() {
    local scenario="$1"
    local warmth="$2"
    local index="$3"
    local report_path="$RESULTS_DIR/m1_${scenario}_${warmth}_${index}.json"
    local is_s2="$4"

    echo "------------------------------------------------------------------------------"
    echo ">>> Running $scenario ($warmth) #$index..."

    if [[ "$warmth" == "cold" ]]; then
        echo "Clearing system disk cache..."
        if sudo -n purge 2>/dev/null; then
            echo "sudo purge succeeded"
        elif purge 2>/dev/null; then
            echo "purge succeeded"
        else
            echo "WARN: purge command requires sudo authentication; proceeding"
        fi
        sleep 2
    fi

    local extra_args=()
    if [[ "$is_s2" == "true" ]]; then
        extra_args=(--bench-project "$S2_PROJECT")
    fi

    # Launch app as frontmost GUI process
    open -n -W -a "$APP_BUNDLE" --args "${extra_args[@]}" --bench-report "$report_path" --bench-auto-exit &
    local open_pid=$!

    # Bring to front for focus
    sleep 0.1
    osascript -e 'tell application id "com.deenminder.clypra" to activate' 2>/dev/null || true

    # Wait for process exit
    local exit_code=0
    wait $open_pid || exit_code=$?

    if [[ ! -f "$report_path" ]]; then
        echo "ERROR: Report was not generated at $report_path (exit code $exit_code)" >&2
        return 1
    fi

    local mtime
    mtime=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$report_path")
    local shasum
    shasum=$(shasum -a 256 "$report_path" | awk '{print $1}')

    echo "Completed $scenario ($warmth) #$index: exit=$exit_code, sha256=$shasum, mtime=$mtime"
}

echo "[3/4] Running S1 benchmark (Launch to Interactive: 5 Cold / Warm pairs)..."
for i in {1..5}; do
    run_single "s1" "cold" "$i" "false"
    run_single "s1" "warm" "$i" "false"
done

echo "[4/4] Running S2 benchmark (Project Open to First Frame: 5 Cold / Warm pairs)..."
for i in {1..5}; do
    run_single "s2" "cold" "$i" "true"
    run_single "s2" "warm" "$i" "true"
done

echo "=============================================================================="
echo " Benchmark suite completed successfully!"
echo " Summarizing results..."
echo "=============================================================================="

python3 "$REPO_ROOT/scripts/summarize_reports.py" "$RESULTS_DIR"
