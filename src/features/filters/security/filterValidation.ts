/**
 * Filter Validation & Security Boundaries
 * 
 * Provides robust validation, schema enforcement, range clamping,
 * and prototype pollution protection for remote and cached filter payloads.
 */

import type { FilterAsset } from "../types";

/** Maximum allowed payload size for remote filter JSON (1 MB) */
export const MAX_FILTER_PAYLOAD_BYTES = 1024 * 1024;

/** Maximum allowed URL length */
export const MAX_URL_LENGTH = 2048;

/** Maximum allowed string lengths */
export const MAX_STRING_LENGTH = 256;
export const MAX_DESCRIPTION_LENGTH = 2048;
export const MAX_EFFECT_STACK_NODES = 32;

/**
 * Validates whether a remote filter URL is safe to fetch.
 * Disallows dangerous schemes (javascript:, file:, data:, blob:, etc.) and credentials.
 */
export function isValidFilterUrl(url: string): boolean {
  if (typeof url !== "string" || !url.trim() || url.length > MAX_URL_LENGTH) {
    return false;
  }

  try {
    const parsed = new URL(url);

    // Reject credentials in URL (e.g. https://user:pass@example.com)
    if (parsed.username || parsed.password) {
      return false;
    }

    // Allow https, or http strictly for local dev
    if (parsed.protocol === "https:") {
      return Boolean(parsed.hostname);
    }

    if (parsed.protocol === "http:") {
      const isLocalhost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1" ||
        parsed.hostname.endsWith(".localhost");

      return isLocalhost;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Checks if a key could cause prototype pollution.
 */
export function isDangerousKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

/**
 * Bounds a numeric value to a finite number within [min, max].
 */
export function clampNumeric(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates and sanitizes gradingParams uniform dictionary.
 * Ensures every uniform parameter is a safe finite number or a safe sub-dictionary.
 */
export function sanitizeGradingParams(
  raw: unknown
): import("@clypra-studio/engine").GradingParams | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(raw as Record<string, unknown>);

  for (const [key, val] of entries) {
    if (isDangerousKey(key)) continue;

    // Enforce valid identifier name (alphanumeric, underscore, dash, max 64 chars)
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) continue;

    if (typeof val === "number") {
      if (Number.isFinite(val)) {
        // Clamp to safe numerical limits [-1000.0, 1000.0] to prevent shader NaN/inf issues
        result[key] = Math.min(1000, Math.max(-1000, val));
      }
    } else if (typeof val === "boolean") {
      result[key] = val;
    } else if (typeof val === "string") {
      if (val.length <= MAX_STRING_LENGTH) {
        result[key] = val;
      }
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      // Nested sub-params (e.g. vibrance: { amount: 0.5 })
      const subObj: Record<string, unknown> = {};
      for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
        if (isDangerousKey(subKey) || !/^[a-zA-Z0-9_-]{1,64}$/.test(subKey)) continue;
        if (typeof subVal === "number" && Number.isFinite(subVal)) {
          subObj[subKey] = Math.min(1000, Math.max(-1000, subVal));
        } else if (typeof subVal === "boolean") {
          subObj[subKey] = subVal;
        } else if (typeof subVal === "string" && subVal.length <= MAX_STRING_LENGTH) {
          subObj[subKey] = subVal;
        }
      }
      if (Object.keys(subObj).length > 0) {
        result[key] = subObj;
      }
    }
  }

  return Object.keys(result).length > 0 ? (result as any) : undefined;
}

/**
 * Validates and sanitizes V2 MPG effect stack nodes.
 */
export function sanitizeEffectStack(
  raw: unknown
): Array<{ type: string; params?: Record<string, unknown> }> | undefined {
  if (!Array.isArray(raw)) return undefined;

  const stack: Array<{ type: string; params?: Record<string, unknown> }> = [];
  const count = Math.min(raw.length, MAX_EFFECT_STACK_NODES);

  for (let i = 0; i < count; i++) {
    const node = raw[i];
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;

    const nodeType = typeof (node as any).type === "string" ? (node as any).type.trim() : "";
    if (!nodeType || !/^[a-zA-Z0-9_-]{1,64}$/.test(nodeType)) continue;

    const rawParams = (node as any).params;
    let sanitizedParams: Record<string, unknown> | undefined;

    if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
      sanitizedParams = {};
      for (const [pKey, pVal] of Object.entries(rawParams as Record<string, unknown>)) {
        if (isDangerousKey(pKey) || !/^[a-zA-Z0-9_-]{1,64}$/.test(pKey)) continue;

        if (typeof pVal === "number" && Number.isFinite(pVal)) {
          sanitizedParams[pKey] = Math.min(10000, Math.max(-10000, pVal));
        } else if (typeof pVal === "boolean") {
          sanitizedParams[pKey] = pVal;
        } else if (typeof pVal === "string" && pVal.length <= MAX_STRING_LENGTH) {
          sanitizedParams[pKey] = pVal;
        }
      }
    }

    stack.push({
      type: nodeType,
      ...(sanitizedParams && Object.keys(sanitizedParams).length > 0 ? { params: sanitizedParams } : {}),
    });
  }

  return stack.length > 0 ? stack : undefined;
}

