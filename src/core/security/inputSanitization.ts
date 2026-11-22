/**
 * Canonical Input Sanitization & Defensive Boundaries
 *
 * Provides shared security primitives across Tier 1 (UI/DOM) and Tier 2 (Workers)
 * to guard against prototype pollution, malformed JSON, and invalid project payloads.
 */

import {
  isDangerousKey,
  hasPrototypePollution,
  clampNumeric,
} from "@/features/filters/security/filterValidation";

export { isDangerousKey, hasPrototypePollution, clampNumeric };

export interface SafeJsonParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Safely parses untrusted JSON text with recursive prototype pollution detection.
 */
export function safeJsonParse<T = unknown>(rawJson: string): SafeJsonParseResult<T> {
  if (typeof rawJson !== "string" || !rawJson.trim()) {
    return { success: false, error: "Security Violation: Empty or non-string JSON payload" };
  }

  try {
    const parsed = JSON.parse(rawJson);
    if (parsed && typeof parsed === "object") {
      if (hasPrototypePollution(parsed)) {
        return {
          success: false,
          error: "Security Violation: Prototype pollution keys detected in payload",
        };
      }
    }
    return { success: true, data: parsed as T };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sanitizes project names, clamping length and stripping illegal control characters.
 */
export function sanitizeProjectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Untitled Project";
  // Max 64 graphemes, strip ASCII control characters (0x00 - 0x1F, 0x7F)
  return Array.from(trimmed.replace(/[\x00-\x1F\x7F]/g, ""))
    .slice(0, 64)
    .join("");
}
