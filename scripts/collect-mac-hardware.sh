#!/usr/bin/env bash
# ==============================================================================
# Collects macOS hardware specifications for the Clypra benchmark report
# ==============================================================================

echo "=== Clypra Benchmark Hardware Specs (macOS) ==="
echo -n "CPU: "; sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m
RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
echo "RAM: $(( RAM_BYTES / 1024 / 1024 / 1024 )) GB ($RAM_BYTES bytes)"
echo -n "OS: "; sw_vers -productName; echo -n "Version: "; sw_vers -productVersion; echo -n "Build: "; sw_vers -buildVersion
echo "--- GPU & Displays ---"
system_profiler SPDisplaysDataType 2>/dev/null | grep -E "Chipset Model|Total Number of Cores|Resolution|Refresh Rate|Metal Family" || true
echo "--- Storage Type ---"
diskutil info / 2>/dev/null | grep -E "Device / Media Name|Solid State|Protocol|Disk Size" || true
echo "--- Power / Battery ---"
pmset -g batt 2>/dev/null || true
pmset -g 2>/dev/null | grep -i lowpowermode || true
echo "==============================================="

