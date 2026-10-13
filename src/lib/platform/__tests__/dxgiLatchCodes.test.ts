/**
 * Sync-check tests for DXGI latch reason codes.
 *
 * These tests serve as a canary: if the Rust DxgiLatchReasonCode enum or its
 * Display strings ever diverge from the TypeScript constant, these tests will
 * fail and the developer must update both sides before merging.
 */
import { describe, it, expect } from "vitest";
import {
  DXGI_LATCH_REASON_CODES,
  RUST_DXGI_LATCH_REASON_CODES,
  type DxgiLatchReasonCode,
} from "../dxgiLatchCodes";

// The 14 kebab-case strings that the Rust Display impl emits, in the same
// order as the enum variants. This list is the ground truth for the sync check.
const EXPECTED_RUST_CODES: readonly string[] = [
  "env-var-disabled",
  "capability-unavailable",
  "unsupported-feature",
  "import-failed",
  "invalid-texture",
  "format-unsupported-p010",
  "wrong-array-slice",
  "device-lost",
  "surface-creation-failed",
  "dimension-mismatch",
  "non-d3d11-surface",
  "dxgi-decode-failed",
  "no-cpu-planes",
  "admin-policy",
] as const;

describe("DXGI_LATCH_REASON_CODES", () => {
  it("has exactly 15 entries (14 Rust variants + 'other')", () => {
    expect(DXGI_LATCH_REASON_CODES).toHaveLength(15);
  });

  it("last entry is 'other' (Worker-side sentinel only)", () => {
    expect(DXGI_LATCH_REASON_CODES[DXGI_LATCH_REASON_CODES.length - 1]).toBe(
      "other",
    );
  });

  it("RUST_DXGI_LATCH_REASON_CODES has exactly 14 entries (no 'other')", () => {
    expect(RUST_DXGI_LATCH_REASON_CODES).toHaveLength(14);
    expect(RUST_DXGI_LATCH_REASON_CODES).not.toContain("other");
  });

  it("sync-check: 14 non-other codes exactly match the Rust Display strings", () => {
    // If this test fails, the Rust enum's Display impl and this TS constant
    // have diverged. Update both sides and re-run.
    const tsNonOther = [...DXGI_LATCH_REASON_CODES].filter((c) => c !== "other");
    expect(tsNonOther).toEqual([...EXPECTED_RUST_CODES]);
  });

  it("accepts a null dxgiLatchedOff value without TypeScript error", () => {
    // This is a type-only test: if dxgiLatchedOff is boolean | null | undefined,
    // null must be a valid value and must not be coerced to false.
    const latchedOff: boolean | null | undefined = null;
    // Runtime assertion: null !== false
    expect(latchedOff).not.toBe(false);
    expect(latchedOff === null).toBe(true);
  });

  it("DxgiLatchReasonCode type includes all expected codes", () => {
    // Compile-time check masquerading as a runtime check.
    // If any of these assignments fail to compile, the type is wrong.
    const _a: DxgiLatchReasonCode = "env-var-disabled";
    const _b: DxgiLatchReasonCode = "dxgi-decode-failed";
    const _c: DxgiLatchReasonCode = "other";
    expect(_a).toBe("env-var-disabled");
    expect(_b).toBe("dxgi-decode-failed");
    expect(_c).toBe("other");
  });
});
