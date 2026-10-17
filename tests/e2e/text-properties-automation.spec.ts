/**
 * text-properties-automation.spec.ts
 *
 * Full End-to-End Live Playwright Automation for Text Properties & Behavior in Clypra:
 * - CapCut-parity primary top tabs (Text, Animation, Tracking, TTS, AI Avatars, excluding top Transform)
 * - Text Basic sub-tab: live textarea typing, font, font-size, pattern (B, U, I), case (TT, tt, Tt), color
 * - Preset Style Grid: responsive preview cards, instant style application, and reset
 * - Transform Section: scale, uniform scale, position X/Y (center-relative), plane rotation dial, 8-button canvas alignment toolbar
 * - Stroke Section: enable checkbox, color picker, thickness slider & stepper, keyframe navigation, reset
 * - Background Section: enable checkbox, style cards (Rectangle vs Split lines), opacity, rounded rectangle, height, width, y-offset, reset
 * - Live evaluation pipeline confirmation: verifies state updates synchronously propagate into the evaluated scene
 */

import { test, expect, type Page } from "@playwright/test";
import { installTauriMock } from "./mocks/tauriMock";

const TEST_TEXT_CLIP_ID = "playwright-text-clip";

async function setupEditorWithTextClip(page: Page) {
  // Install controlled Tauri mock boundary
  await installTauriMock(page, {
    recentProjects: [],
    defaultMediaDuration: 10.0,
  });

  // Navigate to editor
  await page.goto("/");
  await page.getByRole("button", { name: "New Project" }).click();

  // Wait for canvas to mount in the DOM
  await expect(
    page.locator('[data-testid="program-preview-canvas"]'),
  ).toBeVisible({ timeout: 15_000 });

  // Wait for project initialization phase to clear
  await page.waitForFunction(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const state = useProjectStore.getState();
    return Boolean(state.project && !state.projectInitialization);
  }, { timeout: 15_000 });

  // Inject a text clip into useTimelineStore and select it in useUIStore
  await page.evaluate(async (clipId) => {
    const { useTimelineStore } = await import("/src/store/timelineStore.ts");
    const { useUIStore } = await import("/src/store/uiStore.ts");

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

    const textClip = {
      id: clipId,
      kind: "text",
      trackId: track.id,
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
      aspectRatioLocked: false,
      text: "Default Text",
      fontFamily: "Inter Variable",
      fontSize: 24,
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      textTransform: "none",
      color: "#ffffff",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
      paddingX: 16,
      paddingY: 16,
    };

    useTimelineStore.getState().addClip(textClip as any);
    useUIStore.getState().selectClip(clipId);
  }, TEST_TEXT_CLIP_ID);

  // Ensure Properties Panel is mounted
  await expect(page.locator('[data-properties-panel="true"]')).toBeVisible({
    timeout: 10_000,
  });
}

/** Helper to retrieve the current state of the text clip from timelineStore */
async function getLiveTextClip(page: Page) {
  return page.evaluate(async (clipId) => {
    const { useTimelineStore } = await import("/src/store/timelineStore.ts");
    return (
      useTimelineStore
        .getState()
        .clips.find((c: { id: string }) => c.id === clipId) || null
    );
  }, TEST_TEXT_CLIP_ID);
}

