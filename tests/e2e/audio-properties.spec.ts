/**
 * audio-properties.spec.ts
 *
 * Playwright E2E validation for Phase 3: Audio Property Panel Implementation & Sound Integration.
 * Tests volume, mute, fade in, fade out, pan/balance, and reset actions for both
 * standalone audio clips and video clips with embedded audio in real Chromium.
 */

import { test, expect, type Page } from "@playwright/test";
import { installTauriMock } from "./mocks/tauriMock";

const AUDIO_CLIP_ID = "e2e-audio-props-clip";
const VIDEO_CLIP_ID = "e2e-video-with-audio-clip";

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

async function injectAudioClip(page: Page) {
  await page.evaluate(
    async ({ clipId }) => {
      const { useTimelineStore } = await import("/src/store/timelineStore.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { useUIStore } = await import("/src/store/uiStore.ts");

      // Register audio asset
      useProjectStore.getState().addMediaAsset({
        id: "audio-asset-1",
        name: "e2e_audio_sample.mp3",
        path: "/mock/media/sample_audio.mp3",
        type: "audio",
        duration: 10,
        size: 512 * 1024,
        audioChannels: 2,
        hasAudio: true,
        streams: [
          { type: "audio", codec: "mp3", channels: 2, sampleRate: 44100 },
        ],
      } as any);

      const track = useTimelineStore.getState().tracks.find((t) => t.type === "audio") || {
        id: "track-a1",
        name: "Audio 1",
        type: "audio",
        locked: false,
        muted: false,
        visible: true,
        volume: 1,
        height: 64,
      };

      const audioClip = {
        id: clipId,
        kind: "audio",
        trackId: track.id,
        mediaId: "audio-asset-1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        opacity: 1,
        rotation: 0,
        volume: 0.8,
        fadeIn: 1.0,
        fadeOut: 1.5,
        pan: 0,
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

async function injectVideoClip(page: Page) {
  await page.evaluate(
    async ({ clipId }) => {
      const { useTimelineStore } = await import("/src/store/timelineStore.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { useUIStore } = await import("/src/store/uiStore.ts");

      // Register video asset with embedded audio
      useProjectStore.getState().addMediaAsset({
        id: "video-asset-props",
        name: "e2e_sample_video.mp4",
        path: "/mock/media/sample_video.mp4",
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
        mediaId: "video-asset-props",
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
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        pan: 0,
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

test.describe("Audio Property Panel: Volume, Fades, Pan, and Reset E2E Suite", () => {
  test.beforeEach(async ({ page }) => {
    await setupEditor(page);
    await injectAudioClip(page);
  });

  test("SCN-E2E-AUD-01: Standalone audio clip volume adjustment, mute toggle, and volume reset", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // 1. Adjust Volume via Numeric input
    const volumeInput = panel.getByRole("spinbutton", { name: "Volume" });
    await expect(volumeInput).toBeVisible();

    await volumeInput.focus();
    await volumeInput.fill("60");
    await volumeInput.press("Enter");

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return Math.abs((clip?.volume ?? 0) - 0.6) < 0.01;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 2. Toggle Mute
    const muteBtn = panel.getByRole("button", { name: "Mute" });
    await expect(muteBtn).toBeVisible();
    await muteBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip?.volume ?? 1) === 0;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 3. Reset Volume
    const resetVolumeBtn = panel.getByRole("button", { name: "Reset volume" });
    await expect(resetVolumeBtn).toBeVisible();
    await resetVolumeBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip?.volume ?? 0) === 1.0;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );
  });

  test("SCN-E2E-AUD-02: Standalone audio clip fade in and fade out duration adjustments and resets", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // 1. Adjust Fade in
    const fadeInInput = panel.getByRole("spinbutton", { name: "Fade in" });
    await expect(fadeInInput).toBeVisible();
    await fadeInInput.focus();
    await fadeInInput.fill("2.5");
    await fadeInInput.press("Enter");

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return Math.abs((clip?.fadeIn ?? 0) - 2.5) < 0.05;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 2. Adjust Fade out
    const fadeOutInput = panel.getByRole("spinbutton", { name: "Fade out" });
    await expect(fadeOutInput).toBeVisible();
    await fadeOutInput.focus();
    await fadeOutInput.fill("3.0");
    await fadeOutInput.press("Enter");

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return Math.abs((clip?.fadeOut ?? 0) - 3.0) < 0.05;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 3. Reset Fade in
    const resetFadeInBtn = panel.getByRole("button", { name: "Reset fade in" });
    await expect(resetFadeInBtn).toBeVisible();
    await resetFadeInBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip?.fadeIn ?? 1) === 0;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 4. Reset Fade out
    const resetFadeOutBtn = panel.getByRole("button", { name: "Reset fade out" });
    await expect(resetFadeOutBtn).toBeVisible();
    await resetFadeOutBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip?.fadeOut ?? 1) === 0;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );
  });

  test("SCN-E2E-AUD-03: Standalone audio clip stereo pan adjustment and reset", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // 1. Adjust Pan
    const panInput = panel.getByRole("spinbutton", { name: "Pan" });
    await expect(panInput).toBeVisible();
    await panInput.focus();
    await panInput.fill("-50");
    await panInput.press("Enter");

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return Math.abs(((clip as any)?.pan ?? 0) - (-0.5)) < 0.05;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 2. Reset Pan
    const resetPanBtn = panel.getByRole("button", { name: "Reset pan" });
    await expect(resetPanBtn).toBeVisible();
    await resetPanBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return ((clip as any)?.pan ?? 1) === 0;
      },
      { clipId: AUDIO_CLIP_ID },
      { timeout: 5_000 },
    );
  });
});

