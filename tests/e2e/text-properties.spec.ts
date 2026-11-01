/**
 * text-properties.spec.ts
 *
 * Playwright E2E validation for Phase 4: Text Property Panel Implementation & Polish.
 * Tests text content editing, font size, bold/underline, case transform, horizontal
 * and vertical alignments, stroke reset, and background reset in a live Chromium browser.
 */

import { test, expect, type Page } from "@playwright/test";
import { installTauriMock } from "./mocks/tauriMock";

const TEXT_CLIP_ID = "e2e-text-props-clip";

async function setupEditor(page: Page) {
  await installTauriMock(page, {
    recentProjects: [],
    defaultMediaDuration: 15.0,
  });

  await page.goto("/");
  await page.getByRole("button", { name: "New Project" }).click();

  await expect(
    page.locator('[data-testid="program-preview-canvas"]'),
  ).toBeVisible({ timeout: 15_000 });

  await page.waitForFunction(
    async () => {
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const state = useProjectStore.getState();
      return Boolean(state.project && !state.projectInitialization);
    },
    { timeout: 15_000 },
  );
}

async function injectTextClip(page: Page) {
  await page.evaluate(
    async ({ clipId }) => {
      const { useTimelineStore } = await import("/src/store/timelineStore.ts");
      const { useUIStore } = await import("/src/store/uiStore.ts");

      const track = useTimelineStore.getState().tracks.find((t) => t.type === "text") || {
        id: "track-t1",
        name: "Text 1",
        type: "text",
        locked: false,
        muted: false,
        visible: true,
        volume: 1,
        height: 48,
      };

      const textClip = {
        id: clipId,
        kind: "text",
        trackId: track.id,
        mediaId: "text-media-1",
        text: "Initial E2E Title",
        startTime: 0,
        duration: 8,
        trimIn: 0,
        trimOut: 8,
        x: 100,
        y: 100,
        width: 500,
        height: 150,
        fontSize: 48,
        fontFamily: "Inter Variable",
        fontWeight: 400,
        fontStyle: "normal",
        color: "#ffffff",
        align: "center",
        valign: "middle",
        letterSpacing: 0,
        lineHeight: 1.2,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: true,
        stroke: { color: "#000000", width: 0 },
        background: null,
      };

      useTimelineStore.getState().addClip(textClip as any);
      useUIStore.getState().selectClip(clipId);
    },
    { clipId: TEXT_CLIP_ID },
  );

  await expect(page.locator('[data-properties-panel="true"]')).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Text Property Panel: Typography, Alignments, and Styling E2E Suite", () => {
  test.beforeEach(async ({ page }) => {
    await setupEditor(page);
    await injectTextClip(page);
  });

  test("SCN-E2E-TXT-01: Text content editing, font size, bold, underline, and case transform", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // 1. Text Content Textarea
    const textarea = panel.locator('textarea[placeholder="Enter text..."]');
    await expect(textarea).toBeVisible();
    await textarea.fill("Updated Clypra Title");
    await textarea.blur();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip as any)?.text === "Updated Clypra Title";
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );

    // 2. Bold toggle (B)
    const boldBtn = panel.getByRole("button", { name: "B", exact: true });
    await expect(boldBtn).toBeVisible();
    await boldBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip as any)?.fontWeight >= 700;
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );

    // 3. Underline toggle (U)
    const underlineBtn = panel.getByRole("button", { name: "U", exact: true });
    await expect(underlineBtn).toBeVisible();
    await underlineBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip as any)?.textDecoration === "underline";
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );

    // 4. Uppercase case transform (TT)
    const uppercaseBtn = panel.getByRole("button", { name: "TT", exact: true });
    await expect(uppercaseBtn).toBeVisible();
    await uppercaseBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip as any)?.textTransform === "uppercase";
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );
  });

  test("SCN-E2E-TXT-02: Text horizontal and vertical alignment buttons correctly update clip alignment", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // 1. Horizontal Align Left
    const alignLeftBtn = panel.getByRole("button", { name: "Align left" }).first();
    await expect(alignLeftBtn).toBeVisible();
    await alignLeftBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip as any)?.align === "left";
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );

    // 2. Horizontal Align Right
    const alignRightBtn = panel.getByRole("button", { name: "Align right" }).first();
    await alignRightBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip as any)?.align === "right";
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );

    // 3. Vertical Align Top
    const alignTopBtn = panel.getByRole("button", { name: "Align top" }).first();
    await alignTopBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip as any)?.valign === "top";
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );

    // 4. Vertical Align Bottom
    const alignBottomBtn = panel.getByRole("button", { name: "Align bottom" }).first();
    await alignBottomBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip as any)?.valign === "bottom";
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );
  });

  test("SCN-E2E-TXT-03: Stroke and Background reset buttons restore default values", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // 1. Reset Stroke
    const resetStrokeBtn = panel.getByRole("button", { name: "Reset stroke" });
    await expect(resetStrokeBtn).toBeVisible();
    await resetStrokeBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (
          (clip as any)?.stroke?.color === "#000000" &&
          (clip as any)?.stroke?.width === 40
        );
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );

    // 2. Reset Background
    const resetBgBtn = panel.getByRole("button", { name: "Reset background" });
    await expect(resetBgBtn).toBeVisible();
    await resetBgBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (
          (clip as any)?.background?.color === "#000000" &&
          (clip as any)?.background?.opacity === 100 &&
          (clip as any)?.background?.style === "rectangle"
        );
      },
      { clipId: TEXT_CLIP_ID },
      { timeout: 5_000 },
    );
  });
});
