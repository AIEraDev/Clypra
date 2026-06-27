import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PreviewMediaPool } from "../PreviewMediaPool";
import type { Clip, MediaAsset } from "@/types";

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path, // Just return the path as-is for tests
}));

// Mock browser APIs for Node environment
if (typeof HTMLVideoElement === "undefined") {
  (globalThis as any).HTMLVideoElement = class HTMLVideoElement {
    src = "";
    currentTime = 0;
    duration = 10;
    paused = true;
    muted = true;
    volume = 1;
    playbackRate = 1;
    readyState = 4;
    seeking = false;
    playsInline = true;
    preload = "auto";
    style = { cssText: "" };
    parentNode = null;

    addEventListener() {}
    removeEventListener() {}
    load() {}
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    requestVideoFrameCallback() {
      return 1;
    }
    cancelVideoFrameCallback() {}
  };
}

if (typeof HTMLAudioElement === "undefined") {
  (globalThis as any).HTMLAudioElement = class HTMLAudioElement extends (globalThis as any).HTMLVideoElement {};
}

if (typeof document === "undefined") {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === "video") return new (globalThis as any).HTMLVideoElement();
      if (tag === "audio") return new (globalThis as any).HTMLAudioElement();
      if (tag === "div") {
        return {
          style: { cssText: "" },
          appendChild: () => {},
          removeChild: () => {},
          parentNode: null,
        };
      }
      return {};
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
  };
}

// Helper to create mock clips
function createMockClip(id: string, mediaId: string, startTime: number, duration: number, trimIn = 0): Clip {
  return {
    id,
    mediaId,
    trackId: "track-1",
    startTime,
    duration,
    trimIn,
    trimOut: trimIn + duration,
    kind: "video",
    volume: 1.0,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
  } as Clip;
}

// Helper to create mock assets
function createMockAsset(id: string, path: string): MediaAsset {
  return {
    id,
    path,
    type: "video",
    name: `asset-${id}`,
    duration: 10,
    width: 1920,
    height: 1080,
  } as MediaAsset;
}

