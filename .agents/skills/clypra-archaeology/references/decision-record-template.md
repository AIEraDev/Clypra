# Decision record template

Use one record per real decision. A decision is a choice between alternatives that someone could reasonably have made differently. A function that merely exists is not a decision.

```
### D<n>. <Decision stated as a choice, present tense>
**Confidence:** Confirmed | Supported | Inferred | Unknown

**Context.** The problem or constraint at the time, with the date or version.
**Alternatives.** What else was possible (stated in sources, visible in deleted code, or obvious from the constraint — say which).
**Why this won.** The reasoning, in the author's terms where a source records it.
**Trade-offs accepted.** What this costs, limits or defers.
**Still true today?** Has the context changed, been reversed, or been superseded? Cite the later commit/doc.
**Evidence.** `path:line`, `hash`, `#PR`, doc §, measurement (with build type / hardware / n).
**Settles it if unclear.** (Only for Inferred/Unknown) who to ask or which experiment to run.
```

Rules of thumb:
- "Why this won" must come from evidence. If it comes from you, the record is Inferred at best.
- Quote a source only when its exact wording is the evidence; otherwise paraphrase and cite.
- If two sources disagree, record both and say which is newer; do not average them.
- Keep records short: roughly 6–12 lines. Detail belongs in the evidence list.

---

## Worked example (condensed; illustrative, verified at commit d649b330)

> Question: "Why does the native preview have an 'embedded only' flag, and why was it a problem?"

### D1. Native preview renders inside the editor canvas region, not in a free-floating OS window
**Confidence:** Confirmed (decision), Inferred (how well the later child-window work fits it)

**Context.** Sept 2026: the native preview was shown in a separate Tauri/OS window.
**Alternatives.** Detached OS window (the prior behaviour); embedded presentation in the editor canvas.
**Why this won.** Commit `4aefa98b` (2026-09-29) states the reasons: a detached window could overlap dialogs, show up on a different macOS Space, and fail to track the app window on Windows, X11 and Wayland. Rendering itself was unchanged; only presentation moved.
**Trade-offs accepted.** The commit routed everything through the embedded path, which at that point meant the native-surface code was gated off and the CPU readback bridge carried all frames.
**Still true today?** Partly superseded. See D2, and note the 1.6.0 CHANGELOG entry (#503, #505) describing native *child-window* stacking on macOS. How that coexists with "remove OS window presentation" is **not resolved in what I read** — open question.
**Evidence.** `4aefa98b` body; `src/lib/platform/nativeCore.ts`; `CHANGELOG.md` 1.6.0.

### D2. Native surface is primary; the readback bridge stays as a permanent, reason-coded fallback
**Confidence:** Confirmed

**Context.** Every recorded session on both test machines showed `surfaceAvailable:false`, zero native surfaces and a `policy-override` fallback reason. The cause: `EMBEDDED_PREVIEW_ONLY` evaluated to `true` unconditionally, so the native path was never exercised and all performance work had measured the bridge.
**Alternatives.** Bridge only (lowest risk, performance capped by readback and IPC); native primary + bridge fallback; native only (no safety net for driver failures or Linux).
**Why this won.** `docs/preview/NATIVE_SURFACE_ARCHITECTURE.md` §2 lays out the three routes, picks native-first with a capability probe and a reason code on every fallback, and sets decision gates in advance: cause found, macOS A/B (47/47 frames native, ≥2× on all metrics), and a time-boxed Windows gate with an explicit kill rule.
**Trade-offs accepted.** Per-platform surface work; the Windows gate was still open when that doc was written.
**Still true today?** The flag now defaults to `false` and is opt-out via `VITE_CLYPRA_NATIVE_SURFACE=0`; `AGENTS.md` invariants 6 and 13 encode "native default, verify the runtime presenter".
**Evidence.** Doc §2, §3 "Production"; `nativeCore.ts`; `AGENTS.md` §2 inv. 6, 13; `CHANGELOG.md` #436 (telemetry that only recorded on cache misses hid the bridge's behaviour).

### What this example shows
- The "why" was split across a commit body, an ADR-style doc and a CHANGELOG entry, so no single file told the story.
- An older belief ("always hardcoded true") was true *at one point in time* and false later; dates decide.
- One unresolved tension was reported as an open question instead of being smoothed over.
