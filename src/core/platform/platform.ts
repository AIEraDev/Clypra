import type { Project } from "@/types";

export type PlatformType = "tauri" | "capacitor";

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps?: number;
  size?: number;
}

export interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

export interface ProjectSaveResult {
  projectId: string;
  bytesWritten: number;
  modifiedAt: number;
  verified: boolean;
  verification: {
    primaryReadback: boolean;
    backupRotated: boolean;
  };
}

/** A recent project entry is either safe to open or explicitly unreadable. */
export type RecentProjectEntry =
  | (Project & {
      kind: "ready";
      path: string;
      backupPath: string;
      backupAvailable: boolean;
    })
  | {
      kind: "unreadable";
      id: string;
      name?: string;
      path: string;
      backupPath: string;
      backupAvailable: boolean;
      error: string;
      modifiedAt?: number;
    };

export interface PlatformInterface {
  type: PlatformType;
  isTauri(): boolean;
  isCapacitor(): boolean;

  convertFileSrc(path: string): string;

  saveAndShareVideo(blob: Blob, filename: string): Promise<string>;

  // File System & Paths
  appDataDir(): Promise<string>;
  appCacheDir(): Promise<string>;
  joinPaths(...paths: string[]): Promise<string>;

  // Dialogs
  openFileDialog(options: { multiple?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<SelectedFile[] | null>;

  // Project Storage
  getRecentProjects(): Promise<RecentProjectEntry[]>;
  loadProject(path: string): Promise<string>;
  saveProject(payload: string): Promise<ProjectSaveResult>;
  deleteProject(projectId: string): Promise<void>;
  renameProject(projectId: string, newName: string): Promise<void>;

  // Media Processing
  getMediaMetadata(path: string): Promise<VideoMetadata>;
  extractPosterFrame(path: string, duration: number, dpr: number): Promise<string>;
  extractAudioArtwork(path: string): Promise<string | undefined>;
  saveRecording(fileName: string, data: Uint8Array): Promise<string>;
  appendRecordingChunk?(fileName: string, data: Uint8Array): Promise<void>;
  finalizeRecordingFile?(tempFileName: string, finalFileName: string): Promise<string>;
}

// ─── Environment Detection ───────────────────────────────────────────────────

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isCapacitor = typeof window !== "undefined" && (window as any).Capacitor !== undefined;

export const getPlatformType = (): PlatformType => {
  if (isTauri) return "tauri";
  if (isCapacitor) return "capacitor";
  if (typeof (globalThis as any).process !== "undefined" && (globalThis as any).process.env?.NODE_ENV === "test") {
    return "tauri";
  }
  throw new Error("Unsupported platform: Clypra is built only for Tauri Desktop and Mobile/Capacitor.");
};
