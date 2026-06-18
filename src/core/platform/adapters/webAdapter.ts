import { PlatformInterface, VideoMetadata, SelectedFile } from "../platform";

export class WebPlatformAdapter implements PlatformInterface {
  type = "web" as const;

  isTauri() {
    return false;
  }
  isCapacitor() {
    return false;
  }
  isWeb() {
    return true;
  }

  convertFileSrc(path: string): string {
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

  // ─── LocalStorage-based Project Storage ─────────────────────────────────────

  async getRecentProjects(): Promise<any[]> {
    const list = localStorage.getItem("clypra_recent_projects");
    return list ? JSON.parse(list) : [];
  }

  async loadProject(path: string): Promise<string> {
    const projectId = path.split("/").pop()?.replace(".json", "") || "";
    const project = localStorage.getItem(`clypra_project_${projectId}`);
    if (project) return project;
    throw new Error(`Project ${projectId} not found in Web storage`);
  }

  async saveProject(payload: string): Promise<void> {
    const project = JSON.parse(payload);
    localStorage.setItem(`clypra_project_${project.id}`, payload);

    // Update recent projects list
    const listStr = localStorage.getItem("clypra_recent_projects");
    const list = listStr ? JSON.parse(listStr) : [];
    const updatedList = list.filter((p: any) => p.id !== project.id);
    updatedList.unshift(project);
    localStorage.setItem("clypra_recent_projects", JSON.stringify(updatedList));
  }

  async deleteProject(projectId: string): Promise<void> {
    localStorage.removeItem(`clypra_project_${projectId}`);
  }

  async renameProject(projectId: string, newName: string): Promise<void> {
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
          fps: 30,
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
    return undefined;
  }
}
