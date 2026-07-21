import { useState, useEffect, useCallback, useRef } from "react";
import {
  checkAppUpdate,
  installAndRelaunchUpdate,
  isTauriDesktop,
  type UpdateCheckResult,
  type DownloadProgress,
} from "@/services/updaterService";
import { t } from "@/i18n";

export type AutoUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "error"
  | "dismissed";

export interface AutoUpdaterState {
  status: AutoUpdateStatus;
  updateInfo: { version: string; body?: string; date?: string } | null;
  updateObject: any;
  downloadProgress: number;
  error: string | null;
}

export interface UseAutoUpdaterReturn extends AutoUpdaterState {
  dismiss: () => void;
  installUpdate: () => Promise<void>;
  recheckUpdate: () => Promise<void>;
}

const DISMISSED_VERSION_KEY = "clypra:dismissed_update_version";

/** Returns the version string that the user last dismissed, if any. */
function getDismissedVersion(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_VERSION_KEY);
  } catch {
    return null;
  }
}

function setDismissedVersion(version: string) {
  try {
    sessionStorage.setItem(DISMISSED_VERSION_KEY, version);
  } catch {
    /* ignore */
  }
}

/**
 * Automatically checks for updates shortly after app startup.
 * Surfaces a non-blocking notification when a new release is detected on GitHub.
 * The user can install immediately or dismiss (dismissal is remembered per-session).
 */
export function useAutoUpdater(): UseAutoUpdaterReturn {
  const [state, setState] = useState<AutoUpdaterState>({
    status: "idle",
    updateInfo: null,
    updateObject: null,
    downloadProgress: 0,
    error: null,
  });

  const hasCheckedRef = useRef(false);

  const performCheck = useCallback(async () => {
    if (!isTauriDesktop()) return;

    setState((s) => ({ ...s, status: "checking" }));

    let result: UpdateCheckResult;
    try {
      result = await checkAppUpdate();
    } catch (err: any) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err?.message ?? t("system.updateCheckFailed"),
      }));
      return;
    }

    if (result.error) {
      // Silently swallow errors on the auto-check (only surface in manual check)
      setState((s) => ({ ...s, status: "idle", error: result.error ?? null }));
      return;
    }

    if (result.hasUpdate && result.version) {
      // If the user already dismissed this exact version, don't re-show
      const dismissed = getDismissedVersion();
      if (dismissed === result.version) {
        setState((s) => ({ ...s, status: "dismissed" }));
        return;
      }

      setState((s) => ({
        ...s,
        status: "available",
        updateInfo: {
          version: result.version!,
          body: result.body,
          date: result.date,
        },
        updateObject: result.updateObject,
      }));
    } else {
      setState((s) => ({ ...s, status: "up-to-date" }));
    }
  }, []);

  // Auto-check once after startup (delayed so the app feels snappy)
  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const timer = setTimeout(() => {
      performCheck();
    }, 3000); // 3 s delay — let the app fully load first

    return () => clearTimeout(timer);
  }, [performCheck]);

  const dismiss = useCallback(() => {
    if (state.updateInfo?.version) {
      setDismissedVersion(state.updateInfo.version);
    }
    setState((s) => ({ ...s, status: "dismissed" }));
  }, [state.updateInfo?.version]);

  const installUpdate = useCallback(async () => {
    if (!state.updateObject) return;

    setState((s) => ({ ...s, status: "downloading", downloadProgress: 0 }));

    try {
      await installAndRelaunchUpdate(
        state.updateObject,
        (progress: DownloadProgress) => {
          if (progress.event === "Progress" && progress.contentLength) {
            const pct = Math.round(
              (progress.downloaded / progress.contentLength) * 100
            );
            setState((s) => ({ ...s, downloadProgress: Math.min(pct, 99) }));
          } else if (progress.event === "Finished") {
            setState((s) => ({ ...s, downloadProgress: 100 }));
          }
        }
      );
    } catch (err: any) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err?.message ?? t("system.updateInstallFailed"),
      }));
    }
  }, [state.updateObject]);

  const recheckUpdate = useCallback(async () => {
    hasCheckedRef.current = false; // allow re-check
    await performCheck();
  }, [performCheck]);

  return {
    ...state,
    dismiss,
    installUpdate,
    recheckUpdate,
  };
}
