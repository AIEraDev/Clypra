export type PlatformType = "tauri" | "capacitor" | "web";

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps?: number;
}

export interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

export interface PlatformInterface {
  type: PlatformType;
  isTauri(): boolean;
  isCapacitor(): boolean;
  isWeb(): boolean;

  convertFileSrc(path: string): string;

  // File System & Paths
  appDataDir(): Promise<string>;
  joinPaths(...paths: string[]): Promise<string>;

  // Dialogs
  openFileDialog(options: { multiple?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<SelectedFile[] | null>;

  // Project Storage
  getRecentProjects(): Promise<any[]>;
  loadProject(path: string): Promise<string>;
  saveProject(payload: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  renameProject(projectId: string, newName: string): Promise<void>;

  // Media Processing
  getMediaMetadata(path: string): Promise<VideoMetadata>;
  extractPosterFrame(path: string, duration: number, dpr: number): Promise<string>;
  extractAudioArtwork(path: string): Promise<string | undefined>;
}

// ─── Environment Detection ───────────────────────────────────────────────────

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isCapacitor = typeof window !== "undefined" && (window as any).Capacitor !== undefined;

export const getPlatformType = (): PlatformType => {
  if (isTauri) return "tauri";
  if (isCapacitor) return "capacitor";
  return "web";
};
