# Core NLE Engine

This directory contains the core engine of the video editor, separate from React/UI concerns.

## Architecture Philosophy

**Time-Centric, Not Track-Centric**

Professional NLEs like CapCut and Premiere resolve frames by **time**, not by track structure:

```typescript
// ❌ Old approach (track-centric)
function getFrame(time) {
  return mainTrack.getClipAt(time);
}

// ✅ New approach (time-centric compositor)
function getFrame(time) {
  const stack = resolveRenderStack(time, allClips);
  return composite(stack); // Multiple layers
}
```

## Modules

### `/compositor` - Core Frame Resolution

The heart of the NLE. Resolves what should render at any given time.

**Integrates with existing time utilities** from `src/lib/timelineClip.ts`:

- Uses `getClipEndTime()` for consistent clip end calculation
- Uses `getTimelineContentEnd()` for total duration
- Maintains compatibility with existing timing logic

**Key Concepts:**

- **Render Stack**: At time `t`, returns `RenderLayer[]` (not a single clip)
- **Compositing Order**: Deterministic layering (background → primary → overlay → text → effects)
- **Roles**: Clips have semantic roles (`primary`, `overlay`, `text`, `audio`)
- **Pure Functions**: No side effects, no React dependencies

**Example:**

```typescript
import { resolveRenderStack, toCompositorClips } from "@/core";

const compositorClips = toCompositorClips(clips, tracks);
const stack = resolveRenderStack(2.5, compositorClips);

// stack.layers = [
//   { clip: backgroundClip, opacity: 1, ... },
//   { clip: primaryClip, opacity: 1, ... },
//   { clip: overlayClip, opacity: 0.8, ... },
//   { clip: textClip, opacity: 1, ... }
// ]
```

### `/timeline` - Adapter Layer

Bridges legacy `Clip` type with new `CompositorClip` type.

**Purpose:**

- Gradual migration without breaking existing code
- Infers compositor metadata from track information
- Converts between old and new models

**Example:**

```typescript
import { toCompositorClips } from "@/core";

// Convert legacy clips to compositor clips
const compositorClips = toCompositorClips(clips, tracks);
```

### `/render` - Fallback Strategies

Handles rendering when no content exists at a time.

**Strategies:**

- `black`: Render black frame
- `transparent`: Render transparent frame
- `placeholder`: Show "no content" message
- `freeze`: Hold previous frame

**Example:**

```typescript
import { getFallbackFrame, renderFallbackToCanvas } from "@/core";

const fallback = getFallbackFrame(time, "black");
renderFallbackToCanvas(ctx, width, height, fallback);
```

## Key Differences from Old Architecture

### 1. No Track Protection

**Old:**

```typescript
// ❌ Blocked operations that would empty main track
if (wouldEmptyMainTrack) {
  return; // Block deletion/move
}
```

**New:**

```typescript
// ✅ Allow all operations, validate after
const validation = validateTimeline(clips);
if (validation.warnings.length > 0) {
  showWarning(validation.warnings); // Inform, don't block
}
```

### 2. Compositing Stack vs Single Layer

**Old:**

```typescript
// ❌ Single layer resolution
const clip = getClipAt(time, mainTrack);
render(clip);
```

**New:**

```typescript
// ✅ Multi-layer compositing
const stack = resolveRenderStack(time, clips);
stack.layers.forEach((layer) => {
  renderLayer(layer); // Composite bottom-to-top
});
```

### 3. Validation is Diagnostic, Not Enforcement

**Old:**

```typescript
// ❌ Validation blocks operations
if (!isValid()) {
  throw new Error("Invalid operation");
}
```

**New:**

```typescript
// ✅ Validation informs, never blocks
const validation = validateTimeline(clips);
// User can still proceed, but sees warnings
```

### 4. Deterministic Compositing Order

Clips are sorted by:

1. **Role type** (background < primary < overlay < text < effect)
2. **Track index** (lower tracks render below higher tracks)
3. **Z-index** (explicit layer control)
4. **Evaluation priority** (tie-breaker)

This ensures consistent, predictable rendering.

## Usage in React Components

Use the provided hooks:

```typescript
import { useRenderStack, useTimelineValidation } from '@/hooks/useCompositor';

function PreviewPanel() {
  const currentTime = usePlaybackStore(s => s.currentTime);
  const stack = useRenderStack(currentTime);

  // Render all layers in stack
  stack.layers.forEach(layer => {
    renderLayer(layer);
  });
}

function TimelineWarnings() {
  const validation = useTimelineValidation();

  return (
    <div>
      {validation.warnings.map(warning => (
        <Warning key={warning}>{warning}</Warning>
      ))}
    </div>
  );
}
```

## Future Enhancements

This architecture enables:

- ✅ **Multicam editing**: Multiple primary sources resolved by time
- ✅ **Nested timelines**: Timelines as clips
- ✅ **Transitions**: Evaluated per-frame with blend modes
- ✅ **Speed ramps**: Time remapping in `evaluateClip()`
- ✅ **Effects graph**: Per-layer effect evaluation
- ✅ **Proxy workflows**: Resolution-independent rendering
- ✅ **Collaborative editing**: Conflict-free state merging

## One Source of Truth

This engine is used by:

- **Preview rendering** (`PreviewPanel.tsx`)
- **Export rendering** (future)
- **Thumbnail generation** (future)
- **Proxy rendering** (future)
- **Timeline validation** (current)

No divergence between preview and export. One compositor, one truth.

## Migration Path

1. ✅ **Phase 1**: Engine separation (this directory)
2. ✅ **Phase 2**: Remove track protection (Timeline.tsx, MediaTab.tsx)
3. ⏳ **Phase 3**: Update preview to use compositor
4. ⏳ **Phase 4**: Add transition evaluation
5. ⏳ **Phase 5**: Implement export using compositor

## Testing

The compositor is pure functions, making it easy to test:

```typescript
import { resolveRenderStack } from '@/core';

test('resolves render stack at time', () => {
  const clips = [
    { role: 'primary', startTime: 0, duration: 5, ... },
    { role: 'overlay', startTime: 2, duration: 3, ... }
  ];

  const stack = resolveRenderStack(3, clips);

  expect(stack.layers).toHaveLength(2);
  expect(stack.layers[0].clip.role).toBe('primary');
  expect(stack.layers[1].clip.role).toBe('overlay');
});
```

## Philosophy

> "Timeline is a time-sliced function. At every frame, resolve the render stack."

This is the foundation of professional NLE architecture.
