#!/usr/bin/env node
/**
 * Run the deterministic browser gesture matrix and/or validate a native NDJSON
 * session. The browser phase proves pointer determinism only; it is not a
 * substitute for a native decoder run. Native evidence is accepted only when
 * the expected experiment context and lifecycle accounting are present.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildScrubGesture, validateControlledSession } from "./scrub-gesture.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = (flag) => args.includes(flag);
const root = process.cwd();
const output = resolve(valueAfter("--output", "test-results/controlled-scrub-matrix.json"));

function parseList(flag, fallback) {
  return valueAfter(flag, fallback).split(",").map((value) => value.trim()).filter(Boolean);
}

function parseBool(value) {
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  throw new Error(`invalid boolean: ${value}`);
}

function loadNdjson(file) {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`invalid NDJSON at line ${index + 1}: ${error.message}`); }
  });
}

function runBrowserMatrix() {
  const directions = parseList("--directions", "forward,backward");
  const repeats = Number(valueAfter("--repeats", "5"));
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error("--repeats must be a positive integer");
  const cacheStates = parseList("--cache", "cleared,uncleared");
  const backgroundStates = parseList("--background", "disabled");
  const runs = [];
  outer: for (const direction of directions) {
    for (const cacheState of cacheStates) {
      for (const backgroundState of backgroundStates) {
        for (let repeat = 1; repeat <= repeats; repeat += 1) {
          const runId = `scrub-${direction}-${cacheState}-${backgroundState}-r${String(repeat).padStart(2, "0")}`;
          const artifact = resolve("test-results", `${runId}.json`);
          const gesture = buildScrubGesture({ direction });
          const env = {
            ...process.env,
            SCRUB_DIRECTION: direction,
            SCRUB_EXPERIMENT_ID: valueAfter("--experiment-id", "scrub-v1"),
            SCRUB_RUN_ID: runId,
            SCRUB_CACHE_CLEARED: String(cacheState === "cleared"),
            SCRUB_BACKGROUND_DECODE_DISABLED: String(backgroundState === "disabled"),
            SCRUB_ARTIFACT: artifact,
          };
          const result = spawnSync(
            "npx",
            ["playwright", "test", "tests/e2e/perf/scrub-gesture.spec.ts", "--config=playwright.perf.config.ts", "--project=chromium", "--reporter=line"],
            { cwd: root, env, encoding: "utf8", stdio: "inherit" },
          );
          runs.push({ runId, direction, cacheCleared: cacheState === "cleared", backgroundDecodeDisabled: backgroundState === "disabled", repeat, gesture, exitCode: result.status });
          if (result.status !== 0 && !has("--keep-going")) break outer;
        }
      }
    }
  }
  return { mode: "browser-gesture", runs, passed: runs.filter((run) => run.exitCode === 0).length, failed: runs.filter((run) => run.exitCode !== 0).length };
}

function validateNativeSession() {
  const file = valueAfter("--validate-session", null);
  if (!file || !existsSync(file)) throw new Error("--validate-session requires an existing NDJSON file");
  const expected = {
    experimentId: valueAfter("--experiment-id", "scrub-v1"),
    runId: valueAfter("--run-id", ""),
    cacheCleared: parseBool(valueAfter("--cache-cleared", "true")),
    backgroundDecodeDisabled: parseBool(valueAfter("--background-decode-disabled", "true")),
    direction: valueAfter("--direction", ""),
  };
  if (!expected.runId) throw new Error("--run-id is required with --validate-session");
  const validation = validateControlledSession(loadNdjson(file), expected, { requireNativePresenter: !has("--allow-non-native"), allowMixedMedia: has("--allow-mixed-media") });
  return { mode: "native-ndjson-validation", file, validation };
}

const report = args.includes("--validate-session") ? validateNativeSession() : runBrowserMatrix();
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
console.log(`controlled scrub artifact: ${output}`);
if (report.validation && !report.validation.valid) process.exitCode = 1;
if (report.failed > 0) process.exitCode = 1;

