/**
 * Procedural Skeletal Particle Emitter Simulation
 *
 * Simulates real-time GPU/Canvas-ready particles anchored to 3D MediaPipe pose
 * landmarks (wrists, spine, neck, contour) with torso kinematics alignment,
 * buoyancy (upward drift), curl turbulence, and zero-allocation recycling.
 */

import type {
  ParticleAnchorSource,
  ParticleEmitterConfig,
  TorsoAnchors,
} from "@clypra-studio/types";
import {
  quaternionToEulerDeg,
  resolveAnchorPoint,
  getTorsoWidth,
  getTorsoHeight,
} from "./skeletalAnchorCalculator";

export interface ParticleInstance {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  age: number;
  maxAge: number;
  color: [number, number, number, number]; // RGBA [0, 1]
}

export interface ParticleSystemState {
  particles: ParticleInstance[];
  lastTimeSec: number;
  maxCount: number;
}

/**
 * Parses HEX or RGBA color string into normalized [r, g, b, a] array.
 */
export function parseNormalizedColor(colorStr?: string): [number, number, number, number] {
  if (!colorStr) return [1.0, 1.0, 1.0, 1.0];
  const str = colorStr.trim();
  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
        1.0,
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1.0,
      ];
    }
  }
  return [1.0, 0.6, 0.1, 1.0]; // Default warm flame
}

/**
 * Seeds a single particle at the designated torso anchor source.
 */
export function seedParticle(
  torso: TorsoAnchors,
  config: ParticleEmitterConfig,
  canvasWidth: number,
  canvasHeight: number,
  particleOut: ParticleInstance,
): void {
  const anchor = config.anchorSource;
  const torsoWidth = getTorsoWidth(torso);
  const torsoHeight = getTorsoHeight(torso);
  const euler = quaternionToEulerDeg(torso.torsoOrientation);
  const yawRad = (euler.yawDeg * Math.PI) / 180;

  let normX = 0.5;
  let normY = 0.5;

  switch (anchor) {
    case "wrists": {
      // Alternate between left and right wrist
      const pickLeft = Math.random() > 0.5;
      const wrist = pickLeft ? torso.leftWrist : torso.rightWrist;
      normX = wrist.x + (Math.random() - 0.5) * 0.04;
      normY = wrist.y + (Math.random() - 0.5) * 0.04;
      break;
    }
    case "neck": {
      const pt = resolveAnchorPoint(torso, "neck");
      normX = pt.x + (Math.random() - 0.5) * torsoWidth * 0.5;
      normY = pt.y + (Math.random() - 0.5) * 0.03;
      break;
    }
    case "spine": {
      const pt = resolveAnchorPoint(torso, "spineCenter");
      normX = pt.x + (Math.random() - 0.5) * torsoWidth * 0.6;
      normY = pt.y + (Math.random() - 0.5) * torsoHeight * 0.5;
      break;
    }
    case "silhouette":
    default: {
      // Distribute along outer contour of shoulders and torso
      const t = Math.random();
      const leftPt = torso.leftShoulder;
      const rightPt = torso.rightShoulder;
      const basePt = resolveAnchorPoint(torso, "spineCenter");
      if (t < 0.5) {
        // Upper shoulder contour
        normX = leftPt.x + (rightPt.x - leftPt.x) * (t * 2.0);
        normY = leftPt.y + (Math.random() - 0.5) * 0.05;
      } else {
        // Torso flank contour
        const sideLeft = Math.random() > 0.5;
        const shoulder = sideLeft ? leftPt : rightPt;
        normX = shoulder.x + (sideLeft ? -1 : 1) * torsoWidth * 0.2;
        normY = shoulder.y + (basePt.y - shoulder.y) * ((t - 0.5) * 2.0);
      }
      break;
    }
  }

  const speed = config.speed ?? 80; // px/sec
  const baseVx = (Math.random() - 0.5) * speed * 0.6;
  // Upward thermal buoyancy (flame drift) plus yaw skew
  const baseVy = -Math.abs(speed * (0.8 + Math.random() * 0.5));
  const yawDrift = Math.sin(yawRad) * speed * 0.4;

  const lifetime = Math.max(0.2, (config.lifetimeSec ?? 1.2) * (0.7 + Math.random() * 0.6));
  const startSize = (config.sizeStart ?? 14) * (0.8 + Math.random() * 0.5);

  particleOut.x = normX * canvasWidth;
  particleOut.y = normY * canvasHeight;
  particleOut.vx = baseVx + yawDrift;
  particleOut.vy = baseVy;
  particleOut.size = startSize;
  particleOut.alpha = 1.0;
  particleOut.age = 0;
  particleOut.maxAge = lifetime;
  particleOut.color = parseNormalizedColor(config.colorStart);
}

