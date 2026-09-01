import { useCallback, useSyncExternalStore } from "react";
import { autoUpdateManager, type AutoUpdaterState } from "@/services/updaterService";

export type { AutoUpdateStatus, AutoUpdaterState } from "@/services/updaterService";

export interface UseAutoUpdaterReturn extends AutoUpdaterState {
  dismiss: () => void;
  later: () => void;
  downloadUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  recheckUpdate: () => Promise<void>;
}

const subscribeToUpdater = (listener: () => void) => autoUpdateManager.subscribe(listener);
const getUpdaterSnapshot = () => autoUpdateManager.getSnapshot();

/**
 * Shared updater state for the banner, Settings, and future update surfaces.
 * The manager intentionally lives outside React so both surfaces cannot start
 * competing downloads or hold different Update resource objects.
 */
export function useAutoUpdater(): UseAutoUpdaterReturn {
  const state = useSyncExternalStore(
    subscribeToUpdater,
    getUpdaterSnapshot,
    getUpdaterSnapshot,
  );

  // NOTE: Auto-update checks are intentionally DISABLED in this build
  // (2026-09-01): the Rust side no longer registers tauri-plugin-updater, so
  // `check()` would fail and produce spurious error logs. The updater UI
  // surfaces (banner/Settings) remain wired to the manager but can never
  // reach an "available" state.

  const dismiss = useCallback(() => autoUpdateManager.dismiss(), []);
  const later = useCallback(() => autoUpdateManager.defer(), []);
  const downloadUpdate = useCallback(() => autoUpdateManager.download(), []);
  const applyUpdate = useCallback(() => autoUpdateManager.apply(), []);
  const recheckUpdate = useCallback(() => autoUpdateManager.check({ force: true }), []);

  return {
    ...state,
    dismiss,
    later,
    downloadUpdate,
    applyUpdate,
    recheckUpdate,
  };
}
