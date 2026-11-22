# ADR-0001: Native-First Program Preview Ownership

## Status

Accepted — target architecture. The current paused-scrub implementation is not
yet conformant; see [the incident record](../../preview/INCIDENT-2026-11-18-NATIVE-SCRUB-HANG.md).

## Context & Problem Statement

Clypra is a desktop NLE. On desktop, video playback, frame-accurate seeking,
scrubbing, composition, and presentation are latency-sensitive work that must
not depend on WebView canvas readback or React render cadence.

The 2026-11-18 native Metal session demonstrated why ownership matters: the
native process continued to accept work while the paused-scrub control plane
continually replaced its own settle candidate. The result was a user-visible
hang without a process crash. The remedy is a clear ownership model, not a
return to DOM/canvas video presentation.

Facts:

- `PlaybackClock` remains the only session position authority.
- `EvaluatedScene` remains the only rendering currency.
- Rust owns decode, compositor state, native surface presentation, and native
  audio hardware.
- React owns input interpretation, editor UI, and intent publication.
- The desktop native surface is the presentation target for all video frames.

## Decision

### 1. Native owns the media plane

The Rust native preview session owns:

- video decode, frame cache, lookahead, composition, and retained-surface
  presentation;
- the bounded latest-demand mailbox and all decode cancellation;
- native audio output and the hardware-clock observations supplied to
  `PlaybackClock`;
- recovery from device/surface loss while preserving the last valid native
  frame when possible.

The native session is the only desktop component permitted to decide whether a
video frame is ready or presentable. A Tauri command acknowledgement means a
request entered a mailbox; it is never evidence of presentation.

### 2. React owns a narrow intent plane

React evaluates the current `EvaluatedScene`, converts pointer/play/pause
actions into typed intents, and updates editor controls. It must not implement
a second frame scheduler, decode queue, or presentation timeline.

Each native intent has two independent identities:

| Field | Owner | Meaning |
| --- | --- | --- |
| `targetGeneration` | UI control plane | Exact target selected by the latest editor action. |
| `cancellationEpoch` | Native lifecycle contract | Boundary after which prior decode/presentation work is forbidden. |
| `requestId` | End-to-end operation | Correlates accept, terminal outcome, and diagnostics. |

Changing a forward scrub target may replace an unstarted mailbox entry, but it
must not advance `cancellationEpoch` or cancel decode already making progress.
Release, direction reversal, project/snapshot replacement, source change,
surface recreation, and session stop are cancellation boundaries.

### 3. Coalescing is native-owned

The frontend may rate-limit pointer input, but it must retain one desired
target and must not repeatedly manufacture operations for the same target.
The native mailbox is the sole latest-wins queue. It must expose terminal
outcomes: `presented`, `superseded`, `cancelled`, `dropped_before_present`, or
`failed`.

Only a `presented` event matching the active target may settle an exact seek.
A superseded or cancelled request cannot reset the playhead, surface state, or
seek-completion state.

### 4. DOM/canvas has an explicit, non-video role

The desktop DOM remains appropriate for editor chrome, accessibility, pointer
handling, transform controls, inspector UI, timeline, scopes, and lightweight
overlay authoring. Offscreen DOM/canvas rasterization may produce a texture
input for the native compositor; it may not become the desktop video
presenter.

The DOM/canvas route is prohibited for desktop playback, seek, scrub, or
frame-step video presentation. An unavailable native presenter must surface an
explicit diagnostic/recovery state, not silently switch to an HTML video or
CPU-readback canvas implementation. Browser-only builds are a separately
declared runtime, not evidence of desktop-native correctness.

### 5. Liveness is a correctness requirement

For each accepted exact target, the system must eventually emit a terminal
outcome. While an interaction remains active, either a newer target replaces
the pending target or the native session presents the current target. No
control loop may continually supersede an unchanged target.

## Consequences & Trade-offs

**Positive:** one media scheduler, zero-copy desktop presentation, bounded
queues, clearer failure reporting, and deterministic stale-result handling.

**Costs:** the protocol requires typed lifecycle events, terminal-outcome
accounting, native integration tests, and per-platform surface validation.

**Risk controls:** every native boundary is timeout-observable but not
silently rerouted; recovery keeps the last valid frame; stale events are
rejected by `(requestId, targetGeneration, cancellationEpoch, revision)`.

## Verification & Migration Strategy

1. Add a deterministic paused-scrub state-machine test: repeated same-target
   ticks produce no new operation; forward targets preserve the epoch; reverse
   and release advance it; one exact release target reaches a terminal event.
2. Add Rust mailbox tests for pending replacement, active decode retention,
   cancellation boundaries, and terminal accounting.
3. Run a controlled native-surface benchmark for 1080p H.264 and 4K VFR HEVC,
   separately for playback, forward scrub, reverse scrub, release, and play
   immediately after scrub.
4. Validate macOS Metal and Windows DX12 independently. Linux support remains
   explicitly scoped rather than inferred.
5. A feature may add new native overlay inputs only through `EvaluatedScene`
   and the typed native snapshot/demand contracts.

No project-file migration is required: this is an ephemeral runtime protocol.

