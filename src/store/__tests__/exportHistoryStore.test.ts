import { beforeEach, describe, expect, it } from "vitest";
import { useExportHistoryStore } from "../exportHistoryStore";

const baseEntry = {
  projectId: "project-1",
  projectName: "Demo",
  outputPath: "/tmp/demo.mp4",
  exportedAt: 1_000,
  totalFrames: 120,
  totalTimeMs: 2_000,
  degradedTextEffects: [
    { clipId: "clip-1", clipName: "Title", styleId: "neon" },
  ],
};

describe("exportHistoryStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useExportHistoryStore.setState({ entries: [] });
  });

  it("persists completed exports with degradation metadata", () => {
    useExportHistoryStore.getState().addEntry(baseEntry);

    const entry = useExportHistoryStore.getState().entries[0];
    expect(entry).toMatchObject(baseEntry);
    expect(entry.id).toMatch(/^export-1000-/);
    expect(JSON.parse(localStorage.getItem("clypra-export-history") ?? "{}")).toMatchObject({
      state: { entries: [expect.objectContaining(baseEntry)] },
    });
  });

  it("keeps only the newest 50 entries", () => {
    for (let index = 0; index < 55; index += 1) {
      useExportHistoryStore.getState().addEntry({
        ...baseEntry,
        exportedAt: 1_000 + index,
        degradedTextEffects: [],
      });
    }

    const entries = useExportHistoryStore.getState().entries;
    expect(entries).toHaveLength(50);
    expect(entries[0].exportedAt).toBe(1_054);
    expect(entries[entries.length - 1]?.exportedAt).toBe(1_005);
  });
});
