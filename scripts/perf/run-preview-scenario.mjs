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

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

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

export function validateScenario(scenario) {
  if (scenario?.schemaVersion !== SCENARIO_SCHEMA_VERSION) throw new Error("scenario schemaVersion must be 1");
  if (typeof scenario?.scenarioId !== "string" || scenario.scenarioId.trim() === "") throw new Error("scenarioId must be non-empty");
  if (!Array.isArray(scenario.actions) || scenario.actions.length === 0) throw new Error("scenario actions must be non-empty");
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
  }
  return scenario;
}

export function buildDefaultScenario() {
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    scenarioId: "preview-multilayer-scrub-v1",
    actions: [
      { kind: "play", durationMs: 30_000 },
      { kind: "coldSeek", frameIndex: 900 },
      { kind: "coldSeek", frameIndex: 450 },
      { kind: "coldSeek", frameIndex: 1_200 },
      {
        kind: "scrubSweep",
        startFrame: 1_200,
        endFrame: 240,
        steps: 48,
        durationMs: 1_200,
      },
      { kind: "clipBoundary", frameIndex: 1_800 },
      { kind: "pause", durationMs: 1 },
    ],
  };
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

async function postScenario(endpoint, scenario) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenario),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`scenario endpoint returned ${response.status}: ${body}`);
  return body ? JSON.parse(body) : null;
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

export async function main(argv = process.argv.slice(2)) {
  const inputPath = valueAfter(argv, "--scenario");
  const outputPath = valueAfter(argv, "--output");
  const endpoint = valueAfter(argv, "--endpoint");
  const command = valueAfter(argv, "--command");
  const mediaPath = valueAfter(argv, "--media");
  const projectPath = valueAfter(argv, "--project");
  const arm = valueAfter(argv, "--arm", "C");
  const instrumentationPatchHash = valueAfter(
    argv,
    "--instrumentation-patch-hash",
    process.env.CLYPRA_INSTRUMENTATION_PATCH_HASH ?? "",
  );
  const input = inputPath
    ? JSON.parse(await readFile(inputPath, "utf8"))
    : buildDefaultScenario();
  const scenario = withHash(validateScenario(input));
  const provenance = {
    CLYPRA_SCENARIO_ID: scenario.scenarioId,
    CLYPRA_SCENARIO_HASH: scenario.scenarioHash,
    CLYPRA_EXPERIMENT_ARM: arm,
    ...(instrumentationPatchHash ? { CLYPRA_INSTRUMENTATION_PATCH_HASH: instrumentationPatchHash } : {}),
    ...(mediaPath ? { CLYPRA_MEDIA_HASH: await hashFile(mediaPath) } : {}),
    ...(projectPath ? { CLYPRA_PROJECT_HASH: await hashFile(projectPath) } : {}),
  };

  if (outputPath) await writeFile(outputPath, `${JSON.stringify(scenario, null, 2)}\n`);
  let result = { mode: "plan", scenario };
  if (endpoint) result = { mode: "endpoint", scenario, result: await postScenario(endpoint, scenario) };
  if (command) result = { mode: "command", scenario, result: await runCommand(command, provenance) };
  if (!endpoint && !command) result = { ...result, environment: provenance };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
