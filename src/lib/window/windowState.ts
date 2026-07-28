/**
 * Window State & Geometry Management
 *
 * Preserves pre-recording window metrics (position, dimensions, maximized status)
 * before shrinking to floating widget mode, and restores exact window geometry,
 * focus, and un-minimized state when recording finishes.
 */

export interface WindowGeometrySnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isFullscreen: boolean;
}

const GEOMETRY_SNAPSHOT_KEY = "__clypra_pre_recording_geometry__";

function checkIsTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Save current window position, dimensions, maximized and fullscreen status before entering float mode.
 */
export async function savePreRecordingWindowGeometry(): Promise<WindowGeometrySnapshot | null> {
  if (!checkIsTauri()) return null;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();

    const isFullscreen = await win.isFullscreen().catch(() => false);
    const isMaximized = await win.isMaximized().catch(() => false);
    const position = await win.outerPosition().catch(() => ({ x: 100, y: 100 }));
    const size = await win.outerSize().catch(() => ({ width: 1280, height: 800 }));

    const snapshot: WindowGeometrySnapshot = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      isMaximized,
      isFullscreen,
    };

    if (typeof window !== "undefined") {
      (window as any)[GEOMETRY_SNAPSHOT_KEY] = snapshot;
    }

    // Exit macOS native fullscreen before shrinking to float mode
    if (isFullscreen) {
      await win.setFullscreen(false).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }

    return snapshot;
  } catch (err) {
    console.error("[WindowState] Failed to save window geometry:", err);
    return null;
  }
}

/**
 * Restore window to its exact pre-recording geometry, focus, and un-minimized state.
 */
export async function restorePreRecordingWindowGeometry(): Promise<void> {
  if (!checkIsTauri()) return;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();

    let snapshot: WindowGeometrySnapshot | null = null;
    if (typeof window !== "undefined" && (window as any)[GEOMETRY_SNAPSHOT_KEY]) {
      snapshot = (window as any)[GEOMETRY_SNAPSHOT_KEY];
    }

    // 1. Remove always-on-top & reset minimum bounds
    await win.setAlwaysOnTop(false);
    await win.setMinSize(new LogicalSize(1100, 720));

    // 2. Restore position & size if snapshot exists
    if (snapshot) {
      try {
        if (snapshot.isFullscreen) {
          await win.setFullscreen(true);
        } else if (snapshot.isMaximized) {
          await win.maximize();
        } else {
          await win.setPosition(new LogicalPosition(snapshot.x, snapshot.y));
          await win.setSize(new LogicalSize(snapshot.width, snapshot.height));
        }
      } catch (restoreErr) {
        console.warn("[WindowState] Failed to apply precise position/size snapshot, falling back to default:", restoreErr);
        await win.setSize(new LogicalSize(1100, 720));
      }
    } else {
      await win.setSize(new LogicalSize(1100, 720));
    }

    // 3. Professional focus and un-minimize calls
    try {
      await win.unminimize();
      await win.setFocus();
    } catch {
      // Best effort focus restoration
    }
  } catch (err) {
    console.error("[WindowState] Failed to restore window geometry:", err);
  } finally {
    if (typeof window !== "undefined") {
      delete (window as any)[GEOMETRY_SNAPSHOT_KEY];
    }
  }
}
