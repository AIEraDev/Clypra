# Undoable Clip Drag

Date: 2026-08-24

Every successful clip drag now creates exactly one atomic history entry. Undo and redo restore tracks, clips, gaps, ordering, and stable IDs to their exact pre- or post-drag state. No orphan empty track can survive an undo.

---

## Problem the change solves

Before this fix, `useTimelineDrag.ts` finalized a drop by calling several `timelineStore` mutators directly:

```
insertTrackAt(newTrack, insertIndex)
updateClip(id, { trackId, startTime })
insertClipAtIndex(...)
removeEmptyNonMainTracks()
detectAndSyncGaps()
```

Each call was a standalone store mutation. The history system never saw any of them. Pressing Cmd-Z after a drag did nothing to the drag itself, and if the drag had created a new track, that track stayed behind as an orphan.

---

## Architecture

### 1. Pure result builder — `buildTimelineDragResult`

`src/core/history/commands/TimelineDragCommand.ts`

The builder takes a frozen snapshot of the store plus the drag state and computes the complete before/after diff without touching any live state. It returns a `TimelineDragResult` or `null`.

```
BuildTimelineDragResultInput
  state           TimelineDragState   frozen store snapshot
  drag            TimelineDragSnapshot  end-of-drag shape
  clip            Clip                primary dragged clip
  trackType?      TrackType           required for new-track drops
  snapEnabled     boolean
  currentTime     number
  pixelsPerSecond number
  newTrackInsertIndex?  number        required for new-track drops
```

`TimelineDragResult` stores paired before/after arrays for every affected entity:

| Field | What it covers |
|---|---|
| `beforeClips` / `afterClips` | clips whose `trackId` or `startTime` changed |
| `beforeTracks` / `afterTracks` | source track, new track (if created), removed empty tracks |
| `beforeTrackIndices` / `afterTrackIndices` | insertion positions in the full track list |
| `beforeGaps` / `afterGaps` | gaps on all affected tracks, with protected-gap metadata preserved |
| `beforeGapIndices` / `afterGapIndices` | gap positions in the full gap list |
| `mainVideoTrackIdBefore` / `mainVideoTrackIdAfter` | updated when a new video track is created |
| `affectedTrackIds` | union of source track IDs and destination track ID |

The builder covers three drop paths internally:

**New-track drop** (`willCreateNewTrack === true`): Generates a fresh track ID via `generateId("track")`, splices it into `afterTracks` at `newTrackInsertIndex`, snaps the primary clip's left edge, and offsets all co-selected clips by their relative start-time delta from the primary.

**Existing-track gap/append drop** (`dropTarget.type === "gap" | "append"`): Places each dragged clip at `dropTarget.startTime + relativeOffset`, rejects the whole drop and returns `null` if any clip would overlap an existing non-dragged clip.

**Existing-track insert drop** (`dropTarget.type === "insert"`): Reorders clips on the target track by splicing the dragged clips into the target insertion index and assigning sequential `startTime` values.

After computing `afterClips` and `afterTracks` for any of the three paths, the builder:

1. Removes source tracks that are now empty and are not `mainVideoTrackId`.
2. Runs `syncGapsForTracks` on all affected tracks, which calls `detectGaps` then re-anchors existing protected gaps by overlap matching so their IDs and metadata survive.
3. Returns `null` if the computed diff is a true no-op (clips unchanged, tracks unchanged).

### 2. Command class — `TimelineDragCommand`

Implements the `Command` interface. Holds the `TimelineDragResult` patch and applies it statelessly through `applyPatch`.

```ts
class TimelineDragCommand implements Command {
  apply(state: TimelineDragState): TimelineDragState   // applies afterClips/afterTracks/afterGaps
  invert(): TimelineDragCommand                        // swaps before↔after, returns new command
  toJSON(): Record<string, unknown>                    // { type: "TimelineDrag", patch }
  static fromJSON(data): TimelineDragCommand           // deserializes from patch object
}
```

`applyPatch` reconstructs the full clips, tracks, and gaps arrays from the store by:

- Replacing only the changed clips in the full clip list (unchanged clips are kept as-is).
- Removing all tracks whose IDs are in `affectedTrackIds`, then splicing the correct before or after tracks back at their stored indices.
- Doing the same splice-based reconstruction for gaps.
- Incrementing `epoch` so store subscribers re-render.

`invert()` returns a new `TimelineDragCommand` with all `before`/`after` fields swapped, which is what the history stack calls when executing undo.

