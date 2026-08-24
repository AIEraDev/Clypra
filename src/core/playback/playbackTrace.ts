/**
 * Focused diagnostics for native preview audio & playback synchronization.
 */

export function tracePlayback(
  event: string,
  details: Record<string, unknown> = {},
): void {
  // Always log in DEV or when debug flag is active
  const globalWithDebugFlag = globalThis as typeof globalThis & {
    __CLYPRA_DEBUG_AUDIO__?: boolean;
  };
  let localStorageEnabled = false;
  try {
    localStorageEnabled =
      localStorage.getItem("clypra:debug:audio") === "1" ||
      localStorage.getItem("clypra:debug:playback") === "1";
  } catch {}

  if (
    !import.meta.env.DEV &&
    !globalWithDebugFlag.__CLYPRA_DEBUG_AUDIO__ &&
    !localStorageEnabled
  ) {
    return;
  }

  const timeMs = performance.now().toFixed(2);
}
