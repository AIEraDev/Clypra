# ADR: Native Media Authority

Status: accepted on `codex/native-architecture-migration`

## Decision

Clypra will make one platform-neutral Rust media core authoritative for
timeline frame addressing, native decode, color normalization, compositing,
playback coordination, thumbnails, filmstrips, and export. Desktop Tauri is
the first production consumer. React remains the editor UI. Pixi may display a
final native frame during migration, but it cannot own decode, frame timing,
color conversion, or export.

## Performance constraint

The migration is required to preserve the existing fast editing experience.
Working behavior is the baseline, not a disposable prototype. Native playback
must not move full RGBA frames through high-bandwidth CPU IPC. Paused frames
may use the temporary RGBA bridge; continuous playback requires a native
surface or an equivalent shared-texture path.

The initial runtime budget is 60 FPS, 16,667 microseconds for a displayed
frame, 100 ms maximum seek latency, and a 1 GiB per-project native media
budget. These are measured budgets and may be tightened after representative
fixtures are profiled.

## Why a staged authority change

The existing browser playback path is retained only while native audio and
native presentation are incomplete. This prevents a migration regression from
being disguised as an architectural improvement. Each subsystem changes
authority only after its gate passes; the final state has no permanent dual
media runtime.

## Rejected alternatives

- Keeping browser decode as the permanent playback path would preserve the
  cross-OS color and timing divergence this migration addresses.
- Sending RGBA frames over IPC during playback would trade OS consistency for
  predictable throughput failure.
- Rewriting the entire editor UI in wgpu is out of scope; native pixel
  authority does not require native editor chrome.

## Consequences

The migration needs explicit contracts, stale-response rejection, bounded
caches, platform surface probes, and golden-frame CI before legacy deletion.
Native audio output is being introduced behind a CPAL clock adapter with
bounded FFmpeg PCM decoding and a deterministic bounded multi-clip mixer. Full
native effects/text/Lottie coverage remains a separate gate rather than an
implicit promise. The Tauri program preview
now uses the native audio controller for a controlled audio-authority takeover
and can schedule validated native video frames continuously for representable
scenes while the direct native visual surface migration is completed. The
native compositor now also has a direct transparent child-surface presentation
command positioned over the preview region, with Lost/Outdated swapchain
recovery and stale-request rejection. Full scene coverage remains gated on
native effects/text parity.
