/**
 * SINGLE SOURCE OF TRUTH: dxgi-latch-codes.json
 *
 * This file derives its constants from the adjacent JSON file, which is the
 * authoritative list.  The same JSON is copied to clypra-api/src/ for Worker
 * validation.  A Rust test (adapter_selector.rs) also asserts that
 * DxgiLatchReasonCode::Display strings exactly match the JSON's rustVariants.
 *
 * Drift between Rust, TypeScript, and Worker is caught by the sync-check
 * tests, which fail if any of the three disagrees with the JSON.
 */
import CODES_JSON from "./dxgi-latch-codes.json";

/**
 * All codes including the Worker-side "other" sentinel.
 * rustVariants + workerSentinels, in declaration order.
 */
export const DXGI_LATCH_REASON_CODES = [
  ...CODES_JSON.rustVariants,
  ...CODES_JSON.workerSentinels,
] as const;

export type DxgiLatchReasonCode = (typeof DXGI_LATCH_REASON_CODES)[number];

/**
 * The 14 codes produced by the Rust backend.
 * "other" is excluded — it is only ever generated at Worker ingest time.
 */
export const RUST_DXGI_LATCH_REASON_CODES: readonly string[] =
  CODES_JSON.rustVariants;

/**
 * Latch reasons that indicate a deliberate policy decision (not a failure).
 * Used by the digest to distinguish "intentionally disabled" from "broke".
 */
export const DXGI_LATCH_POLICY_REASONS: ReadonlySet<DxgiLatchReasonCode> =
  new Set<DxgiLatchReasonCode>(["env-var-disabled", "admin-policy"]);
