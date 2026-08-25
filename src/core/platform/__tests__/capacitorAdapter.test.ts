import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CapacitorPlatformAdapter } from "../adapters/capacitorAdapter";
import { Filesystem } from "@capacitor/filesystem";

// Mock @capacitor/filesystem
vi.mock("@capacitor/filesystem", () => {
  const files = new Map<string, string>([["projects/project-1.json", JSON.stringify({ id: "project-1", name: "Mock Project", updatedAt: new Date().toISOString() })]]);
  const mockFiles = {
    mkdir: vi.fn().mockResolvedValue({}),
    readdir: vi.fn().mockResolvedValue({
      files: [{ name: "project-1.json" }],
    }),
    readFile: vi.fn(({ path }: { path: string }) => Promise.resolve({ data: files.get(path) ?? "" })),
    writeFile: vi.fn(({ path, data }: { path: string; data: string }) => {
      files.set(path, data);
      return Promise.resolve({});
    }),
    rename: vi.fn(({ from, to }: { from: string; to: string }) => {
      const data = files.get(from);
      if (data !== undefined) files.set(to, data);
      files.delete(from);
      return Promise.resolve();
    }),
    stat: vi.fn(({ path }: { path: string }) => files.has(path) ? Promise.resolve({}) : Promise.reject(new Error("not found"))),
    deleteFile: vi.fn().mockResolvedValue({}),
  };
  return {
    Filesystem: mockFiles,
    Directory: {
      Data: "DATA",
      Documents: "DOCUMENTS",
    },
    Encoding: {
      UTF8: "utf8",
    },
  };
});

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

  it("keeps malformed projects visible as isolated recovery entries", async () => {
    (Filesystem.readdir as any).mockResolvedValueOnce({ files: [{ name: "project-1.json" }, { name: "broken.json" }] });
    const projects = await adapter.getRecentProjects();
    expect(projects).toHaveLength(2);
    expect(projects.some((project: any) => project.kind === "ready" && project.id === "project-1")).toBe(true);
    expect(projects.some((project: any) => project.kind === "unreadable" && project.id === "broken")).toBe(true);
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
      path: "projects/project-2.json.tmp",
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
