/**
 * Audio Waveform Thumbnail Generator
 *
 * Consolidated to delegate directly to waveformService, reusing the shared
 * LRU cache and de-duplicated audio bucket decoding.
 */

import {
  generateAudioWaveformThumbnail,
  renderWaveformBucketsToDataUrl,
  type WaveformThumbnailOptions,
} from "@/core/audio/waveformService";

export type WaveformOptions = WaveformThumbnailOptions;

/**
 * Generate a waveform thumbnail from an audio file.
 * Returns a base64 data URL that can be used as an image source.
 */
export async function generateAudioWaveform(
  audioPath: string,
  options: WaveformOptions = {},
): Promise<string> {
  return generateAudioWaveformThumbnail(audioPath, options);
}

/**
 * Generate a simple waveform pattern (for when audio analysis fails or placeholder rendering).
 * Uses a pseudo-random pattern that looks like an audio waveform.
 */
export function generateSimpleWaveform(options: WaveformOptions = {}): string {
  return renderWaveformBucketsToDataUrl([], options);
}
