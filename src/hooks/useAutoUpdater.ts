import { useCallback, useEffect, useSyncExternalStore } from "react";
import { autoUpdateManager, isTauriDesktop, type AutoUpdaterState } from "@/services/updaterService";

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

  useEffect(() => {
    if (!isTauriDesktop()) return;
    const timer = window.setTimeout(() => {
      void autoUpdateManager.check({ silent: true });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

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
