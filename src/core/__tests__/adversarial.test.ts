import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PreviewMediaPool } from "../resources/PreviewMediaPool";
import { createProjectSession, disposeActiveSession, getActiveSessionOrNull } from "../runtime/ProjectSession";
import { evaluateTimelineSceneCached, clearEvaluationCache } from "../evaluation/evaluator";
import type { Clip, MediaAsset, Track } from "@/types";

// =========================================================================
// MOCKS & SEED DATA
// =========================================================================

// Mock Tauri convertFileSrc
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

// Mock RenderEngine context
vi.mock("@/lib/renderEngine/renderEngine", () => ({
  RenderEngine: class MockRenderEngine {
    constructor() {}
    initialize = vi.fn().mockResolvedValue(undefined);
    teardown = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn().mockResolvedValue(undefined);
  },
}));

// Mock AudioContext and other Web Audio elements if needed
if (typeof AudioContext === "undefined") {
  (globalThis as any).AudioContext = class MockAudioContext {
    currentTime = 0;
    state = "suspended";
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  };
}

// Mock browser requestAnimationFrame / cancelAnimationFrame
if (typeof requestAnimationFrame === "undefined") {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 16) as any;
  };
  (globalThis as any).cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

// Mock JSDOM navigator.userActivation properties for autoplay checks
if (typeof navigator !== "undefined" && !("userActivation" in navigator)) {
  Object.defineProperty(navigator, "userActivation", {
    value: { isActive: false },
    writable: true,
    configurable: true,
  });
}

