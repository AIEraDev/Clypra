import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isTauriDesktop, checkAppUpdate, installAndRelaunchUpdate } from "../updaterService";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Mock Tauri updater plugin
vi.mock("@tauri-apps/plugin-updater", () => {
  const mockUpdate = {
    version: "1.2.0",
    date: "2026-06-25",
    body: "Bug fixes and performance improvements",
    downloadAndInstall: vi.fn((callback) => {
      callback({ event: "Started" });
      callback({ event: "Progress", data: { chunkLength: 100, contentLength: 200 } });
      callback({ event: "Finished" });
      return Promise.resolve();
    }),
  };

  return {
    check: vi.fn().mockResolvedValue(mockUpdate),
  };
});

// Mock Tauri process plugin
vi.mock("@tauri-apps/plugin-process", () => {
  return {
    relaunch: vi.fn().mockResolvedValue(undefined),
  };
});

describe("Updater Service", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  describe("isTauriDesktop", () => {
    it("should return false if window.__TAURI_INTERNALS__ is undefined", () => {
      const originalTAURI = (globalThis as any).window?.__TAURI_INTERNALS__;
      if ((globalThis as any).window) {
        delete (globalThis as any).window.__TAURI_INTERNALS__;
      }
      expect(isTauriDesktop()).toBe(false);

      if ((globalThis as any).window && originalTAURI) {
        (globalThis as any).window.__TAURI_INTERNALS__ = originalTAURI;
      }
    });

    it("should return true if window.__TAURI_INTERNALS__ is defined", () => {
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        __TAURI_INTERNALS__: {},
      };
      expect(isTauriDesktop()).toBe(true);
      (globalThis as any).window = originalWindow;
    });
  });

  describe("checkAppUpdate", () => {
    it("should return early if not running in Tauri desktop environment", async () => {
      // Mock window to simulate mobile/web
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      const result = await checkAppUpdate();
      expect(result.hasUpdate).toBe(false);
      expect(result.error).toContain("Not running in Tauri desktop");

      (globalThis as any).window = originalWindow;
    });

    it("should verify and parse update availability correctly", async () => {
      // Mock window to simulate Tauri desktop
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = { __TAURI_INTERNALS__: {} };

      const result = await checkAppUpdate();
      expect(result.hasUpdate).toBe(true);
      expect(result.version).toBe("1.2.0");
      expect(result.date).toBe("2026-06-25");
      expect(check).toHaveBeenCalled();

      (globalThis as any).window = originalWindow;
    });
  });

  describe("installAndRelaunchUpdate", () => {
    it("should invoke download and trigger progress callbacks prior to relaunching", async () => {
      const mockUpdateObject = {
        downloadAndInstall: vi.fn((callback) => {
          callback({ event: "Started" });
          callback({ event: "Progress", data: { chunkLength: 50, contentLength: 100 } });
          callback({ event: "Finished" });
          return Promise.resolve();
        }),
      };

      const progressCallback = vi.fn();
      await installAndRelaunchUpdate(mockUpdateObject, progressCallback);

      expect(mockUpdateObject.downloadAndInstall).toHaveBeenCalled();
      expect(progressCallback).toHaveBeenCalledWith({ event: "Started", downloaded: 0 });
      expect(progressCallback).toHaveBeenCalledWith({
        event: "Progress",
        chunkLength: 50,
        contentLength: 100,
        downloaded: 50,
      });
      expect(progressCallback).toHaveBeenCalledWith({ event: "Finished", downloaded: 50 });
      expect(relaunch).toHaveBeenCalled();
    });
  });
});
