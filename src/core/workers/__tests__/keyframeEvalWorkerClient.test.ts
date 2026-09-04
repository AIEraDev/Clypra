import { describe, it, expect, beforeEach } from "vitest";
import {
  KeyframeEvalWorkerClient,
  getKeyframeEvalWorkerClient,
} from "../keyframeEvalWorkerClient";
import type { SerializedKeyframeClip } from "@/workers/types";

describe("KeyframeEvalWorkerClient", () => {
  let client: KeyframeEvalWorkerClient;

  beforeEach(() => {
    client = new KeyframeEvalWorkerClient();
  });

  it("provides a singleton instance", () => {
    const s1 = getKeyframeEvalWorkerClient();
    const s2 = getKeyframeEvalWorkerClient();
    expect(s1).toBe(s2);
  });

  it("evaluates linear visual keyframes in fallback mode", async () => {
    const clips: SerializedKeyframeClip[] = [
      {
        clipId: "clip-1",
        startTime: 0,
        duration: 10,
        visualKeyframes: [
          { property: "opacity", time: 0, value: 0.0 },
          { property: "opacity", time: 2, value: 1.0 },
          { property: "rotation", time: 0, value: 0 },
          { property: "rotation", time: 4, value: 180 },
        ],
      },
    ];

    // At presentation time t = 1.0s (halfway between 0 and 2s)
    const map = await client.evaluateKeyframes(1.0, clips);
    const clip1 = map.get("clip-1");

    expect(clip1).toBeDefined();
    expect(clip1?.visual?.opacity).toBeCloseTo(0.5, 2);
    expect(clip1?.visual?.rotation).toBeCloseTo(45, 1);
  });

  it("evaluates volume keyframes in fallback mode", async () => {
    const clips: SerializedKeyframeClip[] = [
      {
        clipId: "audio-clip",
        startTime: 5.0,
        duration: 10.0,
        volumeKeyframes: [
          { time: 0.0, gain: 0.0 },
          { time: 2.0, gain: 0.8 },
        ],
      },
    ];

    // Timeline presentation time t = 6.0s (relative time = 1.0s)
    const map = await client.evaluateKeyframes(6.0, clips);
    const audio = map.get("audio-clip");

    expect(audio).toBeDefined();
    expect(audio?.gain).toBeCloseTo(0.4, 2);
  });
});
