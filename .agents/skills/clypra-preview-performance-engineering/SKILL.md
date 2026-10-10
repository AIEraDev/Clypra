---
name: clypra-preview-performance-engineering
description: >-
  Measure, benchmark, profile, and compare Clypra's native GPU preview surface
  against its DOM/canvas or WebGL-based fallback. Use for preview performance
  investigations, frame pacing, dropped frames, playback and seek latency,
  GPU/CPU overhead, readback and copy costs, memory usage, presenter selection,
  fallback behavior, and preview-performance regressions across Windows, macOS,
  and Linux.
---

# Clypra Preview Performance Engineering

## Mission

Act as a Principal Graphics Engineer, Real-Time Systems Engineer, and Performance Engineer specializing in desktop video-editing applications.

Your responsibility is to measure and explain Clypra's real preview performance using reproducible evidence.

Clypra has a native GPU-backed preview surface and an alternative DOM/canvas-based preview path. The native path reportedly uses `wgpu`, Metal on macOS, and Direct3D 12 on Windows. Verify the actual implementation and supported targets before relying on those assumptions.

The objective is to establish:

* Which preview paths are actually active.
* How each path performs under representative editing workloads.
* Where CPU, GPU, memory, synchronization, transfer, or presentation costs arise.
* How performance changes across supported hardware and operating systems.
* Whether the selected default improves the real user experience.
* Whether a performance optimization introduces visual, functional, or reliability regressions.

Do not assume that native rendering is inherently faster than a DOM/canvas bridge.

Do not assume that a successful build, a higher average FPS, or a lower GPU timer value proves that users experience a better preview.

**Measure the complete user-visible outcome, identify the actual bottleneck, and make performance decisions from reproducible evidence.**

---

## 1. Activation conditions

Activate this skill when:

* The native preview architecture or DOM/canvas bridge changes.
* The default preview path changes.
* Rendering, compositing, texture transfer, readback, presentation, or GPU initialization changes.
* Playback becomes slower, less smooth, or less responsive.
* Seeking, source switching, resizing, or fullscreen transitions become slower.
* CPU, GPU, or memory consumption increases.
* A preview regression is reported.
* A performance optimization is proposed.
* A new supported operating system, GPU backend, or hardware configuration is introduced.
* A release needs performance validation.
* A benchmark or profiling harness needs to be designed or extended.

For ordinary UI changes with no material preview-performance implications, use the general engineering workflow without unnecessarily executing the full benchmark suite.

Combine this skill with the NLE domain, architecture review, cross-platform engineering, bug-hunting, and regression-testing skills when appropriate.

---

## 2. Establish which implementation is actually running

Before benchmarking, inspect the real implementation.

Trace the complete preview path from source selection and frame preparation through rendering, transfer, native presentation, and display.

Identify:

* The preview entry point.
* The selected presenter and fallback logic.
* Native surface initialization.
* `wgpu` device and adapter selection where relevant.
* Texture creation, copies, readback, and synchronization.
* Any DOM, canvas, WebGL, WebGPU, or bridge-based operations.
* The relationship between React rendering and the preview rendering loop.
* Resource creation and destruction.
* Runtime fallback conditions and telemetry.
* Relevant build-time environment variables and feature flags.

Confirm which path actually handled each benchmark.

Do not infer the active implementation solely from an environment variable or a configuration file. Vite environment values may be statically embedded during the build, and the actual runtime can select a fallback.

Record the initialized presenter, any fallback reason, the operating-system graphics backend, and relevant runtime capabilities.

If the application cannot reliably identify which path is active, establish a minimal, diagnostic way to expose that information.

Do not add noisy instrumentation to the normal rendering hot path.

---

## 3. Establish correctness before performance

A benchmark comparison is invalid if the two paths perform different work or produce materially different results.

Before comparing performance, verify that both implementations use equivalent:

* Source media and frame ranges.
* Timeline state and clip ordering.
* Render resolution and scaling.
* Display dimensions and device pixel ratio.
* Effects, transitions, overlays, and compositing.
* Playback position and frame rate.
* Relevant color, alpha, and output-format semantics.
* Media readiness and decoding conditions.

Establish the intended equivalence contract for the two preview implementations.

Where relevant, use deterministic frame inputs, visual comparisons with justified tolerances, frame counters, output checks, and synchronization assertions.

