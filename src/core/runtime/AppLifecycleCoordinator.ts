import { isTauriRuntime } from "@/lib/platform/tauri";

export type AppLifecycleState = "foreground" | "backgrounded";
export type LifecycleListener = () => void;

/**
 * AppLifecycleCoordinator
 *
 * Single authority for managing application visibility, window focus,
 * and background/foreground sleep-wakeup transitions in Clypra.
 */
export class AppLifecycleCoordinator {
  private static instance: AppLifecycleCoordinator | null = null;

  private state: AppLifecycleState = "foreground";
  private readonly wakeupListeners = new Set<LifecycleListener>();
  private readonly sleepListeners = new Set<LifecycleListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private unlistenTauriFocus: (() => void) | null = null;

  static getInstance(): AppLifecycleCoordinator {
    if (!AppLifecycleCoordinator.instance) {
      AppLifecycleCoordinator.instance = new AppLifecycleCoordinator();
    }
    return AppLifecycleCoordinator.instance;
  }

  constructor() {
    this.init();
  }

  private init(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    this.state = this.evaluateState();

    const handleEvent = () => this.scheduleEvaluation();

    document.addEventListener("visibilitychange", handleEvent);
    window.addEventListener("focus", handleEvent);
    window.addEventListener("blur", handleEvent);

    if (isTauriRuntime()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => {
          if (this.disposed) return;
          const win = getCurrentWindow();
          return win.onFocusChanged(({ payload: focused }) => {
            if (this.disposed) return;
            this.scheduleEvaluation(focused ? "foreground" : undefined);
          });
        })
        .then((unlisten) => {
          if (unlisten) {
            this.unlistenTauriFocus = unlisten;
          }
        })
        .catch(() => undefined);
    }
  }

  private evaluateState(): AppLifecycleState {
    if (typeof document === "undefined") return "foreground";
    if (document.hidden || document.visibilityState === "hidden") {
      return "backgrounded";
    }
    return "foreground";
  }

  getState(): AppLifecycleState {
    return this.state;
  }

  private scheduleEvaluation(hint?: AppLifecycleState): void {
    if (this.disposed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.disposed) return;
      const newState = hint ?? this.evaluateState();
      this.transitionTo(newState);
    }, 16);
  }

  private transitionTo(newState: AppLifecycleState): void {
    if (newState === this.state) return;
    this.state = newState;
    if (newState === "foreground") {
      console.info("[AppLifecycle] App returned to FOREGROUND — triggering wakeup resync");
      for (const listener of this.wakeupListeners) {
        try {
          listener();
        } catch (error) {
          console.error("[AppLifecycle] Error in wakeup listener:", error);
        }
      }
    } else {
      console.info("[AppLifecycle] App transitioned to BACKGROUND");
      for (const listener of this.sleepListeners) {
        try {
          listener();
        } catch (error) {
          console.error("[AppLifecycle] Error in sleep listener:", error);
        }
      }
    }
  }

  isForeground(): boolean {
    return this.state === "foreground";
  }

  isBackgrounded(): boolean {
    return this.state === "backgrounded";
  }

  onForegroundWakeup(listener: LifecycleListener): () => void {
    this.wakeupListeners.add(listener);
    return () => {
      this.wakeupListeners.delete(listener);
    };
  }

  onBackgroundSleep(listener: LifecycleListener): () => void {
    this.sleepListeners.add(listener);
    return () => {
      this.sleepListeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.wakeupListeners.clear();
    this.sleepListeners.clear();
    if (this.unlistenTauriFocus) {
      this.unlistenTauriFocus();
      this.unlistenTauriFocus = null;
    }
  }
}

export const appLifecycleCoordinator = AppLifecycleCoordinator.getInstance();
