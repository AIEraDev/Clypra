/**
 * Single source of truth for DXGI latch reason codes.
 *
 * These strings are the canonical serialised form of the Rust
 * `DxgiLatchReasonCode` enum (Display impl, kebab-case).  The TypeScript
 * literal union, the Worker Zod schema, and the sync-check test all derive
 * from this one constant — never duplicate the list.
 *
 * "other" is a Worker-side sentinel only: it is written to the DB when an
 * inbound code is unrecognised (newer client → older Worker).  The Rust side
 * never emits "other".
 */
export const DXGI_LATCH_REASON_CODES = [
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
  // Worker-side only — never emitted by the Rust backend.
  "other",
] as const;

export type DxgiLatchReasonCode = (typeof DXGI_LATCH_REASON_CODES)[number];

/**
 * The 14 codes produced by the Rust backend.  "other" is excluded because it
 * is only ever generated at Worker ingest time.
 */
export const RUST_DXGI_LATCH_REASON_CODES = DXGI_LATCH_REASON_CODES.filter(
  (c): c is Exclude<DxgiLatchReasonCode, "other"> => c !== "other",
);
