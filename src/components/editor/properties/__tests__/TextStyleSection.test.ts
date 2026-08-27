import { describe, expect, it } from "vitest";
import { resolveFontPickerValue } from "../TextStyleSection";

describe("resolveFontPickerValue", () => {
  it("keeps Dancing Script aliases bound to the visible picker option", () => {
    expect(resolveFontPickerValue("Dancing Script")).toBe("Dancing Script");
    expect(resolveFontPickerValue("Dancing Script Variable")).toBe("Dancing Script");
  });

  it("maps normalized family stacks to their picker values", () => {
    expect(resolveFontPickerValue("Inter, system-ui, sans-serif")).toBe("Inter Variable");
    expect(resolveFontPickerValue("Open Sans Variable")).toBe("Open Sans");
  });
});
