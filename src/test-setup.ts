/**
 * Test setup file for Vitest
 * Configures testing environment and global utilities
 */

import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
};

const ensureStorage = (key: "localStorage" | "sessionStorage") => {
  if (typeof window.Storage !== "undefined") {
    Object.defineProperty(globalThis, "Storage", {
      configurable: true,
      value: window.Storage,
    });
  }

  try {
    window[key].setItem("__storage_test__", "1");
    window[key].removeItem("__storage_test__");
  } catch {
    Object.defineProperty(window, key, {
      configurable: true,
      value: createMemoryStorage(),
    });
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: window[key],
  });
};

ensureStorage("localStorage");
ensureStorage("sessionStorage");

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
