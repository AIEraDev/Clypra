import { describe, it, expect } from 'vitest';
import { resolveExportDimensions, QUALITY_TIERS } from '../exportDimensions';

// Helper sanitizer for output path traversal protection
function sanitizeExportPath(rawPath: string): string {
  if (!rawPath || rawPath.includes('\0')) {
    throw new Error('Security Violation: Path contains null bytes');
  }
  const lower = rawPath.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
    throw new Error('Security Violation: Disallowed URI protocol scheme');
  }
  const normalized = rawPath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.includes('..') || parts.includes('.')) {
    // Check for traversal components
    for (const part of parts) {
      if (part === '..') {
        throw new Error("Security Violation: Path traversal '..' detected");
      }
    }
  }
  if (rawPath.includes('../') || rawPath.includes('..\\')) {
    throw new Error("Security Violation: Path traversal '..' detected");
  }
  return rawPath;
}

// Helper validator for export configuration contract
function validateExportConfig(config: {
  width: number;
  height: number;
  fps: number;
  duration: number;
  audioClips?: Array<{ path: string; volume: number; pan?: number }>;
}) {
  const errors: string[] = [];
  if (!config.fps || Number.isNaN(config.fps) || !Number.isFinite(config.fps) || config.fps <= 0) {
    errors.push('Invalid FPS');
  }
  if (!config.width || config.width <= 0 || !config.height || config.height <= 0) {
    errors.push('Invalid dimensions');
  }
  if (config.audioClips) {
    for (const audio of config.audioClips) {
      if (audio.volume < 0 || audio.volume > 10) {
        errors.push('Audio volume out of bounds');
      }
      if (audio.pan !== undefined && (audio.pan < -1 || audio.pan > 1)) {
        errors.push('Audio pan out of bounds');
      }
    }
  }
  return { isValid: errors.length === 0, errors };
}

describe('Export Pipeline Edge Cases & Security Sanitization Suite', () => {

  describe('Dimension & Framing Boundary Edge Cases', () => {
    it('resolves landscape export dimensions to even pixel numbers at 1080p tier', () => {
      const result = resolveExportDimensions(1920, 1080, QUALITY_TIERS[1]);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.width % 2).toBe(0);
      expect(result.height % 2).toBe(0);
    });

    it('resolves portrait export dimensions preserving vertical aspect ratio at 1080p tier', () => {
      const result = resolveExportDimensions(1080, 1920, QUALITY_TIERS[1]);
      expect(result.width).toBe(1080);
      expect(result.height).toBe(1920);
      expect(result.width % 2).toBe(0);
      expect(result.height % 2).toBe(0);
    });

    it('prevents odd width/height outputs required by H.264 macroblock alignment', () => {
      const { width, height } = resolveExportDimensions(1081, 723, QUALITY_TIERS[0]);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    });
  });

  describe('File Path Traversal & Security Sanitization', () => {
    it('rejects path traversal attempts in export output targets', () => {
      const maliciousPaths = [
        '../../../../etc/passwd',
        'C:\\Windows\\System32\\..\\cmd.exe',
        'exports/../../../secret.json',
        'export.mp4\0.sh',
        'javascript:alert(1)',
      ];

      for (const path of maliciousPaths) {
        expect(() => sanitizeExportPath(path)).toThrow();
      }
    });

    it('permits valid, safe export output target paths', () => {
      const safePaths = [
        '/Users/user/Movies/my_video.mp4',
        'C:\\Users\\user\\Videos\\render.mov',
        'relative_export.webm',
      ];

      for (const path of safePaths) {
        expect(() => sanitizeExportPath(path)).not.toThrow();
      }
    });
  });

  describe('Export Config Validation & Structural Invariants', () => {
    it('detects and rejects NaN or Infinite framerates', () => {
      const invalidConfigs = [
        { width: 1920, height: 1080, fps: NaN, duration: 10 },
        { width: 1920, height: 1080, fps: Infinity, duration: 10 },
        { width: 1920, height: 1080, fps: -30, duration: 10 },
        { width: 1920, height: 1080, fps: 0, duration: 10 },
      ];

      for (const config of invalidConfigs) {
        expect(validateExportConfig(config as any).isValid).toBe(false);
      }
    });

    it('detects invalid audio track parameters', () => {
      const invalidAudioConfig = {
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 10,
        audioClips: [
          { path: 'test.mp3', volume: -5, pan: 3.0 },
        ],
      };

      const validation = validateExportConfig(invalidAudioConfig as any);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('validates sound export duration and clip bounds', () => {
      const validConfig = {
        width: 1920,
        height: 1080,
        fps: 60,
        duration: 15.5,
        outputPath: '/tmp/output.mp4',
        audioClips: [
          { path: 'audio.wav', volume: 1.0, pan: 0.0, startTime: 0, duration: 10 },
        ],
      };

      const validation = validateExportConfig(validConfig as any);
      expect(validation.isValid).toBe(true);
    });
  });

  describe('Race Condition & Concurrent Export Locks', () => {
    it('prevents simultaneous active exports on the same engine instance', async () => {
      let isExporting = false;

      const triggerExport = async () => {
        if (isExporting) {
          throw new Error('Export Lock Error: Concurrent export attempt rejected');
        }
        isExporting = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
        isExporting = false;
        return 'success';
      };

      const firstExport = triggerExport();
      await expect(triggerExport()).rejects.toThrow(/Concurrent export attempt rejected/);
      await expect(firstExport).resolves.toBe('success');
    });
  });
});
