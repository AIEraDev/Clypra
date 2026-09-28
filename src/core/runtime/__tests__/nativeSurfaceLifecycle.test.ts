import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: vi.fn(() => true),
  hideNativeSurface: vi.fn(() => Promise.resolve()),
  resizeNativeSurface: vi.fn(() => Promise.resolve()),
  probeNativeSurface: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/core/playback/playbackTrace", () => ({
  tracePlayback: vi.fn(),
}));

// Override EMBEDDED_PREVIEW_ONLY so the state machine is exercised in tests.
vi.mock("@/lib/platform/nativeCore", () => ({
  EMBEDDED_PREVIEW_ONLY: false,
  NATIVE_PREVIEW_ONLY: false,
}));

import { isTauriRuntime } from "@/lib/platform/tauri";
import {
  claimNativeSurfaceReadiness,
  markNativeSurfaceReady,
  failNativeSurfaceReadiness,
  resetNativeSurfaceReadiness,
  isNativeSurfaceReady,
  waitForNativeSurfaceReady,
} from "../nativeSurfaceLifecycle";

describe("nativeSurfaceLifecycle", () => {
  const projectId = "test-project-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    resetNativeSurfaceReadiness(projectId);
  });

  it("should resolve immediately if not in Tauri runtime", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    await expect(
      waitForNativeSurfaceReady("non-tauri-project"),
    ).resolves.toBeUndefined();
  });

  it("should resolve successfully when markNativeSurfaceReady is called", async () => {
    const token = claimNativeSurfaceReadiness(projectId);
    expect(isNativeSurfaceReady(projectId)).toBe(false);

    const waitPromise = waitForNativeSurfaceReady(projectId, 1000);
    markNativeSurfaceReady(token);

    await expect(waitPromise).resolves.toBeUndefined();
    expect(isNativeSurfaceReady(projectId)).toBe(true);
  });

  it("should resolve immediately if already ready", async () => {
    const token = claimNativeSurfaceReadiness(projectId);
    markNativeSurfaceReady(token);
    expect(isNativeSurfaceReady(projectId)).toBe(true);

    const startTime = Date.now();
    await waitForNativeSurfaceReady(projectId, 1000);
    expect(Date.now() - startTime).toBeLessThan(100);
  });

  it("should resolve gracefully when readiness times out", async () => {
    claimNativeSurfaceReadiness(projectId);

    // Timeout set to 50ms to verify it does not hang indefinitely
    const startTime = Date.now();
    await expect(
      waitForNativeSurfaceReady(projectId, 50),
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("should resolve gracefully if failNativeSurfaceReadiness is called", async () => {
    const token = claimNativeSurfaceReadiness(projectId);

    const waitPromise = waitForNativeSurfaceReady(projectId, 1000);
    failNativeSurfaceReadiness(token, new Error("GPU initialization error"));

    // Should not throw, should resolve gracefully
    await expect(waitPromise).resolves.toBeUndefined();
    expect(isNativeSurfaceReady(projectId)).toBe(false);
  });
});
