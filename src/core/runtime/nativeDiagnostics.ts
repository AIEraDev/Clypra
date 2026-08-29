import { listen } from "@tauri-apps/api/event";
import { crashReporter } from "@/core/telemetry";

export interface NativeDiagnostic {
  level: "error" | "warning";
  source: string;
  code: string;
  message: string;
  timestampEpochMs: number;
}

const MAX_DIAGNOSTICS = 100;
const diagnostics: NativeDiagnostic[] = [];

export function getNativeDiagnostics(): NativeDiagnostic[] {
  return diagnostics.map((entry) => ({ ...entry }));
}

export function clearNativeDiagnostics(): void {
  diagnostics.length = 0;
}

/**
 * Installs the native error bridge.
 * - Logs native errors to the in-memory ring buffer.
 * - Forwards error-level diagnostics to the crash reporting pipeline.
 * - DevTools can inspect `window.__CLYPRA_NATIVE_DIAGNOSTICS__` when needed.
 */
export async function installNativeDiagnostics(): Promise<() => void> {
  const unlisten = await listen<NativeDiagnostic>(
    "clypra://native-diagnostic",
    (event) => {
      diagnostics.push(event.payload);
      if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift();

      if (event.payload.level === "error") {
        console.error(`[native-diagnostic] ${event.payload.source}: ${event.payload.code} - ${event.payload.message}`, event.payload);

        // Forward error-level native diagnostics to crash telemetry pipeline.
        void crashReporter.reportCrash({
          crashType: "GPU_INIT_FAILURE",
          error: {
            name: `NativeError:${event.payload.code}`,
            message: event.payload.message,
            code: event.payload.code,
          },
          subsystem: event.payload.source,
        });
      } else {
        console.warn(`[native-diagnostic] ${event.payload.source}: ${event.payload.code} - ${event.payload.message}`, event.payload);
      }
    },
  );

  if (import.meta.env.DEV && typeof window !== "undefined") {
    (window as Window & {
      __CLYPRA_NATIVE_DIAGNOSTICS__?: {
        getRecent: () => NativeDiagnostic[];
        clear: () => void;
      };
    }).__CLYPRA_NATIVE_DIAGNOSTICS__ = {
      getRecent: getNativeDiagnostics,
      clear: clearNativeDiagnostics,
    };
  }

  return unlisten;
}
