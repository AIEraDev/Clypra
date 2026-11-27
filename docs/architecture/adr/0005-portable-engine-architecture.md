# ADR-0005: Portable Engine Architecture (Instance-Based, Host-Agnostic)

## Status

Proposed

This refines Step 0 of [ADR-0004](0004-mobile-native-engine-spike.md). ADR-0004 assumed the engine could be separated
from Tauri by moving three directories. The code shows the real coupling is in
the orchestration layer, so Step 0 is redesigned here.

## Context & Problem Statement

The Rust engine must serve three kinds of host: the Tauri desktop app, an iOS
native shell, and an Android native shell (ADR-0004). It should also stay open
to future needs: new decoders and importers, new effects, HDR and 10-bit
pipelines, AI analysis taps, other platforms, and a different editing core on
mobile. The boundary we draw now decides how expensive each of those is later.

Verified facts (read from the repository at `perf/multi-tier-composite-automation`):

**Where the code is** (lines of Rust under `src-tauri/src`):

| Area | Lines | Notes |
| --- | --- | --- |
| `commands/` | ~31,000 | Tauri glue **and orchestration**. `native_preview/` ~9,300, `native_playback/` ~4,500 |
| `wgpu_compositor/` | ~18,200 | GPU compositor, effects, import paths. 0 `tauri` references |
| `engine/` | ~15,800 | Contracts and traits. 1 file references `tauri` (`telemetry.rs`, event emission) |
| `filmstrip_engine/` | ~13,400 | FFmpeg decode, caches, stream actor. 1 file references `tauri` |

**The orchestration lives in `commands/`, not in the engine directories.**
- `commands/native_preview/mod.rs` runs past 3,400 lines, has 81 lines matching
  Tauri patterns (`AppHandle`, `State<...>`, window types, `tauri::`), and holds
  process-wide mutable singletons: a `LOOKAHEAD_WORKER` mutex, presentation
  sequence counters, last-presented and last-decoded frame trackers, and
  zero-copy guard and disable flags. The lookahead scheduler whose livelock was
  fixed earlier is driven from here.
- `commands/native_playback/render_session.rs` is 2,606 lines with Tauri
  references; `native_playback/mod.rs` and `runtime.rs` also reference Tauri.
- 49 `#[tauri::command]` functions sit across these two modules.
- Process-wide statics also appear in `filmstrip_engine` (pyramid cache,
  decoder pool, queue, stream actor, atlas, metrics, mmap cache),
  `wgpu_compositor/frame_cache.rs`, and `engine/decode_policy.rs` (a
  `OnceLock` resolution).

**Configuration is read from the environment inside the engine.** There are 10
`env::var` read sites across `wgpu_compositor/adapter_selector.rs`,
`filmstrip_engine/decoder/mod.rs`, `filmstrip_engine/stream_actor/types.rs`,
`filmstrip_engine/metrics.rs` and `engine/decode_policy.rs`. Mobile apps have no
launch environment in the same sense.

**Runtime and spawning.** `tauri::async_runtime::spawn` is used in
`filmstrip_engine/stream_actor/worker.rs`; threads and runtimes are created
across `commands/`, `filmstrip_engine/queue.rs`, `wgpu_compositor/frame_scheduler.rs`
and others.

**The engine already has trait seams.** `engine/` defines `Presenter`
(`presenter.rs`), `SurfaceInterop` (`surface.rs`), a decoder backend trait set
(`decoder/traits.rs`), a playback clock trait and a frame planner. Its module
doc states the intended principle: "The UI owns editor intent. The native
engine owns the truth of playback." `engine/decoder/` contains `d3d11`,
`d3d12` and `software` backends and no Apple backend; the VideoToolbox and
Metal paths live in `filmstrip_engine/decoder` and `wgpu_compositor/metal_import.rs`.

**Not established:** which of `engine/` (planner, playback controller, QoS) and
the `commands/native_*` orchestration is authoritative for playback today. The
two appear to overlap. The design must settle one owner, and Step 0 starts by
establishing it.

Problems this causes if we extract naively:

- Moving three directories leaves the scheduler, session and singletons in
  `src-tauri`, so mobile could not reuse the logic that matters most.
- Process-wide singletons cannot support multiple engine instances, clean
  teardown and recreation (app backgrounding, surface loss), or parallel tests.
- Environment-variable configuration has no equivalent on mobile.
- `tauri::async_runtime::spawn` works from any thread; a bare `tokio::spawn`
  panics outside a runtime. The engine must own its execution model.

## Decision

