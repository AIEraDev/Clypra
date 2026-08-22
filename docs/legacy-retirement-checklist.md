# Legacy Retirement Checklist

Legacy code is removed only after the replacement gate passes and the audit
below is clean. Temporary migration adapters are allowed on the branch, but
they must have an owner and a deletion gate.

## Program path

- [ ] No hidden `<video>` element or browser frame-readiness dependency.
- [ ] No `PreviewMediaPool` ownership.
- [ ] No browser playback scheduler owns program frame selection.
- [ ] No `VideoTextureManager` video decode/compositing path.
- [x] Native surface receives the authoritative final frame.

## Filmstrip and thumbnails

- [x] Tauri filmstrip requests use the versioned native frame service.
- [ ] Duplicate decoder commands are removed after the native service covers
  every thumbnail/source-still caller.
- [ ] Web and Capacitor adapters remain frozen and are not used to judge the
  desktop native migration.

## Playback and export

- [ ] Native audio output and sample-clock session pass A/V tests.
- [x] Native surface probe creates/configures the actual Tauri window surface
  without repainting the editor.
- [ ] Native surface/shared-texture playback passes the platform matrix.
- [ ] Export consumes the same graph and golden frames as preview.
- [ ] Browser source-preview playback is removed.
- [ ] Legacy browser export frame pools are retired after native export coverage.

## Audit commands

Before deletion, run searches for `<video`, `VideoFrame`, `WebCodecs`, `MSE`,
`PreviewMediaPool`, `VideoTextureManager`, browser playback scheduler names,
and legacy export frame pools. Review every match by program/source/export
path; a global string match alone is not a sufficient audit.
