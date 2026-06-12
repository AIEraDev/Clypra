import { describe, expect, it, vi } from "vitest";
import { evaluateTimelineScene } from "../evaluator";
import type { Project, TextClip, Track, TransitionTimelineItem } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

const project: Project = {
  id: "p1",
  name: "Test",
  createdAt: 0,
  updatedAt: 0,
  aspectRatio: "16:9",
  canvasWidth: 1920,
  canvasHeight: 1080,
  frameRate: 30,
  duration: 10,
};

const tracks: Track[] = [{ id: "t1", type: "text", name: "Text", muted: false, locked: false, visible: true, height: 30 }];

const makeTextClip = (id: string, startTime: number, text: string): TextClip => ({
  id,
  kind: "text",
  trackId: "t1",
  mediaId: "",
  startTime,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 100,
  y: 100,
  width: 500,
  height: 100,
  opacity: 1,
  rotation: 0,
  text,
  fontFamily: "Inter",
  fontSize: 48,
  color: "#fff",
  align: "center",
  valign: "middle",
  lineHeight: 1.2,
  paddingX: 12,
  paddingY: 12,
});

const transition: TransitionTimelineItem = {
  id: "tr1",
  kind: "transition",
  type: "dissolve",
  fromItemId: "left",
  toItemId: "right",
  alignment: "center",
  easing: "linear",
  placement: {
    trackId: "t1",
    startTime: 4.5,
    duration: 1,
    role: "effect",
    zIndex: Number.MAX_SAFE_INTEGER,
  },
  effects: { effects: [], version: 0 },
};

describe("timeline transition evaluation", () => {
  it("keeps both adjacent text layers active at transition midpoint", () => {
    const scene = evaluateTimelineScene(5, [makeTextClip("left", 0, "A"), makeTextClip("right", 5, "B")], tracks, [], project, [transition]);

    expect(scene.visualLayers).toHaveLength(2);
    expect(scene.transitions).toHaveLength(1);
    expect(scene.transitions[0]).toMatchObject({ transitionId: "tr1", type: "dissolve", progress: 0.5 });
    expect(scene.visualLayers.map((layer) => layer.opacity)).toEqual([0.5, 0.5]);
  });

  it("evaluates transition start and end opacity deterministically", () => {
    const start = evaluateTimelineScene(4.5, [makeTextClip("left", 0, "A"), makeTextClip("right", 5, "B")], tracks, [], project, [transition]);
    const end = evaluateTimelineScene(5.5, [makeTextClip("left", 0, "A"), makeTextClip("right", 5, "B")], tracks, [], project, [transition]);

    expect(start.visualLayers.map((layer) => layer.opacity)).toEqual([1, 0]);
    expect(end.visualLayers.map((layer) => layer.opacity)).toEqual([0, 1]);
  });
});
