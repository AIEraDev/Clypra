#!/usr/bin/env node
// Runs the same zoom benchmark on two Clypra checkouts (for example master and a feature branch) in a
// counterbalanced order (A B, B A, A B, ...) and writes summary.json + summary.md.
//
//   (add --aggregate-only to rebuild the report from an existing --out folder)
//   node scripts/benchmarks/zoom-bench/run-interleaved.mjs \
//     --a ../clypra-master --b . --label-a master --label-b branch --rounds 5 --out bench-out
//
// Use `git worktree add ../clypra-master master` for the baseline, run `npm ci` in both checkouts, and
// close anything listening on port 5173 (Playwright would reuse it and measure the wrong checkout).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { median } from "./analyze.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(here, "../../..");
const KIT_FILES = [
  "tests/e2e/perf/zoom-bench.spec.ts",
  "scripts/benchmarks/zoom-bench/analyze.mjs",
  "playwright.perf.config.ts",
];

// ---- args ---------------------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const need = (k) => {
  if (!args[k]) {
    console.error(`Missing --${k}. See the header of this file for usage.`);
    process.exit(2);
  }
  return args[k];
};
const aggregateOnly = "aggregate-only" in args;
const repoA = path.resolve(aggregateOnly ? (args.a ?? ".") : need("a"));
const repoB = path.resolve(aggregateOnly ? (args.b ?? ".") : need("b"));
const labelA = args["label-a"] ?? "A";
const labelB = args["label-b"] ?? "B";
const rounds = Number(args.rounds ?? 5);
const out = path.resolve(args.out ?? "zoom-bench-out");
const common = {
  BENCH_DPR: args.dpr ?? "2",
  BENCH_LANE_WIDTH: args["lane-width"] ?? "1200",
  BENCH_DELTAS: args.deltas ?? "100,15",
  BENCH_REFRESH_MS: args["refresh-ms"] ?? String(1000 / 60),
};

// ---- preflight ----------------------------------------------------------------------------------
const sh = (cwd, cmd, a) => spawnSync(cmd, a, { cwd, encoding: "utf8" }).stdout?.trim() ?? "";
function repoInfo(dir, label) {
  if (!fs.existsSync(path.join(dir, "package.json"))) throw new Error(`${label}: no package.json in ${dir}`);
  if (!fs.existsSync(path.join(dir, "node_modules"))) throw new Error(`${label}: run \`npm ci\` in ${dir} first`);
  return {
    dir,
    sha: sh(dir, "git", ["rev-parse", "--short", "HEAD"]),
    branch: sh(dir, "git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: sh(dir, "git", ["status", "--porcelain"]).split("\n").filter((l) => l && !l.includes("zoom-bench")).length > 0,
  };
}
const infoA = aggregateOnly ? { dir: repoA, sha: "n/a", branch: "n/a", dirty: false } : repoInfo(repoA, labelA);
const infoB = aggregateOnly ? { dir: repoB, sha: "n/a", branch: "n/a", dirty: false } : repoInfo(repoB, labelB);

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}
if (!aggregateOnly && (await portBusy(5173))) {
  console.error("Port 5173 is in use. Stop the running dev server; Playwright would reuse it and measure the wrong checkout.");
  process.exit(2);
}

