/**
 * Shared API Utilities
 * Common functions used across all API clients
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://clypra-worker-api.abdulkabirmusa.com";
const API_KEY = import.meta.env.VITE_CLYPRA_API_KEY || "";

/**
 * Create headers with API key for authenticated requests
 * Used by all API clients (text-effects, video-effects, audio, stickers, filters, transitions, etc.)
 */
export function getApiHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "X-Clypra-Client": "clypra-desktop-v1",
  };

  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }

  return headers;
}

/**
 * Get the base API URL
 */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

/**
 * Get the API key
 */
export function getApiKey(): string {
  return API_KEY;
}
