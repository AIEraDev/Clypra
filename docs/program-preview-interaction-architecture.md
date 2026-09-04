# Program Preview Interaction Architecture

Status: required behavior for the desktop Program Preview.

## Decision

Program Preview has two interaction modes:

- `editing`: the preview is paused or stopped. The transform overlay is
  visible and owns selection, moving, resizing, and rotation.
- `playing`: the preview is presenting a moving frame. The transform overlay is
  visually hidden, but its full-surface selection capture plane remains active.

A primary-button click on the preview during `playing` is treated as an edit
intent. The interaction layer pauses the Program transport first and then runs
the normal hit test at the current playhead position. This matches the expected
NLE behavior: clicking an object stops playback and selects it without starting
a transform against a moving frame.

## Ownership boundaries

```text
TransportAuthority / ProgramPlaybackContext
  owns play, pause, seek, and the authoritative clock

ConnectedTransformOverlay
  subscribes to playback state for the overlay leaf only
  translates a playing click into transport.pause()

TransformOverlay
  owns hit testing and selection
  owns transform handles only in editing mode
  never writes playback state or timeline state just to pause a click

Native preview surface
  owns continuous playback pixels
  is configured with ignored cursor events, allowing the WebView selection
  capture plane to receive preview clicks
```

The native surface and the WebView are separate compositing layers. CSS
`z-index` is not an input-routing mechanism between them. The selection capture
plane must therefore remain mounted in the WebView while playing, even though
its visual opacity is zero.

## Pointer-down sequence

```text
pointer/mouse down inside Program Preview
  -> invisible TransformOverlay capture plane receives it
  -> if mode is playing: TransportAuthority.pause()
  -> hit test uses the current clock time
  -> selected clip is committed through the existing UI selection store
  -> paused overlay becomes visible from its leaf clock subscription
```

While playing, the selected clip's move surface and handles have
`pointer-events: none`. This prevents a click-to-pause from accidentally
starting a move or resize. Once paused, the normal transform hit targets are
reactivated.

## Performance rules

- The preview container must not subscribe to the playback clock merely to
  update transport labels or overlay visibility.
- Playback subscriptions belong in leaf UI components or imperative render
  loops.
- A playback click must not update clip geometry. It only pauses transport and
  changes selection.
- Continuous playback remains native-surface owned; paused frames remain the
  editing/readback path.
- Any future preview interaction must choose an explicit mode and must not
  infer editability from native-surface visibility.

## Implementation locations

- `src/components/editor/preview/NativeProgramPreview.tsx` wires the playback
  clock to `ConnectedTransformOverlay` and keeps transport subscriptions out
  of the preview container.
- `src/components/editor/transform/TransformOverlay.tsx` implements the
  invisible capture plane and mode-specific pointer policy.
- `src-tauri/src/commands/native_surface.rs` configures the native child
  surface to ignore cursor events so the WebView can receive preview input.

