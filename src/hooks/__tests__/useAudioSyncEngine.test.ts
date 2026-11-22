import { describe, expect, it } from "vitest";
import { shouldInitializeNativeAudioPreview } from "@/hooks/useAudioSyncEngine";
import type { AudioPlaybackSource } from "@/core/audio/AudioPlaybackAdapter";

const hydratedClips = new Array<AudioPlaybackSource["clips"][number]>(1);

describe("shouldInitializeNativeAudioPreview", () => {
  it("waits for a hydrated source and transport authority", () => {
    expect(
      shouldInitializeNativeAudioPreview(
        { clips: [], duration: 0 },
        false,
      ),
    ).toBe(false);
    expect(
      shouldInitializeNativeAudioPreview(
        { clips: hydratedClips, duration: 0 },
        false,
      ),
    ).toBe(false);
  });

  it("accepts a hydrated video-only source with an active authority", () => {
    expect(
      shouldInitializeNativeAudioPreview(
        { clips: hydratedClips, duration: 30 },
        true,
      ),
    ).toBe(true);
  });

  it("accepts a silent project when its computed duration is available", () => {
    expect(
      shouldInitializeNativeAudioPreview({ clips: [], duration: 30 }, true),
    ).toBe(true);
  });
});
