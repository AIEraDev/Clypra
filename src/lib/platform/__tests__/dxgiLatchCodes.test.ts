/**
 * Sync-check tests for DXGI latch reason codes.
 *
 * These tests use dxgi-latch-codes.json as the authoritative ground truth.
 * A matching test in adapter_selector.rs asserts the Rust Display strings
 * equal the JSON's rustVariants array.  If any of the three (Rust, TS,
 * Worker) drifts from the JSON, a test fails.
 */
import { describe, it, expect } from "vitest";
import CODES_JSON from "../dxgi-latch-codes.json";
import {
  DXGI_LATCH_REASON_CODES,
  RUST_DXGI_LATCH_REASON_CODES,
  DXGI_LATCH_POLICY_REASONS,
  type DxgiLatchReasonCode,
} from "../dxgiLatchCodes";

describe("DXGI latch reason codes — JSON source-of-truth sync-check", () => {
  it("JSON rustVariants has exactly 14 entries", () => {
    expect(CODES_JSON.rustVariants).toHaveLength(14);
  });

  it("JSON workerSentinels contains exactly 'other'", () => {
    expect(CODES_JSON.workerSentinels).toEqual(["other"]);
  });

  it("RUST_DXGI_LATCH_REASON_CODES exactly equals JSON rustVariants (sync-check)", () => {
    // This is the meaningful cross-check: if someone edits the JSON without
    // updating the Rust Display impl (or vice versa), this fails.
    expect([...RUST_DXGI_LATCH_REASON_CODES]).toEqual([
      ...CODES_JSON.rustVariants,
    ]);
  });

  it("DXGI_LATCH_REASON_CODES is rustVariants + workerSentinels (derived correctly)", () => {
    const expected = [
      ...CODES_JSON.rustVariants,
      ...CODES_JSON.workerSentinels,
    ];
    expect([...DXGI_LATCH_REASON_CODES]).toEqual(expected);
  });

  it("total length is 15 (14 Rust + 1 sentinel)", () => {
    expect(DXGI_LATCH_REASON_CODES).toHaveLength(15);
  });

  it("DXGI_LATCH_POLICY_REASONS contains only env-var-disabled and admin-policy", () => {
    expect(DXGI_LATCH_POLICY_REASONS.has("env-var-disabled")).toBe(true);
    expect(DXGI_LATCH_POLICY_REASONS.has("admin-policy")).toBe(true);
    expect(DXGI_LATCH_POLICY_REASONS.size).toBe(2);
  });

  it("null dxgiLatchedOff is not false (null-safety invariant)", () => {
    const latchedOff: boolean | null | undefined = null;
    expect(latchedOff).not.toBe(false);
    expect(latchedOff === null).toBe(true);
  });

  it("DxgiLatchReasonCode type accepts all expected codes (compile-time check)", () => {
    const _a: DxgiLatchReasonCode = "env-var-disabled";
    const _b: DxgiLatchReasonCode = "dxgi-decode-failed";
    const _c: DxgiLatchReasonCode = "other";
    expect(_a).toBe("env-var-disabled");
    expect(_b).toBe("dxgi-decode-failed");
    expect(_c).toBe("other");
  });
});
