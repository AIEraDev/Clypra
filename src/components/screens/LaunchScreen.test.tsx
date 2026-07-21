import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { LaunchScreen } from "./LaunchScreen";

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/Modal", () => ({
  Modal: () => null,
}));

vi.mock("@/store/projectStore", () => ({
  useProjectStore: () => ({
    recentProjects: [
      {
        id: "project-1",
        name: "客户项目",
        createdAt: Date.now(),
        aspectRatio: "16:9",
        mediaAssets: [],
      },
    ],
    setRecentProjects: vi.fn(),
    deleteProject: vi.fn(),
    renameProject: vi.fn(),
  }),
}));

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ defaultFrameRate: 30 }),
  },
}));

vi.mock("@/store/uiStore", () => ({
  useUIStore: () => ({ toggleSettingsModal: vi.fn() }),
}));

vi.mock("@/store/recordingStore", () => ({
  useRecordingStore: () => ({
    isRecording: false,
    setIsRecording: vi.fn(),
    seconds: 0,
    setSeconds: vi.fn(),
    setHasWebcam: vi.fn(),
    setRecordingError: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/core/platform", () => ({
  platform: {
    getRecentProjects: vi.fn().mockResolvedValue([]),
    isCapacitor: () => true,
  },
}));

vi.mock("@/services/dualRecordService", () => ({
  DualRecordService: {
    getInstance: () => ({
      isRecording: () => false,
      cleanup: vi.fn(),
    }),
  },
}));

describe("LaunchScreen", () => {
  test("renders the project options trigger as an accessible button", async () => {
    const user = userEvent.setup();
    const onProjectOpen = vi.fn();

    render(
      <LaunchScreen
        onProjectCreate={vi.fn()}
        onProjectOpen={onProjectOpen}
      />,
    );

    const optionsButton = screen.getByRole("button", { name: "更多选项" });
    expect(optionsButton).toHaveAttribute("type", "button");

    await user.click(optionsButton);

    expect(screen.getByRole("button", { name: "重命名" })).toBeInTheDocument();
    expect(onProjectOpen).not.toHaveBeenCalled();
  });

  test.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])(
    "opens project options with %s without opening the project",
    async (_keyName, key) => {
      const user = userEvent.setup();
      const onProjectOpen = vi.fn();

      render(
        <LaunchScreen
          onProjectCreate={vi.fn()}
          onProjectOpen={onProjectOpen}
        />,
      );

      const optionsButton = screen.getByRole("button", { name: "更多选项" });
      optionsButton.focus();
      await user.keyboard(key);

      expect(screen.getByRole("button", { name: "重命名" })).toBeInTheDocument();
      expect(onProjectOpen).not.toHaveBeenCalled();
    },
  );
});
