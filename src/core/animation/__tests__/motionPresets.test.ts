import { describe, it, expect } from "vitest";
import {
  MOTION_IN_PRESETS,
  MOTION_OUT_PRESETS,
  MOTION_LOOP_PRESETS,
  compileClipMotionKeyframes,
  applyLoopMotion,
} from "../motionPresets";
import { resolveResponsiveKeyframes } from "../timeAnchor";

describe("Motion Presets & Kinetic Behavior Engine", () => {
  describe("Preset Catalogs", () => {
    it("contains comprehensive In, Out, and Loop presets", () => {
      const inIds = MOTION_IN_PRESETS.map((p) => p.id);
      expect(inIds).toContain("pop-in");
      expect(inIds).toContain("bounce-in");
      expect(inIds).toContain("slide-up");
      expect(inIds).toContain("slide-down");
      expect(inIds).toContain("slide-left");
      expect(inIds).toContain("slide-right");
      expect(inIds).toContain("zoom-in");
      expect(inIds).toContain("fade-in");
      expect(inIds).toContain("whip-pan");

      const outIds = MOTION_OUT_PRESETS.map((p) => p.id);
      expect(outIds).toContain("fade-out");
      expect(outIds).toContain("pop-out");
      expect(outIds).toContain("slide-down");
      expect(outIds).toContain("slide-up");
      expect(outIds).toContain("slide-left");
      expect(outIds).toContain("slide-right");
      expect(outIds).toContain("drop-down");
      expect(outIds).toContain("zoom-out");

      const loopIds = MOTION_LOOP_PRESETS.map((p) => p.id);
      expect(loopIds).toContain("float");
      expect(loopIds).toContain("pulse");
      expect(loopIds).toContain("wiggle");
      expect(loopIds).toContain("heartbeat");
      expect(loopIds).toContain("pendulum");
    });
  });

  describe("compileClipMotionKeyframes - Build-In (anchor: 'start')", () => {
    const baseClip = {
      x: 100,
      y: 200,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
    };

    it("compiles pop-in spring animation with start anchor", () => {
      const keyframes = compileClipMotionKeyframes(baseClip, {
        inPreset: "pop-in",
        inDuration: 0.5,
      });

      expect(keyframes.width).toBeDefined();
      expect(keyframes.height).toBeDefined();
      expect(keyframes.opacity).toBeDefined();

      const wKfs = keyframes.width!;
      expect(wKfs).toHaveLength(2);
      expect(wKfs[0].anchor).toBe("start");
      expect(wKfs[0].time).toBe(0);
      expect(wKfs[0].value).toBe(0);

      expect(wKfs[1].anchor).toBe("start");
      expect(wKfs[1].time).toBe(0.5);
      expect(wKfs[1].value).toBe(400);
      expect(wKfs[1].easing).toBe("springSnappy");
    });

    it("compiles slide-up entrance with custom distance", () => {
      const keyframes = compileClipMotionKeyframes(baseClip, {
        inPreset: "slide-up",
        inDuration: 0.4,
        inDistance: 150,
      });

      expect(keyframes.y).toBeDefined();
      const yKfs = keyframes.y!;
      expect(yKfs[0].value).toBe(200 + 150); // Start below
      expect(yKfs[1].value).toBe(200); // Settle at base
      expect(yKfs[0].anchor).toBe("start");
      expect(yKfs[1].anchor).toBe("start");
    });
  });

  describe("compileClipMotionKeyframes - Build-Out (anchor: 'end')", () => {
    const baseClip = {
      x: 100,
      y: 200,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
    };

    it("compiles fade-out with end anchor", () => {
      const keyframes = compileClipMotionKeyframes(baseClip, {
        outPreset: "fade-out",
        outDuration: 0.6,
      });

      expect(keyframes.opacity).toBeDefined();
      const opKfs = keyframes.opacity!;
      expect(opKfs).toHaveLength(2);
      expect(opKfs[0].anchor).toBe("end");
      expect(opKfs[0].time).toBe(0.6); // 0.6s from end
      expect(opKfs[0].value).toBe(1);

      expect(opKfs[1].anchor).toBe("end");
      expect(opKfs[1].time).toBe(0); // at clip end
      expect(opKfs[1].value).toBe(0);
    });

    it("compiles pop-out with anticipation easing", () => {
      const keyframes = compileClipMotionKeyframes(baseClip, {
        outPreset: "pop-out",
        outDuration: 0.4,
      });

      expect(keyframes.width).toBeDefined();
      const wKfs = keyframes.width!;
      expect(wKfs[0].anchor).toBe("end");
      expect(wKfs[0].value).toBe(400);
      expect(wKfs[1].anchor).toBe("end");
      expect(wKfs[1].value).toBe(0);
    });
  });

  describe("Dual In + Out compilation and Responsive Retiming", () => {
    it("simultaneously compiles in and out animations that re-anchor across clip durations", () => {
      const baseClip = {
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        opacity: 1,
      };

      const keyframes = compileClipMotionKeyframes(baseClip, {
        inPreset: "pop-in",
        inDuration: 0.5,
        outPreset: "fade-out",
        outDuration: 0.5,
      });

      // Opacity has both in-keyframes and out-keyframes
      const opKfs = keyframes.opacity!;
      expect(opKfs.length).toBeGreaterThanOrEqual(4);

      // Resolve on a 10s clip
      const resolved10s = resolveResponsiveKeyframes(opKfs, 10);
      expect(resolved10s[0].resolvedTime).toBe(0); // Intro start
      expect(resolved10s[resolved10s.length - 1].resolvedTime).toBe(10); // Outro finish

      // Resolve on a 4s clip (clip trimmed)
      const resolved4s = resolveResponsiveKeyframes(opKfs, 4);
      expect(resolved4s[0].resolvedTime).toBe(0);
      expect(resolved4s[resolved4s.length - 1].resolvedTime).toBe(4);
    });
  });

  describe("applyLoopMotion", () => {
    const base = {
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
    };

    it("returns unmodified transform when loop preset is none", () => {
      expect(applyLoopMotion("none", 2.5, base)).toEqual(base);
      expect(applyLoopMotion(undefined, 2.5, base)).toEqual(base);
    });

    it("modulates Y and X positions for float preset", () => {
      const t1 = applyLoopMotion("float", 0.5, base);
      expect(t1.y).not.toBe(base.y);
      expect(t1.width).toBe(base.width);
      expect(t1.rotation).toBe(base.rotation);
    });

    it("modulates scale for pulse preset", () => {
      const t1 = applyLoopMotion("pulse", 0.5, base);
      expect(t1.x).toBe(base.x);
      expect(t1.y).toBe(base.y);
      expect(t1.width).not.toBe(base.width);
      expect(t1.height).not.toBe(base.height);
    });

    it("modulates rotation for wiggle preset", () => {
      const t1 = applyLoopMotion("wiggle", 0.3, base);
      expect(t1.x).toBe(base.x);
      expect(t1.rotation).not.toBe(base.rotation);
    });

    it("scales modulation amplitude with intensity parameter", () => {
      const low = applyLoopMotion("wiggle", 0.25, base, 1.0, 0.5);
      const high = applyLoopMotion("wiggle", 0.25, base, 1.0, 2.0);
      expect(Math.abs(high.rotation)).toBeGreaterThan(Math.abs(low.rotation));
    });

    it("modulates wave with coupled Y and rotation offsets", () => {
      const t = applyLoopMotion("wave", 0.5, base);
      expect(t.y).not.toBe(base.y);
      expect(t.rotation).not.toBe(base.rotation);
    });

    it("modulates neon-blink with opacity strobing", () => {
      const tFlicker = applyLoopMotion("neon-blink", 0.02, base);
      expect(tFlicker.opacity).toBeLessThan(base.opacity);
    });

    it("modulates shiver with high-frequency micro-jitter", () => {
      const t = applyLoopMotion("shiver", 0.1, base);
      expect(t.x).not.toBe(base.x);
      expect(t.y).not.toBe(base.y);
    });
  });

  describe("CapCut Starter Presets Compilation", () => {
    const baseClip = {
      x: 100,
      y: 200,
      width: 400,
      height: 120,
      rotation: 0,
      opacity: 1,
    };

    it("compiles typewriter entrance with linear opacity and subtle scale pop", () => {
      const kf = compileClipMotionKeyframes(baseClip, {
        inPreset: "typewriter",
        inDuration: 0.6,
      });
      expect(kf.opacity).toHaveLength(2);
      expect(kf.opacity![0].value).toBe(0);
      expect(kf.opacity![1].value).toBe(1);
      expect(kf.width![0].value).toBe(380);
      expect(kf.width![1].value).toBe(400);
    });

    it("compiles flip-in with 3D rotation and vertical overshoot", () => {
      const kf = compileClipMotionKeyframes(baseClip, {
        inPreset: "flip-in",
        inDuration: 0.6,
      });
      expect(kf.rotation).toHaveLength(2);
      expect(kf.rotation![0].value).toBe(-90);
      expect(kf.rotation![1].value).toBe(0);
      expect(kf.y![0].value).toBe(170);
      expect(kf.y![1].value).toBe(200);
    });

    it("compiles flip-out with 3D departure rotation", () => {
      const kf = compileClipMotionKeyframes(baseClip, {
        outPreset: "flip-out",
        outDuration: 0.5,
      });
      expect(kf.rotation).toHaveLength(2);
      expect(kf.rotation![0].anchor).toBe("end");
      expect(kf.rotation![0].value).toBe(0);
      expect(kf.rotation![1].value).toBe(90);
    });

    it("compiles 8bit-melt with pixelated downward stretch", () => {
      const kf = compileClipMotionKeyframes(baseClip, {
        outPreset: "8bit-melt",
        outDuration: 0.5,
      });
      expect(kf.width).toHaveLength(2);
      expect(kf.width![1].value).toBe(520);
      expect(kf.opacity![1].value).toBe(0);
    });
  });
});
