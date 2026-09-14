/**
 * Behind Subject Layer Synthesis Tests
 *
 * Validates that setting behindSubject on text/graphic overlays dynamically synthesizes
 * a foreground subject cutout layer with zero audio duplication.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateTimelineScene as evaluateScene } from "../evaluator";
import type { TextClip, VideoClip, Track, MediaAsset, Project } from "@/types";
import type {
  SkeletalAnchorConfig,
  TorsoAnchors,
  ParticleEmitterConfig,
} from "@clypra-studio/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("Behind Subject Layer Synthesis", () => {
  const project: Project = {
    id: "test-project",
    name: "Behind Subject Test",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    aspectRatio: "16:9",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 10,
  };

  // In Clypra's timeline, Track index 0 is the topmost track in UI (overlay layer),
  // while higher track indices are lower background layers.
  const tracks: Track[] = [
    { id: "t1", type: "text", name: "Text Track", muted: false, locked: false, visible: true, height: 56 },
    { id: "v1", type: "video", name: "Video Track", muted: false, locked: false, visible: true, height: 56 },
  ];

  const assets: MediaAsset[] = [
    {
      id: "asset-1",
      name: "presenter.mp4",
      type: "video",
      path: "/media/presenter.mp4",
      duration: 10,
      width: 1920,
      height: 1080,
      size: 1024 * 1024,
    },
  ];

  const videoClip: VideoClip = {
    id: "video-1",
    kind: "video",
    trackId: "v1",
    mediaId: "asset-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1.0,
    rotation: 0,
  };

  const createTextClip = (overrides: Partial<TextClip> = {}): TextClip => ({
    id: "text-1",
    kind: "text",
    trackId: "t1",
    mediaId: "",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 960,
    y: 540,
    width: 600,
    height: 120,
    opacity: 1.0,
    rotation: 0,
    text: "Behind Person Headline",
    fontSize: 48,
    fontFamily: "Inter",
    color: "#ffffff",
    fontWeight: "bold",
    fontStyle: "normal",
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
    paddingX: 16,
    paddingY: 16,
    ...overrides,
  });

  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
  });

  it("does not synthesize a cutout layer when behindSubject is false or undefined", () => {
    const textClip = createTextClip({
      id: "text-normal",
      text: "Standard Text",
      behindSubject: false,
    });

    const scene = evaluateScene(2.0, [videoClip, textClip], tracks, assets, project);

    // Only 2 visual layers: 1 video media layer, 1 text layer
    expect(scene.visualLayers).toHaveLength(2);
    const mediaLayers = scene.visualLayers.filter((l) => l.layerType === "media");
    const textLayers = scene.visualLayers.filter((l) => l.layerType === "text");
    expect(mediaLayers).toHaveLength(1);
    expect(textLayers).toHaveLength(1);
    expect(mediaLayers[0].layerId).not.toContain("subject-cutout");
  });

  it("synthesizes a foreground cutout layer when behindSubject is true", () => {
    const textClip = createTextClip({
      id: "text-behind",
      text: "Behind Person Headline",
      behindSubject: true,
      subjectFeather: 6,
    });

    const scene = evaluateScene(3.0, [videoClip, textClip], tracks, assets, project);

    // Should contain:
    // 1) Base video media layer
    // 2) Text layer
    // 3) Synthesized cutout media layer
    expect(scene.visualLayers).toHaveLength(3);

    const baseMedia = scene.visualLayers.find(
      (l) => l.layerType === "media" && !l.layerId.endsWith(":subject-cutout"),
    );
    const textLayer = scene.visualLayers.find((l) => l.layerType === "text");
    const cutoutLayer = scene.visualLayers.find(
      (l) => l.layerType === "media" && l.layerId.endsWith(":subject-cutout"),
    );

    expect(baseMedia).toBeDefined();
    expect(textLayer).toBeDefined();
    expect(cutoutLayer).toBeDefined();

    // Z-Order Sandwich Verification:
    // Base video is under text, cutout is above text
    expect(baseMedia!.zIndex).toBeLessThan(textLayer!.zIndex);
    expect(cutoutLayer!.zIndex).toBeGreaterThan(textLayer!.zIndex);
    expect(Number.isInteger(cutoutLayer!.zIndex)).toBe(true);

    // Cutout effect configuration
    if (cutoutLayer && cutoutLayer.layerType === "media") {
      expect(cutoutLayer.effects).toBeDefined();
      const cutoutEffect = cutoutLayer.effects?.find((fx) => fx.renderer === "body_cutout");
      expect(cutoutEffect).toBeDefined();
      expect(cutoutEffect?.type).toBe("body_effect");
      expect(cutoutEffect?.parameters?.feather).toBe(6);
      expect(cutoutEffect?.intensity).toBe(1.0);
    }
  });

  it("defaults subjectFeather to 4px when not explicitly specified", () => {
    const textClip = createTextClip({
      id: "text-default-feather",
      text: "Default Feather Text",
      behindSubject: true,
    });

    const scene = evaluateScene(1.0, [videoClip, textClip], tracks, assets, project);
    const cutoutLayer = scene.visualLayers.find(
      (l) => l.layerType === "media" && l.layerId.endsWith(":subject-cutout"),
    );

    expect(cutoutLayer).toBeDefined();
    if (cutoutLayer && cutoutLayer.layerType === "media") {
      const cutoutEffect = cutoutLayer.effects?.find((fx) => fx.renderer === "body_cutout");
      expect(cutoutEffect?.parameters?.feather).toBe(4);
    }
  });

  it("ensures zero audio duplication when behindSubject is enabled", () => {
    const textClip = createTextClip({
      id: "text-behind-audio-check",
      text: "Audio Immunity Text",
      behindSubject: true,
    });

    const scene = evaluateScene(4.0, [videoClip, textClip], tracks, assets, project);

    // Audio layers must only evaluate real audio sources (1 from videoClip)
    // The synthesized cutout media layer MUST NOT produce any audio layer
    expect(scene.audioLayers).toHaveLength(1);
    expect(scene.audioLayers[0].clipId).toBe(videoClip.id);
    expect(scene.audioLayers.some((a) => a.clipId.includes("subject-cutout"))).toBe(false);
  });

  const dummyTorsoFacingForward: TorsoAnchors = {
    leftShoulder: { x: 0.3875, y: 0.3, z: 0, visibility: 1 },
    rightShoulder: { x: 0.6125, y: 0.3, z: 0, visibility: 1 },
    neck: { x: 0.5, y: 0.3, z: 0, visibility: 1 },
    spineCenter: { x: 0.5, y: 0.5, z: 0, visibility: 1 },
    leftWrist: { x: 0.2, y: 0.7, z: 0, visibility: 1 },
    rightWrist: { x: 0.8, y: 0.7, z: 0, visibility: 1 },
    torsoOrientation: { x: 0, y: 0, z: 0, w: 1 },
    ...({
      hipCenter: { x: 0.5, y: 0.7, z: 0, visibility: 1 },
      torsoWidth: 0.25,
      torsoHeight: 0.4,
    } as any),
  };

  const dummyTorsoTurningRight: TorsoAnchors = {
    ...dummyTorsoFacingForward,
    torsoOrientation: { x: 0, y: 0.2588, z: 0, w: 0.9659 }, // +30 deg yaw
  };

  it("synthesizes skeletal dual-wing sprites and sorts far wing behind subject cutout and near wing in front in auto-yaw mode", () => {
    const videoWithWings: VideoClip = {
      ...videoClip,
      id: "video-wings",
      ...({
        torsoAnchors: dummyTorsoTurningRight,
        skeletalAnchorConfig: {
          anchorKeypoint: "spineCenter",
          depthMode: "auto-yaw",
          dualSprite: {
            leftAnchorKeypoint: "leftShoulder",
            rightAnchorKeypoint: "rightShoulder",
            leftSpriteUri: "/assets/effects/wings_left.png",
            rightSpriteUri: "/assets/effects/wings_right.png",
          },
        } satisfies SkeletalAnchorConfig,
      } as any),
    };

    const scene = evaluateScene(1.0, [videoWithWings], tracks, assets, project);

    // Visual layers should contain:
    // 1. Base video (video-wings)
    // 2. Left wing (video-wings:skeletal-left) - sorted behind because yaw > 10
    // 3. Foreground subject cutout (video-wings:subject-cutout)
    // 4. Right wing (video-wings:skeletal-right) - sorted in front because yaw > 10
    expect(scene.visualLayers).toHaveLength(4);

    const baseMedia = scene.visualLayers.find((l) => l.layerId === "video-wings");
    const leftWing = scene.visualLayers.find((l) => l.layerId === "video-wings:skeletal-left");
    const rightWing = scene.visualLayers.find((l) => l.layerId === "video-wings:skeletal-right");
    const cutout = scene.visualLayers.find((l) => l.layerId === "video-wings:subject-cutout");

    expect(baseMedia).toBeDefined();
    expect(leftWing).toBeDefined();
    expect(rightWing).toBeDefined();
    expect(cutout).toBeDefined();

    // 3D Parallax Occlusion Order:
    // Base video (0) < Left Wing (1) < Subject Cutout (2) < Right Wing (3)
    expect(baseMedia!.zIndex).toBeLessThan(leftWing!.zIndex);
    expect(leftWing!.zIndex).toBeLessThan(cutout!.zIndex);
    expect(cutout!.zIndex).toBeLessThan(rightWing!.zIndex);
  });

  it("synthesizes both wings behind subject when depthMode is behind-subject", () => {
    const videoWithWings: VideoClip = {
      ...videoClip,
      id: "video-wings-behind",
      ...({
        torsoAnchors: dummyTorsoFacingForward,
        skeletalAnchorConfig: {
          anchorKeypoint: "spineCenter",
          depthMode: "behind-subject",
          dualSprite: {
            leftAnchorKeypoint: "leftShoulder",
            rightAnchorKeypoint: "rightShoulder",
            leftSpriteUri: "/assets/effects/wings_left.png",
            rightSpriteUri: "/assets/effects/wings_right.png",
          },
        } satisfies SkeletalAnchorConfig,
      } as any),
    };

    const scene = evaluateScene(1.0, [videoWithWings], tracks, assets, project);

    expect(scene.visualLayers).toHaveLength(4);
    const leftWing = scene.visualLayers.find((l) => l.layerId === "video-wings-behind:skeletal-left");
    const rightWing = scene.visualLayers.find((l) => l.layerId === "video-wings-behind:skeletal-right");
    const cutout = scene.visualLayers.find((l) => l.layerId === "video-wings-behind:subject-cutout");

    expect(leftWing!.zIndex).toBeLessThan(cutout!.zIndex);
    expect(rightWing!.zIndex).toBeLessThan(cutout!.zIndex);
  });

  it("synthesizes single main skeletal sprite anchored to neck behind subject", () => {
    const videoWithHalo: VideoClip = {
      ...videoClip,
      id: "video-halo",
      ...({
        torsoAnchors: dummyTorsoFacingForward,
        skeletalAnchorConfig: {
          anchorKeypoint: "neck",
          depthMode: "behind-subject",
          spriteAssetUri: "/assets/effects/halo.png",
        } satisfies SkeletalAnchorConfig,
      } as any),
    };

    const scene = evaluateScene(1.0, [videoWithHalo], tracks, assets, project);

    expect(scene.visualLayers).toHaveLength(3);
    const baseMedia = scene.visualLayers.find((l) => l.layerId === "video-halo");
    const halo = scene.visualLayers.find((l) => l.layerId === "video-halo:skeletal-main");
    const cutout = scene.visualLayers.find((l) => l.layerId === "video-halo:subject-cutout");

    expect(baseMedia).toBeDefined();
    expect(halo).toBeDefined();
    expect(cutout).toBeDefined();
    expect(baseMedia!.zIndex).toBeLessThan(halo!.zIndex);
    expect(halo!.zIndex).toBeLessThan(cutout!.zIndex);
  });

  it("synthesizes procedural particle emitter layer behind subject when behindSubject is true", () => {
    const videoWithParticles: VideoClip = {
      ...videoClip,
      id: "video-particles",
      ...({
        torsoAnchors: dummyTorsoFacingForward,
        behindSubject: true,
        particleEmitterConfig: {
          emitterType: "contour",
          anchorSource: "spine",
          particleCount: 150,
          lifetimeSec: 1.5,
          speed: 90,
          turbulence: 30,
          gravity: -50,
          colorStart: "#ff6600",
          colorEnd: "#ffff00",
          blendMode: "screen",
        } satisfies ParticleEmitterConfig,
      } as any),
    };

    const scene = evaluateScene(1.0, [videoWithParticles], tracks, assets, project);

    // Should contain:
    // 1. Base video (video-particles)
    // 2. Synthesized particle emitter layer (video-particles:particle-emitter)
    // 3. Synthesized foreground subject cutout (video-particles:subject-cutout)
    expect(scene.visualLayers).toHaveLength(3);

    const baseMedia = scene.visualLayers.find((l) => l.layerId === "video-particles");
    const particleLayer = scene.visualLayers.find(
      (l) => l.layerId === "video-particles:particle-emitter",
    );
    const cutoutLayer = scene.visualLayers.find(
      (l) => l.layerId === "video-particles:subject-cutout",
    );

    expect(baseMedia).toBeDefined();
    expect(particleLayer).toBeDefined();
    expect(cutoutLayer).toBeDefined();

    // 3D Sandwich Ordering: Base (0) < Particles (1) < Cutout (2)
    expect(baseMedia!.zIndex).toBeLessThan(particleLayer!.zIndex);
    expect(particleLayer!.zIndex).toBeLessThan(cutoutLayer!.zIndex);

    // Check particle layer effect configuration
    if (particleLayer && particleLayer.layerType === "media") {
      expect(particleLayer.effects).toBeDefined();
      const particleEffect = particleLayer.effects?.find(
        (fx) => fx.renderer === "body_particles",
      );
      expect(particleEffect).toBeDefined();
      expect(particleEffect?.type).toBe("body_effect");
      expect(particleEffect?.parameters?.particleCount).toBe(150);
      expect(particleEffect?.parameters?.particleColor).toBe("#ff6600");
    }

    // Zero audio duplication
    expect(scene.audioLayers).toHaveLength(1);
    expect(scene.audioLayers[0].clipId).toBe("video-particles");
  });

  it("synthesizes particle emitter layer in front of subject when behindSubject is false", () => {
    const videoWithFrontParticles: VideoClip = {
      ...videoClip,
      id: "video-particles-front",
      ...({
        torsoAnchors: dummyTorsoFacingForward,
        behindSubject: false,
        particleEmitterConfig: {
          emitterType: "point",
          anchorSource: "wrists",
          particleCount: 100,
          lifetimeSec: 1.0,
          colorStart: "#00ffff",
        } satisfies ParticleEmitterConfig,
      } as any),
    };

    const scene = evaluateScene(1.0, [videoWithFrontParticles], tracks, assets, project);

    // Only 2 layers: base video and foreground particle layer (no cutout needed)
    expect(scene.visualLayers).toHaveLength(2);
    const baseMedia = scene.visualLayers.find((l) => l.layerId === "video-particles-front");
    const particleLayer = scene.visualLayers.find(
      (l) => l.layerId === "video-particles-front:particle-emitter",
    );

    expect(baseMedia).toBeDefined();
    expect(particleLayer).toBeDefined();
    expect(particleLayer!.zIndex).toBeGreaterThan(baseMedia!.zIndex);
    expect(scene.visualLayers.some((l) => l.layerId.endsWith(":subject-cutout"))).toBe(false);
  });

  it("synthesizes cutout layer when clip declares layerZOrder: 'behind-subject' (manifest compositing spec)", () => {
    const textClip = createTextClip({
      id: "text-layer-zorder",
      text: "Behind Person Headline (layerZOrder)",
      layerZOrder: "behind-subject",
      subjectFeather: 5,
    });

    const scene = evaluateScene(3.0, [videoClip, textClip], tracks, assets, project);

    expect(scene.visualLayers).toHaveLength(3);
    const baseMedia = scene.visualLayers.find(
      (l) => l.layerType === "media" && !l.layerId.endsWith(":subject-cutout"),
    );
    const textLayer = scene.visualLayers.find((l) => l.layerType === "text");
    const cutoutLayer = scene.visualLayers.find(
      (l) => l.layerType === "media" && l.layerId.endsWith(":subject-cutout"),
    );

    expect(baseMedia).toBeDefined();
    expect(textLayer).toBeDefined();
    expect(cutoutLayer).toBeDefined();
    expect(baseMedia!.zIndex).toBeLessThan(textLayer!.zIndex);
    expect(cutoutLayer!.zIndex).toBeGreaterThan(textLayer!.zIndex);

    const cutoutEffect = cutoutLayer?.effects?.find((fx) => fx.renderer === "body_cutout");
    expect(cutoutEffect).toBeDefined();
    expect(cutoutEffect?.parameters?.feather).toBe(5);
  });

  it("synthesizes cutout layer with custom feather when clip declares compositing: { layerZOrder: 'behind-subject', feather: 8 }", () => {
    const textClip = createTextClip({
      id: "text-compositing-spec",
      text: "Behind Person Headline (compositing spec)",
      compositing: {
        layerZOrder: "behind-subject",
        feather: 8,
      },
    });

    const scene = evaluateScene(3.0, [videoClip, textClip], tracks, assets, project);

    expect(scene.visualLayers).toHaveLength(3);
    const cutoutLayer = scene.visualLayers.find(
      (l) => l.layerType === "media" && l.layerId.endsWith(":subject-cutout"),
    );

    expect(cutoutLayer).toBeDefined();
    const cutoutEffect = cutoutLayer?.effects?.find((fx) => fx.renderer === "body_cutout");
    expect(cutoutEffect).toBeDefined();
    expect(cutoutEffect?.parameters?.feather).toBe(8);
  });
});
