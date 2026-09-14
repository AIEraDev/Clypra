/**
 * Skeletal Anchor & Kinematic Transform Calculator
 *
 * Computes world-space 2D/3D affine transformation matrices and depth sorting
 * from TorsoAnchors, skeletal landmarks, and SkeletalAnchorConfig.
 */

import type {
  Quaternion,
  SkeletalAnchorConfig,
  SkeletalAnchorKeypoint,
  TorsoAnchors,
} from "@clypra-studio/types";

export interface ResolvedAnchorTransform {
  /** Screen position X in pixels (center of sprite) */
  x: number;
  /** Screen position Y in pixels (center of sprite) */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Rotation angle in degrees */
  rotationDeg: number;
  /** Depth flag: true = render behind subject cutout, false = render in front */
  isBehindSubject: boolean;
  /** Opacity multiplier (e.g. for smooth yaw transitions) */
  opacity: number;
  /** Sprite asset URI to render */
  spriteUri: string;
}

export interface ResolvedSkeletalSprites {
  /** Single sprite or main sprite */
  main?: ResolvedAnchorTransform;
  /** Left wing / left side sprite when dual sprite is configured */
  left?: ResolvedAnchorTransform;
  /** Right wing / right side sprite when dual sprite is configured */
  right?: ResolvedAnchorTransform;
  /** Calculated yaw angle in degrees (-180 to 180) */
  yawDeg: number;
  /** Calculated pitch angle in degrees (-90 to 90) */
  pitchDeg: number;
  /** Calculated roll angle in degrees (-180 to 180) */
  rollDeg: number;
}

/**
 * Extracts Euler angles (yaw, pitch, roll) in degrees from a unit quaternion [x, y, z, w].
 */
export function quaternionToEulerDeg(q: Quaternion): {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
} {
  // Yaw (Y axis rotation)
  const siny_cosp = 2 * (q.w * q.y + q.x * q.z);
  const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);

  // Pitch (X axis rotation)
  const sinp = 2 * (q.w * q.x - q.y * q.z);
  let pitch = 0;
  if (Math.abs(sinp) >= 1) {
    pitch = (Math.sign(sinp) * Math.PI) / 2;
  } else {
    pitch = Math.asin(sinp);
  }

  // Roll (Z axis rotation)
  const sinr_cosp = 2 * (q.w * q.z + q.x * q.y);
  const cosr_cosp = 1 - 2 * (q.x * q.x + q.z * q.z);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);

  return {
    yawDeg: (yaw * 180) / Math.PI,
    pitchDeg: (pitch * 180) / Math.PI,
    rollDeg: (roll * 180) / Math.PI,
  };
}

/**
 * Resolves anchor 2D coordinates [x, y] in normalized [0, 1] space from TorsoAnchors.
 */
export function resolveAnchorPoint(
  torso: TorsoAnchors,
  keypoint: SkeletalAnchorKeypoint,
): { x: number; y: number } {
  switch (keypoint) {
    case "neck":
      return { x: torso.neck.x, y: torso.neck.y };
    case "spineCenter":
      return { x: torso.spineCenter.x, y: torso.spineCenter.y };
    case "hipCenter":
      if ((torso as any).hipCenter) {
        return { x: (torso as any).hipCenter.x, y: (torso as any).hipCenter.y };
      }
      return {
        x: torso.spineCenter.x + (torso.spineCenter.x - torso.neck.x),
        y: torso.spineCenter.y + (torso.spineCenter.y - torso.neck.y),
      };
    case "leftShoulder":
      return { x: torso.leftShoulder.x, y: torso.leftShoulder.y };
    case "rightShoulder":
      return { x: torso.rightShoulder.x, y: torso.rightShoulder.y };
    default:
      return { x: torso.spineCenter.x, y: torso.spineCenter.y };
  }
}

export function getTorsoWidth(torso: TorsoAnchors): number {
  if (typeof (torso as any).torsoWidth === "number") return (torso as any).torsoWidth;
  const dx = torso.leftShoulder.x - torso.rightShoulder.x;
  const dy = torso.leftShoulder.y - torso.rightShoulder.y;
  return Math.max(0.05, Math.hypot(dx, dy));
}

export function getTorsoHeight(torso: TorsoAnchors): number {
  if (typeof (torso as any).torsoHeight === "number") return (torso as any).torsoHeight;
  const dx = torso.neck.x - torso.spineCenter.x;
  const dy = torso.neck.y - torso.spineCenter.y;
  return Math.max(0.1, Math.hypot(dx, dy) * 2.0);
}

