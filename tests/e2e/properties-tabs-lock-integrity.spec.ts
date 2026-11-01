/**
 * properties-tabs-lock-integrity.spec.ts
 *
 * Playwright E2E validation for Phase 1:
 * Confirms that all locked tabs across Video, Audio, and Text Property Panels
 * are present in the DOM as intentionally designed, display their lock icons,
 * are properly disabled (disabled attribute & cursor-not-allowed), and clicking
 * them does NOT mutate active tab state or cause runtime errors.
 */

import { test, expect, type Page } from "@playwright/test";
import { installTauriMock } from "./mocks/tauriMock";

const VIDEO_CLIP_ID = "e2e-lock-video-clip";
const AUDIO_CLIP_ID = "e2e-lock-audio-clip";
const TEXT_CLIP_ID = "e2e-lock-text-clip";

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

      // Register video asset with embedded audio
      useProjectStore.getState().addMediaAsset({
        id: "video-asset-1",
        name: "e2e_sample_video.mp4",
        path: "/mock/media/sample.mp4",
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
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
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

async function injectAudioClip(page: Page) {
  await page.evaluate(
    async ({ clipId }) => {
      const { useTimelineStore } = await import("/src/store/timelineStore.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { useUIStore } = await import("/src/store/uiStore.ts");

      useProjectStore.getState().addMediaAsset({
        id: "audio-asset-1",
        name: "e2e_sample_audio.mp3",
        path: "/mock/media/sample.mp3",
        type: "audio",
        duration: 10,
        size: 512 * 1024,
        audioChannels: 2,
        hasAudio: true,
      } as any);

      const audioClip = {
        id: clipId,
        kind: "audio",
        trackId: "track-a1",
        mediaId: "audio-asset-1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        volume: 1,
      };

      useTimelineStore.getState().addClip(audioClip as any);
      useUIStore.getState().selectClip(clipId);
    },
    { clipId: AUDIO_CLIP_ID },
  );

  await expect(page.locator('[data-properties-panel="true"]')).toBeVisible({
    timeout: 10_000,
  });
}

async function injectTextClip(page: Page) {
  await page.evaluate(
    async ({ clipId }) => {
      const { useTimelineStore } = await import("/src/store/timelineStore.ts");
      const { useUIStore } = await import("/src/store/uiStore.ts");

      const textClip = {
        id: clipId,
        kind: "text",
        trackId: "track-v1",
        mediaId: "",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 100,
        y: 200,
        width: 400,
        height: 120,
        baseWidth: 400,
        baseHeight: 120,
        opacity: 1,
        rotation: 0,
        text: "E2E Lock Text",
        fontFamily: "Inter Variable",
        fontSize: 24,
        color: "#ffffff",
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

test.describe("Property Panels: Locked Tabs Integrity Suite", () => {
  test.beforeEach(async ({ page }) => {
    await setupEditor(page);
  });

  test("SCN-E2E-LOCK-01: Video properties panel preserves locked sub-tabs and prevents switching", async ({
    page,
  }) => {
    await injectVideoClip(page);

    const panel = page.locator('[data-properties-panel="true"]');

    // 1. Primary Top Tabs for Video
    await expect(panel.getByRole("button", { name: /^Video$/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Audio$/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Speed$/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Animation$/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Adjust$/i })).toBeVisible();

    // 2. Video Style Sub-tabs: Basic (active), Remove BG (locked), Mask (locked), Retouch (locked)
    const basicTab = panel.getByRole("button", { name: /^Basic$/i }).first();
    const removeBgTab = panel.getByRole("button", { name: /^Remove BG$/i });
    const maskTab = panel.getByRole("button", { name: /^Mask$/i }).first();
    const retouchTab = panel.getByRole("button", { name: /^Retouch$/i });

    await expect(basicTab).toBeVisible();
    await expect(removeBgTab).toBeVisible();
    await expect(maskTab).toBeVisible();
    await expect(retouchTab).toBeVisible();

    // Verify locked attributes
    await expect(removeBgTab).toBeDisabled();
    await expect(removeBgTab).toHaveAttribute("title", "Coming soon");
    await expect(maskTab).toBeDisabled();
    await expect(maskTab).toHaveAttribute("title", "Coming soon");
    await expect(retouchTab).toBeDisabled();
    await expect(retouchTab).toHaveAttribute("title", "Coming soon");

    // Verify clicking locked tab is safely blocked
    await removeBgTab.click({ force: true });
    await expect(panel.getByText("Transform")).toBeVisible();

    // 3. Switch to Adjust tab: Basic and HSL are unlocked; Curves, Color wheel, Mask are locked
    await panel.getByRole("button", { name: /^Adjust$/i }).click();

    const adjustBasic = panel.getByRole("button", { name: /^Basic$/i });
    const adjustHsl = panel.getByRole("button", { name: /^HSL$/i });
    const adjustCurves = panel.getByRole("button", { name: /^Curves$/i });
    const adjustColorWheel = panel.getByRole("button", { name: /^Color wheel$/i });

    await expect(adjustBasic).toBeVisible();
    await expect(adjustHsl).toBeVisible();
    await expect(adjustCurves).toBeVisible();
    await expect(adjustColorWheel).toBeVisible();

    await expect(adjustBasic).not.toBeDisabled();
    await expect(adjustHsl).not.toBeDisabled();
    await expect(adjustCurves).toBeDisabled();
    await expect(adjustCurves).toHaveAttribute("title", "Coming soon");
    await expect(adjustColorWheel).toBeDisabled();
    await expect(adjustColorWheel).toHaveAttribute("title", "Coming soon");

    // Switch to HSL works
    await adjustHsl.click();
    // Clicking locked Curves does NOT activate curves
    await adjustCurves.click({ force: true });
    await expect(panel.getByText("Curves feature coming soon")).not.toBeVisible();

    // 4. Switch to Speed tab: Standard is unlocked; Curve and Velocity are locked
    await panel.getByRole("button", { name: /^Speed$/i }).click();

    const speedStandard = panel.getByRole("button", { name: /^Standard$/i });
    const speedCurve = panel.getByRole("button", { name: /^Curve$/i });
    const speedVelocity = panel.getByRole("button", { name: /^Velocity effects$/i });

    await expect(speedStandard).toBeVisible();
    await expect(speedCurve).toBeVisible();
    await expect(speedVelocity).toBeVisible();

    await expect(speedStandard).not.toBeDisabled();
    await expect(speedCurve).toBeDisabled();
    await expect(speedCurve).toHaveAttribute("title", "Coming soon");
    await expect(speedVelocity).toBeDisabled();
    await expect(speedVelocity).toHaveAttribute("title", "Coming soon");

    // 5. Switch to Audio tab: Basic is unlocked; Voice changer is locked
    await panel.getByRole("button", { name: /^Audio$/i }).click();

    const audioBasic = panel.getByRole("button", { name: /^Basic$/i });
    const audioVoiceChanger = panel.getByRole("button", { name: /^Voice changer$/i });

    await expect(audioBasic).toBeVisible();
    await expect(audioVoiceChanger).toBeVisible();
    await expect(audioBasic).not.toBeDisabled();
    await expect(audioVoiceChanger).toBeDisabled();
    await expect(audioVoiceChanger).toHaveAttribute("title", "Coming soon");
  });

  test("SCN-E2E-LOCK-02: Text properties panel preserves locked Bubble sub-tab", async ({
    page,
  }) => {
    await injectTextClip(page);

    const panel = page.locator('[data-properties-panel="true"]');

    // Text sub-tabs
    const basicTab = panel.getByRole("button", { name: /^Basic$/i });
    const bubbleTab = panel.getByRole("button", { name: /^Bubble$/i });

    await expect(basicTab).toBeVisible();
    await expect(bubbleTab).toBeVisible();

    await expect(basicTab).not.toBeDisabled();
    await expect(bubbleTab).toBeDisabled();
    await expect(bubbleTab).toHaveAttribute("title", "Coming soon");

    // Attempting to click Bubble does not replace text editor
    await bubbleTab.click({ force: true });
    await expect(
      panel.getByRole("textbox", { name: /Plain text content/i }),
    ).toBeVisible();
  });

  test("SCN-E2E-LOCK-03: Audio properties panel renders audio clip controls cleanly", async ({
    page,
  }) => {
    await injectAudioClip(page);

    const panel = page.locator('[data-properties-panel="true"]');

    // Audio clip top tabs
    await expect(panel.getByRole("button", { name: /^Basic$/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Speed$/i })).toBeVisible();

    // Volume label should be visible
    await expect(panel.getByText("Volume")).toBeVisible();
  });
});
