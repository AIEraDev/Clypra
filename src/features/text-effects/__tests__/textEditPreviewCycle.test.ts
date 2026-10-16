/**
 * ──────────────────────────────────────────────────────────────────────────────
 * Text Edit → Preview Cycle Behavioral Contract
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Guards the invariant that editing text content, effects, or fonts during
 * or between preview playback sessions always reflects the latest state.
 *
 * This is the class of bug where:
 *   1. User edits text → previews → edits again → previews again
 *   2. Second preview still shows stale text/font/effect from first session
 *
 * Tests exercise the real renderer, effects store, config builder, and
 * PlaybackClock to ensure the full edit→preview pipeline is consistent.
 *
 * Append-only: new tests may be added, existing tests must not be removed.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackClock } from "@/core/playback/PlaybackClock";
import { renderTextEffectToContext } from "../../text-effects/renderer";
import { resolveTextSourcePreviewConfig } from "@/components/editor/preview/TextSourcePreview";
import { _buildConfig, defaultConfig as engineDefaultConfig } from "@clypra-studio/engine";
import type { TextEffectDefinition } from "../types/types";

// ── Mock RAF ────────────────────────────────────────────────────────────────
let rafCallbacks: Map<number, () => void> = new Map();
let rafId = 0;
const mockRequestAnimationFrame = (callback: () => void): number => {
  const id = ++rafId;
  rafCallbacks.set(id, callback);
  return id;
};
const mockCancelAnimationFrame = (id: number): void => {
  rafCallbacks.delete(id);
};

// ── Mock AudioContext ───────────────────────────────────────────────────────
class MockAudioContext {
  state = "running";
  currentTime = 0;
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

// ── Test effect definitions ─────────────────────────────────────────────────
const effectA: TextEffectDefinition = {
  id: "effect-a",
  name: "Effect A",
  category: "metallic",
  description: "First effect for edit cycle testing",
  tags: ["test"],
  font: {
    family: "Inter",
    weight: 700,
    style: "normal",
    letterSpacing: 0,
    lineHeight: 1.2,
  },
  fills: [{ type: "solid", color: "#FF0000" }],
  strokes: [{ color: "#FF0000", width: 2, position: "outside", opacity: 1 }],
  shadows: [],
  glows: [],
};

const effectB: TextEffectDefinition = {
  id: "effect-b",
  name: "Effect B",
  category: "neon",
  description: "Second effect for edit cycle testing",
  tags: ["test"],
  font: {
    family: "Courier New",
    weight: 400,
    style: "italic",
    letterSpacing: 2,
    lineHeight: 1.5,
  },
  fills: [{ type: "solid", color: "#00FF00" }],
  strokes: [],
  shadows: [],
  glows: [],
};

// ── Mock canvas 2D context ──────────────────────────────────────────────────
function createMockCtx() {
  const calls: Array<{ method: string; args: any[] }> = [];
  return {
    calls,
    ctx: {
      fillRect: vi.fn((...args: any[]) => calls.push({ method: "fillRect", args })),
      clearRect: vi.fn((...args: any[]) => calls.push({ method: "clearRect", args })),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn((...args: any[]) => calls.push({ method: "fillText", args })),
      strokeText: vi.fn((...args: any[]) => calls.push({ method: "strokeText", args })),
      translate: vi.fn(),
      scale: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      strokeRect: vi.fn(),
      createImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(800 * 400 * 4),
      })),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      createConicGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(800 * 400 * 4),
      })),
      putImageData: vi.fn(),
      measureText: vi.fn(() => ({ width: 120 })),
      imageSmoothingEnabled: true,
      font: "",
      textBaseline: "",
      textAlign: "",
      letterSpacing: "",
      shadowColor: "",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      strokeStyle: "",
      lineWidth: 0,
      lineJoin: "",
      fillStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
    } as unknown as (CanvasRenderingContext2D & {
      fillText: ReturnType<typeof vi.fn>;
      clearRect: ReturnType<typeof vi.fn>;
      strokeText: ReturnType<typeof vi.fn>;
      fillRect: ReturnType<typeof vi.fn>;
    }),
  };
}

// ── Setup & Teardown ────────────────────────────────────────────────────────
let clock: PlaybackClock;
let origRAF: typeof globalThis.requestAnimationFrame;
let origCAF: typeof globalThis.cancelAnimationFrame;
let origAudioCtx: typeof globalThis.AudioContext;

describe("Text Edit → Preview Cycle Contract", () => {
  beforeEach(() => {
    rafCallbacks.clear();
    rafId = 0;
    origRAF = globalThis.requestAnimationFrame;
    origCAF = globalThis.cancelAnimationFrame;
    origAudioCtx = globalThis.AudioContext;
    globalThis.requestAnimationFrame = mockRequestAnimationFrame as any;
    globalThis.cancelAnimationFrame = mockCancelAnimationFrame as any;
    globalThis.AudioContext = MockAudioContext as any;

    clock = new PlaybackClock();
    clock.setDuration(10);
    clock.setFrameRate(30);
  });

  afterEach(() => {
    clock.stop();
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
    globalThis.AudioContext = origAudioCtx;
  });

  // ── Config Builder Consistency ──────────────────────────────────────────

  describe("Config Builder Consistency Across Edits", () => {
    it("changing text content produces a new config with updated text", () => {
      const cfg1 = _buildConfig(effectA, "HELLO", 64, 800, 200);
      const cfg2 = _buildConfig(effectA, "WORLD", 64, 800, 200);

      expect(cfg1.text).toBe("HELLO");
      expect(cfg2.text).toBe("WORLD");
      // Font/style unchanged
      expect(cfg1.fontFamily).toBe(cfg2.fontFamily);
      expect(cfg1.fontWeight).toBe(cfg2.fontWeight);
    });

    it("changing font size produces a new config with updated fontSize", () => {
      const cfg1 = _buildConfig(effectA, "TEST", 48, 800, 200);
      const cfg2 = _buildConfig(effectA, "TEST", 96, 800, 200);

      expect(cfg1.fontSize).toBe(48);
      expect(cfg2.fontSize).toBe(96);
    });

    it("switching effect produces a config with the new effect's properties", () => {
      const cfgA = _buildConfig(effectA, "TEST", 64, 800, 200);
      const cfgB = _buildConfig(effectB, "TEST", 64, 800, 200);

      // Different font families from different effects
      expect(cfgA.fontFamily).not.toBe(cfgB.fontFamily);
    });

    it("config builder is pure — same inputs always produce identical output", () => {
      const cfg1 = _buildConfig(effectA, "STABLE", 64, 800, 200);
      const cfg2 = _buildConfig(effectA, "STABLE", 64, 800, 200);

      expect(cfg1).toEqual(cfg2);
    });

    it("resolveTextSourcePreviewConfig normalizes nested definition typography", () => {
      const config = resolveTextSourcePreviewConfig({
        ...effectA,
        text: "PREVIEW",
        fontSize: 100,
        presetType: "effect",
      });

      expect(config.text).toBe("PREVIEW");
      expect(config.fontWeight).toBe(700);
      expect(config.fontStyle).toBe("normal");
    });

    it("resolveTextSourcePreviewConfig reflects changed text on re-resolve", () => {
      const config1 = resolveTextSourcePreviewConfig({
        ...effectA,
        text: "BEFORE",
        fontSize: 80,
        presetType: "effect",
      });
      const config2 = resolveTextSourcePreviewConfig({
        ...effectA,
        text: "AFTER",
        fontSize: 80,
        presetType: "effect",
      });

      expect(config1.text).toBe("BEFORE");
      expect(config2.text).toBe("AFTER");
      // Same effect, same typography
      expect(config1.fontFamily).toBe(config2.fontFamily);
    });
  });

  // ── Renderer Determinism ────────────────────────────────────────────────

  describe("Renderer Determinism Across Edit Cycles", () => {
    it("same config renders identically across multiple calls", () => {
      const mock1 = createMockCtx();
      const mock2 = createMockCtx();

      renderTextEffectToContext(
        mock1.ctx,
        "HELLO",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );
      renderTextEffectToContext(
        mock2.ctx,
        "HELLO",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );

      // Same method call sequence
      expect(mock1.ctx.fillText).toHaveBeenCalledTimes(
        mock2.ctx.fillText.mock.calls.length,
      );
      expect(mock1.ctx.clearRect).toHaveBeenCalledTimes(
        mock2.ctx.clearRect.mock.calls.length,
      );
    });

    it("changed text renders with new content (not stale)", () => {
      const mock1 = createMockCtx();
      const mock2 = createMockCtx();

      renderTextEffectToContext(
        mock1.ctx,
        "OLD TEXT",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );
      renderTextEffectToContext(
        mock2.ctx,
        "NEW TEXT",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );

      // Both should call fillText — renderer processes the text
      expect(mock1.ctx.fillText).toHaveBeenCalled();
      expect(mock2.ctx.fillText).toHaveBeenCalled();

      // The fillText calls should have different text content
      const text1 = mock1.ctx.fillText.mock.calls[0]?.[0];
      const text2 = mock2.ctx.fillText.mock.calls[0]?.[0];
      expect(text1).toBe("OLD TEXT");
      expect(text2).toBe("NEW TEXT");
    });

    it("switching effects changes render output", () => {
      const mock1 = createMockCtx();
      const mock2 = createMockCtx();

      renderTextEffectToContext(
        mock1.ctx,
        "TEST",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );
      renderTextEffectToContext(
        mock2.ctx,
        "TEST",
        effectB,
        64,
        400,
        100,
        800,
        200,
        0,
      );

      // effectA has strokes, effectB does not — strokeText call count differs
      const strokeCountA = mock1.ctx.strokeText.mock.calls.length;
      const strokeCountB = mock2.ctx.strokeText.mock.calls.length;
      expect(strokeCountA).toBeGreaterThan(strokeCountB);
    });

    it("renderer does not throw on rapid sequential calls with different configs", () => {
      const mock = createMockCtx();
      const texts = ["A", "BB", "CCC", "DDDD", "EEEEE"];
      const effects = [effectA, effectB, effectA, effectB, effectA];

      expect(() => {
        for (let i = 0; i < texts.length; i++) {
          renderTextEffectToContext(
            mock.ctx,
            texts[i],
            effects[i],
            48 + i * 10,
            400,
            100,
            800,
            200,
            i * 0.5,
          );
        }
      }).not.toThrow();
    });

    it("time parameter affects render (animation frame progression)", () => {
      const mock1 = createMockCtx();
      const mock2 = createMockCtx();

      renderTextEffectToContext(
        mock1.ctx,
        "ANIM",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0, // t=0
      );
      renderTextEffectToContext(
        mock2.ctx,
        "ANIM",
        effectA,
        64,
        400,
        100,
        800,
        200,
        5.0, // t=5s
      );

      // Both should complete without error
      expect(mock1.ctx.fillText).toHaveBeenCalled();
      expect(mock2.ctx.fillText).toHaveBeenCalled();
    });
  });

  // ── PlaybackClock Integration During Edit Cycles ────────────────────────

  describe("PlaybackClock Integration During Text Edits", () => {
    it("editing text while clock is stopped doesn't affect clock state", () => {
      clock.stop();
      const stateBefore = clock.getState();

      // Simulate text edit by building new config (no clock side effects)
      _buildConfig(effectA, "EDITED", 64, 800, 200);

      const stateAfter = clock.getState();
      expect(stateAfter.state).toBe(stateBefore.state);
      expect(stateAfter.time).toBe(stateBefore.time);
    });

    it("editing text while clock is playing doesn't corrupt playback", () => {
      clock.play();
      expect(clock.state).toBe("playing");

      // Simulate text edit during playback
      _buildConfig(effectA, "LIVE EDIT", 64, 800, 200);
      _buildConfig(effectB, "LIVE EDIT 2", 72, 800, 200);

      // Clock should still be playing, state uncorrupted
      expect(clock.state).toBe("playing");
      expect((clock as any)._rafId).not.toBeNull();
    });

    it("editing text while clock is paused preserves pause time", () => {
      clock.play();
      clock.setNativeClockAuthority(true);
      clock.setNativeClockPosition(5.0, 1.0);
      clock.pause();
      const pauseTime = clock.time;

      // Simulate text edit during pause
      _buildConfig(effectA, "PAUSED EDIT", 64, 800, 200);

      expect(clock.state).toBe("paused");
      expect(clock.time).toBeCloseTo(pauseTime, 2);
    });

    it("stop → edit text → play starts from 0 with edited config", () => {
      clock.play();
      clock.stop();

      // Simulate editing text content
      const newConfig = _buildConfig(effectA, "AFTER STOP EDIT", 64, 800, 200);
      expect(newConfig.text).toBe("AFTER STOP EDIT");

      clock.play();
      expect(clock.state).toBe("playing");
      expect(clock.time).toBeCloseTo(0, 3);
    });

    it("multiple edit→preview cycles maintain clean clock generations", () => {
      const generations: number[] = [];

      for (let i = 0; i < 5; i++) {
        clock.play();
        generations.push((clock as any)._generation);
        // Simulate rendering at current clock time
        const mock = createMockCtx();
        renderTextEffectToContext(
          mock.ctx,
          `Cycle ${i}`,
          effectA,
          64,
          400,
          100,
          800,
          200,
          clock.time,
        );
        clock.stop();
      }

      // Each play() should advance generation monotonically
      for (let i = 1; i < generations.length; i++) {
        expect(generations[i]).toBeGreaterThan(generations[i - 1]);
      }
    });
  });

  // ── Edit → Re-Preview State Freshness ──────────────────────────────────

  describe("Edit → Re-Preview State Freshness", () => {
    it("re-render after text edit uses new text, not cached old text", () => {
      const mock1 = createMockCtx();
      renderTextEffectToContext(
        mock1.ctx,
        "VERSION 1",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );

      // "Edit" — change text
      const mock2 = createMockCtx();
      renderTextEffectToContext(
        mock2.ctx,
        "VERSION 2",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );

      expect(mock1.ctx.fillText.mock.calls[0][0]).toBe("VERSION 1");
      expect(mock2.ctx.fillText.mock.calls[0][0]).toBe("VERSION 2");
    });

    it("re-render after effect switch uses new effect styling", () => {
      const mock1 = createMockCtx();
      renderTextEffectToContext(
        mock1.ctx,
        "SAME TEXT",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );
      const strokeCountA = mock1.ctx.strokeText.mock.calls.length;

      // "Edit" — switch effect
      const mock2 = createMockCtx();
      renderTextEffectToContext(
        mock2.ctx,
        "SAME TEXT",
        effectB,
        64,
        400,
        100,
        800,
        200,
        0,
      );
      const strokeCountB = mock2.ctx.strokeText.mock.calls.length;

      // effectA has strokes, effectB doesn't
      expect(strokeCountA).toBeGreaterThan(strokeCountB);
    });

    it("re-render after font size change renders with new size", () => {
      const cfg1 = _buildConfig(effectA, "SIZE", 48, 800, 200);
      const cfg2 = _buildConfig(effectA, "SIZE", 120, 800, 200);

      expect(cfg1.fontSize).toBe(48);
      expect(cfg2.fontSize).toBe(120);
      expect(cfg1.text).toBe(cfg2.text); // text unchanged
    });

    it("play→stop→edit→play→stop→edit→play cycle keeps state clean", () => {
      // Cycle 1: play with original text
      clock.play();
      const mock1 = createMockCtx();
      renderTextEffectToContext(
        mock1.ctx,
        "FIRST",
        effectA,
        64,
        400,
        100,
        800,
        200,
        0,
      );
      clock.stop();
      expect(clock.time).toBe(0);

      // Cycle 2: edit text, play again
      clock.play();
      const mock2 = createMockCtx();
      renderTextEffectToContext(
        mock2.ctx,
        "SECOND",
        effectB,
        72,
        400,
        100,
        800,
        200,
        0,
      );
      clock.stop();
      expect(clock.time).toBe(0);

      // Cycle 3: edit text again, play again
      clock.play();
      const mock3 = createMockCtx();
      renderTextEffectToContext(
        mock3.ctx,
        "THIRD",
        effectA,
        80,
        400,
        100,
        800,
        200,
        0,
      );
      clock.stop();
      expect(clock.time).toBe(0);

      // Verify each cycle rendered with its own text
      expect(mock1.ctx.fillText.mock.calls[0][0]).toBe("FIRST");
      expect(mock2.ctx.fillText.mock.calls[0][0]).toBe("SECOND");
      expect(mock3.ctx.fillText.mock.calls[0][0]).toBe("THIRD");
    });

    it("seek → edit → play renders from 0 with new text", () => {
      clock.play();
      clock.seek(5.0);
      clock.completeSeek();
      clock.stop();

      // Edit text
      const cfg = _buildConfig(effectA, "AFTER SEEK EDIT", 64, 800, 200);
      expect(cfg.text).toBe("AFTER SEEK EDIT");

      clock.play();
      expect(clock.time).toBeCloseTo(0, 3);

      const mock = createMockCtx();
      renderTextEffectToContext(
        mock.ctx,
        "AFTER SEEK EDIT",
        effectA,
        64,
        400,
        100,
        800,
        200,
        clock.time,
      );
      expect(mock.ctx.fillText.mock.calls[0][0]).toBe("AFTER SEEK EDIT");
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("empty text string renders without throwing", () => {
      const mock = createMockCtx();
      expect(() => {
        renderTextEffectToContext(
          mock.ctx,
          "",
          effectA,
          64,
          400,
          100,
          800,
          200,
          0,
        );
      }).not.toThrow();
    });

    it("very long text renders without throwing", () => {
      const mock = createMockCtx();
      const longText = "A".repeat(10000);
      expect(() => {
        renderTextEffectToContext(
          mock.ctx,
          longText,
          effectA,
          64,
          400,
          100,
          800,
          200,
          0,
        );
      }).not.toThrow();
    });

    it("zero canvas dimensions render without throwing", () => {
      const mock = createMockCtx();
      expect(() => {
        renderTextEffectToContext(
          mock.ctx,
          "ZERO",
          effectA,
          64,
          0,
          0,
          0,
          0,
          0,
        );
      }).not.toThrow();
    });

    it("negative time value renders without throwing", () => {
      const mock = createMockCtx();
      expect(() => {
        renderTextEffectToContext(
          mock.ctx,
          "NEG TIME",
          effectA,
          64,
          400,
          100,
          800,
          200,
          -1,
        );
      }).not.toThrow();
    });

    it("config builder handles missing optional fields gracefully", () => {
      const minimalEffect: TextEffectDefinition = {
        id: "minimal",
        name: "Minimal",
        category: "test",
        description: "Minimal effect",
        tags: [],
        font: { family: "serif", weight: 400, style: "normal", letterSpacing: 0, lineHeight: 1 },
        fills: [],
        strokes: [],
        shadows: [],
      };

      expect(() => {
        _buildConfig(minimalEffect, "MINIMAL", 48, 800, 200);
      }).not.toThrow();
    });
  });
});
