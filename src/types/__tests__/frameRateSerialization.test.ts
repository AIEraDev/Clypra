import { describe, it, expect } from "vitest";
import { fromRustProject, toRustProject } from "../serialization";
import type { RustProject } from "../serialization";

const base: RustProject = {
  id: "test-id",
  name: "Test Project",
  created_at: 1000,
  modified_at: 2000,
};

describe("fromRustProject frame_rate deserialization", () => {
  it("deserializes frame_rate 25 as 25", () => {
    expect(fromRustProject({ ...base, frame_rate: 25 }).frameRate).toBe(25);
  });

  it("deserializes frame_rate 23.976 as 23.976", () => {
    expect(fromRustProject({ ...base, frame_rate: 23.976 }).frameRate).toBe(
      23.976,
    );
  });

  it("falls back to 30 when frame_rate is null", () => {
    expect(fromRustProject({ ...base, frame_rate: null }).frameRate).toBe(30);
  });

  it("falls back to 30 for unknown frame_rate 999", () => {
    expect(fromRustProject({ ...base, frame_rate: 999 }).frameRate).toBe(30);
  });

  it("round-trips frame_rate 25 through toRustProject", () => {
    const project = fromRustProject({ ...base, frame_rate: 25 });
    const rustProject = toRustProject(project, {
      mediaAssets: [],
      tracks: [],
      clips: [],
      transitions: [],
      gaps: [],
      markers: [],
      captionTracks: [],
      mainVideoTrackId: null,
      updateModifiedTime: false,
    });
    expect(rustProject.frame_rate).toBe(25);
  });
});
