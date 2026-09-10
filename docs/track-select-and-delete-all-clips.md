# Track: Select All Clips & Delete All Clips

Date: 2026-09-10

Right-clicking a track label now opens a dedicated track context menu. Two new
commands live in it — **Select All Clips in Track** and **Delete All Clips in
Track** — and the ⌘A / Ctrl+A keyboard shortcut is scoped to whichever track
the mouse is hovering over.

---

## Problem the change solves

Before this update there was no way to operate on all clips belonging to one
track as a group. Selecting them required shift-clicking each clip individually,
and deleting them required either a selection loop or a destructive store
mutation with no undo. The only context menu available on the track row was the
**empty-space** menu (paste, add gap, add track), which mixes clip concerns with
timeline-level concerns and has no access to track-scoped clip lists.

---

## Architecture

### 1. `selectAllClipsInTrack` — `src/store/uiStore.ts`

A new method added to `UIStore`:

```ts
selectAllClipsInTrack: (trackId: string) => void
```

Reads the flat `clips` array from `useTimelineStore.getState()`, filters by
`trackId`, and sets the result as `selectedClipIds`. Also clears
`selectedGapId` and `selectedTransitionId` so selection is never in a mixed
state.

```ts
selectAllClipsInTrack: (trackId) => {
  const clips = useTimelineStore.getState().clips.filter(
    (c) => c.trackId === trackId,
  );
  set({
    selectedClipIds: clips.map((c) => c.id),
    selectedGapId: null,
    selectedTransitionId: null,
  });
},
```

### 2. Two new track commands — `src/core/commands/timelineCommands.ts`

Both commands are added to the existing `timelineCommands` array in the
`"track"` group. They use the `TimelineCommandContext` interface unchanged —
`clickedTrackId` and `clips` are already present.

#### `track.selectAllClips`

| Property | Value |
|---|---|
| Group | `"track"` |
| Shortcut label | `⌘A` |
| Enabled when | `clickedTrackId` is set **and** the track has ≥ 1 clip |
| Disabled reason | `"Track has no clips"` |
| Execute | Calls `useUIStore.getState().selectAllClipsInTrack(ctx.clickedTrackId)` |

#### `track.deleteAllClips`

| Property | Value |
|---|---|
| Group | `"track"` |
| Danger | `true` |
| Enabled when | `clickedTrackId` is set, track is **not** locked, and track has ≥ 1 clip |
| Disabled reason | `"Track is locked"` or `"Track has no clips"` |
| Execute | Collects all clip IDs on the track, calls `EditingActions.deleteSelection(ids, false)` (ripple delete, fully undoable) |

### 3. `TrackContextMenu` — `src/components/editor/timeline/TrackContextMenu.tsx`

A new component that mirrors `TimelineEmptySpaceContextMenu`. It calls
`useTimelineCommands(trackId, 0)` — `clickedTime` is `0` because label
right-clicks are not time-positioned — and maps the resolved commands to the
shared `ContextMenu` UI component. Each item calls `executeCommand` then
`onClose`.

```
TrackContextMenu
  └── useTimelineCommands(trackId, 0)   ← resolves enabled/visible state
  └── ContextMenu                        ← shared UI primitive
```

### 4. `TrackLabel` — `src/components/editor/timeline/TrackLabel.tsx`

Added:

- `onContextMenu?: (e: React.MouseEvent, trackId: string) => void` prop.
- `data-track-label` attribute on the root div (already referenced by the
  `seekFromPointer` guard in `Timeline.tsx` — previously implicit, now
  explicit).
- `onContextMenu` handler that calls `e.preventDefault()` +
  `e.stopPropagation()` then fires the prop.

### 5. `Timeline` — `src/components/editor/timeline/Timeline.tsx`

Added:

- `trackLabelContextMenu` state (mirrors `clipContextMenu` and
  `emptySpaceContextMenu`).
- `handleTrackLabelContextMenu` callback — sets the state and clears all other
  open context menus.
- Every other context-menu handler (`handleClipContextMenu`,
  `handleTrackContextMenu`, `handleGapContextMenu`) also calls
  `setTrackLabelContextMenu(null)` so only one menu is ever open.
- `onContextMenu={handleTrackLabelContextMenu}` passed to `<TrackLabel>`.
- `<TrackContextMenu>` rendered in the context-menu block between
  `<ClipContextMenu>` and `<TimelineEmptySpaceContextMenu>`.

### 6. Scoped ⌘A shortcut — `src/components/editor/timeline/Track.tsx`

The track row div gains three new props:

```tsx
tabIndex={-1}
onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
onKeyDown={handleKeyDown}
```

`tabIndex={-1}` makes the row programmatically focusable without inserting it
into the natural tab order. `onMouseEnter` focuses it immediately on hover so
⌘A works without needing a prior click. `outline-none` suppresses the browser
default focus ring (the timeline's own selection highlight provides the visual
cue).

