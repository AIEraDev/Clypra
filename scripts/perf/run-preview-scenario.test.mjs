import test from "node:test";
import assert from "node:assert/strict";
import { buildDefaultScenario, canonicalize, scenarioHash, validateScenario } from "./run-preview-scenario.mjs";

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
  assert.equal(scenarioHash({ ...scenario, scenarioHash: "ignored" }).length, 64);
});
