import { describe, expect, it } from "vitest";
import type { ParticleEmitterConfig, TorsoAnchors } from "@clypra-studio/types";
import {
  createParticleSystem,
  getPackedParticleBuffer,
  parseNormalizedColor,
  seedParticle,
  stepParticleSystem,
  type ParticleInstance,
} from "../capture/skeletalParticleEmitter";

describe("skeletalParticleEmitter", () => {
  const dummyTorso: TorsoAnchors = {
    leftShoulder: { x: 0.3875, y: 0.3, z: 0, visibility: 1 },
    rightShoulder: { x: 0.6125, y: 0.3, z: 0, visibility: 1 },
    neck: { x: 0.5, y: 0.25, z: 0, visibility: 1 },
    spineCenter: { x: 0.5, y: 0.5, z: 0, visibility: 1 },
    leftWrist: { x: 0.25, y: 0.65, z: 0, visibility: 1 },
    rightWrist: { x: 0.75, y: 0.65, z: 0, visibility: 1 },
    torsoOrientation: { x: 0, y: 0, z: 0, w: 1 },
    ...({
      torsoWidth: 0.225,
      torsoHeight: 0.5,
    } as any),
  };

  const canvasWidth = 1920;
  const canvasHeight = 1080;

  const baseConfig: ParticleEmitterConfig = {
    emitterType: "point",
    anchorSource: "spine",
    particleCount: 50,
    lifetimeSec: 1.0,
    gravity: -50, // Upward buoyancy
    turbulence: 20,
    sizeStart: 16,
    sizeEnd: 4,
    colorStart: "#FFAA00",
    colorEnd: "#FF2200",
  };

  describe("parseNormalizedColor", () => {
    it("parses 6-digit hex colors accurately", () => {
      const col = parseNormalizedColor("#FF8000");
      expect(col[0]).toBeCloseTo(1.0, 2);
      expect(col[1]).toBeCloseTo(0.502, 2);
      expect(col[2]).toBeCloseTo(0.0, 2);
      expect(col[3]).toBe(1.0);
    });

    it("parses 3-digit hex colors accurately", () => {
      const col = parseNormalizedColor("#F00");
      expect(col[0]).toBeCloseTo(1.0, 2);
      expect(col[1]).toBeCloseTo(0.0, 2);
      expect(col[2]).toBeCloseTo(0.0, 2);
    });
  });

  describe("seedParticle", () => {
    it("seeds wrist particles near left or right wrist coordinates", () => {
      const p: ParticleInstance = {
        x: 0, y: 0, vx: 0, vy: 0, size: 0, alpha: 0, age: 0, maxAge: 1, color: [1, 1, 1, 1],
      };
      const wristConfig: ParticleEmitterConfig = { ...baseConfig, anchorSource: "wrists" };
      seedParticle(dummyTorso, wristConfig, canvasWidth, canvasHeight, p);

      const leftWristX = dummyTorso.leftWrist.x * canvasWidth;
      const rightWristX = dummyTorso.rightWrist.x * canvasWidth;
      const wristY = dummyTorso.leftWrist.y * canvasHeight;

      // Should be close to either left or right wrist
      const distLeft = Math.hypot(p.x - leftWristX, p.y - wristY);
      const distRight = Math.hypot(p.x - rightWristX, p.y - wristY);
      expect(Math.min(distLeft, distRight)).toBeLessThan(100);
      expect(p.vy).toBeLessThan(0); // Upward velocity
    });

    it("seeds neck particles near neck landmark", () => {
      const p: ParticleInstance = {
        x: 0, y: 0, vx: 0, vy: 0, size: 0, alpha: 0, age: 0, maxAge: 1, color: [1, 1, 1, 1],
      };
      const neckConfig: ParticleEmitterConfig = { ...baseConfig, anchorSource: "neck" };
      seedParticle(dummyTorso, neckConfig, canvasWidth, canvasHeight, p);

      const neckX = dummyTorso.neck.x * canvasWidth;
      const neckY = dummyTorso.neck.y * canvasHeight;
      expect(Math.hypot(p.x - neckX, p.y - neckY)).toBeLessThan(150);
    });
  });

  describe("stepParticleSystem", () => {
    it("advances particles, decays alpha, and recycles dead particles without changing pool size", () => {
      const state = createParticleSystem(baseConfig, dummyTorso, canvasWidth, canvasHeight);
      expect(state.particles).toHaveLength(50);

      const initialY = state.particles.map((p) => p.y);

      // Step forward by 0.1s
      stepParticleSystem(state, 0.1, dummyTorso, baseConfig, canvasWidth, canvasHeight);

      // Verify buoyancy: particles should rise (Y decreases in screen space)
      let risingCount = 0;
      for (let i = 0; i < state.particles.length; i++) {
        if (state.particles[i].y < initialY[i]) {
          risingCount++;
        }
      }
      expect(risingCount).toBeGreaterThan(40);

      // Fast forward by 2.0 seconds (well past lifetime of 1.0s)
      stepParticleSystem(state, 2.0, dummyTorso, baseConfig, canvasWidth, canvasHeight);

      // Pool size must remain strictly constant
      expect(state.particles).toHaveLength(50);
      for (const p of state.particles) {
        expect(p.alpha).toBeGreaterThanOrEqual(0);
        expect(p.alpha).toBeLessThanOrEqual(1.0);
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    });
  });

  describe("getPackedParticleBuffer", () => {
    it("packs particles into Float32Array with 8-float stride (32 bytes per particle)", () => {
      const state = createParticleSystem(baseConfig, dummyTorso, canvasWidth, canvasHeight);
      const buffer = getPackedParticleBuffer(state);

      expect(buffer).toBeInstanceOf(Float32Array);
      expect(buffer.length).toBe(50 * 8);

      // Check first particle properties
      const p0 = state.particles[0];
      expect(buffer[0]).toBeCloseTo(p0.x, 2);
      expect(buffer[1]).toBeCloseTo(p0.y, 2);
      expect(buffer[2]).toBeCloseTo(p0.size, 2);
      expect(buffer[3]).toBeCloseTo(p0.alpha, 2);
      expect(buffer[4]).toBeCloseTo(p0.color[0], 2);
      expect(buffer[5]).toBeCloseTo(p0.color[1], 2);
      expect(buffer[6]).toBeCloseTo(p0.color[2], 2);
      expect(buffer[7]).toBe(0); // 32-byte alignment padding
    });
  });
});
