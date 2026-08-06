import { describe, it, expect, beforeEach } from 'vitest';
import { getCached, setCached, clearAllApiCache } from '../apiCache';

describe('API Cache Storage Edge Cases & TTL Invariants', () => {

  beforeEach(() => {
    localStorage.clear();
  });

  describe('Storage & Expiration Invariants', () => {
    it('stores and retrieves cached entries cleanly', () => {
      const mockData = { id: 'effect-1', name: 'Glow Filter' };
      setCached('filters:categories' as any, mockData);

      const retrieved = getCached('filters:categories' as any);
      expect(retrieved).toEqual(mockData);
    });

    it('automatically removes expired cache entries', () => {
      const mockData = { id: 'effect-old', name: 'Old Effect' };
      const cacheKey = 'clypra.apiCache.v1.filters:categories';

      // Manually store an expired entry
      const expiredEntry = {
        data: mockData,
        timestamp: Date.now() - 100000,
        expiresAt: Date.now() - 1000, // Expired 1 second ago
      };
      localStorage.setItem(cacheKey, JSON.stringify(expiredEntry));

      const retrieved = getCached('filters:categories' as any);
      expect(retrieved).toBeNull();
      expect(localStorage.getItem(cacheKey)).toBeNull();
    });

    it('safely handles malformed/corrupted JSON in localStorage without crashing', () => {
      const cacheKey = 'clypra.apiCache.v1.text-effects:index';
      localStorage.setItem(cacheKey, '{ CORRUPTED_JSON: ');

      expect(() => getCached('text-effects:index' as any)).not.toThrow();
      expect(getCached('text-effects:index' as any)).toBeNull();
    });
  });

  describe('Cache Invalidation & Clear', () => {
    it('clears all API cache keys matching prefix', () => {
      setCached('stickers:index' as any, ['sticker-1']);
      setCached('filters:categories' as any, ['filter-1']);

      const clearedCount = clearAllApiCache();
      expect(clearedCount).toBe(2);

      expect(getCached('stickers:index' as any)).toBeNull();
      expect(getCached('filters:categories' as any)).toBeNull();
    });
  });

});
