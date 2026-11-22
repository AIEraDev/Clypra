import { describe, expect, it } from "vitest";
import { isNativeResizeHandle } from "../NativeInteractionOverlay";

describe("native transform interaction telemetry", () => {
  it("classifies corner and edge handles as resize interactions", () => {
    expect(isNativeResizeHandle("move")).toBe(false);
    expect(isNativeResizeHandle("se")).toBe(true);
    expect(isNativeResizeHandle("nw")).toBe(true);
  });
});