/**
 * Initializes a fixed-capacity particle system.
 */
export function createParticleSystem(
  config: ParticleEmitterConfig,
  torso: TorsoAnchors,
  canvasWidth: number,
  canvasHeight: number,
): ParticleSystemState {
  const count = Math.min(500, Math.max(10, config.particleCount));
  const particles: ParticleInstance[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const p: ParticleInstance = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 0,
      alpha: 0,
      age: 0,
      maxAge: 1,
      color: [1, 1, 1, 1],
    };
    seedParticle(torso, config, canvasWidth, canvasHeight, p);
    // Stagger initial ages so particles don't all die and re-spawn at once
    p.age = p.maxAge * (i / count);
    particles[i] = p;
  }

  return {
    particles,
    lastTimeSec: 0,
    maxCount: count,
  };
}

/**
 * Steps the particle system by dt seconds, updating kinematics and recycling dead particles.
 */
export function stepParticleSystem(
  state: ParticleSystemState,
  dt: number,
  torso: TorsoAnchors,
  config: ParticleEmitterConfig,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const gravity = config.gravity ?? -40; // Negative = upward buoyancy
  const turbulence = config.turbulence ?? 25;
  const startSize = config.sizeStart ?? 14;
  const endSize = config.sizeEnd ?? 3;
  const startColor = parseNormalizedColor(config.colorStart);
  const endColor = parseNormalizedColor(config.colorEnd);

  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    p.age += dt;

    if (p.age >= p.maxAge) {
      // Recycle particle in place with zero allocation
      seedParticle(torso, config, canvasWidth, canvasHeight, p);
      continue;
    }

    const lifeRatio = p.age / p.maxAge; // [0, 1]

    // Buoyancy acceleration
    p.vy += gravity * dt;

    // Curl noise / sinusoidal turbulence displacement
    const turbAngle = p.y * 0.05 + p.age * 8.0;
    const turbVx = Math.sin(turbAngle) * turbulence;
    const turbVy = Math.cos(turbAngle * 0.7) * turbulence * 0.5;

    // Euler integration
    p.x += (p.vx + turbVx) * dt;
    p.y += (p.vy + turbVy) * dt;

    // Smooth quadratic alpha falloff: (1 - t)^1.5
    p.alpha = Math.max(0, Math.pow(1 - lifeRatio, 1.5));

    // Size decay
    p.size = startSize + (endSize - startSize) * lifeRatio;

    // Color ramp interpolation from colorStart to colorEnd
    p.color[0] = startColor[0] + (endColor[0] - startColor[0]) * lifeRatio;
    p.color[1] = startColor[1] + (endColor[1] - startColor[1]) * lifeRatio;
    p.color[2] = startColor[2] + (endColor[2] - startColor[2]) * lifeRatio;
    p.color[3] = (startColor[3] + (endColor[3] - startColor[3]) * lifeRatio) * p.alpha;
  }
}

/**
 * Returns packed Float32Array: [x, y, size, alpha, r, g, b, 0] per particle.
 * Stride = 8 floats per particle (32-byte GPU vertex/instance alignment).
 */
export function getPackedParticleBuffer(state: ParticleSystemState): Float32Array {
  const stride = 8;
  const buffer = new Float32Array(state.particles.length * stride);
  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    const offset = i * stride;
    buffer[offset] = p.x;
    buffer[offset + 1] = p.y;
    buffer[offset + 2] = p.size;
    buffer[offset + 3] = p.alpha;
    buffer[offset + 4] = p.color[0];
    buffer[offset + 5] = p.color[1];
    buffer[offset + 6] = p.color[2];
    buffer[offset + 7] = 0; // Padding to 32 bytes
  }
  return buffer;
}
