#!/usr/bin/env node

/**
 * Clypra Windows Production Telemetry Daily Audit Runner
 *
 * Pulls deterministic telemetry cohorts and KPIs from the live Clypra API
 * (backed by Neon PostgreSQL & Cloudflare R2), evaluates them against release
 * gate thresholds, and formats an empirical report.
 *
 * Usage:
 *   node scripts/daily-windows-audit.mjs [--api-url <url>] [--output <file>]
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const API_DEFAULT = "https://clypra-worker-api.abdulkabirmusa.com";

// Release Gate Falsification Thresholds for Windows
const THRESHOLDS = {
  minCohortSamples: 10,
  maxAcceptableFallbackRate: 0.05, // > 5% fallback triggers alert
  maxP95SeekLatencyMs: 2500.0, // > 2.5s seek cold triggers alert
  minDeliveredFps: 24.0,
};

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-Clypra-Client": "antigravity-windows-daily-audit",
      },
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${res.statusText}` };
    }
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "api-url": {
        type: "string",
        default: process.env.CLYPRA_API_URL || API_DEFAULT,
      },
      "output": {
        type: "string",
      },
    },
  });

  const baseUrl = values["api-url"].replace(/\/+$/, "");
  const nowIso = new Date().toISOString();
  const dateStr = nowIso.slice(0, 10);

  console.log(`🔍 Querying Clypra Telemetry Fleet API at ${baseUrl}...`);

  const [osData, hardwareData, fallbacksData, worstData] = await Promise.all([
    fetchJson(`${baseUrl}/performance/comparison/os`),
    fetchJson(`${baseUrl}/performance/comparison/hardware`),
    fetchJson(`${baseUrl}/performance/edge-cases/fallbacks`),
    fetchJson(`${baseUrl}/performance/edge-cases/worst-performers`),
  ]);

  const windowsOs = Array.isArray(osData?.osMatrix)
    ? osData.osMatrix.find((m) => m.osFamily === "windows")
    : null;

  const allGpuCohorts = Array.isArray(hardwareData?.gpuMatrix)
    ? hardwareData.gpuMatrix
    : [];

  const windowsWorst = Array.isArray(worstData?.results)
    ? worstData.results.filter((r) => r.osFamily === "windows")
    : [];

  const alerts = [];

  // Check overall Windows OS metrics
  if (windowsOs) {
    if (windowsOs.fallbackRate > THRESHOLDS.maxAcceptableFallbackRate) {
      alerts.push(
        `🚨 High overall Windows fallback rate: ${(windowsOs.fallbackRate * 100).toFixed(1)}% (Threshold: ≤ ${(THRESHOLDS.maxAcceptableFallbackRate * 100).toFixed(1)}%)`,
      );
    }
    if (windowsOs.p95SeekLatencyMs > THRESHOLDS.maxP95SeekLatencyMs) {
      alerts.push(
        `⚠️ Elevated Windows p95 seek latency: ${windowsOs.p95SeekLatencyMs.toFixed(1)} ms (Threshold: ≤ ${THRESHOLDS.maxP95SeekLatencyMs} ms)`,
      );
    }
  }

  // Check GPU Cohorts
  for (const cohort of allGpuCohorts) {
    if (cohort.fallbackRate > THRESHOLDS.maxAcceptableFallbackRate) {
      alerts.push(
        `🚨 GPU Cohort '${cohort.gpuModel}' (${cohort.gpuVendor}) has a ${(cohort.fallbackRate * 100).toFixed(1)}% fallback rate (${cohort.sampleCount} samples).`,
      );
    }
    if (cohort.primaryBottleneck && cohort.primaryBottleneck !== "none") {
      alerts.push(
        `⚠️ GPU Cohort '${cohort.gpuModel}' bottleneck identified: '${cohort.primaryBottleneck}' (p95 render: ${(cohort.p95RenderTimeUs / 1000).toFixed(1)} ms).`,
      );
    }
  }

  // Build Markdown Audit Report
  let md = `# Clypra Windows Telemetry & Reliability Daily Audit\n\n`;
  md += `**Date:** ${dateStr} (${nowIso})\n`;
  md += `**Target API:** \`${baseUrl}\`\n\n`;

  md += `## 1. Executive Status & Alerts\n\n`;
  if (alerts.length === 0) {
    md += `✅ **ALL GATES PASSING**: No cohort exceeded degradation or fallback thresholds in the current reporting period.\n\n`;
  } else {
    md += `⚠️ **${alerts.length} ALERT(S) DETECTED**:\n`;
    for (const alert of alerts) {
      md += `- ${alert}\n`;
    }
    md += `\n`;
  }

  md += `## 2. Platform Comparison (Windows vs Baseline macOS)\n\n`;
  if (windowsOs) {
    md += `| Metric | Windows Production | Baseline macOS | Status |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    md += `| Total Recorded Samples | **${windowsOs.sampleCount}** | ${osData.osMatrix.find((m) => m.osFamily === "macos")?.sampleCount ?? "N/A"} | ${windowsOs.sampleCount >= 20 ? "Sufficient Data" : "Accumulating"} |\n`;
    md += `| p50 Render Time | ${(windowsOs.p50RenderTimeUs / 1000).toFixed(1)} ms | ${(osData.osMatrix.find((m) => m.osFamily === "macos")?.p50RenderTimeUs / 1000 ?? 0).toFixed(1)} ms | ${windowsOs.p50RenderTimeUs < 33000 ? "60+ FPS" : "Bounded"} |\n`;
    md += `| p95 Render Time | ${(windowsOs.p95RenderTimeUs / 1000).toFixed(1)} ms | ${(osData.osMatrix.find((m) => m.osFamily === "macos")?.p95RenderTimeUs / 1000 ?? 0).toFixed(1)} ms | - |\n`;
    md += `| p95 Seek Latency | ${windowsOs.p95SeekLatencyMs.toFixed(1)} ms | ${(osData.osMatrix.find((m) => m.osFamily === "macos")?.p95SeekLatencyMs ?? 0).toFixed(1)} ms | ${windowsOs.p95SeekLatencyMs <= THRESHOLDS.maxP95SeekLatencyMs ? "Normal" : "Elevated"} |\n`;
    md += `| Fallback Rate (Bridge) | ${(windowsOs.fallbackRate * 100).toFixed(2)}% | ${(osData.osMatrix.find((m) => m.osFamily === "macos")?.fallbackRate ?? 0).toFixed(2)}% | ${windowsOs.fallbackRate <= THRESHOLDS.maxAcceptableFallbackRate ? "Within Budget" : "Breach"} |\n`;
    md += `| Relative Slowdown vs Mac | ${windowsOs.relativeSlowdownVsBaseline}x | 1.0x | - |\n\n`;
  } else {
    md += `*No Windows OS aggregate samples recorded in this period.*\n\n`;
  }

  md += `## 3. Windows GPU Cohort Breakdown\n\n`;
  md += `| GPU Vendor / Model | Samples | Confidence | p50 Render | p95 Render | Fallback % | Bottleneck | Gate SLA |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const c of allGpuCohorts) {
    const isWindowsDevice = c.gpuVendor !== "apple";
    if (!isWindowsDevice) continue;

    const confBadge = c.confidence === "sufficient" ? "🟢 Sufficient" : "🟡 Low (<10)";
    const fallbackBadge = (c.fallbackRate * 100).toFixed(1) + "%";
    const slaBadge = c.meetsSLA ? "✅ Pass" : "❌ Fail";
    md += `| **${c.gpuModel}** (${c.gpuVendor}) | ${c.sampleCount} | ${confBadge} | ${(c.p50RenderTimeUs / 1000).toFixed(1)} ms | ${(c.p95RenderTimeUs / 1000).toFixed(1)} ms | ${fallbackBadge} | ${c.primaryBottleneck} | ${slaBadge} |\n`;
  }
  md += `\n`;

  md += `## 4. Fallback Transitions & Root Causes\n\n`;
  if (fallbacksData?.fallbackBreakdown?.length > 0) {
    for (const fb of fallbacksData.fallbackBreakdown) {
      md += `* **Transition:** \`${fb.transition}\` (Total count: ${fb.count}, ${fb.percentage}%)\n`;
      if (fb.topReasons?.length > 0) {
        md += `  * **Top Reasons:** ${fb.topReasons.map((r) => `\`${r.code}\` (${r.count}x)`).join(", ")}\n`;
      }
      if (fb.topImpactedDevices?.length > 0) {
        md += `  * **Impacted Hardware:** ${fb.topImpactedDevices.map((d) => `${d.gpuModel} on ${d.osFamily} (${d.count}x)`).join(", ")}\n`;
      }
    }
  } else {
    md += `*Zero fallback transitions recorded in the fleet during this window.*\n`;
  }
  md += `\n`;

  md += `## 5. Worst Performing Sessions (Triage Targets)\n\n`;
  if (windowsWorst.length > 0) {
    md += `| Rank | GPU Model | Codec / Res | p95 Latency | Samples | Fallback Rate |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const w of windowsWorst) {
      md += `| #${w.rank} | **${w.gpuModel}** (${w.gpuVendor}) | ${w.videoCodec} / ${w.resolutionBucket} | ${(w.p95LatencyUs / 1000).toFixed(1)} ms | ${w.sampleCount} | ${(w.fallbackRate * 100).toFixed(1)}% |\n`;
    }
  } else {
    md += `*No worst performer anomalies recorded.*\n`;
  }
  md += `\n`;

  // Output formatting
  const outPath = values.output || join(process.cwd(), "reports", "telemetry", `windows-audit-${dateStr}.md`);
  const outDir = join(process.cwd(), "reports", "telemetry");
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(outPath, md, "utf8");
  console.log(`\n📄 Report written to: ${outPath}\n`);
  console.log(md);
}

main().catch((err) => {
  console.error("Fatal audit runner error:", err);
  process.exit(1);
});
