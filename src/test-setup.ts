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
