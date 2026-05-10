# Architecture Assessment: Existing vs New Compositor

## Critical Discovery: You Already Have a Sophisticated Render Engine

After investigating the codebase, I found that **you already have a professional-grade rendering architecture** that I didn't integrate with properly.

### What Already Exists (Extremely Sophisticated)

#### 1. **Deterministic Media Render Engine** (`src/lib/renderEngine/`)

You have a **complete tier-based rendering system**:

**Spatial Resolution Tiers (SRP)**:

- L0: 80×45 (widest zoom-out)
- L1: 120×67
- L2: 160×90
- L3: 240×135 (closest zoom-in)

**Temporal Sampling Tiers (TSP)**:

- L0: 2-4s intervals
- L1: 1s intervals
- L2: 0.5s intervals
- L3: 0.25s intervals

**Key Components**:

- `renderRuntime.ts` - Core rendering runtime
- `renderScheduler.ts` - Job scheduling with priorities
- `epoch.ts` - Epoch-based invalidation (9 dimensions)
- `ism.ts` - Interaction State Machine (Idle/Zooming/Scrubbing/Scrolling/Converging)
- `srp.ts` - Spatial Resolution Policy
- `tsp.ts` - Temporal Sampling Policy
- `webglRasterSurface.ts` + `rasterSurface.ts` - Dual renderers (WebGL + Canvas2D)

**This is REAL media systems engineering**:

- Content-addressed frame caching (`FrameContentHash`)
- Epoch-based invalidation (prevents stale renders)
- Velocity-aware tier selection (`VelocityState`)
- Quality presets (Low/Medium/High/Ultra)
- Viewport windowing (visible ± 2 screen widths)
- Priority-based job scheduling
- Dual renderer support (WebGL + Canvas2D fallback)

#### 2. **Existing Preview Scene Resolution** (`src/lib/previewScene.ts`)

You already have `resolvePreviewScene()` that:

- Filters clips by time and visibility
- Sorts by track index (compositing order)
- Returns `PreviewLayer[]` (multi-layer!)
- Handles track visibility
- Converts file paths to Tauri URLs

**This is already a compositor!** It's just not formalized as such.

#### 3. **Time Utilities** (`src/lib/timelineClip.ts`)

Already integrated:

- `getClipEndTime()` - Consistent clip end calculation
- `getTimelineContentEnd()` - Total duration
- `getClipVisibleDuration()` - Visible duration
- `normalizeClipTiming()` - Timing normalization

### What I Added (Partially Redundant)

My new compositor (`src/core/compositor/`) adds:

**Good (Non-Redundant)**:

- ✅ Formalized `CompositorClip` with roles/priority
- ✅ Explicit compositing order rules (role → trackIndex → zIndex → priority)
- ✅ Timeline validation (diagnostic, non-blocking)
- ✅ Adapter layer for gradual migration
- ✅ Removed track protection constraints

**Redundant (Already Exists)**:

- ❌ `resolveRenderStack()` - Similar to `resolvePreviewScene()`
- ❌ `RenderLayer` type - Similar to `PreviewLayer`
- ❌ Time-based filtering - Already in `resolvePreviewScene()`

### The Real Problem: Integration Gap

The issue is **not missing architecture** — it's that:

1. **Preview scene resolution is separate from render engine**
   - `resolvePreviewScene()` returns layers
   - But render engine works with `RenderArtifact` and tiers
   - No clear bridge between them

2. **Compositor semantics not formalized**
   - Track-based sorting exists
   - But no explicit role/priority system
   - No transition evaluation hooks

3. **No evaluation contract**
   - What happens at time T is implicit
   - No documented compositing rules
   - No transition/effect evaluation points

## Recommended Integration Strategy

### Phase 1: Unify Compositor Concepts ✅ (Partially Done)

**Keep from my work**:

- `CompositorClip` type (adds roles/priority to existing `Clip`)
- Explicit compositing order rules
- Timeline validation (diagnostic)
- Adapter layer

**Integrate with existing**:

- Use `resolvePreviewScene()` as the base compositor
- Enhance it with role/priority semantics
- Keep render engine tier system intact

### Phase 2: Create Evaluation Contract (Next Critical Step)

Document the **deterministic evaluation spec** you mentioned:

```typescript
// src/core/evaluation/contract.ts

/**
 * Evaluation Contract: What happens at time T
 *
 * This is the single source of truth for:
 * - Preview rendering
 * - Export rendering
 * - Thumbnail generation
 * - Timeline validation
 */

interface EvaluationContract {
  // 1. Which clips are active?
  activeClips(time: number): CompositorClip[];

  // 2. In what order?
  compositingOrder(clips: CompositorClip[]): CompositorClip[];

  // 3. How are transitions evaluated?
  evaluateTransition(clip: CompositorClip, time: number): TransitionState;

  // 4. How are masks applied?
  evaluateMask(clip: CompositorClip, time: number): MaskState;

  // 5. What is visible?
  visibleRegion(clip: CompositorClip, time: number): Region;

  // 6. What is audio priority?
  audioPriority(clips: CompositorClip[], time: number): CompositorClip[];

  // 7. How are gaps handled?
  gapStrategy(time: number): FallbackStrategy;
}
```

