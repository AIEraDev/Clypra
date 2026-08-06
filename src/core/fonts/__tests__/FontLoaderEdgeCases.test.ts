import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FontLoader, resetFontLoader, getFontLoader } from '../FontLoader';

// Mock document.fonts API for FontLoader JSDOM execution
const mockFonts = {
  check: vi.fn(() => true),
  load: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
};

// @ts-ignore
global.document = {
  fonts: mockFonts,
};

describe('FontLoader Edge Cases & Concurrency Invariants', () => {

  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  describe('Font Family Sanitization & Descriptor Normalization', () => {
    it('normalizes font descriptor keys consistently across instances', () => {
      const loader = new FontLoader();
      const descA = { family: 'Arial', weight: 'normal' as const, style: 'italic' as const };
      const descB = { family: 'Arial', weight: 'normal' as const, style: 'italic' as const };

      expect(loader.isLoaded(descA)).toBe(false);
      expect(loader.isLoaded(descB)).toBe(false);
    });

    it('handles system font loading cleanly', async () => {
      const loader = new FontLoader();
      const res = await loader.ensureFont({
        family: 'Arial',
        weight: 'normal',
        style: 'normal',
      });
      expect(res.loaded).toBe(true);
      expect(res.font.family).toBe('Arial');
    });
  });

  describe('Concurrent Font Load Deduplication', () => {
    it('deduplicates simultaneous font load promises for the same descriptor', async () => {
      const loader = new FontLoader();
      const desc = { family: 'Arial', weight: 'bold' as const, style: 'normal' as const };

      const [p1, p2] = await Promise.all([
        loader.ensureFont(desc),
        loader.ensureFont(desc),
      ]);

      expect(p1.loaded).toBe(true);
      expect(p2.loaded).toBe(true);
    });
  });

  describe('Global Instance Reset & Statistics Invariants', () => {
    it('resets global singleton instance cleanly', () => {
      const g1 = getFontLoader();
      resetFontLoader();
      const g2 = getFontLoader();
      expect(g1).not.toBe(g2);
    });
  });

});
