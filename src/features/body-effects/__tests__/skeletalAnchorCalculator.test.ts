import { describe, expect, it } from "vitest";
import type { TorsoAnchors } from "@clypra-studio/types";
import {
  calculateSkeletalSpriteTransforms,
  quaternionToEulerDeg,
  resolveAnchorPoint,
} from "../capture/skeletalAnchorCalculator";

describe("skeletalAnchorCalculator", () => {
  const dummyTorsoFacingForward: TorsoAnchors = {
    leftShoulder: { x: 0.3875, y: 0.3, z: 0, visibility: 1 },
    rightShoulder: { x: 0.6125, y: 0.3, z: 0, visibility: 1 },
    neck: { x: 0.5, y: 0.3, z: 0, visibility: 1 },
    spineCenter: { x: 0.5, y: 0.5, z: 0, visibility: 1 },
    leftWrist: { x: 0.2, y: 0.7, z: 0, visibility: 1 },
    rightWrist: { x: 0.8, y: 0.7, z: 0, visibility: 1 },
    torsoOrientation: { x: 0, y: 0, z: 0, w: 1 }, // Identity: facing camera
    ...({
      hipCenter: { x: 0.5, y: 0.7, z: 0, visibility: 1 },
      torsoWidth: 0.25,
      torsoHeight: 0.4,
    } as any),
  };

  // Quaternion for +30 deg yaw (Y axis): sin(15°) = 0.2588, cos(15°) = 0.9659
  const dummyTorsoTurningRight: TorsoAnchors = {
    ...dummyTorsoFacingForward,
    torsoOrientation: { x: 0, y: 0.2588, z: 0, w: 0.9659 },
  };

  // Quaternion for -30 deg yaw (Y axis)
  const dummyTorsoTurningLeft: TorsoAnchors = {
    ...dummyTorsoFacingForward,
    torsoOrientation: { x: 0, y: -0.2588, z: 0, w: 0.9659 },
  };

  describe("quaternionToEulerDeg", () => {
    it("converts identity quaternion to zero degrees", () => {
      const euler = quaternionToEulerDeg({ x: 0, y: 0, z: 0, w: 1 });
      expect(euler.yawDeg).toBeCloseTo(0, 1);
      expect(euler.pitchDeg).toBeCloseTo(0, 1);
      expect(euler.rollDeg).toBeCloseTo(0, 1);
    });

    it("converts +30 deg Y rotation to ~30 deg yaw", () => {
      const euler = quaternionToEulerDeg({ x: 0, y: 0.2588, z: 0, w: 0.9659 });
      expect(euler.yawDeg).toBeCloseTo(30, 0);
    });
  });

  describe("resolveAnchorPoint", () => {
    it("resolves neck, spine, and shoulder offsets accurately", () => {
      const neck = resolveAnchorPoint(dummyTorsoFacingForward, "neck");
      expect(neck).toEqual({ x: 0.5, y: 0.3 });

      const leftShoulder = resolveAnchorPoint(dummyTorsoFacingForward, "leftShoulder");
      expect(leftShoulder.x).toBeLessThan(0.5);
      expect(leftShoulder.y).toBe(0.3);

      const rightShoulder = resolveAnchorPoint(dummyTorsoFacingForward, "rightShoulder");
      expect(rightShoulder.x).toBeGreaterThan(0.5);
      expect(rightShoulder.y).toBe(0.3);
    });
  });

  describe("calculateSkeletalSpriteTransforms", () => {
    it("places and scales a single sprite relative to canvas dimensions", () => {
      const res = calculateSkeletalSpriteTransforms(
        dummyTorsoFacingForward,
        1920,
        1080,
        {
          anchorKeypoint: "neck",
          scaleX: 2.0,
          scaleY: 1.5,
          spriteAssetUri: "/assets/effects/halo.png",
          depthMode: "behind-subject",
        },
      );

      expect(res.main).toBeDefined();
      expect(res.main?.width).toBeCloseTo(1920 * 0.25 * 2.0); // 960px
      expect(res.main?.height).toBeCloseTo(1080 * 0.4 * 1.5); // 648px
      expect(res.main?.isBehindSubject).toBe(true);
    });

    it("evaluates auto-yaw depth parallax for dual wings when turning right", () => {
      const res = calculateSkeletalSpriteTransforms(
        dummyTorsoTurningRight,
        1920,
        1080,
        {
          anchorKeypoint: "neck",
          depthMode: "auto-yaw",
          dualSprite: {
            leftSpriteUri: "/wings/left.png",
            rightSpriteUri: "/wings/right.png",
          },
        },
      );

      expect(res.left).toBeDefined();
      expect(res.right).toBeDefined();
      expect(res.yawDeg).toBeGreaterThan(10);
      // When turning right, left shoulder is pushed back -> left wing is behind, right wing is in front!
      expect(res.left?.isBehindSubject).toBe(true);
      expect(res.right?.isBehindSubject).toBe(false);
    });

    it("evaluates auto-yaw depth parallax for dual wings when turning left", () => {
      const res = calculateSkeletalSpriteTransforms(
        dummyTorsoTurningLeft,
        1920,
        1080,
        {
          anchorKeypoint: "neck",
          depthMode: "auto-yaw",
          dualSprite: {
            leftSpriteUri: "/wings/left.png",
            rightSpriteUri: "/wings/right.png",
          },
        },
      );

      expect(res.yawDeg).toBeLessThan(-10);
      // When turning left, right shoulder is pushed back -> right wing is behind, left wing is in front!
      expect(res.left?.isBehindSubject).toBe(false);
      expect(res.right?.isBehindSubject).toBe(true);
    });

    it("places both wings behind when facing forward in auto-yaw mode", () => {
      const res = calculateSkeletalSpriteTransforms(
        dummyTorsoFacingForward,
        1920,
        1080,
        {
          anchorKeypoint: "neck",
          depthMode: "auto-yaw",
          dualSprite: {
            leftSpriteUri: "/wings/left.png",
            rightSpriteUri: "/wings/right.png",
          },
        },
      );

      expect(Math.abs(res.yawDeg)).toBeLessThan(5);
      expect(res.left?.isBehindSubject).toBe(true);
      expect(res.right?.isBehindSubject).toBe(true);
    });
  });
});