test.describe("Video Clip Embedded Audio Tab Suite", () => {
  test.beforeEach(async ({ page }) => {
    await setupEditor(page);
    await injectVideoClip(page);
  });

  test("SCN-E2E-AUD-04: Video clip navigation to Audio primary tab -> Basic sub-tab, verifying SliderTrack & NumericControl interaction and resets", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel).toBeVisible();

    // 1. Switch to Audio Primary Tab
    const audioTabBtn = panel.getByRole("button", { name: /^Audio$/i });
    await expect(audioTabBtn).toBeVisible();
    await audioTabBtn.click();

    // 2. Verify sub-tabs: Basic (active), Voice changer (locked)
    const basicSubTab = panel.getByRole("button", { name: /^Basic$/i });
    const voiceChangerSubTab = panel.getByRole("button", {
      name: /^Voice changer$/i,
    });
    await expect(basicSubTab).toBeVisible();
    await expect(voiceChangerSubTab).toBeVisible();
    await expect(voiceChangerSubTab).toBeDisabled();

    // 3. Adjust Volume via NumericControl (with Enter key)
    const volumeInput = panel.getByRole("spinbutton", { name: "Volume" });
    await expect(volumeInput).toBeVisible();
    await volumeInput.focus();
    await volumeInput.fill("75");
    await volumeInput.press("Enter");

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return Math.abs((clip?.volume ?? 0) - 0.75) < 0.01;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 4. Reset Volume
    const resetVolumeBtn = panel.getByRole("button", { name: "Reset volume" });
    await expect(resetVolumeBtn).toBeVisible();
    await resetVolumeBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip?.volume ?? 0) === 1.0;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 5. Adjust Fade in
    const fadeInInput = panel.getByRole("spinbutton", { name: "Fade in" });
    await expect(fadeInInput).toBeVisible();
    await fadeInInput.focus();
    await fadeInInput.fill("1.8");
    await fadeInInput.press("Enter");

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return Math.abs((clip?.fadeIn ?? 0) - 1.8) < 0.05;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );

    // 6. Reset Fade in
    const resetFadeInBtn = panel.getByRole("button", { name: "Reset fade in" });
    await expect(resetFadeInBtn).toBeVisible();
    await resetFadeInBtn.click();

    await page.waitForFunction(
      async ({ clipId }) => {
        const { useTimelineStore } = await import("/src/store/timelineStore.ts");
        const clip = useTimelineStore
          .getState()
          .tracks.flatMap((t) => t.clips)
          .find((c) => c.id === clipId);
        return (clip?.fadeIn ?? 1) === 0;
      },
      { clipId: VIDEO_CLIP_ID },
      { timeout: 5_000 },
    );
  });
});
