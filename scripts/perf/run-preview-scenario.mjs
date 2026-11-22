#!/usr/bin/env node

/**
 * Build and optionally execute the deterministic native-preview scenario.
 *
 * The scenario is data, not a second playback clock.  With a development app
 * built using `--features perf-driver`, `--endpoint` posts the same JSON to
 * the local debug IPC server.  `--command` is provided for packaged/manual
 * runs: it launches the supplied command with the scenario provenance in its
 * environment, while the app remains responsible for playback.
 */

import { createHash, randomBytes } from "node:crypto";
import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile as execFileCallback, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const SCENARIO_SCHEMA_VERSION = 1;

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function scenarioHash(scenario) {
  const withoutHash = { ...scenario };
  delete withoutHash.scenarioHash;
  const canonical = JSON.stringify(canonicalize(withoutHash));
  return createHash("sha256").update(canonical).digest("hex");
}

async function hashFile(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function parseRate(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const rate = numerator / denominator;
  return rate > 0 ? rate : null;
}

function ffprobeCandidates() {
  const platform = process.platform;
  const arch = process.arch;
  const target = platform === "darwin"
    ? `${arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
    : platform === "win32"
      ? `${arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc.exe`
      : `${arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`;
  return [
    process.env.CLYPRA_FFPROBE,
    path.resolve("src-tauri", "bin", `ffprobe-${target}`),
    "ffprobe",
  ].filter(Boolean);
}

async function resolveFfprobe() {
  for (const candidate of ffprobeCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      if (candidate === "ffprobe") {
        try {
          await execFile(candidate, ["-version"]);
          return candidate;
        } catch {
          // Continue to the next candidate.
        }
      }
    }
  }
  throw new Error("ffprobe is required to validate the media frame rate");
}

async function probeMediaFrameRate(mediaPath) {
  const ffprobe = await resolveFfprobe();
  const { stdout } = await execFile(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=avg_frame_rate,r_frame_rate",
    "-of", "json",
    mediaPath,
  ]);
  const stream = JSON.parse(stdout).streams?.[0];
  const frameRate = parseRate(stream?.avg_frame_rate) ?? parseRate(stream?.r_frame_rate);
  if (!frameRate) throw new Error(`could not determine a positive media frame rate for ${mediaPath}`);
  return frameRate;
}

function projectClips(project) {
  const flat = Array.isArray(project?.clips) ? project.clips : [];
  const nested = Array.isArray(project?.tracks)
    ? project.tracks.flatMap((track) => Array.isArray(track?.clips) ? track.clips : [])
    : [];
  const byId = new Map();
  for (const clip of [...flat, ...nested]) if (clip?.id) byId.set(clip.id, clip);
  return [...byId.values()];
}

export async function validateProjectMediaInputs(mediaPath, projectPath) {
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  const mediaHash = await hashFile(mediaPath);
  const assets = project.media_assets ?? project.mediaAssets ?? [];
  const resolvedMatchingAssets = [];
  for (const asset of assets) {
    if (typeof asset?.path !== "string" || asset.path.trim() === "") continue;
    try {
      // Match the actual bytes, not only the display name or stored path. This
      // rejects accidentally selecting the gop10s variant for a gop1s project.
      if (await hashFile(asset.path) === mediaHash) resolvedMatchingAssets.push(asset);
    } catch {
      // Ignore stale project assets; the supplied media must still be referenced.
    }
  }
  const matchingAssetIds = new Set(resolvedMatchingAssets.map((asset) => asset.id));
  const clips = projectClips(project);
  const matchingVideoClip = clips.find(
    (clip) => clip.kind === "video" && matchingAssetIds.has(clip.mediaId),
  );
  if (!matchingVideoClip) {
    throw new Error("project has no video clip referencing the supplied --media file");
  }

  const computedDuration = clips.reduce((end, clip) => {
    const start = Number(clip.startTime ?? clip.start_time ?? 0);
    const duration = Number(clip.duration ?? 0);
    return Number.isFinite(start) && Number.isFinite(duration)
      ? Math.max(end, start + duration)
      : end;
  }, 0);
  if (!(computedDuration > 0)) throw new Error("project computed duration must be greater than zero");

  const projectFrameRate = parseRate(project.frame_rate ?? project.frameRate);
  if (!projectFrameRate) throw new Error("project frame rate must be positive");
  const mediaFrameRate = await probeMediaFrameRate(mediaPath);
  return { computedDuration, projectFrameRate, mediaFrameRate, mediaHash };
}

export function validateScenario(scenario) {
  if (scenario?.schemaVersion !== SCENARIO_SCHEMA_VERSION) throw new Error("scenario schemaVersion must be 1");
  if (typeof scenario?.scenarioId !== "string" || scenario.scenarioId.trim() === "") throw new Error("scenarioId must be non-empty");
  if (!Array.isArray(scenario.actions) || scenario.actions.length === 0) throw new Error("scenario actions must be non-empty");
  if (scenario.closeAfterRun !== undefined && typeof scenario.closeAfterRun !== "boolean") {
    throw new Error("closeAfterRun must be boolean");
  }
  for (const action of scenario.actions) {
    if (!["play", "pause", "coldSeek", "clipBoundary", "scrubSweep"].includes(action?.kind)) {
      throw new Error(`unsupported scenario action: ${String(action?.kind)}`);
    }
    if (["play", "pause", "scrubSweep"].includes(action.kind) &&
      action.durationMs !== undefined && (!Number.isInteger(action.durationMs) || action.durationMs <= 0)) {
      throw new Error(`${action.kind} durationMs must be positive`);
    }
    if (["coldSeek", "clipBoundary"].includes(action.kind) && !Number.isInteger(action.frameIndex)) {
      throw new Error(`${action.kind} requires integer frameIndex`);
    }
    if (action.kind === "scrubSweep" &&
      (!Number.isInteger(action.startFrame) || !Number.isInteger(action.endFrame) ||
        action.startFrame === action.endFrame || !Number.isInteger(action.steps) || action.steps < 2)) {
      throw new Error("scrubSweep requires distinct integer bounds and steps >= 2");
    }
    if (action.phaseId !== undefined &&
      (typeof action.phaseId !== "string" || action.phaseId.trim() === "")) {
      throw new Error(`${action.kind} phaseId must be a non-empty string`);
    }
  }
  return scenario;
}

export function buildDefaultScenario() {
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    scenarioId: "preview-multilayer-scrub-v1",
    actions: [
      { kind: "play", phaseId: "steady_playback", durationMs: 30_000 },
      { kind: "coldSeek", phaseId: "cold_seek", frameIndex: 900 },
      { kind: "coldSeek", phaseId: "cold_seek", frameIndex: 450 },
      { kind: "coldSeek", phaseId: "cold_seek", frameIndex: 1_200 },
      {
        kind: "scrubSweep",
        phaseId: "scrub",
        startFrame: 1_200,
        endFrame: 240,
        steps: 48,
        durationMs: 1_200,
      },
      { kind: "clipBoundary", phaseId: "clip_boundary", frameIndex: 1_800 },
      { kind: "pause", phaseId: "pause", durationMs: 1 },
    ],
  };
}

export function buildScenarioPreset(name) {
  const presets = {
    "playback-steady-30s": {
      scenarioId: "playback-steady-30s-v1",
      actions: [
        { kind: "play", phaseId: "steady_playback", durationMs: 30_000 },
        { kind: "pause", phaseId: "pause", durationMs: 1 },
      ],
    },
    "cold-seek": {
      scenarioId: "cold-seek-v1",
      actions: [
        { kind: "coldSeek", phaseId: "cold_seek", frameIndex: 900 },
        { kind: "pause", phaseId: "pause", durationMs: 1 },
      ],
    },
    "scrub-sweep": {
      scenarioId: "scrub-sweep-v1",
      actions: [
        {
          kind: "scrubSweep",
          phaseId: "scrub",
          startFrame: 1_200,
          endFrame: 240,
          steps: 48,
          durationMs: 1_200,
        },
        { kind: "pause", phaseId: "pause", durationMs: 1 },
      ],
    },
    "clip-boundary": {
      scenarioId: "clip-boundary-v1",
      actions: [
        { kind: "clipBoundary", phaseId: "clip_boundary", frameIndex: 1_800 },
        { kind: "pause", phaseId: "pause", durationMs: 1 },
      ],
    },
  };
  const preset = presets[name];
  if (!preset) throw new Error(`unknown scenario preset: ${name}`);
  return { schemaVersion: SCENARIO_SCHEMA_VERSION, ...preset };
}

function valueAfter(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function withHash(input) {
  const scenario = { ...input };
  scenario.scenarioHash = scenarioHash(scenario);
  return scenario;
}

async function postScenario(endpoint, scenario, token, retryUntilMs = 0) {
  const deadline = Date.now() + retryUntilMs;
  while (true) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-clypra-perf-token": token } : {}),
      },
      body: JSON.stringify(scenario),
    });
    const body = await response.text();
    if (response.ok) return body ? JSON.parse(body) : null;
    if (
      response.status === 400 &&
      body.includes("Native playback runtime is not initialized") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    throw new Error(`scenario endpoint returned ${response.status}: ${body}`);
  }
}

function defaultPerfLogDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "com.deenminder.clypra", "perf_logs");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "com.deenminder.clypra", "perf_logs");
  }
  return path.join(os.homedir(), ".local", "share", "com.deenminder.clypra", "perf_logs");
}

async function readClosedFooter(filePath, scenarioHashValue, notBeforeEpochMs = 0) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return false;
  }
  let matchesScenario = false;
  let closed = false;
  let headerTimestampEpochMs = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.kind === "session-header" && record.payload?.scenarioHash === scenarioHashValue) {
        matchesScenario = true;
        headerTimestampEpochMs = Number(record.timestampEpochMs ?? 0);
      }
      if (record?.kind === "session-footer" && record.payload?.status === "closed") {
        closed = true;
      }
    } catch {
      // A file may be observed while its final line is still being written.
    }
  }
  return matchesScenario && closed && headerTimestampEpochMs >= notBeforeEpochMs;
}

export async function waitForClosedFooter(
  targetPath,
  scenarioHashValue,
  timeoutMs = 30_000,
  notBeforeEpochMs = 0,
) {
  const deadline = Date.now() + timeoutMs;
  const candidateFiles = async () => {
    try {
      const targetStat = await stat(targetPath);
      if (targetStat.isFile()) return [targetPath];
    } catch {
      // The default directory may not exist until the app opens its session.
    }
    try {
      return (await readdir(targetPath, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ndjson"))
        .map((entry) => path.join(targetPath, entry.name));
    } catch {
      return [];
    }
  };
  while (Date.now() <= deadline) {
    for (const filePath of await candidateFiles()) {
      if (await readClosedFooter(filePath, scenarioHashValue, notBeforeEpochMs)) return filePath;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for a closed footer for scenario ${scenarioHashValue}`);
}

function runCommand(command, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: "inherit", env: { ...process.env, ...env } });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`scenario command terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`scenario command exited with ${code}`));
      else resolve({ exitCode: code ?? 0 });
    });
  });
}

function startCommand(command, env) {
  const child = spawn(command, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`scenario command terminated by ${signal}`));
      else resolve({ exitCode: code ?? 0 });
    });
  });
  return { child, exited };
}

async function waitForEndpoint(endpoint, token, timeoutMs = 180_000) {
  const pingEndpoint = new URL("/debug/ping", endpoint).toString();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(pingEndpoint, {
        headers: token ? { "x-clypra-perf-token": token } : undefined,
      });
      if (response.ok) return;
    } catch {
      // The optimized app and Vite server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for perf-driver endpoint ${endpoint}`);
}

