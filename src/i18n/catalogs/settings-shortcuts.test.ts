import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, test } from "vitest";

import { KeyboardShortcutsSettings } from "@/components/settings/KeyboardShortcutsSettings";
import { settingsMessages } from "@/i18n/catalogs/settings";
import {
  SHORTCUT_ACTION_MESSAGE_KEYS,
  SHORTCUT_CATEGORY_MESSAGE_KEYS,
  formatBinding,
  getShortcutCategories,
  useShortcutStore,
  type KeyBinding,
} from "@/store/shortcutStore";

const CATEGORIES = [
  {
    id: "Transport",
    messageKey: "settings.shortcuts.category.transport",
    en: "Transport",
    zhCN: "播放控制",
  },
  {
    id: "Source Mode",
    messageKey: "settings.shortcuts.category.sourceMode",
    en: "Source Mode",
    zhCN: "源模式",
  },
  {
    id: "Edit",
    messageKey: "settings.shortcuts.category.edit",
    en: "Edit",
    zhCN: "编辑",
  },
  {
    id: "Nudge",
    messageKey: "settings.shortcuts.category.nudge",
    en: "Nudge",
    zhCN: "微调",
  },
  {
    id: "Navigation",
    messageKey: "settings.shortcuts.category.navigation",
    en: "Navigation",
    zhCN: "导航",
  },
  {
    id: "Timeline",
    messageKey: "settings.shortcuts.category.timeline",
    en: "Timeline",
    zhCN: "时间线",
  },
  {
    id: "Track",
    messageKey: "settings.shortcuts.category.track",
    en: "Track",
    zhCN: "轨道",
  },
] as const;

interface ExpectedAction {
  id: keyof typeof SHORTCUT_ACTION_MESSAGE_KEYS;
  messageKey: keyof typeof settingsMessages;
  en: string;
  zhCN: string;
  category: keyof typeof SHORTCUT_CATEGORY_MESSAGE_KEYS;
  binding: KeyBinding;
}

