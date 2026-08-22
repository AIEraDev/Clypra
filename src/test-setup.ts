/**
 * Test setup file for Vitest
 * Configures testing environment and global utilities
 */

import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// lottie-web schedules a browser-only readiness timer at module load. The
// editor's native tests do not exercise its DOM renderer, so keep the test
// process deterministic and provide the small runtime surface used by the
// preview bridges.
vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: vi.fn(() => ({
      destroy: vi.fn(),
      goToAndStop: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      setSpeed: vi.fn(),
      frameRate: 30,
      totalFrames: 1,
    })),
  },
}));

// Mock pixi.js for legacy engine dependencies (Pixi is no longer used in Clypra)
vi.mock("pixi.js", () => {
  class MockContainer {
    addChild = vi.fn();
    removeChild = vi.fn();
    destroy = vi.fn();
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
  }
  class MockGraphics extends MockContainer {
    clear = vi.fn().mockReturnThis();
    rect = vi.fn().mockReturnThis();
    fill = vi.fn().mockReturnThis();
    stroke = vi.fn().mockReturnThis();
    drawRect = vi.fn().mockReturnThis();
    beginFill = vi.fn().mockReturnThis();
    endFill = vi.fn().mockReturnThis();
    lineStyle = vi.fn().mockReturnThis();
  }
  return {
    Filter: class {},
    Container: MockContainer,
    Graphics: MockGraphics,
    Sprite: MockContainer,
    Texture: { from: vi.fn() },
    Application: class {
      stage = new MockContainer();
      renderer = { resize: vi.fn() };
      destroy = vi.fn();
    },
  };
});

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock AudioContext for tests
class MockAudioContext {
  currentTime = 0;
  destination = {};
  state = "running";

  createGain() {
    return {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createDynamicsCompressor() {
    const audioParam = () => ({
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    });
    return {
      threshold: audioParam(),
      knee: audioParam(),
      ratio: audioParam(),
      attack: audioParam(),
      release: audioParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createBiquadFilter() {
    const audioParam = () => ({
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    });
    return {
      type: "lowpass",
      frequency: audioParam(),
      Q: audioParam(),
      gain: audioParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createStereoPanner() {
    const audioParam = () => ({
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    });
    return {
      pan: audioParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
  }

  decodeAudioData() {
    return Promise.resolve({
      duration: 1,
      length: 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
    });
  }

  close() {
    return Promise.resolve();
  }

  resume() {
    return Promise.resolve();
  }

  suspend() {
    return Promise.resolve();
  }
}

// @ts-expect-error - Mocking global AudioContext
global.AudioContext = MockAudioContext;

// Mock HTMLCanvasElement.prototype.getContext for jsdom
const setupCanvasMock = () => {
  const CanvasProto = typeof window !== "undefined" && window.HTMLCanvasElement ? window.HTMLCanvasElement.prototype : typeof HTMLCanvasElement !== "undefined" ? HTMLCanvasElement.prototype : null;
  if (!CanvasProto) return;

  const mockGetContext = function (this: HTMLCanvasElement, contextType: string, ...args: any[]) {
    if (contextType === "2d") {
      const self = this;
      const ctx: any = {
        canvas: self,
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        rect: vi.fn(),
        arc: vi.fn(),
        clip: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        clearRect: vi.fn(),
        roundRect: vi.fn(),
        drawImage: vi.fn(),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        font: "10px sans-serif",
        measureText: vi.fn(function (this: any, text: string) {
          const fontStr = typeof this?.font === "string" ? this.font : typeof ctx?.font === "string" ? ctx.font : "10px sans-serif";
          const fontMatch = fontStr.match(/(\d+(?:\.\d+)?)px/);
          const fontSize = fontMatch ? parseFloat(fontMatch[1]) : 10;
          const width = (text ? String(text).length : 0) * fontSize * 0.6;
          return {
            width,
            actualBoundingBoxAscent: fontSize * 0.8,
            actualBoundingBoxDescent: fontSize * 0.2,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
          };
        }),
        createLinearGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        createRadialGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        createImageData: (width: number, height: number) => ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4),
        }),
        getImageData: (sx: number, sy: number, sw: number, sh: number) => ({
          width: sw,
          height: sh,
          data: new Uint8ClampedArray(sw * sh * 4),
        }),
        putImageData: vi.fn(),
        setTransform: vi.fn(),
        resetTransform: vi.fn(),
        fillStyle: "#000000",
        strokeStyle: "#000000",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 10,
        globalAlpha: 1.0,
        globalCompositeOperation: "source-over",
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "low",
        filter: "none",
        textAlign: "start",
        textBaseline: "alphabetic",
      };
      return ctx as unknown as CanvasRenderingContext2D;
    }
    return null;
  };

  Object.defineProperty(CanvasProto, "getContext", {
    value: mockGetContext,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(CanvasProto, "toDataURL", {
    value: function () {
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    },
    configurable: true,
    writable: true,
  });
};

setupCanvasMock();

