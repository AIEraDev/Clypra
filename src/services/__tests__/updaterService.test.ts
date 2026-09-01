import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isTauriDesktop, checkAppUpdate, downloadUpdate, installDownloadedUpdate } from "../updaterService";
import { relaunch } from "@tauri-apps/plugin-process";

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
    it("should report updates as permanently disabled", async () => {
      // Auto-updates are disabled in this build; the check must short-circuit
      // to a clear "disabled" error in every environment.
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = { __TAURI_INTERNALS__: {} };

      const result = await checkAppUpdate();
      expect(result.hasUpdate).toBe(false);
      expect(result.error).toContain("disabled");

      (globalThis as any).window = originalWindow;
    });

    it("should never return an available update", async () => {
      const result = await checkAppUpdate();
      expect(result.hasUpdate).toBe(false);
      expect(result.updateObject).toBeUndefined();
    });
  });

  describe("downloadUpdate", () => {
    it("downloads without installing or relaunching", async () => {
      const mockUpdateObject = {
        download: vi.fn((callback) => {
          callback({ event: "Started", data: { contentLength: 100 } });
          callback({ event: "Progress", data: { chunkLength: 50, contentLength: 100 } });
          callback({ event: "Finished" });
          return Promise.resolve();
        }),
      };

      const progressCallback = vi.fn();
      await downloadUpdate(mockUpdateObject as any, progressCallback);

      expect(mockUpdateObject.download).toHaveBeenCalled();
      expect(progressCallback).toHaveBeenCalledWith({ event: "Started", contentLength: 100, downloaded: 0 });
      expect(progressCallback).toHaveBeenCalledWith({
        event: "Progress",
        chunkLength: 50,
        contentLength: 100,
        downloaded: 50,
      });
      expect(progressCallback).toHaveBeenCalledWith({ event: "Finished", downloaded: 50 });
      expect(relaunch).not.toHaveBeenCalled();
    });
  });

  describe("installDownloadedUpdate", () => {
    it("installs only an already downloaded update and does not relaunch", async () => {
      const install = vi.fn().mockResolvedValue(undefined);
      await installDownloadedUpdate({ install } as any);

      expect(install).toHaveBeenCalledOnce();
      expect(relaunch).not.toHaveBeenCalled();
    });
  });
});
