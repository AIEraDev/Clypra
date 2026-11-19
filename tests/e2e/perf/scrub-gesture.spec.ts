import { test, expect } from "@playwright/test";
import { installTauriMock } from "../mocks/tauriMock";
// @ts-ignore — this is a small ESM benchmark helper without a package declaration.
import { buildScrubGesture } from "../../../scripts/benchmarks/scrub-gesture.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const direction = process.env.SCRUB_DIRECTION === "backward" ? "backward" : "forward";
const runId = process.env.SCRUB_RUN_ID ?? `browser-${direction}`;
const experimentId = process.env.SCRUB_EXPERIMENT_ID ?? "scrub-v1";
const cacheCleared = process.env.SCRUB_CACHE_CLEARED === "true";
const backgroundDecodeDisabled = process.env.SCRUB_BACKGROUND_DECODE_DISABLED === "true";
const artifactPath = resolve(process.env.SCRUB_ARTIFACT ?? `test-results/scrub-gesture-${runId}.json`);

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

test(`controlled ${direction} scrub gesture`, async ({ page }) => {
  await page.addInitScript(() => {
    const state = { moves: [] as Array<{ x: number; y: number; time: number }> };
    (window as unknown as { __controlledScrub?: typeof state }).__controlledScrub = state;
    window.addEventListener(
      "pointermove",
      (event) => state.moves.push({ x: event.clientX, y: event.clientY, time: performance.now() }),
      { capture: true, passive: true },
    );
  });
  await installTauriMock(page, { recentProjects: [], defaultMediaDuration: 30 });
  await page.goto("/");
  await page.getByRole("button", { name: "New Project" }).click();
  const projectLoadingDialog = page.locator('[role="dialog"][aria-busy="true"]');
  await expect(projectLoadingDialog).toBeVisible({ timeout: 30_000 });
  await expect(projectLoadingDialog).toBeHidden({ timeout: 30_000 });

  // The browser mock intentionally starts with an empty project. Seed one
  // valid media asset through the same placement service used by the editor so
  // the controlled gesture exercises the real timeline/ruler/playhead path.
  // Do not bypass the store with ad-hoc DOM events: that would make a passing
  // benchmark unrelated to the interaction under test.
  await page.evaluate(async () => {
    const fixture = {
      id: "controlled-scrub-video",
      name: "Controlled scrub fixture",
      path: "/fixtures/controlled-scrub.mp4",
      previewPath: "/fixtures/controlled-scrub.mp4",
      type: "video" as const,
      duration: 30,
      width: 1920,
      height: 1080,
      size: 1,
    };
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    useProjectStore.getState().addMediaAsset(fixture);
    const { TimelinePlacementEngine } = await import(
      "/src/lib/timeline/placementEngine.ts"
    );
    const result = await TimelinePlacementEngine.addToTimeline({
      type: "media",
      playheadTime: 0,
      item: fixture,
    });
    if (!result.success) {
      throw new Error(result.error ?? "failed to seed controlled scrub fixture");
    }
    const { useTimelineStore } = await import("/src/store/timelineStore.ts");
    const state = useTimelineStore.getState();
    if (state.clips.length === 0 || state.tracks.length === 0) {
      throw new Error(
        `controlled scrub fixture did not reach timeline state (tracks=${state.tracks.length}, clips=${state.clips.length})`,
      );
    }
  });

  const ruler = page.locator('[data-timeline-ruler="true"]').first();
  await expect(ruler).toBeVisible({ timeout: 30_000 });
  const rulerBox = await ruler.boundingBox();
  if (!rulerBox) throw new Error("timeline ruler has no layout box");

  if (direction === "backward") {
    await page.mouse.click(rulerBox.x + Math.min(900, rulerBox.width - 40), rulerBox.y + rulerBox.height / 2);
    await page.waitForTimeout(100);
  }

  const handle = page.locator('[data-playhead-hit-target="true"]').first();
  await expect(handle).toBeVisible({ timeout: 10_000 });
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("playhead hit target has no layout box");

  const startX = handleBox.x + handleBox.width / 2;
  const travel = Math.min(640, Math.max(240, rulerBox.width * 0.55));
  const gesture = buildScrubGesture({
    direction,
    startX,
    endX: direction === "backward" ? startX - travel : startX + travel,
    y: handleBox.y + Math.min(handleBox.height / 2, 12),
    steps: Number(process.env.SCRUB_STEPS ?? 48),
    durationMs: Number(process.env.SCRUB_DURATION_MS ?? 1_200),
  });

  await page.evaluate(() => {
    const state = (window as unknown as { __controlledScrub?: { moves: unknown[] } }).__controlledScrub;
    if (state) state.moves.length = 0;
  });
  await page.mouse.move(gesture.points[0].x, gesture.points[0].y);
  await page.mouse.down();
  for (let index = 1; index < gesture.points.length; index += 1) {
    const point = gesture.points[index];
    await page.mouse.move(point.x, point.y);
    const gap = point.offsetMs - gesture.points[index - 1].offsetMs;
    if (gap > 0) await page.waitForTimeout(gap);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  const observed = await page.evaluate(() => {
    const state = (window as unknown as { __controlledScrub?: { moves: Array<{ x: number; y: number; time: number }> } }).__controlledScrub;
    return { moves: state?.moves ?? [] };
  });
  const xValues = observed.moves.map((move) => move.x);
  const monotonic = xValues.every((x, index) => index === 0 || (direction === "forward" ? x >= xValues[index - 1] : x <= xValues[index - 1]));
  expect(observed.moves.length).toBeGreaterThanOrEqual(gesture.steps - 2);
  expect(monotonic).toBe(true);

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify({
    schemaVersion: 1,
    experimentContext: { experimentId, runId, cacheCleared, backgroundDecodeDisabled },
    runId,
    direction,
    gesture,
    observed,
    status: "passed",
  }, null, 2)}\n`);
});

