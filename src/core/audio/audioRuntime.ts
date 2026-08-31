import { AudioBufferPool } from "./AudioBufferPool";
import { AudioEngine } from "./AudioEngine";
import { getPlaybackClock } from "../playback/PlaybackClock";
import { isWebviewOrExternalUrl } from "@/lib/platform/pathConversion";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface AudioPrewarmItem {
  key: string;
  source: string;
}

export interface AudioPrewarmResult {
  requested: number;
  loaded: number;
  failed: number;
  durationMs: number;
}

let sharedAudioEngine: AudioEngine | null = null;
let sharedBufferPool: AudioBufferPool | null = null;

/**
 * Return the process-wide preview audio engine.
 *
 * Playback time and scheduled audio must use the same AudioContext. Keeping
 * this ownership here prevents ProjectSession and React hooks from creating
 * independent clocks for the same program transport.
 */
export function getSharedAudioEngine(): AudioEngine {
  if (!sharedAudioEngine) {
    sharedBufferPool = new AudioBufferPool(256 * 1024 * 1024);
    sharedAudioEngine = new AudioEngine({ bufferPool: sharedBufferPool });
  }
  getPlaybackClock(sharedAudioEngine.ctx);
  return sharedAudioEngine;
}

export function resumeSharedAudioEngine(): void {
  if (sharedAudioEngine) {
    void sharedAudioEngine.resume();
  }
}

export function stopSharedAudioEngine(): void {
  sharedAudioEngine?.stopAllVoices(false);
}

/**
 * Decode the session's audio sources before the first transport frame.
 *
 * This is intentionally bounded and uses AudioBufferPool's in-flight
 * deduplication. It runs during session initialization, so first playback
 * does not compete with the RAF synchronizer for network/decode work.
 */
export async function prewarmSharedAudioBuffers(
  items: AudioPrewarmItem[],
  concurrency = 2,
): Promise<AudioPrewarmResult> {
  const startedAt = performance.now();
  const engine = getSharedAudioEngine();
  const unique = new Map<string, string>();
  for (const item of items) {
    if (!item.key || !item.source || engine.bufferPool.has(item.key)) continue;
    unique.set(item.key, item.source);
  }

  const pending = [...unique.entries()];
  let cursor = 0;
  let loaded = 0;
  let failed = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const entry = pending[cursor++];
      if (!entry) return;
      const [key, source] = entry;
      try {
        const resolved = isWebviewOrExternalUrl(source) || !isTauriRuntime()
          ? source
          : convertFileSrc(source);
        await engine.bufferPool.load(key, resolved);
        loaded++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), pending.length) }, worker),
  );
  return {
    requested: pending.length,
    loaded,
    failed,
    durationMs: Math.max(0, performance.now() - startedAt),
  };
}

/** Test/runtime teardown hook for the shared audio runtime. */
export async function resetSharedAudioEngine(): Promise<void> {
  if (!sharedAudioEngine) return;
  sharedAudioEngine.dispose();
  await sharedAudioEngine.ctx.close();
  sharedAudioEngine = null;
  sharedBufferPool = null;
}
