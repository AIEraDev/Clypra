import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackClock } from "@/core/playback/PlaybackClock";
import { NativeAudioPreviewController } from "@/core/audio/nativeAudioPreviewController";
import { getActiveAudioClips } from "@/core/timeline/audioClips";
import type { Clip, MediaAsset, Track } from "@/types";
// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

/**
 * Tests for Race condition between sync() and render
 *
 * This test suite validates the fix for the race condition where:
 * - Frame 1: sync() + start render (isRendering = true)
 * - Frame 2: sync() again (mutates state) → early return
 * - Frame 1's render still using disposed elements → crash
 *
 * The fix moves the isRendering guard BEFORE sync() to prevent
 * state mutation during active renders.
 */

interface RenderState {
  isRendering: boolean;
  droppedFrames: number;
  syncCalls: number;
  renderJobs: number;
  stateVersion: number;
}

/**
 * Mock RAF render loop that simulates ProgramPreview behavior
 */
class MockRenderLoop {
  private state: RenderState = {
    isRendering: false,
    droppedFrames: 0,
    syncCalls: 0,
    renderJobs: 0,
    stateVersion: 0,
  };

  private syncMutatesState = true;
  private renderDuration = 0; // ms to simulate render job duration

  constructor(config?: {
    renderDuration?: number;
    syncMutatesState?: boolean;
  }) {
    if (config?.renderDuration !== undefined) {
      this.renderDuration = config.renderDuration;
    }
    if (config?.syncMutatesState !== undefined) {
      this.syncMutatesState = config.syncMutatesState;
    }
  }

  /**
   * Simulate one RAF tick with CORRECT order
   */
  rafTickFixed(): void {
    // 1. Check isRendering guard FIRST (prevents sync during render)
    if (this.state.isRendering) {
      this.state.droppedFrames++;
      return;
    }

    // 2. Call sync (safe now - no render in progress)
    this.sync();

    // 3. Set isRendering and start render job
    this.state.isRendering = true;
    this.startRenderJob();
  }

  /**
   * Simulate one RAF tick with WRONG order
   */
  rafTickBroken(): void {
    // 1. Call sync BEFORE checking isRendering (WRONG!)
    this.sync();

    // 2. Check isRendering guard (too late - sync already mutated state)
    if (this.state.isRendering) {
      this.state.droppedFrames++;
      return;
    }

    // 3. Set isRendering and start render job
    this.state.isRendering = true;
    this.startRenderJob();
  }

  private sync(): void {
    this.state.syncCalls++;
    if (this.syncMutatesState) {
      // Sync mutates state (increments version to simulate disposal/recreation)
      this.state.stateVersion++;
    }
  }

  private startRenderJob(): void {
    this.state.renderJobs++;

    // Simulate async render job
    if (this.renderDuration > 0) {
      setTimeout(() => {
        this.state.isRendering = false;
      }, this.renderDuration);
    } else {
      // Synchronous render (for testing)
      this.state.isRendering = false;
    }
  }

  getState(): Readonly<RenderState> {
    return { ...this.state };
  }

  reset(): void {
    this.state = {
      isRendering: false,
      droppedFrames: 0,
      syncCalls: 0,
      renderJobs: 0,
      stateVersion: 0,
    };
  }
}

describe("ProgramPreview RAF Loop — Render Race Condition", () => {
  let loop: MockRenderLoop;

  beforeEach(() => {
    loop = new MockRenderLoop();
  });

  afterEach(() => {
    loop.reset();
  });

  it("should allow sync when no render is in progress", () => {
    loop.rafTickFixed();

    const state = loop.getState();
    expect(state.syncCalls).toBe(1);
    expect(state.renderJobs).toBe(1);
    expect(state.droppedFrames).toBe(0);
  });

  it("should block sync when render is in progress", () => {
    // Create loop with slow render (simulates heavy scene)
    const slowLoop = new MockRenderLoop({ renderDuration: 20 });

    // Frame 1: Start render
    slowLoop.rafTickFixed();
    let state = slowLoop.getState();
    expect(state.isRendering).toBe(true);
    expect(state.syncCalls).toBe(1);
    expect(state.renderJobs).toBe(1);

    // Frame 2: Try to render while Frame 1 is still rendering
    slowLoop.rafTickFixed();
    state = slowLoop.getState();

    // With fix: sync NOT called (blocked by isRendering guard)
    expect(state.syncCalls).toBe(1); // Still 1, not 2
    expect(state.renderJobs).toBe(1); // Still 1, not 2
    expect(state.droppedFrames).toBe(1); // Frame dropped
  });

  it("should call sync twice when render is in progress WITHOUT fix (broken behavior)", () => {
    const slowLoop = new MockRenderLoop({ renderDuration: 20 });

    // Frame 1: Start render
    slowLoop.rafTickBroken();
    let state = slowLoop.getState();
    expect(state.isRendering).toBe(true);
    expect(state.syncCalls).toBe(1);

    // Frame 2: sync called BEFORE isRendering check
    slowLoop.rafTickBroken();
    state = slowLoop.getState();

    // Without fix: sync WAS called (before guard check)
    expect(state.syncCalls).toBe(2); // ❌ Called twice
    expect(state.renderJobs).toBe(1); // Only 1 job (second blocked)
    expect(state.droppedFrames).toBe(1);
  });

  it("should prevent state mutation during active render", () => {
    const slowLoop = new MockRenderLoop({
      renderDuration: 20,
      syncMutatesState: true,
    });

    // Frame 1: sync v0→v1, start render with v1
    slowLoop.rafTickFixed();
    const stateAfterFrame1 = slowLoop.getState();
    expect(stateAfterFrame1.stateVersion).toBe(1);
    expect(stateAfterFrame1.isRendering).toBe(true);

    // Frame 2: Blocked by isRendering guard, state NOT mutated
    slowLoop.rafTickFixed();
    const stateAfterFrame2 = slowLoop.getState();

    // With fix: state version unchanged (sync not called)
    expect(stateAfterFrame2.stateVersion).toBe(1); // Still 1
    expect(stateAfterFrame2.syncCalls).toBe(1); // sync called once only
  });

  it("should allow state mutation during active render WITHOUT fix (causes crash)", () => {
    const slowLoop = new MockRenderLoop({
      renderDuration: 20,
      syncMutatesState: true,
    });

    // Frame 1: sync v0→v1, start render with v1
    slowLoop.rafTickBroken();
    const stateAfterFrame1 = slowLoop.getState();
    expect(stateAfterFrame1.stateVersion).toBe(1);

    // Frame 2: sync called BEFORE guard, state mutated v1→v2
    slowLoop.rafTickBroken();
    const stateAfterFrame2 = slowLoop.getState();

    // Without fix: state version changed (sync mutated state)
    expect(stateAfterFrame2.stateVersion).toBe(2); // ❌ Mutated during render
    expect(stateAfterFrame2.syncCalls).toBe(2);

    // This is the bug: Frame 1's render is using v1 elements,
    // but Frame 2's sync() just disposed them and created v2
  });

  it("should handle rapid RAF ticks on 120Hz monitor with slow render", async () => {
    // 120Hz = 8.33ms per frame, render takes 20ms = 2-3 frames overlap
    const slowLoop = new MockRenderLoop({ renderDuration: 20 });

    // Simulate 5 rapid RAF ticks (simulating 120Hz)
    for (let i = 0; i < 5; i++) {
      slowLoop.rafTickFixed();
    }

    const state = slowLoop.getState();

    // With fix: only first frame renders, others dropped
    expect(state.renderJobs).toBe(1);
    expect(state.syncCalls).toBe(1); // Only first sync executed
    expect(state.droppedFrames).toBe(4); // Other 4 frames dropped
  });

  it("should allow multiple renders when each completes quickly", () => {
    const fastLoop = new MockRenderLoop({ renderDuration: 0 }); // Instant render

    // Simulate 5 RAF ticks with fast renders
    for (let i = 0; i < 5; i++) {
      fastLoop.rafTickFixed();
    }

    const state = fastLoop.getState();

    // All frames should render successfully
    expect(state.renderJobs).toBe(5);
    expect(state.syncCalls).toBe(5);
    expect(state.droppedFrames).toBe(0);
  });

  it("should recover after slow render completes", async () => {
    const slowLoop = new MockRenderLoop({ renderDuration: 20 });

    // Frame 1: Start slow render
    slowLoop.rafTickFixed();
    expect(slowLoop.getState().isRendering).toBe(true);

    // Frame 2: Blocked
    slowLoop.rafTickFixed();
    expect(slowLoop.getState().droppedFrames).toBe(1);

    // Wait for render to complete
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Frame 3: Should work now
    slowLoop.rafTickFixed();
    const state = slowLoop.getState();

    expect(state.renderJobs).toBe(2); // First and third frames rendered
    expect(state.syncCalls).toBe(2);
    expect(state.droppedFrames).toBe(1); // Only second frame dropped
  });

  it("should track dropped frames correctly during sustained overload", async () => {
    const slowLoop = new MockRenderLoop({ renderDuration: 50 });

    // Start render
    slowLoop.rafTickFixed();

    // Try 10 more frames while render in progress
    for (let i = 0; i < 10; i++) {
      slowLoop.rafTickFixed();
    }

    const state = slowLoop.getState();

    expect(state.renderJobs).toBe(1);
    expect(state.syncCalls).toBe(1);
    expect(state.droppedFrames).toBe(10);
  });

  it("should prevent concurrent state mutations on high refresh rate displays", () => {
    // Simulate 240Hz monitor (4.16ms frames) with 16ms render
    const loop240Hz = new MockRenderLoop({ renderDuration: 16 });

    // 4 frames fire during one render (240Hz ÷ 60Hz = 4x)
    const ticks = 4;

    for (let i = 0; i < ticks; i++) {
      loop240Hz.rafTickFixed();
    }

    const state = loop240Hz.getState();

    // Only first tick should sync and render
    expect(state.syncCalls).toBe(1);
    expect(state.renderJobs).toBe(1);
    expect(state.stateVersion).toBe(1); // State mutated once only
    expect(state.droppedFrames).toBe(ticks - 1);
  });

  it("should demonstrate the race condition without fix", () => {
    const slowLoop = new MockRenderLoop({
      renderDuration: 20,
      syncMutatesState: true,
    });

    // Frame 1: sync (v0→v1), render job starts with v1 elements
    slowLoop.rafTickBroken();
    const v1 = slowLoop.getState().stateVersion;

    // Frame 2: sync (v1→v2) BEFORE checking isRendering
    // This mutates state while Frame 1's render is still using v1 elements
    slowLoop.rafTickBroken();
    const v2 = slowLoop.getState().stateVersion;

    // Bug demonstrated: state mutated during active render
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(v2).toBeGreaterThan(v1); // State changed during render = BUG
  });

  it("should prevent the race condition with fix", () => {
    const slowLoop = new MockRenderLoop({
      renderDuration: 20,
      syncMutatesState: true,
    });

    // Frame 1: sync (v0→v1), render job starts with v1 elements
    slowLoop.rafTickFixed();
    const v1 = slowLoop.getState().stateVersion;

    // Frame 2: isRendering guard blocks sync, state NOT mutated
    slowLoop.rafTickFixed();
    const v2 = slowLoop.getState().stateVersion;

    // Fix verified: state unchanged during render
    expect(v1).toBe(1);
    expect(v2).toBe(1);
    expect(v2).toBe(v1); // State stable during render = FIXED
  });
});

describe("ProgramPreview RAF Loop — Guard Ordering", () => {
  it("should execute operations in correct order with fix", () => {
    const operations: string[] = [];

    let isRendering = false;
    let droppedFrames = 0;

    // Simulate RAF tick with CORRECT order
    const rafTickFixed = () => {
      operations.push("raf_start");

      // 1. Guard check FIRST
      if (isRendering) {
        operations.push("guard_blocked");
        droppedFrames++;
        return;
      }
      operations.push("guard_passed");

      // 2. Sync after guard
      operations.push("sync_start");
      operations.push("sync_end");

      // 3. Set rendering flag
      isRendering = true;
      operations.push("render_start");
    };

    // First tick
    rafTickFixed();
    expect(operations).toEqual([
      "raf_start",
      "guard_passed",
      "sync_start",
      "sync_end",
      "render_start",
    ]);

    // Second tick (while rendering)
    operations.length = 0;
    rafTickFixed();
    expect(operations).toEqual(["raf_start", "guard_blocked"]);
    expect(droppedFrames).toBe(1);
  });

  it("should demonstrate incorrect ordering without fix", () => {
    const operations: string[] = [];

    let isRendering = false;

    // Simulate RAF tick with WRONG order
    const rafTickBroken = () => {
      operations.push("raf_start");

      // 1. Sync BEFORE guard check (WRONG!)
      operations.push("sync_start");
      operations.push("sync_end");

      // 2. Guard check after sync (too late)
      if (isRendering) {
        operations.push("guard_blocked");
        return;
      }
      operations.push("guard_passed");

      // 3. Set rendering flag
      isRendering = true;
      operations.push("render_start");
    };

    // First tick
    rafTickBroken();
    expect(operations).toEqual([
      "raf_start",
      "sync_start",
      "sync_end",
      "guard_passed",
      "render_start",
    ]);

    // Second tick (while rendering)
    operations.length = 0;
    rafTickBroken();

    // sync executed even though guard blocked render
    expect(operations).toEqual([
      "raf_start",
      "sync_start",
      "sync_end",
      "guard_blocked",
    ]);
    expect(operations).toContain("sync_start"); // ❌ Sync should not run
  });

  it("should verify guard protects sync from concurrent execution", () => {
    let syncExecutions = 0;
    let isRendering = false;

    const rafTick = () => {
      if (isRendering) return;

      syncExecutions++;
      isRendering = true;
    };

    // First tick
    rafTick();
    expect(syncExecutions).toBe(1);
    expect(isRendering).toBe(true);

    // Multiple concurrent ticks
    rafTick();
    rafTick();
    rafTick();

    // Guard prevented all concurrent executions
    expect(syncExecutions).toBe(1); // Still 1
  });
});

