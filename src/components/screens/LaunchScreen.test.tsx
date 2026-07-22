import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { setLanguage } from "@/i18n";
import { LaunchScreen } from "./LaunchScreen";

const projectStoreMock = vi.hoisted(() => ({
  recentProjects: [] as Array<Record<string, unknown>>,
  setRecentProjects: vi.fn(),
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
}));

const createRecentProject = (createdAt: number | string = Date.now()) => ({
  id: "project-1",
  name: "客户项目",
  createdAt,
  aspectRatio: "16:9",
  mediaAssets: [],
});

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/Modal", () => ({
  Modal: () => null,
}));

vi.mock("@/store/projectStore", () => ({
  useProjectStore: () => projectStoreMock,
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
  beforeEach(() => {
    projectStoreMock.recentProjects = [createRecentProject()];
    vi.clearAllMocks();
  });

  afterEach(() => {
    setLanguage("zhCN");
    vi.useRealTimers();
  });

  test("renders sibling native project and options actions with disclosure semantics", async () => {
    const user = userEvent.setup();
    const onProjectOpen = vi.fn();

    render(
      <LaunchScreen
        onProjectCreate={vi.fn()}
        onProjectOpen={onProjectOpen}
      />,
    );

    const projectButton = screen.getByRole("button", { name: /客户项目/ });
    const optionsButton = screen.getByRole("button", { name: "更多选项" });
    expect(projectButton.tagName).toBe("BUTTON");
    expect(projectButton).not.toContainElement(optionsButton);
    expect(optionsButton).toHaveAttribute("type", "button");
    expect(optionsButton).toHaveAttribute("aria-expanded", "false");
    expect(optionsButton).not.toHaveAttribute("aria-haspopup");
    expect(optionsButton).toHaveAttribute("aria-controls", "project-options-project-1");
    expect(optionsButton.parentElement).toHaveClass("group-focus-within:opacity-100");

    await user.click(optionsButton);

    expect(optionsButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const dropdown = document.getElementById("project-options-project-1");
    expect(dropdown).toBeInTheDocument();
    const renameButton = within(dropdown!).getByRole("button", { name: "重命名" });
    const deleteButton = within(dropdown!).getByRole("button", { name: "删除" });
    expect(renameButton).not.toHaveAttribute("role");
    expect(deleteButton).not.toHaveAttribute("role");
    expect(onProjectOpen).not.toHaveBeenCalled();
  });

  test("tabs to the project action before its options action", async () => {
    const user = userEvent.setup();

    render(
      <LaunchScreen
        onProjectCreate={vi.fn()}
        onProjectOpen={vi.fn()}
      />,
    );

    const projectButton = screen.getByRole("button", { name: /客户项目/ });
    const optionsButton = screen.getByRole("button", { name: "更多选项" });

    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(projectButton).toHaveFocus();

    await user.tab();
    expect(optionsButton).toHaveFocus();
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
      await user.tab();
      await user.tab();
      await user.tab();
      await user.tab();
      await user.tab();
      expect(optionsButton).toHaveFocus();

      await user.keyboard(key);

      expect(document.getElementById("project-options-project-1")).toBeInTheDocument();
      expect(onProjectOpen).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["the same local day", new Date(2026, 6, 21, 0, 15).getTime(), "今天"],
    ["yesterday across midnight", new Date(2026, 6, 20, 23, 45).getTime(), "昨天"],
    ["four local days ago", new Date(2026, 6, 17, 23, 45).getTime(), "4 天前"],
    ["a future date", new Date(2026, 6, 22, 0, 30).getTime(), "今天"],
    ["an invalid timestamp", "not-a-date", "日期未知"],
  ])("formats %s safely", (_caseName, createdAt, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 0, 30));
    projectStoreMock.recentProjects = [createRecentProject(createdAt)];

    render(
      <LaunchScreen
        onProjectCreate={vi.fn()}
        onProjectOpen={vi.fn()}
      />,
    );

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  test("formats older project dates in the selected interface language", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));
    projectStoreMock.recentProjects = [
      createRecentProject(new Date(2026, 6, 8, 12).getTime()),
    ];

    render(
      <LaunchScreen
        onProjectCreate={vi.fn()}
        onProjectOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("2026年7月8日")).toBeInTheDocument();

    act(() => setLanguage("en"));

    expect(screen.getByText("Jul 8, 2026")).toBeInTheDocument();
  });
});
