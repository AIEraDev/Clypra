#!/usr/bin/env python3
"""
Summarizes Clypra performance and cold-start benchmark JSON reports.
Unifies per-run inspection and aggregate statistical analysis (median, IQR, min, max, n).
Flags any metric with n < 5 as [INSUFFICIENT (n=...)].

Usage:
    python3 scripts/summarize_reports.py scripts/benchmarks/results/m1
    python3 scripts/summarize_reports.py benchmarks/results/hd520
"""

import json
import sys
from pathlib import Path
from collections import defaultdict
import numpy as np


import hashlib
import time


def get_file_info(file_path):
    p = Path(file_path)
    stat = p.stat()
    mtime_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime))
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return mtime_str, h.hexdigest()


def compute_stats(values):
    if not values:
        return "N/A"
    arr = np.array(values, dtype=float)
    n = len(arr)
    med = np.median(arr)
    q25 = np.percentile(arr, 25)
    q75 = np.percentile(arr, 75)
    iqr = q75 - q25
    base = f"{med:7.1f} ms (IQR: {iqr:5.1f}, min: {arr.min():6.1f}, max: {arr.max():6.1f}, n={n})"
    if n < 5:
        return f"{base:<56} [INSUFFICIENT (n={n})]"
    return base


def parse_report(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        print(f"[WARN] Failed to parse {file_path}: {e}", file=sys.stderr)
        return None


def main():
    target_dir = sys.argv[1] if len(sys.argv) > 1 else "scripts/benchmarks/results/m1"
    dir_path = Path(target_dir)
    if not dir_path.is_dir():
        print(f"Error: {dir_path} is not a directory", file=sys.stderr)
        sys.exit(1)

    files = sorted(dir_path.glob("*.json"))
    if not files:
        print(f"No JSON reports found in {dir_path}")
        sys.exit(0)

    # ──────────────────────────────────────────────────────────────────────────
    # 0. File Integrity, Build Metadata & Focus Validity Table
    # ──────────────────────────────────────────────────────────────────────────
    print("=" * 130)
    print(f"               FILE INTEGRITY, BUILD METADATA & FOCUS VALIDITY ({dir_path.name.upper()})")
    print("=" * 130)
    print(f"{'Filename':<22} | {'Commit':<10} | {'Dirty':<5} | {'Profile':<7} | {'Focus(Doc/Win)':<14} | {'Vis(Doc/Win)':<13} | {'Valid':<5} | {'SHA-256':<20}")
    print("-" * 130)

    for p in files:
        report = parse_report(p)
        if not report:
            continue
        mtime, sha = get_file_info(p)
        cs = report.get("coldStart") or report
        commit = str(cs.get("gitCommit") or "unknown")[:10]
        dirty = str(cs.get("gitDirty", False))
        profile = str(cs.get("buildProfile", "unknown"))
        m = cs.get("milestones", {})
        doc_foc = "T" if m.get("documentHasFocus") else "F"
        win_foc = "T" if m.get("windowIsFocused") else "F"
        doc_vis = "T" if m.get("documentVisibilityState") == "visible" else "F"
        win_vis = "T" if m.get("windowIsVisible") else "F"
        valid = "TRUE" if m.get("valid", True) else "FALSE"
        inv_reason = f" ({m.get('invalidReason')})" if not m.get("valid", True) and m.get("invalidReason") else ""

        print(f"{p.name:<22} | {commit:<10} | {dirty:<5} | {profile:<7} | {doc_foc}/{win_foc:<12} | {doc_vis}/{win_vis:<11} | {valid:<5} | {sha[:16]}...{inv_reason}")

    # Group files by scenario and warmth: e.g. "S1 (cold)", "S1 (warm)", "S2 (cold)", "S2 (warm)"
    groups = defaultdict(list)

    for p in files:
        name = p.stem.lower()
        parts = name.split("_")
        scenario = "ALL"
        warmth = "all"
        for part in parts:
            if part in {"s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"}:
                scenario = part.upper()
            elif part in {"cold", "warm"}:
                warmth = part.lower()

        report = parse_report(p)
        if not report:
            continue

        group_key = f"{scenario}_{warmth}"
        groups[group_key].append((p.stem, report))

    # ──────────────────────────────────────────────────────────────────────────
    # 1. Individual Run Breakdown Table
    # ──────────────────────────────────────────────────────────────────────────
    print("\n" + "=" * 120)
    print(f"                CLYPRA COLD-START RUN-BY-RUN BREAKDOWN ({dir_path.name.upper()})")
    print("=" * 120)

    for gname, items in sorted(groups.items()):
        print(f"\n>>> GROUP: {gname} (N = {len(items)})")
        print("-" * 120)
        print(f"{'Run':<18} | {'preMain':<7} | {'navStart':<8} | {'DOM':<6} | {'Shell':<6} | {'Interact':<8} | {'1stFrame':<8} | {'FromOpen':<8} | {'GPU(work)':<9} | {'Audio(w)':<8}")
        print("-" * 120)
        for stem, d in items:
            cs = d.get("coldStart") or d
            m = cs.get("milestones", {})
            aggs = cs.get("aggregates", {})

            pre = cs.get("preMainMs") or m.get("preMainMs") or 0
            nav = m.get("navigationStartMs") or 0
            dom = m.get("domContentLoadedMs") or 0
            shl = m.get("shellPaintedMs") or 0
            itr = (m.get("interactiveAtUs") or 0) / 1000.0
            ff = m.get("firstFramePaintedMs")
            ff_str = f"{ff:8.1f}" if ff is not None else "     N/A"
            ff_open = m.get("firstFramePaintedFromOpenMs")
            ff_open_str = f"{ff_open:8.1f}" if ff_open is not None else "     N/A"
            gpu = aggs.get("c0_gpu_init", {}).get("totalWorkUs", 0) / 1000.0
            aud = aggs.get("c1_audio_decode_all", {}).get("totalWorkUs", 0) / 1000.0

            print(f"{stem:<18} | {pre:7.0f} | {nav:8.0f} | {dom:6.0f} | {shl:6.0f} | {itr:8.1f} | {ff_str} | {ff_open_str} | {gpu:9.2f} | {aud:8.2f}")

    # ──────────────────────────────────────────────────────────────────────────
    # 2. Comprehensive Aggregate Metrics
    # ──────────────────────────────────────────────────────────────────────────
    print("\n" + "=" * 120)
    print(f"                AGGREGATE STATISTICAL METRICS (MEDIAN, IQR, N)")
    print("=" * 120)

    group_metrics = {}

    for gname, items in sorted(groups.items()):
        metrics = defaultdict(list)
        for stem, d in items:
            cs = d.get("coldStart") or d
            m = cs.get("milestones", {})
            aggs = cs.get("aggregates", {})
            audio = cs.get("audioMetrics", {})

            # Milestones & OS
            pre = cs.get("preMainMs") if cs.get("preMainMs") is not None else m.get("preMainMs")
            if pre is not None:
                metrics["01_preMainMs"].append(pre)
            if m.get("windowCreatedAtUs") is not None:
                metrics["02_windowCreatedMs"].append(m["windowCreatedAtUs"] / 1000.0)
            if m.get("windowShownAtUs") is not None:
                metrics["03_windowShownMs"].append(m["windowShownAtUs"] / 1000.0)
            if m.get("navigationStartMs") is not None:
                metrics["04_navigationStartMs"].append(m["navigationStartMs"])
            if m.get("domContentLoadedMs") is not None:
                metrics["05_domContentLoadedMs"].append(m["domContentLoadedMs"])
            if m.get("appMountedMs") is not None:
                metrics["06_appMountedMs"].append(m["appMountedMs"])
            if m.get("shellPaintedMs") is not None:
                metrics["07_shellPaintedMs"].append(m["shellPaintedMs"])
            if m.get("interactiveAtUs") is not None:
                metrics["08_interactiveMs"].append(m["interactiveAtUs"] / 1000.0)
            if m.get("projectOpenRequestedAtUs") is not None:
                metrics["09_projectOpenRequestedMs"].append(m["projectOpenRequestedAtUs"] / 1000.0)
            if m.get("firstFrameAtUs") is not None:
                metrics["10_firstFrameNativeMs"].append(m["firstFrameAtUs"] / 1000.0)
            if m.get("firstFramePaintedMs") is not None:
                metrics["11_firstFramePaintedMs"].append(m["firstFramePaintedMs"])
            if m.get("firstFramePaintedFromOpenMs") is not None:
                metrics["12_firstFramePaintedFromOpenMs"].append(m["firstFramePaintedFromOpenMs"])
            if m.get("firstSoundAtUs") is not None:
                metrics["13_firstSoundMs"].append(m["firstSoundAtUs"] / 1000.0)
            if m.get("firstSoundLatencyUs") is not None:
                metrics["14_firstSoundLatencyMs"].append(m["firstSoundLatencyUs"] / 1000.0)
            if m.get("smoothPlaybackAtUs") is not None:
                metrics["15_smoothPlaybackMs"].append(m["smoothPlaybackAtUs"] / 1000.0)

            # Audio Metrics
            if "pcmBytes" in audio:
                metrics["20_audio.pcmMB"].append(audio["pcmBytes"] / (1024.0 * 1024.0))
            if "capTruncations" in audio:
                metrics["21_audio.capTruncations"].append(audio["capTruncations"])
            if "cliFallbacks" in audio:
                metrics["22_audio.cliFallbacks"].append(audio["cliFallbacks"])

            # Native & S2 Spans
            for stage_name, agg in aggs.items():
                if "totalWorkUs" in agg:
                    metrics[f"30_stage.{stage_name}.workMs"].append(agg["totalWorkUs"] / 1000.0)
                if "totalWaitedUs" in agg:
                    metrics[f"31_stage.{stage_name}.waitedMs"].append(agg["totalWaitedUs"] / 1000.0)

            # Raw individual spans if present
            for span in cs.get("spans", []):
                stg = span.get("stage")
                if stg and stg.startswith("s2_"):
                    work = span.get("workUs", 0) / 1000.0
                    metrics[f"40_span.{stg}.workMs"].append(work)

        group_metrics[gname] = metrics

        print(f"\n--- Group: {gname} (Total runs evaluated: {len(items)}) ---")
        print(f"{'Metric':<38} | {'Median, IQR, Range, Count':<60}")
        print("-" * 120)
        for metric_name, values in sorted(metrics.items()):
            clean_name = metric_name.split("_", 1)[-1]
            print(f"{clean_name:<38} | {compute_stats(values)}")

    # ──────────────────────────────────────────────────────────────────────────
    # 3. Cold vs Warm Comparison
    # ──────────────────────────────────────────────────────────────────────────
    for scenario in ["S1", "S2"]:
        cold_k = f"{scenario}_cold"
        warm_k = f"{scenario}_warm"
        if cold_k in group_metrics and warm_k in group_metrics:
            print("\n" + "=" * 90)
            print(f"          COLD VS WARM DELTA SUMMARY: {scenario}")
            print("=" * 90)
            c_metrics = group_metrics[cold_k]
            w_metrics = group_metrics[warm_k]

            compare_keys = [
                ("preMainMs", "01_preMainMs"),
                ("domContentLoadedMs", "05_domContentLoadedMs"),
                ("shellPaintedMs", "07_shellPaintedMs"),
                ("interactiveMs", "08_interactiveMs"),
                ("firstFramePaintedMs", "11_firstFramePaintedMs"),
                ("firstFrameFromOpenMs", "12_firstFramePaintedFromOpenMs"),
                ("gpuInitWorkMs", "30_stage.c0_gpu_init.workMs"),
                ("audioDecodeWorkMs", "30_stage.c1_audio_decode_all.workMs"),
            ]

            for label, key in compare_keys:
                c_vals = c_metrics.get(key, [])
                w_vals = w_metrics.get(key, [])
                if c_vals and w_vals:
                    c_med = np.median(c_vals)
                    w_med = np.median(w_vals)
                    diff = c_med - w_med
                    ratio = c_med / w_med if w_med > 0 else 0
                    print(f"{label:<24}: Cold {c_med:7.1f} ms  vs  Warm {w_med:7.1f} ms  ->  Δ: {diff:+7.1f} ms ({ratio:4.2f}x)")


if __name__ == "__main__":
    main()
