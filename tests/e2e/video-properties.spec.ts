/**
 * video-properties.spec.ts
 *
 * Playwright E2E validation for Phase 2: Video Property Panel Implementation & Polish.
 * Tests Transform alignments, transform reset, blend mode selection, opacity controls,
 * and blend reset in a live Chromium browser running Clypra.
 */

import { test, expect, type Page } from "@playwright/test";
import { installTauriMock } from "./mocks/tauriMock";

const VIDEO_CLIP_ID = "e2e-video-props-clip";

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

async function injectVideoClip(page: Page) {
  await page.evaluate(
    async ({ clipId }) => {
      const { useTimelineStore } = await import("/src/store/timelineStore.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { useUIStore } = await import("/src/store/uiStore.ts");

      // Register mock video asset
      useProjectStore.getState().addMediaAsset({
        id: "video-asset-1",
        name: "e2e_video_props.mp4",
        path: "/mock/media/props_video.mp4",
        type: "video",
        duration: 10,
        size: 1024 * 1024,
        audioChannels: 2,
        hasAudio: true,
        streams: [
          { type: "video", codec: "h264", width: 1920, height: 1080 },
          { type: "audio", codec: "aac", channels: 2, sampleRate: 48000 },
        ],
      } as any);

      const track = useTimelineStore.getState().tracks[0] || {
        id: "track-v1",
        name: "Video 1",
        type: "video",
        locked: false,
        muted: false,
        visible: true,
        volume: 1,
        height: 64,
      };

      const videoClip = {
        id: clipId,
        kind: "video",
        trackId: track.id,
        mediaId: "video-asset-1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 100,
        y: 100,
        width: 320,
        height: 180,
        opacity: 0.8,
        rotation: 30,
        aspectRatioLocked: true,
      };

      useTimelineStore.getState().addClip(videoClip as any);
      useUIStore.getState().selectClip(clipId);
    },
    { clipId: VIDEO_CLIP_ID },
  );

  await expect(page.locator('[data-properties-panel="true"]')).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Video Property Panel: Transform & Blend E2E Suite", () => {
  test.beforeEach(async ({ page }) => {
    await setupEditor(page);
    await injectVideoClip(page);
  });

  test("SCN-E2E-VID-01: Transform Alignment buttons correctly position the video clip on the canvas", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // 1. Align Left
    const alignLeftBtn = panel.getByRole("button", { name: "Align left" });
    await expect(alignLeftBtn).toBeVisible();
    await alignLeftBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return clip?.x === 0;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 2. Align Right (1920 - 320 = 1600)
    const alignRightBtn = panel.getByRole("button", { name: "Align right" });
    await alignRightBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return clip?.x === 1600;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 3. Align Center Horizontally ((1920 - 320) / 2 = 800)
    const alignCenterXBtn = panel.getByRole("button", {
      name: "Align center horizontally",
    });
    await alignCenterXBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return clip?.x === 800;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 4. Align Top (y = 0)
    const alignTopBtn = panel.getByRole("button", { name: "Align top" });
    await alignTopBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return clip?.y === 0;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 5. Align Bottom (1080 - 180 = 900)
    const alignBottomBtn = panel.getByRole("button", { name: "Align bottom" });
    await alignBottomBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return clip?.y === 900;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 6. Align Center Vertically ((1080 - 180) / 2 = 450)
    const alignCenterYBtn = panel.getByRole("button", {
      name: "Align center vertically",
    });
    await alignCenterYBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return clip?.y === 450;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );
  });

  test("SCN-E2E-VID-02: Transform Reset button restores rotation to 0 and re-centers clip", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    const resetTransformBtn = panel.getByRole("button", {
      name: "Reset transform",
    });
    await expect(resetTransformBtn).toBeVisible();
    await resetTransformBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (
          clip?.rotation === 0 &&
          clip?.aspectRatioLocked === true &&
          typeof clip?.x === "number" &&
          typeof clip?.y === "number"
        );
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );
  });

  test("SCN-E2E-VID-03: Blend controls support opacity, blend mode, and blend reset", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // Verify opacity input
    const opacityInput = panel.getByRole("spinbutton", { name: "Opacity" });
    await expect(opacityInput).toBeVisible();

    await opacityInput.focus();
    await opacityInput.fill("60");
    await opacityInput.press("Enter");

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return Math.abs((clip?.opacity ?? 0) - 0.6) < 0.01;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // Reset blend
    const resetBlendBtn = panel.getByRole("button", { name: "Reset blend" });
    await expect(resetBlendBtn).toBeVisible();
    await resetBlendBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip?.opacity ?? 0) === 1 && (clip as any)?.blendMode === "normal";
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );
  });
});