/**
 * Computes world-space sprite placement and dual-wing depth sorting from torso kinematics.
 */
export function calculateSkeletalSpriteTransforms(
  torso: TorsoAnchors,
  canvasWidth: number,
  canvasHeight: number,
  config: SkeletalAnchorConfig,
): ResolvedSkeletalSprites {
  const euler = quaternionToEulerDeg(torso.torsoOrientation);
  const yaw = euler.yawDeg;
  const roll = euler.rollDeg;

  const torsoWidth = getTorsoWidth(torso);
  const torsoHeight = getTorsoHeight(torso);

  const baseScaleX = config.scaleX ?? 1.5;
  const baseScaleY = config.scaleY ?? 1.5;
  const offsetX = config.offsetX ?? 0;
  const offsetY = config.offsetY ?? 0;
  const rotationOffset = config.rotationDeg ?? 0;
  const followOrientation = config.followTorsoOrientation ?? true;
  const depthMode = config.depthMode ?? "behind-subject";

  const totalRotation = followOrientation ? roll + rotationOffset : rotationOffset;

  // Single sprite mode
  if (!config.dualSprite) {
    const pt = resolveAnchorPoint(torso, config.anchorKeypoint);
    const spriteW = canvasWidth * torsoWidth * baseScaleX;
    const spriteH = canvasHeight * torsoHeight * baseScaleY;
    const posX = canvasWidth * (pt.x + offsetX * torsoWidth);
    const posY = canvasHeight * (pt.y + offsetY * torsoHeight);

    const isBehind = depthMode === "behind-subject" || (depthMode === "auto-yaw" && Math.abs(yaw) < 90);

    return {
      main: {
        x: posX,
        y: posY,
        width: spriteW,
        height: spriteH,
        rotationDeg: totalRotation,
        isBehindSubject: isBehind,
        opacity: 1.0,
        spriteUri: config.spriteAssetUri ?? "",
      },
      ...euler,
    };
  }

  // Dual sprite mode (e.g. Left Wing + Right Wing)
  const leftKeypoint = config.dualSprite.leftAnchorKeypoint ?? "leftShoulder";
  const rightKeypoint = config.dualSprite.rightAnchorKeypoint ?? "rightShoulder";

  const leftPt = resolveAnchorPoint(torso, leftKeypoint);
  const rightPt = resolveAnchorPoint(torso, rightKeypoint);

  const leftW = canvasWidth * torsoWidth * baseScaleX;
  const leftH = canvasHeight * torsoHeight * baseScaleY;
  const rightW = canvasWidth * torsoWidth * baseScaleX;
  const rightH = canvasHeight * torsoHeight * baseScaleY;

  const leftX = canvasWidth * (leftPt.x - Math.abs(offsetX) * torsoWidth);
  const leftY = canvasHeight * (leftPt.y + offsetY * torsoHeight);
  const rightX = canvasWidth * (rightPt.x + Math.abs(offsetX) * torsoWidth);
  const rightY = canvasHeight * (rightPt.y + offsetY * torsoHeight);

  // Depth sorting logic:
  // When yaw > 10 deg (turning right): left shoulder is pushed back -> left wing behind, right wing in front
  // When yaw < -10 deg (turning left): right shoulder is pushed back -> right wing behind, left wing in front
  // Otherwise (facing camera): both wings behind subject
  let leftBehind = true;
  let rightBehind = true;

  if (depthMode === "in-front") {
    leftBehind = false;
    rightBehind = false;
  } else if (depthMode === "auto-yaw") {
    if (yaw > 10.0) {
      leftBehind = true;
      rightBehind = false;
    } else if (yaw < -10.0) {
      leftBehind = false;
      rightBehind = true;
    } else {
      leftBehind = true;
      rightBehind = true;
    }
  }

  return {
    left: {
      x: leftX,
      y: leftY,
      width: leftW,
      height: leftH,
      rotationDeg: totalRotation,
      isBehindSubject: leftBehind,
      opacity: 1.0,
      spriteUri: config.dualSprite.leftSpriteUri,
    },
    right: {
      x: rightX,
      y: rightY,
      width: rightW,
      height: rightH,
      rotationDeg: totalRotation,
      isBehindSubject: rightBehind,
      opacity: 1.0,
      spriteUri: config.dualSprite.rightSpriteUri,
    },
    ...euler,
  };
}
