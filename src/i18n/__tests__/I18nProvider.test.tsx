import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { I18nProvider, useI18n, SUPPORTED_LANGUAGES, translateText, AppLanguage } from "../I18nProvider";

function TestMultiLanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div>
      <span data-testid="title">Settings</span>
      <span data-testid="timeline-title">Timeline</span>
      <span data-testid="export-title">Export</span>
      <span data-testid="t-helper">{t("Timeline")}</span>
      <span data-testid="lang-display">{language}</span>
      <span data-testid="untouched" data-no-i18n>Settings</span>
      <input data-testid="search-input" placeholder="Search" title="Search" aria-label="Search" />

      {SUPPORTED_LANGUAGES.map((lang) => (
        <button key={lang.code} data-testid={`btn-${lang.code}`} onClick={() => setLanguage(lang.code)}>
          Switch to {lang.name}
        </button>
      ))}
    </div>
  );
}

describe("I18nProvider — Multi-Language Switching & Localization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("switches language to Traditional Chinese and back to English immediately", async () => {
    render(
      <I18nProvider>
        <TestMultiLanguageSwitcher />
      </I18nProvider>
    );

    const titleEl = screen.getByTestId("title");
    const toZhBtn = screen.getByTestId("btn-zh-TW");
    const toEnBtn = screen.getByTestId("btn-en");

    expect(titleEl.textContent).toBe("Settings");

    // Switch to Traditional Chinese
    act(() => {
      toZhBtn.click();
    });

    expect(titleEl.textContent).toBe("設定");
    expect(screen.getByTestId("lang-display").textContent).toBe("zh-TW");

    // Switch back to English
    act(() => {
      toEnBtn.click();
    });

    expect(titleEl.textContent).toBe("Settings");
    expect(screen.getByTestId("lang-display").textContent).toBe("en");
  });

  it("switches language to Russian (feature request) and back to English cleanly", async () => {
    render(
      <I18nProvider>
        <TestMultiLanguageSwitcher />
      </I18nProvider>
    );

    const titleEl = screen.getByTestId("title");
    const timelineEl = screen.getByTestId("timeline-title");
    const exportEl = screen.getByTestId("export-title");
    const toRuBtn = screen.getByTestId("btn-ru");
    const toEnBtn = screen.getByTestId("btn-en");

    expect(titleEl.textContent).toBe("Settings");
    expect(timelineEl.textContent).toBe("Timeline");
    expect(exportEl.textContent).toBe("Export");

    // Switch to Russian
    act(() => {
      toRuBtn.click();
    });

    expect(titleEl.textContent).toBe("Настройки");
    expect(timelineEl.textContent).toBe("Таймлайн");
    expect(exportEl.textContent).toBe("Экспорт");
    expect(screen.getByTestId("lang-display").textContent).toBe("ru");
    expect(localStorage.getItem("clypra.language")).toBe("ru");

    // Switch back to English
    act(() => {
      toEnBtn.click();
    });

    expect(titleEl.textContent).toBe("Settings");
    expect(timelineEl.textContent).toBe("Timeline");
    expect(exportEl.textContent).toBe("Export");
    expect(screen.getByTestId("lang-display").textContent).toBe("en");
    expect(localStorage.getItem("clypra.language")).toBe("en");
  });

  it("switches correctly through all newly supported languages (Spanish, Japanese, German, French, Korean)", async () => {
    render(
      <I18nProvider>
        <TestMultiLanguageSwitcher />
      </I18nProvider>
    );

    const titleEl = screen.getByTestId("title");
    const timelineEl = screen.getByTestId("timeline-title");

    // Spanish
    act(() => {
      screen.getByTestId("btn-es").click();
    });
    expect(titleEl.textContent).toBe("Ajustes");
    expect(timelineEl.textContent).toBe("Línea de tiempo");

    // Japanese
    act(() => {
      screen.getByTestId("btn-ja").click();
    });
    expect(titleEl.textContent).toBe("設定");
    expect(timelineEl.textContent).toBe("タイムライン");

    // German
    act(() => {
      screen.getByTestId("btn-de").click();
    });
    expect(titleEl.textContent).toBe("Einstellungen");
    expect(timelineEl.textContent).toBe("Zeitleiste");

    // French
    act(() => {
      screen.getByTestId("btn-fr").click();
    });
    expect(titleEl.textContent).toBe("Paramètres");
    expect(timelineEl.textContent).toBe("Ligne de temps");

    // Korean
    act(() => {
      screen.getByTestId("btn-ko").click();
    });
    expect(titleEl.textContent).toBe("설정");
    expect(timelineEl.textContent).toBe("타임라인");

    // Simplified Chinese
    act(() => {
      screen.getByTestId("btn-zh-CN").click();
    });
    expect(titleEl.textContent).toBe("设置");
    expect(timelineEl.textContent).toBe("时间轴");

    // Back to English
    act(() => {
      screen.getByTestId("btn-en").click();
    });
    expect(titleEl.textContent).toBe("Settings");
    expect(timelineEl.textContent).toBe("Timeline");
  });

  it("respects data-no-i18n and localizes HTML attributes", async () => {
    render(
      <I18nProvider>
        <TestMultiLanguageSwitcher />
      </I18nProvider>
    );

    const untouchedEl = screen.getByTestId("untouched");
    const inputEl = screen.getByTestId("search-input") as HTMLInputElement;

    expect(untouchedEl.textContent).toBe("Settings");
    expect(inputEl.getAttribute("placeholder")).toBe("Search");

    // Switch to Russian
    act(() => {
      screen.getByTestId("btn-ru").click();
    });

    // Untouched should remain English because of data-no-i18n
    expect(untouchedEl.textContent).toBe("Settings");

    // Attributes should be translated
    expect(inputEl.getAttribute("placeholder")).toBe("Поиск");
    expect(inputEl.getAttribute("title")).toBe("Поиск");
    expect(inputEl.getAttribute("aria-label")).toBe("Поиск");
  });

  it("provides programmatic translation helper t() via useI18n", async () => {
    render(
      <I18nProvider>
        <TestMultiLanguageSwitcher />
      </I18nProvider>
    );

    const tHelperEl = screen.getByTestId("t-helper");
    expect(tHelperEl.textContent).toBe("Timeline");

    // Switch to Russian
    act(() => {
      screen.getByTestId("btn-ru").click();
    });
    expect(tHelperEl.textContent).toBe("Таймлайн");

    // Switch to German
    act(() => {
      screen.getByTestId("btn-de").click();
    });
    expect(tHelperEl.textContent).toBe("Zeitleiste");
  });

  it("translateText function directly translates and reverse translates accurately", () => {
    const original = "Video export requires FFmpeg to be installed and available in your system PATH.";

    const ru = translateText(original, "ru");
    expect(ru).toBe("Для экспорта видео требуется наличие FFmpeg в системной переменной PATH.");

    const es = translateText(original, "es");
    expect(es).toBe("La exportación de vídeo requiere que FFmpeg esté instalado y disponible en la variable PATH del sistema.");

    const ja = translateText(original, "ja");
    expect(ja).toBe("動画の書き出しには、FFmpegがインストールされシステムPATHで利用可能である必要があります。");

    // Reverse translation back to English
    expect(translateText(ru, "en")).toBe(original);
    expect(translateText(es, "en")).toBe(original);
    expect(translateText(ja, "en")).toBe(original);
  });

  it("resolves semantic keys through useI18n t() across locales", () => {
    function SemanticComponent() {
      const { t, setLanguage } = useI18n();
      return (
        <div>
          <span data-testid="sem-save">{t("common.actions.save")}</span>
          <span data-testid="sem-settings">{t("settings.modal.title")}</span>
          <span data-testid="sem-lang-label">{t("settings.language.label")}</span>
          <button data-testid="btn-sem-ru" onClick={() => setLanguage("ru")}>RU</button>
          <button data-testid="btn-sem-ja" onClick={() => setLanguage("ja")}>JA</button>
        </div>
      );
    }

    render(
      <I18nProvider>
        <SemanticComponent />
      </I18nProvider>
    );

    expect(screen.getByTestId("sem-save").textContent).toBe("Save");
    expect(screen.getByTestId("sem-settings").textContent).toBe("Settings");
    expect(screen.getByTestId("sem-lang-label").textContent).toBe("Interface language");

    // Switch to Russian
    act(() => {
      screen.getByTestId("btn-sem-ru").click();
    });
    expect(screen.getByTestId("sem-save").textContent).toBe("Сохранить");
    expect(screen.getByTestId("sem-settings").textContent).toBe("Настройки");
    expect(screen.getByTestId("sem-lang-label").textContent).toBe("Язык интерфейса");

    // Switch to Japanese
    act(() => {
      screen.getByTestId("btn-sem-ja").click();
    });
    expect(screen.getByTestId("sem-save").textContent).toBe("保存");
    expect(screen.getByTestId("sem-settings").textContent).toBe("設定");
    expect(screen.getByTestId("sem-lang-label").textContent).toBe("インターフェース言語");
  });

  it("supports variable interpolation and locale-specific plurals (Russian CLDR _one, _few, _many)", () => {
    function PluralComponent() {
      const { t, setLanguage } = useI18n();
      return (
        <div>
          <span data-testid="clip-1">{t("common.items.clipsCount", { count: 1 })}</span>
          <span data-testid="clip-2">{t("common.items.clipsCount", { count: 2 })}</span>
          <span data-testid="clip-5">{t("common.items.clipsCount", { count: 5 })}</span>
          <span data-testid="progress">{t("export.progress.percent", { percent: 42 })}</span>
          <button data-testid="btn-pl-ru" onClick={() => setLanguage("ru")}>RU</button>
        </div>
      );
    }

    render(
      <I18nProvider>
        <PluralComponent />
      </I18nProvider>
    );

    // English plurals
    expect(screen.getByTestId("clip-1").textContent).toBe("1 clip");
    expect(screen.getByTestId("clip-2").textContent).toBe("2 clips");
    expect(screen.getByTestId("clip-5").textContent).toBe("5 clips");
    expect(screen.getByTestId("progress").textContent).toBe("42% complete");

    // Russian CLDR plural forms
    act(() => {
      screen.getByTestId("btn-pl-ru").click();
    });
    expect(screen.getByTestId("clip-1").textContent).toBe("1 клип");
    expect(screen.getByTestId("clip-2").textContent).toBe("2 клипа");
    expect(screen.getByTestId("clip-5").textContent).toBe("5 клипов");
    expect(screen.getByTestId("progress").textContent).toBe("Завершено: 42%");
  });

  it("provides locale-aware formatting helpers (number, percent, duration, file size, date)", () => {
    let capturedHelpers: ReturnType<typeof useI18n> | null = null;
    function FormatterConsumer() {
      const helpers = useI18n();
      capturedHelpers = helpers;
      return <div data-testid="formatted">{helpers.formatDuration(125)}</div>;
    }

    render(
      <I18nProvider>
        <FormatterConsumer />
      </I18nProvider>
    );

    expect(capturedHelpers).not.toBeNull();
    const h = capturedHelpers!;

    // Duration formatting
    expect(h.formatDuration(45)).toBe("0:45");
    expect(h.formatDuration(125)).toBe("2:05");
    expect(h.formatDuration(3665)).toBe("1:01:05");

    // File size formatting
    expect(h.formatFileSize(512)).toBe("512 B");
    expect(h.formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(h.formatFileSize(1024 * 1024 * 1536)).toMatch(/1\.5\s*GB|1,5\s*GB/);

    // Percent formatting
    expect(h.formatPercent(0.75)).toMatch(/75%/);

    // Number formatting
    expect(h.formatNumber(1234567)).toBeDefined();

    // Date formatting
    const fixedDate = new Date("2026-05-15T12:00:00Z");
    expect(h.formatDate(fixedDate)).toBeDefined();
  });
});