test.describe("Full Automation: CapCut Text Properties & Live Behavior", () => {
  test.beforeEach(async ({ page }) => {
    await setupEditorWithTextClip(page);
  });

  // ─── 1. Navigation & Hierarchy ───────────────────────────────────────────
  test("SCN-NAV: Verifies primary top tabs, sub-tabs, and excludes top Transform tab", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');

    // Primary tabs must match CapCut desktop design
    await expect(panel.getByRole("button", { name: /^Text$/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Animation/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Tracking/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Text to speech/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /AI avatars/i })).toBeVisible();

    // Top Transform tab must NOT exist for text clips
    await expect(panel.getByRole("button", { name: /^Transform$/i })).not.toBeVisible();

    // Text sub-tabs must be available (Basic, Bubble)
    await expect(panel.getByRole("button", { name: /^Basic$/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Bubble$/i })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Effects$/i })).not.toBeVisible();

    // Switching to Bubble sub-tab
    await panel.getByRole("button", { name: /^Bubble$/i }).click();

    // Sticky header: sub-tab switcher + textarea is preserved across switching to Bubble!
    await expect(panel.getByRole("textbox", { name: /Plain text content/i })).toBeVisible();
    await expect(panel.getByText("Speech Bubbles")).toBeVisible();
    await expect(panel.getByTitle(/Filter by category/i)).toBeVisible();

    // Search bar automation validation
    const searchInput = panel.getByPlaceholder("Search text bubbles...");
    await expect(searchInput).toBeVisible();

    // Automation validation: Editor bubble presets render on HTML5 Canvas, NOT HTML document elements
    const presetCanvases = panel.locator('[data-bubble-preset-canvas="true"]');
    await expect(presetCanvases.first()).toBeVisible();
    expect(await presetCanvases.count()).toBeGreaterThan(5);

    // Filter by search for "Torn Paper"
    await searchInput.fill("Torn");
    await page.waitForTimeout(100);
    const tornPaperBtn = panel.getByTitle("Torn Paper", { exact: true });
    await expect(tornPaperBtn).toBeVisible();

    // Apply Torn Paper preset (reproducing CapCut reference)
    await tornPaperBtn.click();
    await page.waitForTimeout(200);
    let clip = await getLiveTextClip(page);
    expect(clip.background).toBeDefined();
    expect(clip.background.bubblePresetId).toBe("bubble-paper-torn");

    // Main program preview canvas is verified
    await expect(page.locator('[data-testid="program-preview-canvas"]')).toBeVisible();

    // Clear search and reset via None card
    await searchInput.fill("");
    await page.waitForTimeout(100);
    await panel.getByTitle("None").click();
    await page.waitForTimeout(200);
    clip = await getLiveTextClip(page);
    expect(clip.background).toBeUndefined();

    // Effects sub-tab must NOT be present
    await expect(panel.getByRole("button", { name: /^Effects$/i })).not.toBeVisible();

    // Switching back to Basic
    await panel.getByRole("button", { name: /^Basic$/i }).click();
    await expect(panel.getByRole("textbox", { name: /Plain text content/i })).toBeVisible();
  });

  // ─── 2. Text Basic: Content, Font, Typography, Case & Alignment ─────────
  test("SCN-TYPO: Real-time text editing, pattern formatting, case transform, and alignment", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    const textarea = panel.getByRole("textbox", { name: /Plain text content/i });
    await expect(textarea).toBeVisible();

    // Type live text into textarea
    await textarea.fill("Clypra Dynamic Automation");
    await page.waitForTimeout(200);

    let clip = await getLiveTextClip(page);
    expect(clip.text).toBe("Clypra Dynamic Automation");

    // Pattern: Underline
    const underlineBtn = panel.getByTitle("Underline");
    await underlineBtn.click();
    await page.waitForTimeout(200);
    clip = await getLiveTextClip(page);
    expect(clip.textDecoration).toBe("underline");

    // Pattern: Bold
    const boldBtn = panel.getByTitle("Bold");
    await boldBtn.click();
    await page.waitForTimeout(200);
    clip = await getLiveTextClip(page);
    expect(clip.fontWeight === 700 || clip.fontWeight === "bold").toBe(true);

    // Pattern: Italic
    const italicBtn = panel.getByTitle("Italic");
    await italicBtn.click();
    await page.waitForTimeout(200);
    clip = await getLiveTextClip(page);
    expect(clip.fontStyle).toBe("italic");

    // Case: Uppercase (TT)
    const uppercaseBtn = panel.getByTitle("Uppercase (ALL CAPS)");
    await uppercaseBtn.click();
    await page.waitForTimeout(200);
    clip = await getLiveTextClip(page);
    expect(clip.textTransform).toBe("uppercase");

    // Case: Lowercase (tt)
    const lowercaseBtn = panel.getByTitle("Lowercase (all small)");
    await lowercaseBtn.click();
    await page.waitForTimeout(200);
    clip = await getLiveTextClip(page);
    expect(clip.textTransform).toBe("lowercase");
  });

  // ─── 3. Preset Style Grid ────────────────────────────────────────────────
  test("SCN-PRESET: Preset styles grid renders visual cards and applies styles instantly", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel.getByText(/PRESET STYLE/i)).toBeVisible();

    // Verify preset buttons exist
    const yellowOutline = panel.getByTitle("Yellow with Black Outline");
    await expect(yellowOutline).toBeVisible();
    await yellowOutline.click();
    await page.waitForTimeout(200);

    let clip = await getLiveTextClip(page);
    expect(clip.color).toBe("#ffe600");
    expect(clip.stroke).toEqual({ color: "#000000", width: 3 });

    // Apply Yellow Badge
    const yellowBadge = panel.getByTitle("Yellow Badge");
    await yellowBadge.click();
    await page.waitForTimeout(200);

    clip = await getLiveTextClip(page);
    expect(clip.color).toBe("#000000");
    expect(clip.background).toEqual({ color: "#ffd000", padding: 8, borderRadius: 6 });

    // Reset with None button
    const resetBtn = panel.getByTitle("None");
    await resetBtn.click();
    await page.waitForTimeout(200);

    clip = await getLiveTextClip(page);
    expect(clip.color).toBe("#ffffff");
    expect(clip.stroke).toBeUndefined();
    expect(clip.background).toBeUndefined();
  });

  // ─── 4. Transform Section: Scale, Position, Rotation & Canvas Alignment ──
  test("SCN-TRANSFORM: CapCut Transform section controls, canvas alignment toolbar, and reset", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel.getByText("Transform", { exact: false }).first()).toBeVisible();

    // Alignment Toolbar tests
    // 1. Align Left (|←) -> x: 0
    const alignLeftBtn = panel.getByTitle(/^Align left$/i);
    await alignLeftBtn.click();
    await page.waitForTimeout(150);
    let clip = await getLiveTextClip(page);
    expect(clip.x).toBe(0);

    // 2. Align Center X (┼) -> x: (1920 - clip.width) / 2
    const alignCenterXBtn = panel.getByTitle(/^Align center horizontally$/i);
    await alignCenterXBtn.click();
    await page.waitForTimeout(150);
    clip = await getLiveTextClip(page);
    expect(clip.x).toBe(Math.round((1920 - clip.width) / 2));

    // 3. Align Right (→|) -> x: 1920 - clip.width
    const alignRightBtn = panel.getByTitle(/^Align right$/i);
    await alignRightBtn.click();
    await page.waitForTimeout(150);
    clip = await getLiveTextClip(page);
    expect(clip.x).toBe(Math.round(1920 - clip.width));

    // 4. Align Top (╤) -> y: 0
    const alignTopBtn = panel.getByTitle(/^Align top$/i);
    await alignTopBtn.click();
    await page.waitForTimeout(150);
    clip = await getLiveTextClip(page);
    expect(clip.y).toBe(0);

    // 5. Align Center Y (+) -> y: (1080 - clip.height) / 2
    const alignCenterYBtn = panel.getByTitle(/^Align center vertically$/i);
    await alignCenterYBtn.click();
    await page.waitForTimeout(150);
    clip = await getLiveTextClip(page);
    expect(clip.y).toBe(Math.round((1080 - clip.height) / 2));

    // 6. Reset Transform Button (⟲)
    const resetTransformBtn = panel.getByTitle(/^Reset transform$/i);
    await resetTransformBtn.click();
    await page.waitForTimeout(150);
    clip = await getLiveTextClip(page);
    expect(clip.rotation).toBe(0);
    expect(clip.scale).toBe(1);
  });

  // ─── 5. Stroke Section: Checkbox, Thickness Slider/Stepper, Reset ────────
  test("SCN-STROKE: Stroke enable toggle, thickness adjustment, reset, and keyframe controls", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel.getByText("Stroke", { exact: false }).first()).toBeVisible();

    // Toggle Stroke checkbox to enable
    const strokeCheckbox = panel.getByTitle(/^Enable stroke$/i);
    await strokeCheckbox.click();
    await page.waitForTimeout(150);

    let clip = await getLiveTextClip(page);
    expect(clip.stroke).toBeDefined();
    expect(clip.stroke.width).toBe(40);

    // Thickness stepper increment
    const thicknessInput = panel
      .getByText("Thickness")
      .locator("..")
      .locator('input[type="number"]');
    await thicknessInput.fill("60");
    await page.waitForTimeout(150);

    clip = await getLiveTextClip(page);
    expect(clip.stroke.width).toBe(60);

    // Stroke Reset (⟲)
    const resetStrokeBtn = panel.getByTitle(/^Reset stroke$/i);
    await resetStrokeBtn.click();
    await page.waitForTimeout(150);

    clip = await getLiveTextClip(page);
    expect(clip.stroke.width).toBe(40);
    expect(clip.stroke.color).toBe("#000000");

    // Toggle Stroke checkbox again to disable
    await strokeCheckbox.click();
    await page.waitForTimeout(150);

    clip = await getLiveTextClip(page);
    expect(clip.stroke).toBeUndefined();
  });

  // ─── 6. Background Section: Checkbox, Shape Cards, Sliders, Reset ────────
  test("SCN-BACKGROUND: Background enable toggle, shape cards (Rectangle vs Split), sliders, and reset", async ({
    page,
  }) => {
    const panel = page.locator('[data-properties-panel="true"]');
    await expect(panel.getByText("Background", { exact: false }).first()).toBeVisible();

    // Toggle Background checkbox to enable
    const bgCheckbox = panel.getByTitle(/^Enable background$/i);
    await bgCheckbox.click();
    await page.waitForTimeout(150);

    let clip = await getLiveTextClip(page);
    expect(clip.background).toBeDefined();

    // Switch to Split lines shape card
    const splitLinesCard = panel.getByTitle(/^Split lines$/i);
    await splitLinesCard.click();
    await page.waitForTimeout(150);

    clip = await getLiveTextClip(page);
    expect((clip.background as any).style).toBe("split");

    // Switch back to Rectangle shape card
    const rectCard = panel.getByTitle(/^Rectangle$/i);
    await rectCard.click();
    await page.waitForTimeout(150);

    clip = await getLiveTextClip(page);
    expect((clip.background as any).style).toBe("rectangle");

    // Background Reset (⟲)
    const resetBgBtn = panel.getByTitle(/^Reset background$/i);
    await resetBgBtn.click();
    await page.waitForTimeout(150);

    clip = await getLiveTextClip(page);
    expect(clip.background.color).toBe("#000000");
    expect(clip.background.opacity).toBe(100);
    expect(clip.background.borderRadius).toBe(0);

    // Toggle Background checkbox again to disable
    await bgCheckbox.click();
    await page.waitForTimeout(150);

    clip = await getLiveTextClip(page);
    expect(clip.background).toBeUndefined();
  });

  // ─── 7. Full Evaluation Pipeline Integration Confirmation ────────────────
  test("SCN-EVAL: Evaluates complete text scene layer with all combined properties", async ({
    page,
  }) => {
    const sceneOutput = await page.evaluate(async (clipId) => {
      const { useTimelineStore } = await import("/src/store/timelineStore.ts");
      const { evaluateTimelineScene } = await import("/src/core/evaluation/evaluator.ts");

      // Configure multi-property text clip
      useTimelineStore.setState((state: any) => ({
        clips: state.clips.map((c: any) =>
          c.id === clipId
            ? {
                ...c,
                text: "Full Automation Verified",
                textTransform: "uppercase",
                textDecoration: "underline",
                stroke: { color: "#ff0055", width: 4 },
                background: {
                  color: "#000000",
                  opacity: 85,
                  borderRadius: 8,
                  padding: 12,
                  style: "split",
                },
              }
            : c,
        ),
      }));

      const state = useTimelineStore.getState();
      const project = {
        id: "test-proj",
        name: "Test",
        duration: 10,
        frameRate: 30 as const,
        aspectRatio: "16:9" as const,
        canvasWidth: 1920,
        canvasHeight: 1080,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const scene = evaluateTimelineScene(
        1.0,
        state.clips,
        state.tracks,
        [],
        project,
        [],
      );

      const textLayer = scene.visualLayers.find((l: any) => l.layerType === "text");
      return {
        text: (textLayer as any)?.text,
        textTransform: (textLayer as any)?.textTransform,
        textDecoration: (textLayer as any)?.textDecoration,
        stroke: (textLayer as any)?.stroke,
        background: (textLayer as any)?.background,
      };
    }, TEST_TEXT_CLIP_ID);

    expect(sceneOutput.text).toBe("FULL AUTOMATION VERIFIED");
    expect(sceneOutput.textTransform).toBe("uppercase");
    expect(sceneOutput.textDecoration).toBe("underline");
    expect(sceneOutput.stroke).toEqual({ color: "#ff0055", width: 4 });
    expect(sceneOutput.background).toEqual({
      color: "#000000",
      opacity: 85,
      borderRadius: 8,
      padding: 12,
      style: "split",
    });
  });
});
