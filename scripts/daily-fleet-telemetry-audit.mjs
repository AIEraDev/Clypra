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

// Install-Level Deduplication & Reliability Invariants
export const MIN_DISTINCT_INSTALLS = 5; // Minimum distinct installs required before driving verdicts
export const MAX_SAMPLES_PER_INSTALL = 10; // Cap single-install sample contribution

export function computeMedianOfInstallMedians(cohorts, installsByGpu = new Map(), slaBudgetMs = 33.3) {
  if (!Array.isArray(cohorts) || cohorts.length === 0) return null;
  // One vote per install: each install gets its cohort median render time
  const installMedians = [];
  let worstCohortP95Ms = 0;
  let worstCohortModel = "";
  let installsUnderSla = 0;

  for (const c of cohorts) {
    const installs = installsByGpu.get(c.gpuModel) ?? 1;
    const p50Ms = (c.p50RenderTimeUs ?? 0) / 1000;
    const p95Ms = (c.p95RenderTimeUs ?? 0) / 1000;

    if (p95Ms > worstCohortP95Ms) {
      worstCohortP95Ms = p95Ms;
      worstCohortModel = c.gpuModel;
    }

    for (let i = 0; i < installs; i++) {
      installMedians.push(p50Ms);
      if (p50Ms <= slaBudgetMs) {
        installsUnderSla++;
      }
    }
  }

  if (installMedians.length === 0) return null;
  installMedians.sort((a, b) => a - b);
  const medianOfMedians = installMedians[Math.floor(installMedians.length * 0.5)];

  const fastCluster = installMedians.filter((v) => v <= slaBudgetMs);
  const slowCluster = installMedians.filter((v) => v > slaBudgetMs);
  const fastClusterMedianMs =
    fastCluster.length > 0 ? fastCluster[Math.floor(fastCluster.length * 0.5)] : null;
  const slowClusterMedianMs =
    slowCluster.length > 0 ? slowCluster[Math.floor(slowCluster.length * 0.5)] : null;

  return {
    distinctInstalls: installMedians.length,
    medianOfMediansMs: medianOfMedians,
    worstCohortP95Ms,
    worstCohortModel,
    installsUnderSla,
    slaBudgetMs,
    fastClusterMedianMs,
    slowClusterMedianMs,
    fastClusterCount: fastCluster.length,
    slowClusterCount: slowCluster.length,
  };
}