### Phase 3: Bridge Compositor → Render Engine

Create the missing link:

```typescript
// src/core/evaluation/bridge.ts

/**
 * Bridge between compositor (what to render) and render engine (how to render)
 */

function compositorToRenderJobs(layers: PreviewLayer[], renderTier: RenderTier, epochId: RenderEpochId): RenderJob[] {
  // Convert compositor layers to render engine jobs
  // This is where compositor decisions become render requests
}
```

### Phase 4: Add Transition Evaluation Hooks

Enhance `resolvePreviewScene()` with transition support:

```typescript
interface PreviewLayer {
  // ... existing fields

  // NEW: Transition state
  transitionState?: {
    type: "fade" | "dissolve" | "wipe";
    progress: number; // 0-1
    blendMode: BlendMode;
  };

  // NEW: Effect state
  effectState?: {
    effects: Effect[];
    parameters: Record<string, any>;
  };
}
```

### Phase 5: Temporal Indexing (Performance)

Add interval tree for O(log n) clip lookup:

```typescript
// src/core/timeline/index.ts

class TemporalIndex {
  private tree: IntervalTree<CompositorClip>;

  // O(log n + k) where k = number of overlapping clips
  getClipsAt(time: number): CompositorClip[];

  // O(log n + k) where k = number of clips in range
  getClipsInRange(start: number, end: number): CompositorClip[];
}
```

## What NOT to Do

### ❌ Don't Replace Existing Render Engine

Your render engine is **extremely sophisticated**:

- Tier-based rendering
- Epoch invalidation
- Velocity-aware policies
- Content-addressed caching
- Priority scheduling

**This is professional-grade work.** Don't throw it away.

### ❌ Don't Duplicate Preview Scene Resolution

`resolvePreviewScene()` already does time-based layer resolution.

**Instead**: Enhance it with compositor semantics (roles, priorities, transitions).

### ❌ Don't Break Renderer Boundary

Keep sacred:

```
Compositor (what) → Render Engine (how)
```

Don't let GPU/WebGL logic leak into compositor decisions.

## Immediate Action Items

### 1. Document Evaluation Contract (Critical)

Create `src/core/evaluation/contract.md`:

```markdown
# Evaluation Contract

At time T, the system evaluates:

## 1. Active Clips

- Filter clips where startTime ≤ T < endTime
- Respect track visibility
- Apply trim ranges

## 2. Compositing Order

- Sort by: role → trackIndex → zIndex → priority
- Background renders first, effects render last

## 3. Transition Evaluation

- Detect transition regions (clip boundaries)
- Calculate transition progress (0-1)
- Apply blend mode

## 4. Mask Evaluation

- [To be defined]

## 5. Visible Region

- Apply crop/transform
- Calculate visible bounds

## 6. Audio Priority

- [To be defined]

## 7. Gap Handling

- Render black frame
- Or freeze previous frame
- Or show placeholder
```

### 2. Enhance resolvePreviewScene()

Add compositor semantics:

```typescript
// src/lib/previewScene.ts

export const resolvePreviewScene = ({ tracks, clips, assets, time }: ResolvePreviewSceneParams): PreviewScene => {
  // Convert to compositor clips (with roles)
  const compositorClips = toCompositorClips(clips, tracks);

  // Apply compositor ordering rules
  const orderedClips = sortByCompositingOrder(compositorClips);

  // Evaluate transitions
  const layersWithTransitions = orderedClips.map((clip) => evaluateClipAtTime(clip, time));

  // Return enhanced layers
  return { layers: layersWithTransitions };
};
```

### 3. Create Render Bridge

```typescript
// src/core/render/bridge.ts

/**
 * Bridge compositor decisions to render engine
 */
export function scheduleRenderJobs(scene: PreviewScene, renderTier: RenderTier, epochId: RenderEpochId): void {
  scene.layers.forEach((layer) => {
    const job: RenderJob = {
      jobId: generateJobId(),
      clipId: layer.clipId,
      contentHash: computeContentHash(layer),
      spatialTier: renderTier.spatialTier,
      timestamp: layer.sourceTime,
      priority: computePriority(layer),
      epochId,
      enqueuedAt: performance.now(),
    };

    renderScheduler.enqueue(job);
  });
}
```

## Conclusion

You have **two sophisticated systems** that need integration:

1. **Render Engine** (tier-based, epoch-validated, velocity-aware)
2. **Preview Scene** (time-based layer resolution)

My compositor work adds:

- Formalized compositing semantics (roles, priorities)
- Explicit ordering rules
- Timeline validation
- Track protection removal

**Next critical step**: Create the **Evaluation Contract** that bridges these systems.

This is the "deterministic evaluation spec" you mentioned — and it's the most important missing piece.

---

**Status**: Architecture is solid. Integration is the challenge.  
**Priority**: Document evaluation contract, then bridge compositor → render engine.  
**Risk**: Don't duplicate existing sophisticated systems.
