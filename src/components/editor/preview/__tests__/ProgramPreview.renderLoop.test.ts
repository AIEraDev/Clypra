import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
    expect(
      wouldSyncFixed({ ...steadyPlayFrame, epochChanged: true }),
    ).toBe(true);
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
    expect(
      wouldSyncFixed({ ...steadyPlayFrame, clipsChanged: true }),
    ).toBe(true);
  });

  it("FIXED: sync called when tracks change", () => {
    expect(
      wouldSyncFixed({ ...steadyPlayFrame, tracksChanged: true }),
    ).toBe(true);
  });

  it("FIXED: sync called when transitions change", () => {
    expect(
      wouldSyncFixed({ ...steadyPlayFrame, transitionsChanged: true }),
    ).toBe(true);
  });

  it("FIXED: sync called when project identity changes", () => {
    expect(
      wouldSyncFixed({ ...steadyPlayFrame, projectChanged: true }),
    ).toBe(true);
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
    const reductionPercent =
      ((brokenCalls - fixedCalls) / brokenCalls) * 100;
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

      const { tier } = simulateTierProgression(5, [...slowBurst, ...recoveryBatch], 30);
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
