# Transform System Implementation

## Overview

Professional transform control system for clip manipulation in the preview canvas, inspired by CapCut's UX but built with NLE-grade architecture.

## Phase 1 & 2: Foundation + Basic Transform UI ✅ COMPLETE

### What Was Built

#### 1. Data Model Extensions

**File**: `src/types/index.ts`

- Extended `Clip` interface with:
  - `aspectRatioLocked?: boolean` - Lock aspect ratio during scaling
  - `sourceAspectRatio?: number` - Original media aspect ratio
- Added transform types:
  - `TransformHandle` - Handle types (move, corners, edges, rotate)
  - `TransformState` - Active transform state during drag
  - `TransformConstraints` - Constraints for transform operations

#### 2. UI State Management

**File**: `src/store/uiStore.ts`

- Added transform state:
  - `activeTransform: TransformState | null` - Current transform operation
  - `transformMode: "select" | "transform" | null` - Current tool mode
- Added transform actions:
  - `startTransform()` - Begin transform operation
  - `updateTransform()` - Update during drag
  - `endTransform()` - Commit transform
  - `setTransformMode()` - Switch tool modes

#### 3. Transform Calculator

**File**: `src/lib/transform/calculator.ts`

- Core transform math utilities:
  - `calculateTransform()` - Main transform calculation
  - `handleMove()` - Position translation
  - `handleCornerDrag()` - Corner scaling with aspect ratio
  - `handleEdgeDrag()` - Single-axis scaling
  - `handleRotation()` - Rotation around center
  - `getCursorForHandle()` - Cursor styles
  - `isPointInClip()` - Hit testing
  - `getDefaultConstraints()` - Default constraints

**Features**:

- Aspect ratio locking
- Minimum size constraints
- Canvas bounds checking
- Snap-to-angle for rotation (0°, 45°, 90°, etc.)

#### 4. History Integration

**File**: `src/core/history/commands/TransformCommand.ts`

- `TransformClipCommand` - Undo/redo for transforms
- Features:
  - Stores old/new transform state
  - Supports command merging (coalesce consecutive transforms)
  - Full undo/redo support
  - Integrates with existing command system

#### 5. Transform Overlay Component

**File**: `src/components/editor/transform/TransformOverlay.tsx`

- Visual transform controls:
  - White border showing clip bounds
  - 8 handles (4 corners + 4 edges)
  - Rotation handle (top center)
  - Drag-to-move on border
- Interaction:
  - Mouse down → start transform
  - Mouse move → update transform (optimistic)
  - Mouse up → commit to history
  - Proper cursor styles per handle

#### 6. Preview Integration

**File**: `src/components/editor/PreviewPanel.tsx`

- Integrated `TransformOverlay` into preview canvas
- Renders on top of video preview
- Scales with preview dimensions

#### 7. Clip Creation Updates

**File**: `src/lib/timelineClip.ts`

- `createClipFromAsset()` now sets:
  - `aspectRatioLocked: true` by default
  - `sourceAspectRatio` from media dimensions

---

## Current Capabilities

### ✅ Working Features

1. **Visual Selection** - White border + handles on selected clip
2. **Move** - Drag border to reposition clip
3. **Corner Scale** - Drag corners to scale (aspect ratio locked)
4. **Edge Scale** - Drag edges for single-axis scaling
5. **Rotation** - Drag rotation handle to rotate
6. **Undo/Redo** - Full history support
7. **Constraints** - Minimum size, canvas bounds
8. **Optimistic Updates** - Smooth real-time preview

### 🚧 Not Yet Implemented

1. **Multi-select** - Transform multiple clips at once
2. **Keyboard shortcuts** - Arrow keys for nudging
3. **Snap guides** - Align to canvas edges, other clips
4. **Dimension display** - Show width×height during resize
5. **Rotation angle display** - Show degrees during rotation
6. **Aspect ratio toggle** - Shift key to toggle lock
7. **Scale from center** - Alt/Option key modifier
8. **Crop mode** - Separate crop tool

---

## Usage

### For Users

1. **Select a clip** in the timeline
2. **Transform controls appear** in the preview
3. **Drag border** to move
4. **Drag corners** to scale (maintains aspect ratio)
5. **Drag edges** to scale on one axis
6. **Drag rotation handle** to rotate
7. **Undo/Redo** works as expected

### For Developers

#### Get Transform State

```typescript
const { activeTransform, transformMode } = useUIStore();
```

#### Start Transform Programmatically