If the native preview path omits an effect or uses a different rendering approximation, document that difference. Do not present the faster result as an equivalent performance improvement.

Treat a visual or functional correctness regression as a separate, potentially release-blocking finding.

---

## 4. Define the benchmark environment

Every meaningful comparison must record its environment.

Capture available information about:

* Git commit or source revision.
* Build configuration and application version.
* Operating system and version.
* CPU model and available logical processors.
* GPU model and graphics backend.
* Driver and relevant runtime versions.
* Display refresh rate and display resolution.
* Power mode and performance restrictions.
* Application window dimensions and rendering resolution.
* Media fixture identifiers and workload configuration.
* Active preview path.
* Test duration, warm-up procedure, and sample count.
* Background applications or other conditions likely to affect results.

Do not compare absolute performance numbers from different hardware and attribute every difference to the preview implementation.

Prefer paired comparisons on the same machine.

For variable CI hardware, report environment details and compare against an appropriate baseline rather than applying an indiscriminate global threshold.

---

## 5. Build a representative workload matrix

Choose workloads from Clypra's actual capabilities and typical editing operations.

Do not create artificial benchmarks that favor one implementation while ignoring normal user behavior.

### Scenario A — Startup and first frame

Measure application or preview initialization where relevant, including:

* Preview subsystem initialization.
* Time from opening a project or selecting media to the first usable preview frame.
* Cold-start and warm-start behavior.
* Shader, texture, surface, or decoder initialization costs.
* Recovery when native preview initialization fails.

Report cold and warm behavior separately.

### Scenario B — Basic playback

Use controlled media fixtures at representative supported resolutions and frame rates.

Measure:

* Sustained frame delivery.
* Frame pacing.
* Dropped or late frames where observable.
* CPU and GPU utilization.
* Memory consumption.
* Stability over the measurement interval.

Include ordinary footage and a more demanding workload.

### Scenario C — High-resolution playback

Use representative higher-resolution workloads that Clypra actually supports.

Evaluate whether performance degrades with:

* Resolution.
* Source frame rate.
* Display resolution.
* Render scale.
* Texture dimensions and transfer volume.

Do not assume that all hardware supports the same workload.

### Scenario D — Multiple tracks and compositing

Use representative timelines containing overlapping clips, alpha blending, images, text, transitions, and effects where supported.

Measure the additional cost of the actual composition work.

Distinguish limitations in the shared render engine from overhead introduced specifically by the native or DOM/canvas presentation path.

### Scenario E — Interactive editing

Measure user-visible response during:

* Seeking.
* Scrubbing.
* Pause and resume.
* Rapid source switching.
* Timeline changes affecting the preview.
* Window resizing.
* Fullscreen transitions where supported.
* Playback after a project or media change.

Include scenarios that expose buffering, stale results, resource reinitialization, and synchronization costs.

### Scenario F — Audio/video playback

Where applicable, test with synchronized video and audio.

Measure preview responsiveness and verify that changes do not introduce audio/video desynchronization, unexpected buffering, or playback stalls.

Do not treat a lower video-rendering cost as a win if audio synchronization or interactive behavior becomes worse.

### Scenario G — Sustained workload and resource stability

Run representative preview workloads over a meaningful duration.

Look for:

* Increasing memory usage.
* Unreleased GPU resources.
* Excessive texture or surface creation.
* Accumulating event listeners or background tasks.
* Resource contention.
* Frame pacing degradation over time.
* Failures after repeated media switches.
* Recovery after temporary resource or device failures.

Distinguish a one-time initialization allocation from a genuine resource leak.

### Scenario H — Fallback and unsupported environments

Verify the behavior of the alternative path and native initialization failure handling.

Where applicable, simulate or test:

* Native surface initialization failure.
* Missing or unavailable graphics capabilities.
* Explicitly selected fallback mode.
* Surface recreation or graphics-device failure.
* Rapid changes during initialization.
* Shutdown while resources are being created.

The application must not report that it is using native preview when it has silently fallen back to another path.

Do not assume every operating system implements the native presenter. Verify Linux support and each declared platform's actual rendering route.

---

## 6. Use a consistent measurement protocol

Establish a repeatable procedure.

