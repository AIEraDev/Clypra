import { convertFileSrc } from "@tauri-apps/api/core";
import { PlatformInterface, VideoMetadata, SelectedFile, ProjectSaveResult, RecentProjectEntry } from "../platform";

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://") || value.startsWith("https://");

export class TauriPlatformAdapter implements PlatformInterface {
  type = "tauri" as const;

  isTauri() {
    return true;
  }
  isCapacitor() {
    return false;
  }

  constructor() {}

  convertFileSrc(path: string): string {
    if (!path) return "";
    try {
      return convertFileSrc(path);
    } catch {
      return path;
    }
  }

  async saveAndShareVideo(blob: Blob, filename: string): Promise<string> {
    throw new Error("Sharing is only supported on mobile devices.");
  }

  async appDataDir(): Promise<string> {
    const { appDataDir } = await import("@tauri-apps/api/path");
    return appDataDir();
  }

  async appCacheDir(): Promise<string> {
    const { appCacheDir } = await import("@tauri-apps/api/path");
    return appCacheDir();
  }

  async joinPaths(...paths: string[]): Promise<string> {
    const { join } = await import("@tauri-apps/api/path");
    return join(...paths);
  }

  async openFileDialog(options: { multiple?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<SelectedFile[] | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      multiple: options.multiple,
      directory: options.directory,
      filters: options.filters,
    });
    if (result === null) return null;
    const paths = Array.isArray(result) ? result : [result];
    const files: SelectedFile[] = [];
    for (const p of paths) {
      const name = p.split(/[/\\]/).pop() || "Unknown";
      files.push({
        path: p,
        name,
        size: 0,
      });
    }
    return files;
  }

  async getRecentProjects(): Promise<RecentProjectEntry[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    const { fromRustProject } = await import("@/types/serialization");
    const entries: any[] = await invoke("get_recent_projects");
    return entries.map((entry) => {
      if (entry.kind === "unreadable" || !entry.project) {
        return entry as RecentProjectEntry;
      }
      const rustProject = entry.project;
      const project = fromRustProject(rustProject);
      if (project.mediaAssets) {
        project.mediaAssets = project.mediaAssets.map((asset) => ({
          ...asset,
          posterFrame: asset.posterFrame && !isExternalOrDataUrl(asset.posterFrame) ? this.convertFileSrc(asset.posterFrame) : asset.posterFrame,
          coverArt: asset.coverArt && !isExternalOrDataUrl(asset.coverArt) ? this.convertFileSrc(asset.coverArt) : asset.coverArt,
          path: asset.path && asset.type === "image" && !isExternalOrDataUrl(asset.path) ? this.convertFileSrc(asset.path) : asset.path,
        }));
      }
      return {
        ...project,
        kind: "ready" as const,
        path: entry.path,
        backupPath: entry.backupPath,
        backupAvailable: !!entry.backupAvailable,
      };
    });
  }

  async loadProject(path: string): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("load_project", { path });
  }

  async saveProject(payload: string): Promise<ProjectSaveResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    // CRITICAL FIX: Rust command expects project_data parameter, not projectId/payload
    // See: src-tauri/src/commands/project.rs:22
    return invoke<ProjectSaveResult>("save_project", {
      projectData: payload,
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_project", { projectId });
  }

  async renameProject(projectId: string, newName: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("rename_project", { projectId, newName });
  }

  async getMediaMetadata(path: string): Promise<VideoMetadata> {
    const { invoke } = await import("@tauri-apps/api/core");
    // Try new unified command first, fallback to legacy for backward compatibility
    try {
      return await invoke("get_media_metadata", { path });
    } catch (error) {
      console.warn("[TauriAdapter] Falling back to legacy get_video_metadata:", error);
      try {
        return await invoke("get_video_metadata", { path });
      } catch (fallbackError) {
        throw new Error(`Failed to get media metadata: ${fallbackError}`);
      }
    }
  }

  async extractPosterFrame(path: string, duration: number, dpr: number): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    // Try new command with proper heuristic, fallback to legacy
    try {
      return await invoke("extract_poster_frame_command", { videoPath: path, duration, dpr });
    } catch (error) {
      console.warn("[TauriAdapter] Falling back to legacy extract_poster_frame:", error);
      try {
        return await invoke("extract_poster_frame", { path, time: 0.0 });
      } catch (fallbackError) {
        throw new Error(`Failed to extract poster frame: ${fallbackError}`);
      }
    }
  }

  async extractAudioArtwork(path: string): Promise<string | undefined> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("extract_audio_artwork", { path });
  }

  async saveRecording(fileName: string, data: Uint8Array): Promise<string> {
    const { writeFile, mkdir, exists } = await import("@tauri-apps/plugin-fs");
    const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
    const localDir = await appLocalDataDir();
    if (!(await exists(localDir))) {
      await mkdir(localDir, { recursive: true });
    }
    const filePath = await join(localDir, fileName);
    await writeFile(filePath, data);
    return filePath;
  }

  async appendRecordingChunk(fileName: string, data: Uint8Array): Promise<void> {
    const { writeFile, mkdir, exists } = await import("@tauri-apps/plugin-fs");
    const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
    const localDir = await appLocalDataDir();
    if (!(await exists(localDir))) {
      await mkdir(localDir, { recursive: true });
    }
    const filePath = await join(localDir, fileName);
    await writeFile(filePath, data, { append: true });
  }

  async finalizeRecordingFile(tempFileName: string, finalFileName: string): Promise<string> {
    const { rename, exists, stat } = await import("@tauri-apps/plugin-fs");
    const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
    const localDir = await appLocalDataDir();
    const tempPath = await join(localDir, tempFileName);
    const finalPath = await join(localDir, finalFileName);

    if (await exists(tempPath)) {
      const fileStat = await stat(tempPath).catch(() => ({ size: 0 }));
      if (fileStat.size > 0) {
        await rename(tempPath, finalPath);
        return finalPath;
      }
    }
    throw new Error(`Temp recording file ${tempFileName} is missing or 0 bytes`);
  }
}
