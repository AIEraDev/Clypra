# Clypra map (snapshot, verified against a checkout at v1.6.0, 25 Oct 2026)

**Treat everything here as a starting hypothesis.** Paths move, flags flip, docs lag. Re-check with `git ls-files | grep`, `git grep`, and the history helper before quoting anything from this file. Section 5 lists places where older beliefs turned out wrong, as a reminder of why.

## Contents
1. Repo family
2. Where intent lives (read these first)
3. Subsystem starting points
4. Invariants and doctrine
5. Drift examples (beliefs that went stale)
6. Question prompts per subsystem

## 1. Repo family
| Repo | Role |
|---|---|
| `clypra` (this checkout) | Desktop editor: Tauri v2 shell, Rust engine, React 19 + TS frontend. Also Capacitor mobile targets (`android/`, `ios/`). |
| `clypra-api` | Cloudflare Workers catalog for effects/templates; GitHub as data store, KV cache, R2 for some assets. |
| `clypra-studio` | Browser authoring tool for effects/templates; PRs go to `clypra-api`. |
| `clypra-packages` | Shared types/shaders (`@clypra/types`, `@clypra/shaders`). |

In-repo crates (`crates/`): `clypra-native-core` (shared contracts), `clypra-native-cli` (golden-frame harness), `clypra-render-wasm` (WASM/WebGPU renderer for Studio).

## 2. Where intent lives (read these before the code)
- `AGENTS.md` — numbered architectural invariants and implementation standards; the closest thing to a constitution.
- `.agents/rules/*.md` — architecture, cross-platform, preview-performance, testing, i18n, diagnostic-logging rules. `.agents/skills/*` — task playbooks (bug hunting, perf log analysis, preview performance, NLE domain) that also record reasoning.
- `docs/architecture/adr/` (currently sparse), `docs/native-migration-adr.md`, `docs/architecture-first-delivery-adr.md`.
- `docs/` subsystem notes, named by topic: `native-architecture.md`, `docs/preview/NATIVE_SURFACE_ARCHITECTURE.md`, `docs/preview/PERFORMANCE_ANALYSIS_AND_ROUTING.md`, `filmstrip-architecture-and-caching.md`, `text-effects-architecture.md`, `body-effect-rendering.md`, `export-output-resolution.md`, `performance-contract.md`, `performance-telemetry.md`, `native-preview-*`, `preview-audit/`, `compound-clips-and-track-hierarchy.md`, `mathematical-precision-and-invariants.md`, `release-and-updater-pipeline.md`, `accessibility-and-i18n.md`, `engineering/*` (invariants, NLE semantics, testing strategy).
- `CHANGELOG.md` — Keep-a-Changelog style; entries usually give symptom, root cause and PR number in one paragraph. Best single source for "what broke and why it was changed".
- Commit history: ~3,700+ commits, conventional-commit subjects (`feat(scope):`, `fix(scope):`), roughly one in eight referencing a PR number. Bug IDs like `CLY-BUG-0NN` and "Bug N" appear in CHANGELOG and commit bodies. Several authors appear (including bot/agent identities), so treat authorship as weak signal.
- CI workflows (`.github/workflows/`): `ci.yml`, `desktop-e2e.yml`, `native-golden.yml`, `release.yml`, `store-release.yml`. CI config is evidence of what is actually enforced, versus what docs claim.

## 3. Subsystem starting points
Verify each path exists before relying on it.

**Preview / native presenter / playback**
`src/components/editor/preview/NativeProgramPreview.tsx` (render loop, epoch guards), `useNativeSurfaceController.ts`, `src/core/runtime/nativeSurfaceLifecycle.ts`, `src/lib/platform/nativeCore.ts` (TS contract mirror, flags), `src-tauri/src/native_core/` (contracts, service, session, surface), `src-tauri/src/commands/native_playback/`, `src-tauri/src/engine/` (clock, scheduler, presenter, surface, qos, planner, decoder, hardware), `src-tauri/src/wgpu_compositor/` (compositor, frame cache, DXGI import, chroma key, effect interpreter). Docs: `docs/preview/*`, `docs/native-architecture.md`.

**Decode and hardware acceleration**
`src-tauri/src/engine/decoder/` (software, d3d11, d3d12, pool, planner), `src-tauri/src/engine/hardware/`, FFmpeg via `ffmpeg-next` (static feature).

**Audio**
Native: `src-tauri/src/audio/` (mixer, ring buffer, decoder incl. `cli_backend.rs` fallback), `src-tauri/src/native_audio/` (clip, clock, mixer). Web Audio engine in `src/core/audio/`. Export audio is a separate FFmpeg filter graph: `src-tauri/src/commands/export/audio_filter.rs`.

**Export and FFmpeg binaries**
`src-tauri/src/commands/export/` (compositor/fallback pipeline), `src-tauri/src/commands/native_export/` (builder, encoder, executor), `src-tauri/src/commands/binary_resolver/` (locating bundled vs system ffmpeg/ffprobe), `src-tauri/bin/` and `tauri.conf.json` `externalBin` (sidecar), `src-tauri/tests/clean_path_packaged_export_tests.rs`, `THIRD_PARTY_LICENSES.md`, `docs/export-output-resolution.md`, `release.yml`.

