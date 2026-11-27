import assert from "node:assert/strict";
import test from "node:test";
import { toMsixVersion } from "./msix-version.mjs";

test("normalizes a prerelease version to four numeric parts", () => {
  assert.equal(toMsixVersion("1.6.9-1"), "1.6.9.0");
  assert.equal(toMsixVersion("1.6.9-beta.2"), "1.6.9.0");
});

test("preserves an existing four-part numeric version", () => {
  assert.equal(toMsixVersion("1.6.9.4"), "1.6.9.4");
  assert.equal(toMsixVersion("1.6.9.4+build.7"), "1.6.9.4");
});

test("rejects versions that cannot be represented by MSIX", () => {
  assert.throws(() => toMsixVersion("1.6"), /Invalid MSIX-compatible/);
  assert.throws(() => toMsixVersion("release"), /Invalid MSIX-compatible/);
});
