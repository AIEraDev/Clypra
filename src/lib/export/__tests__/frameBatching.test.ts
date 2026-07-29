import { describe, expect, it } from "vitest";
import { calculateExportBatchSize } from "../frameBatching";

describe("calculateExportBatchSize", () => {
  it("bounds 1080p and 4K raw frame batches by memory", () => {
    expect(calculateExportBatchSize(1920 * 1080 * 4)).toBe(4);
    expect(calculateExportBatchSize(3840 * 2160 * 4)).toBe(1);
  });

  it("caps small-frame batches and fails safely for invalid sizes", () => {
    expect(calculateExportBatchSize(1)).toBe(45);
    expect(calculateExportBatchSize(0)).toBe(1);
    expect(calculateExportBatchSize(Number.NaN)).toBe(1);
  });
});
