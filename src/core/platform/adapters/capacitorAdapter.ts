import { PlatformInterface, VideoMetadata, SelectedFile, ProjectSaveResult, RecentProjectEntry } from "../platform";
import { fromRustProject } from "@/types/serialization";

export class CapacitorPlatformAdapter implements PlatformInterface {
  type = "capacitor" as const;

  isTauri() {
    return false;
  }
  isCapacitor() {
    return true;
  }

  convertFileSrc(path: string): string {
    if (typeof window !== "undefined" && (window as any).Capacitor) {
      return (window as any).Capacitor.convertFileSrc(path);
    }
    return path;
  }

  async saveAndShareVideo(blob: Blob, filename: string): Promise<string> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");

    const blobToBase64 = (b: Blob): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          resolve(base64);
        };
        reader.readAsDataURL(b);
      });
    };

    const base64 = await blobToBase64(blob);
    const writeResult = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });

    await Share.share({
      url: writeResult.uri,
      title: "Export Video",
    });

    return writeResult.uri;
  }

  async appDataDir(): Promise<string> {
    return "projects";
  }

  async appCacheDir(): Promise<string> {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const result = await Filesystem.getUri({
        directory: Directory.Cache,
        path: "",
      });
      return result.uri;
    } catch (e) {
      console.warn("Failed to get cache directory URI, falling back to empty string", e);
      return "";
    }
  }

  async joinPaths(...paths: string[]): Promise<string> {
    return paths.filter(Boolean).join("/");
  }

  async fileExists(path: string): Promise<boolean> {
    if (!path) return false;
    if (path.startsWith("data:") || path.startsWith("http:") || path.startsWith("https:") || path.startsWith("blob:")) {
      return true;
    }
    try {
      const { Filesystem } = await import("@capacitor/filesystem");
      await Filesystem.stat({ path });
      return true;
    } catch {
      return false;
    }
  }

  async openFileDialog(options: { multiple?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<SelectedFile[] | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = !!options.multiple;

      if (options.filters && options.filters.length > 0) {
        const exts = options.filters.flatMap((f) => f.extensions);
        input.accept = exts.map((ext) => `.${ext}`).join(",");
      }

      input.onchange = () => {
        if (!input.files || input.files.length === 0) {
          resolve(null);
          return;
        }
        const files: SelectedFile[] = [];
        for (let i = 0; i < input.files.length; i++) {
          const file = input.files[i];
          const fileUrl = URL.createObjectURL(file);
          files.push({
            path: fileUrl,
            name: file.name,
            size: file.size,
          });
        }
        resolve(files);
      };

      input.onerror = () => {
        resolve(null);
      };

      input.click();
    });
  }

  // ─── Project Storage via Capacitor Filesystem ──────────────────────────────

  private async getFilesystem() {
    // Dynamically import Capacitor Filesystem to prevent bundling issues on desktop
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    return { Filesystem, Directory, Encoding };
  }

  private projectEntryFromPayload(payload: any, path: string, backupAvailable: boolean): RecentProjectEntry {
    const project = payload?.created_at !== undefined ? fromRustProject(payload) : payload;
    return {
      ...project,
      kind: "ready",
      path,
      backupPath: `${path}.bak`,
      backupAvailable,
    };
  }

  private localStorageEntries(): RecentProjectEntry[] {
    const raw = localStorage.getItem("clypra_recent_projects");
    if (!raw) return [];
    let projects: any[];
    try {
      projects = JSON.parse(raw);
    } catch {
      return [];
    }
    return projects.flatMap((payload) => {
      try {
        if (!payload?.id) throw new Error("Project is missing an id");
        return [this.projectEntryFromPayload(payload, `projects/${payload.id}.json`, !!localStorage.getItem(`clypra_project_${payload.id}_bak`))];
      } catch (error) {
        return [{
          kind: "unreadable" as const,
          id: String(payload?.id ?? "unknown"),
          name: payload?.name,
          path: `projects/${payload?.id ?? "unknown"}.json`,
          backupPath: `projects/${payload?.id ?? "unknown"}.json.bak`,
          backupAvailable: false,
          error: error instanceof Error ? error.message : String(error),
        }];
      }
    });
  }

  private localStorageReceipt(payload: string, project: any, backupRotated: boolean): ProjectSaveResult {
    const stored = localStorage.getItem(`clypra_project_${project.id}`);
    if (stored !== payload) throw new Error("Project verification failed in fallback storage");
    return {
      projectId: project.id,
      bytesWritten: new TextEncoder().encode(payload).byteLength,
      modifiedAt: project.modified_at ?? project.updatedAt ?? Date.now(),
      verified: true,
      verification: { primaryReadback: true, backupRotated },
    };
  }

  private saveToLocalStorage(payload: string, project: any): ProjectSaveResult {
    const previous = localStorage.getItem(`clypra_project_${project.id}`);
    const backupRotated = previous !== null;
    if (previous !== null) {
      localStorage.setItem(`clypra_project_${project.id}_bak`, previous);
      if (localStorage.getItem(`clypra_project_${project.id}_bak`) !== previous) {
        throw new Error("Backup verification failed in fallback storage");
      }
    }
    localStorage.setItem(`clypra_project_${project.id}`, payload);
    const receipt = this.localStorageReceipt(payload, project, backupRotated);
    const fallback = localStorage.getItem("clypra_recent_projects");
    const recentProjects = fallback ? JSON.parse(fallback) : [];
    localStorage.setItem("clypra_recent_projects", JSON.stringify([project, ...recentProjects.filter((p: any) => p.id !== project.id)]));
    return receipt;
  }

  async getRecentProjects(): Promise<RecentProjectEntry[]> {
    let filesystem;
    try {
      filesystem = await this.getFilesystem();
    } catch {
      return this.localStorageEntries();
    }
    const { Filesystem, Directory, Encoding } = filesystem;

    try {

      // Ensure projects directory exists
      try {
        await Filesystem.mkdir({
          path: "projects",
          directory: Directory.Data,
          recursive: true,
        });
      } catch {
        // Already exists
      }

      const filesResult = await Filesystem.readdir({
        path: "projects",
        directory: Directory.Data,
      });

      const projects: RecentProjectEntry[] = [];
      for (const file of filesResult.files) {
        if (file.name.endsWith(".json") && !file.name.endsWith(".json.bak") && !file.name.endsWith(".json.tmp")) {
          const path = `projects/${file.name}`;
          const backupPath = `${path}.bak`;
          let backupAvailable = false;
          try {
            await Filesystem.stat({ path: backupPath, directory: Directory.Data });
            backupAvailable = true;
          } catch {
            backupAvailable = false;
          }
          try {
            const readResult = await Filesystem.readFile({
              path,
              directory: Directory.Data,
              encoding: Encoding.UTF8,
            });
            if (typeof readResult.data === "string") {
              const payload = JSON.parse(readResult.data);
              projects.push(this.projectEntryFromPayload(payload, path, backupAvailable));
            }
          } catch (e) {
            projects.push({
              kind: "unreadable",
              id: file.name.replace(/\.json$/, ""),
              path,
              backupPath,
              backupAvailable,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      return projects.sort((a, b) => (b.kind === "ready" ? b.updatedAt : 0) - (a.kind === "ready" ? a.updatedAt : 0));
    } catch (err) {
      throw new Error(`Failed to enumerate project storage: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async loadProject(path: string): Promise<string> {
    let filesystem;
    try {
      filesystem = await this.getFilesystem();
    } catch {
      const pathParts = path.replace(/\\/g, "/").split("/");
      const projectId = pathParts.pop()?.replace(".json", "") || "";
      const project = localStorage.getItem(`clypra_project_${projectId}`);
      if (project) return project;
      throw new Error(`Project storage backend unavailable and no fallback exists for ${projectId}`);
    }
    try {
      const { Filesystem, Directory, Encoding } = filesystem;
      const readResult = await Filesystem.readFile({
        path, // Expecting full path like 'projects/id.json' or absolute URL
        directory: path.startsWith("projects/") ? Directory.Data : undefined,
        encoding: Encoding.UTF8,
      });
      if (typeof readResult.data !== "string") {
        throw new Error("Invalid file content");
      }
      return readResult.data;
    } catch (err) {
      throw err;
    }
  }

  async saveProject(payload: string): Promise<ProjectSaveResult> {
    const project = JSON.parse(payload);
    if (!project?.id) throw new Error("Project payload is missing an id");
    let filesystem;
    try {
      filesystem = await this.getFilesystem();
    } catch {
      return this.saveToLocalStorage(payload, project);
    }

    try {
      const { Filesystem, Directory, Encoding } = filesystem;
      await Filesystem.mkdir({ path: "projects", directory: Directory.Data, recursive: true }).catch(() => undefined);
      const primaryPath = `projects/${project.id}.json`;
      const tempPath = `${primaryPath}.tmp`;
      const backupPath = `${primaryPath}.bak`;
      let previous: string | null = null;
      try {
        const existing = await Filesystem.readFile({ path: primaryPath, directory: Directory.Data, encoding: Encoding.UTF8 });
        if (typeof existing.data === "string") {
          JSON.parse(existing.data);
          previous = existing.data;
        }
      } catch {
        previous = null;
      }
      await Filesystem.writeFile({ path: tempPath, directory: Directory.Data, data: payload, encoding: Encoding.UTF8 });
      const staged = await Filesystem.readFile({ path: tempPath, directory: Directory.Data, encoding: Encoding.UTF8 });
      if (staged.data !== payload) throw new Error("Temporary project verification failed");
      JSON.parse(staged.data as string);
      if (previous !== null) {
        await Filesystem.writeFile({ path: `${backupPath}.tmp`, directory: Directory.Data, data: previous, encoding: Encoding.UTF8 });
        const backupCheck = await Filesystem.readFile({ path: `${backupPath}.tmp`, directory: Directory.Data, encoding: Encoding.UTF8 });
        if (backupCheck.data !== previous) throw new Error("Backup verification failed");
        try {
          await Filesystem.rename({ from: `${backupPath}.tmp`, to: backupPath, directory: Directory.Data });
        } catch {
          // Some mobile filesystem implementations do not replace an existing
          // destination. The primary remains untouched if this rotation fails.
          await Filesystem.deleteFile({ path: backupPath, directory: Directory.Data }).catch(() => undefined);
          await Filesystem.rename({ from: `${backupPath}.tmp`, to: backupPath, directory: Directory.Data });
        }
      }
      try {
        await Filesystem.rename({ from: tempPath, to: primaryPath, directory: Directory.Data });
      } catch (renameError) {
        await Filesystem.deleteFile({ path: primaryPath, directory: Directory.Data }).catch(() => undefined);
        try {
          await Filesystem.rename({ from: tempPath, to: primaryPath, directory: Directory.Data });
        } catch (replacementError) {
          if (previous !== null) await Filesystem.writeFile({ path: primaryPath, directory: Directory.Data, data: previous, encoding: Encoding.UTF8 });
          throw replacementError;
        }
        if (!previous) throw renameError;
      }
      const saved = await Filesystem.readFile({ path: primaryPath, directory: Directory.Data, encoding: Encoding.UTF8 });
      if (saved.data !== payload) {
        if (previous !== null) await Filesystem.writeFile({ path: primaryPath, directory: Directory.Data, data: previous, encoding: Encoding.UTF8 });
        throw new Error("Project verification failed after replacement");
      }
      const receipt: ProjectSaveResult = {
        projectId: project.id,
        bytesWritten: new TextEncoder().encode(payload).byteLength,
        modifiedAt: project.modified_at ?? project.updatedAt ?? Date.now(),
        verified: true,
        verification: { primaryReadback: true, backupRotated: previous !== null },
      };
      const fallback = localStorage.getItem("clypra_recent_projects");
      const recentProjects = fallback ? JSON.parse(fallback) : [];
      localStorage.setItem("clypra_recent_projects", JSON.stringify([project, ...recentProjects.filter((p: any) => p.id !== project.id)]));
      return receipt;
    } catch (err) {
      throw new Error(`Failed to persist project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    try {
      const { Filesystem, Directory } = await this.getFilesystem();
      await Filesystem.deleteFile({
        path: `projects/${projectId}.json`,
        directory: Directory.Data,
      });
      await Filesystem.deleteFile({
        path: `projects/${projectId}.json.bak`,
        directory: Directory.Data,
      }).catch(() => undefined);
    } catch (err) {
      localStorage.removeItem(`clypra_project_${projectId}`);
      localStorage.removeItem(`clypra_project_${projectId}_bak`);
    }
  }

  async renameProject(projectId: string, newName: string): Promise<void> {
    // Load, change name, and save
    const content = await this.loadProject(`projects/${projectId}.json`);
    const project = JSON.parse(content);
    project.name = newName;
    project.updatedAt = Date.now();

    await this.saveProject(JSON.stringify(project));
  }

  // ─── HTML5 Media Metadata Extractors ──────────────────────────────────────

  async getMediaMetadata(path: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.src = this.convertFileSrc(path);
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      video.onloadedmetadata = () => {
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          fps: 30, // Fallback guess for web video elements
        });
      };

      video.onerror = () => {
        reject(new Error("Failed to load video metadata"));
      };
    });
  }

  async extractPosterFrame(path: string, duration: number, dpr: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.src = this.convertFileSrc(path);
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;

      // Seek to 5% or 0.5s of the video for the poster
      const seekTime = Math.min(0.5, duration * 0.05);
      video.currentTime = seekTime;

      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth * (dpr || 1);
          canvas.height = video.videoHeight * (dpr || 1);
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas context creation failed"));
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          resolve(dataUrl);
        } catch (e) {
          reject(e);
        }
      };

      video.onerror = () => {
        reject(new Error("Failed to load video frame for poster extraction"));
      };
    });
  }

  async extractAudioArtwork(path: string): Promise<string | undefined> {
    // Native audio artwork reading is not standard in browsers. Return undefined.
    return undefined;
  }

  async saveRecording(fileName: string, data: Uint8Array): Promise<string> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const base64Data = btoa(
      Array.from(data)
        .map((byte) => String.fromCharCode(byte))
        .join(""),
    );
    const writeResult = await Filesystem.writeFile({
      path: `projects/${fileName}`,
      directory: Directory.Data,
      data: base64Data,
    });
    return writeResult.uri;
  }
}
