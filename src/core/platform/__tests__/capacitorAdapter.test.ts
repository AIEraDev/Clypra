import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CapacitorPlatformAdapter } from "../adapters/capacitorAdapter";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// Mock @capacitor/filesystem
vi.mock("@capacitor/filesystem", () => {
  const mockFiles = {
    mkdir: vi.fn().mockResolvedValue({}),
    readdir: vi.fn().mockResolvedValue({
      files: [{ name: "project-1.json" }],
    }),
    readFile: vi.fn().mockResolvedValue({
      data: JSON.stringify({ id: "project-1", name: "Mock Project", updatedAt: new Date().toISOString() }),
    }),
    writeFile: vi.fn().mockResolvedValue({ uri: "file:///cache/Client H.265 final.mp4" }),
    deleteFile: vi.fn().mockResolvedValue({}),
  };
  return {
    Filesystem: mockFiles,
    Directory: {
      Data: "DATA",
      Documents: "DOCUMENTS",
      Cache: "CACHE",
    },
    Encoding: {
      UTF8: "utf8",
    },
  };
});

vi.mock("@capacitor/share", () => ({
  Share: {
    share: vi.fn().mockResolvedValue({}),
  },
}));

describe("CapacitorPlatformAdapter", () => {
  let adapter: CapacitorPlatformAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    adapter = new CapacitorPlatformAdapter();
  });

  it("should report platform flags correctly", () => {
    expect(adapter.isCapacitor()).toBe(true);
    expect(adapter.isTauri()).toBe(false);
  });

  it("should localize the share title while preserving the filename and URL", async () => {
    const filename = "Client H.265 final.mp4";
    const uri = "file:///cache/Client H.265 final.mp4";

    await expect(adapter.saveAndShareVideo(new Blob(["video"]), filename)).resolves.toBe(uri);
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: filename,
      data: expect.any(String),
      directory: "CACHE",
    });
    expect(Share.share).toHaveBeenCalledWith({
      url: uri,
      title: "导出视频",
    });
  });

  it("should convert file paths using window.Capacitor if available", () => {
    const originalCapacitor = (window as any).Capacitor;
    (window as any).Capacitor = {
      convertFileSrc: vi.fn((path: string) => `safe-scheme://${path}`),
    };

    const converted = adapter.convertFileSrc("assets/video.mp4");
    expect(converted).toBe("safe-scheme://assets/video.mp4");
    expect((window as any).Capacitor.convertFileSrc).toHaveBeenCalledWith("assets/video.mp4");

    // Clean up
    (window as any).Capacitor = originalCapacitor;
  });

  it("should fetch recent projects from Filesystem", async () => {
    const projects = await adapter.getRecentProjects();
    expect(projects.length).toBe(1);
    expect(projects[0].id).toBe("project-1");
    expect(Filesystem.readdir).toHaveBeenCalledWith({
      path: "projects",
      directory: "DATA",
    });
  });

  it("should load project content by path", async () => {
    const data = await adapter.loadProject("projects/project-1.json");
    const parsed = JSON.parse(data);
    expect(parsed.id).toBe("project-1");
    expect(Filesystem.readFile).toHaveBeenCalledWith({
      path: "projects/project-1.json",
      directory: "DATA",
      encoding: "utf8",
    });
  });

  it("should save project state into JSON file in projects directory", async () => {
    const payload = JSON.stringify({ id: "project-2", name: "New Project" });
    await adapter.saveProject(payload);

    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: "projects/project-2.json",
      directory: "DATA",
      data: payload,
      encoding: "utf8",
    });
  });

  it("should delete a project file by id", async () => {
    await adapter.deleteProject("project-1");
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({
      path: "projects/project-1.json",
      directory: "DATA",
    });
  });
});
