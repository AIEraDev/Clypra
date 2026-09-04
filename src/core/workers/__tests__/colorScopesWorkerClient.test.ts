import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ColorScopesWorkerClient,
  getColorScopesWorkerClient,
} from "../colorScopesWorkerClient";

describe("ColorScopesWorkerClient", () => {
  let client: ColorScopesWorkerClient;

  beforeEach(() => {
    client = new ColorScopesWorkerClient();
  });

  it("provides a singleton instance", () => {
    const s1 = getColorScopesWorkerClient();
    const s2 = getColorScopesWorkerClient();
    expect(s1).toBe(s2);
  });

  it("analyzes frames using fallback when Worker is unavailable", async () => {
    const mockBitmap = {
      width: 100,
      height: 100,
      close: vi.fn(),
    } as unknown as ImageBitmap;

    const res = await client.analyze(
      mockBitmap,
      ["histogram", "vectorscope", "waveform", "parade"],
      2,
    );

    expect(res.type).toBe("SCOPE_RESULT");
    expect(res.histogram).toBeDefined();
    expect(res.histogram?.r.length).toBe(256);
    expect(res.vectorscope).toBeDefined();
    expect(res.waveformLines).toBeDefined();
    expect(res.parade).toBeDefined();
    expect(mockBitmap.close).toHaveBeenCalled();
  });

  it("safely disposes client and cleans up pending frames", () => {
    expect(() => client.dispose()).not.toThrow();
  });
});