Build the engine as an **instance-based library with explicit configuration,
explicit platform ports, and a versioned host contract**. Hosts (Tauri, iOS,
Android) are thin adapters.

### 1. Layers and crates

```
 Hosts           src-tauri (49 commands, Tauri events)   iOS shell   Android shell
                          |                                  |            |
 Binding                  |                          clypra-engine-ffi (UniFFI / C ABI)
                          v                                  v
 Engine          clypra-engine   (scheduler, sessions, planner, QoS, caches,
                                  compositor, decode orchestration, effects)
                          |  uses ports (traits) implemented per platform
                          v
 Platform        platform adapters: Apple (VideoToolbox, IOSurface, Metal, CAMetalLayer),
                 Windows (D3D11/DXGI), Android (ANativeWindow, later MediaCodec), Linux
                          |
 Contracts       clypra-engine-api  (scene, ids, time, events, config, errors)
                 depends on serde only; no wgpu, no FFmpeg, no platform code
```

- **`clypra-engine-api`**: the host contract. Small and dependency-light so
  hosts, the FFI layer, tests and golden fixtures can depend on it without
  pulling in wgpu or FFmpeg.
- **`clypra-engine`**: one crate with strict internal module boundaries and
  Cargo features for backends (`metal`, `dxgi`, `vulkan`, `software`). One crate
  first, not many: splitting later is cheap if boundaries are enforced now, and
  premature crate splits add build and version overhead.
- **Platform adapters** live behind cfg and features inside `clypra-engine`
  initially, as separate modules with no cross-imports. They can become crates
  later if a platform needs an independent release cadence.
- **`clypra-engine-ffi`**: bindings for Swift and Kotlin. Created in the mobile
  steps, not in Step 0.
- **`src-tauri`** keeps the `#[tauri::command]` functions, window and surface
  management for desktop, and the Tauri implementation of the event sink.

Dependency rules, enforced in CI: `clypra-engine` and `clypra-engine-api` must
not depend on `tauri` (`cargo tree -i tauri` must be empty for them), and
platform modules must not import each other.

### 2. Instance-based, not process-global

Replace process-wide singletons with state owned by an `Engine` handle (shared
inner state), and by `Session` objects for per-playback state. Counters used for
telemetry become fields of the instance. Consequences:

- The lookahead worker, presentation counters, frame trackers and zero-copy
  flags move into session or engine state.
- Caches (pyramid, decoder pool, frame cache) are owned by the engine and
  sized from configuration, which gives mobile a place to enforce memory
  budgets.
- Two engines can exist in one process (tests, multiple windows), and an engine
  can be fully torn down and recreated, which mobile lifecycle requires.

### 3. Explicit configuration

The engine never reads environment variables. The host builds an
`EngineConfig` (decode policy, zero-copy requirement, dirty-recovery switches,
trace flags, cache budgets, thread counts, adapter preference) and passes it at
construction. The desktop host reads `CLYPRA_DECODE_PATH`,
`CLYPRA_REQUIRE_ZERO_COPY`, `CLYPRA_DEV` and related variables and builds the
config, so the developer workflow is unchanged. The resolved configuration is
recorded in telemetry (the existing decode-policy resolution), so what ran is
always traceable (invariant 13).

### 4. Platform ports

Traits the engine consumes and each platform implements. Several already exist
and are kept.

| Port | Responsibility | Status |
| --- | --- | --- |
| `SurfaceHost` | Attach, resize, lose and recreate the native render surface (`NSView`, `CAMetalLayer`, `ANativeWindow`) | New; generalizes the current surface config and render-target manager |
| `Presenter` | Present a rendered frame to a surface | Exists (`engine/presenter.rs`) |
| `SurfaceInterop` | Import a decoded hardware frame into the GPU (Metal, DXGI, later `AHardwareBuffer`) | Exists (`engine/surface.rs`) |
| `VideoDecoderBackend` | Decode and report capabilities (VideoToolbox, D3D11VA, software, later MediaCodec) | Exists (`engine/decoder/traits.rs`) |
| `MediaSource` | Open media by URL, descriptor or security-scoped handle, not only by path | New; mobile needs it for the photo library and scoped storage |
| `EventSink` | Deliver telemetry and engine events to the host | New; replaces `Option<&AppHandle>` |
| `Executor` | Spawn and schedule work | New; engine owns it, with a default implementation |
| `DeviceSignals` | Thermal state, memory warnings, power mode, app lifecycle | New; essential on mobile, optional on desktop |
| `PlaybackClock` | Authoritative playback time | Exists |

A `PlatformServices` bundle is passed at construction. Fakes of every port
make scheduler, lifecycle and fallback logic testable without a device or GPU.

