# Timeline Scrolling Fix - Verification Guide

## What Was Fixed

The "ghost gap" bug where the playhead would stop 5-10px before reaching the right edge of the timeline during playback.

## Root Causes Eliminated

1. ❌ **Inconsistent coordinate mapping** → ✅ Single `pixelsPerSecond` scale everywhere
2. ❌ **Computed widths** → ✅ DOM truth (`scrollWidth`, `clientWidth`)
3. ❌ **Weak clamping** → ✅ Hard clamps with epsilon snapping
4. ❌ **Subpixel drift** → ✅ `Math.round()` on all pixel positions
5. ❌ **No visibility guarantee** → ✅ Strict visibility invariant enforced

## How to Verify the Fix

### Test Case 1: Basic Playback to End

1. Open the application
2. Import a video clip (or multiple clips)
3. Ensure the timeline extends past the viewport (zoom out if needed)
4. Click Play from the beginning
5. Let playback run until the end

**Expected Result:**

- ✅ Playhead reaches the absolute right edge with NO gap
- ✅ Scroll position equals maximum scroll exactly
- ✅ No "almost there but not quite" behavior

### Test Case 2: Different Zoom Levels

1. Create a timeline with clips
2. Test at zoom level 0.5x (zoomed out)
3. Test at zoom level 1.0x (default)
4. Test at zoom level 2.0x (zoomed in)
5. Test at zoom level 5.0x (maximum zoom)

**Expected Result:**

- ✅ Playhead reaches the edge at ALL zoom levels
- ✅ No coordinate system breakdown at extreme zooms

### Test Case 3: Long Timeline

1. Create a timeline with clips extending to 60+ seconds
2. Play from the beginning
3. Observe scrolling behavior throughout

**Expected Result:**

- ✅ Smooth viewport jumps when playhead reaches 90% of viewport
- ✅ Playhead always visible
- ✅ Final scroll position reaches maximum exactly

### Test Case 4: Manual Seek Near End

1. Create a timeline
2. Manually drag the playhead to near the end
3. Click Play
4. Let it play to the end

**Expected Result:**

- ✅ Playhead reaches the edge regardless of starting position
- ✅ Scroll adjusts correctly

## Debug Mode

If you encounter issues, enable debug logging in `Timeline.tsx`:

```typescript
// Uncomment these lines around line 95:
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

### What to Look For in Debug Output

**If gap > 0:**

- Clamping logic failed
- Check if `maxScrollLeft` calculation is correct

**If playheadX > scrollX + viewportWidth:**

- Visibility invariant broken
- Check if visibility enforcement is running

**If contentWidthActual ≠ contentWidthComputed:**

- Layout issue (padding, border, transform)
- Check CSS box-sizing rules

**If you see fractional pixels:**

- Rounding not applied somewhere
- Check all components use `Math.round()`

## Changes Made

### Files Modified

1. **src/components/editor/timeline/Timeline.tsx**
   - Rewrote auto-scroll logic with strict invariants
   - Uses DOM truth (`scrollWidth`, `clientWidth`)
   - Hard clamping with epsilon snapping
   - Visibility invariant enforcement
   - Added debug logging (commented out)

2. **src/components/editor/timeline/Playhead.tsx**
   - Added `Math.round()` to position calculation
   - Ensures consistent pixel mapping

3. **src/components/editor/timeline/Clip.tsx**
   - Added `Math.round()` to left/width calculations
   - Prevents subpixel drift in clip positioning

4. **src/components/editor/timeline/TimelineRuler.tsx**
   - Added `Math.round()` to tick mark positions
   - Ensures ruler aligns with playhead/clips

5. **src/index.css**
   - Added `box-sizing: border-box` for timeline container
   - Prevents padding/border from affecting measurements

### New Files

1. **TIMELINE_COORDINATE_SYSTEM.md**
   - Comprehensive documentation of coordinate system
   - Strict invariants and rules
   - Implementation checklist
   - Common pitfalls and debugging guide

## Technical Details

### The Bulletproof Algorithm

```typescript
// 1. Use DOM truth
const viewportWidth = container.clientWidth;
const contentWidth = container.scrollWidth;
const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);

// 2. Derive playhead in pixel space
const playheadX = Math.round(currentTime * pixelsPerSecond);

// 3. Jump logic (90% buffer)
if (playheadX >= scrollX + viewportWidth - bufferPx) {
  scrollX = playheadX;
}

// 4. Hard clamp
scrollX = Math.max(0, Math.min(scrollX, maxScrollLeft));

// 5. Snap to end (eliminate ghost gap)
if (maxScrollLeft - scrollX < 2) {
  scrollX = maxScrollLeft;
}

// 6. Enforce visibility
if (playheadX > scrollX + viewportWidth) {
  scrollX = Math.min(playheadX, maxScrollLeft);
}
```

### Key Invariants

1. **Single Scale**: All components use `Math.round(time * pixelsPerSecond)`
2. **DOM Truth**: Use `scrollWidth` not computed widths
3. **Hard Clamps**: `Math.max(0, Math.min(scroll, max))`
4. **Epsilon Snap**: Close gap when within 2px
5. **Visibility**: Playhead always visible during playback

## Rollback Instructions

If you need to revert this fix:

```bash
git revert f76e772
```

This will undo all changes while preserving the commit history.

## Next Steps

1. ✅ Test the fix with the verification steps above
2. ✅ Enable debug logging if issues persist
3. ✅ Check console for coordinate system diagnostics
4. ✅ Report any edge cases not covered by this fix

## Success Criteria

The fix is successful when:

- ✅ Playhead reaches the absolute right edge (0px gap)
- ✅ Works at all zoom levels (0.5x to 5.0x)
- ✅ Works with timelines of any length
- ✅ No visual glitches or jumps
- ✅ All 63 timeline tests pass

## Questions?

Refer to `TIMELINE_COORDINATE_SYSTEM.md` for detailed technical documentation.
