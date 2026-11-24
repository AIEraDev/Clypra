import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDefaultScenario,
  buildScenarioPreset,
  canonicalize,
  scenarioHash,
  validateManifestProvenance,
  validateProjectMediaInputs,
  validateScenario,
  waitForClosedFooter,
} from "./run-preview-scenario.mjs";

test("scenario canonicalization is independent of object key order", () => {
  const left = { b: 2, a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, b: 2 };
  assert.equal(JSON.stringify(canonicalize(left)), JSON.stringify(canonicalize(right)));
});

test("scenario validation rejects an unbounded or unknown action", () => {
  assert.throws(() => validateScenario({ schemaVersion: 1, scenarioId: "x", actions: [{ kind: "unknown" }] }));
  assert.throws(() => validateScenario({ schemaVersion: 1, scenarioId: "x", actions: [{ kind: "scrubSweep", startFrame: 1, endFrame: 1, steps: 2 }] }));
});

test("default scenario includes the fixed multi-workload matrix", () => {
  const scenario = buildDefaultScenario();
  const kinds = scenario.actions.map((action) => action.kind);
  assert.deepEqual(kinds, ["play", "coldSeek", "coldSeek", "coldSeek", "scrubSweep", "clipBoundary", "pause"]);
  assert.deepEqual(scenario.actions.map((action) => action.phaseId), [
    "steady_playback",
    "cold_seek",
    "cold_seek",
    "cold_seek",
    "scrub",
    "clip_boundary",
    "pause",
  ]);
  assert.equal(scenarioHash({ ...scenario, scenarioHash: "ignored" }).length, 64);
});

test("isolated acceptance presets have one measurable workload phase", () => {
  for (const [name, phaseId, kind] of [
    ["playback-steady-30s", "steady_playback", "play"],
    ["playback-composite-30s", "composite_playback", "play"],
    ["composite-scrub-sweep", "composite_scrub", "scrubSweep"],
    ["cold-seek", "cold_seek", "coldSeek"],
    ["scrub-sweep", "scrub", "scrubSweep"],
    ["clip-boundary", "clip_boundary", "clipBoundary"],
  ]) {
    const scenario = buildScenarioPreset(name);
    assert.equal(scenario.actions[0].phaseId, phaseId);
    assert.equal(scenario.actions[0].kind, kind);
    assert.doesNotThrow(() => validateScenario(scenario));
  }
});

test("footer wait resolves only a matching closed session", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-perf-footer-"));
  try {
    const filePath = path.join(directory, "session-test.ndjson");
    await writeFile(
      filePath,
      [
        JSON.stringify({ kind: "session-header", payload: { scenarioHash: "hash-a" } }),
        JSON.stringify({ kind: "session-footer", payload: { status: "closed" } }),
        "",
      ].join("\n"),
    );
    assert.equal(await waitForClosedFooter(directory, "hash-a", 500), filePath);
    await assert.rejects(() => waitForClosedFooter(directory, "hash-b", 20));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validateManifestProvenance validates sha256 and rejects tampering", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-perf-manifest-"));
  try {
    const mediaFile = path.join(directory, "test-clip.mp4");
    const projectFile = path.join(directory, "test-project.json");
    const manifestFile = path.join(directory, "manifest.json");

    await writeFile(mediaFile, "media-binary-data");
    await writeFile(projectFile, '{"id":"test-proj"}');

    const { createHash } = await import("node:crypto");
    const mediaSha = createHash("sha256").update("media-binary-data").digest("hex");
    const projectSha = createHash("sha256").update('{"id":"test-proj"}').digest("hex");

    const manifest = {
      schemaVersion: 1,
      media: { "test-clip.mp4": { sha256: mediaSha } },
      projects: { "test-project.json": { sha256: projectSha } },
    };
    await writeFile(manifestFile, JSON.stringify(manifest));

    // Passes when hashes match
    const res = await validateManifestProvenance(mediaFile, projectFile, manifestFile);
    assert.equal(res?.verified, true);

    // Fails on media tampering
    await writeFile(mediaFile, "tampered-media-data");
    await assert.rejects(
      () => validateManifestProvenance(mediaFile, projectFile, manifestFile),
      /Media hash mismatch against manifest/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