async function runCommandWithScenario(
  command,
  env,
  endpoint,
  scenario,
  token,
  startupTimeoutMs,
  settleMs,
) {
  const { child, exited } = startCommand(command, env);
  try {
    await waitForEndpoint(endpoint, token, startupTimeoutMs);
    if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
    const scenarioResult = await postScenario(endpoint, scenario, token, startupTimeoutMs);
    const processResult = await exited;
    return { ...processResult, scenarioResult };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const inputPath = valueAfter(argv, "--scenario");
  const outputPath = valueAfter(argv, "--output");
  const endpoint = valueAfter(argv, "--endpoint");
  const command = valueAfter(argv, "--command");
  const presetName = valueAfter(argv, "--preset");
  const footerTarget = valueAfter(argv, "--wait-for-footer");
  const footerTimeoutMs = Number(valueAfter(argv, "--footer-timeout-ms", "30000"));
  const startupTimeoutMs = Number(valueAfter(argv, "--startup-timeout-ms", "180000"));
  const settleMs = Number(valueAfter(argv, "--settle-ms", "0"));
  const mediaPath = valueAfter(argv, "--media");
  const projectPath = valueAfter(argv, "--project");
  const arm = valueAfter(argv, "--arm", "C");
  const suppliedToken = valueAfter(argv, "--token", process.env.CLYPRA_PERF_DRIVER_TOKEN ?? null);
  const instrumentationPatchHash = valueAfter(
    argv,
    "--instrumentation-patch-hash",
    process.env.CLYPRA_INSTRUMENTATION_PATCH_HASH ?? "",
  );
  if (inputPath && presetName) throw new Error("--scenario and --preset are mutually exclusive");
  const input = inputPath
    ? JSON.parse(await readFile(inputPath, "utf8"))
    : presetName
      ? buildScenarioPreset(presetName)
      : buildDefaultScenario();
  if (argv.includes("--close-after-run")) input.closeAfterRun = true;
  const scenario = withHash(validateScenario(input));
  if ((endpoint || command) && (!mediaPath || !projectPath)) {
    throw new Error("acceptance runs require both --media and --project");
  }
  const inputMetadata = mediaPath && projectPath
    ? await validateProjectMediaInputs(mediaPath, projectPath)
    : null;
  const driverToken = endpoint
    ? suppliedToken ?? (command ? randomBytes(32).toString("hex") : null)
    : null;
  if (endpoint && !driverToken) {
    throw new Error("endpoint runs require --token, or use --command so the runner can generate one");
  }
  const provenance = {
    CLYPRA_SCENARIO_ID: scenario.scenarioId,
    CLYPRA_SCENARIO_HASH: scenario.scenarioHash,
    CLYPRA_EXPERIMENT_ARM: arm,
    ...(instrumentationPatchHash ? { CLYPRA_INSTRUMENTATION_PATCH_HASH: instrumentationPatchHash } : {}),
    ...(mediaPath ? { CLYPRA_MEDIA_HASH: inputMetadata?.mediaHash ?? await hashFile(mediaPath) } : {}),
    ...(projectPath ? { CLYPRA_PROJECT_HASH: await hashFile(projectPath) } : {}),
    ...(projectPath ? { CLYPRA_BENCH_PROJECT: projectPath } : {}),
    ...(inputMetadata ? {
      CLYPRA_PROJECT_COMPUTED_DURATION: String(inputMetadata.computedDuration),
      CLYPRA_PROJECT_FRAME_RATE: String(inputMetadata.projectFrameRate),
      CLYPRA_MEDIA_FRAME_RATE: String(inputMetadata.mediaFrameRate),
    } : {}),
    ...(driverToken ? { CLYPRA_PERF_DRIVER_TOKEN: driverToken } : {}),
  };

  if (outputPath) await writeFile(outputPath, `${JSON.stringify(scenario, null, 2)}\n`);
  let result = { mode: "plan", scenario };
  const runStartedAtEpochMs = Date.now();
  if (command && endpoint) {
    result = {
      mode: "command-and-endpoint",
      scenario,
      result: await runCommandWithScenario(
        command,
        provenance,
        endpoint,
        scenario,
        driverToken,
        Number.isFinite(startupTimeoutMs) && startupTimeoutMs > 0 ? startupTimeoutMs : 180_000,
        Number.isFinite(settleMs) && settleMs > 0 ? settleMs : 0,
      ),
    };
  } else if (endpoint) {
    result = { mode: "endpoint", scenario, result: await postScenario(endpoint, scenario, driverToken) };
  } else if (command) {
    result = { mode: "command", scenario, result: await runCommand(command, provenance) };
  }
  if (!endpoint && !command) result = { ...result, environment: provenance };
  if (footerTarget || (endpoint && argv.includes("--close-after-run"))) {
    const footerPath = await waitForClosedFooter(
      footerTarget ?? defaultPerfLogDir(),
      scenario.scenarioHash,
      Number.isFinite(footerTimeoutMs) && footerTimeoutMs > 0 ? footerTimeoutMs : 30_000,
      runStartedAtEpochMs,
    );
    result = { ...result, footerPath };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
