import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mocks/tauriMock";

test.describe("Clypra Internationalization & Localization Workflow (Playwright)", () => {
  test.beforeEach(async ({ page }) => {
    // Install controlled Tauri native mock boundary before navigating
    await installTauriMock(page, {
      recentProjects: [],
      defaultMediaDuration: 10.0,
    });
  });

  test("SCN-I18N-01: Default locale initializes correctly and reflects in document.documentElement.lang", async ({ page }) => {
    await page.goto("/");

    // Default language is 'en'
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe("en");

    // Standard English text is visible on the launch screen
    await expect(page.getByText("Start a new project")).toBeVisible();
    await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
  });

  test("SCN-I18N-02: User switches language to Russian via Settings modal and UI localizes immediately", async ({ page }) => {
    await page.goto("/");

    // Open settings modal using the header Settings button
    const settingsBtn = page.locator("button[title='Settings']").first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Verify Settings modal is open
    await expect(page.getByRole("dialog")).toBeVisible();

    // Find language selector and select Russian (ru)
    const langSelect = page.getByRole("combobox", { name: /Interface language/i });
    await expect(langSelect).toBeVisible();
    await langSelect.selectOption("ru");

    // Verify document lang is updated to 'ru'
    await expect.poll(async () => page.evaluate(() => document.documentElement.lang)).toBe("ru");

    // Verify localStorage persistence
    const saved = await page.evaluate(() => localStorage.getItem("clypra.language"));
    expect(saved).toBe("ru");

    // Verify Russian translations appear in the dialog
    await expect(page.getByRole("heading", { name: "Язык интерфейса" })).toBeVisible();
    await expect(page.getByText("Выберите язык интерфейса Clypra")).toBeVisible();
  });

  test("SCN-I18N-03: Language preference persists across page reload", async ({ page }) => {
    // Pre-seed localStorage with Russian
    await page.addInitScript(() => {
      localStorage.setItem("clypra.language", "ru");
    });

    await page.goto("/");

    // Verify document lang matches persisted language
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe("ru");

    // Verify Russian content rendered on Launch Screen ("Новый проект")
    await expect(page.getByRole("button", { name: "Новый проект" })).toBeVisible();
  });

  test("SCN-I18N-04: Gracefully falls back to English when an invalid locale is encountered in storage", async ({ page }) => {
    // Seed invalid locale
    await page.addInitScript(() => {
      localStorage.setItem("clypra.language", "invalid-unsupported-code");
    });

    await page.goto("/");

    // Should safely fallback to English without crash
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe("en");

    await expect(page.getByText("Start a new project")).toBeVisible();
    await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
  });

  test("SCN-I18N-05: Multi-locale switching updates document language and UI", async ({ page }) => {
    // Seed Japanese
    await page.addInitScript(() => {
      localStorage.setItem("clypra.language", "ja");
    });

    await page.goto("/");

    const langJa = await page.evaluate(() => document.documentElement.lang);
    expect(langJa).toBe("ja");
    await expect(page.getByRole("button", { name: "新規プロジェクト" })).toBeVisible();

    // Open settings and switch to Spanish
    const settingsBtn = page.locator("button[title='Settings'], button[title='設定']").first();
    await settingsBtn.click();

    const langSelect = page.getByRole("combobox").first();
    await langSelect.selectOption("es");

    await expect.poll(async () => page.evaluate(() => document.documentElement.lang)).toBe("es");
    await expect(page.getByRole("button", { name: "Nuevo proyecto" })).toBeVisible();
  });
});
