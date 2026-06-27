import { describe, it, expect } from "vitest";
import { TransitionRenderer } from "../TransitionRenderer";

describe("Transition Renderer Module Export", () => {
  it("should export TransitionRenderer with render function", () => {
    expect(TransitionRenderer).toBeDefined();
    expect(typeof TransitionRenderer.render).toBe("function");
  });
});
