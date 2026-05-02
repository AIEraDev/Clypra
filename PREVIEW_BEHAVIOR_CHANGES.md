# Preview Behavior Changes - Timeline-Driven Preview

## Summary

The preview system has been fundamentally redesigned to be **timeline-driven** instead of **media-selection driven**. This aligns with standard video editing behavior where the preview shows the composed timeline at the current playhead position.

## What Changed

### Before (Media-Selection Driven)

- Clicking a media asset in MediaPanel → sets `previewMediaId` → PreviewPanel renders that single media
- Preview was independent of timeline state
- Preview showed whatever media was selected, regardless of timeline content

### After (Timeline-Driven)

- PreviewPanel renders the **composed timeline scene** at `currentTime`
- Shows all active clips from all visible tracks, properly layered
- Respects track visibility, clip transforms (position, scale, opacity, rotation)
- Clicking media in MediaPanel still sets `previewMediaId` for **visual selection state only**
- Preview is now synchronized with timeline playhead position

## Updated Components

### 1. **PreviewPanel** (`src/components/editor/PreviewPanel.tsx`)

- Now uses `resolvePreviewScene()` to compute active layers from timeline state
- Renders multi-track composition with proper layering
- Added standard preview controls (play/pause, frame step, timecode)
- Fallback to "Preview" text when no active clips at current time

### 2. **Preview Scene Compositor** (`src/lib/previewScene.ts`)

- New pure logic module for computing preview scene from timeline state
- Resolves active clips at current time
- Handles track visibility filtering
- Maps timeline timing to source timing via `trimIn/trimOut`
- Returns render-ready scene layers with transforms

### 3. **MediaPanel** (`src/components/editor/MediaPanel.tsx`)

- **Behavior preserved**: Clicking media still highlights it visually
- **Clarified**: `previewMediaId` is now documented as selection state only
- **No breaking changes**: All existing interactions work the same

### 4. **UIStore** (`src/store/uiStore.ts`)

- **Preserved**: `previewMediaId` state remains for MediaPanel selection
- **Clarified**: Added comment explaining it no longer drives preview rendering
- **No breaking changes**: API remains identical

## User-Facing Changes

### What Users Will Notice

1. **Preview shows timeline composition** - Multiple tracks are now visible and properly layered
2. **Scrubbing updates preview** - Moving the playhead immediately updates the preview
3. **Track visibility affects preview** - Hiding a track removes it from preview
4. **Standard preview controls** - Play/pause, frame stepping, timecode display

### What Stays the Same

1. **Media selection in MediaPanel** - Still highlights selected media
2. **Drag and drop to timeline** - Works exactly as before
3. **Timeline editing** - All clip manipulation remains unchanged
4. **Track controls** - Lock/visibility/mute UI unchanged

## Technical Details

### New Architecture

```
Timeline State (tracks, clips, currentTime)
    ↓
resolvePreviewScene() [pure function]
    ↓
PreviewScene (array of layers with transforms)
    ↓
PreviewPanel Canvas Renderer
    ↓
Visual Output
```

### Key Principles

- **Pure logic**: Scene resolution is framework-agnostic and testable
- **Deterministic layering**: Track order + clip order defines z-index
- **Safe fallbacks**: Missing assets don't crash, show placeholders
- **Timeline as source of truth**: Preview derives from timeline, not vice versa

## Migration Notes

### For Developers

- `previewMediaId` in UIStore is now **selection state only**
- Preview rendering logic moved from media selection to timeline composition
- New `resolvePreviewScene()` function is the single source of truth for preview
- Tests updated to verify timeline-driven behavior

### For Future Features

- Audio mixing should follow same pattern: derive from timeline state
- Effects/transitions should be computed in scene resolution phase
- Any preview-related features should use `resolvePreviewScene()` as foundation

## Testing

### Unit Tests

- ✅ Scene resolution logic (`src/lib/__tests__/previewScene.test.ts`)
- ✅ Active clip resolution at boundary times
- ✅ Multi-track layering order
- ✅ Trim mapping correctness
- ✅ Transform/opacity handling

### Component Tests

- ✅ PreviewPanel renders timeline composition (`src/components/editor/__tests__/PreviewPanel.test.tsx`)
- ✅ Fallback behavior when no active clips
- ✅ Timeline tests continue passing

## Future Work (Deferred)

### Audio Mixing

- Per-track audio mixing deferred to follow-up
- Visual compositor is complete
- Audio will follow same timeline-driven pattern

### Potential Enhancements

- Real-time effects preview
- Transition rendering
- Color grading preview
- Multi-camera angle switching

## References

- Implementation: `src/lib/previewScene.ts`
- Rendering: `src/components/editor/PreviewPanel.tsx`
- Tests: `src/lib/__tests__/previewScene.test.ts`
- Store: `src/store/uiStore.ts` (selection state)
