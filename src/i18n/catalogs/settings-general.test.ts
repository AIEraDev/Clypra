import { describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/features/audio-library/store/audioLibraryStore", () => ({
  useAudioLibraryStore: () => ({
    getCacheStats: () => ({ count: 0, totalSize: 0, items: [] }),
    clearAllCache: vi.fn(),
  }),
}));

vi.mock("@/features/text-effects/cache/cacheManager", () => ({
  TextEffectsCacheManager: {
    getStats: vi.fn(),
    clearAll: vi.fn(),
  },
}));

vi.mock("@/components/settings/WhisperSettings", () => ({
  WhisperSettings: () => null,
}));

vi.mock("@/components/settings/KeyboardShortcutsSettings", () => ({
  KeyboardShortcutsSettings: () => null,
}));

import packageJson from "../../../package.json";
import {
  localizeCacheErrorDetail,
  localizeCacheResultMessage,
} from "@/components/settings/CacheSettings";
import { SettingsModal } from "@/components/ui/SettingsModal";
import { t } from "@/i18n";
import { settingsMessages } from "@/i18n/catalogs/settings";
import {
  FONT_META,
  THEME_META,
  getThemeColors,
} from "@/store/settingsStore";

describe("general settings localization", () => {
  test("translates settings tabs and general editor labels", () => {
    expect(t("settings.title")).toBe("设置");
    expect(t("settings.tabs.appearance")).toBe("外观");
    expect(t("settings.tabs.editor")).toBe("编辑器");
    expect(t("settings.tabs.cache")).toBe("存储与缓存");
    expect(t("settings.tabs.about")).toBe("关于");
    expect(t("settings.editor.snapToGrid")).toBe("吸附到网格");
    expect(t("settings.editor.defaultFrameRate")).toBe("默认帧率");
  });

  test("translates theme names, descriptions, and editor labels", () => {
    expect(t("settings.appearance.theme")).toBe("主题");
    expect(t("settings.theme.midnightCarbon.name")).toBe("深夜碳色");
    expect(t("settings.theme.midnightCarbon.description")).toBe(
      "专业广播级的冷峻精准风格",
    );
    expect(t("settings.theme.editor.searchPlaceholder")).toBe("搜索颜色…");
    expect(t("settings.theme.color.timelineBackground")).toBe("时间线背景");
  });

  test("translates cache categories and dynamic values", () => {
    expect(t("settings.cache.management.title")).toBe("缓存管理");
    expect(t("settings.cache.textEffects.title")).toBe("文字效果缓存");
    expect(t("settings.cache.audio.title")).toBe("音频库缓存");
    expect(t("settings.cache.itemCount", { count: 17 })).toBe("17 项");
    expect(t("settings.cache.effectCount", { count: 4 })).toBe("4 个效果");
    expect(t("settings.cache.sizeMB", { size: "12.50" })).toBe("12.50 MB");
    expect(t("settings.cache.clearedWithErrors", { count: 2 })).toBe(
      "缓存已清理，但发生 2 个错误",
    );
  });

  test("wraps cache failures while preserving raw technical detail", () => {
    const detail = "EBWebView: Access is denied (os error 5)";

    expect(t("settings.cache.clearFailed", { cache: "WebView", error: detail })).toBe(
      `清理 WebView 缓存失败：${detail}`,
    );
    expect(t("settings.cache.errorDetail.app", { error: detail })).toBe(
      `应用缓存：${detail}`,
    );
  });

  test("localizes cache-manager status strings at the UI boundary", () => {
    const detail = "Access is denied (os error 5)";

    expect(localizeCacheResultMessage("All caches cleared successfully!")).toBe(
      "所有缓存已成功清理！",
    );
    expect(localizeCacheResultMessage("Cleared with 3 error(s)")).toBe(
      "缓存已清理，但发生 3 个错误",
    );
    expect(
      localizeCacheResultMessage(`Failed to clear WebView cache: ${detail}`),
    ).toBe(`清理 WebView 缓存失败：${detail}`);
    expect(localizeCacheErrorDetail(`App cache: ${detail}`)).toBe(
      `应用缓存：${detail}`,
    );
  });

  test("renders the About version from package metadata", () => {
    render(createElement(SettingsModal, { isOpen: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "关于" }));

    expect(screen.getByText(`版本 ${packageJson.version}`)).toBeInTheDocument();
  });

  test("searches theme colors by their translated labels", () => {
    render(createElement(SettingsModal, { isOpen: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "自定义主题" }));
    fireEvent.change(screen.getByPlaceholderText("搜索颜色…"), {
      target: { value: "焦点环" },
    });

    expect(screen.getByText("焦点环")).toBeInTheDocument();
    expect(screen.queryByText("主文本")).not.toBeInTheDocument();
  });

  test("keeps persisted and technical values unchanged", () => {
    expect(Object.keys(THEME_META)).toEqual([
      "dark",
      "midnight",
      "ocean",
      "forest",
      "midnight-carbon",
      "ember-studio",
      "forest-console",
      "slate-noir",
      "rose-cut",
      "custom",
    ]);
    expect(getThemeColors("dark")["--color-bg"]).toBe("#0f0f0f");
    expect(FONT_META.inter.name).toBe("Inter");
    expect(FONT_META["space-grotesk"].stack).toBe(
      '"Space Grotesk Variable", sans-serif',
    );
  });

  test("defines non-empty English and Simplified Chinese for every setting", () => {
    for (const message of Object.values(settingsMessages)) {
      expect(message.en.trim()).not.toBe("");
      expect(message.zhCN.trim()).not.toBe("");
    }
  });
});
