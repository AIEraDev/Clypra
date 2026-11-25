import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: vi.fn(() => true),
  probeNativeSurface: vi.fn().mockResolvedValue({
    ready: true,
    width: 1920,
    height: 1080,
    scaleFactor: 2.0,
  }),
  resizeNativeSurface: vi.fn().mockResolvedValue({
    ready: true,
    width: 1920,
    height: 1080,
    scaleFactor: 2.0,
  }),
  hideNativeSurface: vi.fn().mockResolvedValue(undefined),
  showNativeSurface: vi.fn().mockResolvedValue(undefined),
  resetNativeRuntime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/core/playback/playbackTrace", () => ({
  tracePlayback: vi.fn(),
}));

import {
  configureNativeSurface,
  presentOnNativeSurface,
  isNativeSurfaceConfigured,
  resetGlobalNativeSurfaceCoordinator,
  onNativeSurfaceCoordinatorReset,
} from "@/core/runtime/nativeSurfaceLifecycle";
import { resetAllProjectState } from "@/core/runtime/ProjectStateReset";
import type { NativeSurfaceGeometry } from "@/lib/platform/nativeCore";

const testGeometry: NativeSurfaceGeometry = {
  xPhysical: 0,
  yPhysical: 0,
  widthPhysical: 1920,
  heightPhysical: 1080,
  devicePixelRatio: 2.0,
};

describe("Multi-Project Surface Lifecycle Regression Test", () => {
  beforeEach(() => {
    resetGlobalNativeSurfaceCoordinator();
  });

  afterEach(() => {
    resetGlobalNativeSurfaceCoordinator();
  });

  it("configures surface and presents frame successfully on Project A", async () => {
    expect(isNativeSurfaceConfigured()).toBe(false);

    const config = await configureNativeSurface("project-a", testGeometry);
    expect(config.ownerProjectId).toBe("project-a");
    expect(isNativeSurfaceConfigured()).toBe(true);

    const presented = await presentOnNativeSurface("project-a", async () => {
      return { frameIndex: 0, presented: true };
    });

    expect(presented).toEqual({ frameIndex: 0, presented: true });
  });

  it("resets native surface coordinator when switching projects via resetAllProjectState", async () => {
    // 1. Open and configure Project A
    await configureNativeSurface("project-a", testGeometry);
    expect(isNativeSurfaceConfigured()).toBe(true);

    // Track observer notification
    let resetNotified = false;
    const unsubscribe = onNativeSurfaceCoordinatorReset(() => {
      resetNotified = true;
    });

    // 2. Open Project B (triggers resetAllProjectState)
    await resetAllProjectState();

    expect(resetNotified).toBe(true);
    expect(isNativeSurfaceConfigured()).toBe(false);

    unsubscribe();
  });

  it("configures Project B and presents frame after Project A is closed/reset", async () => {
    // 1. Open Project A
    await configureNativeSurface("project-a", testGeometry);
    const frameA = await presentOnNativeSurface("project-a", async () => "frame-a");
    expect(frameA).toBe("frame-a");

    // Controller ref simulation (as in useNativeSurfaceController)
    let controllerConfigured = true;
    let appliedGeometry = "0:0:1920:1080:2";

    const unsubscribe = onNativeSurfaceCoordinatorReset(() => {
      controllerConfigured = false;
      appliedGeometry = "";
    });

    // 2. Transition to Project B
    await resetAllProjectState();

    // Verify controller was notified and dropped its configured state
    expect(controllerConfigured).toBe(false);
    expect(appliedGeometry).toBe("");
    expect(isNativeSurfaceConfigured()).toBe(false);

    // 3. Project B mounts and configures
    const configB = await configureNativeSurface("project-b", testGeometry);
    controllerConfigured = true;
    appliedGeometry = configB.geometryKey;

    expect(configB.ownerProjectId).toBe("project-b");
    expect(isNativeSurfaceConfigured()).toBe(true);
    expect(controllerConfigured).toBe(true);

    // 4. Present frame on Project B - must succeed without throwing
    const frameB = await presentOnNativeSurface("project-b", async () => "frame-b");
    expect(frameB).toBe("frame-b");

    unsubscribe();
  });

  it("negative control: presenting on Project B without re-configuring after reset throws descriptive error", async () => {
    // 1. Open Project A
    await configureNativeSurface("project-a", testGeometry);

    // 2. Reset coordinator (simulating project close without controller sync)
    resetGlobalNativeSurfaceCoordinator();

    // 3. Attempt to present frame on Project B before configureNativeSurface
    await expect(
      presentOnNativeSurface("project-b", async () => "frame-b"),
    ).rejects.toThrow("Native preview surface is not configured for this project");
  });
});