`handleKeyDown` intercepts ⌘A (macOS) / Ctrl+A (Windows/Linux):

```ts
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMeta = e.metaKey || e.ctrlKey;
    if (isMeta && e.key === "a") {
      e.preventDefault();   // suppress browser select-all
      e.stopPropagation();  // prevent global clip.selectAll from also firing
      useUIStore.getState().selectAllClipsInTrack(track.id);
    }
  },
  [track.id],
);
```

`stopPropagation` is critical — the global `keydown` listener in `Timeline.tsx`
handles `clip.selectAll` (all clips, all tracks) when ⌘A is pressed. Without
stopping propagation both handlers would fire and immediately override the
track-scoped selection with the full selection.

---

## Interaction design

| Gesture | Result |
|---|---|
| Right-click track label | Opens `TrackContextMenu` |
| Click **Select All Clips in Track** | All clips on that track enter `selectedClipIds`; prior selection (any track) is replaced |
| Click **Delete All Clips in Track** | Ripple-deletes all clips on the track in one undoable step |
| Hover over track row + ⌘A / Ctrl+A | Selects all clips on that track (does not affect other tracks) |
| ⌘A without hovering a track | Global `clip.selectAll` fires — all clips across all tracks selected (unchanged behavior) |
| Backspace / Delete after select-all | Existing ripple-delete shortcut in `Timeline.tsx` operates on `selectedClipIds` as normal |

### Locked track behavior

- **Select All** is enabled on locked tracks — selection is read-only and has
  no side effects, so there is no reason to block it.
- **Delete All** is disabled on locked tracks — the `isEnabled` guard returns
  `false`, and the `disabledReason` surfaces `"Track is locked"` in the menu.

### Empty track behavior

Both commands are disabled (`isEnabled: false`) when the track has no clips.
The context menu still shows them but renders them greyed out with a tooltip
reason.

---

## Undo/redo

`track.deleteAllClips` calls `EditingActions.deleteSelection(ids, false)` which
dispatches `RippleDeleteRangeCommand` through `useHistoryStore.execute`. This is
the same code path as pressing Backspace on a multi-selection — fully undoable,
one history entry regardless of how many clips the track contained.

`track.selectAllClips` and `selectAllClipsInTrack` are selection-only operations
on `uiStore`, which is intentionally ephemeral and not part of the undo stack.

---

## Files changed

| File | Change |
|---|---|
| `src/store/uiStore.ts` | Added `selectAllClipsInTrack(trackId)` to interface and implementation |
| `src/core/commands/timelineCommands.ts` | Added `track.selectAllClips` and `track.deleteAllClips` commands; added `CheckSquare`, `Trash2` imports and `EditingActions` import |
| `src/components/editor/timeline/TrackContextMenu.tsx` | New component |
| `src/components/editor/timeline/TrackLabel.tsx` | Added `onContextMenu` prop, `data-track-label` attr, context-menu handler |
| `src/components/editor/timeline/Timeline.tsx` | Added `trackLabelContextMenu` state, handler, `TrackContextMenu` render, `onContextMenu` on `<TrackLabel>` |
| `src/components/editor/timeline/Track.tsx` | Added `tabIndex`, `onMouseEnter` focus, `handleKeyDown` for scoped ⌘A |

---

## Test coverage

`src/core/commands/__tests__/trackCommands.test.ts`

| Test | What it asserts |
|---|---|
| `selectAllClipsInTrack` — basic | Sets `selectedClipIds` to all clip IDs on the given track |
| `selectAllClipsInTrack` — multi-track isolation | Only clips on the target track are selected; clips on other tracks are not included |
| `selectAllClipsInTrack` — empty track | Results in an empty `selectedClipIds` array |
| `selectAllClipsInTrack` — clears gap selection | `selectedGapId` is `null` after calling |
| `track.selectAllClips` command — enabled on non-empty track | `isEnabled` returns `true` |
| `track.selectAllClips` command — disabled on empty track | `isEnabled` returns `false`; `disabledReason` is `"Track has no clips"` |
| `track.selectAllClips` command — enabled on locked track | Selection has no side effects, so locked tracks are allowed |
| `track.deleteAllClips` command — enabled on unlocked non-empty track | `isEnabled` returns `true` |
| `track.deleteAllClips` command — disabled on locked track | `isEnabled` returns `false`; `disabledReason` is `"Track is locked"` |
| `track.deleteAllClips` command — disabled on empty track | `isEnabled` returns `false`; `disabledReason` is `"Track has no clips"` |
| `track.deleteAllClips` execute — removes clips and clears selection | All clips on track are removed from the store; `selectedClipIds` is emptied |
| `track.deleteAllClips` execute — does not touch other tracks | Clips on unrelated tracks are unmodified after execution |
