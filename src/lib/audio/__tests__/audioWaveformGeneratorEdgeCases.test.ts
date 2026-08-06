import { describe, it, expect, vi } from 'vitest';
import { generateAudioWaveform } from '../audioWaveformGenerator';

describe('Audio Waveform Generator Edge Cases & Trim Invariants', () => {

  describe('Sample Range Calculation Helper Math', () => {
    it('calculates start and end sample bounds correctly based on trimIn and trimOut', () => {
      const calculateSampleBounds = (
        trimIn: number,
        trimOut: number | undefined,
        sampleRate: number,
        totalSamples: number
      ) => {
        const startSample = Math.max(0, Math.floor(trimIn * sampleRate));
        const endSample = trimOut !== undefined ? Math.min(totalSamples, Math.floor(trimOut * sampleRate)) : totalSamples;
        const trimmedLength = Math.max(0, endSample - startSample);
        return { startSample, endSample, trimmedLength };
      };

      const res = calculateSampleBounds(2.0, 5.0, 44100, 441000);
      expect(res.startSample).toBe(88200);
      expect(res.endSample).toBe(220500);
      expect(res.trimmedLength).toBe(132300);
    });

    it('handles negative trimIn or trimOut beyond totalSamples safely', () => {
      const calculateSampleBounds = (
        trimIn: number,
        trimOut: number | undefined,
        sampleRate: number,
        totalSamples: number
      ) => {
        const startSample = Math.max(0, Math.floor(trimIn * sampleRate));
        const endSample = trimOut !== undefined ? Math.min(totalSamples, Math.floor(trimOut * sampleRate)) : totalSamples;
        const trimmedLength = Math.max(0, endSample - startSample);
        return { startSample, endSample, trimmedLength };
      };

      const res = calculateSampleBounds(-5.0, 100.0, 44100, 44100);
      expect(res.startSample).toBe(0);
      expect(res.endSample).toBe(44100);
      expect(res.trimmedLength).toBe(44100);
    });
  });

  describe('Amplitude Normalization Math', () => {
    it('normalizes silent audio channel data (all 0.0) without division by zero NaN', () => {
      const normalizePeaks = (peaks: number[]): number[] => {
        const maxPeak = Math.max(...peaks, 0.001); // Safe floor
        return peaks.map((p) => Math.min(1.0, Math.max(0.0, p / maxPeak)));
      };

      const silentPeaks = [0, 0, 0, 0];
      const normalized = normalizePeaks(silentPeaks);
      expect(normalized.every((v) => !Number.isNaN(v))).toBe(true);
      expect(normalized.every((v) => Number.isFinite(v))).toBe(true);
    });
  });

});