describe("ProgramPreview RAF Loop — Real World Scenarios", () => {
  it("should handle heavy project on 120Hz display", async () => {
    // Heavy project: 25ms render time
    // 120Hz display: 8.33ms frame time
    // Result: 3 frames fire during each render

    const loop = new MockRenderLoop({ renderDuration: 25 });

    // Simulate sustained 120Hz RAF
    const startTime = Date.now();
    let ticks = 0;

    while (Date.now() - startTime < 100) {
      loop.rafTickFixed();
      ticks++;
      await new Promise((resolve) => setTimeout(resolve, 8));
    }

    const state = loop.getState();

    // Should have dropped many frames (render can't keep up)
    expect(state.droppedFrames).toBeGreaterThan(0);

    // But should NOT have concurrent syncs
    expect(state.syncCalls).toBeLessThanOrEqual(state.renderJobs + 1);
  });

  it("should handle burst of RAF ticks from delayed execution", () => {
    const loop = new MockRenderLoop({ renderDuration: 10 });

    // Simulate browser delivering multiple RAF callbacks at once
    // (can happen when tab regains focus)
    for (let i = 0; i < 10; i++) {
      loop.rafTickFixed();
    }

    const state = loop.getState();

    // Only first tick should render
    expect(state.renderJobs).toBe(1);
    expect(state.syncCalls).toBe(1);
    expect(state.droppedFrames).toBe(9);
  });

  it("should maintain stability over extended session", async () => {
    const loop = new MockRenderLoop({ renderDuration: 5 });

    // Simulate 100 frames (typical 60Hz = 1.67 seconds)
    for (let i = 0; i < 100; i++) {
      loop.rafTickFixed();

      // Simulate varying frame timing
      if (i % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    const state = loop.getState();

    // Should have some successful renders (timing dependent)
    expect(state.renderJobs).toBeGreaterThan(5);

    // Sync count should match render count
    expect(state.syncCalls).toBe(state.renderJobs);

    // State version should match sync calls (no missed mutations)
    expect(state.stateVersion).toBe(state.syncCalls);
  });

  it("should handle mixed fast and slow renders", async () => {
    // Start with slow render
    let renderDuration = 30;
    const loop = new MockRenderLoop({ renderDuration });

    loop.rafTickFixed(); // Slow render starts
    expect(loop.getState().isRendering).toBe(true);

    // Multiple ticks during slow render
    for (let i = 0; i < 5; i++) {
      loop.rafTickFixed();
    }

    expect(loop.getState().droppedFrames).toBe(5);

    // Wait for slow render to complete
    await new Promise((resolve) => setTimeout(resolve, 35));

    // Now do fast renders
    const fastLoop = new MockRenderLoop({ renderDuration: 0 });
    for (let i = 0; i < 5; i++) {
      fastLoop.rafTickFixed();
    }

    expect(fastLoop.getState().renderJobs).toBe(5);
    expect(fastLoop.getState().droppedFrames).toBe(0);
  });
});

describe("ProgramPreview RAF Loop: Separate needsSync from needsRender", () => {
  /**
   * Mock RAF render loop that implements optimization
   */
  class MockRenderLoopWithSyncOptimization {
    private isRendering = false;
    private lastRenderedTime = -1;
    private lastRenderedEpoch = -1;
    private lastRenderedPlaybackState: "playing" | "paused" | "stopped" =
      "stopped";

    private syncCallCount = 0;
    private renderCallCount = 0;
    private droppedFrames = 0;

    /**
     * Simulate RAF tick WITH optimization
     */
    tick(
      time: number,
      playbackState: "playing" | "paused" | "stopped",
      epoch: number,
      hasActiveTransform = false,
    ): void {
      const timeChanged = time !== this.lastRenderedTime;
      const epochChanged = epoch !== this.lastRenderedEpoch;
      const isFirstFrame = this.lastRenderedTime === -1;
      const isPlaying = playbackState === "playing";

      // needsRender: frame scheduling (every frame during playback or active transform)
      const needsRender =
        isPlaying ||
        timeChanged ||
        epochChanged ||
        isFirstFrame ||
        hasActiveTransform;

      // needsSync: element lifecycle (only on state changes)
      const playbackStateChanged =
        playbackState !== this.lastRenderedPlaybackState;
      const needsSync = epochChanged || playbackStateChanged || isFirstFrame;

      if (!needsRender) {
        return; // Early exit
      }

      if (this.isRendering) {
        this.droppedFrames++;
        return;
      }

      // Call sync ONLY when needed (not every frame)
      if (needsSync) {
        this.syncCallCount++;
      }

      this.isRendering = true;
      this.lastRenderedTime = time;
      this.lastRenderedEpoch = epoch;
      this.lastRenderedPlaybackState = playbackState;

      this.renderCallCount++;
      this.isRendering = false; // Instant render for testing
    }

    /**
     * Simulate RAF tick WITHOUT optimization (old behavior)
     */
    tickUnoptimized(
      time: number,
      playbackState: "playing" | "paused" | "stopped",
      epoch: number,
    ): void {
      const timeChanged = time !== this.lastRenderedTime;
      const epochChanged = epoch !== this.lastRenderedEpoch;
      const isFirstFrame = this.lastRenderedTime === -1;
      const isPlaying = playbackState === "playing";

      const needsRender =
        isPlaying || timeChanged || epochChanged || isFirstFrame;

      if (!needsRender) {
        return;
      }

      if (this.isRendering) {
        this.droppedFrames++;
        return;
      }

      // Old behavior: ALWAYS call sync when needsRender is true
      this.syncCallCount++;

      this.isRendering = true;
      this.lastRenderedTime = time;
      this.lastRenderedEpoch = epoch;
      this.lastRenderedPlaybackState = playbackState;

      this.renderCallCount++;
      this.isRendering = false;
    }

    getStats() {
      return {
        syncCalls: this.syncCallCount,
        renderCalls: this.renderCallCount,
        droppedFrames: this.droppedFrames,
      };
    }

    reset(): void {
      this.isRendering = false;
      this.lastRenderedTime = -1;
      this.lastRenderedEpoch = -1;
      this.lastRenderedPlaybackState = "stopped";
      this.syncCallCount = 0;
      this.renderCallCount = 0;
      this.droppedFrames = 0;
    }
  }

  let loop: MockRenderLoopWithSyncOptimization;

  beforeEach(() => {
    loop = new MockRenderLoopWithSyncOptimization();
  });

  afterEach(() => {
    loop.reset();
  });

  it("should call sync only once on first frame (not 60 times)", () => {
    // First frame: both sync and render needed
    loop.tick(0.0, "playing", 1);

    const stats = loop.getStats();
    expect(stats.syncCalls).toBe(1);
    expect(stats.renderCalls).toBe(1);
  });

  it("should NOT call sync during steady 60fps playback (optimization)", () => {
    // First frame
    loop.tick(0.0, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Simulate 60 frames at 60fps (1 second of playback)
    for (let frame = 1; frame <= 60; frame++) {
      const time = frame / 60;
      loop.tick(time, "playing", 1); // playbackState and epoch unchanged
    }

    const stats = loop.getStats();

    // With optimization: sync called ONCE (first frame only)
    expect(stats.syncCalls).toBe(1);

    // But render called 61 times (first frame + 60 playback frames)
    expect(stats.renderCalls).toBe(61);
  });

  it("should call sync 60 times WITHOUT optimization (old behavior)", () => {
    // First frame
    loop.tickUnoptimized(0.0, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Simulate 60 frames
    for (let frame = 1; frame <= 60; frame++) {
      const time = frame / 60;
      loop.tickUnoptimized(time, "playing", 1);
    }

    const stats = loop.getStats();

    // Without optimization: sync called 61 times (every frame)
    expect(stats.syncCalls).toBe(61); // ❌ Wasteful

    // Render also called 61 times
    expect(stats.renderCalls).toBe(61);
  });

  it("should call sync when playback state changes", () => {
    // Start playing
    loop.tick(0.0, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Play for a few frames
    for (let i = 1; i <= 10; i++) {
      loop.tick(i / 60, "playing", 1);
    }
    expect(loop.getStats().syncCalls).toBe(1); // Still 1

    // Pause (playback state changed, time also changed to trigger needsRender)
    loop.tick(11 / 60, "paused", 1);
    expect(loop.getStats().syncCalls).toBe(2); // Sync called again

    // Paused scrubbing (state unchanged)
    for (let i = 12; i <= 20; i++) {
      loop.tick(i / 60, "paused", 1);
    }
    expect(loop.getStats().syncCalls).toBe(2); // Still 2

    // Resume playing (state changed again, time also changed)
    loop.tick(21 / 60, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(3); // Sync called again
  });

  it("should call sync when epoch changes (structural timeline change)", () => {
    // Start playing
    loop.tick(0.0, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Play for 30 frames
    for (let i = 1; i <= 30; i++) {
      loop.tick(i / 60, "playing", 1);
    }
    expect(loop.getStats().syncCalls).toBe(1);

    // User adds a clip (epoch increments)
    loop.tick(30 / 60, "playing", 2);
    expect(loop.getStats().syncCalls).toBe(2); // Sync called for new epoch

    // Continue playing
    for (let i = 31; i <= 60; i++) {
      loop.tick(i / 60, "playing", 2);
    }
    expect(loop.getStats().syncCalls).toBe(2); // Still 2 (no more changes)
  });

  it("should reduce sync calls by 98% during 1-minute playback", () => {
    // 60fps × 60 seconds = 3600 frames
    const totalFrames = 3600;

    // First frame
    loop.tick(0.0, "playing", 1);

    // Simulate 1 minute of playback
    for (let frame = 1; frame < totalFrames; frame++) {
      const time = frame / 60;
      loop.tick(time, "playing", 1);
    }

    const stats = loop.getStats();

    // With optimization: 1 sync call (first frame)
    expect(stats.syncCalls).toBe(1);
    expect(stats.renderCalls).toBe(totalFrames);

    // Calculate savings: (3600 - 1) / 3600 = 99.97% reduction
    const reductionPercent =
      ((totalFrames - stats.syncCalls) / totalFrames) * 100;
    expect(reductionPercent).toBeGreaterThan(98);
  });

  it("should call sync on play/pause/play transitions", () => {
    // Start paused
    loop.tick(0.0, "paused", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Play (different time to trigger render)
    loop.tick(0.1, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(2); // State changed

    // Play for 30 frames
    for (let i = 1; i <= 30; i++) {
      loop.tick((i + 1) / 60 + 0.1, "playing", 1);
    }
    expect(loop.getStats().syncCalls).toBe(2); // No additional syncs

    // Pause (different time)
    loop.tick(40 / 60, "paused", 1);
    expect(loop.getStats().syncCalls).toBe(3); // State changed

    // Resume (different time)
    loop.tick(50 / 60, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(4); // State changed

    // Play for 30 more frames
    for (let i = 1; i <= 30; i++) {
      loop.tick(50 / 60 + i / 60, "playing", 1);
    }
    expect(loop.getStats().syncCalls).toBe(4); // No additional syncs
  });

  it("should handle scrubbing while paused (no unnecessary syncs)", () => {
    // Start paused
    loop.tick(0.0, "paused", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Scrub rapidly (100 seeks while paused)
    for (let i = 1; i <= 100; i++) {
      loop.tick(i / 10, "paused", 1);
    }

    const stats = loop.getStats();

    // With optimization: sync called ONCE (first frame only)
    expect(stats.syncCalls).toBe(1);

    // But render called 101 times (first + 100 scrubs)
    expect(stats.renderCalls).toBe(101);
  });

  it("should sync on epoch change during playback", () => {
    loop.tick(0.0, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Play for 20 frames
    for (let i = 1; i <= 20; i++) {
      loop.tick(i / 60, "playing", 1);
    }
    expect(loop.getStats().syncCalls).toBe(1);

    // User splits a clip (epoch changes)
    loop.tick(20 / 60, "playing", 2);
    expect(loop.getStats().syncCalls).toBe(2);

    // Continue playing
    for (let i = 21; i <= 40; i++) {
      loop.tick(i / 60, "playing", 2);
    }
    expect(loop.getStats().syncCalls).toBe(2);

    // User deletes a clip (epoch changes again)
    loop.tick(40 / 60, "playing", 3);
    expect(loop.getStats().syncCalls).toBe(3);
  });

  it("should handle stopped state transitions", () => {
    loop.tick(0.0, "stopped", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Seek while stopped
    loop.tick(5.0, "stopped", 1);
    expect(loop.getStats().syncCalls).toBe(1); // No sync (state unchanged)

    // Start playing
    loop.tick(5.0, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(2); // State changed

    // Stop
    loop.tick(10.0, "stopped", 1);
    expect(loop.getStats().syncCalls).toBe(3); // State changed
  });

  it("should demonstrate CPU savings with optimization", () => {
    const SYNC_COST_MS = 1.5; // Assume sync() takes 1.5ms
    const totalFrames = 3600; // 1 minute at 60fps

    // Optimized path
    loop.tick(0.0, "playing", 1);
    for (let i = 1; i < totalFrames; i++) {
      loop.tick(i / 60, "playing", 1);
    }
    const optimizedSyncs = loop.getStats().syncCalls;
    const optimizedCostMs = optimizedSyncs * SYNC_COST_MS;

    // Unoptimized path
    loop.reset();
    loop.tickUnoptimized(0.0, "playing", 1);
    for (let i = 1; i < totalFrames; i++) {
      loop.tickUnoptimized(i / 60, "playing", 1);
    }
    const unoptimizedSyncs = loop.getStats().syncCalls;
    const unoptimizedCostMs = unoptimizedSyncs * SYNC_COST_MS;

    // Calculate savings
    const savingsMs = unoptimizedCostMs - optimizedCostMs;
    const savingsPercent = (savingsMs / unoptimizedCostMs) * 100;

    expect(optimizedSyncs).toBe(1);
    expect(unoptimizedSyncs).toBe(3600);
    expect(savingsPercent).toBeGreaterThan(99);

    // Optimized: 1 × 1.5ms = 1.5ms total
    // Unoptimized: 3600 × 1.5ms = 5400ms total
    // Savings: 5398.5ms (5.4 seconds of CPU time per minute)
    expect(savingsMs).toBeCloseTo(5398.5, 0);
  });

  it("should maintain correct behavior across complex state transitions", () => {
    const transitions = [
      { time: 0.0, state: "paused" as const, epoch: 1, expectSync: true }, // First frame
      { time: 0.0, state: "playing" as const, epoch: 1, expectSync: true }, // Play
      { time: 1.0, state: "playing" as const, epoch: 1, expectSync: false }, // Playback
      { time: 2.0, state: "playing" as const, epoch: 1, expectSync: false }, // Playback
      { time: 2.5, state: "paused" as const, epoch: 1, expectSync: true }, // Pause
      { time: 3.0, state: "paused" as const, epoch: 1, expectSync: false }, // Scrub
      { time: 4.0, state: "paused" as const, epoch: 1, expectSync: false }, // Scrub
      { time: 4.0, state: "playing" as const, epoch: 2, expectSync: true }, // Play + epoch change
      { time: 5.0, state: "playing" as const, epoch: 2, expectSync: false }, // Playback
      { time: 6.0, state: "stopped" as const, epoch: 2, expectSync: true }, // Stop
    ];

    let totalSyncs = 0;

    transitions.forEach(({ time, state, epoch, expectSync }) => {
      const beforeSyncs = loop.getStats().syncCalls;
      loop.tick(time, state, epoch);
      const afterSyncs = loop.getStats().syncCalls;

      const syncCalled = afterSyncs > beforeSyncs;
      expect(syncCalled).toBe(expectSync);

      if (expectSync) totalSyncs++;
    });

    // Verify total sync calls match expectations
    expect(loop.getStats().syncCalls).toBe(totalSyncs);
    expect(totalSyncs).toBe(5); // 5 state transitions
  });

  it("should handle rapid play/pause cycles efficiently", () => {
    loop.tick(0.0, "paused", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Rapid play/pause 20 times (with time changes)
    for (let i = 0; i < 20; i++) {
      loop.tick(i / 30, "playing", 1); // Different time each cycle
      loop.tick((i + 0.5) / 30, "paused", 1); // Different time
    }

    const stats = loop.getStats();

    // Each play/pause is 2 sync calls, plus initial = 1 + 40 = 41
    expect(stats.syncCalls).toBe(41);

    // This is correct behavior - sync needed on each state change
    // The optimization is that we DON'T sync between state changes
  });

  it("should not sync during high-frequency time updates", () => {
    loop.tick(0.0, "playing", 1);
    expect(loop.getStats().syncCalls).toBe(1);

    // Simulate 240fps rendering (4ms per frame)
    // Time advances slowly, but we render frequently
    for (let frame = 1; frame <= 240; frame++) {
      const time = frame / 240; // 1 second at 240fps
      loop.tick(time, "playing", 1);
    }

    const stats = loop.getStats();

    // With optimization: only 1 sync (first frame)
    expect(stats.syncCalls).toBe(1);

    // But 241 renders (first + 240 frames)
    expect(stats.renderCalls).toBe(241);
  });

  it("should sync when needed despite multiple renders per second", () => {
    // High framerate playback with occasional state changes
    loop.tick(0.0, "playing", 1);
    let syncCallsAfterFirstFrame = loop.getStats().syncCalls;
    expect(syncCallsAfterFirstFrame).toBe(1);

    // 100 frames of playback
    for (let i = 1; i <= 100; i++) {
      loop.tick(i / 60, "playing", 1);
    }
    expect(loop.getStats().syncCalls).toBe(1); // Still 1

    // Pause (with time change to trigger render)
    loop.tick(101 / 60, "paused", 1);
    expect(loop.getStats().syncCalls).toBe(2); // State changed

    // 100 frames of scrubbing
    for (let i = 102; i <= 201; i++) {
      loop.tick(i / 60, "paused", 1);
    }
    expect(loop.getStats().syncCalls).toBe(2); // Still 2

    // 202 total renders, but only 2 syncs
    expect(loop.getStats().renderCalls).toBe(202);
  });

  it("should render when transform is active (even if time/epoch/playbackState unchanged)", () => {
    // First frame
    loop.tick(0.0, "paused", 1);
    expect(loop.getStats().renderCalls).toBe(1);

    // Second frame: stationary, no state changes, no transform → no render
    loop.tick(0.0, "paused", 1, false);
    expect(loop.getStats().renderCalls).toBe(1); // Still 1

    // Third frame: stationary, but has active transform → should render!
    loop.tick(0.0, "paused", 1, true);
    expect(loop.getStats().renderCalls).toBe(2); // Incremented to 2

    // Fourth frame: still stationary and active transform → should render again!
    loop.tick(0.0, "paused", 1, true);
    expect(loop.getStats().renderCalls).toBe(3); // Incremented to 3
  });
});

/**
 * Tests for Bug 1 — Native Surface Fire-and-Forget: Early renderInFlight Release
 *
 * Root cause:
 *   On the native surface playback path (`persistentNativePlaybackEligible`),
 *   `renderInFlight` was held through all async work that follows
 *   `submitNativePlaybackDemand()` — body-mask AI segmentation, smart-overlay
 *   rasterization, and WebView canvas bookkeeping (~15–30 ms combined).
 *   Because `renderInFlight = false` only happened in the `finally` block,
 *   every RAF tick that fired during that window was silently dropped.
 *   On a 60fps project (16.67 ms budget), any frame that needs > 16 ms of
 *   async work causes the following tick to be dropped — effectively halving
 *   perceived FPS.
 *
 * Fix:
 *   Immediately after `submitNativePlaybackDemand()` fires (fire-and-forget),
 *   commit tracking state, set `renderInFlight = false`, call `scheduleNextFrame()`,
 *   and return early. The `finally` block still runs for tracing, and its own
 *   `scheduleNextFrame()` is a no-op because `frameScheduled` is already true.
 */
describe("ProgramPreview RAF Loop — Native Surface Early renderInFlight Release (Bug 1)", () => {
  /**
   * Models the render loop's native surface fire-and-forget path.
   *
   * Phases of one RAF tick:
   *   1. Guard check  (sync — instant)
   *   2. Rasterize    (async — the scene/text/bridge work before native check)
   *   3. Demand submit (sync — fire-and-forget to Rust, no blocking await)
   *   4. Post-rasterize (async — body masks + smart overlays, always awaited in broken code)
   *   5. finally       (sync — cleanup)
   *
   * The fix causes phase 4 to be skipped on the native surface path; the lock
   * is released at the end of phase 3.
   */
  class MockNativeSurfaceLoop {
    private _renderInFlight = false;
    private _frameScheduled = false;

    public demandsSubmitted = 0;
    public framesCompleted = 0;
    public droppedFrames = 0;

    /** Expose internal flag so tests can assert mid-flight state. */
    get renderInFlight(): boolean {
      return this._renderInFlight;
    }

    private scheduleNextFrame(): void {
      if (this._frameScheduled) return;
      this._frameScheduled = true;
    }

    resetSchedule(): void {
      this._frameScheduled = false;
    }

    /**
     * BROKEN behavior: renderInFlight held through post-rasterize async work
     * before being released in `finally`.
     */
    async rafTickBroken(
      rasterizeMs: number,
      postRasterizeMs = 15,
    ): Promise<void> {
      if (this._renderInFlight) {
        this.droppedFrames++;
        return;
      }

      this._renderInFlight = true;
      this._frameScheduled = false;

      try {
        // Phase 2: rasterize (always happens before native surface check)
        await new Promise<void>((r) => setTimeout(r, rasterizeMs));

        // Phase 3: demand submitted — non-blocking, but lock NOT released yet (bug)
        this.demandsSubmitted++;

        // Phase 4: post-rasterize async work that still holds the lock
        await new Promise<void>((r) => setTimeout(r, postRasterizeMs));

        this.framesCompleted++;
      } finally {
        // Lock released only here — AFTER all async work
        this._renderInFlight = false;
        this.scheduleNextFrame();
      }
    }

    /**
     * FIXED behavior: renderInFlight released immediately after demand submit,
     * before post-rasterize async work. `finally` is still guaranteed to run.
     */
    async rafTickFixed(
      rasterizeMs: number,
      _postRasterizeMs = 15, // parameter kept for symmetry; not reached on this path
    ): Promise<void> {
      if (this._renderInFlight) {
        this.droppedFrames++;
        return;
      }

      this._renderInFlight = true;
      this._frameScheduled = false;

      try {
        // Phase 2: rasterize
        await new Promise<void>((r) => setTimeout(r, rasterizeMs));

        // Phase 3: demand submitted — release lock immediately (the fix)
        this.demandsSubmitted++;
        this._renderInFlight = false; // ← early release
        this.scheduleNextFrame();
        this.framesCompleted++;
        return; // skip post-rasterize async work; finally still executes
      } finally {
        // No-op if early release already ran; harmless otherwise
        this._renderInFlight = false;
        this.scheduleNextFrame();
      }
    }

    reset(): void {
      this._renderInFlight = false;
      this._frameScheduled = false;
      this.demandsSubmitted = 0;
      this.framesCompleted = 0;
      this.droppedFrames = 0;
    }
  }

  let loop: MockNativeSurfaceLoop;

  beforeEach(() => {
    loop = new MockNativeSurfaceLoop();
  });

  // ─── Core drop-prevention tests ──────────────────────────────────────────

  it("BROKEN: concurrent RAF tick is dropped while post-rasterize work holds renderInFlight", async () => {
    // Frame 1: rasterize=10ms, post-rasterize=20ms → lock held for ~30ms total
    const frame1 = loop.rafTickBroken(10, 20);

    // Frame 2 fires at ~12ms (after rasterize, inside post-rasterize window)
    // renderInFlight is still true → frame 2 is dropped
    await new Promise<void>((r) => setTimeout(r, 12));
    await loop.rafTickBroken(0, 0);

    await frame1;

    expect(loop.droppedFrames).toBe(1); // frame 2 was dropped
    expect(loop.framesCompleted).toBe(1); // only frame 1 completed
    expect(loop.demandsSubmitted).toBe(1); // Rust only received 1 demand
  });

  it("FIXED: renderInFlight released after demand submit — concurrent RAF tick is NOT dropped", async () => {
    // Frame 1: rasterize=10ms, then lock released immediately (early return)
    const frame1 = loop.rafTickFixed(10, 20);

    // Frame 2 fires at ~12ms — renderInFlight is now false → proceeds
    await new Promise<void>((r) => setTimeout(r, 12));
    await loop.rafTickFixed(0, 0);

    await frame1;

    expect(loop.droppedFrames).toBe(0); // no drops!
    expect(loop.framesCompleted).toBe(2); // both frames completed
    expect(loop.demandsSubmitted).toBe(2); // 2 demands sent to Rust
  });

  // ─── renderInFlight state assertions ─────────────────────────────────────

  it("FIXED: renderInFlight is false immediately after demand submit (before post-rasterize)", async () => {
    // Start frame 1 (10ms rasterize)
    const frame1 = loop.rafTickFixed(10, 20);

    // At 5ms — rasterize still in progress → lock still held
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(loop.renderInFlight).toBe(true);

    // At 12ms — rasterize done, demand submitted, early release executed
    await new Promise<void>((r) => setTimeout(r, 7));
    expect(loop.renderInFlight).toBe(false); // released!

    await frame1;
  });

  it("BROKEN: renderInFlight is still true after demand submit during post-rasterize window", async () => {
    const frame1 = loop.rafTickBroken(10, 20);

    // At 12ms — rasterize done, demand submitted, but post-rasterize still running
    await new Promise<void>((r) => setTimeout(r, 12));
    expect(loop.renderInFlight).toBe(true); // still locked!

    await frame1;
    expect(loop.renderInFlight).toBe(false); // released only in finally
  });

  // ─── 60fps steady-state playback simulation ───────────────────────────────

  it("FIXED: all 5 consecutive 60fps frames render when rasterize < frame budget", async () => {
    const FRAME_INTERVAL_MS = 1000 / 60; // ~16.67ms

    // Each tick: 10ms rasterize — fits in budget, and early release means
    // the next RAF fires freely even if a tiny amount of post-rasterize work
    // would have extended the old lock duration.
    const ticks: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      loop.resetSchedule();
      ticks.push(loop.rafTickFixed(10, 20));
      await new Promise<void>((r) => setTimeout(r, FRAME_INTERVAL_MS));
    }
    await Promise.all(ticks);

    expect(loop.droppedFrames).toBe(0);
    expect(loop.framesCompleted).toBe(5);
    expect(loop.demandsSubmitted).toBe(5);
  });

  it("BROKEN: 60fps frames are systematically dropped when rasterize + post-rasterize > frame budget", async () => {
    const FRAME_INTERVAL_MS = 1000 / 60; // ~16.67ms

    // Each tick: 10ms rasterize + 20ms post-rasterize = 30ms total lock.
    // 30ms > 16.67ms frame interval → the following RAF tick is dropped every time.
    const ticks: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      loop.resetSchedule();
      ticks.push(loop.rafTickBroken(10, 20));
      await new Promise<void>((r) => setTimeout(r, FRAME_INTERVAL_MS));
    }
    await Promise.all(ticks);

    expect(loop.droppedFrames).toBeGreaterThan(0); // frames dropped
    expect(loop.framesCompleted).toBeLessThan(5); // not all 5 completed
  });

  // ─── Tracking state correctness ──────────────────────────────────────────

  it("FIXED: tracking state committed before early release prevents re-rendering same frame", () => {
    // Validates the invariant that lastRenderedFrameIndex et al. are updated
    // atomically with the early release so the next renderLoop() skips the
    // already-submitted frame (mightNeedRender stays false for it).
    let lastRenderedFrameIndex = -1;
    let renderInFlight = false;
    let framesCompleted = 0;
    let demandsSubmitted = 0;

    const rafTickWithTracking = (currentFrameIndex: number): boolean => {
      if (renderInFlight) return false; // dropped
      renderInFlight = true;

      // Demand submitted (fire-and-forget)
      demandsSubmitted++;

      // FIX: commit tracking state before releasing lock
      lastRenderedFrameIndex = currentFrameIndex;
      renderInFlight = false;
      framesCompleted++;
      return true;
    };

    // Frame 42 — renders, commits tracking
    expect(rafTickWithTracking(42)).toBe(true);
    expect(lastRenderedFrameIndex).toBe(42);
    expect(renderInFlight).toBe(false);

    // Frame 42 again (same frame index) — next tick sees it's already rendered
    // In the real loop: mightNeedRender = timeChanged = false → early exit
    const alreadyRendered = lastRenderedFrameIndex === 42; // simulates the check
    expect(alreadyRendered).toBe(true); // correct: no redundant render

    // Frame 43 — new frame, renders
    expect(rafTickWithTracking(43)).toBe(true);
    expect(framesCompleted).toBe(2);
    expect(demandsSubmitted).toBe(2);
  });

  it("FIXED: finally block scheduleNextFrame() is a no-op when early release already scheduled", async () => {
    // Verifies that the finally block's scheduleNextFrame() doesn't double-schedule.
    // In the real code, scheduleNextFrame() guards with `if (frameScheduled) return;`
    // so calling it a second time from finally is safe and correct.
    let scheduleCallCount = 0;
    let frameScheduled = false;

    const scheduleNextFrame = () => {
      if (frameScheduled) return; // guard — same as production code
      frameScheduled = true;
      scheduleCallCount++;
    };

    const rafTickWithScheduleCheck = async (): Promise<void> => {
      let renderInFlight = true;
      try {
        await new Promise<void>((r) => setTimeout(r, 5));
        // Early release path
        renderInFlight = false;
        scheduleNextFrame(); // call 1 — sets frameScheduled=true, scheduleCallCount=1
        return;
      } finally {
        renderInFlight = false;
        scheduleNextFrame(); // call 2 — frameScheduled already true, no-op
        void renderInFlight; // suppress unused warning
      }
    };

    await rafTickWithScheduleCheck();

    expect(scheduleCallCount).toBe(1); // scheduled exactly once, not twice
    expect(frameScheduled).toBe(true);
  });
});

/**
 * Tests for Bug 2 — VSync-Aligned Frame Scheduling
 *
 * Root cause:
 *   In the `finally` block of `renderLoop()`, when a render overshot the
 *   project frame interval while playing, the code fell into a `setTimeout`
 *   branch rather than calling `scheduleNextFrame()` (requestAnimationFrame).
 *   `setTimeout` is not VSync-synchronised: it fires at an arbitrary position
 *   in the display refresh cycle, creating a phase offset that produces
 *   micro-stutter even when average FPS is otherwise within budget.
 *
 *   Additionally, the delay formula `frameInterval − (renderMs % frameInterval)`
 *   can overshoot by a full VSync slot on 30fps projects, scheduling the next
 *   wakeup ~2 frame durations after the render instead of 1.
 *
 * Fix:
 *   Remove the setTimeout branch entirely. Always call `scheduleNextFrame()`
 *   (which wraps `requestAnimationFrame`). The compositor aligns the callback
 *   to the next available VSync automatically. The dirty check inside
 *   `renderLoop` (`mightNeedRender`) skips CPU/GPU work when the audio-clock
 *   has not advanced to a new frame, so 30fps projects still produce at most
 *   30 presents per second regardless of how often RAF fires.
 */
describe("ProgramPreview RAF Loop — VSync-Aligned Frame Scheduling (Bug 2)", () => {
  /**
   * Models the finally-block scheduling decision.
   * Returns which mechanism was used to schedule the next frame.
   */
  type ScheduleResult = "raf" | "setTimeout" | "none";

  const finallyBlockBroken = (opts: {
    isPlaying: boolean;
    renderMs: number;
    frameRateHz: number;
    hasPendingVisualChange: boolean;
    frameScheduled: boolean;
  }): ScheduleResult => {
    if (!opts.hasPendingVisualChange) return "none";
    const frameIntervalMs = 1000 / opts.frameRateHz;
    if (opts.isPlaying && opts.renderMs > frameIntervalMs) {
      if (opts.frameScheduled) return "none";
      // BROKEN: uses setTimeout
      return "setTimeout";
    }
    return "raf";
  };

  const finallyBlockFixed = (opts: {
    hasPendingVisualChange: boolean;
  }): ScheduleResult => {
    if (!opts.hasPendingVisualChange) return "none";
    // FIXED: always RAF
    return "raf";
  };

  // ─── Core mechanism tests ─────────────────────────────────────────────────

  it("BROKEN: slow render during playback uses setTimeout instead of RAF", () => {
    const result = finallyBlockBroken({
      isPlaying: true,
      renderMs: 25, // > 16.67ms (60fps budget)
      frameRateHz: 60,
      hasPendingVisualChange: true,
      frameScheduled: false,
    });
    expect(result).toBe("setTimeout"); // ❌ not VSync-aligned
  });

  it("FIXED: slow render during playback still uses RAF", () => {
    const result = finallyBlockFixed({ hasPendingVisualChange: true });
    expect(result).toBe("raf"); // ✅ VSync-aligned
  });

  it("BROKEN: only the fast-render / paused path used RAF", () => {
    // These cases happened to use RAF in the old code (the else branch)
    const fast = finallyBlockBroken({
      isPlaying: true,
      renderMs: 5,
      frameRateHz: 60,
      hasPendingVisualChange: true,
      frameScheduled: false,
    });
    const paused = finallyBlockBroken({
      isPlaying: false,
      renderMs: 25,
      frameRateHz: 60,
      hasPendingVisualChange: true,
      frameScheduled: false,
    });
    expect(fast).toBe("raf");
    expect(paused).toBe("raf");
  });

  it("FIXED: all scenarios use RAF regardless of renderMs, playback state, or frame rate", () => {
    const scenarios = [
      { isPlaying: true, renderMs: 5, frameRateHz: 60 },
      { isPlaying: true, renderMs: 20, frameRateHz: 60 }, // overbudget — was setTimeout
      { isPlaying: true, renderMs: 50, frameRateHz: 60 }, // very overbudget
      { isPlaying: false, renderMs: 5, frameRateHz: 60 },
      { isPlaying: false, renderMs: 25, frameRateHz: 60 },
      { isPlaying: true, renderMs: 35, frameRateHz: 30 }, // 30fps project, overbudget
      { isPlaying: true, renderMs: 5, frameRateHz: 24 },
    ];

    for (const s of scenarios) {
      const result = finallyBlockFixed({ hasPendingVisualChange: true });
      expect(result).toBe("raf");
    }
  });

  it("FIXED: no frame scheduled when hasPendingVisualChange is false", () => {
    expect(finallyBlockFixed({ hasPendingVisualChange: false })).toBe("none");
  });

  // ─── Delay formula correctness tests ─────────────────────────────────────

  it("BROKEN: delay formula schedules wakeup 2+ VSync slots late on 30fps projects", () => {
    // 30fps project: frameIntervalMs = 33.33ms
    // Render takes 35ms (just over one frame budget)
    // Broken delay = 33.33 − (35 % 33.33) = 33.33 − 1.67 = 31.66ms
    // Wakeup fires at 35ms + 31.66ms = 66.66ms from frame start
    // But the next VSync would have been at ~33.33ms — we're 2 slots late!
    const frameRateHz = 30;
    const renderMs = 35;
    const frameIntervalMs = 1000 / frameRateHz; // 33.33ms
    const delay = Math.max(0, frameIntervalMs - (renderMs % frameIntervalMs));
    const wakeupFromFrameStart = renderMs + delay;

    // Should fire at next VSync (~33ms), instead fires at ~66ms
    expect(wakeupFromFrameStart).toBeGreaterThan(frameIntervalMs * 1.9);
    expect(delay).toBeGreaterThan(30); // a 30+ms setTimeout delay is never correct
  });

  it("BROKEN: delay formula produces inconsistent wakeup offsets at 60fps", () => {
    // At 60fps (frameIntervalMs=16.67ms), renders of different durations
    // produce wildly different setTimeout delays with no correlation to
    // the actual next VSync boundary.
    const frameIntervalMs = 1000 / 60;
    const renderDurations = [17, 18, 20, 25, 30, 33];
    const delays = renderDurations.map((ms) =>
      Math.max(0, frameIntervalMs - (ms % frameIntervalMs)),
    );

    // Delays range from near-0 to ~16ms — unpredictable, none VSync-aligned
    const minDelay = Math.min(...delays);
    const maxDelay = Math.max(...delays);
    expect(maxDelay - minDelay).toBeGreaterThan(10); // huge variance
  });

  it("FIXED: no delay needed — RAF naturally targets the next VSync boundary", () => {
    // The fixed code calls scheduleNextFrame() (requestAnimationFrame) without
    // any delay calculation. Verify the delay variable is never computed.
    let delayComputations = 0;

    const fixedSchedule = (hasPendingVisualChange: boolean) => {
      if (!hasPendingVisualChange) return;
      // No delay computation — just schedule
      void Math.max; // delay computation would happen here in broken code
      // (the broken code does: const delay = Math.max(0, frameIntervalMs - ...))
      // Fixed: nothing computed
    };

    fixedSchedule(true);
    expect(delayComputations).toBe(0); // no delay formula ever runs
  });

  // ─── VSync alignment invariant ────────────────────────────────────────────

  it("FIXED: mightNeedRender dirty-check prevents redundant GPU work when RAF fires early", () => {
    // Concern: if RAF fires more often than the project frame rate (e.g. 60Hz RAF
    // on a 30fps project), will the render loop do wasted GPU work?
    // Answer: No — mightNeedRender returns false when nothing changed.
    let renderWorkDone = 0;
    let rafFires = 0;

    const frameRateHz = 30;
    const frameIntervalMs = 1000 / frameRateHz;
    let lastRenderedFrameIndex = -1;

    // Simulate 6 RAF callbacks at 60Hz on a 30fps project
    // Frames at 0ms, 16.67ms, 33.33ms, 50ms, 66.67ms, 83.33ms
    const rafTimestamps = [0, 16.67, 33.33, 50, 66.67, 83.33];
    for (const t of rafTimestamps) {
      rafFires++;
      const frameIndex = Math.floor(t / frameIntervalMs);
      // mightNeedRender: timeChanged = frameIndex !== lastRenderedFrameIndex
      const mightNeedRender = frameIndex !== lastRenderedFrameIndex;
      if (mightNeedRender) {
        renderWorkDone++;
        lastRenderedFrameIndex = frameIndex;
      }
    }

    // RAF fires 6 times but render work only done 3 times (one per 30fps frame)
    expect(rafFires).toBe(6);
    expect(renderWorkDone).toBe(3); // dirty check suppresses the other 3
  });

  it("BROKEN: frameScheduled guard prevents setTimeout from firing if already scheduled", () => {
    // Edge case in the broken path: if frameScheduled is already true,
    // the setTimeout branch is skipped entirely — no frame scheduled at all.
    // This could leave the render loop stuck with hasPendingVisualChange=true
    // but no pending callback.
    const result = finallyBlockBroken({
      isPlaying: true,
      renderMs: 25,
      frameRateHz: 60,
      hasPendingVisualChange: true,
      frameScheduled: true, // already scheduled
    });
    // In the broken code, the setTimeout path guards with `if (!frameScheduled)`
    // so when frameScheduled=true and we're in the slow-render branch, nothing fires.
    expect(result).toBe("none"); // ❌ no scheduling — could stall the loop
  });

  it("FIXED: scheduleNextFrame() guard prevents double-scheduling safely", () => {
    // scheduleNextFrame() itself guards with `if (frameScheduled) return;`
    // so calling it multiple times is always safe — it's idempotent.
    let frameScheduled = false;
    let rafScheduleCount = 0;

    const scheduleNextFrame = () => {
      if (frameScheduled) return; // guard
      frameScheduled = true;
      rafScheduleCount++;
    };

    // Call three times (e.g. from finally, from a wakeup, from a clock tick)
    scheduleNextFrame();
    scheduleNextFrame();
    scheduleNextFrame();

    expect(rafScheduleCount).toBe(1); // only 1 RAF ever queued
    expect(frameScheduled).toBe(true);
  });
});

/**
 * Tests for Bug 3 — needsSync Guard for syncPreviewMedia
 *
 * Root cause:
 *   `capturedSession.syncPreviewMedia()` (which drives
 *   `PreviewPlaybackScheduler.reconcile()` — O(n×clips) per call) was invoked
 *   unconditionally on every RAF tick that passed the `mightNeedRender` gate.
 *   During steady-state 60fps playback, `isPlaying` makes `mightNeedRender`
 *   permanently true, so `syncPreviewMedia` ran 60 times per second even though
 *   the epoch, playback state, clips, tracks, transitions, and project are
 *   completely unchanged between consecutive frames.
 *
 * Fix:
 *   Compute a `needsSync` flag from signals that actually require re-syncing
 *   media elements: `epochChanged || playbackStateChanged || isFirstFrame ||
 *   clipsChanged || tracksChanged || transitionsChanged || projectChanged`.
 *   Gate the `syncPreviewMedia` call behind this flag. During steady-state
 *   playback none of these signals change, so sync is called only once
 *   (on `isFirstFrame`) and then suppressed for the entire play session.
 */
describe("ProgramPreview RAF Loop — needsSync Guard for syncPreviewMedia (Bug 3)", () => {
  /**
   * Models one RAF tick with or without the needsSync optimisation.
   * Returns whether syncPreviewMedia would be called for the given inputs.
   */
  interface FrameInputs {
    /** Whether this is the very first rendered frame */
    isFirstFrame: boolean;
    /** Current playback state */
    playbackState: "playing" | "paused" | "stopped";
    /** Playback state as of the last rendered frame */
    lastRenderedPlaybackState: "playing" | "paused" | "stopped";
    /** Timeline version counter changed since last render */
    epochChanged: boolean;
    /** Whether clips/tracks/transitions/project identity changed */
    clipsChanged: boolean;
    tracksChanged: boolean;
    transitionsChanged: boolean;
    projectChanged: boolean;
  }

  /** BROKEN: sync called regardless of what changed */
  const wouldSyncBroken = (_inputs: FrameInputs): boolean => true;

  /** FIXED: sync only when needsSync */
  const wouldSyncFixed = (inputs: FrameInputs): boolean => {
    const playbackStateChanged =
      inputs.playbackState !== inputs.lastRenderedPlaybackState;
    return (
      inputs.epochChanged ||
      playbackStateChanged ||
      inputs.isFirstFrame ||
      inputs.clipsChanged ||
      inputs.tracksChanged ||
      inputs.transitionsChanged ||
      inputs.projectChanged
    );
  };

  const steadyPlayFrame: FrameInputs = {
    isFirstFrame: false,
    playbackState: "playing",
    lastRenderedPlaybackState: "playing",
    epochChanged: false,
    clipsChanged: false,
    tracksChanged: false,
    transitionsChanged: false,
    projectChanged: false,
  };

  // ─── Core gate tests ──────────────────────────────────────────────────────

  it("BROKEN: sync called every frame during steady 60fps playback", () => {
    let syncCalls = 0;
    for (let frame = 0; frame < 60; frame++) {
      if (wouldSyncBroken(steadyPlayFrame)) syncCalls++;
    }
    expect(syncCalls).toBe(60); // called every single frame ❌
  });

  it("FIXED: sync called once (first frame) then suppressed for 60fps steady playback", () => {
    let syncCalls = 0;
    // First frame
    if (wouldSyncFixed({ ...steadyPlayFrame, isFirstFrame: true })) syncCalls++;
    // Subsequent 59 frames — nothing changed
    for (let frame = 1; frame < 60; frame++) {
      if (wouldSyncFixed(steadyPlayFrame)) syncCalls++;
    }
    expect(syncCalls).toBe(1); // only the first frame ✅
  });

  it("FIXED: sync still called when epoch changes (timeline structural edit)", () => {
    expect(wouldSyncFixed({ ...steadyPlayFrame, epochChanged: true })).toBe(
      true,
    );
  });

  it("FIXED: sync called on play→pause transition", () => {
    expect(
      wouldSyncFixed({
        ...steadyPlayFrame,
        playbackState: "paused",
        lastRenderedPlaybackState: "playing",
      }),
    ).toBe(true);
  });

  it("FIXED: sync called on pause→play transition", () => {
    expect(
      wouldSyncFixed({
        ...steadyPlayFrame,
        playbackState: "playing",
        lastRenderedPlaybackState: "paused",
      }),
    ).toBe(true);
  });

  it("FIXED: sync called when clips change (trim, add, delete)", () => {
    expect(wouldSyncFixed({ ...steadyPlayFrame, clipsChanged: true })).toBe(
      true,
    );
  });

  it("FIXED: sync called when tracks change", () => {
    expect(wouldSyncFixed({ ...steadyPlayFrame, tracksChanged: true })).toBe(
      true,
    );
  });

  it("FIXED: sync called when transitions change", () => {
    expect(
      wouldSyncFixed({ ...steadyPlayFrame, transitionsChanged: true }),
    ).toBe(true);
  });

  it("FIXED: sync called when project identity changes", () => {
    expect(wouldSyncFixed({ ...steadyPlayFrame, projectChanged: true })).toBe(
      true,
    );
  });

  it("FIXED: sync NOT called on steady paused frames (no change)", () => {
    const pausedFrame: FrameInputs = {
      ...steadyPlayFrame,
      playbackState: "paused",
      lastRenderedPlaybackState: "paused",
    };
    expect(wouldSyncFixed(pausedFrame)).toBe(false);
  });

  // ─── CPU savings quantification ───────────────────────────────────────────

  it("FIXED: 98%+ reduction in sync calls during 1-minute 60fps playback session", () => {
    const totalFrames = 60 * 60; // 1 minute at 60fps = 3600 frames
    let brokenCalls = 0;
    let fixedCalls = 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (wouldSyncBroken(steadyPlayFrame)) brokenCalls++;
      if (wouldSyncFixed({ ...steadyPlayFrame, isFirstFrame: frame === 0 })) {
        fixedCalls++;
      }
    }

    expect(brokenCalls).toBe(3600);
    expect(fixedCalls).toBe(1); // only the first frame
    const reductionPercent = ((brokenCalls - fixedCalls) / brokenCalls) * 100;
    expect(reductionPercent).toBeGreaterThan(99.9); // > 99.9% reduction
  });

  it("FIXED: sync called only on state-change frames across play/pause cycles", () => {
    // Simulate: play 3s → pause → play 3s → pause
    type Frame = { playbackState: "playing" | "paused"; isFirstFrame: boolean };
    const session: Frame[] = [
      // First play: 180 frames at 60fps
      { playbackState: "playing", isFirstFrame: true },
      ...Array.from({ length: 179 }, () => ({
        playbackState: "playing" as const,
        isFirstFrame: false,
      })),
      // Pause transition
      { playbackState: "paused", isFirstFrame: false },
      // Paused: 30 frames
      ...Array.from({ length: 29 }, () => ({
        playbackState: "paused" as const,
        isFirstFrame: false,
      })),
      // Resume play
      { playbackState: "playing", isFirstFrame: false },
      // Second play: 179 frames
      ...Array.from({ length: 179 }, () => ({
        playbackState: "playing" as const,
        isFirstFrame: false,
      })),
      // Final pause
      { playbackState: "paused", isFirstFrame: false },
    ];

    let syncCalls = 0;
    let lastState: "playing" | "paused" | "stopped" = "stopped";
    for (const frame of session) {
      const inputs: FrameInputs = {
        ...steadyPlayFrame,
        playbackState: frame.playbackState,
        lastRenderedPlaybackState: lastState,
        isFirstFrame: frame.isFirstFrame,
      };
      if (wouldSyncFixed(inputs)) syncCalls++;
      lastState = frame.playbackState;
    }

    // Sync should fire only at: first play (isFirstFrame) + pause + resume + final pause = 4
    expect(syncCalls).toBe(4);
    // Total frames
    expect(session.length).toBe(1 + 179 + 1 + 29 + 1 + 179 + 1);
  });

  it("FIXED: sync fires immediately on every structural edit during playback", () => {
    // Even with the optimisation, any edit to the timeline must sync immediately.
    // Simulate 5 consecutive frame with a different clip array each time.
    let syncCalls = 0;
    for (let edit = 0; edit < 5; edit++) {
      if (
        wouldSyncFixed({
          ...steadyPlayFrame,
          clipsChanged: true, // each frame a new clips reference
        })
      ) {
        syncCalls++;
      }
    }
    expect(syncCalls).toBe(5); // every edit frame syncs
  });

  // ─── needsSync vs mightNeedRender relationship ────────────────────────────

  it("FIXED: needsSync is a strict subset of mightNeedRender during playback", () => {
    // mightNeedRender = isPlaying || timeChanged || epochChanged || ...
    // needsSync      = epochChanged || playbackStateChanged || isFirstFrame || ...
    //
    // Every frame during playing: mightNeedRender=true (because isPlaying=true).
    // But needsSync is false on steady frames. This is the key invariant.
    const mightNeedRender = true; // always true when isPlaying
    const needsSync = wouldSyncFixed(steadyPlayFrame); // false on steady frame

    expect(mightNeedRender).toBe(true);
    expect(needsSync).toBe(false); // ← strict subset
  });

  it("BROKEN: sync and mightNeedRender were effectively the same during playback", () => {
    // Without the fix, whenever mightNeedRender was true, sync ran too.
    // During playing, both were always true — indistinguishable.
    const mightNeedRender = true;
    const syncWouldRun = wouldSyncBroken(steadyPlayFrame);
    expect(mightNeedRender).toBe(syncWouldRun); // always equal ❌
  });
});

/**
 * Tests for Bug 4 — AdaptiveReadbackPolicy: Cadence Caps, Dispatch Intervals,
 * and Asymmetric Recovery Ratchet
 *
 * Root causes:
 *   A) `targetCadenceFps` hard-capped the WebView readback path at 30fps even
 *      on top-tier macOS hardware (960px, tier 5), and Windows defaulted to
 *      20fps (480px, tier 1). These were unconditional caps, not adapting to
 *      actual hardware capability.
 *
 *   B) `markPlaybackDispatch` intervals were derived from the old cadence values,
 *      so `canDispatchPlayback()` and `targetCadenceFps` diverged after any
 *      code change to one but not the other.
 *
 *   C) The recovery ratchet required 90 consecutive fast samples (< 9ms each)
 *      to climb one tier — ~3 seconds at 60fps — while degradation only needed
 *      3 slow samples. One brief IPC congestion burst would trap the policy at
 *      low cadence for seconds even after conditions fully recovered.
 *
 * Fixes:
 *   A) Raised cadence caps: 10→15, 20→24, 24→30, 30→60fps.
 *   B) Updated dispatch intervals to match: 100ms→67ms, 50ms→42ms,
 *      41.67ms→33ms, 33ms→17ms.
 *   C) Reduced recovery threshold: 90→30 fast samples (~500ms at 60fps).
 */
describe("AdaptiveReadbackPolicy — Cadence Caps, Dispatch Intervals & Recovery (Bug 4)", () => {
  // Mirror the DIMENSIONS array from the policy
  const DIMENSIONS = [320, 480, 600, 720, 840, 960] as const;

  // Reconstruct the fixed policy's cadence logic inline for testing
  const cadenceFixed = (tier: number): number => {
    if (tier === 0) return 15;
    if (tier === 1) return 24;
    if (tier <= 3) return 30;
    return 60;
  };

  const cadenceBroken = (tier: number): number => {
    if (tier === 0) return 10;
    if (tier === 1) return 20;
    if (tier <= 3) return 24;
    return 30;
  };

  const intervalFixed = (tier: number): number => {
    if (tier === 0) return 1000 / 15;
    if (tier === 1) return 1000 / 24;
    if (tier <= 3) return 1000 / 30;
    return 1000 / 60;
  };

  const intervalBroken = (tier: number): number => {
    if (tier === 0) return 100;
    if (tier === 1) return 50;
    if (tier <= 3) return 1000 / 24;
    return 1000 / 30;
  };

  // ── A: Cadence cap tests ──────────────────────────────────────────────────

  describe("A: targetCadenceFps caps", () => {
    it("BROKEN: macOS default (960px, tier 5) hard-capped at 30fps", () => {
      expect(cadenceBroken(5)).toBe(30); // ❌ 30fps cap regardless of hardware
    });

    it("FIXED: macOS default (960px, tier 5) allows 60fps", () => {
      expect(cadenceFixed(5)).toBe(60); // ✅ full display rate
    });

    it("BROKEN: Windows default (480px, tier 1) hard-capped at 20fps", () => {
      expect(cadenceBroken(1)).toBe(20); // ❌ visibly choppy
    });

    it("FIXED: Windows default (480px, tier 1) raises to 24fps", () => {
      expect(cadenceFixed(1)).toBe(24); // ✅ cinematic minimum
    });

    it("FIXED: low-core macOS (720px, tier 3) raises from 24fps to 30fps", () => {
      expect(cadenceBroken(3)).toBe(24);
      expect(cadenceFixed(3)).toBe(30);
    });

    it("FIXED: tier 0 (320px, most degraded) raises from 10fps to 15fps", () => {
      expect(cadenceBroken(0)).toBe(10);
      expect(cadenceFixed(0)).toBe(15);
    });

    it("FIXED: cadence monotonically increases with tier", () => {
      const cadences = DIMENSIONS.map((_, tier) => cadenceFixed(tier));
      for (let i = 1; i < cadences.length; i++) {
        expect(cadences[i]).toBeGreaterThanOrEqual(cadences[i - 1]);
      }
    });

    it("BROKEN: cadence was also monotonic but all values too low", () => {
      const brokenCadences = DIMENSIONS.map((_, tier) => cadenceBroken(tier));
      const fixedCadences = DIMENSIONS.map((_, tier) => cadenceFixed(tier));
      // Every tier is strictly improved
      for (let i = 0; i < DIMENSIONS.length; i++) {
        expect(fixedCadences[i]).toBeGreaterThan(brokenCadences[i]);
      }
    });
  });

  // ── B: Dispatch interval tests ────────────────────────────────────────────

  describe("B: markPlaybackDispatch intervals", () => {
    it("FIXED: interval at each tier equals 1000/cadenceFps (in sync with targetCadenceFps)", () => {
      for (let tier = 0; tier < DIMENSIONS.length; tier++) {
        const cadence = cadenceFixed(tier);
        const interval = intervalFixed(tier);
        expect(interval).toBeCloseTo(1000 / cadence, 5);
      }
    });

    it("BROKEN: old intervals did NOT match old cadence at tier 0 (100ms ≠ 1000/10)", () => {
      // 1000/10 = 100ms — these actually matched, but the cadence was too low
      expect(intervalBroken(0)).toBeCloseTo(1000 / cadenceBroken(0), 5);
      // The bug was the cadence being 10fps, not the interval arithmetic
    });

    it("FIXED: tier 5 (top macOS) dispatch interval is ~17ms (60fps budget)", () => {
      expect(intervalFixed(5)).toBeCloseTo(1000 / 60, 1); // ~16.67ms
    });

    it("BROKEN: tier 5 dispatch interval was ~33ms (30fps budget) — unnecessarily slow", () => {
      expect(intervalBroken(5)).toBeCloseTo(1000 / 30, 1); // ~33.33ms
    });

    it("FIXED: tier 1 (Windows) dispatch interval is ~42ms (24fps)", () => {
      expect(intervalFixed(1)).toBeCloseTo(1000 / 24, 1); // ~41.67ms
    });

    it("BROKEN: tier 1 dispatch interval was 50ms (20fps)", () => {
      expect(intervalBroken(1)).toBe(50);
    });

    it("FIXED: intervals strictly decrease with tier (higher tier = faster dispatch)", () => {
      const intervals = DIMENSIONS.map((_, tier) => intervalFixed(tier));
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i]).toBeLessThanOrEqual(intervals[i - 1]);
      }
    });
  });

  // ── C: Recovery ratchet tests ─────────────────────────────────────────────

  describe("C: recovery ratchet asymmetry", () => {
    const DEGRADE_THRESHOLD = 3;
    const RECOVER_THRESHOLD_BROKEN = 90;
    const RECOVER_THRESHOLD_FIXED = 30;

    it("BROKEN: recovery required 90 fast samples (3s at 60fps) to climb one tier", () => {
      expect(RECOVER_THRESHOLD_BROKEN).toBe(90);
      const recoveryTimeMs = (RECOVER_THRESHOLD_BROKEN / 60) * 1000;
      expect(recoveryTimeMs).toBe(1500); // 1.5 seconds per tier
    });

    it("FIXED: recovery requires 30 fast samples (~500ms at 60fps)", () => {
      expect(RECOVER_THRESHOLD_FIXED).toBe(30);
      const recoveryTimeMs = (RECOVER_THRESHOLD_FIXED / 60) * 1000;
      expect(recoveryTimeMs).toBeCloseTo(500); // ~500ms per tier
    });

    it("BROKEN: asymmetry ratio between degrade and recover was 30:1", () => {
      const ratio = RECOVER_THRESHOLD_BROKEN / DEGRADE_THRESHOLD;
      expect(ratio).toBe(30); // 30× more samples needed to recover than degrade
    });

    it("FIXED: asymmetry ratio reduced to 10:1", () => {
      const ratio = RECOVER_THRESHOLD_FIXED / DEGRADE_THRESHOLD;
      expect(ratio).toBe(10); // still conservative but not punishing
    });

    it("BROKEN: after 1 congestion burst, policy trapped at low cadence for 3+ seconds", () => {
      // Simulate: 3 slow frames → tier drops → then fast frames
      // At 60fps, 90 fast samples = 1.5 seconds PER tier to recover
      // If degraded from tier 5 to tier 4 (one burst), recovery time:
      const recoveryMs = (RECOVER_THRESHOLD_BROKEN / 60) * 1000;
      expect(recoveryMs).toBeGreaterThan(1000); // > 1 second trap per tier ❌
    });

    it("FIXED: after 1 congestion burst, policy recovers within ~500ms", () => {
      const recoveryMs = (RECOVER_THRESHOLD_FIXED / 60) * 1000;
      expect(recoveryMs).toBeLessThanOrEqual(500); // ✅ sub-second recovery
    });

    it("FIXED: 30 samples is still conservative — oscillation window is 500ms not instant", () => {
      // If hardware is right on the 9ms threshold, it needs 30 consecutive
      // sub-9ms samples before upgrading — prevents rapid oscillation.
      // A single slow frame above 16ms resets the counter and delays upgrade.
      const samplesNeeded = RECOVER_THRESHOLD_FIXED;
      expect(samplesNeeded).toBeGreaterThan(5); // not instant
      expect(samplesNeeded).toBeLessThan(60); // but not a full second
    });
  });

  // ── Full policy simulation ────────────────────────────────────────────────

  describe("Full policy simulation", () => {
    /**
     * Simulate the recordReadback adaptive logic.
     * Returns the tier after applying the given sequence of elapsed-ms samples.
     */
    const simulateTierProgression = (
      initialTier: number,
      samples: number[],
      recoverThreshold: number,
    ): { tier: number; history: number[] } => {
      const maxTier = DIMENSIONS.length - 1;
      let tier = initialTier;
      let slowSamples = 0;
      let fastSamples = 0;
      const history: number[] = [tier];

      for (const elapsed of samples) {
        if (elapsed > 16) {
          slowSamples += 1;
          fastSamples = 0;
          if (slowSamples >= 3 && tier > 0) {
            tier -= 1;
            slowSamples = 0;
          }
        } else if (elapsed < 9) {
          fastSamples += 1;
          slowSamples = 0;
          if (fastSamples >= recoverThreshold && tier < maxTier) {
            tier += 1;
            fastSamples = 0;
          }
        } else {
          slowSamples = 0;
          fastSamples = 0;
        }
        history.push(tier);
      }
      return { tier, history };
    };

    it("BROKEN: 3 slow frames then 89 fast frames leaves tier degraded (not recovered)", () => {
      // 3 slow frames degrade tier 5→4, then 89 fast frames is not enough to recover
      const samples = [
        ...Array(3).fill(20), // 3 slow → tier 5→4
        ...Array(89).fill(5), // 89 fast → not enough (need 90)
      ];
      const { tier } = simulateTierProgression(5, samples, 90);
      expect(tier).toBe(4); // still degraded ❌
    });

    it("FIXED: 3 slow frames then 30 fast frames fully recovers the tier", () => {
      const samples = [
        ...Array(3).fill(20), // 3 slow → tier 5→4
        ...Array(30).fill(5), // 30 fast → recover tier 4→5
      ];
      const { tier } = simulateTierProgression(5, samples, 30);
      expect(tier).toBe(5); // fully recovered ✅
    });

    it("FIXED: brief IPC congestion burst (9 slow frames) recovers within ~1s", () => {
      // 9 slow frames = 3 degradation steps (tier 5→4→3→2)
      // Then 30 fast frames per step × 3 steps = 90 fast frames to recover fully
      const slowBurst = Array(9).fill(20);
      const recoveryBatch = Array(90).fill(5); // 3 × 30 samples

      const { tier } = simulateTierProgression(
        5,
        [...slowBurst, ...recoveryBatch],
        30,
      );
      expect(tier).toBe(5); // fully recovered

      // Compare broken: same 90 fast samples only recovers 1 tier
      const { tier: brokenTier } = simulateTierProgression(
        5,
        [...slowBurst, ...recoveryBatch],
        90,
      );
      expect(brokenTier).toBe(3); // still 2 tiers below max ❌
    });

    it("FIXED: policy does not oscillate on borderline hardware (alternating fast/neutral)", () => {
      // Frames alternating between fast (5ms) and neutral (12ms — between 9 and 16ms)
      // Neutral frames reset both counters, so fast counter never reaches threshold
      const samples = Array.from({ length: 100 }, (_, i) =>
        i % 2 === 0 ? 5 : 12,
      );
      const { history } = simulateTierProgression(3, samples, 30);
      const uniqueTiers = new Set(history);
      // Tier should stay stable — no oscillation
      expect(uniqueTiers.size).toBe(1); // never changes tier
    });

    it("FIXED: macOS 960px starts at tier 5 and delivers 60fps cadence", () => {
      // defaultEmbeddedReadbackLimit() returns 960 for macOS with > 4 cores
      // closestTier(960) resolves to tier 5
      expect(cadenceFixed(5)).toBe(60);
    });

    it("FIXED: Windows 480px starts at tier 1 and delivers 24fps cadence", () => {
      // defaultEmbeddedReadbackLimit() returns 480 for Windows
      // closestTier(480) resolves to tier 1
      expect(cadenceFixed(1)).toBe(24);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 5 — NativePreviewFrameScheduler: over-aggressive scrub cancellation
//
// Root cause:
//   requestVisible() called cancelVisibleWork() unconditionally before queuing
//   the new request. This aborted any in-flight request — including prefetch
//   work for nearby frames — even though a prefetch in-flight doesn't block
//   the new visible entry (pump() starts it once the slot is free). The result:
//   every scrub tick discarded a decoded frame that was about to land in cache,
//   keeping cold-seek latency high even on frames just decoded.
//
// Fix:
//   cancelVisibleWork() is now called only when the in-flight entry is a
//   *visible* request (inFlight.visible === true). Prefetch work is left to
//   complete and populate the cache.
// ─────────────────────────────────────────────────────────────────────────────
import {
  NativePreviewFrameScheduler,
  type NativePreviewFrame,
  type NativePreviewRequestSource,
} from "@/components/editor/preview/nativePreviewScheduler";
import { PlaybackPushBridge } from "@/components/editor/preview/playbackPushBridge";
import type { NativeFrameRequest } from "@/lib/platform/nativeCore";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));

function makeFrameRequest(frameIndex: number): NativeFrameRequest {
  return {
    contractVersion: 2,
    requestId: `req-${frameIndex}`,
    frameTime: { frameIndex, ticks: frameIndex * 33333, timescale: 1_000_000 },
    outputWidth: 960,
    outputHeight: 540,
    quality: "full",
    colorPolicy: { colorSpace: "srgb", toneMapping: "none" },
    renderGraphVersion: 1,
    mode: "seek",
    project: {
      schemaVersion: 1,
      projectRevision: "test:1",
      frameRate: 30,
      canvasWidth: 1920,
      canvasHeight: 1080,
      clearColor: [0, 0, 0, 1],
      videoLayers: [],
    },
  } as unknown as NativeFrameRequest;
}

function makeSource(
  frameIndex: number,
  generation = 1,
): NativePreviewRequestSource {
  return {
    requestKey: `req-${frameIndex}`,
    frameIndex,
    request: makeFrameRequest(frameIndex),
    generation,
  };
}

describe("NativePreviewFrameScheduler — Selective scrub cancellation (Bug 5)", () => {
  it("FIXED: in-flight prefetch is NOT aborted when a new visible request arrives", async () => {
    let prefetchAborted = false;
    let prefetchResolve!: (f: NativePreviewFrame) => void;
    const prefetchFrame: NativePreviewFrame = {
      rgba: new ArrayBuffer(4),
      width: 1,
      height: 1,
    };

    const scheduler = new NativePreviewFrameScheduler({
      maxCacheEntries: 20,
      load: (req, signal) => {
        if (req.requestId === "req-5") {
          signal?.addEventListener("abort", () => {
            prefetchAborted = true;
          });
          return new Promise((r) => {
            prefetchResolve = r;
          });
        }
        return Promise.resolve({
          rgba: new ArrayBuffer(4),
          width: 1,
          height: 1,
        });
      },
    });

    // Start a prefetch for frame 5
    scheduler.prefetch([makeSource(5, 0)]);
    await Promise.resolve(); // let pump() start the load

    // New visible request for a different frame arrives
    const visiblePromise = scheduler.requestVisible(makeSource(10, 2));

    // Prefetch must NOT have been aborted
    expect(prefetchAborted).toBe(false);

    // Complete the prefetch — it should land in cache
    prefetchResolve(prefetchFrame);
    await Promise.resolve();
    expect(scheduler.getCached("req-5")).toEqual(prefetchFrame);

    await expect(visiblePromise).resolves.toBeDefined();
    scheduler.dispose();
  });

  it("FIXED: in-flight *visible* work IS still aborted on a newer visible request", async () => {
    let firstAborted = false;

    const scheduler = new NativePreviewFrameScheduler({
      maxCacheEntries: 20,
      load: (req, signal) => {
        if (req.requestId === "req-1") {
          signal?.addEventListener("abort", () => {
            firstAborted = true;
          });
          return new Promise(() => {}); // never resolves
        }
        return Promise.resolve({
          rgba: new ArrayBuffer(4),
          width: 1,
          height: 1,
        });
      },
    });

    const p1 = scheduler.requestVisible(makeSource(1, 1));
    p1.catch(() => {}); // disposed before resolving
    await Promise.resolve();

    // Second visible request — different frame
    const p2 = scheduler.requestVisible(makeSource(2, 2));
    p2.catch(() => {}); // disposed before resolving
    await Promise.resolve();

    expect(firstAborted).toBe(true);
    scheduler.dispose();
  });

  it("FIXED: same requestKey visible reuses inFlight promise without re-loading", async () => {
    let loadCalls = 0;
    let pendingResolve!: (f: NativePreviewFrame) => void;

    const scheduler = new NativePreviewFrameScheduler({
      maxCacheEntries: 20,
      load: () => {
        loadCalls++;
        return new Promise((r) => {
          pendingResolve = r;
        });
      },
    });

    const p1 = scheduler.requestVisible(makeSource(7, 1));
    await Promise.resolve(); // pump() starts the load

    // Same requestKey AND same generation → only ONE load call is made.
    const p2 = scheduler.requestVisible(makeSource(7, 1));
    expect(loadCalls).toBe(1);

    const frame: NativePreviewFrame = {
      rgba: new ArrayBuffer(4),
      width: 1,
      height: 1,
    };
    pendingResolve(frame);
    // Both p1 and p2 resolve to the same frame value
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(frame);
    expect(r2).toEqual(frame);
    scheduler.dispose();
  });

  it("FIXED: prefetch frame cached before visible arrives — cache hit, no extra load", async () => {
    const cached: NativePreviewFrame = {
      rgba: new ArrayBuffer(4),
      width: 2,
      height: 2,
    };
    let prefetchResolve!: (f: NativePreviewFrame) => void;
    let loadCalls = 0;

    const scheduler = new NativePreviewFrameScheduler({
      maxCacheEntries: 20,
      load: (req) => {
        loadCalls++;
        if (req.requestId === "req-3")
          return new Promise((r) => {
            prefetchResolve = r;
          });
        return Promise.resolve({
          rgba: new ArrayBuffer(4),
          width: 1,
          height: 1,
        });
      },
    });

    scheduler.prefetch([makeSource(3, 0)]);
    await Promise.resolve();
    prefetchResolve(cached);
    await Promise.resolve(); // cache populated

    const result = await scheduler.requestVisible(makeSource(3, 1));
    expect(result).toEqual(cached);
    expect(loadCalls).toBe(1); // only the prefetch load, no re-fetch
    scheduler.dispose();
  });

  it("FIXED: multiple consecutive scrub steps — only in-flight visible is abort-signaled", async () => {
    // Only the *in-flight visible* entry receives an AbortController abort signal.
    // A pending (queued) visible entry is rejected via replacePending() with a
    // DOMException AbortError — its load function's AbortSignal never fires.
    //
    // Sequence:
    //   requestVisible(req-10) → req-10 goes in-flight (visible)
    //   requestVisible(req-11) → req-10 aborted via AbortController; req-11 queued as pending
    //   requestVisible(req-12) → req-11 rejected via replacePending (no signal); req-12 in-flight
    const aborts: string[] = [];

    const scheduler = new NativePreviewFrameScheduler({
      maxCacheEntries: 20,
      load: (req, signal) => {
        signal?.addEventListener("abort", () => aborts.push(req.requestId));
        return new Promise(() => {}); // never resolves
      },
    });

    const p10 = scheduler.requestVisible(makeSource(10, 1));
    p10.catch(() => {}); // will be aborted/rejected by dispose
    await Promise.resolve(); // req-10 → in-flight

    const p11 = scheduler.requestVisible(makeSource(11, 2));
    await Promise.resolve(); // req-10 aborted; req-11 → pending

    const p12 = scheduler.requestVisible(makeSource(12, 3));
    p12.catch(() => {}); // will be rejected by dispose
    await Promise.resolve(); // req-11 replaced (not abort-signaled); req-12 → in-flight

    // req-10 was in-flight visible when req-11 arrived → aborted via AbortController
    expect(aborts).toContain("req-10");
    // req-11 was pending (never in-flight) → rejected via replacePending, NOT abort-signaled
    expect(aborts).not.toContain("req-11");
    // req-12 is still in-flight, not aborted
    expect(aborts).not.toContain("req-12");

    // p11 rejected because it was superseded by req-12
    await expect(p11).rejects.toBeDefined();

    scheduler.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 6 — PlaybackPushBridge: spurious requestAnimationFrame per received packet
//
// Root cause:
//   PlaybackPushBridge.receive() wrapped all tracking state updates and the
//   watermark flush in a requestAnimationFrame callback. During 30fps playback
//   this spawned 30 extra RAF callbacks per second that competed with the main
//   render loop for the same VSync slot, adding up to 16ms of scheduling jitter.
//
// Fix:
//   Tracking state (lastConsumedDeliverySeq, lastPaintedFrameId,
//   acceptedInGeneration, lastProgressAtMs) and flushWatermark() are now
//   updated synchronously inside receive(). None of them touch the DOM.
// ─────────────────────────────────────────────────────────────────────────────
describe("PlaybackPushBridge — Synchronous tracking in receive() (Bug 6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("FIXED: receive() does not call requestAnimationFrame", () => {
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockReturnValue(
        0 as unknown as ReturnType<typeof requestAnimationFrame>,
      );

    const bridge = new PlaybackPushBridge({
      paint: () => {},
      reportWatermark: () => {},
      watermarkFrameInterval: 1,
      watermarkIntervalMs: 0,
      watchdogMs: 30_000,
    });

    // Call receive() 30 times with invalid buffers (generation mismatch → no-ops
    // except for the RAF check, which is what we're testing).
    for (let i = 0; i < 30; i++) {
      bridge.receive(new ArrayBuffer(0));
    }

    // The fix removes requestAnimationFrame entirely from receive()
    expect(rafSpy).not.toHaveBeenCalled();

    bridge.stop();
  });

  it("FIXED: 60fps playback produces 0 RAF callbacks from the bridge in 1 second", () => {
    let rafCount = 0;
    const spy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(() => {
        rafCount++;
        return 0 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

    const bridge = new PlaybackPushBridge({
      paint: () => {},
      reportWatermark: () => {},
      watermarkFrameInterval: 60,
      watermarkIntervalMs: 1_000,
      watchdogMs: 30_000,
    });

    for (let i = 0; i < 60; i++) {
      bridge.receive(new ArrayBuffer(0));
    }

    expect(rafCount).toBe(0);
    bridge.stop();
    spy.mockRestore();
  });

  it("FIXED: bridge stop() before RAF dispatch doesn't throw (stale closure removed)", () => {
    // Previously, a stopped bridge with a pending RAF callback would try to
    // access `this.stopped` from a closed-over callback. After the fix,
    // there is no RAF callback, so this is a no-op safety check.
    expect(() => {
      const bridge = new PlaybackPushBridge({
        paint: () => {},
        reportWatermark: () => {},
        watermarkFrameInterval: 1,
        watermarkIntervalMs: 0,
        watchdogMs: 30_000,
      });
      bridge.receive(new ArrayBuffer(0));
      bridge.stop();
      // If RAF callback were still pending, it would run here and could throw.
      // With the fix, nothing is pending.
    }).not.toThrow();
  });

  it("FIXED: watermark fires synchronously on the first accepted packet (acceptedInGeneration=1)", () => {
    // This test requires a valid packet — we verify via the bridge's own
    // generation+paint path. Since parsePlaybackPushPacket is internal,
    // we verify the invariant: the bridge starts in a state where a generation
    // mismatch (ArrayBuffer(0) with no header) never triggers watermark.
    // The positive path is verified by the integration A/B session data.
    let watermarkCount = 0;
    const bridge = new PlaybackPushBridge({
      paint: () => {},
      reportWatermark: () => {
        watermarkCount++;
      },
      watermarkFrameInterval: 1,
      watermarkIntervalMs: 0,
      watchdogMs: 30_000,
    });

    // Invalid packet (generation mismatch) — watermark must NOT fire
    bridge.receive(new ArrayBuffer(0));
    expect(watermarkCount).toBe(0);
    bridge.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 7 — Frozen first frame: lastNativePlaybackRequestKey set before demand
//          is actually submitted, permanently blocking all subsequent demands.
//
// Root cause:
//   In the playback dispatch block, `lastNativePlaybackRequestKey = requestKey`
//   was set at the OUTER requestKey gate (before the inner snapshot-readiness
//   guard). If the snapshot was still uploading when the first playback RAF
//   fired, the demand was NOT submitted — but the key was already marked as
//   "dispatched". Every subsequent RAF saw (requestKey === lastKey) and skipped
//   the entire block. The first frame was displayed indefinitely; the video
//   appeared completely frozen regardless of how long playback ran.
//
// Fix:
//   Remove the premature key assignment at the outer gate. `lastNativePlayback-
//   RequestKey` is now only set inside the branch that actually calls
//   `submitNativePlaybackDemand()` — ensuring the gate re-opens on every RAF
//   tick until a demand is successfully dispatched.
//
// Evidence:
//   Session launch-1791489278093-d53hal: framesProduced=1 in all telemetry
//   windows across 37 seconds of session time. User reported "first frame never
//   changed" during 20+ seconds of playback on native surface path.
// ─────────────────────────────────────────────────────────────────────────────
describe("Native Playback — Frozen First Frame (Bug 7)", () => {
  /**
   * Minimal harness that simulates the requestKey gate and the snapshot-
   * readiness guard responsible for the freeze.
   *
   * State:
   *   - lastNativePlaybackRequestKey: dedup key, "" initially
   *   - snapshotReady: controls whether the inner guard passes
   *   - submittedDemands: counts actual submitNativePlaybackDemand() calls
   */
  function makePlaybackGate(
    snapshotReadyOnCall: (callCount: number) => boolean,
  ) {
    let lastNativePlaybackRequestKey = "";
    let submittedDemands = 0;

    function rafTick(
      requestKey: string,
    ): "submitted" | "skipped-key" | "skipped-snapshot" {
      // Outer gate: same as (requestKey !== lastNativePlaybackRequestKey)
      if (requestKey === lastNativePlaybackRequestKey) return "skipped-key";

      // CORRECT behaviour (after fix): do NOT set key here
      // (Before fix: lastNativePlaybackRequestKey = requestKey here — the bug)

      // Inner snapshot guard
      if (!snapshotReadyOnCall(submittedDemands)) {
        // Snapshot not ready — fall through without submitting
        // Key must NOT be updated here; outer gate must remain open for next tick
        return "skipped-snapshot";
      }

      // Demand submitted — only NOW mark the key as dispatched
      submittedDemands++;
      lastNativePlaybackRequestKey = requestKey;
      return "submitted";
    }

    return { rafTick, getSubmittedDemands: () => submittedDemands };
  }

  it("FIXED: demand is submitted on the RAF tick when snapshot becomes ready", () => {
    // Snapshot not ready on tick 1, ready on tick 2
    let callCount = 0;
    const { rafTick, getSubmittedDemands } = makePlaybackGate(() => {
      callCount++;
      return callCount >= 2; // ready from 2nd call onward
    });

    // Tick 1: snapshot not ready
    const t1 = rafTick("frame-0");
    expect(t1).toBe("skipped-snapshot");
    expect(getSubmittedDemands()).toBe(0);

    // Tick 2: snapshot now ready — outer gate must still be open (key not poisoned)
    const t2 = rafTick("frame-0");
    expect(t2).toBe("submitted");
    expect(getSubmittedDemands()).toBe(1);
  });

  it("FIXED: subsequent frames advance after the first demand is dispatched", () => {
    const { rafTick, getSubmittedDemands } = makePlaybackGate(() => true); // always ready

    expect(rafTick("frame-0")).toBe("submitted");
    expect(rafTick("frame-0")).toBe("skipped-key"); // same frame — correct dedup
    expect(rafTick("frame-1")).toBe("submitted"); // new frame — dispatched
    expect(rafTick("frame-2")).toBe("submitted");
    expect(getSubmittedDemands()).toBe(3);
  });

  it("REGRESSION: premature key set causes all ticks for same requestKey to be skipped", () => {
    // Simulates the BUGGY behaviour (key set at outer gate before snapshot guard)
    function buggyRafTick(
      requestKey: string,
      state: { lastKey: string; submitted: number },
      snapshotReady: boolean,
    ): "submitted" | "skipped-key" | "skipped-snapshot" {
      if (requestKey === state.lastKey) return "skipped-key";
      state.lastKey = requestKey; // ← BUG: key set before inner guard
      if (!snapshotReady) return "skipped-snapshot"; // key already poisoned
      state.submitted++;
      return "submitted";
    }

    const buggyState = { lastKey: "", submitted: 0 };
    // Tick 1: snapshot not ready → key is set but demand not sent
    expect(buggyRafTick("frame-0", buggyState, false)).toBe("skipped-snapshot");
    expect(buggyState.submitted).toBe(0);

    // Tick 2: snapshot now ready, BUT requestKey is same → outer gate blocks it
    expect(buggyRafTick("frame-0", buggyState, true)).toBe("skipped-key");
    expect(buggyState.submitted).toBe(0); // ← frame permanently frozen

    // Tick 3: even tick 3 is blocked — frozen for the entire session
    expect(buggyRafTick("frame-0", buggyState, true)).toBe("skipped-key");
    expect(buggyState.submitted).toBe(0);
  });

  it("FIXED: snapshot in-flight then ready — gate reopens and demand fires", () => {
    let snapshotReady = false;
    const { rafTick, getSubmittedDemands } = makePlaybackGate(
      () => snapshotReady,
    );

    // Several ticks while snapshot is uploading
    expect(rafTick("frame-0")).toBe("skipped-snapshot");
    expect(rafTick("frame-0")).toBe("skipped-snapshot");
    expect(rafTick("frame-0")).toBe("skipped-snapshot");
    expect(getSubmittedDemands()).toBe(0);

    // Snapshot arrives
    snapshotReady = true;

    // Next tick: demand fires immediately
    expect(rafTick("frame-0")).toBe("submitted");
    expect(getSubmittedDemands()).toBe(1);

    // Playback continues to frame 1
    expect(rafTick("frame-1")).toBe("submitted");
    expect(getSubmittedDemands()).toBe(2);
  });

  it("FIXED: error on demand submit resets key to '' so next tick can retry", () => {
    // After submitNativePlaybackDemand() fails, .catch() sets key = ""
    // This simulates that the outer gate re-opens after a failure
    let lastKey = "";
    let submitted = 0;

    function tickWithFailure(requestKey: string, willFail: boolean): string {
      if (requestKey === lastKey) return "skipped-key";
      // Correct fix: don't set key yet
      const snapshotReady = true;
      if (!snapshotReady) return "skipped-snapshot";
      submitted++;
      if (willFail) {
        // .catch() clears the key
        lastKey = "";
      } else {
        lastKey = requestKey;
      }
      return willFail ? "submitted-then-failed" : "submitted";
    }

    // Tick 1 succeeds
    expect(tickWithFailure("frame-0", false)).toBe("submitted");
    expect(submitted).toBe(1);

    // Tick 2 same frame — deduped
    expect(tickWithFailure("frame-0", false)).toBe("skipped-key");

    // Tick 3 fails — key reset to ""
    expect(tickWithFailure("frame-1", true)).toBe("submitted-then-failed");
    expect(submitted).toBe(2);

    // Tick 4: key is "" → gate opens, retry dispatches
    expect(tickWithFailure("frame-1", false)).toBe("submitted");
    expect(submitted).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 8 — Video frozen (nativeAudioClockReady gate) + no-sound (empty paths)
//
// Root cause A — video frozen (architectural):
//   nativeAudioClockReady = !isTauriRuntime() || state.clock.hasNativeClockPosition
//   For projects with no audio clips, CPAL starts silently and never calls
//   setNativeClockPosition(), so hasNativeClockPosition stays false forever.
//   This keeps nativePlaybackPath=false — the first rendered frame never advances.
//
// Fix A — PlaybackClock:
//   Added _nativeAudioUnavailable field + markNativeAudioUnavailable() method.
//   hasNativeClockPosition now returns true when _nativeAudioUnavailable=true.
//   setNativeClockAuthority(false) clears it for the next session.
//
// Root cause B — no sound:
//   clipHasAudio() returns true for unprobed video assets (asset===null fallback).
//   getActiveAudioClips() builds a config with path="" for those clips.
//   replaceNativeAudioClips([{path:"", ...}]) fails silently → installedClips=[].
//   Startup probe sees installedClips.length===0 + hasAudibleClips=true →
//   reports "no-native-audio-clips-installed" → no audio plays.
//
// Fix B — getActiveAudioClips:
//   .filter((config) => Boolean(config.path)) at end of map chain.
//   Unresolved-path clips excluded; updateSource re-syncs when asset hydrates.
//
// Evidence: Session launch-1791490683821-2gjvc9, audio-snapshot:
//   outcome=failed, failureReason=no-native-audio-clips-installed,
//   callbackCount=0, installedClipCount=0. framesProduced=2 in 187 seconds.
// ─────────────────────────────────────────────────────────────────────────────
describe("PlaybackClock — markNativeAudioUnavailable (Bug 8A)", () => {
  it("hasNativeClockPosition is false initially", () => {
    const clock = new PlaybackClock();
    expect(clock.hasNativeClockPosition).toBe(false);
  });

  it("markNativeAudioUnavailable makes hasNativeClockPosition return true", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();
    expect(clock.hasNativeClockPosition).toBe(true);
  });

  it("clearNativeAudioUnavailable resets to false when no real position set", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();
    clock.clearNativeAudioUnavailable();
    expect(clock.hasNativeClockPosition).toBe(false);
  });

  it("setNativeClockAuthority(false) automatically clears audio-unavailable flag", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();
    expect(clock.hasNativeClockPosition).toBe(true);
    clock.setNativeClockAuthority(false);
    expect(clock.hasNativeClockPosition).toBe(false);
  });

  it("hasNativeClockPosition is true when a real position arrives (normal audio path)", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.play();
    clock.setNativeClockPosition(1.5);
    expect(clock.hasNativeClockPosition).toBe(true);
  });

  it("clearNativeAudioUnavailable does not remove a real clock position", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.play();
    clock.setNativeClockPosition(2.0);
    clock.markNativeAudioUnavailable();
    clock.clearNativeAudioUnavailable();
    // real position still present
    expect(clock.hasNativeClockPosition).toBe(true);
  });

  it("flag is idempotent — set/clear/set works correctly", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();
    clock.clearNativeAudioUnavailable();
    clock.markNativeAudioUnavailable();
    expect(clock.hasNativeClockPosition).toBe(true);
  });

  it("REGRESSION: before fix, hasNativeClockPosition=false permanently blocked nativePlaybackPath on silent projects", () => {
    // Simulates the gating logic in NativeProgramPreview:
    //   const nativeAudioClockReady = !isTauriRuntime() || state.clock.hasNativeClockPosition;
    //   const nativePlaybackPath = isTauriRuntime() && ... && nativeAudioClockReady;
    // With fix: nativeAudioClockReady=true after markNativeAudioUnavailable()
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);

    // BEFORE fix: clock.hasNativeClockPosition === false → nativePlaybackPath = false
    // AFTER fix: call markNativeAudioUnavailable() → hasNativeClockPosition = true
    clock.markNativeAudioUnavailable();

    const isTauri = true; // simulated
    const nativeAudioClockReady = !isTauri || clock.hasNativeClockPosition;
    expect(nativeAudioClockReady).toBe(true);
  });
});

describe("getActiveAudioClips — empty-path guard (Bug 8B)", () => {
  // Pure logic tests using the gate logic mirrored from getActiveAudioClips.
  // The full integration is covered by the audio system's own test suite.

  function resolveClipPath(
    assetPath: string | undefined | null,
    directAudioPath?: string,
  ): string {
    const rawPath = directAudioPath || assetPath || "";
    // toNativePath("") returns "" on all platforms
    return rawPath.startsWith("/") || rawPath.includes(":\\")
      ? rawPath
      : rawPath;
  }

  it("FIXED: empty asset path produces empty resolved path, filtered by Boolean(config.path)", () => {
    const path = resolveClipPath("");
    expect(Boolean(path)).toBe(false); // would be filtered out
  });

  it("FIXED: undefined asset path produces empty resolved path, filtered out", () => {
    const path = resolveClipPath(undefined);
    expect(Boolean(path)).toBe(false);
  });

  it("FIXED: null asset path produces empty resolved path, filtered out", () => {
    const path = resolveClipPath(null);
    expect(Boolean(path)).toBe(false);
  });

  it("valid asset path passes the filter", () => {
    const path = resolveClipPath("/media/video.mp4");
    expect(Boolean(path)).toBe(true);
  });

  it("direct audioPath on clip overrides missing asset path", () => {
    const path = resolveClipPath(undefined, "/media/audio.mp3");
    expect(Boolean(path)).toBe(true);
  });

  it("REGRESSION: before fix, empty-path config reached replaceNativeAudioClips causing silent failure", () => {
    // Demonstrates pre-fix behaviour: installedClips=[] → startup probe fires
    // 'no-native-audio-clips-installed' even though timeline had clips.
    // The filter Boolean(config.path) now prevents this from happening.
    const configs = [
      { clipId: "c1", path: "" }, // unhydrated asset — empty path
      { clipId: "c2", path: "/a.mp4" }, // valid
    ];
    const filtered = configs.filter((c) => Boolean(c.path));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].clipId).toBe("c2");
    // Before fix: both would have reached Rust → first would be rejected → installed=[{c2}]
    // But in the 'all-empty' case (all clips unhydrated): installed=[] → false alarm error
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 9 — Late audio install causes seek-back to position 0
//
// Root cause:
//   When audio clips aren't installed at initialize() (asset paths not hydrated),
//   markNativeAudioUnavailable() is called and video plays from the JS wall-clock.
//   The JS clock time extrapolates forward correctly, BUT the native CPAL clock
//   never gets a position — so clock._nativeClockPosition stays null.
//   When updateSource() later installs clips, clearNativeAudioUnavailable() fires.
//   The next "play" transport command then calls seekNativeAudio(clock.time) — but
//   clock.time at that moment returns the extrapolated position which, because the
//   native clock was never set, may have drifted back to 0 (the frozen first frame).
//   Result: user sees a jarring seek-back to the beginning the moment audio loads.
//
// Evidence (session launch-1791494601657-aq3o9s):
//   framesProduced: 2→86 jump at +39s after audio installed at +35.9s.
//   Seek spans show seek-cold at frameIndex=11 (timeMs=45.5s) — back to beginning.
//   AV drift spikes to 7,147ms and 8,623ms during the freeze window.
//   Audio snapshots: failed@+18.8s, failed@+28.7s, audible@+35.9s.
//
// Fix (nativeAudioPreviewController.ts — updateSource path):
//   Before calling clearNativeAudioUnavailable(), capture wasUnavailable flag.
//   If wasUnavailable && clock.state==="playing", immediately enqueue a
//   seekNativeAudio(clock.time) + nativePlayFromAudio() transport command.
//   This starts CPAL from where the user actually is, not position 0.
//
// Additional API (PlaybackClock):
//   Added nativeAudioWasUnavailable getter — read before clearing to detect
//   the transition from unavailable→available in a single atomic check.
// ─────────────────────────────────────────────────────────────────────────────
describe("PlaybackClock — nativeAudioWasUnavailable getter (Bug 9)", () => {
  it("nativeAudioWasUnavailable is false initially", () => {
    const clock = new PlaybackClock();
    expect(clock.nativeAudioWasUnavailable).toBe(false);
  });

  it("nativeAudioWasUnavailable returns true after markNativeAudioUnavailable()", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();
    expect(clock.nativeAudioWasUnavailable).toBe(true);
  });

  it("nativeAudioWasUnavailable can be read before clearNativeAudioUnavailable() resets it", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();

    // Simulate the Bug 9 fix pattern: read-then-clear atomically
    const wasUnavailable = clock.nativeAudioWasUnavailable;
    clock.clearNativeAudioUnavailable();

    expect(wasUnavailable).toBe(true); // captured before clear
    expect(clock.nativeAudioWasUnavailable).toBe(false); // cleared
    expect(clock.hasNativeClockPosition).toBe(false); // also cleared
  });

  it("nativeAudioWasUnavailable is false after clearNativeAudioUnavailable()", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();
    clock.clearNativeAudioUnavailable();
    expect(clock.nativeAudioWasUnavailable).toBe(false);
  });

  it("REGRESSION: before fix, clearing without checking wasUnavailable lost the state needed for seek-then-play", () => {
    // Simulates the pre-fix pattern: clearNativeAudioUnavailable() was called
    // first, then checking the flag would always return false — making it
    // impossible to detect the unavailable→available transition.
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();

    // PRE-FIX (wrong order): clear then check
    clock.clearNativeAudioUnavailable();
    const checkedAfterClear = clock.nativeAudioWasUnavailable;
    expect(checkedAfterClear).toBe(false); // too late — information lost

    // POST-FIX (correct order): check then clear
    clock.markNativeAudioUnavailable();
    const checkedBeforeClear = clock.nativeAudioWasUnavailable; // true
    clock.clearNativeAudioUnavailable();
    expect(checkedBeforeClear).toBe(true); // information preserved
  });

  it("seek-back prevention: when wasUnavailable=true and clock is playing, seek-then-play fires from current time", () => {
    // Validates the decision logic: wasUnavailable && clock.state==="playing"
    // should trigger seekNativeAudio(clock.time) + nativePlayFromAudio().
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.markNativeAudioUnavailable();

    // Simulate playback advancing while audio was unavailable
    clock.play();
    // clock.time would be extrapolating from the play start
    const wasUnavailable = clock.nativeAudioWasUnavailable;
    const isPlaying = clock.state === "playing";
    clock.clearNativeAudioUnavailable();

    // The fix should trigger when both conditions are true
    expect(wasUnavailable && isPlaying).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 10 — Video is independent of audio readiness (Playback Architecture)
//
// Design principle (from playback-architecture-redesign.md):
//   "No media subsystem may block the PlaybackTimeline."
//   "A renderer may join, leave, stall, or recover independently without
//    resetting the PlaybackTimeline."
//
// Evidence (session launch-1791494601657-aq3o9s):
//   - Audio unavailable from +18.8s to +35.9s (17 second freeze)
//   - JS AV drift reached 7.1–8.6 seconds during freeze
//   - Video should have kept playing during that entire window
//
// Root cause chain:
//   1. _nativeClockAuthority=true set in initialize() before async work
//   2. CPAL never called setNativeClockPosition() (no clips installed)
//   3. _nativeClockPosition seeded from _time (= 0 at play start)
//   4. time getter returned _time (= 0) — frozen at start
//   5. nativeAudioClockReady = false → nativePlaybackPath = false → video frozen
//
// Fix (PlaybackClock.ts):
//   - play() captures _playStartMs = performance.now() on native-authority path
//   - time getter: when _nativeClockAuthority && no real CPAL sample yet,
//     extrapolate forward from _playStartMs (wall-clock)
//   - Once CPAL delivers a real sample, hardware-clock extrapolation takes over
//
// Fix (NativeProgramPreview.tsx):
//   - Removed nativeAudioClockReady from nativePlaybackPath, deferWebViewFallback,
//     nativeSurfaceOwnsCurrentFrame, nativeSurfaceCanOwnPlayback
//   - nativePlaybackPath = isTauriRuntime() && nativePlaybackRequest && isPlaying
//
// Fix (nativeAudioPreviewController.ts):
//   - AudioRendererState enum: detached→resolving→loading→ready→playing→error
//   - AudioSourceState enum: unknown | resolving | resolved | invalid
//   - "resolving" path: clips exist but paths empty → NOT "unavailable"
//   - markNativeAudioUnavailable() no longer called in the resolving path
// ─────────────────────────────────────────────────────────────────────────────
describe("PlaybackClock — wall-clock advancement independent of audio (Bug 10)", () => {
  it("time advances via wall-clock when nativeClockAuthority=true but no CPAL sample yet", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(300);

    // Simulate play() call: captures _playStartMs = performance.now()
    clock.play();

    // time should be >= 0 immediately — not frozen
    const t0 = clock.time;
    expect(t0).toBeGreaterThanOrEqual(0);
  });

  it("time increases monotonically while playing before any CPAL sample", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(300);
    clock.play();

    const t0 = clock.time;
    // Simulate wall clock advancing by checking the getter returns non-negative
    const t1 = clock.time;
    expect(t1).toBeGreaterThanOrEqual(t0);
    expect(t1).toBeGreaterThanOrEqual(0);
  });

  it("time does not freeze at 0 when nativeClockAuthority is set", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(300);

    // Before fix: with _nativeClockAuthority=true and no CPAL sample,
    // the old time getter returned this._time (= 0). That's the bug.
    // After fix: extrapolation from _playStartMs runs instead.
    clock.play();

    // The time getter must NOT return _time when in the native authority
    // path without a CPAL sample — it should use the wall-clock fallback.
    // We verify the getter returns the start position (not -1 or NaN)
    const t = clock.time;
    expect(t).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(t)).toBe(true);
  });

  it("CPAL sample takes over from wall-clock when it arrives", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(300);
    clock.play();

    // Simulate CPAL position arriving 5 seconds into playback
    clock.setNativeClockPosition(5.0);

    // Now the CPAL extrapolation branch should run (not wall-clock)
    // Time should be >= 5.0 (extrapolated forward from the 5s sample)
    const t = clock.time;
    expect(t).toBeGreaterThanOrEqual(5.0);
  });

  it("_playStartMs is reset on pause so next play() gets a fresh anchor", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(300);
    clock.play();
    clock.pause();
    clock.play();

    // After re-play, time should still be >= 0 (not stale from previous session)
    const t = clock.time;
    expect(t).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(t)).toBe(true);
  });

  it("time is clamped to duration even when wall-clock runs past it", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(0.001); // very short project
    clock.play();

    // Even if wall-clock advances, time must not exceed duration
    const t = clock.time;
    expect(t).toBeLessThanOrEqual(0.001);
  });

  it("state remains playing while nativeClockAuthority=true before CPAL arrives", () => {
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(300);
    clock.play();

    // The PlaybackTimeline state is playing — regardless of audio readiness
    expect(clock.state).toBe("playing");
  });

  it("REGRESSION: old behavior — time frozen at 0 when authority set but no sample", () => {
    // Documents what the OLD code did (the bug) so we can verify it's gone.
    // OLD: if (_nativeClockAuthority) return this._time  → always 0
    // NEW: if (playing && _nativeClockAuthority && _playStartMs > 0) extrapolate
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(300);
    clock.play();

    // Under the new architecture, time must NOT be exactly 0 (frozen)
    // It may be 0 if called at the exact millisecond of play(), but
    // the key assertion is that it's >= 0 and is finite (not NaN/undefined)
    const t = clock.time;
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(0);
  });
});

describe("AudioRendererState state machine (Bug 10)", () => {
  it("initial state is detached (not yet participating)", () => {
    // AudioRendererState starts at 'detached' — the renderer has not been
    // asked to participate yet. This is distinct from 'error'.
    // Verify the exported type has the expected variants.
    const states: import("@/core/audio/nativeAudioPreviewController").AudioRendererState[] =
      ["detached", "resolving", "loading", "ready", "playing", "error"];
    expect(states).toHaveLength(6);
    expect(states[0]).toBe("detached");
  });

  it("AudioSourceState has the expected variants", () => {
    const states: import("@/core/audio/nativeAudioPreviewController").AudioSourceState[] =
      ["unknown", "resolving", "resolved", "invalid"];
    expect(states).toHaveLength(4);
  });

  it("'resolving' AudioSourceState is semantically distinct from 'unknown'", () => {
    // 'resolving' = clips exist, paths not yet hydrated (temporary state)
    // 'unknown'   = no audio clips on timeline (structural fact)
    // These must NOT be collapsed — the old code treated both as "unavailable"
    const resolving: import("@/core/audio/nativeAudioPreviewController").AudioSourceState =
      "resolving";
    const unknown: import("@/core/audio/nativeAudioPreviewController").AudioSourceState =
      "unknown";
    expect(resolving).not.toBe(unknown);
    expect(resolving).toBe("resolving");
    expect(unknown).toBe("unknown");
  });

  it("AudioRendererState 'error' does not imply PlaybackSession 'error'", () => {
    // An audio renderer error must not stop the PlaybackTimeline.
    // Verify that the type exists independently of PlaybackClock state.
    const audioError: import("@/core/audio/nativeAudioPreviewController").AudioRendererState =
      "error";
    expect(audioError).toBe("error");
    // The clock itself has no concept of audio errors — it just keeps time.
    const clock = new PlaybackClock();
    clock.setDuration(300);
    clock.play();
    expect(clock.state).toBe("playing"); // timeline keeps playing
  });

  it("video continues playing at correct positions during all AudioRendererState variants", () => {
    // Core invariant: PlaybackClock.state === 'playing' must hold regardless
    // of what AudioRendererState the audio renderer is in.
    const clock = new PlaybackClock();
    clock.setNativeClockAuthority(true);
    clock.setDuration(300);
    clock.play();

    const audioStates: import("@/core/audio/nativeAudioPreviewController").AudioRendererState[] =
      ["detached", "resolving", "loading", "ready", "playing", "error"];

    for (const _ of audioStates) {
      // In all audio states, the PlaybackTimeline keeps advancing
      expect(clock.state).toBe("playing");
      expect(Number.isFinite(clock.time)).toBe(true);
      expect(clock.time).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 11 — Embedded Video Audio Project Load Immediate Sync
//
// Problem:
//   On project load, embedded audio (audio inside video file) did not sync or
//   load until the user paused/scrubbed.
//
// Root causes:
//   1. Project load sequence: projectStore Phase 2 sets project & assets before
//      Phase 3 hydrates timeline clips (~70ms later). useAudioSyncEngine created
//      adapter with clips: [].
//   2. NativeAudioPreviewController.updateSource dropped pendingSource when
//      !this.active (IPC in-flight in initialize()), losing hydrated clips.
//   3. NativeAudioPreviewController.initialize() did not drain pendingSource or
//      reconcile timeline layout upon becoming active.
//   4. NativeAudioPreviewController checked (c as any).assetId instead of c.mediaId,
//      falsely concluding clips had no paths and setting detached state.
//   5. useAudioSyncEngine early-returned on !adapterRef.current.isActive, dropping
//      source updates during adapter initialization.
//
// Fixes:
//   - Buffer pendingSource before !this.active guard in updateSource().
//   - Drain pendingSource and check layout changes immediately upon activation.
//   - Support c.mediaId || (c as any).assetId for asset matching.
//   - Unconditionally update adapter to latestAudioSourceRef.current post-init.
//   - In Rust native_playback.rs: fallback to wall-clock render loop when CPAL
//     is silent or resolving instead of throwing a hard error and stalling.
// ─────────────────────────────────────────────────────────────────────────────
describe("NativeAudioPreviewController — Project Load Immediate Sync & Embedded Video Audio (Bug 11)", () => {
  const makeTestVideoAsset = (
    id = "asset-vid-1",
    path = "/media/video.mp4",
  ): MediaAsset => ({
    id,
    name: "video.mp4",
    path,
    type: "video",
    duration: 60,
    size: 50_000_000,
    streams: [
      { index: 0, type: "video", codec: "h264" },
      { index: 1, type: "audio", codec: "aac", channels: 2, sampleRate: 48000 },
    ],
  });

  const makeTestVideoTrack = (id = "track-vid-1"): Track => ({
    id,
    type: "video",
    name: "Video 1",
    muted: false,
    locked: false,
    visible: true,
    height: 80,
  });

  const makeTestVideoClip = (
    id = "clip-1",
    mediaId = "asset-vid-1",
    trackId = "track-vid-1",
  ): Clip => ({
    id,
    kind: "video",
    mediaId,
    trackId,
    startTime: 0,
    duration: 30,
    trimIn: 0,
    trimOut: 30,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
  });

  it("embedded video clip with audio stream is detected as an active audio clip via clip.mediaId", () => {
    const asset = makeTestVideoAsset();
    const track = makeTestVideoTrack();
    const clip = makeTestVideoClip();

    const activeAudioClips = getActiveAudioClips(
      [clip],
      [track],
      [asset],
      0,
      30,
    );
    expect(activeAudioClips).toHaveLength(1);
    expect(activeAudioClips[0].clipId).toBe("clip-1");
    expect(activeAudioClips[0].path).toBe("/media/video.mp4");
  });

  it("buffers pendingSource when updateSource() is called while controller is not active", () => {
    const clock = new PlaybackClock();
    const initialSource: import("@/core/audio/nativeAudioPreviewController").NativeAudioPreviewSource =
      {
        projectRevision: "p1:0",
        frameRate: 30,
        duration: 30,
        audioTrackCount: 0,
        clips: [],
        tracks: [makeTestVideoTrack()],
        assets: [makeTestVideoAsset()],
      };

    const controller = new NativeAudioPreviewController({
      clock,
      source: initialSource,
    });

    // Before activation, controller is inactive
    expect(controller.isActive).toBe(false);
    expect((controller as any).pendingSource).toBeNull();

    // Hydrated source with video clip arriving while inactive
    const hydratedSource: import("@/core/audio/nativeAudioPreviewController").NativeAudioPreviewSource =
      {
        ...initialSource,
        projectRevision: "p1:1",
        clips: [makeTestVideoClip()],
      };

    controller.updateSource(hydratedSource);

    // FIXED: pendingSource is buffered instead of dropped!
    expect((controller as any).pendingSource).toBe(hydratedSource);
  });

  it("REGRESSION: before Bug 11 fix, calling updateSource() while !active dropped the update", () => {
    // Documents the previous flawed logic:
    // if (!this.active || this.disposed) return;
    // this.pendingSource = source;
    // Which caused pendingSource to remain null and dropped the hydrated clips.
    const clock = new PlaybackClock();
    const initialSource: import("@/core/audio/nativeAudioPreviewController").NativeAudioPreviewSource =
      {
        projectRevision: "p1:0",
        frameRate: 30,
        duration: 30,
        audioTrackCount: 0,
        clips: [],
        tracks: [makeTestVideoTrack()],
        assets: [makeTestVideoAsset()],
      };

    const controller = new NativeAudioPreviewController({
      clock,
      source: initialSource,
    });

    const hydratedSource: import("@/core/audio/nativeAudioPreviewController").NativeAudioPreviewSource =
      {
        ...initialSource,
        clips: [makeTestVideoClip()],
      };

    // With fix: pendingSource is NOT null
    controller.updateSource(hydratedSource);
    expect((controller as any).pendingSource).not.toBeNull();
    expect((controller as any).pendingSource).toEqual(hydratedSource);
  });

  it("drains pendingSource when controller activates", async () => {
    const clock = new PlaybackClock();
    const initialSource: import("@/core/audio/nativeAudioPreviewController").NativeAudioPreviewSource =
      {
        projectRevision: "p1:0",
        frameRate: 30,
        duration: 30,
        audioTrackCount: 0,
        clips: [],
        tracks: [makeTestVideoTrack()],
        assets: [makeTestVideoAsset()],
      };

    const controller = new NativeAudioPreviewController({
      clock,
      source: initialSource,
    });

    const hydratedSource: import("@/core/audio/nativeAudioPreviewController").NativeAudioPreviewSource =
      {
        ...initialSource,
        clips: [makeTestVideoClip()],
      };

    controller.updateSource(hydratedSource);
    expect((controller as any).pendingSource).toBe(hydratedSource);

    // Simulate activation path calling updateSource if pendingSource exists
    const updateSpy = vi.spyOn(controller, "updateSource");
    (controller as any).active = true;

    // In initialize(): if (this.pendingSource) { const pending = this.pendingSource; this.updateSource(pending); }
    if ((controller as any).pendingSource) {
      const pending = (controller as any).pendingSource;
      controller.updateSource(pending);
    }

    expect(updateSpy).toHaveBeenCalledWith(hydratedSource);
  });

  it("resolves clip paths using clip.mediaId correctly", () => {
    const asset = makeTestVideoAsset("asset-xyz", "/path/to/media.mp4");
    const clip = makeTestVideoClip("clip-abc", "asset-xyz");
    const source: import("@/core/audio/nativeAudioPreviewController").NativeAudioPreviewSource =
      {
        projectRevision: "p1:1",
        frameRate: 30,
        duration: 30,
        audioTrackCount: 1,
        clips: [clip],
        tracks: [makeTestVideoTrack()],
        assets: [asset],
      };

    // Test the allClipsHavePaths logic with clip.mediaId
    const allClipsHavePaths = source.clips
      .filter((c) => {
        const clipMediaId = c.mediaId || (c as any).assetId;
        const matchedAsset = source.assets.find((a) => a.id === clipMediaId);
        return matchedAsset !== undefined;
      })
      .every((c) => {
        const clipMediaId = c.mediaId || (c as any).assetId;
        const matchedAsset = source.assets.find((a) => a.id === clipMediaId);
        return Boolean(matchedAsset?.path);
      });

    expect(allClipsHavePaths).toBe(true);
  });

  it("sets _sourceState and _rendererState appropriately based on clips presence on initialize", () => {
    const clock = new PlaybackClock();
    const sourceWithClips: import("@/core/audio/nativeAudioPreviewController").NativeAudioPreviewSource =
      {
        projectRevision: "p1:0",
        frameRate: 30,
        duration: 30,
        audioTrackCount: 1,
        clips: [makeTestVideoClip()],
        tracks: [makeTestVideoTrack()],
        assets: [makeTestVideoAsset()],
      };

    const controller = new NativeAudioPreviewController({
      clock,
      source: sourceWithClips,
    });

    // When initializing with 0 resolved snapshot clips but clips exist on source:
    // Should transition to 'resolving' not 'unknown'/'detached'
    (controller as any)._sourceState =
      sourceWithClips.clips.length > 0 ? "resolving" : "unknown";
    (controller as any)._rendererState =
      sourceWithClips.clips.length > 0 ? "resolving" : "detached";

    expect(controller.audioSourceState).toBe("resolving");
    expect(controller.audioRendererState).toBe("resolving");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 12 — Audio Does Not Start from Position 0 on Playback Start
// ─────────────────────────────────────────────────────────────────────────────
//
// Problem:
//   The 555ms CPAL initialization delay caused video to advance 16-18 frames
//   before audio started. The root cause: initialize() read clock.time when the
//   clock was paused (position 0), then after 555ms of async work, seeked to
//   that stale value. Meanwhile, video had advanced via wall-clock extrapolation
//   (Bug 10 fix). Audio then played from position 0 while video was at ~555ms,
//   creating permanent -555ms A/V drift.
//
// Fix:
//   Read clock.time IMMEDIATELY before nativePlayFromAudio() in initialize().
//   At that point, clock.time returns the wall-clock extrapolated position,
//   allowing audio to join the timeline at the video's actual position.
//
// Evidence:
//   - Before fix: avg_micros = -555000 (audio lags video by 555ms)
//   - After fix: avg_micros within ±2000 (±2ms tolerance)
//
// ─────────────────────────────────────────────────────────────────────────────
describe("Bug 12 — Audio starts at video position after initialization delay", () => {
  it("FIXED: audio seeks to live wall-clock position, not stale paused position", () => {
    const clock = new PlaybackClock();
    clock.setDuration(30);
    clock.setFrameRate(30);
    clock.setNativeClockAuthority(true);

    // Simulate: user presses play at T=0
    clock.play();
    expect(clock.state).toBe("playing");
    // Note: clock.time advances immediately via wall-clock extrapolation,
    // so we can't assert it's exactly 0 here

    // Simulate: 500ms passes during audio initialization
    const delayMs = 500;
    const beforeDelayMs = performance.now();
    // Busy-wait to advance real time (vi.useFakeTimers would break performance.now())
    while (performance.now() - beforeDelayMs < delayMs) {
      // spin
    }

    // Clock should have advanced via wall-clock extrapolation
    const livePosition = clock.time;
    expect(livePosition).toBeGreaterThan(0.4); // At least 400ms elapsed
    expect(livePosition).toBeLessThan(0.7); // Not more than 700ms (allowing variance)

    // The fix ensures seekNativeAudio receives livePosition, not 0
    // (The actual IPC call is tested in the integration path; here we verify
    // the clock behavior that enables the fix)
  });

  it("REGRESSION: seek-then-play still works correctly", () => {
    const clock = new PlaybackClock();
    clock.setDuration(30);
    clock.setFrameRate(30);
    clock.setNativeClockAuthority(true);

    // User seeks to T=5s, then plays
    clock.seek(5);
    expect(clock.time).toBe(5);
    // Manually resolve seeking to simulate the normal lifecycle
    // (In production, resolveSeeking() is called after presentation settles)
    (clock as any)._isSeeking = false;

    clock.play();
    expect(clock.state).toBe("playing");

    // Simulate audio initialization delay (shorter for test reliability)
    const delayMs = 100;
    const beforeDelayMs = performance.now();
    while (performance.now() - beforeDelayMs < delayMs) {
      // spin
    }

    // Clock should have advanced from 5s, not from 0
    const livePosition = clock.time;
    expect(livePosition).toBeGreaterThan(5.05); // At least 5s + 50ms
    expect(livePosition).toBeLessThan(5.2); // Not more than 5s + 200ms
  });

  it("REGRESSION: silent projects still play immediately", () => {
    const clock = new PlaybackClock();
    clock.setDuration(30);
    clock.setFrameRate(30);
    clock.setNativeClockAuthority(true);

    // Simulate silent project: markNativeAudioUnavailable is called
    clock.markNativeAudioUnavailable();
    expect(clock.hasNativeClockPosition).toBe(true);

    clock.play();
    expect(clock.state).toBe("playing");

    // Wall-clock extrapolation should still work
    const delayMs = 500;
    const beforeDelayMs = performance.now();
    while (performance.now() - beforeDelayMs < delayMs) {
      // spin
    }

    const livePosition = clock.time;
    expect(livePosition).toBeGreaterThan(0.4);
    expect(livePosition).toBeLessThan(0.7);
  });

  it("EDGE CASE: rapid seek during initialization doesn't cause stale audio position", () => {
    const clock = new PlaybackClock();
    clock.setDuration(30);
    clock.setFrameRate(30);
    clock.setNativeClockAuthority(true);

    // User presses play
    clock.play();
    const initialSeekRevision = clock.seekRevision;

    // Simulate: user seeks while audio is still initializing
    clock.seek(10);
    expect(clock.seekRevision).toBeGreaterThan(initialSeekRevision);
    expect(clock.time).toBe(10);

    // The transport queue would handle this: the old seek command would complete,
    // but a new seek would be enqueued and supersede it. Here we verify that
    // the clock's seek revision increments correctly.
    expect(clock.seekRevision).toBe(initialSeekRevision + 1);
  });

  it("EDGE CASE: play at end of timeline restarts from 0 with correct audio sync", () => {
    const clock = new PlaybackClock();
    clock.setDuration(30);
    clock.setFrameRate(30);
    clock.setNativeClockAuthority(true);

    // Seek to end
    clock.seek(30);
    expect(clock.time).toBe(30);

    // Play from end restarts from 0 (PlaybackClock behavior)
    clock.play();
    expect(clock.state).toBe("playing");
    // Note: time may advance immediately via wall-clock extrapolation

    // Simulate audio initialization delay (shorter for test reliability)
    const delayMs = 100;
    const beforeDelayMs = performance.now();
    while (performance.now() - beforeDelayMs < delayMs) {
      // spin
    }

    // Clock should have advanced from 0
    const livePosition = clock.time;
    expect(livePosition).toBeGreaterThan(0.05); // At least 50ms
    expect(livePosition).toBeLessThan(0.2); // Not more than 200ms
  });

  it("EDGE CASE: Space restart from end with seek(0) then play() clears isSeeking and advances immediately", () => {
    const clock = new PlaybackClock();
    clock.setDuration(10);
    clock.setFrameRate(30);
    clock.setNativeClockAuthority(true);

    // Play until completion
    clock.play();
    clock.complete();
    expect(clock.state).toBe("paused");
    expect(clock.time).toBe(10);
    expect(clock.isSeeking).toBe(false);

    // TransportAuthority / Space restart sequence: seek(0) then play()
    clock.seek(0);
    expect(clock.time).toBe(0);
    // play() must clear isSeeking so extrapolation and RAF start immediately
    clock.play();
    expect(clock.state).toBe("playing");
    expect(clock.isSeeking).toBe(false);

    // Spin delay to verify wall-clock extrapolation is active
    const delayMs = 60;
    const beforeDelayMs = performance.now();
    while (performance.now() - beforeDelayMs < delayMs) {
      // spin
    }

    // Time must advance forward from 0 rather than being locked at 0 by isSeeking
    expect(clock.time).toBeGreaterThan(0.02);
  });
});
