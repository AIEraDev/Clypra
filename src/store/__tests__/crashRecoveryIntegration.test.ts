import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../projectStore";
import { useSettingsStore } from "../settingsStore";
import type { Project } from "@/types";

const mockSaveSnapshot = vi.fn(async (_snapshot?: any) => {});
const mockClearSnapshot = vi.fn(async () => {});

vi.mock("@/core/runtime/CrashRecoveryService", () => ({
  saveSnapshot: (snapshot: any) => mockSaveSnapshot(snapshot),
  clearSnapshot: () => mockClearSnapshot(),
  hasSnapshot: vi.fn(async () => false),
  getSnapshot: vi.fn(async () => null),
}));

const mockPlatformSaveProject = vi.fn(async (_payload?: any) => ({
  verified: true,
  path: "/tmp/project.json",
  bytesWritten: 100,
  checksum: "abc",
}));

vi.mock("@/core/platform", () => ({
  platform: {
    saveProject: (payload: any) => mockPlatformSaveProject(payload),
    loadProject: vi.fn(async () => "{}"),
    isTauri: () => false,
  },
}));

vi.mock("@/core/runtime/ProjectSession", () => ({
  disposeActiveSession: vi.fn(),
  createProjectSession: vi.fn(),
}));

describe("Crash Recovery Snapshot Lifecycle & Independence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    useSettingsStore.setState({ autoSave: true });
    useProjectStore.setState({
      project: {
        id: "proj-recovery-test",
        name: "Recovery Test Project",
        createdAt: 1000,
        updatedAt: 1000,
        aspectRatio: "16:9" as any,
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        duration: 10,
        timelineSchemaVersion: 1,
        audioModelVersion: 1,
      } as Project,
      mediaAssets: [],
      isDirty: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists crash recovery snapshot to IndexedDB even when autoSave is disabled in settings", async () => {
    // User disables auto-save to file
    useSettingsStore.setState({ autoSave: false });

    // An edit occurs
    useProjectStore.getState().scheduleAutoSave();

    // Fast-forward past crash recovery debounce (250ms)
    await vi.advanceTimersByTimeAsync(300);

    // IndexedDB snapshot must be written to protect against crashes
    await vi.waitFor(() => {
      expect(mockSaveSnapshot).toHaveBeenCalledTimes(1);
    });
    const calls = mockSaveSnapshot.mock.calls as any[][];
    const savedArg = calls[0]?.[0];
    expect(savedArg?.project?.id).toBe("proj-recovery-test");

    // Filesystem write must NOT have occurred (honoring autoSave: false)
    expect(mockPlatformSaveProject).not.toHaveBeenCalled();
  });

  it("flushes snapshot at the 1000ms max-wait ceiling during continuous rapid mutations", async () => {
    // Simulate continuous mutations every 100ms (shorter than 250ms debounce)
    for (let i = 0; i < 11; i++) {
      useProjectStore.getState().scheduleAutoSave();
      await vi.advanceTimersByTimeAsync(100);
    }

    // At 1000ms ceiling, crash recovery must force a snapshot write
    await vi.waitFor(() => {
      expect(mockSaveSnapshot).toHaveBeenCalled();
    });
  });

  it("updates crash recovery snapshot in IndexedDB upon manual saveCurrentProject", async () => {
    const result = await useProjectStore.getState().saveCurrentProject();
    expect(result?.verified).toBe(true);

    // Wait a tick for microtask / async flush
    await vi.advanceTimersByTimeAsync(50);

    expect(mockSaveSnapshot).toHaveBeenCalled();
    const calls = mockSaveSnapshot.mock.calls as any[][];
    const saved = calls[0]?.[0];
    expect(saved?.project?.id).toBe("proj-recovery-test");
  });

  it("clears crash recovery snapshot and cancels pending timers on clean project close", async () => {
    // Trigger mutation
    useProjectStore.getState().scheduleAutoSave();

    // Close project cleanly before debounce timer expires
    await useProjectStore.getState().closeProject();

    expect(mockClearSnapshot).toHaveBeenCalled();

    // Advance time past debounce; verify no lingering snapshot writes execute
    mockSaveSnapshot.mockClear();
    await vi.advanceTimersByTimeAsync(500);
    expect(mockSaveSnapshot).not.toHaveBeenCalled();
  });
});
