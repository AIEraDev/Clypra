import { describe, it, expect, beforeEach } from "vitest";
import {
  CacheCoordinator,
  getCacheCoordinator,
  detectDefaultMemoryBudget,
  type ICacheParticipant,
  type CacheTier,
  type CacheLifespan,
} from "../cacheCoordinator";

class MockCacheParticipant implements ICacheParticipant {
  name: string;
  tier?: CacheTier;
  lifespan?: CacheLifespan;
  bytes: number;

  constructor(
    name: string,
    bytes: number,
    tier: CacheTier = "memory",
    lifespan: CacheLifespan = "session",
  ) {
    this.name = name;
    this.bytes = bytes;
    this.tier = tier;
    this.lifespan = lifespan;
  }

  getBytesUsed(): number {
    return this.bytes;
  }

  trimTo(targetBytes: number): number {
    const freed = Math.max(0, this.bytes - targetBytes);
    this.bytes = targetBytes;
    return freed;
  }

  clear(): void {
    this.bytes = 0;
  }
}

describe("CacheCoordinator", () => {
  let coordinator: CacheCoordinator;

  beforeEach(() => {
    coordinator = new CacheCoordinator(100 * 1024 * 1024); // 100 MB budget
  });

  it("provides a singleton instance", () => {
    const s1 = getCacheCoordinator();
    const s2 = getCacheCoordinator();
    expect(s1).toBe(s2);
  });

  it("tracks participant memory usage and total bytes", () => {
    const p1 = new MockCacheParticipant("waveforms", 20 * 1024 * 1024);
    const p2 = new MockCacheParticipant("filters", 30 * 1024 * 1024);

    coordinator.register(p1);
    coordinator.register(p2);

    expect(coordinator.getTotalBytesUsed()).toBe(50 * 1024 * 1024);

    const stats = coordinator.getStats();
    expect(stats.participants.length).toBe(2);
    expect(stats.usageRatio).toBeCloseTo(0.5, 2);
  });

  it("trims oldest/largest participants when budget is exceeded", () => {
    const p1 = new MockCacheParticipant("waveforms", 60 * 1024 * 1024);
    const p2 = new MockCacheParticipant("filters", 60 * 1024 * 1024);

    coordinator.register(p1);
    coordinator.register(p2);

    // Total 120 MB > 100 MB budget
    coordinator.enforceBudget();

    expect(coordinator.getTotalBytesUsed()).toBeLessThanOrEqual(100 * 1024 * 1024);
  });

  it("handles critical memory pressure by clearing all caches", () => {
    const p1 = new MockCacheParticipant("waveforms", 40 * 1024 * 1024);
    const p2 = new MockCacheParticipant("filters", 40 * 1024 * 1024);

    coordinator.register(p1);
    coordinator.register(p2);

    coordinator.handleMemoryPressure("critical");

    expect(coordinator.getTotalBytesUsed()).toBe(0);
    expect(p1.getBytesUsed()).toBe(0);
    expect(p2.getBytesUsed()).toBe(0);
  });

  it("differentiates tiers and aggregates tierBytes in stats", () => {
    const mem = new MockCacheParticipant("evaluatedScene", 10 * 1024 * 1024, "memory");
    const gpu = new MockCacheParticipant("gpuTextures", 25 * 1024 * 1024, "gpu");

    coordinator.register(mem);
    coordinator.register(gpu);

    const stats = coordinator.getStats();
    expect(stats.tierBytes.memory).toBe(10 * 1024 * 1024);
    expect(stats.tierBytes.gpu).toBe(25 * 1024 * 1024);
  });

  it("resets session caches while preserving persistent caches on resetSessionCaches", async () => {
    const sessionPart = new MockCacheParticipant("session-frames", 30 * 1024 * 1024, "memory", "session");
    const persistentPart = new MockCacheParticipant("persistent-luts", 15 * 1024 * 1024, "indexeddb", "persistent");

    coordinator.register(sessionPart);
    coordinator.register(persistentPart);

    await coordinator.resetSessionCaches();

    expect(sessionPart.getBytesUsed()).toBe(0);
    expect(persistentPart.getBytesUsed()).toBe(15 * 1024 * 1024);
  });

  it("detectDefaultMemoryBudget returns bounded bytes", () => {
    const budget = detectDefaultMemoryBudget();
    expect(budget).toBeGreaterThanOrEqual(256 * 1024 * 1024);
    expect(budget).toBeLessThanOrEqual(2048 * 1024 * 1024);
  });
});