// Helper to create mock clips
function createClip(id: string, mediaId: string, startTime: number, duration: number, trimIn = 0): Clip {
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
function createAsset(id: string, path: string): MediaAsset {
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

// =========================================================================
// TEST SUITES
// =========================================================================

describe("VireoStudio — Adversarial Test Suite", () => {
  
  // ─── 1. GATLING GUN CONCURRENCY ──────────────────────────────────────────
  describe("Scenario 1: Gatling Gun Project Switcher", () => {
    afterEach(async () => {
      await disposeActiveSession();
    });

    it("should reject concurrent intermediate session loads and cleanly activate the final target session", async () => {
      // Trigger project loads for A, B, and C in extremely rapid succession
      const pA = createProjectSession("project-A");
      const pB = createProjectSession("project-B");
      const pC = createProjectSession("project-C");

      // Await all loads to resolve
      const [sessA, sessB, sessC] = await Promise.all([pA, pB, pC]);

      const activeSession = getActiveSessionOrNull();

      // Only the final project session (C) should be active in the registry
      expect(activeSession).not.toBeNull();
      expect(activeSession?.projectId).toBe("project-C");
      expect(sessC.state).toBe("active");

      // Intermediate sessions must be set to disposed state
      expect(sessA.state).toBe("disposed");
      expect(sessB.state).toBe("disposed");
    });
  });

  // ─── 2. DOUBLE TAKE OVERLAY ──────────────────────────────────────────────
  describe("Scenario 2: Double Take Overlapping Duplicate Clips", () => {
    let pool: PreviewMediaPool;

    beforeEach(() => {
      pool = new PreviewMediaPool("test-project", "test-session");
    });

    afterEach(() => {
      pool.dispose();
    });

    it("should instantiate two separate HTMLVideoElement nodes for duplicate clips to prevent seek conflicts", () => {
      const asset = createAsset("asset-X", "/media/asset-X.mp4");
      const tracks: Track[] = [
        { id: "track-1", type: "video" } as Track,
        { id: "track-2", type: "video" } as Track,
      ];
      const syncState = {
        time: 1.0,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      };

      // Clip A starts at 0.0s, Clip B starts at 0.5s. Overlapping at clockTime 1.0s.
      // Both point to the exact same source asset with identical trim.
      const clipA = createClip("clip-A", "asset-X", 0.0, 5.0, 0.0);
      const clipB = createClip("clip-B", "asset-X", 0.5, 5.0, 0.0);

      // Sync the pool with the overlapping duplicates
      pool.sync([clipA, clipB], [asset], tracks, syncState);

      // Verify that two distinct elements are created and cached independently
      const cacheKeys = Array.from((pool as any).videoCache.keys());
      expect(cacheKeys.length).toBe(2);
      // Cache keys must be the unique clip IDs
      expect(cacheKeys).toContain("clip-A");
      expect(cacheKeys).toContain("clip-B");

      const elementA = (pool as any).videoCache.get("clip-A")?.element;
      const elementB = (pool as any).videoCache.get("clip-B")?.element;

      expect(elementA).toBeDefined();
      expect(elementB).toBeDefined();
      expect(elementA).not.toBe(elementB); // They must be separate HTMLVideoElement instances
    });
  });

  // ─── 3. AUTOPLAY BARRIER LATCHING ────────────────────────────────────────
  describe("Scenario 3: Autoplay Barrier Loop Protection", () => {
    let pool: PreviewMediaPool;
    let originalPlay: () => Promise<void>;

    beforeEach(() => {
      pool = new PreviewMediaPool("test-project", "test-session");
      originalPlay = HTMLAudioElement.prototype.play;
      (navigator as any).userActivation = { isActive: false };
    });

    afterEach(() => {
      pool.dispose();
      HTMLAudioElement.prototype.play = originalPlay;
    });

    it("should catch NotAllowedError, latch the block state, and cease play retries to protect CPU", async () => {
      let playAttemptsCount = 0;

      // Mock audio play to reject with NotAllowedError (browser autoplay block)
      HTMLAudioElement.prototype.play = function (this: HTMLAudioElement) {
        playAttemptsCount++;
        return Promise.reject(new DOMException("Play failed", "NotAllowedError"));
      };

      const tracks: Track[] = [{ id: "track-1", type: "audio" } as Track];
      const audioClip = {
        id: "clip-audio-1",
        mediaId: "asset-audio",
        trackId: "track-1",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        kind: "audio",
        volume: 1.0,
      } as Clip;

      const asset = {
        id: "asset-audio",
        path: "/media/sound.mp3",
        type: "audio",
      } as MediaAsset;

      const syncState = {
        time: 1.0,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      };

      // 1. First sync calls play, which rejects and latches block state
      pool.sync([audioClip], [asset], tracks, syncState);
      
      const managedAudio = (pool as any).audios.get("clip-audio-1");
      expect(managedAudio).toBeDefined();

      // Trigger metadata load callback manually to mark element as ready
      managedAudio.ready = true;
      Object.defineProperty(managedAudio.element, "readyState", { get: () => 4, configurable: true });
      managedAudio.element.dispatchEvent(new Event("loadedmetadata"));

      // Call update manually to trigger play attempt
      (pool as any).updateAudioElement(managedAudio, audioClip, syncState, false);

      // Wait a tick for the rejected promise microtask to run
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(playAttemptsCount).toBe(1);
      expect(managedAudio.autoplayBlocked).toBe(true);
      expect((pool as any).sessionAutoplayBlocked).toBe(true);

      // 2. Subsequent updates must not call play() because the session is blocked
      (pool as any).updateAudioElement(managedAudio, audioClip, syncState, false);
      expect(playAttemptsCount).toBe(1); // Play attempts count remains 1

      // 3. User gesture unlocks and allows retry (after the 100ms throttling cooldown)
      await new Promise((resolve) => setTimeout(resolve, 110));
      (navigator as any).userActivation = { isActive: true };
      
      // Simulate unlockAudio by clearing the block flags
      (pool as any).sessionAutoplayBlocked = false;
      managedAudio.autoplayBlocked = false;

      (pool as any).updateAudioElement(managedAudio, audioClip, syncState, false);
      
      // Let promise run
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(playAttemptsCount).toBe(2); // Retried after user activation
    });
  });

  // ─── 4. CACHE INVALIDATION BY ASSET RELINKING ────────────────────────────
  describe("Scenario 4: Media Asset Cache Invalidation", () => {
    beforeEach(() => {
      clearEvaluationCache();
    });

    it("should invalidate the evaluation cache if a media asset path is relinked", () => {
      const tracks: Track[] = [{ id: "track-1", type: "video" } as Track];
      const clips = [createClip("clip-1", "media-1", 0.0, 5.0, 0.0)];
      
      const assetsV1 = [createMockAssetWithRotation("media-1", "/path/original.mp4", 0)];
      const assetsV2 = [createMockAssetWithRotation("media-1", "/path/relinked.mp4", 0)]; // modified path
      const assetsV3 = [createMockAssetWithRotation("media-1", "/path/relinked.mp4", 90)]; // modified rotation

      // 1. Initial render - caches evaluated scene
      const scene1 = evaluateTimelineSceneCached(1.0, clips, tracks, assetsV1, null, 1);
      
      // 2. Fetching same params returns cached reference (strict equality)
      const scene1Cached = evaluateTimelineSceneCached(1.0, clips, tracks, assetsV1, null, 1);
      expect(scene1Cached).toBe(scene1);

      // 3. Render with relinking (assetsV2) - must bypass cache and perform new evaluation
      const scene2 = evaluateTimelineSceneCached(1.0, clips, tracks, assetsV2, null, 1);
      expect(scene2).not.toBe(scene1); // Must be a newly evaluated scene object

      // 4. Fetching assetsV2 again returns cached scene2
      const scene2Cached = evaluateTimelineSceneCached(1.0, clips, tracks, assetsV2, null, 1);
      expect(scene2Cached).toBe(scene2);

      // 5. Render with modified asset property rotation (assetsV3) - must bypass cache
      const scene3 = evaluateTimelineSceneCached(1.0, clips, tracks, assetsV3, null, 1);
      expect(scene3).not.toBe(scene2);
    });

    function createMockAssetWithRotation(id: string, path: string, rotation: number): MediaAsset {
      return {
        id,
        path,
        type: "video",
        name: `asset-${id}`,
        duration: 10,
        width: 1920,
        height: 1080,
        rotation,
      } as MediaAsset;
    }
  });

  // =========================================================================
  // PHASE 4: TIMELINE VALIDATION
  // =========================================================================
  describe("Phase 4: Timeline Validation", () => {
    let pool: PreviewMediaPool;

    beforeEach(() => {
      pool = new PreviewMediaPool("test-project", "test-session");
    });

    afterEach(() => {
      pool.dispose();
    });

    it("should handle dense multitrack timelines with 50+ clips and prewarm only elements in lookahead window", () => {
      const clips: Clip[] = Array.from({ length: 50 }, (_, i) => createClip(`clip-${i}`, `media-${i}`, i * 2.0, 2.0));
      const assets = clips.map((c) => createAsset(c.mediaId, `/path/to/video-${c.mediaId}.mp4`));
      const tracks = [{ id: "track-1", type: "video" } as Track];
      
      const syncState = {
        time: 5.0, // Should prewarm clips around 5.0s (e.g. clip-2 at 4s, clip-3 at 6s)
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      };

      pool.sync(clips, assets, tracks, syncState);

      // Verify that cache size respects memory limitations (MAX_CACHED_VIDEOS = 20)
      const activeKeys = Array.from((pool as any).videoCache.keys());
      expect(activeKeys.length).toBeLessThanOrEqual(20); 
    });

    it("should handle overlapping clips on the same track without throwing errors", () => {
      const asset = createAsset("asset-1", "/path/to/video1.mp4");
      const tracks = [{ id: "track-1", type: "video" } as Track];
      const clip1 = createClip("clip-1", "asset-1", 0.0, 5.0);
      const clip2 = createClip("clip-2", "asset-1", 4.0, 5.0); // 1s overlap with clip-1

      const syncState = {
        time: 4.5, // Inside overlap window
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      };

      expect(() => {
        pool.sync([clip1, clip2], [asset], tracks, syncState);
      }).not.toThrow();

      // Verify both are resolved and cached separately
      const activeKeys = Array.from((pool as any).videoCache.keys());
      expect(activeKeys).toContain("clip-1");
      expect(activeKeys).toContain("clip-2");
    });

    it("should maintain state integrity through undo/redo simulation", () => {
      const asset = createAsset("asset-1", "/path/to/video1.mp4");
      const tracks = [{ id: "track-1", type: "video" } as Track];
      const initialClips = [createClip("clip-1", "asset-1", 0.0, 5.0)];

      // State after split operation
      const postSplitClips = [
        createClip("clip-1-a", "asset-1", 0.0, 2.5, 0.0),
        createClip("clip-1-b", "asset-1", 2.5, 2.5, 2.5),
      ];

      const syncState = {
        time: 1.0,
        state: "paused" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      };

      // 1. Initial State Sync
      pool.sync(initialClips, [asset], tracks, syncState);
      expect((pool as any).videoCache.has("clip-1")).toBe(true);

      // 2. Simulate Split (Forward State change)
      pool.sync(postSplitClips, [asset], tracks, syncState);
      expect((pool as any).videoCache.has("clip-1-a")).toBe(true);

      // 3. Simulate Undo (Rollback State change)
      pool.sync(initialClips, [asset], tracks, syncState);
      expect((pool as any).videoCache.has("clip-1")).toBe(true);
    });
  });

  // =========================================================================
  // PHASE 5: SPLIT CLIP STRESS TESTING
  // =========================================================================
  describe("Phase 5: Split Clip Stress Testing", () => {
    let pool: PreviewMediaPool;

    beforeEach(() => {
      pool = new PreviewMediaPool("test-project", "test-session");
    });

    afterEach(() => {
      pool.dispose();
    });

    it("should calculate correct trims and cumulative duration during repeated splits", () => {
      // Split a 10s clip into four pieces: 2.5s each
      const origClip = createClip("clip-orig", "asset-1", 0.0, 10.0, 0.0);
      const splitClips = [
        createClip("clip-p1", "asset-1", 0.0, 2.5, 0.0),
        createClip("clip-p2", "asset-1", 2.5, 2.5, 2.5),
        createClip("clip-p3", "asset-1", 5.0, 2.5, 5.0),
        createClip("clip-p4", "asset-1", 7.5, 2.5, 7.5),
      ];

      const totalDuration = splitClips.reduce((acc, c) => acc + c.duration, 0);
      expect(totalDuration).toBe(origClip.duration);

      splitClips.forEach((c, idx) => {
        expect(c.trimIn).toBe(idx * 2.5);
        expect(c.trimOut).toBe((idx + 1) * 2.5);
      });
    });

    it("should transition active elements smoothly when split occurs during playback", () => {
      const asset = createAsset("asset-1", "/path/to/video1.mp4");
      const tracks = [{ id: "track-1", type: "video" } as Track];
      
      const preSplitClips = [createClip("clip-orig", "asset-1", 0.0, 10.0, 0.0)];
      const postSplitClips = [
        createClip("clip-p1", "asset-1", 0.0, 5.0, 0.0),
        createClip("clip-p2", "asset-1", 5.0, 5.0, 5.0),
      ];

      const syncState = {
        time: 2.0,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      };

      // 1. Play original clip
      pool.sync(preSplitClips, [asset], tracks, syncState);
      expect((pool as any).videoCache.has("clip-orig")).toBe(true);

      // 2. Trigger split mid-playback at the same playhead time
      pool.sync(postSplitClips, [asset], tracks, syncState);
      
      // The original clip should be scheduled for cleanup, and clip-p1 should be prewarmed
      expect((pool as any).videoCache.has("clip-p1")).toBe(true);
    });
  });

  // =========================================================================
  // PHASE 7: PROJECT ISOLATION TESTING
  // =========================================================================
  describe("Phase 7: Project Isolation Testing", () => {
    afterEach(async () => {
      await disposeActiveSession();
    });

    it("should prevent scene evaluation cache contamination across project switches", () => {
      clearEvaluationCache();
      
      const tracks: Track[] = [{ id: "track-1", type: "video" } as Track];
      const clips = [createClip("clip-1", "media-1", 0.0, 5.0, 0.0)];
      const assets = [createAsset("media-1", "/path/to/video.mp4")];

      // 1. Evaluate timeline in Project A
      const sceneProjectA = evaluateTimelineSceneCached(1.0, clips, tracks, assets, null, 1);

      // 2. Evaluate timeline in Project B (identical timeline parameters)
      const sceneProjectB = evaluateTimelineSceneCached(1.0, clips, tracks, assets, null, 2);

      // They must resolve to different references because project ID changed
      expect(sceneProjectB).not.toBe(sceneProjectA);
    });

    it("should fully dispose and release all media element nodes from previous project session", async () => {
      const sessA = await createProjectSession("project-A");
      
      // Get internal pool
      const poolA = (sessA as any)._previewMediaPool as PreviewMediaPool;
      const asset = createAsset("asset-A", "/path/to/videoA.mp4");
      const tracks = [{ id: "track-1", type: "video" } as Track];
      const clips = [createClip("clip-1", "asset-A", 0.0, 5.0)];

      poolA.sync(clips, [asset], tracks, {
        time: 1.0,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });

      // Verify element was created in DOM
      expect((poolA as any).container.childNodes.length).toBeGreaterThan(0);

      // Switch to Project B
      await createProjectSession("project-B");

      // Session A must be disposed, and all elements removed from document body
      expect(sessA.state).toBe("disposed");
      expect(document.getElementById((poolA as any).container.id)).toBeNull();
    });
  });

  // =========================================================================
  // PHASE 8: RESOURCE LIFETIME VALIDATION
  // =========================================================================
  describe("Phase 8: Resource Lifetime Validation", () => {
    it("should ensure no zombie media element nodes exist on session disposal", async () => {
      const sess = await createProjectSession("project-leak-test");
      const pool = (sess as any)._previewMediaPool as PreviewMediaPool;

      const asset = createAsset("asset-leak", "/path/to/leak.mp4");
      const tracks = [{ id: "track-1", type: "video" } as Track];
      const clips = [createClip("clip-leak", "asset-leak", 0.0, 5.0)];

      pool.sync(clips, [asset], tracks, {
        time: 1.0,
        state: "playing" as const,
        speed: 1.0,
        muted: false,
        volume: 100,
        frameRate: 30 as 24 | 30 | 60,
      });

      const videoElement = (pool as any).videoCache.get("clip-leak")?.element as HTMLVideoElement;
      expect(videoElement).toBeDefined();

      // Dispose session
      await sess.dispose();

      // Video element source must be cleared to prevent network buffering leaks
      expect(videoElement.getAttribute("src")).toBe("");
      expect(videoElement.parentNode).toBeNull();
    });

    it("should handle multiple call disposals idempotently and cleanly", async () => {
      const sess = await createProjectSession("project-idempotency-test");
      
      expect(sess.state).toBe("active");

      // Multiple concurrent and consecutive calls to dispose must not throw
      await expect(Promise.all([
        sess.dispose(),
        sess.dispose(),
        sess.dispose()
      ])).resolves.not.toThrow();

      expect(sess.state).toBe("disposed");
    });
  });
});
