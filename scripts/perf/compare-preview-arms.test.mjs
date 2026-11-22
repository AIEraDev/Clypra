import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareArms } from "./compare-preview-arms.mjs";

async function session(dir, name, droppedRatio, pocErrors = 0) {
  const file = join(dir, `${name}.ndjson`);
  const records = [
    {
      kind: "session-header",
      sessionId: name,
      payload: {
        scenarioHash: "scenario-a",
        build: { instrumentationPatchHash: "patch-a", binaryHash: `binary-${name}` },
        ffmpegCallbackVerified: true,
        decodePolicyEffective: "metal",
        mediaHash: "media-a",
        projectHash: "project-a",
        system: { thermalState: "nominal" },
      },
    },
    {
      kind: "frontend-rollup",
      sessionId: name,
      payload: { workload: { droppedFramesRatio: droppedRatio, totalFrames: 100 } },
    },
    {
      kind: "engine-telemetry",
      sessionId: name,
      payload: {
        transfers: { metal_decode_cancelled: 10 },
        decodeIncidents: { pocErrors, rpsErrors: 0 },
        previewConcurrency: { dirtyRecoveries: 10 },
      },
    },
    {
      kind: "session-footer",
      sessionId: name,
      payload: { status: "closed" },
    },
  ];
  await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return file;
}

test("A/B comparator applies dirty-recovery decision rule", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clypra-arms-"));
  const files = {
    A: [await session(dir, "a", 0.2)],
    B: [await session(dir, "b", 0.8, 1)],
    C: [await session(dir, "c", 0.1, 0)],
  };
  const report = await compareArms({ arms: files, warmups: 0, minRuns: 1 });
  assert.equal(report.decisionRuleId, "dirty-recovery-v1");
  assert.equal(report.decision.status, "keep-dirty-recovery");
  assert.equal(report.arms.B.droppedRatio.median, 0.8);
});

test("A/B comparator refuses an unverified callback control", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clypra-arms-control-"));
  const files = {
    A: [await session(dir, "a", 0.2)],
    B: [await session(dir, "b", 0.2)],
    C: [await session(dir, "c", 0.2)],
  };
  const path = files.B[0];
  const contents = await readFile(path, "utf8");
  await writeFile(path, contents.replace('"ffmpegCallbackVerified":true', '"ffmpegCallbackVerified":false'));
  await assert.rejects(
    compareArms({ arms: files, warmups: 0, minRuns: 1 }),
    /verified FFmpeg callback positive control/,
  );
});

test("A/B comparator refuses mixed instrumentation hashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clypra-arms-hash-"));
  const files = {
    A: [await session(dir, "a", 0.2)],
    B: [await session(dir, "b", 0.2)],
    C: [await session(dir, "c", 0.2)],
  };
  const path = files.C[0];
  const contents = await readFile(path, "utf8");
  await writeFile(path, contents.replace('"instrumentationPatchHash":"patch-a"', '"instrumentationPatchHash":"patch-b"'));
  await assert.rejects(
    compareArms({ arms: files, warmups: 0, minRuns: 1 }),
    /identical instrumentation hash/,
  );
});

test("A/B comparator refuses mixed effective decode policies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clypra-arms-policy-"));
  const files = {
    A: [await session(dir, "a", 0.2)],
    B: [await session(dir, "b", 0.2)],
    C: [await session(dir, "c", 0.2)],
  };
  const path = files.C[0];
  const contents = await readFile(path, "utf8");
  await writeFile(path, contents.replace('"decodePolicyEffective":"metal"', '"decodePolicyEffective":"cpu"'));
  await assert.rejects(
    compareArms({ arms: files, warmups: 0, minRuns: 1 }),
    /identical effective decode policy/,
  );
});

test("A/B comparator excludes runs with CPU fallback or incomplete footer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clypra-arms-integrity-"));
  const files = {
    A: [await session(dir, "a", 0.2)],
    B: [await session(dir, "b", 0.2)],
    C: [await session(dir, "c", 0.2)],
  };
  const path = files.B[0];
  const contents = await readFile(path, "utf8");
  const records = contents
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const engine = records.find((record) => record.kind === "engine-telemetry");
  engine.payload.transfers.cpu_nv12_frames = 1;
  records.at(-1).payload.status = "crashed";
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await assert.rejects(
    compareArms({ arms: files, warmups: 0, minRuns: 1 }),
    /arm B has 0 measured runs/,
  );
});

test("A/B comparator excludes unverified capability validation runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clypra-arms-unverified-"));
  const files = {
    A: [await session(dir, "a", 0.2)],
    B: [await session(dir, "b", 0.2)],
    C: [await session(dir, "c", 0.2)],
  };
  const path = files.C[0];
  const contents = await readFile(path, "utf8");
  await writeFile(path, contents.replace('"decodePolicyEffective":"metal"', '"decodePolicyEffective":"metal","unverifiedCapabilityOverride":true'));
  await assert.rejects(
    compareArms({ arms: files, warmups: 0, minRuns: 1 }),
    /arm C has 0 measured runs/,
  );
});
