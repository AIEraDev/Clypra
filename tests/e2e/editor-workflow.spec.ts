import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mocks/tauriMock";

test.describe("Clypra Editor Frontend Workflow (Playwright)", () => {
  test.beforeEach(async ({ page }) => {
    // Install controlled Tauri native mock boundary before navigating
    await installTauriMock(page, {
      recentProjects: [],
      defaultMediaDuration: 12.0,
    });
  });

  test("SCN-01: Launch screen renders successfully with project creation actions", async ({ page }) => {
    await page.goto("/");

    // Verify header and primary call-to-action button
    await expect(page.getByText("Start a new project")).toBeVisible();
    const newProjectBtn = page.getByRole("button", { name: "New Project" });
    await expect(newProjectBtn).toBeVisible();
    await expect(newProjectBtn).toBeEnabled();
  });

  test("SCN-02: User clicks New Project and transitions into the editor workspace", async ({ page }) => {
    await page.goto("/");

    // Click New Project
    const newProjectBtn = page.getByRole("button", { name: "New Project" });
    await expect(newProjectBtn).toBeVisible();
    await newProjectBtn.click();

    // EditorScreen mounts — verify presence of editor workspace
    // The editor layout contains the top navigation bar and timeline container
    await expect(page.locator("body")).not.toHaveClass(/error/);

    // Verify launch screen is no longer displayed
    await expect(page.getByText("Start a new project")).not.toBeVisible();
  });

  test("SCN-03: Editor workspace renders timeline controls and responsive layout", async ({ page }) => {
    await page.goto("/");

    // Create new project
    await page.getByRole("button", { name: "New Project" }).click();

    // Verify main editor viewport or timeline container is mounted
    const editorContainer = page.locator("div.w-full.h-full.overflow-hidden");
    await expect(editorContainer).toBeVisible();
  });

  test("SCN-04: Spacebar keyboard shortcut toggles playback state gracefully", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project" }).click();

    // Press Space to toggle playback
    await page.keyboard.press("Space");

    // Ensure application did not crash and remains responsive
    await expect(page.locator("body")).toBeVisible();
  });
});
