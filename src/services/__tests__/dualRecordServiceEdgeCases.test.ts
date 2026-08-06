import { describe, it, expect } from 'vitest';
import { DualRecordService, getResolutionDimensions } from '../dualRecordService';

describe('DualRecordService Edge Cases & Recording Invariants', () => {

  describe('Resolution Dimension Helper', () => {
    it('returns 720p dimensions (1280x720)', () => {
      expect(getResolutionDimensions('720p')).toEqual({ width: 1280, height: 720 });
    });

    it('returns 1080p dimensions (1920x1080)', () => {
      expect(getResolutionDimensions('1080p')).toEqual({ width: 1920, height: 1080 });
    });

    it('returns 4k dimensions (3840x2160)', () => {
      expect(getResolutionDimensions('4k')).toEqual({ width: 3840, height: 2160 });
    });

    it('falls back to 1080p for unknown resolution strings', () => {
      // @ts-expect-error testing invalid string input
      expect(getResolutionDimensions('8k_invalid')).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe('DualRecordService Singleton & State Machine', () => {
    it('maintains a single singleton instance', () => {
      const instanceA = DualRecordService.getInstance();
      const instanceB = DualRecordService.getInstance();
      expect(instanceA).toBe(instanceB);
    });

    it('reports correct default non-recording state initially', () => {
      const service = DualRecordService.getInstance();
      expect(service.isRecording()).toBe(false);
    });

    it('throws safety error when stopRecording is called without an active session', async () => {
      const service = DualRecordService.getInstance();
      await expect(service.stopRecording()).rejects.toThrow('No active recording session');
    });
  });

});
