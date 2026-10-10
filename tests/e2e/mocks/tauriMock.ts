import type { Page } from "@playwright/test";

export interface MockProject {
  id: string;
  name: string;
  updatedAt?: number;
  duration?: number;
}

export interface TauriMockOptions {
  recentProjects?: MockProject[];
  defaultMediaDuration?: number;
}

/**
 * Injects a controlled mock boundary for Tauri v2 IPC into the browser page context.
 *
 * IMPORTANT INVARIANT:
 * This mock simulates frontend API contracts for browser-based UI automation.
 * It does NOT prove that native Rust decoders, filesystem locking, or OS graphics drivers work.
 * Native engine behavior is verified independently in integration tests and desktop smoke checks.
 */
export async function installTauriMock(page: Page, options: TauriMockOptions = {}) {
  const initialProjects = options.recentProjects ?? [];
  const mediaDuration = options.defaultMediaDuration ?? 10.0;

  await page.addInitScript(
    ({ initialProjects, mediaDuration }) => {
      // 1. Establish window.__TAURI_INTERNALS__ to satisfy isTauriRuntime()
      const listeners = new Map<string, Array<(event: any) => void>>();
      const callbacks = new Map<number, (data: any) => void>();

      const mockProjects = [...initialProjects];

      const invokeHandler = async (cmd: string, args: any = {}) => {
        // Event plugin commands
        if (cmd === "plugin:event|listen") {
          const eventName = args.event;
          const handlerId = Math.floor(Math.random() * 1000000);
          if (!listeners.has(eventName)) {
            listeners.set(eventName, []);
          }
          listeners.get(eventName)!.push(args.handler);
          return handlerId;
        }

        if (cmd === "plugin:event|unlisten") {
          return null;
        }

        if (cmd === "plugin:event|emit") {
          const list = listeners.get(args.event) || [];
          for (const handler of list) {
            const cb = callbacks.get(handler as any);
            if (cb) cb(args);
          }
          return null;
        }

        // Project lifecycle
        if (cmd === "get_recent_projects") {
          return mockProjects.map((p) => ({
            kind: "ready",
            id: p.id,
            name: p.name,
            path: `/mock/projects/${p.id}.clypra`,
            backupPath: `/mock/projects/${p.id}.clypra.bak`,
            backupAvailable: false,
            modifiedAt: p.updatedAt || Date.now(),
            duration: p.duration || 10,
            fps: 30,
            width: 1920,
            height: 1080,
            tracks: [],
          }));
        }

        if (cmd === "load_project") {
          const proj = mockProjects.find((p) => p.id === args.projectId || args.path?.includes(p.id));
          return JSON.stringify({
            id: proj ? proj.id : "mock-project-1",
            name: proj ? proj.name : "Mock Project",
            version: 1,
            fps: 30,
            width: 1920,
            height: 1080,
            duration: 10.0,
            tracks: [
              { id: "track-v1", type: "video", name: "Video 1", clips: [], muted: false, locked: false },
              { id: "track-a1", type: "audio", name: "Audio 1", clips: [], muted: false, locked: false },
            ],
          });
        }

        if (cmd === "save_project") {
          return {
            projectId: args.projectId || "mock-project-saved",
            bytesWritten: 1024,
            modifiedAt: Date.now(),
            verified: true,
            verification: {
              primaryReadback: true,
              backupRotated: true,
            },
          };
        }

        if (cmd === "delete_project" || cmd === "rename_project") {
          return null;
        }

        // Media & metadata probing
        if (cmd === "get_media_metadata" || cmd === "get_video_metadata") {
          return {
            duration: mediaDuration,
            width: 1920,
            height: 1080,
            fps: 30,
            size: 1024 * 1024 * 5,
          };
        }

        if (cmd === "extract_poster_frame_command" || cmd === "extract_poster_frame") {
          return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        }

        // Dialog plugin
        if (cmd === "plugin:dialog|open") {
          return null;
        }

        // Filesystem plugin
        if (cmd === "plugin:fs|exists") {
          return true;
        }
        if (cmd === "plugin:fs|read_text_file") {
          return "{}";
        }
        if (cmd === "plugin:fs|write_text_file") {
          return null;
        }

        // Telemetry, milestones, and preview commands (silent pass)
        if (
          cmd.startsWith("mark_") ||
          cmd.startsWith("record_") ||
          cmd.startsWith("configure_") ||
          cmd.startsWith("update_") ||
          cmd.startsWith("hide_") ||
          cmd.startsWith("reset_") ||
          cmd.startsWith("stop_") ||
          cmd.startsWith("pause_") ||
          cmd.startsWith("resume_") ||
          cmd.startsWith("set_") ||
          cmd.startsWith("seek_") ||
          cmd.startsWith("clear_") ||
          cmd.startsWith("release_") ||
          cmd.startsWith("cancel_")
        ) {
          return null;
        }

        // Default fallback
        return null;
      };

      (window as any).__TAURI_INTERNALS__ = {
        invoke: invokeHandler,
        transformCallback: (callback: (data: any) => void, once = false) => {
          const id = Math.floor(Math.random() * 10000000);
          callbacks.set(id, (data: any) => {
            if (once) callbacks.delete(id);
            callback(data);
          });
          return id;
        },
        unregisterCallback: (id: number) => {
          callbacks.delete(id);
        },
        runCallback: (id: number, data: any) => {
          const cb = callbacks.get(id);
          if (cb) cb(data);
        },
        callbacks,
        plugins: {},
      };

      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (event: string, id: number) => {
          callbacks.delete(id);
        },
      };
    },
    { initialProjects, mediaDuration }
  );
}
