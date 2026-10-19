import { describe, expect, it } from "vitest";
import {
  canPresentPausedFrameOnNativeSurface,
  shouldRenderPausedCanvasDuringNativeHandover,
  shouldRetainNativeSurfaceForPausedCanvasHandover,
} from "../pausedNativeSurfaceEligibility";

const cleanMonitor = {
  surfaceUsable: true,
  qualificationForcesWebView: false,
  hasSelectedClip: false,
  hasSelectedTransition: false,
  hasSelectedGap: false,
  safeOverlayVisible: false,
  karaokeOverlayVisible: false,
  previewMenuOpen: false,
};

describe("paused native surface eligibility", () => {
  it("uses the retained surface for a clean paused program monitor", () => {
    expect(canPresentPausedFrameOnNativeSurface(cleanMonitor)).toBe(true);
  });

  it.each([
    "hasSelectedClip",
    "hasSelectedTransition",
    "hasSelectedGap",
    "safeOverlayVisible",
    "karaokeOverlayVisible",
    "previewMenuOpen",
  ] as const)("keeps the canvas path when %s needs DOM layering", (field) => {
    expect(
      canPresentPausedFrameOnNativeSurface({ ...cleanMonitor, [field]: true }),
    ).toBe(false);
  });

  it("does not bypass qualification or an unavailable surface", () => {
    expect(
      canPresentPausedFrameOnNativeSurface({
        ...cleanMonitor,
        qualificationForcesWebView: true,
      }),
    ).toBe(false);
    expect(
      canPresentPausedFrameOnNativeSurface({
        ...cleanMonitor,
        surfaceUsable: false,
      }),
    ).toBe(false);
  });

  it("retains the last native pixels until a selected paused clip has painted to canvas", () => {
    expect(
      shouldRetainNativeSurfaceForPausedCanvasHandover({
        isPaused: true,
        surfaceShown: true,
        surfaceUsable: true,
        hasNativeRequest: true,
        nativeDirectSurfacePath: false,
      }),
    ).toBe(true);
    expect(shouldRenderPausedCanvasDuringNativeHandover(true)).toBe(true);
    expect(shouldRenderPausedCanvasDuringNativeHandover(false)).toBe(false);
    expect(
      shouldRetainNativeSurfaceForPausedCanvasHandover({
        isPaused: true,
        surfaceShown: true,
        surfaceUsable: false,
        hasNativeRequest: true,
        nativeDirectSurfacePath: false,
      }),
    ).toBe(false);
    expect(
      shouldRetainNativeSurfaceForPausedCanvasHandover({
        isPaused: false,
        surfaceShown: true,
        surfaceUsable: true,
        hasNativeRequest: true,
        nativeDirectSurfacePath: false,
      }),
    ).toBe(false);
  });
});
