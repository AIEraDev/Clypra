/**
 * ProjectWorker — Off-Thread Project State Serialization, Diffing & Background OPFS Writing
 *
 * Performs CPU-intensive project state operations off the main thread:
 * • Large project JSON serialization without main-thread GC spikes
 * • Fast RFC 6902 JSON patch calculation between project snapshots for undo/redo
 * • Background Origin Private File System (OPFS) snapshot writing
 */

import type {
  ProjectWorkerRequest,
  SerializeRequest,
  DiffRequest,
  WriteOpfsRequest,
  SerializedResult,
  PatchResult,
  WriteComplete,
  JsonPatchOperation,
  SerializableProjectState,
  WorkerErrorResponse,
} from "./types";

function handleSerialize(msg: SerializeRequest): void {
  const start = performance.now();
  const json = JSON.stringify(msg.state);
  const serializeMs = performance.now() - start;

  const response: SerializedResult = {
    type: "SERIALIZED",
    id: msg.id,
    json,
    serializeMs,
  };

  (self as unknown as Worker).postMessage(response);
}

function computeArrayDiff(
  path: string,
  prevArr: any[],
  nextArr: any[],
): JsonPatchOperation[] {
  const ops: JsonPatchOperation[] = [];

  const prevMap = new Map<string, { item: any; index: number }>();
  for (let i = 0; i < prevArr.length; i++) {
    const item = prevArr[i];
    const key = item?.id ?? String(i);
    prevMap.set(key, { item, index: i });
  }

  const nextMap = new Map<string, { item: any; index: number }>();
  for (let i = 0; i < nextArr.length; i++) {
    const item = nextArr[i];
    const key = item?.id ?? String(i);
    nextMap.set(key, { item, index: i });
  }

  // 1. Removals
  for (const [key, { index }] of prevMap) {
    if (!nextMap.has(key)) {
      ops.push({
        op: "remove",
        path: `${path}/${index}`,
      });
    }
  }

  // 2. Additions and modifications
  for (const [key, { item: nextItem, index }] of nextMap) {
    const prev = prevMap.get(key);
    if (!prev) {
      ops.push({
        op: "add",
        path: `${path}/${index}`,
        value: nextItem,
      });
    } else {
      // Shallow comparison of keys
      const prevItem = prev.item;
      if (JSON.stringify(prevItem) !== JSON.stringify(nextItem)) {
        ops.push({
          op: "replace",
          path: `${path}/${index}`,
          value: nextItem,
        });
      }
    }
  }

  return ops;
}

function handleDiff(msg: DiffRequest): void {
  const start = performance.now();
  const { id, previous, next } = msg;

  const patch: JsonPatchOperation[] = [];

  // Version diff
  if (previous.version !== next.version) {
    patch.push({
      op: "replace",
      path: "/version",
      value: next.version,
    });
  }

  // Project meta diff
  if (JSON.stringify(previous.project) !== JSON.stringify(next.project)) {
    patch.push({
      op: "replace",
      path: "/project",
      value: next.project,
    });
  }

  // Collection diffs
  const collections: Array<keyof SerializableProjectState> = [
    "tracks",
    "clips",
    "gaps",
    "transitions",
    "markers",
    "captionTracks",
    "mediaAssets",
  ];

  for (const key of collections) {
    const prevList = (previous[key] as any[]) || [];
    const nextList = (next[key] as any[]) || [];
    const arrayOps = computeArrayDiff(`/${key}`, prevList, nextList);
    patch.push(...arrayOps);
  }

  const diffMs = performance.now() - start;

  const response: PatchResult = {
    type: "PATCH_READY",
    id,
    patch,
    diffMs,
  };

  (self as unknown as Worker).postMessage(response);
}

async function handleWriteOpfs(msg: WriteOpfsRequest): Promise<void> {
  const { id, filename, json } = msg;

  if (typeof navigator !== "undefined" && navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(filename, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(json);
    await writable.close();
  }

  const response: WriteComplete = {
    type: "WRITE_COMPLETE",
    id,
  };

  (self as unknown as Worker).postMessage(response);
}

// ─── Worker Event Listener ───────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<ProjectWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  try {
    switch (msg.type) {
      case "SERIALIZE":
        handleSerialize(msg);
        break;
      case "DIFF":
        handleDiff(msg);
        break;
      case "WRITE_OPFS":
        await handleWriteOpfs(msg);
        break;
      case "DISPOSE":
        break;
    }
  } catch (error) {
    const errorResponse: WorkerErrorResponse = {
      type: "ERROR",
      id: "id" in msg ? msg.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(errorResponse);
  }
};
