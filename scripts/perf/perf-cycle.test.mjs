import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveScenarioSpec,
  materializeProject,
  runPreflight,
} from "./perf-cycle.mjs";

test("resolveScenarioSpec resolves valid scenarios across all three tiers", () => {
  const s1 = resolveScenarioSpec("playback-steady-25fps");
  assert.equal(s1.tier, "tier1");
  assert.equal(s1.preset, "playback-steady-30s");
  assert.equal(s1.projectFile, "project-steady-25fps.json");
  assert.equal(s1.mediaFile, "clip_1440p25_gop1s.mp4");

  const s2 = resolveScenarioSpec("playback-steady-30fps");
  assert.equal(s2.tier, "tier1");
  assert.equal(s2.mediaFile, "clip_1080p30_gop1s.mp4");

  const s3 = resolveScenarioSpec("project-stacked-4");
  assert.equal(s3.tier, "tier2");
  assert.equal(s3.projectFile, "project-stacked-4.json");

  const s4 = resolveScenarioSpec("playback-composite-25fps");
  assert.equal(s4.tier, "tier3");
  assert.equal(s4.projectFile, "project-composite-25fps.json");

  assert.throws(() => resolveScenarioSpec("non-existent-scenario"), /Unknown scenario name/);
});

test("materializeProject updates asset paths to absolute paths without altering structure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-materialize-"));
  try {
    const inputProject = path.join(directory, "project.json");
    const mediaDir = "/custom/media/dir";
    const projectContent = {
      id: "test-mat",
      media_assets: [
        { id: "a1", name: "clip.mp4", path: "relative/path/to/clip.mp4" },
        { id: "a2", name: "logo.png", path: "/old/machine/path/logo.png" },
      ],
      tracks: [],
      clips: [],
    };
    await writeFile(inputProject, JSON.stringify(projectContent, null, 2));

    const materialized = await materializeProject(inputProject, directory, mediaDir);
    const resultRaw = await readFile(materialized, "utf8");
    const result = JSON.parse(resultRaw);

    assert.equal(result.media_assets[0].path, path.resolve(mediaDir, "clip.mp4"));
    assert.equal(result.media_assets[1].path, path.resolve(mediaDir, "logo.png"));
    assert.equal(result.id, "test-mat");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runPreflight returns git metadata and validates manifest", async () => {
  const preflight = await runPreflight();
  assert.ok(typeof preflight.gitSha === "string");
  assert.ok(typeof preflight.gitDirty === "boolean");
  assert.equal(preflight.manifestOk, true);
});
