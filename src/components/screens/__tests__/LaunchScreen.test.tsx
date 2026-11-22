import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LaunchScreen } from "../LaunchScreen";
import { useProjectStore } from "@/store/projectStore";
import { useSettingsStore } from "@/store/settingsStore";
import { platform } from "@/core/platform";
import type { RecentProjectEntry } from "@/core/platform/platform";
import { APP_VERSION } from "@/config/version";

// Mock DualRecordService
vi.mock("@/services/dualRecordService", () => ({
  DualRecordService: {
    getInstance: () => ({
      isRecording: () => false,
      enumerateAudioDevices: async () => [
        { deviceId: "mic-1", label: "Built-in Microphone" },
      ],
      enumerateVideoDevices: async () => [
        { deviceId: "cam-1", label: "FaceTime HD Camera" },
      ],
      startPreview: async () => ({ stream: null, cameraError: null }),
      stopPreview: vi.fn(),
      stopScreenPreview: vi.fn(),
      startMicTest: vi.fn(),
      stopMicTest: vi.fn(),
      getMicLevel: () => 0.42,
      cleanup: vi.fn(),
      startRecording: vi.fn(),
    }),
  },
}));

// Mock CameraRecordingModal
vi.mock("@/components/ui/CameraRecordingModal", () => ({
  CameraRecordingModal: () => <div data-testid="camera-recording-modal" />,
}));