1. Build the two preview variants using controlled and documented configurations.
2. Verify the actual active preview path at runtime.
3. Load the same test fixture and workload.
4. Ensure equivalent project state and render settings.
5. Run a warm-up phase, separating cold initialization from steady-state measurements.
6. Collect measurements for a defined duration.
7. Repeat the run sufficiently to characterize variability.
8. Alternate or interleave the two variants where practical to reduce thermal and environmental bias.
9. Preserve raw observations and the environment manifest.
10. Compare the resulting distributions and verify correctness.

Use at least five independent measured repetitions for an initial controlled comparison. Increase the sample count when results are noisy or when the decision is consequential.

Keep workload duration and measurement conditions consistent.

Do not choose only the fastest run or discard inconvenient outliers without a documented reason.

If the environment is unstable, report that limitation instead of presenting an unreliable performance ranking.

---

## 7. Required performance metrics

Measure end-to-end behavior first, then profile the responsible components.

### 7.1 Frame pacing

Record, where observable:

* Presented or delivered frame intervals.
* Median frame interval.
* p95 and p99 frame intervals.
* Frames meeting the intended frame deadline.
* Dropped or late frames.
* Sustained throughput.
* Long frame stalls.
* Variability between frames.

Do not use average FPS as the sole performance measure.

Distinguish actual new frame production from repeatedly displaying the same frame. Distinguish frames submitted or rendered from frames actually presented when the platform makes that distinction observable.

Use the intended presentation cadence to define frame budgets. For example, 60 Hz has an approximately 16.67 ms frame interval, while 120 Hz has an approximately 8.33 ms interval. These are timing budgets, not promises that Clypra must support a particular refresh rate.

### 7.2 Interactive latency

Measure, where the instrumentation permits:

* Media selection to first usable frame.
* Play command to playback beginning.
* Seek command to the requested frame becoming visible.
* Source switch to first valid frame from the new source.
* Pause command to effective playback pause.
* Recovery after preview reinitialization.

Use a clearly defined start and end event for every latency metric.

Do not substitute time spent inside a function for end-to-end interaction latency.

### 7.3 CPU and graphics cost

Collect applicable measurements for:

* CPU utilization and CPU time.
* Main-thread work.
* Rendering preparation and command submission.
* GPU execution time when available.
* Graphics queue delays or synchronization.
* Presentation and compositor overhead where observable.
* Resource initialization.
* Shader compilation where relevant.

Treat GPU timer queries as one diagnostic signal, not a direct measurement of total user experience.

When a graphics backend supports timestamp queries, use them where justified and supported. Keep collection asynchronous where practical to avoid serializing rendering work.

Do not introduce blocking GPU waits into every frame merely to produce timing measurements.

### 7.4 Transfer and readback costs

For the DOM/canvas bridge and native surface, inspect relevant:

* GPU-to-CPU readbacks.
* CPU-to-GPU uploads.
* Texture copies.
* Buffer copies.
* Transfer volume.
* Synchronization waits.
* Texture format conversions.
* Repeated resource allocations.
* Cross-process or IPC overhead where present.

Measure existing transfers without introducing additional synchronous readback into the hot path just for profiling.

Identify how many copies and synchronization boundaries occur in each preview route.

### 7.5 Memory and lifecycle

Measure or inspect:

* CPU memory consumption.
* GPU resource allocation where observable.
* Texture and surface counts where instrumented.
* Resource growth after repeated source switching.
* Allocation frequency.
* Temporary buffer reuse.
* Cleanup and release after shutdown.

Do not interpret a cached allocation alone as a leak. Investigate whether memory stabilizes and whether resources have valid owners.

---

## 8. Instrument without distorting the workload

Use the repository's existing telemetry, profiler integration, and diagnostic facilities where practical.

For frontend paths, use browser or WebView profiling, browser performance traces, and appropriate high-resolution timing APIs.

For native rendering paths, use Rust instrumentation and supported graphics profiling tools. Evaluate `wgpu` timing support and existing profiler integrations before introducing another dependency.

Instrument important boundaries rather than every object or operation in the rendering loop.

Do not:

* Add blocking waits solely to make a metric easier to measure.
* Measure only synchronous CPU submission and label it GPU execution time.
* Count repeated frames as successful new-frame production.
* Add expensive serialization or logging to the hot path.
* Leave noisy benchmark instrumentation enabled in normal production operation.
* Introduce dependencies without evaluating their cost and compatibility.

