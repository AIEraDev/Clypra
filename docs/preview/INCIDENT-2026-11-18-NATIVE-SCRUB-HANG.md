# Native Scrub Hang — Incident Record

**Status:** Confirmed liveness failure; root-cause direction is high
confidence, not yet isolated by a controlled reproduction.

## Scope

This record analyzes the last non-empty local session from 2026-11-18,
redacted as `session-…ca859b0b`. A newer zero-byte session file contains no
diagnostic evidence and is excluded.

Environment observed in the report:

| Field | Value |
| --- | --- |
| Runtime | development, Clypra 1.6.6 |
| Presenter | native surface |
| Platform | macOS arm64, Apple M1, Metal |
| Decoder | VideoToolbox, hardware HEVC Main10 |
| Workload | 3840×2160, nominal 60fps, variable-frame-rate HEVC |
| Native session duration | 63.53 seconds |

## Executive finding

The app remained alive and accepted native demand commands; this is not proven
to be a thread deadlock. It nevertheless hung from the editor's perspective:
the paused-scrub lifecycle continuously replaced the one demand allowed to
settle the view. Native acknowledgements were mistaken for sufficient progress
while matching presentation was rare.

This is a **P1 / CONCURRENCY_LIFECYCLE** desktop-preview defect with high
confidence. The missing final experiment is a deterministic state-machine
reproduction that proves the exact frontend replacement loop.

## Evidence

Within the traced interval (22.242s–76.300s after session start):

| Lifecycle event | Count | Interpretation |
| --- | ---: | --- |
| demand dispatched | 565 | UI created a large number of paused demands |
| command acknowledged | 565 | Tauri/Rust accepted each mailbox update |
| locally abandoned as superseded | 489 | UI invalidated most pending settle candidates |
| presentation events | 76 | only 13.5% of dispatches produced a presentation event |
| distinct frames presented | 68 | repeated presentation also occurred |

The last long run is especially diagnostic: the same target frame was
superseded repeatedly at short intervals before a later event finally
presented another target. The session's final native report also recorded
1,521 produced frames, 1,045 dropped frames (68.7%), average actor wait
25.98ms, and peak actor wait 198.70ms. These are observations from one
high-risk media workload, not a general throughput claim.

Seek telemetry reported several successful seeks with roughly 37.5–78.5ms
latency and one incorrect outcome. That proves the system can recover in some
intervals; it does not disprove the observed hang.

## Code-path assessment

The current paused native path allows a new command once the short command
promise resolves. It then calls `abandonPausedNativeDemand("superseded", false)`
before installing the next frontend pending record. The native demand mailbox
is separately latest-wins. Therefore the protocol can repeatedly replace both
the frontend settle candidate and the native pending entry before a target is
allowed to complete.

The new cancellation-epoch split prevents each forward target from imposing a
native cancellation barrier. It does **not** by itself establish liveness:
frontend operation creation and pending-demand replacement still need a
single-target state machine.

## Required corrective design

Use the architecture in [ADR-0001](../architecture/adr/0001-native-first-preview-ownership.md):

1. Keep `desiredTarget` independently from `inFlightTarget`.
2. Do not dispatch when the desired target equals the accepted or in-flight
   target for the same snapshot and cancellation epoch.
3. When a forward target changes during active decode, retain the active
   operation and update at most one replaceable pending native mailbox value.
4. On reverse, release, snapshot change, source change, or stop, advance the
   cancellation epoch and explicitly terminalize prior work.
5. Treat only a matching `presented` terminal event as seek settlement.
6. Emit one structured terminal record for every accepted request and report
   `produced`, `presented`, `superseded`, `cancelled`, and
   `dropped_before_present` separately.

## Required regression coverage

- Repeated RAF ticks at an unchanged scrub frame issue exactly one native
  operation and retain one settle candidate.
- N forward targets while decode is active keep one cancellation epoch and do
  not cause N native queue invalidations.
- Direction reversal and release establish a fresh epoch and make old
  presentation unable to settle the seek.
- Play immediately after rapid scrubbing has an eventual terminal outcome and
  does not retain a paused pending state.
- A native command acknowledgement alone cannot mark a seek complete.

## Limits

The log has no lock-owner trace or per-request native terminal outcome chain,
so it cannot identify whether the final wait is decode, actor scheduling,
surface acquisition, or a lost event. Add correlation at those boundaries
before attributing the remaining latency to any one native subsystem.