describe("LaunchScreen — Redesigned Experience", () => {
  const mockOnProjectCreate = vi.fn();
  const mockOnProjectOpen = vi.fn();

  const sampleRecentProjects: RecentProjectEntry[] = [
    {
      kind: "ready",
      id: "proj-1",
      name: "Summer Vacation Vlog",
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 3600000,
      aspectRatio: "16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 125.5,
      path: "/projects/summer.clypra",
      backupPath: "/backups/summer.bak",
      backupAvailable: true,
      mediaAssets: [
        {
          id: "a1",
          name: "clip1.mp4",
          path: "/clip1.mp4",
          type: "video",
          duration: 60,
          width: 1920,
          height: 1080,
          size: 1000,
        },
      ],
    },
    {
      kind: "ready",
      id: "proj-2",
      name: "TikTok Dance Challenge",
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now() - 86400000,
      aspectRatio: "9:16",
      canvasWidth: 1080,
      canvasHeight: 1920,
      frameRate: 60,
      duration: 45.0,
      path: "/projects/tiktok.clypra",
      backupPath: "/backups/tiktok.bak",
      backupAvailable: false,
    },
    {
      kind: "unreadable",
      id: "proj-corrupt",
      name: "Damaged Podcast Episode",
      path: "/projects/damaged.clypra",
      backupPath: "/backups/damaged.bak",
      backupAvailable: true,
      error: "JSON syntax error at line 1",
      modifiedAt: Date.now() - 172800000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(platform, "getRecentProjects").mockResolvedValue(sampleRecentProjects);
    useSettingsStore.setState({
      uiTheme: "dark",
      theme: "dark",
      clipPalette: "dark",
      defaultFrameRate: 30,
    });
    useProjectStore.setState({
      recentProjects: sampleRecentProjects,
    });
  });

  it("renders the header brand, version, and search input", () => {
    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    expect(screen.getAllByText("Clypra").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(`v${APP_VERSION}`)).toBeDefined();
    expect(screen.getByPlaceholderText("Search projects...")).toBeDefined();
  });

  it("allows switching theme from Dark to Light via the header pill", () => {
    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    const lightBtn = screen.getByLabelText("Light Mode");
    fireEvent.click(lightBtn);
    expect(useSettingsStore.getState().uiTheme).toBe("light");

    const darkBtn = screen.getByLabelText("Dark Mode");
    fireEvent.click(darkBtn);
    expect(useSettingsStore.getState().uiTheme).toBe("dark");
  });

  it("creates a new 16:9 project when clicking the primary New Project button", () => {
    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    const newBtn = screen.getByRole("button", { name: /New Project/i });
    fireEvent.click(newBtn);

    expect(mockOnProjectCreate).toHaveBeenCalledTimes(1);
    expect(mockOnProjectCreate).toHaveBeenCalledWith(
      expect.any(String),
      "16:9",
      30,
    );
  });

  it("creates projects with platform-specific aspect ratios (9:16 Vertical, 1:1 Square, 21:9 Ultra-Wide)", () => {
    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    // 9:16 Vertical starter
    const verticalBtn = screen.getByTitle("Reels • TikTok • Shorts • 1080×1920");
    fireEvent.click(verticalBtn);
    expect(mockOnProjectCreate).toHaveBeenCalledWith(
      expect.any(String),
      "9:16",
      30,
    );

    // 1:1 Square starter
    const squareBtn = screen.getByTitle("Social Feed • Square • 1080×1080");
    fireEvent.click(squareBtn);
    expect(mockOnProjectCreate).toHaveBeenCalledWith(
      expect.any(String),
      "1:1",
      30,
    );

    // 21:9 Ultra-Wide starter
    const ultrawideBtn = screen.getByTitle("Cinematic • Anamorphic • 2560×1080");
    fireEvent.click(ultrawideBtn);
    expect(mockOnProjectCreate).toHaveBeenCalledWith(
      expect.any(String),
      "21:9",
      30,
    );
  });

  it("filters recent projects in real-time based on the search query", () => {
    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    expect(screen.getByText("Summer Vacation Vlog")).toBeDefined();
    expect(screen.getByText("TikTok Dance Challenge")).toBeDefined();

    const searchInput = screen.getByPlaceholderText("Search projects...");
    fireEvent.change(searchInput, { target: { value: "TikTok" } });

    expect(screen.getByText("TikTok Dance Challenge")).toBeDefined();
    expect(screen.queryByText("Summer Vacation Vlog")).toBeNull();
  });

  it("toggles between Grid and List view modes for recent projects", () => {
    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    const listViewBtn = screen.getByLabelText("List View");
    fireEvent.click(listViewBtn);

    // List mode renders timecode and fps chips in compact row
    expect(screen.getByText("Summer Vacation Vlog")).toBeDefined();
    expect(screen.getByText("TikTok Dance Challenge")).toBeDefined();

    const gridViewBtn = screen.getByLabelText("Grid View");
    fireEvent.click(gridViewBtn);

    expect(screen.getByText("Summer Vacation Vlog")).toBeDefined();
  });

  it("opens a project when clicked", () => {
    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    const projectCard = screen.getByText("Summer Vacation Vlog");
    fireEvent.click(projectCard);

    expect(mockOnProjectOpen).toHaveBeenCalledWith(sampleRecentProjects[0]);
  });

  it("shows recovery button for unreadable projects and opens recovered copy", () => {
    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    expect(screen.getByText("Damaged Podcast Episode")).toBeDefined();
    const recoverBtn = screen.getByText("Open recovered copy");
    fireEvent.click(recoverBtn);

    expect(mockOnProjectOpen).toHaveBeenCalledWith(sampleRecentProjects[2]);
  });

  it("opens project templates modal and instantiates selected template", async () => {
    const createFromTemplateSpy = vi
      .spyOn(useProjectStore.getState(), "createProjectFromTemplate")
      .mockResolvedValueOnce();

    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    // Click Templates button in action hub
    const templatesBtn = screen.getByText("Templates");
    fireEvent.click(templatesBtn);

    // Modal should be open with templates
    expect(screen.getByText("Project Templates")).toBeDefined();
    expect(screen.getByText("Reels & TikTok Shorts")).toBeDefined();

    // Click "Use Template" on the first template
    const useBtns = screen.getAllByText("Use Template");
    fireEvent.click(useBtns[0]);

    await waitFor(() => {
      expect(createFromTemplateSpy).toHaveBeenCalledWith("reels-tiktok");
    });
  });

  it("imports media via platform.openFileDialog and starts project with clip paths", async () => {
    const mockFiles = [
      { name: "intro.mp4", path: "/media/intro.mp4", size: 1024 },
      { name: "audio.mp3", path: "/media/audio.mp3", size: 512 },
    ];
    vi.spyOn(platform, "openFileDialog").mockResolvedValueOnce(mockFiles as any);

    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    const importBtn = screen.getByText("Import Media");
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(platform.openFileDialog).toHaveBeenCalled();
      expect(mockOnProjectCreate).toHaveBeenCalledWith(
        expect.any(String),
        "16:9",
        30,
        ["/media/intro.mp4", "/media/audio.mp3"],
      );
    });
  });

  it("displays empty state when there are no recent projects", () => {
    useProjectStore.setState({ recentProjects: [] });

    render(
      <LaunchScreen
        onProjectCreate={mockOnProjectCreate}
        onProjectOpen={mockOnProjectOpen}
      />,
    );

    expect(screen.getByText("No recent projects")).toBeDefined();
    expect(
      screen.getByText("Projects you create or open will be saved here."),
    ).toBeDefined();
    expect(screen.getByText("Create your first project")).toBeDefined();
  });
});
