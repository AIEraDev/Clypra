#!/usr/bin/env node

/**
 * Unified Clypra Performance Cycle Tool (`pnpm perf:cycle` / `pnpm perf:gate`).
 *
 * Implements the automated performance test loop:
 * Preflight -> Build -> Isolated Execution -> Lint -> Evaluation -> Report.
 *
 * Supports:
 *   --fast: Single dev-iteration loop on changed or selected scenarios.
 *   --gate: Non-dev release gate qualification with >= 3 repeats and cooldowns.
 *   --auto: Auto-detect scenarios from git diff against scenario-map.json.
 *   --tier <tier1|tier2|tier3|all>: Run entire matrix tiers bottom-up.
 */

import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile, mkdtemp } from "node:fs/promises";
import { execFile as execFileCallback, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { evaluateSession } from "./evaluate-acceptance.mjs";
import { lintRecords } from "./clypra-perf.mjs";
import { verifyManifest, generateMediaFixtures, generateProjectFixtures, generateManifest } from "./make-fixtures.mjs";

const execFile = promisify(execFileCallback);

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function valueAfter(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

/** Collect all consecutive non-flag tokens after every occurrence of `flag`. */
function valuesAfter(args, flag) {
  const results = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      let j = i + 1;
      while (j < args.length && !args[j].startsWith("--")) {
        results.push(args[j++]);
      }
    }
  }
  return results.length > 0 ? results : null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve scenario definition from scenario catalog.
 */
export function resolveScenarioSpec(scenarioName, mediaDir = "tests/fixtures/perf", projectsDir = "scripts/perf/fixtures") {
  const catalog = {
    "playback-steady-25fps": {
      name: "playback-steady-25fps",
      tier: "tier1",
      preset: "playback-steady-30s",
      projectFile: "project-steady-25fps.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "25 fps steady-state video playback",
    },
    "playback-steady-30fps": {
      name: "playback-steady-30fps",
      tier: "tier1",
      preset: "playback-steady-30s",
      projectFile: "project-steady-30fps.json",
      mediaFile: "clip_1080p30_gop1s.mp4",
      description: "30 fps steady-state video playback (30:25 repeat cadence check)",
    },
    "playback-video-gop10s": {
      name: "playback-video-gop10s",
      tier: "tier1",
      preset: "playback-steady-30s",
      projectFile: "project-video-gop10s.json",
      mediaFile: "clip_1440p25_gop10s.mp4",
      description: "25 fps long-GOP (10s) video playback",
    },
    "project-image": {
      name: "project-image",
      tier: "tier1",
      preset: "playback-steady-30s",
      projectFile: "project-image.json",
      mediaFile: "image_corner_markers_1080p.png",
      description: "Single image graphics overlay",
    },
    "project-audio": {
      name: "project-audio",
      tier: "tier1",
      preset: "playback-steady-30s",
      projectFile: "project-audio.json",
      mediaFile: "audio_beeps_48k_35s.m4a",
      description: "Single periodic audio beeps mixer test",
    },
    "project-text": {
      name: "project-text",
      tier: "tier1",
      preset: "playback-steady-30s",
      projectFile: "project-text.json",
      mediaFile: "image_corner_markers_1080p.png",
      description: "Plain text effect overlay",
    },
    "project-text-effect": {
      name: "project-text-effect",
      tier: "tier1",
      preset: "playback-steady-30s",
      projectFile: "project-text-effect.json",
      mediaFile: "image_corner_markers_1080p.png",
      description: "Animated kinetic text effect",
    },
    "project-text-template": {
      name: "project-text-template",
      tier: "tier1",
      preset: "playback-steady-30s",
      projectFile: "project-text-template.json",
      mediaFile: "image_corner_markers_1080p.png",
      description: "Rich text template lower third",
    },
    "project-stacked-2": {
      name: "project-stacked-2",
      tier: "tier2",
      preset: "playback-steady-30s",
      projectFile: "project-stacked-2.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Stacked video ramp: 2 concurrent layers",
    },
    "project-stacked-4": {
      name: "project-stacked-4",
      tier: "tier2",
      preset: "playback-steady-30s",
      projectFile: "project-stacked-4.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Stacked video ramp: 4 concurrent layers",
    },
    "project-stacked-6": {
      name: "project-stacked-6",
      tier: "tier2",
      preset: "playback-steady-30s",
      projectFile: "project-stacked-6.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Stacked video ramp: 6 concurrent layers",
    },
    "project-stacked-8": {
      name: "project-stacked-8",
      tier: "tier2",
      preset: "playback-steady-30s",
      projectFile: "project-stacked-8.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Stacked video ramp: 8 concurrent layers",
    },
    "playback-composite-25fps": {
      name: "playback-composite-25fps",
      tier: "tier3",
      preset: "playback-composite-30s",
      projectFile: "project-composite-25fps.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Composite multi-media interaction at 25 fps",
    },
    "playback-composite-30fps": {
      name: "playback-composite-30fps",
      tier: "tier3",
      preset: "playback-composite-30s",
      projectFile: "project-composite-30fps.json",
      mediaFile: "clip_1080p30_gop1s.mp4",
      description: "Composite multi-media interaction at 30 fps",
    },
    "cold-seek": {
      name: "cold-seek",
      tier: "tier1",
      preset: "cold-seek",
      projectFile: "project-steady-25fps.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Cold seek responsiveness",
    },
    "scrub-sweep": {
      name: "scrub-sweep",
      tier: "tier1",
      preset: "scrub-sweep",
      projectFile: "project-steady-25fps.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Timeline scrub sweep cadence",
    },
    "composite-scrub-sweep": {
      name: "composite-scrub-sweep",
      tier: "tier3",
      preset: "composite-scrub-sweep",
      projectFile: "project-composite-25fps.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Multi-layer composite scrub sweep",
    },
    "clip-boundary": {
      name: "clip-boundary",
      tier: "tier1",
      preset: "clip-boundary",
      projectFile: "project-steady-25fps.json",
      mediaFile: "clip_1440p25_gop1s.mp4",
      description: "Clip boundary transition traversal",
    },
  };

  const spec = catalog[scenarioName];
  if (!spec) throw new Error(`Unknown scenario name: ${scenarioName}`);
  return {
    ...spec,
    projectPath: path.resolve(projectsDir, spec.projectFile),
    mediaPath: path.resolve(mediaDir, spec.mediaFile),
  };
}

/**
 * Determine auto scenarios based on changed files in git.
 */
export async function detectScenariosFromGit(scenarioMapPath = "scripts/perf/scenario-map.json") {
  try {
    const { stdout } = await execFile("git", ["diff", "--name-only", "HEAD"]);
    const changedFiles = stdout.split(/\r?\n/).filter(Boolean);
    if (changedFiles.length === 0) return ["playback-steady-25fps"];

    const mapContent = await readFile(scenarioMapPath, "utf8");
    const map = JSON.parse(mapContent);
    const selected = new Set();

    for (const rule of map.mappings ?? []) {
      for (const pattern of rule.patterns ?? []) {
        const regexStr = "^" + pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$";
        const re = new RegExp(regexStr);
        if (changedFiles.some((f) => re.test(f))) {
          for (const s of rule.scenarios ?? []) selected.add(s);
        }
      }
    }

    if (selected.size === 0) {
      for (const s of map.defaultScenarios ?? ["playback-steady-25fps"]) selected.add(s);
    }
    return Array.from(selected);
  } catch {
    return ["playback-steady-25fps"];
  }
}

/**
 * Preflight check: kill stale instances, verify fixtures, get git metadata.
 */
export async function runPreflight(options = {}) {
  const mediaDir = options.mediaDir || "tests/fixtures/perf";
  const projectsDir = options.projectsDir || "scripts/perf/fixtures";
  const manifestPath = path.join(projectsDir, "manifest.json");

  // 1. Kill stale instances
  try {
    if (process.platform === "darwin" || process.platform === "linux") {
      await execFile("killall", ["-9", "clypra"]).catch(() => {});
    }
  } catch {}

  // 2. Git metadata
  let gitSha = "unknown";
  let gitDirty = false;
  try {
    const { stdout: shaOut } = await execFile("git", ["rev-parse", "HEAD"]);
    gitSha = shaOut.trim();
    const { stdout: statusOut } = await execFile("git", ["status", "--porcelain"]);
    gitDirty = statusOut.trim().length > 0;
  } catch {}

  // 3. Manifest validation & auto-generation if missing
  if (!(await fileExists(manifestPath))) {
    await generateMediaFixtures(mediaDir);
    await generateProjectFixtures(projectsDir, mediaDir);
    await generateManifest(mediaDir, projectsDir, manifestPath);
  }

  const manifestCheck = await verifyManifest(mediaDir, projectsDir, manifestPath);
  if (!manifestCheck.ok) {
    // Regenerate if out of sync
    await generateMediaFixtures(mediaDir);
    await generateProjectFixtures(projectsDir, mediaDir);
    await generateManifest(mediaDir, projectsDir, manifestPath);
  }

  return {
    gitSha,
    gitDirty,
    manifestOk: true,
  };
}

/**
 * Materialize project file into isolated directory with absolute local media paths.
 */
export async function materializeProject(projectPath, targetDir, mediaDir) {
  const raw = await readFile(projectPath, "utf8");
  const project = JSON.parse(raw);
  for (const asset of project.media_assets ?? project.mediaAssets ?? []) {
    if (typeof asset?.path === "string" && asset.path.length > 0) {
      asset.path = path.resolve(mediaDir, path.basename(asset.path));
    }
  }
  const dest = path.join(targetDir, path.basename(projectPath));
  await writeFile(dest, JSON.stringify(project, null, 2), "utf8");
  return dest;
}

/**
 * Run a single scenario repetition.
 */
export async function runSingleScenarioIteration(spec, binaryPath, isolatedDataDir, options = {}) {
  const mediaDir = options.mediaDir || "tests/fixtures/perf";
  const perfLogsDir = path.join(isolatedDataDir, "perf_logs");
  await mkdir(perfLogsDir, { recursive: true });

  const materializedProject = await materializeProject(spec.projectPath, isolatedDataDir, mediaDir);
  const runnerScript = path.resolve("scripts/perf/run-preview-scenario.mjs");

  const runnerArgs = [
    runnerScript,
    "--command", binaryPath,
    "--endpoint", "http://127.0.0.1:1422/debug/run_perf_scenario",
    "--preset", spec.preset,
    "--project", materializedProject,
    "--media", spec.mediaPath,
    "--close-after-run",
    "--wait-for-footer", perfLogsDir,
    "--startup-timeout-ms", "120000",
    "--settle-ms", "4000",
    "--footer-timeout-ms", "45000",
  ];

  const env = {
    ...process.env,
    CLYPRA_DATA_DIR: isolatedDataDir,
    CLYPRA_BENCH_PROJECT: materializedProject,
    RUST_LOG: "info",
  };

  // Launch with caffeinate on macOS to prevent display/idle throttling
  const command = process.platform === "darwin" ? "caffeinate" : process.execPath;
  const commandArgs = process.platform === "darwin" ? ["-d", process.execPath, ...runnerArgs] : runnerArgs;

  const child = spawn(command, commandArgs, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => { stdout += d.toString(); });
  child.stderr?.on("data", (d) => { stderr += d.toString(); });

  const exitCode = await new Promise((resolve) => child.on("close", resolve));

  // Find newly generated session NDJSON file
  const files = await readdir(perfLogsDir).catch(() => []);
  const sessionFile = files.filter((f) => f.endsWith(".ndjson")).sort().at(-1);

  if (!sessionFile) {
    return {
      pass: false,
      exitCode,
      error: `No session ndjson file generated in ${perfLogsDir}. Stderr: ${stderr.slice(-1000)}. Stdout: ${stdout.slice(-2000)}`,
    };
  }

  const sessionPath = path.join(perfLogsDir, sessionFile);
  const rawContent = await readFile(sessionPath, "utf8");
  const records = rawContent.split(/\r?\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const lintResult = lintRecords(records);
  const requireLookahead = !["project-text", "project-text-effect", "project-text-template", "project-image", "project-audio"].includes(spec.name ?? spec.scenario);
  const evalResult = await evaluateSession(sessionPath, { requireLookahead });

  const pass = exitCode === 0 && evalResult.allPassed && lintResult.trusted;
  try {
    const debugDir = path.resolve("tests/fixtures/perf");
    await copyFile(sessionPath, path.join(debugDir, "last-session.ndjson"));
  } catch {}
  if (!pass) {
    try {
      const debugDir = path.resolve("tests/fixtures/perf");
      await copyFile(sessionPath, path.join(debugDir, "failed-session.ndjson"));
    } catch {}
  }

  return {
    pass,
    sessionPath,
    exitCode,
    lintResult,
    evalResult,
    rawStdout: stdout,
    rawStderr: stderr,
  };
}

/**
 * Execute full performance cycle across planned scenarios.
 */
export async function runPerfCycle(options = {}) {
  const isGate = options.gate === true;
  const repeats = Number(options.repeats) || (isGate ? 3 : 1);
  const cooldownMs = Number(options.cooldownMs) || (isGate ? 8000 : 2000);
  const mediaDir = path.resolve(options.mediaDir || "tests/fixtures/perf");
  const projectsDir = path.resolve(options.projectsDir || "scripts/perf/fixtures");
  const binaryPath = path.resolve(
    options.bin || (isGate ? "src-tauri/target/release/clypra" : "src-tauri/target/release/clypra")
  );

  console.log(`\n===============================================================`);
  console.log(`CLYPRA UNIFIED PERFORMANCE CYCLE: ${isGate ? "GATE QUALIFICATION" : "FAST ITERATION"}`);
  console.log(`Binary: ${binaryPath}`);
  console.log(`Repeats: ${repeats} | Cooldown: ${cooldownMs}ms`);
  console.log(`===============================================================\n`);

  // 1. Preflight
  console.log("Checking preflight environment & manifest...");
  const preflight = await runPreflight({ mediaDir, projectsDir });
  console.log(`Git Commit: ${preflight.gitSha} ${preflight.gitDirty ? "(DIRTY)" : "(CLEAN)"}`);

  if (isGate && preflight.gitDirty && !options.allowDirty) {
    console.warn("⚠️ Warning: Release gate qualification running on dirty working tree.");
  }

  // 2. Binary check or build
  if (!(await fileExists(binaryPath))) {
    console.log(`Building standalone release binary with perf-driver feature...`);
    await execFile("npx", [
      "tauri", "build",
      "--no-bundle",
      "--features", "perf-driver",
    ]);
  }

  // 3. Plan scenarios
  let scenarioNames = [];
  if (options.scenario) {
    // options.scenario is an array (valuesAfter returns string[] | null)
    scenarioNames = Array.isArray(options.scenario) ? options.scenario : [options.scenario];
  } else if (options.tier) {
    const map = JSON.parse(await readFile("scripts/perf/scenario-map.json", "utf8"));
    if (options.tier === "all") {
      scenarioNames = [...map.tierScenarios.tier1, ...map.tierScenarios.tier2, ...map.tierScenarios.tier3];
    } else {
      scenarioNames = map.tierScenarios[options.tier] || map.tierScenarios.tier1;
    }
  } else if (options.auto) {
    scenarioNames = await detectScenariosFromGit();
  } else if (isGate) {
    const map = JSON.parse(await readFile("scripts/perf/scenario-map.json", "utf8"));
    scenarioNames = [...map.tierScenarios.tier1, ...map.tierScenarios.tier2, ...map.tierScenarios.tier3];
  } else {
    scenarioNames = ["playback-steady-25fps", "playback-steady-30fps"];
  }

  console.log(`Scenarios Planned (${scenarioNames.length}): ${scenarioNames.join(", ")}\n`);

  const results = [];
  let allPass = true;

  for (let sIdx = 0; sIdx < scenarioNames.length; sIdx++) {
    // Inter-scenario thermal cooldown: in gate mode, pause between scenarios
    // so that VTB hardware sessions from the previous scenario fully release
    // before the next one starts.  This prevents thermal accumulation from
    // causing spurious freeze failures in later scenarios (steady-25fps c11
    // threshold exceeded after multiple consecutive 30s video runs).
    if (sIdx > 0 && isGate && cooldownMs > 0) {
      console.log(`  [inter-scenario cooldown ${cooldownMs}ms]`);
      await sleep(cooldownMs);
    }
    const sName = scenarioNames[sIdx];
    const spec = resolveScenarioSpec(sName, mediaDir, projectsDir);
    console.log(`[${sIdx + 1}/${scenarioNames.length}] Running Scenario: ${sName} (${spec.description})`);

    const scenarioRuns = [];
    for (let r = 1; r <= repeats; r++) {
      const isolatedDataDir = await mkdtemp(path.join(os.tmpdir(), "clypra-perf-cycle-"));
      try {
        console.log(`  - Run ${r}/${repeats}...`);
        const iter = await runSingleScenarioIteration(spec, binaryPath, isolatedDataDir, { mediaDir });
        scenarioRuns.push(iter);

        const ev = iter.evalResult;
        if (ev) {
          const steady = ev.phases.steady_playback || ev.phases.composite_playback || {};
          const ratioVal = Number.isFinite(steady.presentationRatio) ? (steady.presentationRatio * 100).toFixed(2) + "%" : "n/a";
          const freezeStr = ev.criteria.c11_longestFreeze ? ev.criteria.c11_longestFreeze.actual : "n/a";
          const lookaheadStr = ev.criteria.c14_lookaheadDepthSteady ? ev.criteria.c14_lookaheadDepthSteady.actual : "n/a";
          console.log(`    Result: ${iter.pass ? "✅ PASS" : "❌ FAIL"} | Presented: ${ratioVal} | Freeze: ${freezeStr} | Lookahead: ${lookaheadStr}`);
          if (!iter.pass) {
            let hasFailingCriteria = false;
            for (const [key, crit] of Object.entries(ev.criteria || {})) {
              if (!crit.pass) {
                if (!hasFailingCriteria) {
                  console.log("    Failing criteria:");
                  hasFailingCriteria = true;
                }
                console.log(`      ❌ ${key}: actual=${crit.actual} target=${crit.target}`);
              }
            }
            if (iter.lintResult && !iter.lintResult.trusted) {
              console.log(`    ❌ Session Lint Untrusted (grade: ${iter.lintResult.grade}):`);
              for (const err of iter.lintResult.errors || []) {
                console.log(`      - [${err.code}] Line ${err.line}: ${err.message}`);
              }
              for (const warn of iter.lintResult.warnings || []) {
                console.log(`      - (warn) [${warn.code}] Line ${warn.line}: ${warn.message}`);
              }
            }
            if (iter.exitCode !== 0) {
              console.log(`    ❌ Process exited with non-zero code: ${iter.exitCode}`);
            }
            if (iter.rawStdout) {
              console.log("    Runner stdout:\n" + iter.rawStdout.slice(-1500));
            }
            if (iter.rawStderr) {
              console.log("    Runner stderr:\n" + iter.rawStderr.slice(-4000));
            }
          }
        } else {
          console.log(`    Result: ❌ FAIL (${iter.error || "Execution failed"})`);
        }

        if (!iter.pass) {
          allPass = false;
          if (iter.footerPath && (await fileExists(iter.footerPath))) {
            await copyFile(iter.footerPath, "/tmp/last-failed-perf-session.ndjson").catch(() => {});
          }
        }
      } finally {
        await rm(isolatedDataDir, { recursive: true, force: true });
      }

      if (r < repeats && cooldownMs > 0) {
        await sleep(cooldownMs);
      }
    }

    results.push({
      scenario: sName,
      spec,
      runs: scenarioRuns,
      pass: scenarioRuns.every((run) => run.pass),
    });
  }

  // 4. Generate Markdown & Summary Report
  console.log(`\n===============================================================`);
  console.log(`PERFORMANCE CYCLE SUMMARY: ${allPass ? "✅ ALL PASS" : "❌ GATE FAILED"}`);
  console.log(`===============================================================\n`);

  console.log("| Scenario | Tier | Runs | Pass Rate | Ratio (med) | Freeze Max | Lookahead Min | Status |");
  console.log("|---|---|---|---|---|---|---|---|");

  for (const res of results) {
    const passedCount = res.runs.filter((r) => r.pass).length;
    const passRate = `${Math.round((passedCount / res.runs.length) * 100)}%`;
    const ratios = res.runs.map((r) => {
      const p = r.evalResult?.phases?.steady_playback || r.evalResult?.phases?.composite_playback;
      return p?.presentationRatio ?? 0;
    });
    ratios.sort((a, b) => a - b);
    const medianRatio = `${(ratios[Math.floor(ratios.length / 2)] * 100).toFixed(2)}%`;

    const freezes = res.runs.map((r) => {
      const c = r.evalResult?.criteria?.c11_longestFreeze?.actual;
      const m = typeof c === "string" ? parseFloat(c) : 0;
      return Number.isFinite(m) ? m : 0;
    });
    const maxFreeze = `${Math.max(...freezes).toFixed(1)}ms`;

    const lookaheads = res.runs.map((r) => {
      const c = r.evalResult?.criteria?.c14_lookaheadDepthSteady?.actual;
      const m = typeof c === "string" ? c.match(/min=([0-9.]+)/) : null;
      return m ? Number(m[1]) : 0;
    });
    const minLookahead = Math.min(...lookaheads);

    console.log(`| ${res.scenario} | ${res.spec.tier} | ${res.runs.length} | ${passRate} | ${medianRatio} | ${maxFreeze} | ${minLookahead} | ${res.pass ? "✅ PASS" : "❌ FAIL"} |`);
  }

  return {
    allPass,
    results,
    gitSha: preflight.gitSha,
    gitDirty: preflight.gitDirty,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const options = {
    gate: argv.includes("--gate"),
    fast: argv.includes("--fast") || !argv.includes("--gate"),
    scenario: valuesAfter(argv, "--scenario"),
    tier: valueAfter(argv, "--tier"),
    auto: argv.includes("--auto"),
    // --runs is the documented flag; --repeats is kept as an internal alias
    repeats: valueAfter(argv, "--runs") || valueAfter(argv, "--repeats"),
    cooldownMs: valueAfter(argv, "--cooldown-ms"),
    bin: valueAfter(argv, "--bin"),
    mediaDir: valueAfter(argv, "--media-dir"),
    projectsDir: valueAfter(argv, "--projects-dir"),
    allowDirty: argv.includes("--allow-dirty"),
  };

  const outcome = await runPerfCycle(options);
  process.exit(outcome.allPass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