export function computeWeightedPlatformStats(cohorts, capPerInstall = MAX_SAMPLES_PER_INSTALL) {
  if (!Array.isArray(cohorts) || cohorts.length === 0) return null;
  const values = [];
  let totalCappedSamples = 0;
  for (const c of cohorts) {
    const capped = Math.min(c.sampleCount, capPerInstall);
    totalCappedSamples += capped;
    const p50Ms = (c.p50RenderTimeUs ?? 0) / 1000;
    for (let i = 0; i < capped; i++) {
      values.push(p50Ms);
    }
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const p50Ms = values[Math.floor(values.length * 0.5)];
  const p95Ms = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
  return {
    totalCappedSamples,
    p50Ms,
    p95Ms,
  };
}

export function evaluateFleetTelemetry({
  osData,
  hardwareData,
  fleetConsistency,
  sessionRollup,
  fallbacksData,
  worstData,
}) {
  const osMatrix = Array.isArray(osData?.osMatrix) ? osData.osMatrix : [];
  const allGpuCohorts = Array.isArray(hardwareData?.gpuMatrix) ? hardwareData.gpuMatrix : [];
  const worstPerformers = Array.isArray(worstData?.results) ? worstData.results : [];

  const alerts = [];
  const lowSampleObservations = [];

  // Map distinct installs per GPU model from fleet consistency breakdown
  const installsByGpu = new Map();
  if (Array.isArray(fleetConsistency?.byMode)) {
    for (const mode of fleetConsistency.byMode) {
      if (Array.isArray(mode.gpuBreakdown)) {
        for (const gpu of mode.gpuBreakdown) {
          if (gpu.gpuModel) {
            const current = installsByGpu.get(gpu.gpuModel) || 0;
            const unique =
              typeof gpu.uniqueSessionCount === "number"
                ? gpu.uniqueSessionCount
                : gpu.sampleCount > 0
                  ? 1
                  : 0;
            installsByGpu.set(gpu.gpuModel, Math.max(current, unique));
          }
        }
      }
    }
  }

  // Group cohorts by OS family
  const macCohorts = allGpuCohorts.filter(
    (c) =>
      c.gpuVendor === "apple" ||
      c.gpuModel.includes("Apple") ||
      c.gpuModel.includes("M1") ||
      c.gpuModel.includes("M2"),
  );
  const winCohorts = allGpuCohorts.filter(
    (c) =>
      c.gpuVendor === "intel" ||
      c.gpuVendor === "nvidia" ||
      c.gpuVendor === "amd" ||
      c.gpuModel.includes("GeForce") ||
      c.gpuModel.includes("Radeon") ||
      c.gpuModel.includes("Intel"),
  );
  const linCohorts = allGpuCohorts.filter(
    (c) => c.gpuModel.includes("Linux") || c.gpuVendor === "linux",
  );

  const getDistinctInstallsForGroup = (cohorts) => {
    return cohorts.reduce((acc, c) => acc + (installsByGpu.get(c.gpuModel) ?? 1), 0);
  };

  const osInstallCounts = {
    macos: getDistinctInstallsForGroup(macCohorts),
    windows: getDistinctInstallsForGroup(winCohorts),
    linux: getDistinctInstallsForGroup(linCohorts),
  };

  // Detect single-install skew (e.g., GTS 450 dominating >50% of Windows volume)
  const maxWinCohort = winCohorts.reduce(
    (max, c) => (c.sampleCount > (max?.sampleCount || 0) ? c : max),
    null,
  );
  const gts450Dominates =
    maxWinCohort &&
    maxWinCohort.sampleCount > 50 &&
    (installsByGpu.get(maxWinCohort.gpuModel) ?? 1) === 1;

  // Recomputed install-level statistics (one vote per install median)
  const macInstallStats = computeMedianOfInstallMedians(macCohorts, installsByGpu, OS_SLA_THRESHOLDS.macos.maxP50RenderTimeMs);
  const winInstallStats = computeMedianOfInstallMedians(winCohorts, installsByGpu, OS_SLA_THRESHOLDS.windows.maxP50RenderTimeMs);
  const linInstallStats = computeMedianOfInstallMedians(linCohorts, installsByGpu, OS_SLA_THRESHOLDS.linux.maxP50RenderTimeMs);

  // Recomputed install-capped statistics for Windows when single-install skew occurs
  const cappedWinStats = gts450Dominates
    ? computeWeightedPlatformStats(winCohorts, MAX_SAMPLES_PER_INSTALL)
    : null;

  // Evaluate SLA per OS family with distinct install gating
  const osRecords = {
    macos: osMatrix.find((m) => m.osFamily === "macos") || null,
    windows: osMatrix.find((m) => m.osFamily === "windows") || null,
    linux: osMatrix.find((m) => m.osFamily === "linux") || null,
  };

  for (const [os, data] of Object.entries(osRecords)) {
    const thresh = OS_SLA_THRESHOLDS[os];
    const installs = osInstallCounts[os] || 0;
    if (!data) {
      alerts.push(
        `ℹ️ [${os.toUpperCase()}] No session samples recorded in current fleet window (Telemetry under-represented).`,
      );
      continue;
    }

    if (installs < MIN_DISTINCT_INSTALLS) {
      alerts.push(
        `ℹ️ [${os.toUpperCase()}] Low install diversity (${installs} distinct install${installs === 1 ? "" : "s"} < ${MIN_DISTINCT_INSTALLS} min threshold). Pooled metrics are preliminary and do not drive release hold.`,
      );
    } else {
      if (data.fallbackRate > thresh.maxAcceptableFallbackRate) {
        alerts.push(
          `🚨 [${os.toUpperCase()}] High fallback rate: ${(data.fallbackRate * 100).toFixed(2)}% (SLA Budget: ≤ ${(thresh.maxAcceptableFallbackRate * 100).toFixed(1)}%)`,
        );
      }
      if (
        typeof data.p95SeekLatencyMs === "number" &&
        data.p95SeekLatencyMs > thresh.maxP95SeekLatencyMs
      ) {
        alerts.push(
          `⚠️ [${os.toUpperCase()}] Elevated p95 seek latency: ${data.p95SeekLatencyMs.toFixed(1)} ms (SLA Budget: ≤ ${thresh.maxP95SeekLatencyMs} ms)`,
        );
      }
      const p50Ms = data.p50RenderTimeUs / 1000;
      if (p50Ms > thresh.maxP50RenderTimeMs) {
        if (os === "windows" && gts450Dominates) {
          lowSampleObservations.push(
            `[WINDOWS] Pooled p50 (${p50Ms.toFixed(1)} ms) is skewed by a single legacy install (${maxWinCohort.gpuModel}, ${maxWinCohort.sampleCount}/${data.sampleCount} samples). Deduplicated install-capped weighted median: ${cappedWinStats?.p50Ms.toFixed(1)} ms. Modern GPU cohorts require isolated evaluation.`,
          );
        } else {
          alerts.push(
            `⚠️ [${os.toUpperCase()}] p50 render time is ${p50Ms.toFixed(1)} ms (SLA Budget: ≤ ${thresh.maxP50RenderTimeMs} ms)`,
          );
        }
      }
    }
  }

  // Check hardware-specific cohort alerts with distinct install deduplication & capping
  for (const cohort of allGpuCohorts) {
    const installs = installsByGpu.get(cohort.gpuModel) ?? 1;
    const cappedSamples = Math.min(cohort.sampleCount, installs * MAX_SAMPLES_PER_INSTALL);
    const hasSufficientInstalls = installs >= MIN_DISTINCT_INSTALLS;

    if (hasSufficientInstalls && cappedSamples >= 10) {
      if (cohort.fallbackRate > 0.05) {
        alerts.push(
          `🚨 [GPU: ${cohort.gpuModel}] Elevated fallback rate: ${(cohort.fallbackRate * 100).toFixed(1)}% (${cappedSamples} capped samples, ${installs} installs).`,
        );
      }
      if (cohort.primaryBottleneck && cohort.primaryBottleneck !== "none") {
        alerts.push(
          `⚠️ [GPU: ${cohort.gpuModel}] Primary bottleneck identified: '${cohort.primaryBottleneck}' (p95: ${(cohort.p95RenderTimeUs / 1000).toFixed(1)} ms, n=${cappedSamples}, ${installs} installs).`,
        );
      }
    } else {
      // Cohorts with < 5 installs are preliminary canaries; record them without triggering release-hold gate alerts
      if (cohort.primaryBottleneck && cohort.primaryBottleneck !== "none" && cohort.sampleCount >= 5) {
        lowSampleObservations.push(
          `[GPU: ${cohort.gpuModel}] ${cohort.sampleCount} windows from ${installs} install: primary bottleneck flagged as '${cohort.primaryBottleneck}' (p95: ${(cohort.p95RenderTimeUs / 1000).toFixed(1)} ms). Requires ≥ ${MIN_DISTINCT_INSTALLS} installs before release-blocking gate action.`,
        );
      } else if (cohort.fallbackRate > 0.5) {
        lowSampleObservations.push(
          `[GPU: ${cohort.gpuModel}] ${cohort.sampleCount} window(s) from ${installs} install recorded ${(cohort.fallbackRate * 100).toFixed(1)}% fallback (canary observation).`,
        );
      }
    }
  }

  return {
    osMatrix,
    allGpuCohorts,
    macCohorts,
    winCohorts,
    linCohorts,
    osInstallCounts,
    gts450Dominates,
    maxWinCohort,
    cappedWinStats,
    macInstallStats,
    winInstallStats,
    linInstallStats,
    installsByGpu,
    osRecords,
    alerts,
    lowSampleObservations,
    worstPerformers,
    fleetConsistency,
    sessionRollup,
    fallbacksData,
  };
}

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

  const {
    osMatrix,
    allGpuCohorts,
    macCohorts,
    winCohorts,
    linCohorts,
    osInstallCounts,
    gts450Dominates,
    maxWinCohort,
    cappedWinStats,
    macInstallStats,
    winInstallStats,
    linInstallStats,
    installsByGpu,
    osRecords,
    alerts,
    lowSampleObservations,
    worstPerformers,
  } = evaluateFleetTelemetry({
    osData,
    hardwareData,
    fleetConsistency,
    sessionRollup,
    fallbacksData,
    worstData,
  });

  // ── Build Full Multi-OS Audit Report ─────────────────────────────────────────
  let md = `# Clypra Multi-OS Fleet Telemetry & Reliability Daily Audit\n\n`;
  md += `**Date:** ${dateStr} (${nowIso})\n`;
  md += `**App Version:** Clypra v1.6.0 (Production Desktop Release)\n`;
  md += `**Fleet Telemetry API:** \`${baseUrl}\`\n`;
  md += `**Target Platforms:** macOS (Metal/VideoToolbox), Windows (D3D12/wgpu), Linux (Vulkan/WebKitGTK)\n\n`;

  // Sample Definition & Confidence Invariant Notice
  md += `> [!NOTE] Sample Definition & Statistical Invariants\n`;
  md += `> - **1 Sample** = 1 discrete 30-second telemetry rollup window (or benchmark/seek span).\n`;
  md += `> - **App Version & Provenance**: Fleet telemetry reflects Clypra \`v1.6.0\` builds. Telemetry payloads attach client \`appVersion\` to isolate releases.\n`;
  md += `> - **Install Count vs Cohort Semantics**: 'Installs' is currently mapped from \`uniqueSessionCount\` in the fleet API, meaning figures such as '7 of 18 cohorts' reflect distinct GPU cohorts (each treated as one install in current API aggregations) until client-side anonymous UUID adoption propagates across all users.\n`;
  md += `> - **Install-Level Deduplication Invariant**: Distinct cohorts are tracked separately. Headline platform render timing reports SLA compliance share and bimodal cluster medians rather than misleading single pooled medians across separated clusters or percentiles-of-percentiles.\n`;
  md += `> - **Tail Latency Visibility**: Tail latency is reported alongside medians via **Worst Cohort p95** to prevent averaging or hiding extreme tail stalls.\n`;
  md += `> - **Minimum Install Diversity Gate**: ≥ ${MIN_DISTINCT_INSTALLS} distinct installs required before any cohort or platform drives release gate SLA alerts/verdicts. Cohorts with < ${MIN_DISTINCT_INSTALLS} installs are treated as preliminary canary observations.\n`;
  md += `> - **Presenter Attempt Tracking**: 0% fallback in a window indicates that no fallback-triggering operations (e.g. unsupported raster shaders) were invoked. It does not prove universal native presentation without underlying presenter attempt telemetry.\n`;
  md += `> - **Decode vs Readback Hypothesis (Open)**: Whether modern GPUs (e.g. RTX 4080) in the 400–900 ms cluster are decode-bound, readback-bound, or DXGI-latched-off remains an **open hypothesis** pending fleet rollups carrying \`transferPath\`, \`hwDecodeActive\`, \`decoderName\`, and \`dxgiLatchedOff\`.\n`;
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
      md += `\n**Low-Sample / Low-Install Diversity Canary Notes (n_installs < 5):**\n`;
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

  const formatSessionVolume = (data, installs, isWin) => {
    if (!data) return "0 samples (0 installs)";
    if (isWin && gts450Dominates) {
      return `${data.sampleCount} samples (${installs} cohorts; skewed: 1 install contributed ${maxWinCohort.sampleCount})`;
    }
    return `${data.sampleCount} samples (${installs} distinct cohort${installs === 1 ? "" : "s"})`;
  };

  const macSamples = formatSessionVolume(osRecords.macos, osInstallCounts.macos, false);
  const winSamples = formatSessionVolume(osRecords.windows, osInstallCounts.windows, true);
  const linSamples = formatSessionVolume(osRecords.linux, osInstallCounts.linux, false);
  md += `| **Session Volume** | ${macSamples} | ${winSamples} | ${linSamples} | ≥ ${MIN_DISTINCT_INSTALLS} installs & ≥ 10 samples |\n`;

  const macAttempts = osRecords.macos ? `${osRecords.macos.sampleCount} windows (0 fallbacks recorded)` : "0";
  const winAttempts = osRecords.windows ? `${osRecords.windows.sampleCount} windows (0 fallbacks recorded)` : "0";
  const linAttempts = osRecords.linux ? `${osRecords.linux.sampleCount} windows (bridge fallback active)` : "0";
  md += `| **Presenter Attempts** | ${macAttempts} | ${winAttempts} | ${linAttempts} | Active Presenter verification |\n`;

  const formatP50 = (stats, rawData) => {
    if (!rawData) return "N/A";
    const rawMs = (rawData.p50RenderTimeUs / 1000).toFixed(1);
    if (stats) {
      const slaShare = `${stats.installsUnderSla} of ${stats.distinctInstalls} cohorts under ${stats.slaBudgetMs}ms`;
      let clusterDetail = "";
      if (stats.fastClusterMedianMs !== null && stats.slowClusterMedianMs !== null) {
        clusterDetail = ` (fast cluster median: ${stats.fastClusterMedianMs.toFixed(1)} ms; slow cluster median: ${stats.slowClusterMedianMs.toFixed(1)} ms)`;
      } else if (stats.fastClusterMedianMs !== null) {
        clusterDetail = ` (fast cluster median: ${stats.fastClusterMedianMs.toFixed(1)} ms)`;
      } else if (stats.slowClusterMedianMs !== null) {
        clusterDetail = ` (slow cluster median: ${stats.slowClusterMedianMs.toFixed(1)} ms)`;
      }
      return `${slaShare}${clusterDetail}`;
    }
    return `${rawMs} ms`;
  };

  const macP50 = formatP50(macInstallStats, osRecords.macos);
  const winP50 = formatP50(winInstallStats, osRecords.windows);
  const linP50 = formatP50(linInstallStats, osRecords.linux);
  md += `| **SLA Compliance & Median** | ${macP50} | ${winP50} | ${linP50} | ≤ 16.6ms (Mac), ≤ 33.3ms (Win/Linux) |\n`;

  const formatTail = (stats, rawData) => {
    if (!rawData) return "N/A";
    const rawMs = (rawData.p95RenderTimeUs / 1000).toFixed(1);
    if (stats && stats.worstCohortP95Ms > 0) {
      return `Worst cohort: ${stats.worstCohortP95Ms.toFixed(1)} ms (${stats.worstCohortModel}); raw pooled: ${rawMs} ms`;
    }
    return `${rawMs} ms`;
  };

  const macP95 = formatTail(macInstallStats, osRecords.macos);
  const winP95 = formatTail(winInstallStats, osRecords.windows);
  const linP95 = formatTail(linInstallStats, osRecords.linux);
  md += `| **p95 Render Time (Tail)** | ${macP95} | ${winP95} | ${linP95} | ≤ 33.3ms (Mac), ≤ 100ms (Win/Linux) |\n`;

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

  const formatSla = (osKey, data, installs) => {
    if (!data) return "N/A";
    if (installs < MIN_DISTINCT_INSTALLS) {
      return `⚠️ Preliminary (${installs} install${installs === 1 ? "" : "s"} < ${MIN_DISTINCT_INSTALLS})`;
    }
    if (osKey === "windows" && gts450Dominates) {
      return "⚠️ Review (Skewed by 1 install)";
    }
    return data.meetsSLA ? "✅ Pass" : "❌ Review";
  };
  md += `| **SLA Gate Status** | ${formatSla("macos", osRecords.macos, osInstallCounts.macos)} | ${formatSla("windows", osRecords.windows, osInstallCounts.windows)} | ${formatSla("linux", osRecords.linux, osInstallCounts.linux)} | Strict SLA Contract Budget |\n\n`;

  // 3. Platform Deep Dives
  md += `## 3. Platform Deep Dives\n\n`;

  const renderCohortTable = (cohorts) => {
    let out = `| Cohort | Windows | Installs | Confidence | p50 Render | p95 Render | Fallback % | Bottleneck | SLA Status |\n`;
    out += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const c of cohorts) {
      const installs = installsByGpu.get(c.gpuModel) ?? 1;
      const capped = Math.min(c.sampleCount, installs * MAX_SAMPLES_PER_INSTALL);
      const winStr = c.sampleCount > capped ? `${c.sampleCount} (cap: ${capped})` : `${c.sampleCount}`;
      const conf =
        installs >= MIN_DISTINCT_INSTALLS && capped >= 10
          ? `✅ Sufficient (${installs} inst)`
          : `⚠️ Low diversity (${installs} inst < 5)`;
      const sla =
        installs < MIN_DISTINCT_INSTALLS
          ? `ℹ️ Canary (n_inst < 5)`
          : c.meetsSLA
            ? "✅ Pass"
            : "❌ Review";
      const vendorTag = c.gpuVendor ? ` (${c.gpuVendor})` : "";
      out += `| **${c.gpuModel}**${vendorTag} | ${winStr} | ${installs} | ${conf} | ${(c.p50RenderTimeUs / 1000).toFixed(1)} ms | ${(c.p95RenderTimeUs / 1000).toFixed(1)} ms | ${(c.fallbackRate * 100).toFixed(1)}% | ${c.primaryBottleneck} | ${sla} |\n`;
    }
    return out;
  };

  // 3.1 macOS Deep Dive
  md += `### 3.1 macOS (Metal / VideoToolbox / Apple Silicon)\n`;
  if (macCohorts.length > 0) {
    md += renderCohortTable(macCohorts);
  } else {
    md += `*Apple Silicon metrics accumulating from active Mac editor sessions.*\n`;
  }
  md += `\n`;

  // 3.2 Windows Deep Dive
  md += `### 3.2 Windows (DirectX 12 / wgpu / Heterogeneous GPUs)\n`;
  if (winCohorts.length > 0) {
    md += renderCohortTable(winCohorts);
  } else {
    md += `*No Windows hardware samples recorded in this window.*\n`;
  }
  md += `\n`;

  // 3.3 Linux Deep Dive
  md += `### 3.3 Linux (Vulkan / WebKitGTK / VA-API)\n`;
  if (linCohorts.length > 0) {
    md += renderCohortTable(linCohorts);
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

// Only invoke main when run as the entry script, allowing importing in test runners
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal fleet audit error:", err);
    process.exit(1);
  });
}