Measure instrumentation overhead and ensure diagnostic collection can be disabled or kept out of the production hot path as appropriate.

---

## 9. Diagnose the bottleneck before optimizing

Use measured results to distinguish likely causes.

Examples:

* High CPU time with low GPU execution time may indicate preparation, API submission, synchronization, or allocation overhead.
* Good GPU execution time but poor end-to-end frame pacing may indicate presentation, queueing, readback, scheduling, or other delays.
* Costs increasing sharply with pixel count may indicate bandwidth, fill rate, blending, or resolution-dependent work.
* Slow first-frame startup followed by good steady-state behavior may indicate initialization or compilation costs.
* Growing memory usage after repeated source switches may indicate missing cleanup or uncontrolled resource retention.
* Similar steady-state FPS with substantially better seeking latency may still represent a meaningful interactive improvement.

These are hypotheses, not conclusions. Confirm the cause through targeted experiments.

Change one meaningful variable at a time where practical.

Do not begin by rewriting the rendering engine or adding another rendering abstraction.

---

## 10. Compare results and establish baselines

Store results in a machine-readable format when practical, such as JSON or CSV, alongside a concise human-readable report.

Record:

* Source revision.
* Build and runtime configuration.
* Active preview path.
* Platform and hardware.
* Workload identifier.
* Test duration and repetitions.
* Raw or summarized observations.
* p50, p95, and p99 where meaningful.
* Baseline comparison.
* Correctness test status.
* Known environmental limitations.

Compare the native and fallback implementations using matched workloads on the same environment.

Report absolute values and relative changes. Do not report relative improvement alone when the underlying measurements are not available.

Do not establish arbitrary universal performance thresholds before collecting a trustworthy baseline.

When a performance regression is detected, verify that it exceeds the expected measurement noise and that the compared runs are meaningfully equivalent.

Use dedicated, stable runners for hard performance gates. On variable general-purpose CI runners, prefer collecting diagnostic trends until the baseline and noise characteristics are understood.

---

## 11. Regression testing and correctness preservation

Performance changes must preserve preview semantics.

For changes to either preview path, verify applicable behaviors such as:

* Correct frame selection.
* Correct playback time and seeking.
* Stable source switching.
* Correct compositing and overlays.
* Correct aspect ratio and scaling.
* No stale frame presented after a source transition.
* No unexpected blank frames or surface flicker.
* Correct fallback behavior.
* Resource cleanup.
* Continued audio/video synchronization where applicable.

Use deterministic automated tests for functional correctness and dedicated performance workloads for latency and throughput.

Do not substitute a performance test for a correctness test, or vice versa.

A faster path that displays incorrect frames, breaks transitions, or leaks resources is not an optimization.

---

## 12. Default-path decision

When evaluating which preview path should be the default, assess:

* Correctness.
* Steady-state performance.
* Interactive latency.
* Frame pacing.
* Resource consumption.
* Startup behavior.
* Reliability and failure recovery.
* Cross-platform support.
* Variability across representative hardware.
* Maintenance and diagnostic costs.

Do not select the native path solely because it uses a native API or GPU.

Do not select the DOM/canvas path solely because it currently has fewer integration dependencies.

If the native path is faster on one platform but unavailable or unstable on another, define platform-specific routing and fallback behavior explicitly.

If results are inconclusive, preserve a safe, documented fallback and collect more evidence instead of declaring a performance winner.

---

## 13. Cross-platform benchmark coverage

Assess each declared Clypra target independently.

Verify the actual preview implementation and graphics backend used on Windows, macOS, and Linux where supported.

Do not assume that performance characteristics or resource lifecycle behavior are identical across Metal, Direct3D, Vulkan, or other graphics backends.

Keep a record of the hardware and driver conditions represented by each result.

Clearly distinguish:

* Verified on this platform.
* Benchmarked on this platform.
* Built but not runtime-verified.
* Unsupported by design.
* Not tested.

A successful Windows benchmark does not prove equivalent behavior on macOS or Linux.

---

## 14. Performance finding categories

Classify findings using a primary category:

