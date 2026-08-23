import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Safe wrapper to check if running inside Tauri desktop environment
export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  version?: string;
  date?: string;
  body?: string;
  error?: string;
  // Hold the update object returned by check()
  updateObject?: any;
}

export interface DownloadProgress {
  event: "Started" | "Progress" | "Finished";
  chunkLength?: number;
  contentLength?: number;
  downloaded: number;
}

/**
 * Check for updates
 */
export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  if (!isTauriDesktop()) {
    return { hasUpdate: false, error: "Not running in Tauri desktop environment" };
  }

  try {
    const update = await check();
    if (update) {
      return {
        hasUpdate: true,
        version: update.version,
        date: update.date,
        body: update.body,
        updateObject: update,
      };
    }
    return { hasUpdate: false };
  } catch (error: any) {
    console.error("Failed to check for updates:", error);

    // Provide clean, informative error messages
    let errorMessage = error?.message || String(error);

    if (errorMessage.includes("Could not fetch a valid release JSON")) {
      errorMessage = "No compatible update found for your platform or release metadata is unavailable.";
    } else if (errorMessage.includes("network") || errorMessage.includes("fetch") || errorMessage.includes("connect")) {
      errorMessage = "Unable to connect to update server. Please check your internet connection.";
    } else if (errorMessage.includes("Signature") || errorMessage.includes("signature")) {
      errorMessage = "Update signature verification failed.";
    }

    return {
      hasUpdate: false,
      error: errorMessage,
    };
  }
}

/**
 * Download and install the update, then relaunch the application
 * @param updateObject The update object returned from checkAppUpdate
 * @param onProgress Callback to monitor download progress
 */
export async function installAndRelaunchUpdate(updateObject: any, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  if (!updateObject) {
    throw new Error("No update object provided");
  }

  try {
    let downloaded = 0;

    // Download and install
    await updateObject.downloadAndInstall((event: any) => {
      if (!onProgress) return;

      if (event.event === "Started") {
        downloaded = 0;
        onProgress({
          event: "Started",
          downloaded: 0,
        });
      } else if (event.event === "Progress") {
        const chunk = event.data?.chunkLength ?? 0;
        downloaded += chunk;
        onProgress({
          event: "Progress",
          chunkLength: chunk,
          contentLength: event.data?.contentLength,
          downloaded,
        });
      } else if (event.event === "Finished") {
        onProgress({
          event: "Finished",
          downloaded,
        });
      }
    });

    // Restart the application to apply the update
    await relaunch();
  } catch (error) {
    console.error("Failed to download or install update:", error);
    throw error;
  }
}
