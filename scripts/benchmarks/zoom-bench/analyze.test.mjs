import test from "node:test";
import assert from "node:assert/strict";
import { percentile, median, frameStats, settleMetrics, traversalNotches } from "./analyze.mjs";

test("percentile uses nearest rank", () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(s, 50), 5);
  assert.equal(percentile(s, 95), 10);
  assert.equal(percentile([], 50), null);
});

test("median handles odd, even and non-finite", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([NaN, 5]), 5);
});

test("frameStats flags missed frames relative to refresh", () => {
  const d = [...Array(95).fill(16.7), 40, 40, 40, 120, 120];
  const s = frameStats(d);
  assert.equal(s.n, 100);
  assert.equal(s.over1_5x, 5);
  assert.equal(s.over6x, 2);
  assert.equal(s.max, 120);
  assert.equal(frameStats([12, 12, 12], 8.333).over1_5x, 0); // 120 Hz: 12 ms is not a miss
});

// Synthetic exponential approach in log space with a known time constant.
function series(tauMs, ratio, dtMs = 1000 / 60, durMs = 2000, startPps = 100) {
  const out = [];
  const total = Math.log(ratio);
  for (let t = 0; t <= durMs; t += dtMs) out.push([t, startPps * Math.exp(total * (1 - Math.exp(-t / tauMs)))]);
  return out;
}

test("settleMetrics recovers known time constants", () => {
  const tau = 50;
  const m = settleMetrics(series(tau, 2.5), 0, 1200);
  assert.ok(m.moved && m.settledAtEnd);
  assert.ok(Math.abs(m.t50 - tau * Math.log(2)) < 20, `t50=${m.t50}`);
  assert.ok(Math.abs(m.t90 - tau * Math.log(10)) < 20, `t90=${m.t90}`);
  assert.ok(Math.abs(m.t99 - tau * Math.log(100)) < 20, `t99=${m.t99}`);
  assert.ok(m.tVisual > m.t99);
});

test("settleMetrics reports no movement", () => {
  const flat = Array.from({ length: 10 }, (_, i) => [i * 16, 500]);
  assert.deepEqual(settleMetrics(flat, 0), { moved: false });
});

test("settleMetrics flags a move that has not settled by the end", () => {
  const m = settleMetrics(series(400, 2.5, 1000 / 60, 500), 0, 1200);
  assert.equal(m.settledAtEnd, false);
});

test("traversalNotches counts notches to cover the log range", () => {
  const min = 10, max = 6000, step = Math.pow(max / min, 1 / 7);
  const trace = Array.from({ length: 12 }, (_, i) => Math.min(max, min * step ** (i + 1)));
  const r = traversalNotches(trace, min, max);
  assert.equal(r.reached, true);
  assert.equal(r.notches, 7);
  const slow = Array.from({ length: 30 }, (_, i) => Math.min(500, 10 * 1.246 ** (i + 1)));
  assert.equal(traversalNotches(slow, 10, 500).notches, 18);
  assert.equal(traversalNotches([20, 30], 10, 500).reached, false);
});
