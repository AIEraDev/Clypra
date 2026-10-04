#!/usr/bin/env python3
"""
Summarizes Clypra performance and cold-start benchmark JSON reports.
Calculates count, median, and IQR (Interquartile Range: Q75 - Q25) for each metric.

Usage:
    python3 scripts/summarize_reports.py benchmarks/results/m1
    python3 scripts/summarize_reports.py benchmarks/results/hd520
"""

import json
import sys
from pathlib import Path
from collections import defaultdict
import numpy as np


def compute_stats(values):
    if not values:
        return "N/A"
    arr = np.array(values, dtype=float)
    med = np.median(arr)
    q25 = np.percentile(arr, 25)
    q75 = np.percentile(arr, 75)
    iqr = q75 - q25
    return f"{med:8.2f} (IQR: {iqr:6.2f}, n={len(arr)})"


def parse_report(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        print(f"[WARN] Failed to parse {file_path}: {e}", file=sys.stderr)
        return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/summarize_reports.py <directory_of_reports>")
        sys.exit(1)

    dir_path = Path(sys.argv[1])
    if not dir_path.is_dir():
        print(f"Error: {dir_path} is not a directory", file=sys.stderr)
        sys.exit(1)

    files = sorted(dir_path.glob("*.json"))
    if not files:
        print(f"No JSON reports found in {dir_path}")
        sys.exit(0)

    # Group files by scenario and warmth: e.g. "s1_cold", "s1_warm", "s2_cold"
    groups = defaultdict(lambda: defaultdict(list))

    for p in files:
        name = p.stem.lower()
        parts = name.split("_")
        # Example filename: m1_s1_cold_1.json or s1_cold_1.json
        scenario = "all"
        warmth = "all"
        for part in parts:
            if part in {"s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"}:
                scenario = part.upper()
            elif part in {"cold", "warm"}:
                warmth = part

        report = parse_report(p)
        if not report:
            continue

        group_key = f"{scenario} ({warmth})"
        metrics = groups[group_key]

        # 1. Top-level & Milestones
        cold = report.get("coldStart") or report
        milestones = cold.get("milestones", {})

        if "preMainMs" in cold and cold["preMainMs"] is not None:
            metrics["preMainMs"].append(cold["preMainMs"])
        if "preMainMs" in milestones and milestones["preMainMs"] is not None:
            metrics["milestones.preMainMs"].append(milestones["preMainMs"])
        if "windowCreatedAtUs" in milestones and milestones["windowCreatedAtUs"] is not None:
            metrics["windowCreatedMs"].append(milestones["windowCreatedAtUs"] / 1000.0)
        if "windowShownAtUs" in milestones and milestones["windowShownAtUs"] is not None:
            metrics["windowShownMs"].append(milestones["windowShownAtUs"] / 1000.0)
        if "domContentLoadedMs" in milestones and milestones["domContentLoadedMs"] is not None:
            metrics["domContentLoadedMs"].append(milestones["domContentLoadedMs"])
        if "appMountedMs" in milestones and milestones["appMountedMs"] is not None:
            metrics["appMountedMs"].append(milestones["appMountedMs"])
        if "shellPaintedMs" in milestones and milestones["shellPaintedMs"] is not None:
            metrics["shellPaintedMs"].append(milestones["shellPaintedMs"])
        if "interactiveAtUs" in milestones and milestones["interactiveAtUs"] is not None:
            metrics["interactiveMs"].append(milestones["interactiveAtUs"] / 1000.0)
        if "firstFrameAtUs" in milestones and milestones["firstFrameAtUs"] is not None:
            metrics["firstFrameNativeMs"].append(milestones["firstFrameAtUs"] / 1000.0)
        if "firstFramePaintedMs" in milestones and milestones["firstFramePaintedMs"] is not None:
            metrics["firstFramePaintedMs"].append(milestones["firstFramePaintedMs"])
        if "firstSoundAtUs" in milestones and milestones["firstSoundAtUs"] is not None:
            metrics["firstSoundMs"].append(milestones["firstSoundAtUs"] / 1000.0)
        if "firstSoundLatencyUs" in milestones and milestones["firstSoundLatencyUs"] is not None:
            metrics["firstSoundLatencyMs"].append(milestones["firstSoundLatencyUs"] / 1000.0)
        if "smoothPlaybackAtUs" in milestones and milestones["smoothPlaybackAtUs"] is not None:
            metrics["smoothPlaybackMs"].append(milestones["smoothPlaybackAtUs"] / 1000.0)

        # 2. Audio Metrics
        audio = cold.get("audioMetrics", {})
        if "pcmBytes" in audio:
            metrics["audio.pcmMB"].append(audio["pcmBytes"] / (1024 * 1024))
        if "capTruncations" in audio:
            metrics["audio.capTruncations"].append(audio["capTruncations"])
        if "cliFallbacks" in audio:
            metrics["audio.cliFallbacks"].append(audio["cliFallbacks"])

        # 3. Stage Spans & Aggregates
        aggregates = cold.get("aggregates", {})
        for stage_name, agg in aggregates.items():
            if "totalWorkUs" in agg:
                metrics[f"stage.{stage_name}.workMs"].append(agg["totalWorkUs"] / 1000.0)
            if "totalWaitedUs" in agg:
                metrics[f"stage.{stage_name}.waitedMs"].append(agg["totalWaitedUs"] / 1000.0)

        # 4. Preview / Playback Telemetry if present
        preview = report.get("preview") or {}
        if "seekLatencyMs" in preview:
            metrics["seekLatencyMs"].append(preview["seekLatencyMs"])

    # Print summary tables
    for group_name, metrics in sorted(groups.items()):
        print("\n" + "=" * 70)
        print(f" Summary for Group: {group_name}")
        print("=" * 70)
        print(f"{'Metric':<35} | {'Median (IQR, Count)':<30}")
        print("-" * 70)
        for metric_name, values in sorted(metrics.items()):
            print(f"{metric_name:<35} | {compute_stats(values)}")
    print("\n" + "=" * 70)


if __name__ == "__main__":
    main()