const ACTIONS: ExpectedAction[] = [
  {
    id: "play-pause",
    messageKey: "settings.shortcuts.action.playPause",
    en: "Play / Pause",
    zhCN: "播放 / 暂停",
    category: "Transport",
    binding: { key: "Space" },
  },
  {
    id: "pause",
    messageKey: "settings.shortcuts.action.pause",
    en: "Pause",
    zhCN: "暂停",
    category: "Transport",
    binding: { key: "k" },
  },
  {
    id: "seek-back-frame",
    messageKey: "settings.shortcuts.action.seekBackFrame",
    en: "Step Back One Frame",
    zhCN: "后退一帧",
    category: "Transport",
    binding: { key: "ArrowLeft" },
  },
  {
    id: "seek-forward-frame",
    messageKey: "settings.shortcuts.action.seekForwardFrame",
    en: "Step Forward One Frame",
    zhCN: "前进一帧",
    category: "Transport",
    binding: { key: "ArrowRight" },
  },
  {
    id: "mark-source-in",
    messageKey: "settings.shortcuts.action.markSourceIn",
    en: "Mark In Point (Source)",
    zhCN: "标记源入点",
    category: "Source Mode",
    binding: { key: "i" },
  },
  {
    id: "mark-source-out",
    messageKey: "settings.shortcuts.action.markSourceOut",
    en: "Mark Out Point (Source)",
    zhCN: "标记源出点",
    category: "Source Mode",
    binding: { key: "o" },
  },
  {
    id: "exit-source-mode",
    messageKey: "settings.shortcuts.action.exitSourceMode",
    en: "Exit Source Mode",
    zhCN: "退出源模式",
    category: "Source Mode",
    binding: { key: "Escape" },
  },
  {
    id: "undo",
    messageKey: "settings.shortcuts.action.undo",
    en: "Undo",
    zhCN: "撤销",
    category: "Edit",
    binding: { key: "z", ctrl: true },
  },
  {
    id: "redo",
    messageKey: "settings.shortcuts.action.redo",
    en: "Redo",
    zhCN: "重做",
    category: "Edit",
    binding: { key: "z", ctrl: true, shift: true },
  },
  {
    id: "redo-alt",
    messageKey: "settings.shortcuts.action.redoAlt",
    en: "Redo (Alt)",
    zhCN: "重做（备用）",
    category: "Edit",
    binding: { key: "y", ctrl: true },
  },
  {
    id: "split-at-playhead",
    messageKey: "settings.shortcuts.action.splitAtPlayhead",
    en: "Split at Playhead",
    zhCN: "在播放头处分割",
    category: "Edit",
    binding: { key: "s" },
  },
  {
    id: "split-selected-at-playhead",
    messageKey: "settings.shortcuts.action.splitSelectedAtPlayhead",
    en: "Split Selected at Playhead",
    zhCN: "在播放头处分割所选片段",
    category: "Edit",
    binding: { key: "k", ctrl: true },
  },
  {
    id: "split-all-at-playhead",
    messageKey: "settings.shortcuts.action.splitAllAtPlayhead",
    en: "Split All at Playhead",
    zhCN: "在播放头处分割所有片段",
    category: "Edit",
    binding: { key: "k", ctrl: true, shift: true },
  },
  {
    id: "delete-left-at-playhead",
    messageKey: "settings.shortcuts.action.deleteLeftAtPlayhead",
    en: "Delete Left of Playhead",
    zhCN: "删除播放头左侧内容",
    category: "Edit",
    binding: { key: "q" },
  },
  {
    id: "delete-right-at-playhead",
    messageKey: "settings.shortcuts.action.deleteRightAtPlayhead",
    en: "Delete Right of Playhead",
    zhCN: "删除播放头右侧内容",
    category: "Edit",
    binding: { key: "w" },
  },
  {
    id: "duplicate-clips",
    messageKey: "settings.shortcuts.action.duplicateClips",
    en: "Duplicate Selected Clips",
    zhCN: "创建所选片段副本",
    category: "Edit",
    binding: { key: "d", ctrl: true },
  },
  {
    id: "copy-clips",
    messageKey: "settings.shortcuts.action.copyClips",
    en: "Copy Selected Clips",
    zhCN: "复制所选片段",
    category: "Edit",
    binding: { key: "c", ctrl: true },
  },
  {
    id: "paste-clips",
    messageKey: "settings.shortcuts.action.pasteClips",
    en: "Paste Clips",
    zhCN: "粘贴片段",
    category: "Edit",
    binding: { key: "v", ctrl: true },
  },
  {
    id: "swap-clips",
    messageKey: "settings.shortcuts.action.swapClips",
    en: "Swap Clips",
    zhCN: "交换片段",
    category: "Edit",
    binding: { key: "S", ctrl: true, shift: true },
  },
  {
    id: "select-all",
    messageKey: "settings.shortcuts.action.selectAll",
    en: "Select All Clips",
    zhCN: "选择所有片段",
    category: "Edit",
    binding: { key: "a", ctrl: true },
  },
  {
    id: "deselect-all",
    messageKey: "settings.shortcuts.action.deselectAll",
    en: "Deselect All Clips",
    zhCN: "取消选择所有片段",
    category: "Edit",
    binding: { key: "d", ctrl: true, shift: true },
  },
  {
    id: "clear-selection",
    messageKey: "settings.shortcuts.action.clearSelection",
    en: "Clear Selection",
    zhCN: "清除选择",
    category: "Edit",
    binding: { key: "Escape" },
  },
  {
    id: "nudge-right",
    messageKey: "settings.shortcuts.action.nudgeRight",
    en: "Nudge Right 1 Frame",
    zhCN: "向右微调 1 帧",
    category: "Nudge",
    binding: { key: "]", ctrl: true },
  },
  {
    id: "nudge-left",
    messageKey: "settings.shortcuts.action.nudgeLeft",
    en: "Nudge Left 1 Frame",
    zhCN: "向左微调 1 帧",
    category: "Nudge",
    binding: { key: "[", ctrl: true },
  },
  {
    id: "nudge-right-10",
    messageKey: "settings.shortcuts.action.nudgeRight10",
    en: "Nudge Right 10 Frames",
    zhCN: "向右微调 10 帧",
    category: "Nudge",
    binding: { key: "]", ctrl: true, shift: true },
  },
  {
    id: "nudge-left-10",
    messageKey: "settings.shortcuts.action.nudgeLeft10",
    en: "Nudge Left 10 Frames",
    zhCN: "向左微调 10 帧",
    category: "Nudge",
    binding: { key: "[", ctrl: true, shift: true },
  },
  {
    id: "select-clip-above",
    messageKey: "settings.shortcuts.action.selectClipAbove",
    en: "Select Clip on Track Above",
    zhCN: "选择上方轨道的片段",
    category: "Navigation",
    binding: { key: "ArrowUp", alt: true },
  },
  {
    id: "select-clip-below",
    messageKey: "settings.shortcuts.action.selectClipBelow",
    en: "Select Clip on Track Below",
    zhCN: "选择下方轨道的片段",
    category: "Navigation",
    binding: { key: "ArrowDown", alt: true },
  },
  {
    id: "zoom-in",
    messageKey: "settings.shortcuts.action.zoomIn",
    en: "Zoom In Timeline",
    zhCN: "放大时间线",
    category: "Timeline",
    binding: { key: "=", ctrl: true },
  },
  {
    id: "zoom-out",
    messageKey: "settings.shortcuts.action.zoomOut",
    en: "Zoom Out Timeline",
    zhCN: "缩小时间线",
    category: "Timeline",
    binding: { key: "-", ctrl: true },
  },
  {
    id: "toggle-ripple-edit",
    messageKey: "settings.shortcuts.action.toggleRippleEdit",
    en: "Toggle Ripple Edit",
    zhCN: "切换波纹编辑",
    category: "Timeline",
    binding: { key: "r" },
  },
  {
    id: "add-marker",
    messageKey: "settings.shortcuts.action.addMarker",
    en: "Add Timeline Marker",
    zhCN: "添加时间线标记",
    category: "Timeline",
    binding: { key: "m" },
  },
  {
    id: "toggle-track-lock",
    messageKey: "settings.shortcuts.action.toggleTrackLock",
    en: "Toggle Track Lock",
    zhCN: "切换轨道锁定",
    category: "Track",
    binding: { key: "l", ctrl: true, alt: true },
  },
  {
    id: "toggle-track-visibility",
    messageKey: "settings.shortcuts.action.toggleTrackVisibility",
    en: "Toggle Track Visibility",
    zhCN: "切换轨道可见性",
    category: "Track",
    binding: { key: "v", ctrl: true, alt: true },
  },
  {
    id: "toggle-track-mute",
    messageKey: "settings.shortcuts.action.toggleTrackMute",
    en: "Toggle Track Mute",
    zhCN: "切换轨道静音",
    category: "Track",
    binding: { key: "m", ctrl: true, alt: true },
  },
  {
    id: "pack-track",
    messageKey: "settings.shortcuts.action.packTrack",
    en: "Pack Track (Remove Gaps)",
    zhCN: "整理轨道（移除空隙）",
    category: "Track",
    binding: { key: "p", ctrl: true, alt: true },
  },
  {
    id: "add-track",
    messageKey: "settings.shortcuts.action.addTrack",
    en: "Add New Track",
    zhCN: "添加新轨道",
    category: "Track",
    binding: { key: "t", ctrl: true, alt: true },
  },
];

