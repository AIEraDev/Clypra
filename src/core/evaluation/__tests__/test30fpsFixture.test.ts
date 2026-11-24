import { describe, it, expect, vi } from "vitest";
import project30fpsRaw from "../../../../scripts/perf/fixtures/project-steady-30fps.json";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => "asset://" + p,
  invoke: vi.fn(),
}));

import { validateAndMigrateProjectPayload } from "@/types/serialization";
import { evaluateTimelineSceneCached } from "../evaluator";
import { buildNativeFrameRequest } from "@/components/editor/preview/nativeVideoPreview";

describe("project-steady-30fps fixture evaluation", () => {
  it("evaluates visualLayers and buildNativeFrameRequest with non-null geometry at time 0", () => {
    const snapshot = validateAndMigrateProjectPayload(project30fpsRaw);

    const scene = evaluateTimelineSceneCached(
      0,
      snapshot.clips,
      snapshot.tracks,
      snapshot.mediaAssets,
      snapshot.project,
    );

    const req = buildNativeFrameRequest(
      scene,
      "test-proj:0",
      0,
      30,
      640,
      360,
      [],
      { mode: "playback" } as any,
    );
    expect(req).not.toBeNull();
    if (req) {
      expect(req.project.videoLayers.length).toBeGreaterThan(0);
      const layer = req.project.videoLayers[0];
      expect(layer.x).toBe(0);
      expect(layer.y).toBe(0);
      expect(layer.width).toBe(1920);
      expect(layer.height).toBe(1080);
    }
  });
});
