import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildTierProjects,
  generateManifest,
  generateW1AVolunteerFixtures,
  verifyManifest,
  hashFile,
} from "./make-fixtures.mjs";

test("buildTierProjects covers all three workload tiers with deterministic schema", () => {
  const projects = buildTierProjects("tests/fixtures/perf");

  // Tier 1 assertions
  assert.ok(projects["project-steady-25fps.json"]);
  assert.ok(projects["project-steady-30fps.json"]);
  assert.ok(projects["project-video-gop10s.json"]);
  assert.ok(projects["project-image.json"]);
  assert.ok(projects["project-audio.json"]);
  assert.ok(projects["project-text.json"]);
  assert.ok(projects["project-text-effect.json"]);
  assert.ok(projects["project-text-template.json"]);

  // Tier 2 ramp assertions (2, 4, 6, 8 layers)
  for (const n of [2, 4, 6, 8]) {
    const p = projects[`project-stacked-${n}.json`];
    assert.ok(p, `project-stacked-${n} exists`);
    assert.equal(p.tracks.length, n);
    assert.equal(p.clips.length, n);
  }

  // Tier 3 composite assertions
  const comp25 = projects["project-composite-25fps.json"];
  assert.ok(comp25);
  assert.equal(comp25.frame_rate, 25);
  assert.ok(comp25.media_assets.length >= 4);

  const comp30 = projects["project-composite-30fps.json"];
  assert.ok(comp30);
  assert.equal(comp30.frame_rate, 30);
});

test("verifyManifest verifies matching media and projects and flags discrepancies", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-fixtures-test-"));
  try {
    const mediaDir = path.join(directory, "media");
    const projectsDir = path.join(directory, "projects");
    const manifestPath = path.join(projectsDir, "manifest.json");

    const { mkdir } = await import("node:fs/promises");
    await mkdir(mediaDir, { recursive: true });
    await mkdir(projectsDir, { recursive: true });

    // Create sample media and project
    const mediaFile = path.join(mediaDir, "sample.mp4");
    await writeFile(mediaFile, "sample video binary content");

    const projectFile = path.join(projectsDir, "sample-project.json");
    const projectContent = JSON.stringify({
      id: "sample-project",
      frame_rate: 25,
      duration: 30,
      media_assets: [{ path: "sample.mp4" }],
    });
    await writeFile(projectFile, projectContent);

    // Generate manifest
    await generateManifest(mediaDir, projectsDir, manifestPath);

    // Initial verification must pass
    const resPass = await verifyManifest(mediaDir, projectsDir, manifestPath);
    assert.equal(resPass.ok, true);
    assert.equal(resPass.errors.length, 0);

    // Tamper with media file
    await writeFile(mediaFile, "tampered video content");
    const resFailMedia = await verifyManifest(mediaDir, projectsDir, manifestPath);
    assert.equal(resFailMedia.ok, false);
    assert.match(resFailMedia.errors[0], /Media fixture hash mismatch/);

    // Revert media, tamper with project
    await writeFile(mediaFile, "sample video binary content");
    await writeFile(projectFile, JSON.stringify({ id: "tampered" }));
    const resFailProject = await verifyManifest(mediaDir, projectsDir, manifestPath);
    assert.equal(resFailProject.ok, false);
    assert.match(resFailProject.errors[0], /Project fixture hash mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generateW1AVolunteerFixtures emits the locked two-clip descriptor", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-w1a-fixtures-test-"));
  try {
    const manifest = await generateW1AVolunteerFixtures(directory);
    assert.equal(manifest.protocolVersion, "w1a-volunteer-v1");
    assert.equal(manifest.media.length, 2);
    assert.deepEqual(manifest.media.map((entry) => entry.role), ["A", "B"]);
    assert.equal(manifest.media[0].bitDepth, 8);
    assert.equal(manifest.media[1].profile, "main10");
    assert.match(manifest.packSha256, /^[a-f0-9]{64}$/);
    assert.equal((await readFile(path.join(directory, "manifest.json"), "utf8")).includes(manifest.packSha256), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
