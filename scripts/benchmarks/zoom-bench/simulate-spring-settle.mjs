// Compares the OLD zoom spring (22 % of the gap per frame, absolute 0.08 px/s settle) with the log-space,
// time-based replacement across notch sizes, start zoom, and display refresh rates.
// Usage: node scripts/benchmarks/zoom-bench/simulate-spring-settle.mjs [laneWidthPx]
const lane = Number(process.argv[2] ?? 1200);
const eps = Math.min(1e-2, Math.max(1e-5, 0.5 / lane));
const tol = Math.log1p(eps);

function oldSpring(start, target, hz) {
  const dt = 1000 / hz;
  // The old constant was per FRAME, so it is not scaled by dt: this is exactly the refresh-rate bug.
  let c = start, t = 0, t90 = null, t99 = null, settledAbs = null, visual = 0;
  const total = Math.log(target / start);
  for (let i = 1; i < 4000; i++) {
    c += (target - c) * 0.22;
    t = i * dt;
    const p = Math.log(c / start) / total;
    if (t90 === null && p >= 0.9) t90 = t;
    if (t99 === null && p >= 0.99) t99 = t;
    if (Math.abs(Math.log(c / target)) > tol) visual = t + dt;
    if (settledAbs === null && Math.abs(target - c) < 0.08) { settledAbs = t; break; }
  }
  return { t90, t99, visual, settledAbs };
}

function newSpring(start, target, hz, tau) {
  const dt = 1000 / hz;
  let c = start, t90 = null, t99 = null, visual = 0;
  const total = Math.log(target / start);
  for (let i = 1; i < 4000; i++) {
    const a = 1 - Math.exp(-Math.min(dt, 50) / tau);
    c = Math.exp(Math.log(c) + a * (Math.log(target) - Math.log(c)));
    const t = i * dt;
    const p = Math.log(c / start) / total;
    if (t90 === null && p >= 0.9) t90 = t;
    if (t99 === null && p >= 0.99) t99 = t;
    if (Math.abs(Math.log(c / target)) > tol) visual = t + dt;
    if (t > 1500) break;
  }
  return { t90, t99, visual };
}

const f = (x) => (x == null ? "  n/a" : String(Math.round(x)).padStart(5));
console.log(`lane width ${lane} px -> visual tolerance eps = ${eps.toExponential(2)} (0.5 px at the lane edge)\n`);
console.log("times in ms after the notch.  t90/t99 = share of the log distance covered;  visual = last frame that could still be >= 0.5 px off;  abs = old 0.08 px/s rule\n");

for (const [label, ratio] of [["old clamp step x1.246", 1.246], ["new notch step x2.49", 2.49]]) {
  for (const start of [100, 1000, 2400]) {
    const target = start * ratio;
    console.log(`${label}, from ${start} to ${Math.round(target)} px/s`);
    console.log("  spring                     refresh   t90   t99  visual    abs");
    for (const hz of [60, 120]) {
      const o = oldSpring(start, target, hz);
      console.log(`  OLD 0.22/frame             ${String(hz).padStart(4)}Hz ${f(o.t90)} ${f(o.t99)}  ${f(o.visual)} ${f(o.settledAbs)}`);
    }
    for (const tau of [35, 45, 60]) {
      for (const hz of [60, 120]) {
        const n = newSpring(start, target, hz, tau);
        console.log(`  NEW tau=${String(tau).padEnd(2)}ms log-space     ${String(hz).padStart(4)}Hz ${f(n.t90)} ${f(n.t99)}  ${f(n.visual)}      -`);
      }
    }
    console.log();
  }
}
