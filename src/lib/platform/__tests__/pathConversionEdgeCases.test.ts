import { describe, it, expect } from 'vitest';
import { toNativePath } from '../pathConversion';

describe('Platform Path Conversion & URI Normalization Edge Cases', () => {

  describe('Tauri Asset Protocol URL Normalization', () => {

    it('converts macOS/Linux asset://localhost URLs to absolute native paths', () => {
      const input = 'asset://localhost/%2FUsers%2Fdev%2FVideo.mp4';
      const output = toNativePath(input);
      expect(output).toBe('/Users/dev/Video.mp4');
    });

    it('converts Windows asset://localhost URLs with drive letters to native paths', () => {
      const input = 'http://asset.localhost/C%3A%2FUsers%2Fdev%2FVideo.mp4';
      const output = toNativePath(input);
      expect(output).toBe('C:/Users/dev/Video.mp4');
    });

    it('converts standard file:// protocol URLs to native paths', () => {
      const input = 'file:///Users/dev/Movies/clip.mov';
      const output = toNativePath(input);
      expect(output).toBe('/Users/dev/Movies/clip.mov');
    });

    it('handles encoded spaces (%20) and plus signs (%2B) correctly in file paths', () => {
      const input = 'asset://localhost/%2FUsers%2Fdev%2FMy%20Sample%20Video%2B1.mp4';
      const output = toNativePath(input);
      expect(output).toBe('/Users/dev/My Sample Video+1.mp4');
    });

  });

  describe('Unmodified Native Paths & Fallbacks', () => {

    it('returns raw absolute native paths unchanged', () => {
      const macPath = '/Users/dev/Videos/my_project.mp4';
      const winPath = 'C:\\Users\\dev\\Videos\\render.mov';
      expect(toNativePath(macPath)).toBe(macPath);
      expect(toNativePath(winPath)).toBe(winPath);
    });

    it('handles empty or whitespace-only inputs without throwing', () => {
      expect(toNativePath('')).toBe('');
      expect(toNativePath('   ')).toBe('');
    });

  });

});
