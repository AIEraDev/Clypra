/**
 * RFC 6902 JSON Patch Applier
 *
 * Implements deterministic in-memory patch application for project delta updates
 * (add, remove, replace) stored in OPFS or local cache.
 */

import type { JsonPatchOperation } from "@/workers/types";

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parsePointer(path: string): string[] {
  if (!path || path === "/") return [];
  if (!path.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer path: "${path}" must start with "/"`);
  }
  return path
    .slice(1)
    .split("/")
    .map(unescapePointerSegment);
}

/**
 * Apply a sequence of RFC 6902 JSON Patch operations to a target object.
 * Returns the modified target (cloned or mutated in place where appropriate).
 */
export function applyJsonPatch<T>(target: T, patch: JsonPatchOperation[]): T {
  if (!patch || patch.length === 0) return target;

  // Clone top-level target if it's an object/array to ensure pure output
  let root: any = Array.isArray(target)
    ? [...(target as any)]
    : typeof target === "object" && target !== null
      ? { ...target }
      : target;

  for (const op of patch) {
    const segments = parsePointer(op.path);

    if (segments.length === 0) {
      if (op.op === "replace" || op.op === "add") {
        root = op.value;
      }
      continue;
    }

    // Traverse to parent of the target property
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (current[seg] === undefined || current[seg] === null) {
        // If intermediate path is missing, initialize according to next key
        const nextSeg = segments[i + 1];
        const isNumeric = /^\d+$/.test(nextSeg);
        current[seg] = isNumeric ? [] : {};
      }
      current = current[seg];
    }

    const lastSeg = segments[segments.length - 1];

    if (Array.isArray(current)) {
      const isEnd = lastSeg === "-";
      const index = isEnd ? current.length : parseInt(lastSeg, 10);

      switch (op.op) {
        case "add": {
          if (isEnd || index >= current.length) {
            current.push(op.value);
          } else {
            current.splice(index, 0, op.value);
          }
          break;
        }
        case "remove": {
          if (!isNaN(index) && index >= 0 && index < current.length) {
            current.splice(index, 1);
          }
          break;
        }
        case "replace": {
          if (!isNaN(index) && index >= 0 && index < current.length) {
            current[index] = op.value;
          } else if (isEnd) {
            current.push(op.value);
          }
          break;
        }
        default:
          break;
      }
    } else if (typeof current === "object" && current !== null) {
      switch (op.op) {
        case "add":
        case "replace": {
          current[lastSeg] = op.value;
          break;
        }
        case "remove": {
          delete current[lastSeg];
          break;
        }
        default:
          break;
      }
    }
  }

  return root as T;
}
