import { AudioBufferPool } from "./AudioBufferPool";
import { AudioEngine } from "./AudioEngine";
import { getPlaybackClock } from "../playback/PlaybackClock";

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

/** Test/runtime teardown hook for the shared audio runtime. */
export async function resetSharedAudioEngine(): Promise<void> {
  if (!sharedAudioEngine) return;
  sharedAudioEngine.dispose();
  await sharedAudioEngine.ctx.close();
  sharedAudioEngine = null;
  sharedBufferPool = null;
}
