// Pure analysis helpers for the zoom benchmark. No browser, no repo imports, so they can be unit tested
// with `node --test scripts/benchmarks/zoom-bench/analyze.test.mjs`.

/** Nearest-rank percentile of an already-sorted ascending array. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

export function median(values) {
  const s = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Frame-time statistics from rAF deltas (ms).
 * Thresholds are relative to the display refresh so they stay meaningful on 60 and 120 Hz screens.
 */
export function frameStats(deltas, refreshMs = 1000 / 60) {
  const d = Array.from(deltas).filter((x) => Number.isFinite(x) && x > 0);
  if (!d.length) return { n: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const over = (k) => d.filter((x) => x > refreshMs * k).length;
  return {
    n: d.length,
    refreshMs,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    over1_5x: over(1.5), // at least one missed frame
    over2x: over(2),
    over6x: over(6), // roughly >100 ms at 60 Hz: a visible stall
  };
}

/**
 * Settle metrics for one zoom move.
 * samples: [[tMs, pps], ...] sampled once per animation frame, ascending time.
 * tStartMs: time of the input that started the move.
 * laneWidthPx: visible timeline width; sets the visual tolerance (0.5 px at the viewport edge).
 *
 * Zoom is multiplicative, so progress is measured in log space:
 *   progress(t) = ln(pps(t)/start) / ln(final/start).
 * "visual" settle = the last frame at which the ruler could still be off by >= 0.5 px anywhere in view,
 * i.e. |ln(pps/final)| > ln(1 + 0.5/laneWidth). All values are ms after tStartMs.
 */
export function settleMetrics(samples, tStartMs, laneWidthPx = 1200) {
  const s = samples.filter(([t, p]) => Number.isFinite(t) && Number.isFinite(p) && p > 0);
  if (s.length < 3) return null;
  const before = s.filter(([t]) => t <= tStartMs);
  const start = (before.length ? before[before.length - 1] : s[0])[1];
  const final = s[s.length - 1][1];
  const total = Math.log(final / start);
  if (Math.abs(total) < 1e-6) return { moved: false };
  const after = s.filter(([t]) => t >= tStartMs);
  const firstAt = (frac) => {
    const hit = after.find(([, p]) => Math.log(p / start) / total >= frac);
    return hit ? hit[0] - tStartMs : null;
  };
  const tol = Math.log(1 + 0.5 / laneWidthPx);
  let lastOutside = -1;
  after.forEach(([, p], i) => {
    if (Math.abs(Math.log(p / final)) > tol) lastOutside = i;
  });
  const visual =
    lastOutside < 0 ? 0 : after[Math.min(after.length - 1, lastOutside + 1)][0] - tStartMs;
  const tail = after.slice(-5);
  const stable = tail.every(([, p]) => Math.abs(Math.log(p / final)) < tol);
  return {
    moved: true,
    startPps: start,
    finalPps: final,
    ratio: final / start,
    t50: firstAt(0.5),
    t90: firstAt(0.9),
    t99: firstAt(0.99),
    tVisual: visual,
    settledAtEnd: stable,
  };
}

/**
 * Number of notches needed to cover `coverage` of the log range [minPps, maxPps].
 * ppsAfterEachNotch[i] is the settled pps after notch i+1, starting from minPps.
 */
export function traversalNotches(ppsAfterEachNotch, minPps, maxPps, coverage = 0.98) {
  const range = Math.log(maxPps / minPps);
  if (!(range > 0)) return { reached: false, notches: null, range };
  for (let i = 0; i < ppsAfterEachNotch.length; i++) {
    const covered = Math.log(ppsAfterEachNotch[i] / minPps) / range;
    if (covered >= coverage) return { reached: true, notches: i + 1, range };
  }
  return { reached: false, notches: null, range };
}