### 3. Hook integration — `useTimelineDrag.ts`

`handleClipDragEnd` now calls `buildTimelineDragCommand` at every valid drop site and hands the result to the history executor:

```ts
const command = buildTimelineDragCommand({ state: store, drag: dragSnapshot, clip, ... });
if (command) useHistoryStore.getState().execute(command);
```

The direct `timelineStore` mutations (`insertTrackAt`, `updateClip`, `removeEmptyNonMainTracks`, `detectAndSyncGaps`) are gone from the finalization path. The history executor applies `command` against the live store state, which performs the equivalent mutations atomically and registers the entry in the undo stack.

Drop paths that produce no history entry:

| Condition | Reason |
|---|---|
| `dragSnapshot.isInvalidPosition === true` | Overlap or locked-track rejection |
| `!dragSnapshot.targetTrackId && !willCreateNewTrack` | Pointer released over empty canvas |
| `buildTimelineDragCommand` returns `null` | No-op reorder, stale clip ID, overlap detected in builder |
| ESC key during drag | Drag state cleared before `handleClipDragEnd` is reached |

---

## Gap preservation

Source-track gap closure is scoped to only the gap created by the moved clips, not the full track. `calculateDepartureClosurePositions` shifts the clips that were adjacent to the departure site leftward to fill only the space vacated by the dragged set. Gaps on the source track that are unrelated to the drag (earlier, or on a different segment) are not modified.

Protected gaps carry their original IDs into the after-state through the overlap-matching logic in `syncGapsForTracks`:

```
for each protected gap on the affected track:
  find the auto-detected gap that overlaps it
  replace that gap's ID and metadata with the protected gap's values
```

This keeps protected gaps stable across undo and redo.

---

## Undo/redo invariants

- Undo restores the exact `beforeTracks` array (including any source track that was removed) at its original index. The new track disappears completely.
- Redo re-creates the same track with the same stable ID at the same index.
- Clip `startTime` and `trackId` values are byte-for-byte identical between the original apply and any subsequent redo.
- `mainVideoTrackId` is restored on undo if it changed during the drop.
- The undo entry label is `"Move Clips"`. Pressing Cmd-Z after a drag targets this entry before any earlier command (e.g. a split that preceded the drag).

---

## Serialization

`toJSON` / `fromJSON` round-trip the full `TimelineDragResult` patch. Because the patch stores complete entity snapshots rather than delta operations, deserialization from a session-restore payload produces an identical command that applies and inverts correctly without re-running any calculation.

```json
{
  "type": "TimelineDrag",
  "patch": {
    "beforeClips": [...],
    "afterClips": [...],
    "beforeTracks": [...],
    "afterTracks": [...],
    "beforeTrackIndices": [0],
    "afterTrackIndices": [0],
    "beforeGaps": [...],
    "afterGaps": [...],
    "beforeGapIndices": [],
    "afterGapIndices": [],
    "affectedTrackIds": ["track-42", "source"],
    "mainVideoTrackIdBefore": "source",
    "mainVideoTrackIdAfter": "source"
  }
}
```

---

## Test coverage

`src/core/history/commands/__tests__/TimelineDragCommand.test.ts`

| Test | What it asserts |
|---|---|
| New-track drop + undo/redo | New track at correct index; undo restores source; redo reproduces the same stable track ID and clip positions |
| Serialization round-trip | `fromJSON(toJSON())` produces a command that applies identically |
| Canceled / missing drop target | `buildTimelineDragCommand` returns `null`; no history entry |
| Existing-track move | Clip lands at `dropTarget.startTime`; source track closes correctly; unrelated empty tracks are preserved |
| Same-track no-op reorder | Returned command is `null`; journal stays clean |
| Undo ordering after prior edit | After split + drag, first undo label is `"Move Clips"`, not `"Split Clip"` |

---

## Files changed

| File | Change |
|---|---|
| `src/core/history/commands/TimelineDragCommand.ts` | New — builder, interfaces, command class |
| `src/core/history/commands/index.ts` | Re-exports `TimelineDragCommand`, `buildTimelineDragCommand`, `buildTimelineDragResult` |
| `src/hooks/timeline/useTimelineDrag.ts` | Replaced direct store mutations with `buildTimelineDragCommand` + `execute` |
| `src/core/history/commands/__tests__/TimelineDragCommand.test.ts` | New — 6 command-level tests |
