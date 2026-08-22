import React, { useCallback, useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { platform } from "@/core/platform";

type WindowApi = ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>;

export function isMacOSPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|Macintosh/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

const noDragStyle = { WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties;

/**
 * Window controls for the borderless Tauri window.
 *
 * The controls are deliberately explicit instead of relying on nested
 * elements inside a drag region. This keeps hit testing consistent across
 * WebView2, WebKit and Linux WebKitGTK.
 */
export const WindowControls: React.FC<{ className?: string }> = ({ className = "" }) => {
  const [windowApi, setWindowApi] = useState<WindowApi | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshMaximized = useCallback(async (win: WindowApi) => {
    try {
      setIsMaximized(await win.isMaximized());
    } catch {
      // A window can disappear while the app is shutting down.
    }
  }, []);

  useEffect(() => {
    if (!platform.isTauri()) return;

    let mounted = true;
    let win: WindowApi | null = null;

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        if (!mounted) return;
        const currentWindow = getCurrentWindow();
        win = currentWindow;
        setWindowApi(currentWindow);
        void refreshMaximized(currentWindow);
      })
      .catch((error) => console.warn("[WindowControls] Failed to initialize:", error));

    return () => {
      mounted = false;
      win = null;
    };
  }, [refreshMaximized]);

  if (!platform.isTauri()) return null;

  const mac = isMacOSPlatform();

  const shellClassName = `flex items-center gap-0.5 shrink-0 w-[6.5rem] ${mac ? "order-first" : "order-last"} ${className}`;

  if (!windowApi) {
    return <div className={shellClassName} aria-hidden="true" style={{ visibility: "hidden" }} />;
  }

  const activeWindow = windowApi;

  const runWindowAction = async (action: (win: WindowApi) => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action(activeWindow);
      await refreshMaximized(activeWindow);
    } catch (error) {
      console.error("[WindowControls] Window action failed:", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={shellClassName}
      aria-label="Window controls"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        type="button"
        aria-label="Minimize window"
        title="Minimize"
        disabled={busy}
        onClick={() => void runWindowAction((win) => win.minimize())}
        className={`w-7 h-7 inline-flex items-center justify-center rounded-md text-text-muted hover:bg-white/10 hover:text-text-primary disabled:opacity-50 ${mac ? "order-2" : "order-1"}`}
        style={noDragStyle}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        title={isMaximized ? "Restore" : "Maximize"}
        disabled={busy}
        onClick={() => void runWindowAction((win) => win.toggleMaximize())}
        className={`w-7 h-7 inline-flex items-center justify-center rounded-md text-text-muted hover:bg-white/10 hover:text-text-primary disabled:opacity-50 ${mac ? "order-3" : "order-2"}`}
        style={noDragStyle}
      >
        {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
      </button>
      <button
        type="button"
        aria-label="Close window"
        title="Close"
        disabled={busy}
        onClick={() => void runWindowAction((win) => win.close())}
        className={`w-7 h-7 inline-flex items-center justify-center rounded-md text-text-muted hover:bg-red-500/90 hover:text-white disabled:opacity-50 ${mac ? "order-1" : "order-3"}`}
        style={noDragStyle}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const WindowDragRegion: React.FC<{ className?: string }> = ({ className = "" }) => {
  const handleDoubleClick = () => {
    if (!platform.isTauri()) return;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
      .catch((error) => console.warn("[WindowControls] Failed to toggle maximize:", error));
  };

  return (
    <div
      aria-hidden="true"
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      className={`min-w-0 flex-1 self-stretch cursor-default ${className}`}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    />
  );
};