for (const repo of aggregateOnly ? [] : [repoA, repoB]) {
  for (const f of KIT_FILES) {
    const src = path.join(kitRoot, f);
    const dst = path.join(repo, f);
    if (path.resolve(src) === path.resolve(dst)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
fs.mkdirSync(out, { recursive: true });

// ---- run ----------------------------------------------------------------------------------------
const targets = { [labelA]: repoA, [labelB]: repoB };
for (let r = 1; r <= (aggregateOnly ? 0 : rounds); r++) {
  const order = r % 2 ? [labelA, labelB] : [labelB, labelA]; // counterbalanced
  for (const label of order) {
    console.log(`\n=== round ${r}/${rounds}: ${label} (${targets[label]}) ===`);
    const res = spawnSync(
      "npx",
      ["playwright", "test", "--config=playwright.perf.config.ts", "--project=chromium", "--reporter=line"],
      {
        cwd: targets[label],
        stdio: "inherit",
        env: { ...process.env, ...common, BENCH_LABEL: label, BENCH_ROUND: String(r), BENCH_OUT: out },
      },
    );
    if (res.status !== 0) console.error(`!! run failed (${label}, round ${r}); continuing, round will be missing`);
  }
}

// ---- aggregate ----------------------------------------------------------------------------------
const runs = fs
  .readdirSync(out)
  .filter((f) => /-r\d+\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")));
const by = (label) => runs.filter((x) => x.label === label);
const dys = (runs[0]?.env.deltas ?? [100]).map((d) => `dy${d}`);
const settleVals = (run, dy, key) =>
  (run.settle?.[dy] ?? []).filter((m) => m && m.moved && m[key] != null).map((m) => m[key]);

const metrics = [];
const add = (name, unit, fn, budget) => metrics.push({ name, unit, fn, budget });
for (const dy of dys) {
  const isNotch = dy === "dy100"; // budgets only apply to a real wheel notch, not to small trackpad-like deltas
  add(`notches to cross range (${dy})`, "notches", (x) => x.traversal?.[dy]?.notches ?? NaN, isNotch ? { max: 7, note: "target 6-7" } : undefined);
  add(`settle t90 median (${dy})`, "ms", (x) => median(settleVals(x, dy, "t90")));
  add(`settle t99 median (${dy})`, "ms", (x) => median(settleVals(x, dy, "t99")), isNotch ? { max: 250, note: "proposed" } : undefined);
  add(`visual settle median (${dy})`, "ms", (x) => median(settleVals(x, dy, "tVisual")), isNotch ? { max: 400, note: "proposed" } : undefined);
  add(`range covered by 10-notch burst (${dy})`, "of log range", (x) => x.burst?.[dy]?.logRangeCovered ?? NaN);
}
add("min zoom reached", "px/s", (x) => x.range.minPps);
add("max zoom reached", "px/s", (x) => x.range.maxPps);
add("frame p50", "ms", (x) => x.frames.p50);
add("frame p95", "ms", (x) => x.frames.p95, { max: 18, note: "indicative, 60 Hz" });
add("frame p99", "ms", (x) => x.frames.p99);
add("frame max", "ms", (x) => x.frames.max);
add("frames > 1.5x refresh", "count", (x) => x.frames.over1_5x);
add("frames > 6x refresh (stalls)", "count", (x) => x.frames.over6x, { max: 0 });
add("long tasks", "count", (x) => x.frames.longTasks.count);
add("long task total", "ms", (x) => x.frames.longTasks.totalMs);

const agg = (label, fn) => {
  const v = by(label).map(fn).filter(Number.isFinite);
  return { n: v.length, median: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
};
const fmt = (n) => (n == null || !Number.isFinite(n) ? "n/a" : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));
const rows = metrics.map((m) => {
  const a = agg(labelA, m.fn);
  const b = agg(labelB, m.fn);
  const ratio = a.median && b.median != null ? b.median / a.median : null;
  const noisy = [a, b].some((s) => s.median && s.n > 1 && (s.max - s.min) / Math.abs(s.median) > 0.25);
  const pass = m.budget?.max != null && b.median != null ? b.median <= m.budget.max : null;
  return { metric: m.name, unit: m.unit, a, b, ratio, noisy, budget: m.budget, pass };
});

const md = [];
md.push(`# Zoom benchmark: ${labelA} vs ${labelB}`);
md.push("");
md.push(`- ${labelA}: ${infoA.branch} @ ${infoA.sha}${infoA.dirty ? " (dirty tree)" : ""}`);
md.push(`- ${labelB}: ${infoB.branch} @ ${infoB.sha}${infoB.dirty ? " (dirty tree)" : ""}`);
md.push(`- rounds requested: ${rounds}; completed: ${labelA} ${by(labelA).length}, ${labelB} ${by(labelB).length}; order counterbalanced (ABBA...)`);
md.push(`- machine: ${os.platform()} ${os.release()} ${os.arch()}, ${os.cpus()[0]?.model}, ${Math.round(os.totalmem() / 2 ** 30)} GB`);
if (runs[0]) md.push(`- environment: ${runs[0].env.mode}; ${runs[0].env.browser}; DPR ${runs[0].env.dpr}; lane ${runs[0].env.laneWidthPx}px; wheel deltas ${runs[0].env.deltas.join(", ")}`);
md.push("");
md.push(`| metric | unit | ${labelA} median (min-max) | ${labelB} median (min-max) | ratio ${labelB}/${labelA} | budget (${labelB}) | flags |`);
md.push("|---|---|---|---|---|---|---|");
for (const r of rows) {
  const cell = (s) => `${fmt(s.median)} (${fmt(s.min)}-${fmt(s.max)}) n=${s.n}`;
  const bud = r.budget?.max != null ? `<= ${r.budget.max}${r.budget.note ? ` (${r.budget.note})` : ""} ${r.pass == null ? "" : r.pass ? "PASS" : "FAIL"}` : (r.budget?.note ?? "");
  md.push(`| ${r.metric} | ${r.unit} | ${cell(r.a)} | ${cell(r.b)} | ${r.ratio == null ? "n/a" : r.ratio.toFixed(2)} | ${bud} | ${r.noisy ? "noisy (>25% spread)" : ""} |`);
}
md.push("");
const warnings = [];
if (Math.min(by(labelA).length, by(labelB).length) < 5) warnings.push("fewer than 5 completed rounds per build: treat as indicative only");
if (infoA.dirty || infoB.dirty) warnings.push("a working tree has uncommitted changes");
if (rows.some((r) => r.noisy)) warnings.push("some metrics vary by more than 25% across rounds: do not draw conclusions from small differences");
md.push("## Read this before quoting numbers");
md.push("- Dev server, Chromium, mocked Tauri, empty project: valid for RELATIVE comparison on this machine only. It does not measure WKWebView, the native preview, or filmstrip decoding.");
md.push("- Frame timing is the cost of the same scripted input on each build, not the same amount of visual zoom (the new build zooms further per notch).");
md.push("- Budgets marked 'proposed' or 'indicative' are not enforced contract values.");
for (const w of warnings) md.push(`- WARNING: ${w}`);
fs.writeFileSync(path.join(out, "summary.md"), md.join("\n"));
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify({ infoA, infoB, rounds, rows, warnings }, null, 2));
console.log(`\n${md.join("\n")}\n\nWrote ${path.join(out, "summary.md")}`);