**Timeline, history, filmstrip, thumbnails**
`src/components/editor/timeline/` (Clip, Track, TimelineRuler, GapIndicator, `timeToPixel` use sites), `src/store/timelineStore.ts`, `historyStore.ts`, `src/core/history/` (command/transaction pattern), `src/lib/timeline/`, `src-tauri/src/filmstrip_engine*`, `src-tauri/src/commands/filmstrip/`, `docs/filmstrip-architecture-and-caching.md`, `thumbnail-generator-architecture.md`.

**Text, effects, templates, body effects, animation**
`src/features/{text-effects,text-templates,text-animations,templates,body-effects,video-effects,filters,transitions,stickers,subtitles}`, `src/core/animation/`, `src/core/fonts/`, native text contracts in `src-tauri/src/native_core/contracts.rs` and `crates/clypra-native-core`. Docs: `text-effects-architecture.md`, `body-effect-rendering.md`.

**Telemetry, cold start, benchmarks, golden frames**
`src-tauri/src/cold_start/` (milestones, recorder, OS probes), `src-tauri/src/sync_metrics/`, `src-tauri/src/diagnostics*`, `src/services/{telemetryCollector,perfLogService,performanceClient}.ts`, `src/core/telemetry/`, `benchmarks/`, `src/benchmarks/`, `src-tauri/src/golden_harness/`, `crates/clypra-native-cli`, `docs/golden-frame-protocol.md`, `docs/performance-*`, `docs/preview-audit/`. Local runtime logs are NDJSON in the OS app-data `perf_logs/` directory, never inside the repo.

**State, i18n, workers**
`src/store/` (Zustand), `src/core/evaluation/` (EvaluatedScene), `src/core/workers/` + `src/workers/`, `src/i18n/` (catalogs and locales; `npm run i18n:check`).

**Release / platform**
`docs/release-and-updater-pipeline.md`, `docs/platform-surface-matrix.md`, `docs/engineering/platform-compatibility.md`, `src-tauri/{Info.plist,Entitlements.plist,capabilities}`.

## 4. Invariants and doctrine (from AGENTS.md and project history; re-read the live file)
- **No split-brain**: one logical operation must not silently diverge into independent code paths; one canonical conversion path (e.g. a shared `timeToPixel`, not scattered `Math.round(time × pps)`).
- **Single time source** for playback; **EvaluatedScene** is the currency for preview, export, thumbnails and filmstrip.
- **Command pattern** for undoable timeline edits; export must not mutate editor stores.
- **IPC discipline** (batch/debounce, never in rAF for non-essentials); **three-tier compute boundary** (React / workers / Rust).
- **Native preview presenter is primary with a bridge fallback**; verify the *runtime* presenter, never infer it from env vars.
- **Native UI calls only on the main thread** (macOS 26+ crashes otherwise).
- **Zero hardcoded UI text** (i18n catalogs, parity across locales).
- **Investigation-only default** for audits: validate hypotheses empirically before declaring defects.
- **Canvas text effects** clear to transparency (`clearRect`), never fill a background.
- **Body effects run through the same generic pipeline** as any future effect; the original text-behind-subject cutout is not a special case.
- Local-first, offline-capable by default; "plan before code, verify before proceeding" with coding agents.

## 5. Drift examples (why you must re-verify)
- A native-surface flag (`EMBEDDED_PREVIEW_ONLY`) was hardcoded `true`, making the native path unreachable in every measurement; docs and later commits show it flipped to default `false` with the bridge kept as fallback. Docs mention both states — read their dates.
- `AGENTS.md` invariant 1 names a TypeScript `PlaybackClock.ts`; a search at the time of writing found `PlaybackClock` only in Rust sources. Either the invariant text is stale or the file moved — verify, don't repeat.
- A template pipeline name (`TemplateInjector`) once cited for text templates had no hits in the current tree.
- Earlier belief "no app-store distribution planned" sits beside a `store-release.yml` workflow now.
- `native_export` was once thought possibly dead code; it is a live module with its own builder/encoder/executor and tests — and it once bypassed the binary resolver.
Lesson: when a belief comes from memory, a doc or an agent summary, confirm it with `git grep` and `git log -S` before it goes in the report.

## 6. Question prompts per subsystem (use to seed Step 4)
- *Preview*: Why a CPU readback bridge at all? Why embed instead of a detached window? What measured evidence moved the default? What does the fallback reason code taxonomy encode?
- *Decode*: Why this hardware path per OS? What is downloaded/converted per displayed frame and why? What did telemetry show about producer vs consumer limits?
- *Audio*: Why audio as master clock? Why pre-decoded PCM with a size cap? Why a CLI fallback, and what triggers it?
- *Export*: Why two export paths? What decides fast-path eligibility? Why a sidecar rather than linked FFmpeg, and what does the license choice imply?
- *Timeline*: Why ripple-only normalisation? Why commit gestures atomically on pointer-up? Why a filmstrip epoch/atlas gate?
- *Text/effects*: Why Canvas 2D in a worker then RGBA upload versus native glyph/SDF? Why Lottie canvas renderer only? Why property-level keyframe tracks?
- *Telemetry*: Why opt-in with redaction? Why paired/interleaved A/B only? What does each milestone actually measure?
