import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  clearWaveformServiceCache,
  getNativeWaveformData,
} from "../waveformService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("waveform service request coalescing", () => {
  beforeEach(() => {
    clearWaveformServiceCache();
    vi.clearAllMocks();
  });

  it("shares one native decode between concurrent consumers of a source", async () => {
    let resolveRequest: ((value: Array<{ peak: number; rms: number }>) => void) | undefined;
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const request = {
      path: "/media/song.mp3",
      numBuckets: 2048,
      startTime: 0,
      duration: 154.286,
    };
    const first = getNativeWaveformData("source:/media/song.mp3:2048", request);
    const second = getNativeWaveformData("source:/media/song.mp3:2048", request);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    const buckets = [{ peak: 0.8, rms: 0.4 }];
    resolveRequest?.(buckets);
    await expect(first).resolves.toEqual(buckets);
    await expect(second).resolves.toEqual(buckets);
  });

  it("retries after a failed native decode instead of poisoning the cache", async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error("ffmpeg unavailable"))
      .mockResolvedValueOnce([{ peak: 0.5, rms: 0.25 }]);

    const request = { path: "/media/song.mp3", numBuckets: 2048 };
    await expect(getNativeWaveformData("source:/media/song.mp3:2048", request)).rejects.toThrow("ffmpeg unavailable");
    await expect(getNativeWaveformData("source:/media/song.mp3:2048", request)).resolves.toEqual([
      { peak: 0.5, rms: 0.25 },
    ]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