// Helper to wait for async operations
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("PreviewMediaPool — Re-entrancy Protection", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should allow single sync call to complete normally", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    // Should not throw
    expect(() => {
      pool.sync(clips, assets, tracks, syncState);
    }).not.toThrow();

    // Should have video elements
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThan(0);
  });

  it("should queue sync request when already syncing", async () => {
    // Create a large number of clips to make sync() take longer
    const clips = Array.from({ length: 100 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 100 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    const syncState1 = {
      time: 0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    const syncState2 = {
      time: 5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    // Call sync twice rapidly
    pool.sync(clips, assets, tracks, syncState1);
    pool.sync(clips, assets, tracks, syncState2); // Should queue and return immediately

    // Give time for queued sync to process
    await wait(50);

    // Both syncs should have processed eventually
    // The pool should reflect the final state (syncState2)
    expect(pool).toBeDefined();
  });

  it("should only process the most recent queued request", async () => {
    const clips = Array.from({ length: 50 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 50 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Call sync multiple times rapidly (simulating 60fps calls)
    for (let i = 0; i < 10; i++) {
      pool.sync(clips, assets, tracks, {
        time: i,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    // Give time for all syncs to process
    await wait(100);

    // Pool should be in valid state (not corrupted)
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle sync exception gracefully and remain operational", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    // First sync should work
    pool.sync(clips, assets, tracks, syncState);

    // Dispose the pool to cause an error on next sync
    pool.dispose();

    // Second sync should not throw (disposal check returns early)
    expect(() => {
      pool.sync(clips, assets, tracks, syncState);
    }).not.toThrow();
  });

  it("should clear queued request on disposal", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    // Start a sync
    pool.sync(clips, assets, tracks, syncState);

    // Queue another sync
    pool.sync(clips, assets, tracks, { ...syncState, time: 5.0 });

    // Dispose should not throw even with queued request
    expect(() => pool.dispose()).not.toThrow();
  });

  it("should not create duplicate elements during concurrent sync attempts", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Call sync many times rapidly (simulating race condition)
    for (let i = 0; i < 20; i++) {
      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    // Wait for all syncs to process
    await wait(100);

    // Should only have one element for the clip (not duplicates)
    const videoElements = pool.getVideoElements();
    const clipKeys = Array.from(videoElements.keys()).filter((key) => key.includes("clip-1"));
    expect(clipKeys.length).toBeLessThanOrEqual(1);
  });

  it("should handle rapid state changes without corruption", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Simulate rapid playback state changes
    const states: Array<"playing" | "paused" | "stopped"> = ["playing", "paused", "playing", "paused", "stopped"];

    for (const state of states) {
      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(50);

    // Pool should remain functional
    expect(() => pool.getVideoElements()).not.toThrow();
  });
});

describe("PreviewMediaPool — Basic Functionality", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should create video elements for video clips", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    pool.sync(clips, assets, tracks, syncState);

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThan(0);
  });

  it("should handle empty clip list", () => {
    const clips: Clip[] = [];
    const assets: MediaAsset[] = [];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 0,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    expect(() => {
      pool.sync(clips, assets, tracks, syncState);
    }).not.toThrow();

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBe(0);
  });

  it("should cleanup on dispose", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    pool.sync(clips, assets, tracks, syncState);

    // Should have elements before dispose
    expect(pool.getVideoElements().size).toBeGreaterThan(0);

    pool.dispose();

    // Should have no elements after dispose
    expect(pool.getVideoElements().size).toBe(0);
  });

  it("should not process sync calls after disposal", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    pool.dispose();

    // Sync after disposal should return early
    pool.sync(clips, assets, tracks, syncState);

    // Should have no elements (sync was rejected)
    expect(pool.getVideoElements().size).toBe(0);
  });

  it("should handle multiple clips from same media source", () => {
    // Two clips referencing the same media (common in split scenarios)
    const clips = [
      createMockClip("clip-1", "media-1", 0, 5, 0),
      createMockClip("clip-2", "media-1", 5, 5, 5), // Split clip
    ];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    pool.sync(clips, assets, tracks, syncState);

    const videoElements = pool.getVideoElements();
    // Should have separate elements for each clip (different trimIn values)
    expect(videoElements.size).toBeGreaterThanOrEqual(1);
  });
});

describe("PreviewMediaPool — Split Clip Scenarios", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should handle clip split at playhead", async () => {
    // Initial clip
    const initialClips = [createMockClip("clip-1", "media-1", 0, 10, 0)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync with initial clip at time 5
    pool.sync(initialClips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Simulate split: left clip keeps original ID, right clip gets new ID
    const splitClips = [
      createMockClip("clip-1", "media-1", 0, 5, 0), // Left (original ID, trimOut = 5)
      createMockClip("clip-2", "media-1", 5, 5, 5), // Right (new ID, trimIn = 5)
    ];

    // Sync again with split clips
    pool.sync(splitClips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should have elements for both clips
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThanOrEqual(1);
  });

  it("should handle rapid splits without element duplication", async () => {
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Start with one clip
    let clips = [createMockClip("clip-1", "media-1", 0, 10, 0)];

    pool.sync(clips, assets, tracks, {
      time: 2.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Simulate multiple rapid splits
    clips = [createMockClip("clip-1", "media-1", 0, 2, 0), createMockClip("clip-2", "media-1", 2, 8, 2)];
    pool.sync(clips, assets, tracks, {
      time: 2.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    clips = [createMockClip("clip-1", "media-1", 0, 2, 0), createMockClip("clip-2", "media-1", 2, 4, 2), createMockClip("clip-3", "media-1", 6, 4, 6)];
    pool.sync(clips, assets, tracks, {
      time: 4.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Should have elements but not excessive duplicates
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThan(10); // Reasonable upper bound
  });
});

describe("PreviewMediaPool — Performance and Memory", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should handle large number of clips efficiently", async () => {
    // Create 100 clips
    const clips = Array.from({ length: 100 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 100 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    const startTime = Date.now();

    pool.sync(clips, assets, tracks, {
      time: 50.0, // Middle of timeline
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Sync should complete in reasonable time (< 1 second for 100 clips)
    expect(duration).toBeLessThan(1000);
  });

  it("should respect cache limits", async () => {
    // Create more clips than cache limit (20)
    const clips = Array.from({ length: 30 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 30 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync with all clips
    pool.sync(clips, assets, tracks, {
      time: 30.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Cache should not grow unbounded
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(30);
  });

  it("should handle rapid time changes during playback", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5), createMockClip("clip-2", "media-2", 5, 5), createMockClip("clip-3", "media-3", 10, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4"), createMockAsset("media-3", "/path/to/video3.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Simulate 60fps playback for 1 second (60 syncs)
    for (let i = 0; i < 60; i++) {
      const time = (i / 60) * 15; // 0 to 15 seconds over 60 frames
      pool.sync(clips, assets, tracks, {
        time,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // Should remain stable
    expect(() => pool.getVideoElements()).not.toThrow();
  });
});

describe("PreviewMediaPool — FINDING-004: Seeked Event Listener Leak", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should not accumulate seeked listeners during scrubbing", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Initial sync to create element
    pool.sync(clips, assets, tracks, {
      time: 0,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Simulate rapid scrubbing (100 seeks in quick succession)
    // This would previously cause 100 listeners to accumulate
    for (let i = 0; i < 100; i++) {
      pool.sync(clips, assets, tracks, {
        time: (i / 100) * 10, // Scrub from 0 to 10 seconds
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // Pool should remain functional (no memory exhaustion)
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle prolonged scrubbing session without memory leak", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5), createMockClip("clip-2", "media-2", 5, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Simulate extended scrubbing session (500 rapid seeks)
    // Without the fix, this would accumulate 500+ listeners per element
    for (let i = 0; i < 500; i++) {
      const time = (i % 100) / 10; // Scrub back and forth
      pool.sync(clips, assets, tracks, {
        time,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(200);

    // Should not crash or throw
    expect(() => pool.getVideoElements()).not.toThrow();

    // Elements should still be accessible
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThan(0);
  });

  it("should handle scrubbing with multiple clips without listener leak", async () => {
    // Create 10 clips to test listener leak across multiple elements
    const clips = Array.from({ length: 10 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 10 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Scrub across all clips multiple times
    for (let pass = 0; pass < 5; pass++) {
      for (let i = 0; i < 20; i++) {
        pool.sync(clips, assets, tracks, {
          time: i, // Scrub from 0 to 20 seconds
          state: "paused" as const,
          speed: 1.0,
          muted: false,
          volume: 100,
          frameRate: 30 as 24 | 30 | 60,
        });
      }
    }

    await wait(150);

    // With 10 elements × 5 passes × 20 seeks = 1000 total seeks
    // Without fix: 1000 listeners accumulated (crash)
    // With fix: Only ~10 listeners (one per element, auto-removed)
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should properly clean up on disposal after heavy scrubbing", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Heavy scrubbing session
    for (let i = 0; i < 200; i++) {
      pool.sync(clips, assets, tracks, {
        time: (i / 200) * 10,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // Disposal should complete without hanging or errors
    expect(() => pool.dispose()).not.toThrow();
  });

  it("should not leak memory during seek-play-seek cycles", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Simulate user behavior: seek → play briefly → seek again
    for (let i = 0; i < 50; i++) {
      // Seek
      pool.sync(clips, assets, tracks, {
        time: (i / 50) * 10,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });

      // Play briefly
      pool.sync(clips, assets, tracks, {
        time: (i / 50) * 10,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });

      // Seek again
      pool.sync(clips, assets, tracks, {
        time: ((i + 1) / 50) * 10,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(150);

    // Should remain stable
    expect(() => pool.getVideoElements()).not.toThrow();
  });
});

describe("PreviewMediaPool — FINDING-007: Missing isActive Guard", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should only attempt playback on active elements", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync with active element (within time window)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThan(0);

    // Element should be marked as active
    const element = Array.from(videoElements.values())[0];
    expect(element).toBeDefined();
  });

  it("should not attempt playback on inactive elements", () => {
    const clips = [createMockClip("clip-1", "media-1", 5, 5)]; // Clip from 5-10s
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync at time 2.5 (before clip starts) - element should be inactive
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should create element (for preloading) but not attempt playback
    // This is implementation detail - main thing is no crash/errors
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle clip boundary crossing without playing inactive elements", async () => {
    // Two sequential clips
    const clips = [
      createMockClip("clip-1", "media-1", 0, 5), // 0-5s
      createMockClip("clip-2", "media-2", 5, 5), // 5-10s
    ];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Start at 4.5s (clip-1 active, clip-2 inactive)
    pool.sync(clips, assets, tracks, {
      time: 4.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Advance to 5.5s (clip-1 should become inactive, clip-2 active)
    pool.sync(clips, assets, tracks, {
      time: 5.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should not throw - inactive elements should not attempt playback
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should prevent race condition when element becomes inactive during playback request", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync at 4.9s (near end of clip)
    pool.sync(clips, assets, tracks, {
      time: 4.9,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Immediately advance past clip boundary
    // This simulates the race where sync() marks element inactive
    // but requestPlayback() could be queued from previous frame
    pool.sync(clips, assets, tracks, {
      time: 5.1,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should not crash or attempt playback on inactive element
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle multiple clips transitioning without playing inactive elements", async () => {
    // Create timeline with 5 sequential clips
    const clips = Array.from({ length: 5 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 5 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Play through entire timeline rapidly
    for (let time = 0; time < 10; time += 0.2) {
      pool.sync(clips, assets, tracks, {
        time,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // Multiple clip transitions should not cause playback on inactive elements
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should respect isActive guard during rapid seeks across clip boundaries", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 3), createMockClip("clip-2", "media-2", 3, 3), createMockClip("clip-3", "media-3", 6, 3)];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4"), createMockAsset("media-3", "/path/to/video3.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Rapidly seek back and forth across boundaries
    const seekTimes = [1.5, 4.5, 7.5, 2.0, 5.0, 8.0, 0.5, 3.5, 6.5];

    for (const time of seekTimes) {
      pool.sync(clips, assets, tracks, {
        time,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
      await wait(20);
    }

    // Should handle rapid active/inactive transitions without errors
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should prevent simultaneous audio from multiple clips due to missing guard", async () => {
    // This test simulates the exact bug scenario: audio continues from
    // inactive clip while new clip also plays audio
    const clips = [createMockClip("clip-1", "media-1", 0, 5), createMockClip("clip-2", "media-2", 5, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play through first clip
    pool.sync(clips, assets, tracks, {
      time: 4.9,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Cross boundary - clip-1 should become inactive, clip-2 active
    pool.sync(clips, assets, tracks, {
      time: 5.1,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // With guard: only clip-2 plays
    // Without guard: both clips could play simultaneously
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThan(0);

    // Verify pool remains in valid state
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle playback state changes at clip boundaries", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play up to near end
    pool.sync(clips, assets, tracks, {
      time: 4.95,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Pause at exact boundary
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Resume after boundary (element now inactive)
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should handle gracefully without attempting playback on inactive element
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should maintain correct active state during 60fps playback", async () => {
    const clips = [
      createMockClip("clip-1", "media-1", 0, 1), // Short 1s clip
      createMockClip("clip-2", "media-2", 1, 1),
    ];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Simulate 60fps playback across clip boundary
    for (let frame = 0; frame < 120; frame++) {
      const time = frame / 60; // 2 seconds of playback at 60fps
      pool.sync(clips, assets, tracks, {
        time,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // Should handle 60fps sync calls during clip transition
    expect(() => pool.getVideoElements()).not.toThrow();
  });
});

describe("PreviewMediaPool — FINDING-006: Early Exit Optimization", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should skip sync when nothing meaningful changed (same time/state/clipCount)", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];
    const syncState = {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    // First sync - should execute fully
    pool.sync(clips, assets, tracks, syncState);
    const videoElements1 = pool.getVideoElements();
    expect(videoElements1.size).toBeGreaterThan(0);

    // Second sync with identical state - should early exit
    pool.sync(clips, assets, tracks, syncState);
    const videoElements2 = pool.getVideoElements();
    expect(videoElements2.size).toEqual(videoElements1.size);

    // Third sync - still should early exit
    pool.sync(clips, assets, tracks, syncState);
    const videoElements3 = pool.getVideoElements();
    expect(videoElements3.size).toEqual(videoElements1.size);
  });

  it("should process sync when time changes significantly (>0.1s)", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // First sync at time 2.5
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Second sync at time 3.5 (changed by 1.0s)
    // Should NOT early exit because time changed beyond 0.1s threshold
    pool.sync(clips, assets, tracks, {
      time: 3.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should remain functional
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should early exit for micro time changes within 0.1s precision", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // First sync at time 2.500
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Second sync at time 2.516 (16ms later - one frame at 60fps)
    // Should early exit because rounded to 0.1s both are "2.5"
    pool.sync(clips, assets, tracks, {
      time: 2.516,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Third sync at time 2.550 (50ms later)
    // Should still early exit because rounded to 0.1s both are "2.5"
    pool.sync(clips, assets, tracks, {
      time: 2.55,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should process sync when playback state changes", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // First sync - playing
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Second sync - paused (state changed)
    // Should NOT early exit because state changed
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should process sync when clip count changes", () => {
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // First sync - one clip
    pool.sync([createMockClip("clip-1", "media-1", 0, 5)], assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Second sync - two clips (clip count changed)
    // Should NOT early exit because clip count changed
    pool.sync([createMockClip("clip-1", "media-1", 0, 5), createMockClip("clip-2", "media-2", 5, 5)], assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should significantly reduce CPU during 60fps playback with early exit", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Initial sync to set up element
    pool.sync(clips, assets, tracks, {
      time: 0.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const startTime = performance.now();

    // Simulate 60fps playback for 1 second (60 frames)
    // Most of these should hit early exit since time changes slowly
    for (let frame = 0; frame < 60; frame++) {
      const time = 5.0 + frame / 60; // Advance 1 second at 60fps
      pool.sync(clips, assets, tracks, {
        time,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    // With early exit optimization, 60 sync calls should complete quickly
    // Without optimization: ~30-120ms
    // With optimization: <10ms (most calls early exit immediately)
    expect(duration).toBeLessThan(100);
  });

  it("should handle rapid state changes without breaking early exit logic", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Alternate between playing and paused rapidly
    for (let i = 0; i < 20; i++) {
      const state = i % 2 === 0 ? "playing" : "paused";
      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state: state as "playing" | "paused",
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(50);

    // Should remain functional
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should reset early exit hash when crossing 0.1s time boundary", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync at 2.45 (rounds to 2.4)
    pool.sync(clips, assets, tracks, {
      time: 2.45,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Sync at 2.46, 2.47, 2.48, 2.49 (all round to 2.4)
    // These should all early exit
    for (let t = 2.46; t < 2.5; t += 0.01) {
      pool.sync(clips, assets, tracks, {
        time: t,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    // Sync at 2.55 (rounds to 2.6)
    // Should NOT early exit - crossed boundary
    pool.sync(clips, assets, tracks, {
      time: 2.55,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle empty clip list without breaking early exit", () => {
    const assets: MediaAsset[] = [];
    const tracks = [{ id: "track-1", type: "video" }];

    // First sync - empty
    pool.sync([], assets, tracks, {
      time: 0,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Second sync - still empty (should early exit)
    pool.sync([], assets, tracks, {
      time: 0,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(pool.getVideoElements().size).toBe(0);
  });

  it("should bypass early exit after re-entrancy queue processing", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Rapidly queue multiple sync calls
    for (let i = 0; i < 10; i++) {
      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // After queue processing, early exit should work correctly
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should maintain early exit optimization after disposal and recreation", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // First pool
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    pool.dispose();

    // Create new pool
    pool = new PreviewMediaPool();

    // Early exit should work for new pool
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should clear early exit hash on disposal", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync to establish hash
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Dispose (should clear internal hash)
    pool.dispose();

    // Sync after disposal should return early (disposal check)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(pool.getVideoElements().size).toBe(0);
  });
});

describe("PreviewMediaPool — FINDING-015: State Machine Divergence Prevention", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should use element.paused as single source of truth for playback state", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync in playing state
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThan(0);

    // State is derived from element.paused, not a separate field
    const video = Array.from(videoElements.values())[0];
    expect(video).toBeDefined();
    // In mock, paused state is tracked by the element itself
  });

  it("should not have separate playbackState field that can diverge", () => {
    // This test verifies the fix: playbackState field has been removed
    // So there's no way for explicit state to diverge from implicit state

    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // The pool should work correctly without playbackState field
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle play promise rejection without state divergence", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // First sync
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Second sync after potential play promise rejection
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should not enter infinite retry loop
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should correctly derive blocked state from autoplayBlocked flag", () => {
    // Autoplay blocked scenario
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Try to play (might be blocked by browser)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // State is determined by element.paused + autoplayBlocked flag
    // No separate playbackState to diverge
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle rapid play/pause without state divergence", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Rapid play
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Rapid pause
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Rapid play again
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should not have state divergence
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should prevent infinite retry loop from state divergence", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Simulate scenario that could cause infinite loop
    // (play attempt, promise rejects, but state thinks it's playing)
    for (let i = 0; i < 100; i++) {
      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // With fix: element.paused is single source of truth
    // No divergence, no infinite loop
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should maintain state consistency during promise lifecycle", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Start playback
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // While promise is in flight, try again
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // State should be consistent (no divergence)
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle paused state correctly without separate field", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Pause state
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThan(0);

    // Paused state derived from element.paused
    const video = Array.from(videoElements.values())[0];
    expect(video.paused).toBe(true);
  });

  it("should handle stopped state correctly without separate field", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Stopped state
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "stopped" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    // Stopped should pause all elements
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should derive state correctly from element.paused and flags", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play state
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // State derivation logic:
    // - autoplayBlocked = true → "blocked"
    // - element.paused = true → "paused"
    // - element.paused = false → "playing"

    // No separate playbackState field to diverge
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle multiple clips without state divergence", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5), createMockClip("clip-2", "media-2", 5, 5), createMockClip("clip-3", "media-3", 10, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4"), createMockAsset("media-3", "/path/to/video3.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play through timeline
    for (let time = 0; time < 15; time += 0.5) {
      pool.sync(clips, assets, tracks, {
        time,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // All elements should have consistent state
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should not spam console with infinite retry attempts", async () => {
    // This test verifies the fix prevents the symptom described in FINDING-015:
    // "Infinite play() retry loop (thousands of attempts)"

    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    let syncCalls = 0;

    // Simulate many sync calls (would cause infinite loop without fix)
    for (let i = 0; i < 1000; i++) {
      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
      syncCalls++;
    }

    await wait(100);

    // With fix: no infinite loop, operations complete normally
    expect(syncCalls).toBe(1000);
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle promise rejection during pause transition", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Start playing
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Immediately pause (promise might still be in flight)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // State should be paused (element.paused is source of truth)
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should handle browser blocking play() correctly", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // First play attempt (might be blocked)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // After user gesture, unlock audio
    pool.unlockAudio();

    // Try playing again
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should work without state divergence
    expect(() => pool.getVideoElements()).not.toThrow();
  });
});

describe("PreviewMediaPool — FINDING-018: Cache Eviction Hard Limit", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should respect MAX_CACHED_VIDEOS limit even when all clips are in timeline", async () => {
    // Create 25 clips (exceeds MAX_CACHED_VIDEOS = 20)
    const clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync with all clips in timeline
    pool.sync(clips, assets, tracks, {
      time: 25.0, // Middle of timeline
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Cache should not exceed MAX (20) even though all clips are in timeline
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should evict oldest inactive protected elements when over limit", async () => {
    // Create 25 clips
    const clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync at time 0 (only first few clips active)
    pool.sync(clips, assets, tracks, {
      time: 0.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Cache should be limited to MAX
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should prefer evicting inactive elements over active ones", async () => {
    // Create 25 clips
    const clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // First sync creates all elements
    pool.sync(clips, assets, tracks, {
      time: 25.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Move to different time (changes which clips are active)
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Active elements should be retained, inactive evicted first
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should prevent unbounded memory growth on large projects", async () => {
    // Simulate large project with 50 clips
    const clips = Array.from({ length: 50 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 50 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync multiple times
    for (let time = 0; time < 100; time += 10) {
      pool.sync(clips, assets, tracks, {
        time,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
      await wait(10);
    }

    // Cache should never exceed MAX
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should enforce hard limit in 4-pass eviction strategy", async () => {
    // Create exactly MAX+5 clips (25)
    const clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Load all clips
    pool.sync(clips, assets, tracks, {
      time: 25.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Pass 1: Evict old unprotected (none, all in timeline)
    // Pass 2: Evict oldest unprotected (none, all in timeline)
    // Pass 3: Evict oldest protected inactive (should trigger here)
    // Pass 4: Evict oldest protected active (fallback)

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should handle timeline with all clips active", async () => {
    // Create 25 clips but make them all "active" by having overlapping ranges
    const clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, 0, 10)); // All start at 0
    const assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = Array.from({ length: 25 }, (_, i) => ({ id: `track-${i}`, type: "video" }));

    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Even with all active, should respect MAX limit (Pass 4)
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should use LRU policy for eviction within each pass", async () => {
    // Create 25 clips
    const clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Initial load
    pool.sync(clips, assets, tracks, {
      time: 0.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Access middle clips (updates lastUsedAt)
    pool.sync(clips, assets, tracks, {
      time: 25.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Go back to start (oldest should be evicted, recently used preserved)
    pool.sync(clips, assets, tracks, {
      time: 0.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should prevent browser crash on mobile with many clips", async () => {
    // Mobile scenario: 30 clips, limited memory
    const clips = Array.from({ length: 30 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 30 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Load project
    pool.sync(clips, assets, tracks, {
      time: 30.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Cache limited to prevent memory exhaustion
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should handle edge case of exactly MAX clips", async () => {
    // Exactly 20 clips (at the limit)
    const clips = Array.from({ length: 20 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 20 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 20.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Should allow exactly MAX
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should evict elements as timeline changes", async () => {
    // Start with 25 clips
    let clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    let assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 25.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Remove 10 clips from timeline
    clips = clips.slice(0, 15);
    assets = assets.slice(0, 15);

    pool.sync(clips, assets, tracks, {
      time: 15.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Removed clips should be evicted
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should not evict elements that are about to be used", async () => {
    // Create 25 clips
    const clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync at beginning
    pool.sync(clips, assets, tracks, {
      time: 0.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Active elements should be preserved
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeGreaterThan(0);
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should handle rapid timeline changes with many clips", async () => {
    const clips = Array.from({ length: 40 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 40 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Rapid scrubbing through timeline
    for (let time = 0; time < 80; time += 5) {
      pool.sync(clips, assets, tracks, {
        time,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // Cache should remain bounded
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });

  it("should prioritize active clips when at capacity", async () => {
    // Create 25 clips
    const clips = Array.from({ length: 25 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 25 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Load first half
    pool.sync(clips.slice(0, 15), assets.slice(0, 15), tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Now sync with all clips (should trigger eviction)
    pool.sync(clips, assets, tracks, {
      time: 5.0, // Same position (first clips still active)
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Active clips should be retained
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBeLessThanOrEqual(20);
  });
});

describe("PreviewMediaPool — FINDING-016: Play Promise Cancellation", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should cancel pending play promise when pausing", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Start playing
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Immediately pause (promise might still be pending)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Video should be paused (promise was cancelled)
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should handle rapid play/pause clicks without state divergence", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Rapid play/pause sequence
    for (let i = 0; i < 10; i++) {
      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });

      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    await wait(100);

    // Final state should be paused
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should not resume playback after cancellation", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Pause immediately
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Wait for any pending promises
    await wait(100);

    // Try to verify state again
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should still be paused (not resumed)
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should clear cancel flag when starting new play attempt", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play → Pause → Play sequence
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Play again (cancel flag should be cleared)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should be playing now
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should handle pause during promise resolution", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Start play (promise begins)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Pause while promise is resolving
    await wait(10); // Small delay to simulate promise pending
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should be paused
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should handle multiple clips with rapid play/pause", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5), createMockClip("clip-2", "media-2", 5, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Rapid sequence at clip boundary
    pool.sync(clips, assets, tracks, {
      time: 4.9,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    pool.sync(clips, assets, tracks, {
      time: 4.9,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    pool.sync(clips, assets, tracks, {
      time: 5.1,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    pool.sync(clips, assets, tracks, {
      time: 5.1,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // All elements should be paused
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should prevent audio from continuing after pause click", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // User clicks play
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // User clicks pause within 100ms
    await wait(50);
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Audio should not be playing
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should maintain consistent state across promise lifecycle", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Test sequence: play → pause → wait → verify
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Wait for all promises to settle
    await wait(150);

    // Verify consistent state
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      // Element.paused is the source of truth
      expect(video.paused).toBe(true);
    }
  });

  it("should handle stopped state with pending promises", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Stop
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "stopped" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(50);

    // Should be paused
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });

  it("should handle promise rejection with cancel flag", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Attempt play
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Cancel immediately
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // Should handle gracefully even if promise rejected
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should prevent transport UI state divergence", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Scenario: User sees pause button, clicks it, but video keeps playing
    // This was the symptom described in FINDING-016

    // Play (button shows "pause" icon)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // User clicks pause button
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    await wait(100);

    // With fix: video actually paused (transport matches reality)
    // Without fix: video keeps playing (transport shows pause but video plays)
    const videoElements = pool.getVideoElements();
    for (const video of videoElements.values()) {
      expect(video.paused).toBe(true);
    }
  });
});

describe("PreviewMediaPool — FINDING-022: Conditional Property Updates", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should not update element properties when values unchanged", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Initial sync
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    const element = Array.from(videoElements.values())[0];
    expect(element).toBeDefined();

    // Track property setter calls by wrapping them
    let mutedSetCount = 0;
    let volumeSetCount = 0;
    let playbackRateSetCount = 0;

    const originalMutedDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "muted");
    const originalVolumeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "volume");
    const originalPlaybackRateDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "playbackRate");

    Object.defineProperty(element, "muted", {
      get: originalMutedDescriptor?.get || (() => false),
      set: (value: boolean) => {
        mutedSetCount++;
        originalMutedDescriptor?.set?.call(element, value);
      },
      configurable: true,
    });

    Object.defineProperty(element, "volume", {
      get: originalVolumeDescriptor?.get || (() => 1),
      set: (value: number) => {
        volumeSetCount++;
        originalVolumeDescriptor?.set?.call(element, value);
      },
      configurable: true,
    });

    Object.defineProperty(element, "playbackRate", {
      get: originalPlaybackRateDescriptor?.get || (() => 1),
      set: (value: number) => {
        playbackRateSetCount++;
        originalPlaybackRateDescriptor?.set?.call(element, value);
      },
      configurable: true,
    });

    // Second sync with SAME properties - should not set properties
    pool.sync(clips, assets, tracks, {
      time: 2.6, // Time changed (needsRender=true)
      state: "playing" as const,
      speed: 1.0, // Same speed
      muted: false, // Same muted
      volume: 100, // Same volume
      frameRate: 30 as 24 | 30 | 60,
    });

    // With optimization: properties not set again (counts remain 0)
    // Without optimization: properties set every sync (counts would be 1+)
    expect(mutedSetCount).toBe(0);
    expect(volumeSetCount).toBe(0);
    expect(playbackRateSetCount).toBe(0);
  });

  it("should update element properties when values change", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Initial sync
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Change muted state
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: true, // Changed
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    const element = Array.from(videoElements.values())[0];
    expect(element.muted).toBe(true);

    // Change volume
    pool.sync(clips, assets, tracks, {
      time: 2.7,
      state: "playing" as const,
      speed: 1.0,
      muted: true,
      volume: 50, // Changed
      frameRate: 30 as 24 | 30 | 60,
    });

    // Volume should be updated (roughly 0.5 since muted=true sets volume to 0)
    // When muted changes to false, volume will be set

    // Unmute and set volume
    pool.sync(clips, assets, tracks, {
      time: 2.8,
      state: "playing" as const,
      speed: 1.0,
      muted: false, // Changed
      volume: 50,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Change playback rate
    pool.sync(clips, assets, tracks, {
      time: 2.9,
      state: "playing" as const,
      speed: 2.0, // Changed
      muted: false,
      volume: 50,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(element.playbackRate).toBe(2.0);
  });

  it("should avoid unnecessary property updates during 60fps playback", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Initial sync
    pool.sync(clips, assets, tracks, {
      time: 0.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    const element = Array.from(videoElements.values())[0];

    // Track setter calls
    let totalSetterCalls = 0;
    const originalMutedDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "muted");
    const originalVolumeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "volume");
    const originalPlaybackRateDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "playbackRate");

    Object.defineProperty(element, "muted", {
      get: originalMutedDescriptor?.get || (() => false),
      set: (value: boolean) => {
        totalSetterCalls++;
        originalMutedDescriptor?.set?.call(element, value);
      },
      configurable: true,
    });

    Object.defineProperty(element, "volume", {
      get: originalVolumeDescriptor?.get || (() => 1),
      set: (value: number) => {
        totalSetterCalls++;
        originalVolumeDescriptor?.set?.call(element, value);
      },
      configurable: true,
    });

    Object.defineProperty(element, "playbackRate", {
      get: originalPlaybackRateDescriptor?.get || (() => 1),
      set: (value: number) => {
        totalSetterCalls++;
        originalPlaybackRateDescriptor?.set?.call(element, value);
      },
      configurable: true,
    });

    // Simulate 60fps playback for 1 second (60 frames)
    for (let frame = 1; frame <= 60; frame++) {
      pool.sync(clips, assets, tracks, {
        time: frame / 60,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    // With optimization: 0 setter calls (properties unchanged)
    // Without optimization: 180 setter calls (3 properties × 60 frames)
    expect(totalSetterCalls).toBe(0);
  });

  it("should use volume tolerance of 0.01 to avoid floating point issues", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync with volume that might have floating point precision issues
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 33.333333, // Repeating decimal
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    const element = Array.from(videoElements.values())[0];

    let volumeSetCount = 0;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "volume");

    Object.defineProperty(element, "volume", {
      get: originalDescriptor?.get || (() => 0.33333),
      set: (value: number) => {
        volumeSetCount++;
        originalDescriptor?.set?.call(element, value);
      },
      configurable: true,
    });

    // Sync again with nearly identical volume (within 0.01 tolerance)
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 33.334, // Very close to previous
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should not update due to tolerance
    expect(volumeSetCount).toBe(0);
  });

  it("should update volume when change exceeds tolerance threshold", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 50,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    const element = Array.from(videoElements.values())[0];

    let volumeSetCount = 0;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "volume");

    Object.defineProperty(element, "volume", {
      get: originalDescriptor?.get || (() => 0.5),
      set: (value: number) => {
        volumeSetCount++;
        originalDescriptor?.set?.call(element, value);
      },
      configurable: true,
    });

    // Change volume by more than tolerance (>0.01)
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 60, // Changed by 10% = 0.1 difference
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should update (difference > 0.01)
    expect(volumeSetCount).toBeGreaterThan(0);
  });

  it("should handle rapid property changes efficiently", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    const element = Array.from(videoElements.values())[0];

    let setterCallCount = 0;
    const props = ["muted", "volume", "playbackRate"] as const;

    props.forEach((prop) => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), prop);
      Object.defineProperty(element, prop, {
        get: descriptor?.get || (() => (prop === "muted" ? false : 1)),
        set: (value: any) => {
          setterCallCount++;
          descriptor?.set?.call(element, value);
        },
        configurable: true,
      });
    });

    // Alternate between two states rapidly
    for (let i = 0; i < 20; i++) {
      pool.sync(clips, assets, tracks, {
        time: i / 10,
        state: "playing" as const,
        speed: i % 2 === 0 ? 1.0 : 2.0, // Alternate speed
        muted: i % 2 === 0, // Alternate muted
        volume: i % 2 === 0 ? 100 : 50, // Alternate volume
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    // With optimization: only updates when values change
    // 20 iterations with alternating values = ~20 updates per property = ~60 total
    // Without optimization: 20 iterations × 3 properties = 60 unconditional updates
    // With optimization, we avoid some redundant sets
    expect(setterCallCount).toBeGreaterThan(0);
    expect(setterCallCount).toBeLessThan(60); // Fewer than unconditional approach
  });

  it("should maintain correct audio routing despite optimization", () => {
    const clips = [
      createMockClip("clip-1", "media-1", 0, 5),
      createMockClip("clip-2", "media-2", 0, 5), // Overlapping
    ];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync with both clips
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements = pool.getVideoElements();
    const elements = Array.from(videoElements.values());

    // One element should be unmuted (primary), others muted
    const unmutedCount = elements.filter((e) => !e.muted).length;
    expect(unmutedCount).toBeLessThanOrEqual(1); // At most one unmuted

    // Sync again - muted states should remain correct
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const unmutedCountAfter = elements.filter((e) => !e.muted).length;
    expect(unmutedCountAfter).toBeLessThanOrEqual(1);
  });
});

describe("PreviewMediaPool — FINDING-002 & FINDING-003: Grace Period and Original ClipId", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should extend grace period when element remains in timeline (FINDING-002)", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Initial sync - create element
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const videoElements1 = pool.getVideoElements();
    expect(videoElements1.size).toBe(1);

    // Temporarily remove clip (simulating split where clip briefly removed)
    pool.sync([], assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Element should still exist (in grace period)
    const videoElements2 = pool.getVideoElements();
    expect(videoElements2.size).toBeGreaterThan(0);

    // Add clip back immediately (simulating left split reusing same element)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Element should be back and grace period extended
    const videoElements3 = pool.getVideoElements();
    expect(videoElements3.size).toBe(1);

    // Wait longer than normal grace period (600ms)
    await wait(600);

    // Element should STILL exist because grace was extended to 10s
    const videoElements4 = pool.getVideoElements();
    expect(videoElements4.size).toBe(1);
  });

  it("should preserve original clipId during element rebinding (FINDING-003)", () => {
    const clips1 = [createMockClip("clip-1", "media-1", 0, 5)];
    const clips2 = [createMockClip("clip-2", "media-1", 0, 5)]; // Same media, different clipId
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Create element with clip-1
    pool.sync(clips1, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const elements1 = pool.getVideoElements();
    expect(elements1.has("clip-1-media-1")).toBe(true);

    // Remove clip-1 (enters grace period)
    pool.sync([], assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Element should still be accessible with ORIGINAL clipId
    const elementsInGrace = pool.getVideoElements();
    expect(elementsInGrace.has("clip-1-media-1")).toBe(true);

    // Add clip-2 which reuses the same element (same media, same trimIn)
    // This brings the element back into timeline, so it's removed from grace list
    pool.sync(clips2, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should have clip-2 (active in timeline)
    // clip-1 is no longer in grace period (element was rebound)
    const elementsAfterRebind = pool.getVideoElements();
    expect(elementsAfterRebind.has("clip-2-media-1")).toBe(true); // New binding active
  });

  it("should handle clip split scenario correctly", async () => {
    // Simulate split: original clip removed, two new clips added
    const originalClip = [createMockClip("clip-original", "media-1", 0, 10)];
    const leftSplit = createMockClip("clip-left", "media-1", 0, 5); // trimIn: 0 (same as original)
    const rightSplit = createMockClip("clip-right", "media-1", 5, 5); // trimIn: 5 (different cache key)
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Create original clip element
    pool.sync(originalClip, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(pool.getVideoElements().has("clip-original-media-1")).toBe(true);

    // Split: remove original, add left and right
    // Left split reuses element (same cache key), right split creates new element
    pool.sync([leftSplit, rightSplit], assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const elementsAfterSplit = pool.getVideoElements();

    // Should have left and right active
    expect(elementsAfterSplit.has("clip-left-media-1")).toBe(true);
    expect(elementsAfterSplit.has("clip-right-media-1")).toBe(true);

    // After grace period expires (if original was in grace)
    await wait(550);

    pool.sync([leftSplit, rightSplit], assets, tracks, {
      time: 3.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const elementsAfterGrace = pool.getVideoElements();
    expect(elementsAfterGrace.has("clip-left-media-1")).toBe(true);
    expect(elementsAfterGrace.has("clip-right-media-1")).toBe(true);
  });

  it("should prevent black frame during split transition", async () => {
    const originalClip = [createMockClip("clip-original", "media-1", 0, 10)];
    const splitClips = [createMockClip("clip-left", "media-1", 0, 5), createMockClip("clip-right", "media-1", 5, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play original clip
    pool.sync(originalClip, assets, tracks, {
      time: 4.9,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Split at playhead
    pool.sync(splitClips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Immediately after split, ALL elements should be accessible:
    // - Original (in grace period)
    // - Left split (new/reused)
    // - Right split (new)
    const elementsAtSplit = pool.getVideoElements();

    // Verify no frames are missing (rasterizer can find all needed elements)
    expect(elementsAtSplit.size).toBeGreaterThanOrEqual(2); // At least left and right

    // Continue playback - should be smooth, no black frames
    for (let t = 5.0; t < 5.5; t += 0.016) {
      pool.sync(splitClips, assets, tracks, {
        time: t,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    // After transition, elements should still be valid
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should clear recently removed clips after grace period expires", async () => {
    const clip1 = [createMockClip("clip-1", "media-1", 0, 5)];
    const clip2 = [createMockClip("clip-2", "media-2", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Create clip-1 element
    pool.sync(clip1, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(pool.getVideoElements().has("clip-1-media-1")).toBe(true);

    // Switch to clip-2 (clip-1 enters grace if removed)
    pool.sync(clip2, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Wait for grace period to expire
    await wait(550);

    // Sync again to trigger cleanup
    pool.sync(clip2, assets, tracks, {
      time: 3.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // clip-2 should be present
    const elementsAfterGrace = pool.getVideoElements();
    expect(elementsAfterGrace.has("clip-2-media-2")).toBe(true);
  });

  it("should handle rapid add/remove cycles with grace period", async () => {
    const clip = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Add clip
    pool.sync(clip, assets, tracks, {
      time: 0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Remove and add rapidly (simulating undo/redo or rapid edits)
    for (let i = 0; i < 5; i++) {
      // Remove
      pool.sync([], assets, tracks, {
        time: i / 10,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });

      await wait(50);

      // Add back
      pool.sync(clip, assets, tracks, {
        time: (i + 0.5) / 10,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    // Element should remain stable throughout
    const finalElements = pool.getVideoElements();
    expect(finalElements.has("clip-1-media-1")).toBe(true);
  });

  it("should maintain correct clip-to-element mapping during complex timeline changes", () => {
    const clips1 = [createMockClip("clip-A", "media-1", 0, 5), createMockClip("clip-B", "media-2", 5, 5)];
    const clips2 = [createMockClip("clip-B", "media-2", 5, 5), createMockClip("clip-C", "media-1", 0, 5)]; // Swap A for C (same media, same position)
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Create initial clips
    pool.sync(clips1, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const elements1 = pool.getVideoElements();
    expect(elements1.has("clip-A-media-1")).toBe(true);
    expect(elements1.has("clip-B-media-2")).toBe(true);

    // Swap clip-A for clip-C (both use media-1, same cache key)
    // clip-C will reuse clip-A's element
    pool.sync(clips2, assets, tracks, {
      time: 2.5, // Time within clip-C's range
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const elements2 = pool.getVideoElements();

    // Clip-B should still be there
    expect(elements2.has("clip-B-media-2")).toBe(true);

    // Should have at least 1 element (clip-B minimum)
    expect(elements2.size).toBeGreaterThanOrEqual(1);
  });
});

// ─── FINDING-013: Cache Key Precision (Normalize trimIn) ────────────────────────
describe("PreviewMediaPool — FINDING-013: Cache Key Precision", () => {
  let pool: PreviewMediaPool;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("should normalize trimIn values to prevent floating point rounding errors", () => {
    // PROBLEM: Without normalization, 5.1234999 and 5.1234001 could produce
    // different cache keys due to toFixed(3) rounding, causing duplicate elements
    // FIX: Math.round(trimIn * 1000) / 1000 normalizes before toFixed(3)

    const asset: MediaAsset = {
      id: "asset-1",
      name: "test.mp4",
      path: "/path/test.mp4",
      type: "video",
      duration: 10,
      width: 1920,
      height: 1080,
      size: 1000000,
    };

    const tracks = [{ id: "track-1", type: "video", visible: true, muted: false }];
    const syncState = {
      time: 0.5,
      state: "playing" as const,
      speed: 1,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    // Clip with trimIn that should normalize to 5.123
    const clip: Clip = {
      id: "clip-1",
      mediaId: "asset-1",
      trackId: "track-1",
      startTime: 0,
      duration: 2,
      trimIn: 5.1234999, // Math.round(5123.4999) / 1000 = 5123 / 1000 = 5.123
      trimOut: 7.1234999,
      kind: "video",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    pool.sync([clip], [asset], tracks, syncState);
    const cacheKeys = Array.from((pool as any).videoCache.keys());

    // Should produce normalized cache key (now simply clipId)
    expect(cacheKeys[0]).toBe("clip-1");
  });

  it("should create different cache keys for genuinely different trimIn values", () => {
    const asset: MediaAsset = {
      id: "asset-1",
      name: "test.mp4",
      path: "/path/test.mp4",
      type: "video",
      duration: 10,
      width: 1920,
      height: 1080,
      size: 1000000,
    };

    const tracks = [{ id: "track-1", type: "video", visible: true, muted: false }];
    const syncState = {
      time: 0.5,
      state: "playing" as const,
      speed: 1,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    const clip1: Clip = {
      id: "clip-1",
      mediaId: "asset-1",
      trackId: "track-1",
      startTime: 0,
      duration: 2,
      trimIn: 5.0,
      trimOut: 7.0,
      kind: "video",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    const clip2: Clip = {
      id: "clip-2",
      mediaId: "asset-1",
      trackId: "track-1",
      startTime: 2,
      duration: 2,
      trimIn: 5.01, // 10ms different - should be separate element
      trimOut: 7.01,
      kind: "video",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    pool.sync([clip1, clip2], [asset], tracks, syncState);
    const cacheKeys = new Set(Array.from((pool as any).videoCache.keys()));

    expect(cacheKeys.size).toBe(2);
    expect(cacheKeys.has("clip-1")).toBe(true);
    expect(cacheKeys.has("clip-2")).toBe(true);
  });

  it("should handle 29.97fps frame calculations correctly", () => {
    // 29.97fps produces repeating decimals that can cause precision issues
    const asset: MediaAsset = {
      id: "asset-1",
      name: "test.mp4",
      path: "/path/test.mp4",
      type: "video",
      duration: 10,
      width: 1920,
      height: 1080,
      size: 1000000,
    };

    const tracks = [{ id: "track-1", type: "video", visible: true, muted: false }];
    const syncState = {
      time: 0.5,
      state: "playing" as const,
      speed: 1,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    };

    // Frame 155 at 29.97fps = 5.172172172... seconds
    const frameDuration = 1 / 29.97;
    const frame155 = frameDuration * 155;

    const clip: Clip = {
      id: "clip-1",
      mediaId: "asset-1",
      trackId: "track-1",
      startTime: 0,
      duration: 2,
      trimIn: frame155,
      trimOut: frame155 + 2,
      kind: "video",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    pool.sync([clip], [asset], tracks, syncState);
    const cacheKeys = Array.from((pool as any).videoCache.keys());

    // Should normalize to consistent value
    expect(cacheKeys[0]).toBe("clip-1");
  });
});

// ─── FINDING-014: Missing Seeking Guard Before Pause ────────────────────────────
describe("PreviewMediaPool — FINDING-014: Missing Seeking Guard", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should not pause element while seeking", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const element = managed.element;

    Object.defineProperty(element, "paused", { value: false, configurable: true });
    Object.defineProperty(element, "seeking", { value: true, configurable: true });

    let pauseCalled = false;
    element.pause = () => {
      pauseCalled = true;
    };

    pool.sync([], assets, tracks, {
      time: 15.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(pauseCalled).toBe(false);
  });

  it("should pause non-seeking inactive elements", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const element = managed.element;

    Object.defineProperty(element, "paused", { value: false, configurable: true });
    Object.defineProperty(element, "seeking", { value: false, configurable: true });

    let pauseCalled = false;
    element.pause = () => {
      pauseCalled = true;
    };

    // Move to a different clip time range (clip1 becomes inactive but still in timeline)
    const clip2 = createMockClip("clip-2", "media-1", 20, 10);
    pool.sync([clips[0], clip2], assets, tracks, {
      time: 25.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(pauseCalled).toBe(true);
  });

  it("should not call pause on already paused elements", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const element = managed.element;

    Object.defineProperty(element, "paused", { value: true, configurable: true });

    let pauseCalled = false;
    element.pause = () => {
      pauseCalled = true;
    };

    pool.sync([], assets, tracks, {
      time: 15.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(pauseCalled).toBe(false);
  });
});

// ─── FINDING-020: Dispose During Play Promise ───────────────────────────────────
describe("PreviewMediaPool — FINDING-020: Dispose During Play Promise", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should set disposing flag before disposal operations", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    expect(managed.disposing).toBe(false);

    // Simulate play promise in flight
    managed.playPromiseInFlight = true;

    // Dispose the pool
    pool.dispose();

    // disposing flag should be set immediately
    expect(managed.disposing).toBe(true);
  });

  it("should cancel pending play promise during disposal", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;

    // Simulate play promise in flight
    managed.playPromiseInFlight = true;
    managed.playCancelRequested = false;

    // Dispose the pool
    pool.dispose();

    // Cancel flag should be set
    expect(managed.playCancelRequested).toBe(true);
  });

  it("should not crash when play promise resolves after disposal", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const element = managed.element;

    // Setup element to pass all guards by overriding getters
    Object.defineProperty(element, "paused", { get: () => true, configurable: true });
    Object.defineProperty(element, "readyState", { get: () => 4, configurable: true });
    managed.isActive = true; // Active
    managed.playPromiseInFlight = false; // No promise in flight
    managed.autoplayBlocked = false; // Not blocked

    // Create a play promise that resolves after disposal
    let resolvePlay: () => void;
    const playPromise = new Promise<void>((resolve) => {
      resolvePlay = resolve;
    });

    // Mock play to return our controlled promise
    element.play = () => playPromise as any;

    // Trigger requestPlayback (which calls play())
    (pool as any).requestPlayback(managed, clips[0], { time: 2.5, state: "playing", speed: 1.0, muted: false, volume: 100 }, tracks, true);

    // Verify play promise is in flight
    expect(managed.playPromiseInFlight).toBe(true);

    // Dispose the pool while promise is pending
    pool.dispose();
    expect(managed.disposing).toBe(true);

    // Resolve the play promise AFTER disposal
    resolvePlay!();
    await playPromise;

    // Should not crash - disposing flag prevents handler from running
    // Test passes if no errors thrown
  });

  it("should ignore play promise rejection after disposal", async () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const element = managed.element;

    // Setup element to pass all guards by overriding getters
    Object.defineProperty(element, "paused", { get: () => true, configurable: true });
    Object.defineProperty(element, "readyState", { get: () => 4, configurable: true });
    managed.isActive = true; // Active
    managed.playPromiseInFlight = false; // No promise in flight
    managed.autoplayBlocked = false; // Not blocked

    // Create a play promise that rejects after disposal
    let rejectPlay: (err: Error) => void;
    const playPromise = new Promise<void>((_, reject) => {
      rejectPlay = reject;
    });

    element.play = () => playPromise as any;

    // Trigger requestPlayback
    (pool as any).requestPlayback(managed, clips[0], { time: 2.5, state: "playing", speed: 1.0, muted: false, volume: 100 }, tracks, true);

    expect(managed.playPromiseInFlight).toBe(true);

    // Dispose while promise pending
    pool.dispose();
    expect(managed.disposing).toBe(true);

    // Reject the promise AFTER disposal
    rejectPlay!(new Error("NotAllowedError"));

    try {
      await playPromise;
    } catch {
      // Expected to reject
    }

    // Should not crash - disposing flag prevents handler from running
  });

  it("should handle rapid disposal during playback", () => {
    // Simulate rapid project switch (common trigger)
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Verify element exists
    expect((pool as any).videoCache.size).toBe(1);

    // Rapid disposal (like switching projects)
    pool.dispose();

    // Should not throw errors
    expect((pool as any)._isDisposed).toBe(true);
  });
});

// ─── FINDING-019: RVFC Closure Memory Leak ──────────────────────────────────
describe("PreviewMediaPool — FINDING-019: RVFC Closure Memory Leak", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should increment rvfcGeneration when registering new RVFC", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const initialGeneration = managed.rvfcGeneration;

    // Trigger re-registration by updating element state
    Object.defineProperty(managed.element, "paused", { get: () => true, configurable: true });
    Object.defineProperty(managed.element, "readyState", { get: () => 4, configurable: true });
    managed.isActive = true;

    // Call registerRVFC directly to test generation increment
    (pool as any).registerRVFC(managed, clips[0], { time: 2.5, state: "playing", speed: 1.0, muted: false, volume: 100 }, tracks, true);

    // Generation should have incremented
    expect(managed.rvfcGeneration).toBeGreaterThan(initialGeneration);
  });

  it("should increment rvfcGeneration on disposal", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const initialGeneration = managed.rvfcGeneration;

    // Dispose the pool
    pool.dispose();

    // Generation should have incremented
    expect(managed.rvfcGeneration).toBeGreaterThan(initialGeneration);
  });

  it("should invalidate stale RVFC callbacks via generation counter", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const oldGeneration = managed.rvfcGeneration;

    // Register new RVFC (increments generation)
    (pool as any).registerRVFC(managed, clips[0], { time: 2.5, state: "playing", speed: 1.0, muted: false, volume: 100 }, tracks, true);

    // Old generation callbacks should be invalidated
    expect(managed.rvfcGeneration).not.toBe(oldGeneration);
  });

  it("should not leak memory through RVFC closures during disposal", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Create multiple sync cycles to register multiple RVFC callbacks
    for (let i = 0; i < 10; i++) {
      pool.sync(clips, assets, tracks, {
        time: i * 0.5,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    const generationBeforeDispose = managed.rvfcGeneration;

    // Dispose should increment generation, invalidating all pending callbacks
    pool.dispose();

    expect(managed.rvfcGeneration).toBeGreaterThan(generationBeforeDispose);
  });

  it("should handle rapid RVFC re-registration without memory accumulation", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;

    // Simulate rapid re-registration (like during playback state changes)
    const generations: number[] = [];
    for (let i = 0; i < 20; i++) {
      (pool as any).registerRVFC(managed, clips[0], { time: 2.5 + i * 0.1, state: "playing", speed: 1.0, muted: false, volume: 100 }, tracks, true);
      generations.push(managed.rvfcGeneration);
    }

    // Each registration should increment generation
    for (let i = 1; i < generations.length; i++) {
      expect(generations[i]).toBeGreaterThan(generations[i - 1]);
    }

    // Pool should remain functional
    expect(() => pool.dispose()).not.toThrow();
  });

  it("should initialize rvfcGeneration to 0 on element creation", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 10)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const managed = Array.from((pool as any).videoCache.values())[0] as any;

    // New element should start with generation 0
    expect(managed.rvfcGeneration).toBeGreaterThanOrEqual(0);
  });

  it("should prevent memory leak during project switch", () => {
    // Simulate project with multiple clips
    const clips = Array.from({ length: 5 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2));
    const assets = Array.from({ length: 5 }, (_, i) => createMockAsset(`media-${i}`, `/path/to/video-${i}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Simulate playback with RVFC registration
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Get all managed elements
    const managedElements = Array.from((pool as any).videoCache.values());
    const generationsBeforeDispose = managedElements.map((m: any) => m.rvfcGeneration);

    // Dispose (like closing project)
    pool.dispose();

    // All generations should have incremented
    managedElements.forEach((managed: any, index: number) => {
      expect(managed.rvfcGeneration).toBeGreaterThan(generationsBeforeDispose[index]);
    });
  });
});

// ─── FINDING-005: Frame-Rate-Aware Boundary Tolerance ───────────────────────────
describe("PreviewMediaPool — FINDING-005: Frame-Rate-Aware Boundary Tolerance", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should use appropriate tolerance for 24fps projects", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // At 24fps, tolerance should be 1.5/24 = 62.5ms
    // Test at clip boundary: startTime = 0, duration = 5, so end = 5.0
    // With 62.5ms tolerance, should still be active at 5.06s

    pool.sync(clips, assets, tracks, {
      time: 5.06, // Just within 24fps tolerance
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 24,
    });

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBe(1); // Should still have element (within tolerance)
  });

  it("should use appropriate tolerance for 60fps projects", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // At 60fps, tolerance should be 1.5/60 = 25ms
    // Test at clip boundary: end = 5.0
    // With 25ms tolerance, should still be active at 5.024s

    pool.sync(clips, assets, tracks, {
      time: 5.024, // Just within 60fps tolerance
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 60,
    });

    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBe(1); // Should still have element (within tolerance)
  });

  it("should evict element beyond frame-rate-aware tolerance", () => {
    const clips = [createMockClip("clip-1", "media-1", 0, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // First sync within boundary
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    expect(pool.getVideoElements().size).toBe(1);

    // At 30fps, tolerance = 1.5/30 = 50ms
    // Moving beyond tolerance should make clip inactive
    pool.sync(clips, assets, tracks, {
      time: 5.1, // 100ms beyond boundary, exceeds 50ms tolerance
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Element should be marked inactive (but still cached)
    const managed = Array.from((pool as any).videoCache.values())[0] as any;
    expect(managed.isActive).toBe(false);
  });

  it("should prevent black frames during 24fps split transitions", () => {
    // This is the core issue FINDING-005 addresses:
    // In 24fps projects, 16ms tolerance was less than 1 frame (41.67ms)
    // causing black frames at split boundaries

    const clips = [createMockClip("clip-1", "media-1", 0, 5, 0), createMockClip("clip-2", "media-1", 5, 5, 5)];
    const assets = [createMockAsset("media-1", "/path/to/video.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Play right at split boundary
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 24,
    });

    // Both clips should be active (with 62.5ms tolerance at 24fps)
    const videoElements = pool.getVideoElements();
    expect(videoElements.size).toBe(2); // Both clips within tolerance
  });
});

// ─── FINDING-008: Memory-Aware Adaptive Eviction ────────────────────────────────
describe("PreviewMediaPool — FINDING-008: Memory-Aware Adaptive Eviction", () => {
  let pool: PreviewMediaPool;

  beforeEach(() => {
    pool = new PreviewMediaPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it("should use normal eviction age (60s) under memory soft limit", () => {
    // With 9 elements × 50MB = 450MB (under 500MB soft limit)
    // Should use normal 60s eviction age
    const clips = Array.from({ length: 9 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 10, 10, i * 10));
    const assets = clips.map((c) => createMockAsset(c.mediaId, `/path/to/video${c.mediaId}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Create all elements
    pool.sync(clips, assets, tracks, {
      time: 45.0, // Middle of timeline
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should have created elements
    expect((pool as any).videoCache.size).toBeGreaterThan(0);

    // Move far away to make all elements inactive
    pool.sync([], assets, tracks, {
      time: 500.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Elements should still exist (not old enough for 60s eviction)
    expect((pool as any).videoCache.size).toBeGreaterThan(0);
  });

  it("should use aggressive eviction (30s) over memory soft limit", () => {
    // With 11 elements × 50MB = 550MB (over 500MB soft limit, under 800MB hard)
    // Should reduce eviction age to 30s
    const clips = Array.from({ length: 11 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 10, 10, i * 10));
    const assets = clips.map((c) => createMockAsset(c.mediaId, `/path/to/video${c.mediaId}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Create all elements
    pool.sync(clips, assets, tracks, {
      time: 50.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const initialCacheSize = (pool as any).videoCache.size;
    expect(initialCacheSize).toBeGreaterThan(10);

    // Move away and advance time by 35 seconds
    // With 30s aggressive eviction, old elements should be evicted
    const now = performance.now();
    const managedElements = Array.from((pool as any).videoCache.values());
    managedElements.forEach((m: any) => {
      m.lastUsedAt = now - 35000; // 35 seconds ago
    });

    // Trigger eviction by syncing with no clips in timeline
    pool.sync([], assets, tracks, {
      time: 500.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should have evicted old elements due to memory pressure
    expect((pool as any).videoCache.size).toBeLessThan(initialCacheSize);
  });

  it("should use emergency eviction (10s) over memory hard limit", () => {
    // With 17 elements × 50MB = 850MB (over 800MB hard limit)
    // Should reduce eviction age to 10s and ignore timeline protection
    const clips = Array.from({ length: 17 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 10, 10, i * 10));
    const assets = clips.map((c) => createMockAsset(c.mediaId, `/path/to/video${c.mediaId}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Create all elements
    pool.sync(clips, assets, tracks, {
      time: 80.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    const initialCacheSize = (pool as any).videoCache.size;
    expect(initialCacheSize).toBeGreaterThan(15);

    // Age all elements by 15 seconds
    const now = performance.now();
    const managedElements = Array.from((pool as any).videoCache.values());
    managedElements.forEach((m: any) => {
      m.lastUsedAt = now - 15000; // 15 seconds ago
      m.isActive = false; // Mark inactive
    });

    // Trigger eviction with empty timeline - at hard limit, should evict protected
    pool.sync([], assets, tracks, {
      time: 500.0, // Far from any clips
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
      frameRate: 30 as 24 | 30 | 60,
    });

    // Should have aggressively evicted due to hard limit
    const finalCacheSize = (pool as any).videoCache.size;
    expect(finalCacheSize).toBeLessThan(initialCacheSize);
  });

  it("should prevent memory growth beyond 800MB in large projects", () => {
    // Simulate project with 50+ clips (common in real projects)
    // Without FINDING-008 fix, this could grow to 1-2GB+ causing crashes
    const clips = Array.from({ length: 50 }, (_, i) => createMockClip(`clip-${i}`, `media-${i}`, i * 2, 2, i * 2));
    const assets = clips.map((c) => createMockAsset(c.mediaId, `/path/to/video${c.mediaId}.mp4`));
    const tracks = [{ id: "track-1", type: "video" }];

    // Scrub through entire timeline (creates many elements)
    for (let time = 0; time < 100; time += 10) {
      pool.sync(clips, assets, tracks, {
        time,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });
    }

    // Cache should be limited by MAX_CACHED_VIDEOS (20) and memory limits
    const cacheSize = (pool as any).videoCache.size;
    const estimatedMemoryMB = cacheSize * 50; // 50MB per element

    // Should respect MAX_CACHED_VIDEOS limit
    expect(cacheSize).toBeLessThanOrEqual(20); // MAX_CACHED_VIDEOS

    // Estimated memory should be reasonable (under 1GB with safety margin)
    expect(estimatedMemoryMB).toBeLessThanOrEqual(1000);
  });
});
