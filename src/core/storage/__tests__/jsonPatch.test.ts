import { describe, expect, it } from "vitest";
import { applyJsonPatch } from "../jsonPatch";
import type { JsonPatchOperation } from "@/workers/types";

describe("applyJsonPatch", () => {
  it("applies replace operation to root-level property", () => {
    const state = { version: 1, name: "old" };
    const patch: JsonPatchOperation[] = [
      { op: "replace", path: "/version", value: 2 },
      { op: "replace", path: "/name", value: "new" },
    ];
    const result = applyJsonPatch(state, patch);
    expect(result).toEqual({ version: 2, name: "new" });
  });

  it("applies array operations (add, remove, replace)", () => {
    const state = {
      tracks: [
        { id: "t1", name: "Track 1" },
        { id: "t2", name: "Track 2" },
      ],
    };

    // Replace item at index 0
    const patch1: JsonPatchOperation[] = [
      { op: "replace", path: "/tracks/0", value: { id: "t1", name: "Updated Track 1" } },
    ];
    const result1 = applyJsonPatch(state, patch1);
    expect(result1.tracks[0].name).toBe("Updated Track 1");

    // Add item
    const patch2: JsonPatchOperation[] = [
      { op: "add", path: "/tracks/-", value: { id: "t3", name: "Track 3" } },
    ];
    const result2 = applyJsonPatch(result1, patch2);
    expect(result2.tracks).toHaveLength(3);
    expect(result2.tracks[2].id).toBe("t3");

    // Remove item at index 1
    const patch3: JsonPatchOperation[] = [
      { op: "remove", path: "/tracks/1" },
    ];
    const result3 = applyJsonPatch(result2, patch3);
    expect(result3.tracks).toHaveLength(2);
    expect(result3.tracks[0].id).toBe("t1");
    expect(result3.tracks[1].id).toBe("t3");
  });

  it("returns unchanged state when patch is empty", () => {
    const state = { a: 1 };
    expect(applyJsonPatch(state, [])).toBe(state);
  });
});
