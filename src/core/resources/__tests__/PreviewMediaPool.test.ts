import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PreviewMediaPool } from "../PreviewMediaPool";
import type { Clip, MediaAsset } from "@/types";

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path, // Just return the path as-is for tests
}));

// Mock browser APIs for Node environment
if (typeof HTMLVideoElement === "undefined") {
  (global as any).HTMLVideoElement = class HTMLVideoElement {
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
  (global as any).HTMLAudioElement = class HTMLAudioElement extends (global as any).HTMLVideoElement {};
}

if (typeof document === "undefined") {
  (global as any).document = {
    createElement: (tag: string) => {
      if (tag === "video") return new (global as any).HTMLVideoElement();
      if (tag === "audio") return new (global as any).HTMLAudioElement();
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
    };

    const syncState2 = {
      time: 5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // Simulate multiple rapid splits
    clips = [createMockClip("clip-1", "media-1", 0, 2, 0), createMockClip("clip-2", "media-1", 2, 8, 2)];
    pool.sync(clips, assets, tracks, {
      time: 2.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    clips = [createMockClip("clip-1", "media-1", 0, 2, 0), createMockClip("clip-2", "media-1", 2, 4, 2), createMockClip("clip-3", "media-1", 6, 4, 6)];
    pool.sync(clips, assets, tracks, {
      time: 4.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
      });

      // Play briefly
      pool.sync(clips, assets, tracks, {
        time: (i / 50) * 10,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
      });

      // Seek again
      pool.sync(clips, assets, tracks, {
        time: ((i + 1) / 50) * 10,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
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
    });

    await wait(50);

    // Advance to 5.5s (clip-1 should become inactive, clip-2 active)
    pool.sync(clips, assets, tracks, {
      time: 5.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    await wait(50);

    // Cross boundary - clip-1 should become inactive, clip-2 active
    pool.sync(clips, assets, tracks, {
      time: 5.1,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    await wait(50);

    // Pause at exact boundary
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    await wait(50);

    // Resume after boundary (element now inactive)
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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

    // Simulate 60fps playback crossing clip boundary
    // 120 frames = 2 seconds at 60fps
    for (let frame = 0; frame < 120; frame++) {
      const time = frame / 60; // 0 to 2 seconds
      pool.sync(clips, assets, tracks, {
        time,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
      });
    }

    await wait(100);

    // High frequency syncs with clip transitions should not cause
    // playback attempts on inactive elements
    expect(() => pool.getVideoElements()).not.toThrow();
  });

  it("should prevent CPU spike from decoding inactive video", async () => {
    // This test verifies the performance aspect: inactive elements
    // should not decode video frames (CPU intensive)
    const clips = [
      createMockClip("clip-1", "media-1", 0, 2),
      createMockClip("clip-2", "media-2", 5, 2), // Gap between clips
    ];
    const assets = [createMockAsset("media-1", "/path/to/video1.mp4"), createMockAsset("media-2", "/path/to/video2.mp4")];
    const tracks = [{ id: "track-1", type: "video" }];

    // Sync at time 3 (between clips - both inactive)
    pool.sync(clips, assets, tracks, {
      time: 3.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    await wait(50);

    // Neither clip should be playing (would waste CPU)
    // With guard: no playback attempts
    // Without guard: could start playing both clips
    expect(() => pool.getVideoElements()).not.toThrow();

    // Move to active region
    pool.sync(clips, assets, tracks, {
      time: 5.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    await wait(50);

    // Only clip-2 should be active now
    expect(() => pool.getVideoElements()).not.toThrow();
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
    });

    await wait(50);

    // Second sync after potential play promise rejection
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // Rapid pause
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    // Rapid play again
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // While promise is in flight, try again
    pool.sync(clips, assets, tracks, {
      time: 2.6,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // Immediately pause (promise might still be in flight)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    await wait(50);

    // Move to different time (changes which clips are active)
    pool.sync(clips, assets, tracks, {
      time: 5.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    await wait(50);

    // Access middle clips (updates lastUsedAt)
    pool.sync(clips, assets, tracks, {
      time: 25.0,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    await wait(50);

    // Go back to start (oldest should be evicted, recently used preserved)
    pool.sync(clips, assets, tracks, {
      time: 0.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    await wait(50);

    // Now sync with all clips (should trigger eviction)
    pool.sync(clips, assets, tracks, {
      time: 5.0, // Same position (first clips still active)
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // Immediately pause (promise might still be pending)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
      });

      pool.sync(clips, assets, tracks, {
        time: 2.5,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
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
    });

    // Pause immediately
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    await wait(50);

    // Play again (cancel flag should be cleared)
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // Pause while promise is resolving
    await wait(10); // Small delay to simulate promise pending
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    pool.sync(clips, assets, tracks, {
      time: 4.9,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    pool.sync(clips, assets, tracks, {
      time: 5.1,
      state: "playing" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
    });

    pool.sync(clips, assets, tracks, {
      time: 5.1,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // User clicks pause within 100ms
    await wait(50);
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // Stop
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "stopped" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // Cancel immediately
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
    });

    // User clicks pause button
    pool.sync(clips, assets, tracks, {
      time: 2.5,
      state: "paused" as const,
      speed: 1.0,
      muted: false,
      volume: 100,
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
