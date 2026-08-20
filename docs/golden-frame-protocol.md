# Golden-Frame Protocol

## Purpose

Golden frames make cross-OS consistency a testable contract. They are not a
visual screenshot test of the WebView. The fixture is rendered by the native
frame graph from an immutable `ProjectSnapshot` and integer `FrameRequest`.

## Corpus

The corpus must include:

- SDR Rec.601, Rec.709, full range, limited range, and explicit chroma
  locations.
- HDR transfer/primaries with the default SDR tone-map policy.
- CFR and VFR sources mapped to the same project frame indices.
- Rotation, non-square pixels, trims, gaps, speed changes, and transitions.
- Video over solid, image, text, sticker, mask, adjustment, and blend layers.
- Alpha edges, gradients, skin tones, saturated colors, and near-black detail.
- Audio-bearing projects for playback timing tests.

## Request identity

Each artifact is keyed by project revision, asset identity, frame index, quality
tier, color-policy version, and render-graph version. Changing any of these
invalidates the artifact; never update a golden image without recording why
the contract changed.

## Comparison

The software/reference renderer establishes the expected pixels. Hardware
backends are compared with a documented tolerance for GPU precision only;
matrix, range, transfer, rotation, alpha, or frame-index shifts are failures.
The report must include exact dimensions, format, stride, and a diff summary.

## CI gate

Run the same fixture manifest on macOS, Windows, and Linux. A run fails on a
missing frame, wrong dimensions, stale response, unsupported feature that was
declared supported, or a diff outside tolerance. Upload diff images and the
request JSON as CI artifacts. Do not use network-hosted media; fixtures must
be committed or downloaded from a pinned, checksum-verified source.

## Local command shape

The eventual harness should expose a deterministic command equivalent to:

```text
native-golden --manifest fixtures/native/manifest.json --output artifacts/golden
```

The command must be runnable without the React application so decoder,
compositor, and export parity can be diagnosed independently.
