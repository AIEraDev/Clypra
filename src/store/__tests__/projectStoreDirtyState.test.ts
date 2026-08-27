import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../projectStore";
import type { Project } from "@/types";

vi.mock("@/core/runtime/ProjectSession", () => ({
  disposeActiveSession: vi.fn(),
  createProjectSession: vi.fn(),
}));

vi.mock("@/core/platform", () => ({
  platform: {
    saveProject: vi.fn(async () => ({
      verified: true,
      path: "/tmp/mock-project.json",
      bytesWritten: 1234,
      checksum: "abc",
    })),
    loadProject: vi.fn(async () => "{}"),
    isTauri: () => false,
  },
}));

describe("projectStore — Dirty State and Unsaved Changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      project: null,
      mediaAssets: [],
      isDirty: false,
    });
  });

  it("initializes with isDirty: false and hasUnsavedChanges: false", () => {
    const store = useProjectStore.getState();
    expect(store.isDirty).toBe(false);
    expect(store.hasUnsavedChanges()).toBe(false);
  });

  it("marks isDirty: true when scheduleAutoSave is invoked", () => {
    const store = useProjectStore.getState();
    store.scheduleAutoSave();
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(useProjectStore.getState().hasUnsavedChanges()).toBe(true);
  });

  it("resets isDirty: false upon successful saveCurrentProject", async () => {
    const mockProject: Project = {
      id: "proj-1",
      name: "Test Proj",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      aspectRatio: "16:9" as any,
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 10,
      timelineSchemaVersion: 1,
      audioModelVersion: 1,
    };

    useProjectStore.setState({ project: mockProject, isDirty: true });
    expect(useProjectStore.getState().hasUnsavedChanges()).toBe(true);

    const result = await useProjectStore.getState().saveCurrentProject();
    expect(result?.verified).toBe(true);
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(useProjectStore.getState().hasUnsavedChanges()).toBe(false);
  });

  it("resets isDirty: false when project is closed", async () => {
    useProjectStore.setState({
      project: { id: "p1", name: "P1" } as any,
      isDirty: true,
    });

    await useProjectStore.getState().closeProject();
    expect(useProjectStore.getState().project).toBeNull();
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(useProjectStore.getState().hasUnsavedChanges()).toBe(false);
  });
});