### 5. Host contract: scenes in, events out

- **Scene in.** The host submits a versioned `Scene` (the contract currently in
  `commands/native_preview/layer_models.rs`, moved to `clypra-engine-api`
  without Tauri attributes). Layers, effects, text, transitions and timing are
  data. The schema carries a version, has deterministic JSON golden tests, and
  is the only way editing state reaches the engine.
- **Commands in.** `load`, `play`, `pause`, `seek`, `scrub`, `step`,
  `set_quality`, `suspend`, `resume`, `surface_lost`, `memory_warning`. They
  are non-blocking; results arrive as events.
- **Events out.** Frame presented, state snapshot, qos change, decode-path
  decision, error, telemetry. Delivered through `EventSink`; callbacks happen on
  engine threads and hosts hop to their UI thread.
- **Typed units at the boundary.** `TimelineFrame`, `MediaFrame`, `Pts` and
  rational `MediaTime` are distinct types, so a 30 fps timeline over 25 fps
  media cannot be confused again.
- **Editing-core independence.** The engine consumes a `Scene` and does not
  care what produced it: the TypeScript evaluator on desktop, or whichever
  editing core mobile adopts (the open decision in ADR-0004). This is the
  main reason to keep the contract narrow and versioned.

### 6. Lifecycle model

An explicit engine state machine: `Created`, `SurfaceAttached`, `Active`,
`Suspended`, `SurfaceLost`, `Destroyed`. Backgrounding calls `suspend`, which
releases GPU and decoder resources and keeps the scene and position.
`resume` and surface recreation rebuild them. Decoder-session invalidation and
dirty-decoder recovery are handled inside this model, not left to hosts. This
generalizes the native surface lifecycle observer on desktop.

### 7. Execution model

The engine owns its threads: dedicated threads for decode and lookahead, and a
small runtime (or none) for asynchronous I/O, behind the `Executor` port. No
call may depend on the host providing a runtime. A test must spawn engine work
from a plain `std::thread`. Lock ordering and the thread-to-callback rules are
documented, because callbacks cross an FFI boundary.

### 8. Capability negotiation and fallback

Generalize the ordered decode policy into per-platform candidate lists built
from detected capabilities (adapter, available decoders, thermal state). The
existing `auto|cpu|metal|dxgi` semantics, rejection reasons and telemetry are
kept. The chosen path and every rejection are emitted as events, so a fallback
on a device is visible in the same evidence format as on desktop.

### 9. Errors and FFI safety

Typed errors with stable numeric codes. No panic crosses the binding boundary
(`catch_unwind` at the edge, converted to an error event). Strings crossing the
boundary are redacted for paths and identifiers (invariant 14). The binding
layer exposes an `api_version()` handshake so a host and engine mismatch is
detected, not assumed.

### 10. Extension points (future enhancements)

| Future need | Where it plugs in |
| --- | --- |
| New decoder or hardware path (MediaCodec, other) | New `VideoDecoderBackend` plus `SurfaceInterop`; no scheduler change |
| New effect or transition | The effect interpreter and pipelines in the compositor, driven by `Scene` data |
| HDR and 10-bit preserving paths | Pixel format and color info already flow through `FrameResource`; new importers and shaders plug in |
| AI analysis (auto-reframe, scene detection) | An optional frame-tap port that requests downscaled frames or readback only when enabled, so previews pay nothing otherwise |
| New platform | A new set of port implementations and a `PlatformServices` constructor |
| Remote or batch rendering | `Engine` without a `SurfaceHost`, using the existing offscreen and export paths |
| Different editing core on mobile | Produces the same `Scene` contract |

### 11. Verification infrastructure built into the design

- Fakes for every port, enabling deterministic scheduler, lifecycle and
  starvation tests (including the livelock regressions) without hardware.
- The existing headless GPU golden harness stays the pixel-parity check.
- Telemetry stays the v2 envelope, emitted through `EventSink`; the perf
  harness remains a host-level concern.

## Alternatives Considered

