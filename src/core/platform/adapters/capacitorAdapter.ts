import { PlatformInterface, VideoMetadata, SelectedFile } from "../platform";

export class CapacitorPlatformAdapter implements PlatformInterface {
  type = "capacitor" as const;

  isTauri() {
    return false;
  }
  isCapacitor() {
    return true;
  }
  isWeb() {
    return false;
  }

  convertFileSrc(path: string): string {
    if (typeof window !== "undefined" && (window as any).Capacitor) {
      return (window as any).Capacitor.convertFileSrc(path);
    }
    return path;
  }

  async appDataDir(): Promise<string> {
    return "projects";
  }

  async joinPaths(...paths: string[]): Promise<string> {
    return paths.filter(Boolean).join("/");
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

  async getRecentProjects(): Promise<any[]> {
    try {
      const { Filesystem, Directory, Encoding } = await this.getFilesystem();

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

      const projects: any[] = [];
      for (const file of filesResult.files) {
        if (file.name.endsWith(".json")) {
          try {
            const readResult = await Filesystem.readFile({
              path: `projects/${file.name}`,
              directory: Directory.Data,
              encoding: Encoding.UTF8,
            });
            if (typeof readResult.data === "string") {
              projects.push(JSON.parse(readResult.data));
            }
          } catch (e) {
            console.error("Failed to read project file:", file.name, e);
          }
        }
      }

      // Sort by updatedAt descending
      return projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch (err) {
      console.warn("Failed to read projects from Capacitor Filesystem, falling back to localStorage", err);
      const fallback = localStorage.getItem("clypra_recent_projects");
      return fallback ? JSON.parse(fallback) : [];
    }
  }

  async loadProject(path: string): Promise<string> {
    try {
      const { Filesystem, Directory, Encoding } = await this.getFilesystem();
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
      // LocalStorage fallback for debug
      const projectId = path.split("/").pop()?.replace(".json", "") || "";
      const project = localStorage.getItem(`clypra_project_${projectId}`);
      if (project) return project;
      throw err;
    }
  }

  async saveProject(payload: string): Promise<void> {
    try {
      const project = JSON.parse(payload);
      const { Filesystem, Directory, Encoding } = await this.getFilesystem();

      // Save project payload
      await Filesystem.writeFile({
        path: `projects/${project.id}.json`,
        directory: Directory.Data,
        data: payload,
        encoding: Encoding.UTF8,
      });

      // Update recent projects list in localStorage
      const fallback = localStorage.getItem("clypra_recent_projects");
      const recentProjects = fallback ? JSON.parse(fallback) : [];
      const updatedList = recentProjects.filter((p: any) => p.id !== project.id);
      updatedList.unshift(project);
      localStorage.setItem("clypra_recent_projects", JSON.stringify(updatedList));
    } catch (err) {
      console.warn("Capacitor Filesystem save failed, saving to localStorage:", err);
      const project = JSON.parse(payload);
      localStorage.setItem(`clypra_project_${project.id}`, payload);

      const fallback = localStorage.getItem("clypra_recent_projects");
      const recentProjects = fallback ? JSON.parse(fallback) : [];
      const updatedList = recentProjects.filter((p: any) => p.id !== project.id);
      updatedList.unshift(project);
      localStorage.setItem("clypra_recent_projects", JSON.stringify(updatedList));
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    try {
      const { Filesystem, Directory } = await this.getFilesystem();
      await Filesystem.deleteFile({
        path: `projects/${projectId}.json`,
        directory: Directory.Data,
      });
    } catch (err) {
      localStorage.removeItem(`clypra_project_${projectId}`);
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
}
