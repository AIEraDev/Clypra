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
export function toNativePath(inputPath: string): string {
  const p = inputPath.trim();

  // Handle http://asset.localhost/ or https://asset.localhost/
  if (p.startsWith("http://asset.localhost/") || p.startsWith("https://asset.localhost/") || p.startsWith("http://asset.localhost%2F") || p.startsWith("https://asset.localhost%2F")) {
    try {
      const url = new URL(p);
      let pathname = decodeURIComponent(url.pathname.replace(/\+/g, " "));
      if (pathname.startsWith("//")) {
        pathname = pathname.replace(/^\/+/, "/");
      }
      // Windows: http://asset.localhost/C:/... → /C:/... → C:/...
      if (/^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname;
    } catch {
      return p;
    }
  }

  // Handle asset://localhost/<encoded-path> produced by convertFileSrc on macOS/Linux
  if (p.startsWith("asset://localhost/") || p.startsWith("asset://localhost%2F")) {
    try {
      const url = new URL(p);
      let pathname = decodeURIComponent(url.pathname.replace(/\+/g, " "));
      if (pathname.startsWith("//")) {
        pathname = pathname.replace(/^\/+/, "/");
      }
      // Windows: asset://localhost/C:/... → /C:/... → C:/...
      if (/^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname;
    } catch {
      return p;
    }
  }

  // Handle asset://<encoded-path> (Windows variant: asset:///C:/...)
  if (p.startsWith("asset://")) {
    try {
      const url = new URL(p);
      let pathname = decodeURIComponent(url.pathname.replace(/\+/g, " "));
      if (pathname.startsWith("//")) {
        pathname = pathname.replace(/^\/+/, "/");
      }
      if (/^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname;
    } catch {
      return p;
    }
  }

  // Handle file:// URLs
  if (!p.startsWith("file://")) {
    return p;
  }
  try {
    const url = new URL(p);
    let pathname = decodeURIComponent(url.pathname.replace(/\+/g, " "));
    if (pathname.startsWith("//")) {
      pathname = pathname.replace(/^\/+/, "/");
    }
    // Windows: file:///C:/Users/... → /C:/Users/... → C:/Users/...
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname;
  } catch {
    return p;
  }
}

/**
 * Check if path is already a webview URL or external resource
 */
export function isWebviewOrExternalUrl(path: string): boolean {
  return path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://") || path.startsWith("asset://");
}
