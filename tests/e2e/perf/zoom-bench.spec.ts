/**
 * Zoom benchmark: measures wheel-zoom behaviour from OUTSIDE the app, so the exact same file runs on master
 * and on a feature branch (neither needs a telemetry collector).
 *
 * What it measures, per run:
 *   traversal  notches needed to cross the zoom range, for each wheel delta in BENCH_DELTAS
 *   settle     per-notch time to 50/90/99 % of the move and to "visually settled" (0.5 px at the lane edge)
 *   burst      final zoom after a fast 10-notch spin (shows whether input is merged or lost)
 *   frames     rAF frame deltas and long tasks while the same scripted gesture runs
 *
 * How it reads zoom: in the Vite dev server it dynamically imports the app's own timeline store
 * ("/src/store/timelineStore.ts" resolves to the same module instance the app uses) and samples
 * `pixelsPerSecond` once per animation frame. Frame timing is recorded in a separate phase that does
 * no sampling, so the measurement itself does not disturb it.
 *
 * Limits (keep them in the report): dev server, Chromium, mocked Tauri, empty project. Numbers are for
 * RELATIVE comparison between two checkouts on one machine. They do not describe WKWebView on a Mac;
 * the in-app `timeline-zoom-rollup` telemetry covers that.
 *
 * Env: BENCH_LABEL, BENCH_ROUND, BENCH_OUT, BENCH_DPR (2), BENCH_LANE_WIDTH (1200),
 *      BENCH_DELTAS ("100,15"), BENCH_X / BENCH_Y (mouse position override), BENCH_REFRESH_MS (16.67)
 */
import { test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installTauriMock } from "../mocks/tauriMock";
// @ts-ignore plain ESM helper shared with the driver and its unit tests
import { frameStats, settleMetrics, traversalNotches } from "../../../scripts/benchmarks/zoom-bench/analyze.mjs";

const LABEL = process.env.BENCH_LABEL ?? "unlabelled";
const ROUND = Number(process.env.BENCH_ROUND ?? 1);
const OUT = process.env.BENCH_OUT ?? "test-results/zoom-bench";
const DPR = Number(process.env.BENCH_DPR ?? 2);
const LANE = Number(process.env.BENCH_LANE_WIDTH ?? 1200);
const REFRESH_MS = Number(process.env.BENCH_REFRESH_MS ?? 1000 / 60);
const DELTAS = (process.env.BENCH_DELTAS ?? "100,15")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

test.use({ deviceScaleFactor: DPR });
test.setTimeout(10 * 60 * 1000);

const LABEL_RE = /^(\d+f|\d{1,2}:\d{2}(:\d{2})?)$/;