/**
 * Checks for dangerous prototype keys anywhere in an object tree.
 */
export function hasPrototypePollution(obj: unknown, depth = 0): boolean {
  if (depth > 10 || !obj || typeof obj !== "object") return false;

  for (const key of Object.getOwnPropertyNames(obj)) {
    if (isDangerousKey(key)) return true;
  }

  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (val && typeof val === "object" && hasPrototypePollution(val, depth + 1)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitizes and validates an untrusted remote filter object.
 * Returns a safe, validated FilterAsset or throws if mandatory fields are invalid.
 */
export function sanitizeRemoteFilterPayload(raw: unknown, baseAsset?: FilterAsset): FilterAsset {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid filter payload: expected a JSON object");
  }

  const payload = raw as Record<string, unknown>;

  // Check for prototype pollution attempt
  if (hasPrototypePollution(payload)) {
    throw new Error("Security violation: prototype pollution attempt detected in filter payload");
  }

  const id = typeof payload.id === "string" && payload.id.trim()
    ? payload.id.trim().substring(0, MAX_STRING_LENGTH)
    : baseAsset?.id || "filter_unknown";

  const name = typeof payload.name === "string" && payload.name.trim()
    ? payload.name.trim().substring(0, MAX_STRING_LENGTH)
    : baseAsset?.name || "Unnamed Filter";

  const category = typeof payload.category === "string" && payload.category.trim()
    ? payload.category.trim().substring(0, MAX_STRING_LENGTH)
    : baseAsset?.category || "custom";

  const description = typeof payload.description === "string"
    ? payload.description.substring(0, MAX_DESCRIPTION_LENGTH)
    : baseAsset?.description || "";

  const thumbnail = typeof payload.thumbnail === "string" && payload.thumbnail.length <= MAX_URL_LENGTH
    ? payload.thumbnail
    : baseAsset?.thumbnail || "";

  const gradingParams = sanitizeGradingParams(payload.gradingParams) || baseAsset?.gradingParams;
  const effectStack = sanitizeEffectStack(payload.effectStack) || baseAsset?.effectStack;
  const pipeline = payload.pipeline === "v2" ? ("v2" as const) : baseAsset?.pipeline;

  const result: FilterAsset = {
    id,
    name,
    type: "filter",
    category,
    description,
    thumbnail,
  };

  if (gradingParams) result.gradingParams = gradingParams;
  if (effectStack) result.effectStack = effectStack;
  if (pipeline) result.pipeline = pipeline;

  if (typeof payload.url === "string" && isValidFilterUrl(payload.url)) {
    result.url = payload.url;
  } else if (baseAsset?.url) {
    result.url = baseAsset.url;
  }

  if (typeof payload.lut === "string" && payload.lut.length <= MAX_URL_LENGTH) {
    result.lut = payload.lut;
  }

  if (typeof payload.isPremium === "boolean") {
    result.isPremium = payload.isPremium;
  }

  if (Array.isArray(payload.tags)) {
    result.tags = payload.tags
      .filter((t): t is string => typeof t === "string" && t.length <= 64)
      .slice(0, 20);
  }

  if (payload.intensity && typeof payload.intensity === "object" && !Array.isArray(payload.intensity)) {
    const rawInt = payload.intensity as Record<string, unknown>;
    const min = clampNumeric(rawInt.min, 0, 1, 0);
    const max = clampNumeric(rawInt.max, min, 2, 1);
    const def = clampNumeric(rawInt.default, min, max, 0.8);
    const step = clampNumeric(rawInt.step, 0.001, 0.5, 0.05);

    result.intensity = { min, max, default: def, step };
  }

  return result;
}
