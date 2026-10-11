/**
 * Shared app-version resolver for Clypra Studio.
 *
 * Single source of truth: reads from `@tauri-apps/api/app` (which pulls the
 * version from tauri.conf.json / Cargo.toml at build time) and caches the
 * result for the lifetime of the process.
 *
 * Falls back to the VITE_APP_VERSION env var for web/Capacitor builds, and
 * to "unknown" when neither is available (tests, non-Tauri previews).
 *
 * Usage:
 *   import { getAppVersion } from "@/lib/app/appVersion";
 *   const version = await getAppVersion(); // e.g. "1.4.7"
 */

import { isTauri } from "@/core/platform/platform";
import { APP_VERSION } from "@/config/version";

export { APP_VERSION };

let cachedVersion: string | null = null;
let resolvePromise: Promise<string> | null = null;

/**
 * Returns the running app version string, resolving it once and caching
 * for subsequent calls.
 */
export async function getAppVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion;

  // Coalesce concurrent callers into a single resolution.
  if (resolvePromise) return resolvePromise;

  resolvePromise = (async (): Promise<string> => {
    // Tauri desktop — authoritative source (tauri.conf.json / Cargo.toml).
    if (isTauri) {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        cachedVersion = version;
        return cachedVersion;
      } catch {
        // Fall through to env-var fallback below.
      }
    }

    // Web / Capacitor — build-time injection via Vite env var or package constant.
    const envVersion =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: Record<string, string> }).env?.VITE_APP_VERSION) ||
      null;

    cachedVersion = envVersion ?? APP_VERSION;
    return cachedVersion;
  })().finally(() => {
    resolvePromise = null;
  });

  return resolvePromise;
}

/**
 * Synchronous read of the cached version.
 * Falls back to canonical APP_VERSION constant if not yet awaited.
 */
export function getAppVersionSync(): string {
  return cachedVersion ?? APP_VERSION;
}

/**
 * Primes the cache as early as possible.
 * Call this once at app startup (e.g. in main.tsx) so synchronous reads
 * elsewhere return a real version instead of null.
 */
export async function primeAppVersion(): Promise<void> {
  await getAppVersion();
}
