# Evaluation Contract: Deterministic Timeline Behavior

**Version**: 1.0  
**Status**: Draft  
**Purpose**: Single source of truth for what happens at any time T

---

## Overview

This contract defines **exactly** what the system evaluates at any timeline time T. It is the foundation for:

- Preview rendering
- Export rendering
- Thumbnail generation
- Timeline validation
- Playback behavior
- Audio mixing

**All rendering paths MUST follow this contract.**

---

## 1. Active Clip Resolution

### Question: Which clips are active at time T?

### Algorithm:

```typescript
function getActiveClips(time: T, clips: Clip[], tracks: Track[]): Clip[] {
  return clips.filter((clip) => {
    // 1. Time bounds check
    const clipEnd = clip.startTime + (clip.trimOut - clip.trimIn);
    const isInTimeBounds = clip.startTime <= T && T < clipEnd;

    // 2. Track visibility check
    const track = tracks.find((t) => t.id === clip.trackId);
    const isVisible = track?.visible ?? true;

    // 3. Track lock does NOT affect visibility (only editing)

    return isInTimeBounds && isVisible;
  });
}
```

### Rules:

- **R1.1**: Clip is active if `startTime ≤ T < endTime`
- **R1.2**: End time is exclusive (last frame at `endTime - ε`)
- **R1.3**: Track visibility affects rendering (invisible tracks don't render)
- **R1.4**: Track lock affects editing only, NOT rendering
- **R1.5**: Track mute affects audio only, NOT video visibility
- **R1.6**: Trim range affects visible duration: `duration = trimOut - trimIn`

### Edge Cases:

- **Empty timeline**: Returns `[]`, renders fallback (see §7)
- **Overlapping clips**: All active clips returned, sorted by compositing order (see §2)
- **Zero-duration clips**: Never active (duration must be > 0)
- **Clips beyond media duration**: Clamped to media bounds during normalization

---

## 2. Compositing Order

### Question: In what order do active clips composite?

### Algorithm:

```typescript
function sortByCompositingOrder(clips: CompositorClip[]): CompositorClip[] {
  return clips.sort((a, b) => {
    // 1. Role type (background → primary → overlay → text → effect)
    const roleOrder = getRoleOrder(a.role) - getRoleOrder(b.role);
    if (roleOrder !== 0) return roleOrder;

    // 2. Track index (lower tracks render below higher tracks)
    const trackOrder = a.trackIndex - b.trackIndex;
    if (trackOrder !== 0) return trackOrder;

    // 3. Z-index (explicit layer control)
    const zOrder = a.zIndex - b.zIndex;
    if (zOrder !== 0) return zOrder;

    // 4. Evaluation priority (tie-breaker)
    return a.evaluationPriority - b.evaluationPriority;
  });
}

function getRoleOrder(role: ClipRole): number {
  return (
    {
      background: 0,
      primary: 1,
      overlay: 2,
      text: 3,
      effect: 4,
      audio: -1, // Audio doesn't participate in visual compositing
    }[role] ?? 1
  );
}
```

### Rules:

- **R2.1**: Lower values render first (background), higher values render last (foreground)
- **R2.2**: Role type is primary sort key (semantic meaning)
- **R2.3**: Track index is secondary sort key (editorial organization)
- **R2.4**: Z-index is tertiary sort key (explicit control)
- **R2.5**: Evaluation priority is final tie-breaker (deterministic)
- **R2.6**: Audio clips don't participate in visual compositing order

### Compositing Stack Example:

```
Time T = 5.0s:

Layer 4: [Text] "Title" (role=text, track=3, z=0)
Layer 3: [Overlay] B-roll (role=overlay, track=2, z=0)
Layer 2: [Primary] Main footage (role=primary, track=1, z=0)
Layer 1: [Background] Solid color (role=background, track=0, z=0)

Render order: Background → Primary → Overlay → Text
```

---

## 3. Transition Evaluation

### Question: How are transitions evaluated at time T?

### Status: **Phase 2 - Not Yet Implemented**

### Planned Algorithm:

```typescript
interface TransitionState {
  type: "none" | "fade" | "dissolve" | "wipe" | "custom";
  progress: number; // 0.0 to 1.0
  blendMode: BlendMode;
  affectedClips: [CompositorClip, CompositorClip]; // [outgoing, incoming]
}

function evaluateTransition(clip: CompositorClip, time: T): TransitionState {
  // 1. Detect if clip is in transition region
  const transitionDuration = 0.5; // seconds (configurable)
  const clipEnd = clip.startTime + clip.duration;

  // Fade out at end
  if (time > clipEnd - transitionDuration && time <= clipEnd) {
    const progress = (time - (clipEnd - transitionDuration)) / transitionDuration;
    return {
      type: "fade",
      progress,
      blendMode: "normal",
      affectedClips: [clip, nextClip],
    };
  }

  // Fade in at start
  if (time >= clip.startTime && time < clip.startTime + transitionDuration) {
    const progress = (time - clip.startTime) / transitionDuration;
    return {
      type: "fade",
      progress,
      blendMode: "normal",
      affectedClips: [prevClip, clip],
    };
  }

  return { type: "none", progress: 1.0, blendMode: "normal", affectedClips: [clip, clip] };
}
```

### Planned Rules:

- **R3.1**: Transitions occur at clip boundaries (start/end)
- **R3.2**: Default transition duration: 0.5s (configurable per clip)
- **R3.3**: Transition progress is linear 0.0 → 1.0 (easing applied in renderer)
- **R3.4**: Overlapping transitions: later transition takes precedence
- **R3.5**: Transitions affect opacity, not geometry (transforms are separate)

---

## 4. Mask Evaluation

### Question: How are masks applied at time T?

### Status: **Phase 3 - Not Yet Implemented**

### Planned Concepts:

- Rectangular crop masks
- Shape masks (circle, polygon)
- Animated masks (keyframed)
- Feathered edges
- Mask inversion

---

## 5. Visible Region

### Question: What region of the clip is visible at time T?

### Algorithm:

```typescript
interface VisibleRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
}

function getVisibleRegion(clip: CompositorClip, time: T): VisibleRegion {
  // 1. Base transform from clip properties
  const base = {
    x: clip.x,
    y: clip.y,
    width: clip.width,
    height: clip.height,
    opacity: clip.opacity,
    rotation: clip.rotation,
  };

  // 2. Apply transition opacity (if in transition)
  const transition = evaluateTransition(clip, time);
  const opacity = base.opacity * transition.progress;

  // 3. Apply keyframe transforms (Phase 3)
  // const keyframed = applyKeyframes(base, clip.keyframes, time);

  // 4. Apply masks (Phase 3)
  // const masked = applyMasks(keyframed, clip.masks, time);

  return { ...base, opacity };
}
```

### Rules:

- **R5.1**: Base transform comes from clip properties (x, y, width, height, rotation)
- **R5.2**: Opacity is multiplicative (clip.opacity × transition.progress)
- **R5.3**: Rotation is in degrees, clockwise
- **R5.4**: Coordinates are canvas-relative (0,0 = top-left)
- **R5.5**: Transforms apply in order: scale → rotate → translate

---

## 6. Audio Priority

### Question: Which audio clips play at time T?

### Algorithm:

```typescript
function getActiveAudio(time: T, clips: CompositorClip[], tracks: Track[]): CompositorClip[] {
  return clips
    .filter((clip) => {
      // 1. Time bounds check
      const clipEnd = clip.startTime + clip.duration;
      const isInTimeBounds = clip.startTime <= T && T < clipEnd;

      // 2. Track mute check
      const track = tracks.find((t) => t.id === clip.trackId);
      const isMuted = track?.muted ?? false;

      // 3. Audio role check
      const hasAudio = clip.role === "audio" || (clip.role === "primary" && hasAudioTrack(clip));

      return isInTimeBounds && !isMuted && hasAudio;
    })
    .sort((a, b) => {
      // Audio priority: higher tracks have priority
      return b.trackIndex - a.trackIndex;
    });
}
```

### Rules:

- **R6.1**: Track mute affects audio rendering (muted tracks don't play)
- **R6.2**: Multiple audio clips can play simultaneously (mixed)
- **R6.3**: Audio priority: higher tracks have priority (for ducking/mixing)
- **R6.4**: Audio clips respect trim ranges (same as video)
- **R6.5**: Audio continues during video gaps (audio-only sections valid)

---

## 7. Gap Handling

### Question: What happens when no clips are active at time T?

### Algorithm:

```typescript
type FallbackStrategy = "black" | "freeze" | "transparent" | "placeholder";

function handleGap(time: T, strategy: FallbackStrategy, previousFrame?: Frame): Frame {
  switch (strategy) {
    case "black":
      return renderBlackFrame();

    case "freeze":
      return previousFrame ?? renderBlackFrame();

    case "transparent":
      return renderTransparentFrame();

    case "placeholder":
      return renderPlaceholder(`No content at ${time.toFixed(2)}s`);
  }
}
```

### Rules:

- **R7.1**: Gaps are valid timeline states (not errors)
- **R7.2**: Default strategy: `black` (render black frame)
- **R7.3**: Preview can use `placeholder` (show "no content" message)
- **R7.4**: Export should use `black` or `freeze` (no UI elements)
- **R7.5**: Gaps don't affect audio (audio can play during video gaps)

### Fallback Strategies:

| Strategy      | Use Case        | Behavior              |
| ------------- | --------------- | --------------------- |
| `black`       | Export, default | Solid black frame     |
| `freeze`      | Smooth playback | Hold last valid frame |
| `transparent` | Compositing     | Alpha = 0             |
| `placeholder` | Preview only    | Show "no content" UI  |

---

## 8. Speed Ramps (Future)

### Status: **Phase 4 - Not Yet Implemented**

### Planned Concepts:

- Variable playback speed
- Time remapping
- Reverse playback
- Speed curves (ease in/out)

---

## 9. Effects Graph (Future)

### Status: **Phase 5 - Not Yet Implemented**

### Planned Concepts:

- Per-clip effects stack
- Effect parameters
- Effect keyframes
- GPU-accelerated effects

---

## Testing Contract

Every implementation MUST pass these tests:

### Test 1: Single Clip

```
Timeline: [Clip A: 0-5s]
Query: T = 2.5s
Expected: [Clip A] with opacity=1.0
```

### Test 2: Overlapping Clips

```
Timeline:
  Track 0: [Clip A: 0-5s] (role=primary)
  Track 1: [Clip B: 2-7s] (role=overlay)
Query: T = 3.0s
Expected: [Clip A, Clip B] in that order
```

### Test 3: Gap

```
Timeline: [Clip A: 0-2s], [Clip B: 5-7s]
Query: T = 3.5s
Expected: [] (gap, render fallback)
```

### Test 4: Track Visibility

```
Timeline:
  Track 0 (visible): [Clip A: 0-5s]
  Track 1 (hidden): [Clip B: 0-5s]
Query: T = 2.5s
Expected: [Clip A] only
```

### Test 5: Compositing Order

```
Timeline:
  Track 0: [Clip A: 0-5s] (role=background)
  Track 1: [Clip B: 0-5s] (role=primary)
  Track 2: [Clip C: 0-5s] (role=overlay)
Query: T = 2.5s
Expected: [Clip A, Clip B, Clip C] in that order
```

---

## Implementation Checklist

- [x] §1: Active Clip Resolution (implemented in `resolvePreviewScene`)
- [x] §2: Compositing Order (implemented in compositor)
- [ ] §3: Transition Evaluation (planned)
- [ ] §4: Mask Evaluation (planned)
- [x] §5: Visible Region (basic implementation)
- [ ] §6: Audio Priority (partial implementation)
- [x] §7: Gap Handling (implemented in fallback.ts)
- [ ] §8: Speed Ramps (planned)
- [ ] §9: Effects Graph (planned)

---

## Revision History

| Version | Date       | Changes                     |
| ------- | ---------- | --------------------------- |
| 1.0     | 2025-01-10 | Initial contract definition |

---

**This contract is the law.** All rendering paths must follow it exactly.
