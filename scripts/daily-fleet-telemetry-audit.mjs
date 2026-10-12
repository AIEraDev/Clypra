#!/usr/bin/env node

/**
 * Clypra Multi-OS Production Telemetry Daily Audit Runner
 *
 * Pulls deterministic telemetry cohorts and KPIs from the live Clypra API
 * (backed by Neon PostgreSQL & Cloudflare R2), systematically evaluating
 * all 3 OS families (Windows, macOS, Linux) against release SLA contracts.
 *
 * Usage:
 *   node scripts/daily-fleet-telemetry-audit.mjs [--api-url <url>] [--output <file>]
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const API_DEFAULT = "https://clypra-worker-api.abdulkabirmusa.com";

// Cross-Platform Release Gate Falsification Thresholds
const OS_SLA_THRESHOLDS = {
  macos: {
    maxP50RenderTimeMs: 16.6, // 60 FPS target
    maxP95RenderTimeMs: 33.3,
    maxP95SeekLatencyMs: 150.0,
    maxAcceptableFallbackRate: 0.01, // Metal direct surface should virtually never fall back
  },
  windows: {
    maxP50RenderTimeMs: 33.3, // 30 FPS target on heterogeneous hardware
    maxP95RenderTimeMs: 100.0,
    maxP95SeekLatencyMs: 2500.0,
    maxAcceptableFallbackRate: 0.05, // 5% maximum fallback to bridge
  },
  linux: {
    maxP50RenderTimeMs: 33.3,
    maxP95RenderTimeMs: 100.0,
    maxP95SeekLatencyMs: 2500.0,
    maxAcceptableFallbackRate: 0.10, // 10% tolerance for diverse compositors/drivers
  },
};

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-Clypra-Client": "antigravity-fleet-daily-audit",
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

  console.log(`🔍 Querying Clypra Telemetry Fleet API across all 3 OS families at ${baseUrl}...`);

  const [osData, hardwareData, fleetConsistency, sessionRollup, fallbacksData, worstData] = await Promise.all([
    fetchJson(`${baseUrl}/performance/comparison/os`),
    fetchJson(`${baseUrl}/performance/comparison/hardware`),
    fetchJson(`${baseUrl}/performance/comparison/fleet-consistency`),
    fetchJson(`${baseUrl}/performance/comparison/sessions`),
    fetchJson(`${baseUrl}/performance/edge-cases/fallbacks`),
    fetchJson(`${baseUrl}/performance/edge-cases/worst-performers`),
  ]);

  const osMatrix = Array.isArray(osData?.osMatrix) ? osData.osMatrix : [];
  const allGpuCohorts = Array.isArray(hardwareData?.gpuMatrix) ? hardwareData.gpuMatrix : [];
  const worstPerformers = Array.isArray(worstData?.results) ? worstData.results : [];

  const alerts = [];
  const lowSampleObservations = [];

  // Evaluate SLA per OS family
  const osRecords = {
    macos: osMatrix.find((m) => m.osFamily === "macos") || null,
    windows: osMatrix.find((m) => m.osFamily === "windows") || null,
    linux: osMatrix.find((m) => m.osFamily === "linux") || null,
  };

  for (const [os, data] of Object.entries(osRecords)) {
    const thresh = OS_SLA_THRESHOLDS[os];
    if (!data) {
      alerts.push(`ℹ️ [${os.toUpperCase()}] No session samples recorded in current fleet window (Telemetry under-represented).`);
      continue;
    }

    // Suppress rate-based alerts on cohorts with < 10 samples (insufficient statistical validity)
    if (data.sampleCount < 10) {
      alerts.push(
        `ℹ️ [${os.toUpperCase()}] Low sample count (${data.sampleCount} samples < 10 min threshold). Percentiles and fallback rates are preliminary.`,
      );
    } else {
      if (data.fallbackRate > thresh.maxAcceptableFallbackRate) {
        alerts.push(
          `🚨 [${os.toUpperCase()}] High fallback rate: ${(data.fallbackRate * 100).toFixed(2)}% (SLA Budget: ≤ ${(thresh.maxAcceptableFallbackRate * 100).toFixed(1)}%)`,
        );
      }
      if (typeof data.p95SeekLatencyMs === "number" && data.p95SeekLatencyMs > thresh.maxP95SeekLatencyMs) {
        alerts.push(
          `⚠️ [${os.toUpperCase()}] Elevated p95 seek latency: ${data.p95SeekLatencyMs.toFixed(1)} ms (SLA Budget: ≤ ${thresh.maxP95SeekLatencyMs} ms)`,
        );
      }
      const p50Ms = data.p50RenderTimeUs / 1000;
      if (p50Ms > thresh.maxP50RenderTimeMs) {
        alerts.push(
          `⚠️ [${os.toUpperCase()}] p50 render time is ${p50Ms.toFixed(1)} ms (SLA Budget: ≤ ${thresh.maxP50RenderTimeMs} ms)`,
        );
      }
    }
  }

  // Check hardware-specific cohort alerts with statistical confidence gating
  for (const cohort of allGpuCohorts) {
    if (cohort.sampleCount >= 10) {
      if (cohort.fallbackRate > 0.05) {
        alerts.push(
          `🚨 [GPU: ${cohort.gpuModel}] Elevated fallback rate: ${(cohort.fallbackRate * 100).toFixed(1)}% (${cohort.sampleCount} samples).`,
        );
      }
      if (cohort.primaryBottleneck && cohort.primaryBottleneck !== "none") {
        alerts.push(
          `⚠️ [GPU: ${cohort.gpuModel}] Primary bottleneck identified: '${cohort.primaryBottleneck}' (p95: ${(cohort.p95RenderTimeUs / 1000).toFixed(1)} ms, n=${cohort.sampleCount}).`,
        );
      }
    } else if (cohort.fallbackRate > 0.5) {
      // Flag high-fallback low-sample observations separately without false alarm alerts
      lowSampleObservations.push(
        `[GPU: ${cohort.gpuModel}] ${cohort.sampleCount} sample(s) recorded ${(cohort.fallbackRate * 100).toFixed(1)}% fallback (canary observation).`,
      );
    }
  }

  // ── Build Full Multi-OS Audit Report ─────────────────────────────────────────
  let md = `# Clypra Multi-OS Fleet Telemetry & Reliability Daily Audit\n\n`;
  md += `**Date:** ${dateStr} (${nowIso})\n`;
  md += `**Fleet Telemetry API:** \`${baseUrl}\`\n`;
  md += `**Target Platforms:** macOS (Metal/VideoToolbox), Windows (D3D12/wgpu), Linux (Vulkan/WebKitGTK)\n\n`;

  // Sample Definition & Confidence Invariant Notice
  md += `> [!NOTE] Sample Definition & Statistical Invariants\n`;
  md += `> - **1 Sample** = 1 discrete 30-second telemetry rollup window (or benchmark/seek span).\n`;
  md += `> - **Minimum Statistical Validity Threshold**: ≥ 10 samples required for reliable percentile and fallback rate estimation. Cohorts with < 10 samples are marked \`confidence: "low"\` and SLA rate alerts are suppressed to prevent premature conclusions.\n`;
  md += `> - **Workload Isolation**: Frame render timing and drop ratios evaluate sustained playback. Seek latency is strictly isolated to explicit seek spans (\`seek-warm\` / \`seek-cold\`) and is reported as \`N/A\` when evaluating pure playback workloads.\n\n`;

  // 1. Executive Summary & Alerts
  md += `## 1. Executive Summary & Gate SLA Status\n\n`;
  if (alerts.length === 0) {
    md += `✅ **ALL FLEET GATES PASSING**: All 3 OS families met their performance, fallback, and reliability budgets.\n\n`;
  } else {
    md += `⚠️ **${alerts.length} ALERT(S) / ACTION ITEMS DETECTED**:\n`;
    for (const alert of alerts) {
      md += `- ${alert}\n`;
    }
    if (lowSampleObservations.length > 0) {
      md += `\n**Low-Sample Exploratory Canary Notes (n < 10):**\n`;
      for (const obs of lowSampleObservations) {
        md += `- ℹ️ ${obs}\n`;
      }
    }
    md += `\n`;
  }

  // 2. Cross-OS Side-by-Side Comparison Matrix
  md += `## 2. Cross-OS Fleet Comparison Matrix (Windows vs macOS vs Linux)\n\n`;
  md += `| Metric / Invariant | macOS (Metal) | Windows (DirectX 12) | Linux (Vulkan) | Fleet SLA Standard |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  const macSamples = osRecords.macos ? `${osRecords.macos.sampleCount} samples (${osRecords.macos.sampleCount >= 10 ? "Valid" : "Preliminary"})` : "0 samples";
  const winSamples = osRecords.windows ? `${osRecords.windows.sampleCount} samples (${osRecords.windows.sampleCount >= 10 ? "Valid" : "Preliminary"})` : "0 samples";
  const linSamples = osRecords.linux ? `${osRecords.linux.sampleCount} samples (${osRecords.linux.sampleCount >= 10 ? "Valid" : "Preliminary"})` : "0 samples";
  md += `| **Session Volume** | ${macSamples} | ${winSamples} | ${linSamples} | ≥ 10 samples for statistical validity |\n`;

  const macP50 = osRecords.macos ? `${(osRecords.macos.p50RenderTimeUs / 1000).toFixed(1)} ms` : "N/A";
  const winP50 = osRecords.windows ? `${(osRecords.windows.p50RenderTimeUs / 1000).toFixed(1)} ms` : "N/A";
  const linP50 = osRecords.linux ? `${(osRecords.linux.p50RenderTimeUs / 1000).toFixed(1)} ms` : "N/A";
  md += `| **p50 Render Time** | ${macP50} | ${winP50} | ${linP50} | ≤ 16.6ms (Mac), ≤ 33.3ms (Win/Linux) |\n`;

  const macP95 = osRecords.macos ? `${(osRecords.macos.p95RenderTimeUs / 1000).toFixed(1)} ms` : "N/A";
  const winP95 = osRecords.windows ? `${(osRecords.windows.p95RenderTimeUs / 1000).toFixed(1)} ms` : "N/A";
  const linP95 = osRecords.linux ? `${(osRecords.linux.p95RenderTimeUs / 1000).toFixed(1)} ms` : "N/A";
  md += `| **p95 Render Time** | ${macP95} | ${winP95} | ${linP95} | ≤ 33.3ms (Mac), ≤ 100ms (Win/Linux) |\n`;

  const macSeek = osRecords.macos?.p95SeekLatencyMs != null ? `${osRecords.macos.p95SeekLatencyMs.toFixed(1)} ms` : "N/A (Playback window)";
  const winSeek = osRecords.windows?.p95SeekLatencyMs != null ? `${osRecords.windows.p95SeekLatencyMs.toFixed(1)} ms` : "N/A (Playback window)";
  const linSeek = osRecords.linux?.p95SeekLatencyMs != null ? `${osRecords.linux.p95SeekLatencyMs.toFixed(1)} ms` : "N/A (Playback window)";
  md += `| **p95 Seek Latency** | ${macSeek} | ${winSeek} | ${linSeek} | ≤ 150ms (Mac), ≤ 2500ms (Win/Linux) |\n`;

  const macFb = osRecords.macos ? `${(osRecords.macos.fallbackRate * 100).toFixed(2)}%` : "N/A";
  const winFb = osRecords.windows ? `${(osRecords.windows.fallbackRate * 100).toFixed(2)}%` : "N/A";
  const linFb = osRecords.linux ? `${(osRecords.linux.fallbackRate * 100).toFixed(2)}%` : "N/A";
  md += `| **Fallback Rate (Bridge)** | ${macFb} | ${winFb} | ${linFb} | ≤ 1.0% (Mac), ≤ 5.0% (Win), ≤ 10.0% (Linux) |\n`;

  const macSlow = osRecords.macos?.relativeSlowdownVsBaseline != null ? `${osRecords.macos.relativeSlowdownVsBaseline}x` : "1.0x (Ref)";
  const winSlow = osRecords.windows?.relativeSlowdownVsBaseline != null ? `${osRecords.windows.relativeSlowdownVsBaseline}x` : "N/A (Requires ≥10 samples)";
  const linSlow = osRecords.linux?.relativeSlowdownVsBaseline != null ? `${osRecords.linux.relativeSlowdownVsBaseline}x` : "N/A (Requires ≥10 samples)";
  md += `| **Relative Index vs Mac** | ${macSlow} | ${winSlow} | ${linSlow} | Baseline: macOS 1.0x (requires n≥10) |\n`;

  const formatSla = (data) => {
    if (!data) return "N/A";
    if (data.sampleCount < 10) return "⚠️ Insufficient volume (n<10)";
    return data.meetsSLA ? "✅ Pass" : "❌ Review";
  };
  md += `| **SLA Gate Status** | ${formatSla(osRecords.macos)} | ${formatSla(osRecords.windows)} | ${formatSla(osRecords.linux)} | Strict SLA Contract Budget |\n\n`;

  // 3. Platform Deep Dives
  md += `## 3. Platform Deep Dives\n\n`;

  // 3.1 macOS Deep Dive
  md += `### 3.1 macOS (Metal / VideoToolbox / Apple Silicon)\n`;
  const macCohorts = allGpuCohorts.filter((c) => c.gpuVendor === "apple" || c.gpuModel.includes("Apple") || c.gpuModel.includes("M1") || c.gpuModel.includes("M2"));
  if (macCohorts.length > 0) {
    md += `| Cohort | Samples | Confidence | p50 Render | p95 Render | Fallback % | Bottleneck | SLA Status |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const c of macCohorts) {
      const conf = c.sampleCount >= 10 ? "✅ Sufficient" : "⚠️ Low (n<10)";
      const sla = c.sampleCount < 10 ? "⚠️ Insufficient volume" : (c.meetsSLA ? "✅ Pass" : "❌ Review");
      md += `| **${c.gpuModel}** | ${c.sampleCount} | ${conf} | ${(c.p50RenderTimeUs / 1000).toFixed(1)} ms | ${(c.p95RenderTimeUs / 1000).toFixed(1)} ms | ${(c.fallbackRate * 100).toFixed(1)}% | ${c.primaryBottleneck} | ${sla} |\n`;
    }
  } else {
    md += `*Apple Silicon metrics accumulating from active Mac editor sessions.*\n`;
  }
  md += `\n`;

  // 3.2 Windows Deep Dive
  md += `### 3.2 Windows (DirectX 12 / wgpu / Heterogeneous GPUs)\n`;
  const winCohorts = allGpuCohorts.filter((c) => c.gpuVendor === "intel" || c.gpuVendor === "nvidia" || c.gpuVendor === "amd" || c.gpuModel.includes("GeForce") || c.gpuModel.includes("Radeon") || c.gpuModel.includes("Intel"));
  if (winCohorts.length > 0) {
    md += `| Cohort | Samples | Confidence | p50 Render | p95 Render | Fallback % | Bottleneck | SLA Status |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const c of winCohorts) {
      const conf = c.sampleCount >= 10 ? "✅ Sufficient" : "⚠️ Low (n<10)";
      const sla = c.sampleCount < 10 ? "⚠️ Insufficient volume" : (c.meetsSLA ? "✅ Pass" : "❌ Review");
      md += `| **${c.gpuModel}** (${c.gpuVendor}) | ${c.sampleCount} | ${conf} | ${(c.p50RenderTimeUs / 1000).toFixed(1)} ms | ${(c.p95RenderTimeUs / 1000).toFixed(1)} ms | ${(c.fallbackRate * 100).toFixed(1)}% | ${c.primaryBottleneck} | ${sla} |\n`;
    }
  } else {
    md += `*No Windows hardware samples recorded in this window.*\n`;
  }
  md += `\n`;

  // 3.3 Linux Deep Dive
  md += `### 3.3 Linux (Vulkan / WebKitGTK / VA-API)\n`;
  const linCohorts = allGpuCohorts.filter((c) => c.gpuModel.includes("Linux") || c.gpuVendor === "linux");
  if (linCohorts.length > 0) {
    md += `| Cohort | Samples | Confidence | p50 Render | p95 Render | Fallback % | Bottleneck | SLA Status |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const c of linCohorts) {
      const conf = c.sampleCount >= 10 ? "✅ Sufficient" : "⚠️ Low (n<10)";
      const sla = c.sampleCount < 10 ? "⚠️ Insufficient volume" : (c.meetsSLA ? "✅ Pass" : "❌ Review");
      md += `| **${c.gpuModel}** | ${c.sampleCount} | ${conf} | ${(c.p50RenderTimeUs / 1000).toFixed(1)} ms | ${(c.p95RenderTimeUs / 1000).toFixed(1)} ms | ${(c.fallbackRate * 100).toFixed(1)}% | ${c.primaryBottleneck} | ${sla} |\n`;
    }
  } else {
    md += `*Linux sessions are currently under-represented in the opt-in fleet (<10 samples). Linux defaults remain on the conservative DOM bridge path until opt-in canary data verifies native Vulkan stability.*\n`;
  }
  md += `\n`;

  // 4. Fallback Transitions & Failure Triage
  md += `## 4. Fleet Fallback Transitions & Root Causes\n\n`;
  if (fallbacksData?.fallbackBreakdown?.length > 0) {
    for (const fb of fallbacksData.fallbackBreakdown) {
      md += `* **Transition:** \`${fb.transition}\` (Count: ${fb.count}, ${fb.percentage}% of all fallbacks)\n`;
      if (fb.topReasons?.length > 0) {
        md += `  * **Trigger Codes:** ${fb.topReasons.map((r) => `\`${r.code}\` (${r.count}x)`).join(", ")}\n`;
      }
      if (fb.topImpactedDevices?.length > 0) {
        md += `  * **Impacted OS & Hardware:** ${fb.topImpactedDevices.map((d) => `**${d.gpuModel}** on ${d.osFamily} (${d.count}x)`).join(", ")}\n`;
      }
    }
  } else {
    md += `*Zero fallback transitions recorded across all platforms in the current fleet window.*\n`;
  }
  md += `\n`;

  // 5. Fleet Performance Edge Cases & Worst Performers
  md += `## 5. Cross-Platform Worst Performing Sessions (Triage Queue)\n\n`;
  if (worstPerformers.length > 0) {
    md += `| Rank | Platform | GPU Model | Codec / Resolution | p95 Latency | Samples | Fallback Rate |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const w of worstPerformers) {
      md += `| #${w.rank} | **${w.osFamily}** | **${w.gpuModel}** (${w.gpuVendor}) | ${w.videoCodec} / ${w.resolutionBucket} | ${(w.p95LatencyUs / 1000).toFixed(1)} ms | ${w.sampleCount} | ${(w.fallbackRate * 100).toFixed(1)}% |\n`;
    }
  } else {
    md += `*No performance anomalies or worst-performer spikes recorded.*\n`;
  }
  md += `\n`;

  // 6. Fleet Workload Distribution & Unique Sessions
  if (fleetConsistency?.byMode?.length > 0) {
    md += `## 6. Fleet Workload Distribution & Unique Sessions\n\n`;
    md += `- **Total Ingested Telemetry Events:** ${fleetConsistency.totalEvents}\n`;
    md += `- **Total Unique Reporting Sessions:** ${fleetConsistency.totalUniqueSessions}\n\n`;
    md += `| Workload Mode | Sample Windows | Unique Sessions | Mode Share % |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    const totalSamples = fleetConsistency.byMode.reduce((acc, m) => acc + (m.sampleCount || 0), 0) || 1;
    for (const m of fleetConsistency.byMode) {
      if (m.sampleCount > 0) {
        const share = ((m.sampleCount / totalSamples) * 100).toFixed(1);
        md += `| **${m.workloadMode}** | ${m.sampleCount} | ${m.uniqueSessionCount ?? "N/A"} | ${share}% |\n`;
      }
    }
    md += `\n`;
  }

  // 7. Fleet Aggregate Health Indicators
  if (sessionRollup?.totalRollupSessions) {
    md += `## 7. Fleet Aggregate Session Health\n\n`;
    md += `- **Total Rollup Sessions Recorded:** ${sessionRollup.totalRollupSessions}\n`;
    md += `- **Accumulated Program Frames Rendered:** ${sessionRollup.totalAccumulatedFrames}\n`;
    md += `- **Average Jank Events / Session:** ${sessionRollup.avgJankEventsPerSession ?? 0}\n`;
    md += `- **Fleet Average Frame Cache Hit Ratio:** ${((sessionRollup.avgCacheHitRatio ?? 0) * 100).toFixed(1)}%\n\n`;
  }

  // Write and Save
  const outPath = values.output || join(process.cwd(), "reports", "telemetry", `fleet-audit-${dateStr}.md`);
  const outDir = join(process.cwd(), "reports", "telemetry");
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(outPath, md, "utf8");
  console.log(`\n📄 Multi-OS Fleet Telemetry Report saved to: ${outPath}\n`);
  console.log(md);
}

main().catch((err) => {
  console.error("Fatal fleet audit error:", err);
  process.exit(1);
});