```typescript
const { startTransform } = useUIStore();

startTransform({
  clipId: "clip-123",
  handle: "se", // southeast corner
  startTransform: { x, y, width, height, rotation },
  startMousePos: { x: 100, y: 200 },
  aspectRatioLocked: true,
  sourceAspectRatio: 16 / 9,
});
```

#### Calculate Transform

```typescript
import { calculateTransform, getDefaultConstraints } from "@/lib/transform/calculator";

const constraints = getDefaultConstraints(1920, 1080, true);
const newTransform = calculateTransform(
  clip,
  "se", // handle
  startMousePos,
  currentMousePos,
  constraints,
);
```

#### Create Transform Command

```typescript
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";

const command = new TransformClipCommand(
  clipId,
  { x: 0, y: 0, width: 100, height: 100 }, // old
  { x: 10, y: 10, width: 120, height: 120 }, // new
);

execute(command);
```

---

## Architecture Principles

### 1. Separation of Concerns

- **Transform math** (`calculator.ts`) - Pure functions, no UI
- **UI state** (`uiStore.ts`) - Ephemeral interaction state
- **History** (`TransformCommand.ts`) - Persistent, undoable operations
- **Visual** (`TransformOverlay.tsx`) - Rendering only

### 2. Coordinate Spaces

- **Canvas space** - Clip coordinates (x, y, width, height)
- **Screen space** - Mouse/pointer coordinates
- **Display space** - Scaled for preview rendering

### 3. Optimistic Updates

- During drag: Update clip immediately (no history)
- On drag end: Commit to history (enables undo)
- This provides smooth UX without history spam

### 4. Command Pattern

- All transforms go through `TransformClipCommand`
- Supports undo/redo out of the box
- Commands can merge (coalesce rapid transforms)

---

## Next Steps (Phase 3-5)

### Phase 3: Enhanced Interactions

- [ ] Keyboard shortcuts (arrow keys, Shift, Alt, Cmd)
- [ ] Snap guides (canvas edges, other clips)
- [ ] Dimension/angle displays
- [ ] Aspect ratio toggle (Shift key)

### Phase 4: Multi-Select

- [ ] Transform multiple clips at once
- [ ] Relative positioning maintained
- [ ] Batch transform command

### Phase 5: Advanced Features

- [ ] Crop mode (separate from transform)
- [ ] Anchor point control
- [ ] Keyframe animation support
- [ ] 3D transforms (perspective)

---

## Testing

### Manual Testing

1. Add a clip to timeline
2. Select the clip
3. Verify transform controls appear
4. Test each handle type
5. Verify undo/redo works
6. Test with different aspect ratios

### Unit Tests (TODO)

- Transform calculator functions
- Constraint enforcement
- Coordinate conversions
- Command serialization

---

## Known Limitations

1. **Single clip only** - Multi-select not yet supported
2. **No keyboard shortcuts** - Mouse-only for now
3. **No snap guides** - Free positioning only
4. **No visual feedback** - No dimension/angle display
5. **Rotation handle position** - Fixed at top center (doesn't account for rotation)

---

## Performance Considerations

1. **Optimistic updates** - No history spam during drag
2. **Command merging** - Consecutive transforms coalesce
3. **Minimal re-renders** - Only selected clip updates
4. **GPU acceleration** - CSS transforms for handles
5. **Event throttling** - Mouse move events are efficient

---

## Files Modified/Created

### Created

- `src/lib/transform/calculator.ts`
- `src/core/history/commands/TransformCommand.ts`
- `src/components/editor/transform/TransformOverlay.tsx`
- `TRANSFORM_SYSTEM.md` (this file)

### Modified

- `src/types/index.ts` - Added transform types
- `src/store/uiStore.ts` - Added transform state
- `src/lib/timelineClip.ts` - Set aspect ratio on clip creation
- `src/core/history/commands/index.ts` - Export TransformCommand
- `src/components/editor/PreviewPanel.tsx` - Integrate TransformOverlay

---

## References

### Inspiration

- **CapCut** - Transform UX patterns
- **Adobe Premiere Pro** - Professional NLE standards
- **DaVinci Resolve** - Transform constraints
- **Final Cut Pro** - Snap guides and alignment

### Technical

- [CSS Transforms](https://developer.mozilla.org/en-US/docs/Web/CSS/transform)
- [Command Pattern](https://refactoring.guru/design-patterns/command)
- [Optimistic UI](https://www.apollographql.com/docs/react/performance/optimistic-ui/)
