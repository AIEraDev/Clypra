#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const patchFile = resolve(root, "tests/mutations/broken-scrub-audio-lateness.patch");
const testFile = "src/core/playback/__tests__/scrubTraceReplay.test.ts";
const artifact = resolve(root, "test-results/scrub-trace-canary.json");
mkdirSync(resolve(root, "test-results"), { recursive: true });

const runVitest = () =>
  spawnSync("npx", ["vitest", "run", testFile, "--reporter=dot"], {
    cwd: root,
    encoding: "utf8",
  });

const clean = runVitest();
const apply = spawnSync("git", ["apply", "--check", patchFile], {
  cwd: root,
  encoding: "utf8",
});
let mutation = { exitCode: null, caught: false };
if (apply.status === 0) {
  spawnSync("git", ["apply", patchFile], { cwd: root });
  try {
    const result = runVitest();
    mutation = { exitCode: result.status, caught: result.status !== 0 };
  } finally {
    spawnSync("git", ["apply", "--reverse", patchFile], { cwd: root });
  }
}

const report = {
  schemaVersion: 1,
  cleanExitCode: clean.status,
  mutationPatch: "tests/mutations/broken-scrub-audio-lateness.patch",
  mutationExitCode: mutation.exitCode,
  mutationCaughtAsRed: mutation.caught,
};
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
if (clean.status !== 0 || !mutation.caught) process.exit(1);
