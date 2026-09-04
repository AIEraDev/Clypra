import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WaveformLodWorkerClient,
  getWaveformLodWorkerClient,
} from "../waveformLodWorkerClient";

describe("WaveformLodWorkerClient", () => {
  let client: WaveformLodWorkerClient;

  beforeEach(() => {
    client = new WaveformLodWorkerClient();
  });

  it("provides a singleton instance", () => {
    const s1 = getWaveformLodWorkerClient();
    const s2 = getWaveformLodWorkerClient();
    expect(s1).toBe(s2);
  });

  it("builds LOD and slices viewport using fallback when Worker is unavailable", async () => {
    // Generate synthetic 1-second 48kHz sine wave PCM
    const sampleRate = 48000;
    const pcm = new Float32Array(sampleRate);
    for (let i = 0; i < sampleRate; i++) {
      pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const ready = await client.buildLod("test-audio-1", pcm, sampleRate, 1);
    expect(ready.type).toBe("LOD_READY");
    expect(ready.mediaId).toBe("test-audio-1");
    expect(ready.totalSamples).toBe(sampleRate);
    expect(ready.durationSeconds).toBeCloseTo(1.0, 2);

    const slice = await client.sliceViewport("test-audio-1", 0, sampleRate, 100);
    expect(slice.type).toBe("SLICE_RESULT");
    expect(slice.peaks.length).toBe(100);
    expect(slice.rms.length).toBe(100);
    expect(slice.peaks[0]).toBeGreaterThan(0);
  });

  it("handles multi-channel downmixing in fallback mode", async () => {
    const sampleRate = 44100;
    const channelCount = 2;
    // Stereo interleaved: [L0, R0, L1, R1, ...]
    const pcm = new Float32Array(sampleRate * channelCount);
    for (let i = 0; i < pcm.length; i += 2) {
      pcm[i] = 0.8; // Left
      pcm[i + 1] = 0.4; // Right
    }

    const ready = await client.buildLod("test-stereo", pcm, sampleRate, channelCount);
    expect(ready.totalSamples).toBe(sampleRate);

    const slice = await client.sliceViewport("test-stereo", 0, sampleRate, 50);
    expect(slice.peaks.length).toBe(50);
    // Average of 0.8 and 0.4 is 0.6; normalized peak is 1.0 (or ~0.6)
    expect(slice.peaks[0]).toBeGreaterThan(0);
  });

  it("evicts media asset from cache", async () => {
    const pcm = new Float32Array(1000);
    await client.buildLod("to-evict", pcm, 48000, 1);

    client.evict("to-evict");

    // Slicing an evicted asset returns blank buffers without throwing
    const slice = await client.sliceViewport("to-evict", 0, 1000, 50);
    expect(slice.peaks.length).toBe(50);
    expect(slice.peaks[0]).toBe(0);
  });

  it("safely disposes client", () => {
    expect(() => client.dispose()).not.toThrow();
  });
});
