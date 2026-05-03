# Timeline Coordinate System - Single Source of Truth

## Overview

This document defines the **strict invariants** for the timeline coordinate system. Following these rules eliminates the "ghost gap" bug and ensures pixel-perfect scrolling behavior.

## Core Principle: One Scale, One Truth

**All time-to-pixel conversions MUST use the same formula:**

```typescript
const pixelPosition = Math.round(timeInSeconds * pixelsPerSecond);
```

**All pixel-to-time conversions MUST use the inverse:**

```typescript
const timeInSeconds = pixelPosition / pixelsPerSecond;
```

## Strict Invariants

### 1. DOM Truth Over Computed Values

❌ **NEVER** use computed widths:

```typescript
const contentWidth = duration * pixelsPerSecond; // ❌ This is a guess
```

✅ **ALWAYS** use DOM measurements:

```typescript
const viewportWidth = container.clientWidth;
const contentWidth = container.scrollWidth;
const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);
```

### 2. Pixel Rounding

All pixel positions MUST be rounded to avoid subpixel accumulation errors:

```typescript
// ✅ Correct
const playheadX = Math.round(currentTime * pixelsPerSecond);
const clipLeft = Math.round(clip.startTime * pixelsPerSecond);
const clipWidth = Math.round(clip.duration * pixelsPerSecond);

// ❌ Wrong
const playheadX = currentTime * pixelsPerSecond; // Subpixel drift
```

### 3. Hard Clamping

Scroll position MUST be clamped to valid range:

```typescript
// ✅ Correct
scrollX = Math.max(0, Math.min(scrollX, maxScrollLeft));

// ❌ Wrong
scrollX = Math.min(scrollX, maxScrollLeft); // Allows negative scroll
```

### 4. Epsilon Snapping

Eliminate the "almost there" gap by snapping to max scroll:

```typescript
const epsilon = 2; // px
if (maxScrollLeft - scrollX < epsilon) {
  scrollX = maxScrollLeft;
}
```

### 5. Visibility Invariant

The playhead MUST always be visible during playback:

```typescript
const rightEdge = scrollX + viewportWidth;
if (playheadX > rightEdge) {
  scrollX = Math.min(playheadX, maxScrollLeft);
}
```

## Implementation Checklist

### Components Using Coordinate System

All these components MUST use `Math.round(time * pixelsPerSecond)`:

- ✅ `Timeline.tsx` - Auto-scroll logic
- ✅ `Playhead.tsx` - Playhead position
- ✅ `Clip.tsx` - Clip positioning
- ✅ `TimelineRuler.tsx` - Tick marks
- ✅ `Track.tsx` - Track content (if applicable)

### CSS Requirements

```css
#timeline-tracks-container {
  box-sizing: border-box; /* Prevent padding/border from affecting measurements */
}
```

### No Transform Scales

❌ **NEVER** apply CSS transforms that affect coordinate space:

```css
/* ❌ This breaks coordinate mapping */
.timeline {
  transform: scale(1.5);
}
```

## Auto-Scroll Algorithm

The bulletproof auto-scroll implementation in `Timeline.tsx`:

```typescript
useEffect(() => {
  if (!isPlaying) return;

  const container = containerRef.current;
  if (!container) return;

  // 1. Use DOM truth
  const viewportWidth = container.clientWidth;
  const contentWidth = container.scrollWidth;
  const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);

  // 2. Derive playhead in pixel space
  const playheadX = Math.round(currentTime * pixelsPerSecond);

  // 3. Get current scroll
  let newScrollLeft = container.scrollLeft;

  // 4. Jump logic (90% buffer)
  const bufferPx = viewportWidth * 0.1;
  if (playheadX >= newScrollLeft + viewportWidth - bufferPx) {
    newScrollLeft = playheadX;
  }

  // 5. Hard clamp
  newScrollLeft = Math.max(0, Math.min(newScrollLeft, maxScrollLeft));

  // 6. Snap to end (eliminate ghost gap)
  const epsilon = 2;
  if (maxScrollLeft - newScrollLeft < epsilon) {
    newScrollLeft = maxScrollLeft;
  }

  // 7. Enforce visibility
  if (playheadX > newScrollLeft + viewportWidth) {
    newScrollLeft = Math.min(playheadX, maxScrollLeft);
  }

  // 8. Apply if changed
  if (Math.abs(container.scrollLeft - newScrollLeft) > 0.5) {
    container.scrollLeft = newScrollLeft;
    setScrollLeft(newScrollLeft);
  }
}, [currentTime, pixelsPerSecond, isPlaying]);
```

## Debugging

To diagnose coordinate system issues, uncomment the debug logging in `Timeline.tsx`:

```typescript
if (currentTime > duration - 2) {
  console.log("[Timeline Scroll Debug]", {
    currentTime: currentTime.toFixed(2),
    playheadX,
    scrollLeft: container.scrollLeft,
    newScrollLeft,
    viewportWidth,
    contentWidthActual,
    contentWidthComputed: contentWidth,
    maxScrollLeft,
    gap: maxScrollLeft - newScrollLeft,
    pixelsPerSecond,
  });
}
```

### What to Look For

- **gap > 0**: Clamping failed
- **playheadX > scrollX + viewportWidth**: Visibility invariant broken
- **contentWidthActual ≠ contentWidthComputed**: Layout issue
- **Fractional pixels**: Rounding not applied

## Common Pitfalls

### ❌ Mixing Time and Pixels

```typescript
// ❌ Wrong - mixing domains
if (currentTime > scrollX + viewportWidth) { ... }

// ✅ Correct - stay in pixel space
const playheadX = Math.round(currentTime * pixelsPerSecond);
if (playheadX > scrollX + viewportWidth) { ... }
```

### ❌ Using Different Scales

```typescript
// ❌ Wrong - inconsistent scale
const playheadX = currentTime * 100; // Hardcoded
const clipX = clip.startTime * pixelsPerSecond; // From store

// ✅ Correct - same scale everywhere
const playheadX = Math.round(currentTime * pixelsPerSecond);
const clipX = Math.round(clip.startTime * pixelsPerSecond);
```

### ❌ Trusting Computed Values

```typescript
// ❌ Wrong - computed width might not match DOM
const maxScroll = duration * pixelsPerSecond - viewportWidth;

// ✅ Correct - use actual DOM width
const maxScroll = container.scrollWidth - container.clientWidth;
```

## Testing

To verify the fix works:

1. Create a timeline with clips extending past 30 seconds
2. Play from the beginning
3. Let playback reach the end
4. **Expected**: Playhead reaches the absolute right edge with NO gap
5. **Expected**: Scroll position equals `maxScrollLeft` exactly

## Maintenance

When adding new timeline features:

1. ✅ Use `Math.round(time * pixelsPerSecond)` for ALL positions
2. ✅ Use `container.scrollWidth` for content width
3. ✅ Apply hard clamping to scroll positions
4. ✅ Test at different zoom levels
5. ✅ Test with long timelines (60+ seconds)

## References

- `src/components/editor/timeline/Timeline.tsx` - Main auto-scroll logic
- `src/components/editor/timeline/Playhead.tsx` - Playhead positioning
- `src/components/editor/timeline/Clip.tsx` - Clip positioning
- `src/store/timelineStore.ts` - `pixelsPerSecond` source of truth
