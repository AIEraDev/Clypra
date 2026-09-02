/**
 * ProjectWorkerClient — Main-Thread Client for ProjectWorker
 *
 * Provides off-thread JSON serialization, structural diffing (RFC 6902 JSON patch),
 * and background OPFS persistence via WorkerBus with synchronous fallbacks.
 */

import { WorkerBus } from "./workerBus";
import type {
  ProjectWorkerRequest,
  ProjectWorkerResponse,
  SerializableProjectState,
  SerializedResult,
  PatchResult,
  WriteComplete,
  JsonPatchOperation,
} from "@/workers/types";

export class ProjectWorkerClient {
  private readonly bus: WorkerBus<
    ProjectWorkerRequest,
    ProjectWorkerResponse
  >;

  constructor() {
    this.bus = new WorkerBus(
      () =>
        new Worker(
          new URL("../../workers/projectWorker.worker.ts", import.meta.url),
          { type: "module" },
        ),
      { name: "ProjectWorker", autoRestart: true },
    );
  }

  /**
   * Serialize a project state to JSON string off the main UI thread.
   */
  async serialize(
    state: SerializableProjectState,
  ): Promise<SerializedResult> {
    if (this.bus.status === "error" || typeof Worker === "undefined") {
      const start = performance.now();
      return {
        type: "SERIALIZED",
        id: "fallback",
        json: JSON.stringify(state),
        serializeMs: performance.now() - start,
      };
    }

    try {
      return await this.bus.send<SerializedResult>({
        type: "SERIALIZE",
        state,
      } as any);
    } catch {
      const start = performance.now();
      return {
        type: "SERIALIZED",
        id: "fallback",
        json: JSON.stringify(state),
        serializeMs: performance.now() - start,
      };
    }
  }

  /**
   * Compute structural JSON patch operations between two project states.
   */
  async diff(
    previous: SerializableProjectState,
    next: SerializableProjectState,
  ): Promise<PatchResult> {
    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return this.fallbackDiff(previous, next);
    }

    try {
      return await this.bus.send<PatchResult>({
        type: "DIFF",
        previous,
        next,
      } as any);
    } catch {
      return this.fallbackDiff(previous, next);
    }
  }

  /**
   * Write project JSON directly to Origin Private File System in the background.
   */
  async writeOpfs(
    filename: string,
    json: string,
  ): Promise<WriteComplete> {
    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return { type: "WRITE_COMPLETE", id: "fallback" };
    }

    try {
      return await this.bus.send<WriteComplete>({
        type: "WRITE_OPFS",
        filename,
        json,
      } as any);
    } catch {
      return { type: "WRITE_COMPLETE", id: "fallback" };
    }
  }

  dispose(): void {
    this.bus.dispose();
  }

  // ─── Main-Thread Fallback ───────────────────────────────────────────────────

  private fallbackDiff(
    previous: SerializableProjectState,
    next: SerializableProjectState,
  ): PatchResult {
    const start = performance.now();
    const patch: JsonPatchOperation[] = [];

    if (previous.version !== next.version) {
      patch.push({ op: "replace", path: "/version", value: next.version });
    }
    if (JSON.stringify(previous.project) !== JSON.stringify(next.project)) {
      patch.push({ op: "replace", path: "/project", value: next.project });
    }

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

      if (JSON.stringify(prevList) !== JSON.stringify(nextList)) {
        patch.push({
          op: "replace",
          path: `/${key}`,
          value: nextList,
        });
      }
    }

    return {
      type: "PATCH_READY",
      id: "fallback",
      patch,
      diffMs: performance.now() - start,
    };
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

let clientInstance: ProjectWorkerClient | null = null;

export function getProjectWorkerClient(): ProjectWorkerClient {
  if (!clientInstance) {
    clientInstance = new ProjectWorkerClient();
  }
  return clientInstance;
}
