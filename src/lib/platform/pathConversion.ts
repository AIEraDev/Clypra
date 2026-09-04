/**
 * Path Conversion Utilities
 *
 * Centralized path conversion between native filesystem paths and Tauri webview URLs.
 * This ensures inverse operations (native → webview → native) stay in sync.
 */

/**
 * Convert Tauri webview URL to native filesystem path.
 * Handles: asset://localhost/, file://, http://asset.localhost/
 *
 * Used before invoking Rust commands that need filesystem paths.
 */
function reconstructPath(url: URL): string {
  // Reconstruct full path including search and hash fragments (e.g. filenames with '#' or '?')
  let pathname = decodeURIComponent(
    (url.pathname + (url.search || "") + (url.hash || "")).replace(/\+/g, " ")
  );
  if (pathname.startsWith("//")) {
    pathname = pathname.replace(/^\/+/, "/");
  }
  // Windows: /C:/... → C:/...
  if (/^\/[A-Za-z]:/.test(pathname)) {
    pathname = pathname.slice(1);
  }
  return pathname;
}

export function toNativePath(inputPath: string): string {
  const p = inputPath.trim();

  // Handle http://asset.localhost/ or https://asset.localhost/
  if (p.startsWith("http://asset.localhost/") || p.startsWith("https://asset.localhost/") || p.startsWith("http://asset.localhost%2F") || p.startsWith("https://asset.localhost%2F")) {
    try {
      return reconstructPath(new URL(p));
    } catch {
      return p;
    }
  }

  // Handle asset://localhost/<encoded-path> produced by convertFileSrc on macOS/Linux
  if (p.startsWith("asset://localhost/") || p.startsWith("asset://localhost%2F")) {
    try {
      return reconstructPath(new URL(p));
    } catch {
      return p;
    }
  }

  // Handle asset://<encoded-path> (Windows variant: asset:///C:/...)
  if (p.startsWith("asset://")) {
    try {
      return reconstructPath(new URL(p));
    } catch {
      return p;
    }
  }

  // Handle file:// URLs
  if (!p.startsWith("file://")) {
    return p;
  }
  try {
    return reconstructPath(new URL(p));
  } catch {
    return p;
  }
}

/**
 * Check if path is already a webview URL or external resource
 */
export function isWebviewOrExternalUrl(path: string | null | undefined): boolean {
  if (!path || typeof path !== "string") return false;
  return (
    path.startsWith("data:") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("asset://") ||
    path.startsWith("blob:")
  );
}