test("zoom benchmark", async ({ page }) => {
  // ---- in-page recorder -------------------------------------------------------------------------
  await page.addInitScript(() => {
    const W = window as any;
    const z = {
      active: false,
      sampling: false,
      store: null as any,
      deltas: new Float64Array(16384),
      n: 0,
      last: 0,
      samples: [] as number[][],
      wheelTimes: [] as number[],
      long: [] as number[],
    };
    W.__zb = z;
    const loop = (t: number) => {
      if (z.active) {
        if (z.last && z.n < z.deltas.length) z.deltas[z.n++] = t - z.last;
        z.last = t;
      } else {
        z.last = 0;
      }
      if (z.sampling && z.store) z.samples.push([t, z.store.getState().pixelsPerSecond]);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.addEventListener("wheel", () => z.wheelTimes.push(performance.now()), { capture: true, passive: true });
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) z.long.push(e.duration);
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask not supported */
    }
  });

  // ---- open an editor with the existing Tauri mock ----------------------------------------------
  await installTauriMock(page, { recentProjects: [], defaultMediaDuration: 12.0 });
  await page.goto("/");
  await page.getByRole("button", { name: "New Project" }).click();
  const rulerLabel = page.locator("span").filter({ hasText: LABEL_RE }).first();
  await rulerLabel.waitFor({ state: "visible", timeout: 30_000 });

  // Passed as a STRING on purpose: Playwright's TypeScript transform can rewrite a dynamic import() inside a
  // function body into require(), which does not exist in the page. A string is evaluated untouched.
  await page.evaluate(
    `import("/src/store/timelineStore.ts").then((m) => { window.__zb.store = m.useTimelineStore; })`,
  );
  const readPps = (): Promise<number> =>
    page.evaluate(() => (window as any).__zb.store?.getState().pixelsPerSecond ?? NaN);
  const initial = await readPps();
  if (!Number.isFinite(initial)) {
    throw new Error("Could not read pixelsPerSecond from the timeline store (is this the Vite dev server?)");
  }

  // ---- mouse position: over the ruler -----------------------------------------------------------
  const box = await rulerLabel.boundingBox();
  const mx = Number(process.env.BENCH_X ?? (box ? box.x + 200 : 720));
  const my = Number(process.env.BENCH_Y ?? (box ? box.y + 10 : 700));
  await page.mouse.move(mx, my);
  await page.keyboard.down("Control"); // zoom gesture on both master and branch (the app accepts Ctrl or Cmd)

  // ---- helpers ----------------------------------------------------------------------------------
  const wheel = (dy: number) => page.mouse.wheel(0, dy); // dy > 0 zooms out, dy < 0 zooms in
  async function drive(dy: number, count: number, gapMs: number) {
    for (let i = 0; i < count; i++) {
      await wheel(dy);
      if (gapMs > 0) await page.waitForTimeout(gapMs);
    }
  }
  /** Resolve when zoom has not changed by more than 1e-5 (log) for 200 ms, or after maxMs. */
  const waitSettled = (maxMs = 4000) =>
    page.evaluate(
      (maxMs) =>
        new Promise<void>((resolve) => {
          const z = (window as any).__zb;
          const t0 = performance.now();
          let ref = z.store.getState().pixelsPerSecond;
          let refT = t0;
          const tick = () => {
            const now = performance.now();
            const p = z.store.getState().pixelsPerSecond;
            if (Math.abs(Math.log(p / ref)) > 1e-5) {
              ref = p;
              refT = now;
            }
            if (now - refT >= 200 || now - t0 >= maxMs) return resolve();
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      maxMs,
    );
  const goToMin = async () => {
    await drive(+100, 70, 100);
    await waitSettled();
  };
  const goToMax = async () => {
    await drive(-100, 70, 100);
    await waitSettled();
  };
  const startFrames = () =>
    page.evaluate(() => {
      const z = (window as any).__zb;
      z.n = 0;
      z.last = 0;
      z.long.length = 0;
      z.active = true;
    });
  const stopFrames = () =>
    page.evaluate(() => {
      const z = (window as any).__zb;
      z.active = false;
      return { deltas: Array.from(z.deltas.slice(0, z.n)) as number[], long: [...z.long] as number[] };
    });

  // ---- warm-up (Vite transforms, JIT) and range discovery ---------------------------------------
  await goToMax();
  await goToMin();
  const minPps = await readPps();
  await goToMax();
  const maxPps = await readPps();
  if (!(maxPps / minPps > 1.5)) {
    throw new Error(
      `Wheel had no effect (min ${minPps}, max ${maxPps}). Check the mouse position (BENCH_X/BENCH_Y) and the zoom gesture.`,
    );
  }

  // ---- traversal + per-notch settle -------------------------------------------------------------
  const traversal: Record<string, unknown> = {};
  const settle: Record<string, unknown[]> = {};
  for (const dy of DELTAS) {
    await goToMin();
    const trajectory: number[] = [];
    const perNotch: unknown[] = [];
    for (let i = 0; i < 60; i++) {
      await page.evaluate(() => {
        const z = (window as any).__zb;
        z.samples.length = 0;
        z.wheelTimes.length = 0;
        z.sampling = true;
      });
      await wheel(-dy);
      await waitSettled();
      const { samples, tStart } = await page.evaluate(() => {
        const z = (window as any).__zb;
        z.sampling = false;
        return { samples: z.samples.map((s: number[]) => [s[0], s[1]]), tStart: z.wheelTimes[0] ?? 0 };
      });
      const pps = await readPps();
      trajectory.push(pps);
      perNotch.push(settleMetrics(samples, tStart, LANE));
      if (pps >= maxPps * 0.995) break;
    }
    traversal[`dy${dy}`] = { ...traversalNotches(trajectory, minPps, maxPps), trajectory };
    settle[`dy${dy}`] = perNotch;
  }

  // ---- burst: 10 fast notches from the minimum ---------------------------------------------------
  const burst: Record<string, unknown> = {};
  for (const dy of DELTAS) {
    await goToMin();
    const before = await readPps();
    await startFrames();
    await drive(-dy, 10, 25);
    await waitSettled();
    const f = await stopFrames();
    const after = await readPps();
    burst[`dy${dy}`] = {
      startPps: before,
      finalPps: after,
      logRangeCovered: Math.log(after / before) / Math.log(maxPps / minPps),
      frames: frameStats(f.deltas, REFRESH_MS),
    };
  }

  // ---- frames: the same scripted gesture on both builds (no store sampling) ---------------------
  await goToMin();
  await startFrames();
  await drive(-100, 14, 120); // zoom in
  await page.waitForTimeout(600);
  await drive(+100, 14, 120); // zoom out
  await page.waitForTimeout(600);
  const fr = await stopFrames();
  const frames = {
    ...frameStats(fr.deltas, REFRESH_MS),
    longTasks: { count: fr.long.length, totalMs: fr.long.reduce((a, b) => a + b, 0), maxMs: Math.max(0, ...fr.long) },
  };

  await page.keyboard.up("Control");

  // ---- write the result -------------------------------------------------------------------------
  const env = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    userAgent: navigator.userAgent,
  }));
  const result = {
    schema: 1,
    label: LABEL,
    round: ROUND,
    capturedAt: new Date().toISOString(),
    env: {
      ...env,
      browser: page.context().browser()?.version() ?? "unknown",
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      memGB: Math.round(os.totalmem() / 2 ** 30),
      mode: "vite-dev, chromium, mocked-tauri, empty-project",
      laneWidthPx: LANE,
      refreshMs: REFRESH_MS,
      deltas: DELTAS,
    },
    range: { minPps, maxPps },
    traversal,
    settle,
    burst,
    frames,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${LABEL}-r${ROUND}.json`), JSON.stringify(result, null, 2));
});
