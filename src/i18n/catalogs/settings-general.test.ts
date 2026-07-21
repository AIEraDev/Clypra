import { afterEach, describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
import * as settingsStoreModule from "@/store/settingsStore";
import {
  FONT_META,
  THEME_META,
  getThemeColors,
  useSettingsStore,
} from "@/store/settingsStore";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  test("rejects unknown, array, non-string, and invalid theme colors", () => {
    const sanitizeThemeColors = (
      settingsStoreModule as typeof settingsStoreModule & {
        sanitizeThemeColors?: (value: unknown) => Record<string, string> | null;
      }
    ).sanitizeThemeColors;

    expect(sanitizeThemeColors?.({ display: "none" })).toBeNull();
    expect(sanitizeThemeColors?.(["#ffffff"])).toBeNull();
    expect(sanitizeThemeColors?.({ "--color-bg": 42 })).toBeNull();
    expect(sanitizeThemeColors?.({ "--color-bg": "display:none" })).toBeNull();
  });

  test("preserves valid colors for known editable theme tokens", () => {
    const sanitizeThemeColors = (
      settingsStoreModule as typeof settingsStoreModule & {
        sanitizeThemeColors?: (value: unknown) => Record<string, string> | null;
      }
    ).sanitizeThemeColors;
    const validColors = {
      "--color-bg": "#123456",
      "--color-accent": "rgba(12, 34, 56, 0.5)",
      "--ring": "rebeccapurple",
    };

    expect(sanitizeThemeColors?.(validColors)).toEqual(validColors);
  });

  test("fills omitted custom theme tokens from a deterministic dark base", () => {
    const customColors = getThemeColors("custom", {
      "--color-bg": "#123456",
    });

    expect(customColors["--color-bg"]).toBe("#123456");
    expect(customColors["--color-surface"]).toBe(
      getThemeColors("dark")["--color-surface"],
    );
  });

  test("sanitizes corrupted persisted settings through the configured merge", () => {
    const mergePersistedSettings = (
      settingsStoreModule as typeof settingsStoreModule & {
        mergePersistedSettings?: (
          persistedState: unknown,
          currentState: ReturnType<typeof useSettingsStore.getState>,
        ) => ReturnType<typeof useSettingsStore.getState>;
      }
    ).mergePersistedSettings;
    const currentState = useSettingsStore.getState();

    expect(typeof mergePersistedSettings).toBe("function");
    expect(useSettingsStore.persist.getOptions().merge).toBe(
      mergePersistedSettings,
    );

    const merged = mergePersistedSettings?.(
      {
        theme: "display:none",
        fontFamily: "url(javascript:alert(1))",
        customTheme: {
          "--color-bg": "#123456",
          display: "none",
        },
      },
      currentState,
    );

    expect(merged).toMatchObject({
      theme: "dark",
      fontFamily: "inter",
      customTheme: null,
    });
  });

  test("keeps a valid custom theme during persisted-state merge", () => {
    const mergePersistedSettings = (
      settingsStoreModule as typeof settingsStoreModule & {
        mergePersistedSettings?: (
          persistedState: unknown,
          currentState: ReturnType<typeof useSettingsStore.getState>,
        ) => ReturnType<typeof useSettingsStore.getState>;
      }
    ).mergePersistedSettings;
    const validColors = { "--color-bg": "#123456" };

    const merged = mergePersistedSettings?.(
      {
        theme: "custom",
        fontFamily: "space-grotesk",
        customTheme: validColors,
      },
      useSettingsStore.getState(),
    );

    expect(merged).toMatchObject({
      theme: "custom",
      fontFamily: "space-grotesk",
      customTheme: validColors,
    });
  });

  test("rejects a malformed imported theme without mutating editor or store state", async () => {
    useSettingsStore.setState({ theme: "dark", customTheme: null });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, "files", {
        configurable: true,
        value: [
          {
            text: async () =>
              JSON.stringify({ colors: { display: "none" } }),
          },
        ],
      });
      this.dispatchEvent(new Event("change"));
    });

    render(createElement(SettingsModal, { isOpen: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "自定义主题" }));
    fireEvent.click(screen.getByRole("button", { name: "导入" }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("主题文件格式无效");
    });
    expect(screen.queryByText("display")).not.toBeInTheDocument();
    expect(useSettingsStore.getState()).toMatchObject({
      theme: "dark",
      customTheme: null,
    });
  });

  test("gives every theme color control a unique translated accessible name", () => {
    const { container } = render(
      createElement(SettingsModal, { isOpen: true, onClose: vi.fn() }),
    );
    fireEvent.click(screen.getByRole("button", { name: "自定义主题" }));

    const ringPicker = screen.getByLabelText(
      "焦点环（--ring）颜色选择器",
    );
    const ringValue = screen.getByLabelText("焦点环（--ring）颜色值");
    const visibleRingLabel = screen.getByText("焦点环");
    const colorControls = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[type="color"][id], input[type="text"][id]',
      ),
    );

    expect(ringPicker.id).not.toBe("");
    expect(ringValue.id).not.toBe("");
    expect(visibleRingLabel).toHaveAttribute("for", ringValue.id);
    expect(colorControls.length).toBeGreaterThan(0);
    expect(new Set(colorControls.map((input) => input.id)).size).toBe(
      colorControls.length,
    );
    const accessibleNames = colorControls.map((input) =>
      input.getAttribute("aria-label"),
    );
    expect(new Set(accessibleNames).size).toBe(colorControls.length);
    for (const input of colorControls) {
      expect(input).toHaveAccessibleName();
    }
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
