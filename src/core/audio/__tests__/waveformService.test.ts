import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  clearWaveformServiceCache,
  getBrowserWaveformData,
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

  it("shares one browser decode between concurrent consumers of a source", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const decodeAudioData = vi.fn().mockResolvedValue({
      sampleRate: 4,
      getChannelData: () => new Float32Array([0, 0.5, -0.25, 1]),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("AudioContext", class {
      decodeAudioData = decodeAudioData;
      close = close;
    });

    const request = {
      url: "asset://song.mp3",
      sourceStart: 0,
      visibleDuration: 1,
      sourceDuration: 1,
      bucketCount: 4,
      sourceBucketCount: 4,
    };
    const first = getBrowserWaveformData("source:asset://song.mp3:2048", request);
    const second = getBrowserWaveformData("source:asset://song.mp3:2048", request);

    expect(first).toBe(second);
    await expect(first).resolves.toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
