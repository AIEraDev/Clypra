/**
 * Crash Recovery Service
 *
 * Stores a snapshot of the active project into IndexedDB so that if the
 * application crashes or the browser refreshes unexpectedly, the user can
 * be prompted to restore their last session on next launch.
 *
 * Design principles:
 * - Uses IndexedDB (survives browser/tab closes)
 * - Snapshot is cleared on a clean project close
 * - Snapshot is written after every successful auto-save
 * - Single "activeProject" key so that only the most-recent state is kept
 * - All operations are safe to call without awaiting (fire-and-forget)
 *
 */

import type { Project, MediaAsset, TransitionTimelineItem } from "@/types";
import type { Track, Clip } from "@/types";
import type { Gap } from "@/types/gap";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RecoverySnapshot {
  /** ISO timestamp of when this snapshot was written */
  savedAt: string;
  /** The project metadata */
  project: Project;
  /** Media asset list at time of snapshot */
  mediaAssets: MediaAsset[];
  /** Timeline tracks */
  tracks: Track[];
  /** Timeline clips */
  clips: Clip[];
  /** Transitions */
  transitions: TransitionTimelineItem[];
  /** Timeline gaps and global markers are editable project data too. */
  gaps?: Gap[];
  markers?: import("@/types").TimelineMarker[];
  mainVideoTrackId?: string | null;
  timelineSchemaVersion?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DB_NAME = "clypra_recovery";
const DB_VERSION = 2;
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "activeProject";

// ─── Internal helpers ───────────────────────────────────────────────────────

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) =>
      resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = (event) =>
      reject((event.target as IDBOpenDBRequest).error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Save a crash-recovery snapshot into IndexedDB.
 * Called after every successful auto-save.
 */
export async function saveSnapshot(snapshot: RecoverySnapshot): Promise<void> {
  try {
    await withStore<IDBValidKey>("readwrite", (store) =>
      store.put(snapshot, SNAPSHOT_KEY),
    );
  } catch (error) {
    // Non-fatal – just log. We never want crash-recovery writes to block the main flow.
    console.warn("[CrashRecovery] Failed to save snapshot:", error);
  }
}

/**
 * Retrieve the stored crash-recovery snapshot.
 * Returns null if none exists.
 */
export async function getSnapshot(): Promise<RecoverySnapshot | null> {
  try {
    const result = await withStore<RecoverySnapshot | undefined>(
      "readonly",
      (store) => store.get(SNAPSHOT_KEY),
    );
    return result ?? null;
  } catch (error) {
    console.warn("[CrashRecovery] Failed to read snapshot:", error);
    return null;
  }
}

/**
 * Delete the stored crash-recovery snapshot.
 * Called on a clean project close so we don't prompt for recovery
 * when there is nothing to recover.
 */
export async function clearSnapshot(): Promise<void> {
  try {
    await withStore<undefined>("readwrite", (store) =>
      store.delete(SNAPSHOT_KEY),
    );
    console.debug("[CrashRecovery] Snapshot cleared.");
  } catch (error) {
    console.warn("[CrashRecovery] Failed to clear snapshot:", error);
  }
}

/**
 * Check whether a crash-recovery snapshot exists without fetching it.
 */
export async function hasSnapshot(): Promise<boolean> {
  const snapshot = await getSnapshot();
  return snapshot !== null;
}
