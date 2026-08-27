/**
 * nativeContract.test.ts
 *
 * Validates:
 * - Contract serialization between TypeScript and Rust NativeCore
 * - NativeTime rational mapping conversions (ticks / timescale = seconds)
 * - Schema versions and color policy invariants
 */

import { describe, it, expect } from "vitest";
import {
  NATIVE_CORE_CONTRACT_VERSION,
  NATIVE_CORE_TIME_SCALE,
  DEFAULT_NATIVE_COLOR_POLICY,
  frameIndexToNativeTime,
  secondsToNativeTime,
  createNativeFrameRequest,
} from "../../platform/nativeCore";
import { isValidArtifact } from "../transport";

describe("NativeCore Contract & Serialization Invariants", () => {
  it("enforces active contract version matches Rust NativeCore specification", () => {
    expect(NATIVE_CORE_CONTRACT_VERSION).toBe(2);
    expect(NATIVE_CORE_TIME_SCALE).toBe(1_000_000);
  });

  it("verifies rational NativeTime conversion for frame indices", () => {
    const fps = 30;
    const frameIndex = 45; // 1.5 seconds at 30 fps

    const nativeTime = frameIndexToNativeTime(frameIndex, fps);

    expect(nativeTime).toEqual({
      frameIndex: 45,
      ticks: 1_500_000,
      timescale: 1_000_000,
    });

    // Check rational reduction value
    const seconds = nativeTime.ticks / nativeTime.timescale;
    expect(seconds).toBe(1.5);
  });

  it("verifies rational NativeTime conversion from seconds and frameIndex", () => {
    const seconds = 2.5;
    const frameIndex = 75;

    const nativeTime = secondsToNativeTime(seconds, frameIndex);

    expect(nativeTime).toEqual({
      frameIndex: 75,
      ticks: 2_500_000,
      timescale: 1_000_000,
    });
    expect(nativeTime.ticks / nativeTime.timescale).toBe(2.5);
  });

  it("enforces default native color policy contracts", () => {
    expect(DEFAULT_NATIVE_COLOR_POLICY).toEqual({
      version: 1,
      workingSpace: "linear-rec709",
      outputFormat: "rgba8Srgb",
      toneMapHdrToSdr: true,
      displayProfile: "srgb-reference",
    });
  });

  it("creates valid NativeFrameRequest with standard contract version", () => {
    const request = createNativeFrameRequest({
      requestId: "filmstrip:req-1",
      frameTime: secondsToNativeTime(1.0, 30),
      project: {
        schemaVersion: 1,
        projectRevision: "rev-1",
        canvasWidth: 1920,
        canvasHeight: 1080,
        clearColor: [0, 0, 0, 1],
        videoLayers: [],
      },
      outputWidth: 160,
      outputHeight: 90,
      quality: "full",
      colorPolicy: DEFAULT_NATIVE_COLOR_POLICY,
      renderGraphVersion: 1,
    });

    expect(request.contractVersion).toBe(NATIVE_CORE_CONTRACT_VERSION);
    expect(request.requestId).toBe("filmstrip:req-1");
    expect(request.outputWidth).toBe(160);
  });

  it("validates transport artifact integrity rules", () => {
    const validArtifact = {
      frameId: "f1",
      contentHash: "hash1",
      bitmap: { width: 160, height: 90, close: () => {} } as any,
      width: 160,
      height: 90,
      timestampMs: 1000,
      epochId: "epoch-1" as any,
      spatialTier: 0,
    };

    expect(isValidArtifact(validArtifact)).toBe(true);

    // Invalid bitmap with 0 dimension
    const zeroDimensionArtifact = {
      ...validArtifact,
      bitmap: { width: 0, height: 90, close: () => {} } as any,
    };
    expect(isValidArtifact(zeroDimensionArtifact)).toBe(false);

    // Invalid null artifact
    expect(isValidArtifact(null as any)).toBe(false);
  });

  it("supports textLayers in NativeProjectSnapshot with raw text attributes", () => {
    const request = createNativeFrameRequest({
      requestId: "preview:text-1",
      frameTime: secondsToNativeTime(0.0, 30),
      project: {
        schemaVersion: 1,
        projectRevision: "rev-text-1",
        canvasWidth: 1920,
        canvasHeight: 1080,
        clearColor: [0, 0, 0, 1],
        videoLayers: [],
        textLayers: [
          {
            text: "Hello Clypra Native Text",
            fontId: "Inter Variable",
            fontSize: 48,
            letterSpacing: 1.5,
            lineHeight: 1.2,
            color: [1, 0.5, 0.2, 1],
            textAlign: "center",
            x: 960,
            y: 540,
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            blendMode: "normal",
            strokeColor: [0, 0, 0, 1],
            strokeWidth: 2,
            shadowColor: [0, 0, 0, 0.5],
            shadowOffset: [4, 4],
            shadowBlur: 8,
          },
        ],
      },
      outputWidth: 1920,
      outputHeight: 1080,
      quality: "full",
      colorPolicy: DEFAULT_NATIVE_COLOR_POLICY,
      renderGraphVersion: 1,
    });

    expect(request.project.textLayers).toBeDefined();
    expect(request.project.textLayers?.length).toBe(1);
    expect(request.project.textLayers?.[0].text).toBe("Hello Clypra Native Text");
    expect(request.project.textLayers?.[0].color).toEqual([1, 0.5, 0.2, 1]);
    expect(request.project.textLayers?.[0].textAlign).toBe("center");
  });
});