- **Extract the three directories only (ADR-0004's original Step 0).**
  Rejected: it leaves the scheduler, session and singletons behind, so mobile
  would reimplement the hardest logic.
- **Single big crate with no `api` split.** Simpler, but every host and test
  would depend on wgpu and FFmpeg, and the host contract would not be
  separable or independently versioned. Rejected.
- **Many crates from day one** (decode, compositor, scheduler, platform).
  Clean in theory, but costly to build and version before the boundaries are
  proven. Deferred; module boundaries and dependency rules keep the option open.
- **Keep singletons and add an init function.** Fastest, but blocks multiple
  instances, clean teardown and parallel tests. Rejected.
- **Host reads the environment inside the engine.** Does not work on mobile and
  hides configuration. Rejected.
- **Expose the Rust types directly over FFI.** Couples hosts to internal
  layout. Rejected in favor of the versioned contract.

## Consequences & Trade-offs

- **Positive**: one engine for three hosts; testable without devices; teardown
  and recreation work, which mobile lifecycle needs; configuration is explicit
  and traceable; future decoders, effects and platforms plug in through ports;
  the editing-core choice stays independent.
- **Negative / Costs**: this is a large refactor of working, performance-tuned
  desktop code (roughly 60,000 lines across the engine directories and the
  orchestration in `commands/`); converting singletons to instance state risks
  subtle behavior changes in the very code that was just made to work; more
  indirection through ports.
- **Risks & Mitigations**:
  - Instance-izing the lookahead scheduler regresses the playback fixes.
    Mitigation: do it in place, before any move, behind the existing tests and
    the acceptance runs, with the starvation and resync regressions pinned as
    tests first.
  - Duplicate ownership between `engine/` and `commands/native_*`. Mitigation:
    Step 0a decides the owner before anything moves.
  - Performance overhead from ports on hot paths. Mitigation: keep frame submit
    and import calls static or monomorphized where measured necessary, and
    verify with `perf:cycle` at each step.
  - Scope growth. Mitigation: each step is independently shippable and
    reversible.

## Verification & Migration Strategy

Order matters: reduce coupling inside `src-tauri` first, then move.

0. **Baseline.** Before any change, capture on the starting commit: the full
   test suite counts, `native-golden` output, and a fixed-fixture
   `perf:cycle` run including the three acceptance scenarios. All later steps
   compare to it.
1. **Establish ownership (read-only).** Decide whether `engine/` or
   `commands/native_*` owns planning, lookahead and sessions; list every
   function in `commands/native_playback/` and `commands/native_preview/` as
   "glue" or "engine logic". Report before proceeding.
2. **`clypra-engine-api`.** Move the scene and request models, identifiers,
   time types, event and error types, and config structs, with Tauri attributes
   removed. Add golden JSON tests. Low risk.
3. **Explicit config.** Replace the 10 env read sites with `EngineConfig`
   built by the desktop host. Behavior identical; verify the dev-profile
   defaults still apply.
4. **Instance-ize in place.** Convert the statics (starting with
   `commands/native_preview/mod.rs`) into engine and session state held in Tauri
   managed state. Pin the livelock and starvation regressions as tests first;
   re-run the acceptance scenarios after.
5. **Ports.** Introduce `EventSink`, `Executor` and `SurfaceHost` in place,
   replacing `AppHandle` and `tauri::async_runtime::spawn` usage, with a
   test that spawns from a plain `std::thread`.
6. **Move.** Create `clypra-engine` and move the orchestration plus
   `engine/`, `wgpu_compositor/` and `filmstrip_engine/`. Use a path dependency
   from `src-tauri` first, not a Cargo workspace, because a workspace moves
   `Cargo.lock` and `target/` and can break `tauri build`, CI and the FFmpeg
   setup. Add the CI check that `tauri` is absent from the engine crates.
7. **Mobile steps** (ADR-0004): platform adapters, the FFI crate, and the
   spike harnesses.

Each step must leave desktop green: full tests, `native-golden`, `perf:cycle`
within noise of the baseline, and the acceptance scenarios passing. Any step
that changes desktop behavior is reverted and split smaller.

Rollback: every step is a separate commit or branch; nothing changes project
files or the TypeScript side.

## Open Questions

- Which of `engine/` and `commands/native_*` owns playback planning today, and
  can the overlap be removed?
- Is the Scene contract the right granularity, or does the engine need a
  smaller invalidation-friendly diff API for large timelines on mobile?
- UniFFI, hand-written C ABI, or both for the binding layer?
- What are the engine memory budgets per platform, and who owns pressure
  response (engine or host)?
- Does export (`native_export`) move into `clypra-engine` in the same pass, or
  follow after playback?
- When does a platform adapter deserve its own crate?
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-11-25T11:41:06+01:00.
</ADDITIONAL_METADATA>
<USER_SETTINGS_CHANGE>
The user changed setting `Model Selection` from Gemini 4 Hydrogen (Low) to Gemini 3.8 Flash (High). No need to comment on this change if the user doesn't ask about it. If reporting what model you are, please use a human readable name instead of the exact string.
</USER_SETTINGS_CHANGE>