beforeEach(() => {
  localStorage.clear();
  useShortcutStore.getState().resetAll();
});

describe("keyboard shortcut localization", () => {
  test("provides Chinese display text for every stable category and action", () => {
    const shortcuts = useShortcutStore.getState().shortcuts;

    expect(getShortcutCategories()).toEqual(CATEGORIES.map(({ id }) => id));
    expect(Object.keys(shortcuts)).toEqual(ACTIONS.map(({ id }) => id));

    for (const category of CATEGORIES) {
      expect(SHORTCUT_CATEGORY_MESSAGE_KEYS[category.id]).toBe(
        category.messageKey,
      );
      expect(settingsMessages[category.messageKey]).toEqual({
        en: category.en,
        zhCN: category.zhCN,
      });
    }

    for (const action of ACTIONS) {
      expect(SHORTCUT_ACTION_MESSAGE_KEYS[action.id]).toBe(action.messageKey);
      expect(settingsMessages[action.messageKey]).toEqual({
        en: action.en,
        zhCN: action.zhCN,
      });
      expect(shortcuts[action.id]).toMatchObject({
        id: action.id,
        label: action.en,
        category: action.category,
        defaultBinding: action.binding,
        binding: action.binding,
      });
    }

    render(createElement(KeyboardShortcutsSettings));

    const instructionEsc = screen
      .getAllByText("Esc", { selector: "kbd" })
      .find((element) => element.closest("p"));
    expect(instructionEsc?.closest("p")).toHaveTextContent(
      "点击任意按键组合可重新绑定。按 Esc 取消。",
    );

    for (const category of CATEGORIES) {
      expect(
        screen.getByRole("heading", { name: category.zhCN }),
      ).toBeInTheDocument();
    }
    for (const action of ACTIONS) {
      expect(screen.getByText(action.zhCN)).toBeInTheDocument();
    }
  });

  test("searches translated action and category text with English and key fallbacks", () => {
    render(createElement(KeyboardShortcutsSettings));

    const search = screen.getByRole("textbox", { name: "搜索键盘快捷键" });
    expect(search).toHaveAttribute("placeholder", "搜索快捷键…");

    fireEvent.change(search, { target: { value: "波纹编辑" } });
    expect(screen.getByText("切换波纹编辑")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "时间线" })).toBeInTheDocument();
    expect(screen.queryByText("撤销")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "轨道" } });
    expect(screen.getByRole("heading", { name: "轨道" })).toBeInTheDocument();
    expect(screen.getByText("切换轨道锁定")).toBeInTheDocument();
    expect(screen.getByText("添加新轨道")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "播放控制" }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Undo" } });
    expect(screen.getByText("撤销")).toBeInTheDocument();
    expect(screen.queryByText("重做")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Ctrl Z" } });
    expect(screen.getByText("撤销")).toBeInTheDocument();
    expect(screen.queryByText("重做")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "不存在" } });
    expect(screen.getByText("没有与“不存在”匹配的快捷键")).toBeInTheDocument();
  });

  test("localizes conflict, rebind, reset, and reset-all prompts with action names", () => {
    useShortcutStore.getState().setShortcut("pause", { key: "Space" });
    render(createElement(KeyboardShortcutsSettings));

    expect(screen.getByText("与“暂停”冲突")).toBeInTheDocument();
    expect(screen.getByText("与“播放 / 暂停”冲突")).toBeInTheDocument();

    const rebindUndo = screen.getByRole("button", { name: "重新绑定“撤销”" });
    expect(rebindUndo).toHaveAttribute("title", "点击重新绑定“撤销”");
    fireEvent.click(rebindUndo);

    const capture = screen.getByPlaceholderText("请按下按键…");
    expect(capture).toHaveAttribute("aria-label", "为“撤销”设置快捷键");
    fireEvent.keyDown(capture, { key: "Escape" });
    expect(useShortcutStore.getState().shortcuts.undo.binding).toEqual({
      key: "z",
      ctrl: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "重新绑定“撤销”" }));
    fireEvent.keyDown(screen.getByPlaceholderText("请按下按键…"), {
      key: "x",
      ctrlKey: true,
    });
    expect(useShortcutStore.getState().shortcuts.undo.binding).toEqual({
      key: "x",
      ctrl: true,
    });

    const resetUndo = screen.getByRole("button", {
      name: "将“撤销”重置为默认快捷键",
    });
    expect(resetUndo).toHaveAttribute("title", "将“撤销”重置为默认快捷键");
    fireEvent.click(resetUndo);
    expect(useShortcutStore.getState().shortcuts.undo.binding).toEqual({
      key: "z",
      ctrl: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "重置全部" }));
    expect(screen.getByText("要将所有快捷键重置为默认值吗？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByText("要将所有快捷键重置为默认值吗？"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重置全部" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(useShortcutStore.getState().shortcuts.pause.binding).toEqual({ key: "k" });
  });

  test("persists only stable IDs and key bindings without translated labels", () => {
    useShortcutStore
      .getState()
      .setShortcut("undo", { key: "x", ctrl: true, shift: true });

    const persisted = JSON.parse(localStorage.getItem("clypra-shortcuts") ?? "null");
    expect(Object.keys(persisted.state.shortcuts)).toEqual(
      ACTIONS.map(({ id }) => id),
    );
    expect(persisted.state.shortcuts.undo).toEqual({
      binding: { key: "x", ctrl: true, shift: true },
    });
    expect(JSON.stringify(persisted)).not.toContain("撤销");
    expect(JSON.stringify(persisted)).not.toContain("Undo");

    expect(formatBinding({ key: "Space" })).toBe("Space");
    expect(formatBinding({ key: "Escape" })).toBe("Esc");
    expect(formatBinding({ key: "ArrowLeft" })).toBe("←");
    expect(formatBinding({ key: "z", ctrl: true, shift: true })).toBe(
      "Ctrl Shift Z",
    );
    expect(formatBinding({ key: "ArrowUp", alt: true })).toBe("Alt ↑");
  });
});
