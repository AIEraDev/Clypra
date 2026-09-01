import { relaunch } from "@tauri-apps/plugin-process";

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

/**
 * Local shape for the update object. The upstream `Update` class from
 * `@tauri-apps/plugin-updater` is intentionally NOT imported anymore:
 * auto-updates are permanently disabled in this build (2026-09-01) and the
 * npm dependency has been removed.
 */
export interface UpdateLike {
  version: string;
  date?: string;
  body?: string;
  download(onEvent: (event: unknown) => void): Promise<void>;
  install(): Promise<void>;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  version?: string;
  date?: string;
  body?: string;
  error?: string;
  updateObject?: UpdateLike;
}

export interface DownloadProgress {
  event: "Started" | "Progress" | "Finished";
  chunkLength?: number;
  contentLength?: number;
  downloaded: number;
}

export type AutoUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "applying"
  | "error"
  | "dismissed";

export interface AutoUpdaterState {
  status: AutoUpdateStatus;
  updateInfo: { version: string; body?: string; date?: string } | null;
  updateObject: UpdateLike | null;
  downloadProgress: number;
  error: string | null;
  deferred: boolean;
}

export interface AutoUpdaterListener {
  (): void;
}

export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  // Auto-updates are permanently DISABLED in this build (2026-09-01):
  // the Rust side no longer registers tauri-plugin-updater, so calling the
  // plugin would fail anyway. Short-circuit so the manual "Check for Updates"
  // button in Settings reports the real state instead of a misleading
  // network/plugin error.
  return {
    hasUpdate: false,
    error: "Updates are disabled in this build.",
  };
}

export async function downloadUpdate(updateObject: UpdateLike, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  if (!updateObject) throw new Error("No update object provided");

  let downloaded = 0;
  let contentLength: number | undefined;
  await updateObject.download((event: any) => {
    if (!onProgress) return;
    if (event.event === "Started") {
      downloaded = 0;
      contentLength = event.data?.contentLength;
      onProgress({ event: "Started", contentLength, downloaded: 0 });
    } else if (event.event === "Progress") {
      const chunk = event.data?.chunkLength ?? 0;
      downloaded += chunk;
      onProgress({ event: "Progress", chunkLength: chunk, contentLength, downloaded });
    } else if (event.event === "Finished") {
      onProgress({ event: "Finished", downloaded });
    }
  });
}

export async function installDownloadedUpdate(updateObject: UpdateLike): Promise<void> {
  if (!updateObject) throw new Error("No update object provided");
  await updateObject.install();
}

const DISMISSED_VERSION_KEY = "clypra:dismissed_update_version";

function getDismissedVersion(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_VERSION_KEY);
  } catch {
    return null;
  }
}

function setDismissedVersion(version: string): void {
  try {
    sessionStorage.setItem(DISMISSED_VERSION_KEY, version);
  } catch {
    // Storage is optional in tests and restricted webviews.
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : (error as any)?.message || fallback;
}

class AutoUpdateManager {
  private state: AutoUpdaterState = {
    status: "idle",
    updateInfo: null,
    updateObject: null,
    downloadProgress: 0,
    error: null,
    deferred: false,
  };

  private listeners = new Set<AutoUpdaterListener>();
  private checkInProgress: Promise<void> | null = null;
  private operationInProgress: Promise<void> | null = null;

  subscribe(listener: AutoUpdaterListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): AutoUpdaterState {
    return this.state;
  }

  private setState(partial: Partial<AutoUpdaterState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener());
  }

  async check(options: { force?: boolean; silent?: boolean } = {}): Promise<void> {
    if (!isTauriDesktop()) return;
    if (this.checkInProgress) return this.checkInProgress;
    if (this.operationInProgress || this.state.status === "downloaded" || this.state.status === "applying") return;
    if (!options.force && (this.state.status === "available" || this.state.status === "dismissed")) return;

    this.setState({ status: "checking", error: null });
    this.checkInProgress = (async () => {
      const result = await checkAppUpdate();
      if (result.error) {
        this.setState({ status: options.silent ? "idle" : "error", error: result.error });
        return;
      }

      if (!result.hasUpdate || !result.version || !result.updateObject) {
        this.setState({ status: "up-to-date", updateInfo: null, updateObject: null, error: null, deferred: false });
        return;
      }

      const updateInfo = { version: result.version, body: result.body, date: result.date };
      if (!options.force && getDismissedVersion() === result.version) {
        this.setState({ status: "dismissed", updateInfo, updateObject: result.updateObject, error: null, deferred: true });
        return;
      }

      this.setState({ status: "available", updateInfo, updateObject: result.updateObject, error: null, deferred: false, downloadProgress: 0 });
    })()
      .catch((error) => {
        this.setState({ status: options.silent ? "idle" : "error", error: errorMessage(error, "Update check failed") });
      })
      .finally(() => {
        this.checkInProgress = null;
      });

    return this.checkInProgress;
  }

  async download(): Promise<void> {
    const updateObject = this.state.updateObject;
    if (!updateObject || !["available", "dismissed", "error"].includes(this.state.status)) return;
    if (this.operationInProgress) return this.operationInProgress;

    this.setState({ status: "downloading", error: null, deferred: false, downloadProgress: 0 });
    this.operationInProgress = downloadUpdate(updateObject, (progress) => {
      if (progress.event === "Started") {
        this.setState({ downloadProgress: 0 });
      } else if (progress.event === "Progress") {
        const contentLength = progress.contentLength;
        if (contentLength) {
          this.setState({ downloadProgress: Math.min(Math.round((progress.downloaded / contentLength) * 100), 99) });
        }
      } else if (progress.event === "Finished") {
        this.setState({ downloadProgress: 100 });
      }
    })
      .then(() => {
        this.setState({ status: "downloaded", downloadProgress: 100, error: null });
      })
      .catch((error) => {
        this.setState({ status: "error", error: errorMessage(error, "Failed to download update") });
      })
      .finally(() => {
        this.operationInProgress = null;
      });

    return this.operationInProgress;
  }

  async apply(): Promise<void> {
    const updateObject = this.state.updateObject;
    if (!updateObject || this.state.status !== "downloaded") return;
    if (this.operationInProgress) return this.operationInProgress;

    this.setState({ status: "applying", error: null, deferred: false });
    this.operationInProgress = (async () => {
      const [{ useProjectStore }, { disposeActiveSession, getActiveSessionOrNull }] = await Promise.all([
        import("@/store/projectStore"),
        import("@/core/runtime/ProjectSession"),
      ]);

      getActiveSessionOrNull()?.transportAuthority?.pause();

      if (useProjectStore.getState().project) {
        const result = await useProjectStore.getState().saveCurrentProject();
        if (!result?.verified) throw new Error("Project save verification did not succeed");
      }

      await disposeActiveSession();
      await installDownloadedUpdate(updateObject);
      await relaunch();
    })()
      .catch((error) => {
        this.setState({ status: "downloaded", error: errorMessage(error, "Failed to apply update"), deferred: false });
      })
      .finally(() => {
        this.operationInProgress = null;
      });

    return this.operationInProgress;
  }

  dismiss(): void {
    const version = this.state.updateInfo?.version;
    if (version) setDismissedVersion(version);
    this.setState({ status: "dismissed", deferred: true });
  }

  defer(): void {
    this.setState({ deferred: true });
  }
}

export const autoUpdateManager = new AutoUpdateManager();