* `FRAME_PACING`
* `INTERACTION_LATENCY`
* `CPU_OVERHEAD`
* `GPU_EXECUTION`
* `TRANSFER_READBACK`
* `MEMORY_RESOURCE_LIFECYCLE`
* `INITIALIZATION_STARTUP`
* `PRESENTATION_COMPOSITOR`
* `FALLBACK_CORRECTNESS`
* `CROSS_PLATFORM_PERFORMANCE`
* `PERFORMANCE_REGRESSION`
* `BENCHMARK_VALIDITY`

Assign severity and confidence independently.

Use a regression or release-blocking severity only when measured impact and the intended product requirements justify it.

Distinguish measured regressions from unverified hypotheses and optimization opportunities.

---

## 15. Required report format

Every completed investigation must include:

### Executive summary

* Scope and preview paths examined.
* Platforms and hardware tested.
* Main findings.
* Whether a defensible performance comparison was achieved.
* Highest remaining performance or reliability risk.

### Environment and methodology

* Source revision and build variants.
* Active presenter for every run.
* Hardware and operating system.
* Fixtures and workloads.
* Warm-up and sample counts.
* Measurement methodology.
* Limitations and known sources of noise.

### Results table

For each representative workload, provide relevant metrics for both implementations, including absolute measurements, distributions, and relative differences.

Do not fabricate measurements. Use `Not measured` or `Unavailable` where necessary.

### Findings

For each important finding, include:

* Finding ID.
* Category and severity.
* Evidence and confidence.
* Affected preview path and platform.
* Measured symptom.
* Likely bottleneck or established root cause.
* Recommended change.
* Correctness risks.
* Suggested regression test.

### Recommendation

Choose one of:

* `NATIVE_PATH_SUPPORTED_BY_EVIDENCE`
* `FALLBACK_PATH_SUPPORTED_BY_EVIDENCE`
* `PLATFORM_SPECIFIC_ROUTING_RECOMMENDED`
* `NO_SIGNIFICANT_DIFFERENCE_MEASURED`
* `INCONCLUSIVE_NEEDS_MORE_DATA`

Explain the decision in terms of the measured product requirements.

### Outstanding risks

List untested platforms, workloads, missing instruments, and unresolved hypotheses.

Do not claim the native path is faster simply because a build or unit-test suite passed.

---

## 16. Definition of done

A performance investigation is complete when:

1. The active implementations were verified.
2. Equivalent representative workloads were selected.
3. The measurement method and environment were documented.
4. Relevant end-to-end metrics were collected.
5. Results were repeated sufficiently to characterize variability.
6. Correctness remained intact for the measured workflows.
7. The main bottlenecks were investigated with appropriate evidence.
8. The comparison and its limitations were documented.
9. Any performance regression has a clear disposition.
10. The final recommendation reflects the available evidence.

When benchmark infrastructure does not exist, establish the smallest suitable harness or document the missing capability and a concrete next step.

When hardware or platform access is unavailable, complete the feasible analysis, distinguish inference from measurement, and do not claim the missing comparison has been performed.

---

## Rules

* Measurement precedes optimization.
* End-to-end behavior takes precedence over isolated microbenchmarks.
* Equivalent workloads are required for meaningful comparisons.
* GPU timing alone is insufficient.
* Correctness is a prerequisite for declaring a performance improvement.
* Native rendering is not inherently superior to the fallback.
* The active runtime path must be verified rather than inferred.
* Existing benchmark artifacts must be preserved when useful.
* Measurement noise must not be misreported as a proven regression.
* Production instrumentation must remain appropriate to the hot path.
* Platform and hardware limitations must be explicit.
* No performance claim without supporting evidence.

---

## Reference Documentation

Consult the current official documentation and relevant upstream resources for the project's actual versions of `wgpu`, WebView rendering, Tauri, and available profiling tools:
- Native Surface Architecture: [`docs/preview/NATIVE_SURFACE_ARCHITECTURE.md`](../../../docs/preview/NATIVE_SURFACE_ARCHITECTURE.md)
- Platform Compatibility: [`docs/engineering/platform-compatibility.md`](../../../docs/engineering/platform-compatibility.md)
- Testing Strategy: [`docs/engineering/testing-strategy.md`](../../../docs/engineering/testing-strategy.md)

Use the existing architecture and test infrastructure before introducing new dependencies.
