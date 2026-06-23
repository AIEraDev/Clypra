# FINDING-012: Split Command Architecture Investigation

## Executive Summary

**Finding:** SplitClipCommand reuses original clipId for left split, causing wrong clip properties binding  
**Impact:** Volume/effects applied to wrong clip after split  
**Classification:** LIFECYCLE_BUG  
**Priority:** Medium  
**Fix Effort:** Medium-High (requires command architecture changes)

---

## Problem Statement

### Current Behavior

When `SplitClipCommand` executes:

1. **Left split**: Reuses original `clipId` (mutation of existing clip)
2. **Right split**: Gets new `clipId` via `generateId("clip")`

```typescript
// SplitClipCommand.ts:86-93
return {
  ...state,
  clips: [
    ...state.clips.map((c) => {
      if (c.id === this.clipId) {
        // ❌ LEFT: Mutates original clip, keeps original ID
        return { ...c, duration: leftDuration, trimOut: leftTrimOut };
      }
      return c;
    }),
    newClip, // ✅ RIGHT: New clip with new ID
  ],
  epoch: state.epoch + 1,
};
```

### The Bug

**Scenario:**

1. User has clip "clip-A" with volume=0.5
2. User splits clip at 5s
   - Left becomes "clip-A" (0-5s) with volume=0.5
   - Right becomes "clip-B" (5-10s) with volume=0.5 (inherited)
3. User adjusts right clip's volume to 1.0
4. **BUG**: Left clip's volume also changes to 1.0

**Root Cause:**

In PreviewMediaPool, the `timelineClipRegistry` maps:

- `clipId → cacheKey` (where cacheKey includes mediaId, sourcePath, trimIn)

After split:

- Left: `"clip-A" → "media-1-/path-trim0.000"`
- Right: `"clip-B" → "media-1-/path-trim5.000"`

However, Clip properties (volume, effects, overlays) are stored directly on the Clip object:

```typescript
interface Clip {
  id: string;
  volume?: number;
  effects?: ClipEffect[];
  overlays?: ClipOverlay[];
  // ... other properties
}
```

When properties are updated by clipId reference, external systems (like UI components or effect processors) may:

1. Look up clip by original clipId
2. Update properties thinking it's the "original" clip
3. But left split IS the original clip (same ID)
4. Right split is the "new" clip (different ID)

This creates semantic confusion:

- **User expectation**: Both splits are "new" clips, independent of each other
- **System reality**: Left split is the "original" with its historical baggage

---

## Impact Analysis

### User-Facing Issues

1. **Property Confusion**
   - Volume adjustments affect wrong clip
   - Effects applied to wrong clip
   - Overlays positioned on wrong clip
   - User confusion: "I changed the right clip but left changed"

2. **Undo/Redo Corruption**
   - Effect history bound to wrong clip
   - Undo may revert wrong clip's properties
   - Redo may apply to wrong clip

3. **Selection State Issues**
   - If original clip was selected, left split remains selected
   - Right split requires new selection
   - Inconsistent with user expectation (both are "new")

### System-Level Issues

1. **PreviewMediaPool Registry**
   - `timelineClipRegistry.get(originalClipId)` always returns left split's cache key
   - External lookups by clipId may get wrong element
   - Effects processing may target wrong video element

2. **Command History**
   - Commands executed before split reference originalClipId
   - After split, those commands affect left split
   - Creates temporal coupling between pre-split and post-split state

3. **Serialization/Deserialization**
   - Saved projects reference originalClipId
   - On load, originalClipId maps to left split
   - Right split treated as "added later" even though both are split results

---

## Current Architecture Analysis

### SplitClipCommand Structure

```typescript
export class SplitClipCommand implements Command {
  private newClipId: string | null = null; // Only right split gets new ID

  constructor(
    private readonly clipId: string, // Original clip ID
    private readonly splitTime: number,
    private readonly frameRate: number,
    private readonly originalClip: Clip, // Full original clip state
  ) {}

  apply(state: TimelineState): TimelineState {
    // Left: Mutate original clip
    // Right: Create new clip with new ID
  }

  invert(): Command {
    return new MergeSplitClipsCommand(
      this.clipId, // Left keeps original ID
      this.newClipId!, // Right has new ID
      this.originalClip,
    );
  }
}
```

### MergeSplitClipsCommand Structure

```typescript
class MergeSplitClipsCommand implements Command {
  constructor(
    private readonly leftClipId: string, // Original ID
    private readonly rightClipId: string, // New ID
    private readonly originalClip: Clip, // Restore state
  ) {}

  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      clips: state.clips
        .filter((c) => c.id !== this.rightClipId) // Remove right
        .map((c) => {
          if (c.id === this.leftClipId) {
            return this.originalClip; // Restore original
          }
          return c;
        }),
    };
  }
}
```

**Key Observation:** The invert() creates a proper inverse - merge removes right clip and restores original. This is correct for undo/redo semantics.

---

## Proposed Solutions

### Option 1: Generate New IDs for BOTH Splits (Recommended)

**Description:** Modify SplitClipCommand to generate two new IDs - one for left, one for right.

**Changes Required:**

1. **SplitClipCommand.ts**

```typescript
export class SplitClipCommand implements Command {
  private leftClipId: string | null = null; // NEW
  private rightClipId: string | null = null; // RENAMED from newClipId

  apply(state: TimelineState): TimelineState {
    // Generate IDs if not already done
    if (!this.leftClipId) {
      this.leftClipId = generateId("clip");
    }
    if (!this.rightClipId) {
      this.rightClipId = generateId("clip");
    }

    const leftClip: Clip = {
      ...clip,
      id: this.leftClipId, // NEW ID
      duration: leftDuration,
      trimOut: leftTrimOut,
    };

    const rightClip: Clip = {
      ...clip,
      id: this.rightClipId, // NEW ID
      startTime: snappedSplitTime,
      duration: rightDuration,
      trimIn: rightTrimIn,
      trimOut: clip.trimOut,
    };

    return {
      ...state,
      clips: [
        ...state.clips.filter((c) => c.id !== this.clipId), // REMOVE ORIGINAL
        leftClip, // ADD LEFT
        rightClip, // ADD RIGHT
      ],
      epoch: state.epoch + 1,
    };
  }

  getLeftClipId(): string | null {
    // NEW
    return this.leftClipId;
  }

  getRightClipId(): string | null {
    // RENAMED
    return this.rightClipId;
  }
}
```

2. **MergeSplitClipsCommand.ts**

```typescript
class MergeSplitClipsCommand implements Command {
  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      clips: state.clips
        .filter((c) => c.id !== this.leftClipId && c.id !== this.rightClipId) // REMOVE BOTH
        .concat([this.originalClip]), // RESTORE ORIGINAL
      epoch: state.epoch + 1,
    };
  }
}
```

3. **Update all callers**
   - `EditingActions.ts`: Update to handle both new IDs
   - UI components: Update selection logic to select both splits
   - Timeline store: Update clip tracking logic

**Pros:**

- ✅ Clean semantics: Both splits are truly "new" clips
- ✅ No property confusion: Each split has independent identity
- ✅ Consistent with user mental model
- ✅ Fixes PreviewMediaPool registry issues
- ✅ Proper command isolation

**Cons:**

- ❌ Breaking change for existing projects (clipId references change)
- ❌ Requires migration for saved projects
- ❌ Affects all clipId references in codebase
- ❌ Selection state needs updating (select both?)
- ❌ Command history may break for old undo/redo stacks

---

### Option 2: Add Split Lineage Tracking (Alternative)

**Description:** Keep current ID scheme but add metadata to track split relationships.

**Changes Required:**

1. **Add to Clip interface**

```typescript
export interface Clip {
  // ... existing fields

  // Split lineage tracking
  splitFrom?: {
    originalClipId: string;
    side: "left" | "right";
    splitTime: number;
    splitTimestamp: number;
  };
}
```

2. **Update SplitClipCommand**

```typescript
apply(state: TimelineState): TimelineState {
  const leftClip = {
    ...clip,
    duration: leftDuration,
    trimOut: leftTrimOut,
    splitFrom: {
      originalClipId: this.clipId,
      side: "left" as const,
      splitTime: snappedSplitTime,
      splitTimestamp: this.timestamp,
    },
  };

  const rightClip = {
    ...clip,
    id: this.newClipId,
    startTime: snappedSplitTime,
    duration: rightDuration,
    trimIn: rightTrimIn,
    trimOut: clip.trimOut,
    splitFrom: {
      originalClipId: this.clipId,
      side: "right" as const,
      splitTime: snappedSplitTime,
      splitTimestamp: this.timestamp,
    },
  };
}
```

3. **Update property lookups**
   - Check `splitFrom` metadata before applying properties
   - Use side information to determine correct target
   - Add UI indicators for split clips

**Pros:**

- ✅ Non-breaking change (backward compatible)
- ✅ Preserves existing clipId scheme
- ✅ Provides audit trail of splits
- ✅ Can build UI features on top (show split history)

**Cons:**

- ❌ Doesn't fix fundamental issue (left still has original ID)
- ❌ Adds complexity to every property lookup
- ❌ Metadata must be preserved across command history
- ❌ Doesn't address PreviewMediaPool registry confusion
- ❌ Band-aid solution, not architectural fix

---

### Option 3: Clip Property Indirection (Not Recommended)

**Description:** Move volume/effects to separate registry keyed by (clipId, timestamp).

**Why Not:**

- Over-engineered solution for a simple ID problem
- Adds complexity throughout entire codebase
- Performance overhead on every property access
- Breaks intuitive Clip object model

---

## Recommended Approach: Option 1 (Generate New IDs)

### Implementation Plan

#### Phase 1: Core Command Changes (1-2 days)

1. **Modify SplitClipCommand**
   - Add `leftClipId` field
   - Generate both IDs in `apply()`
   - Update `toJSON()` / `fromJSON()`
   - Add `getLeftClipId()` method

2. **Update MergeSplitClipsCommand**
   - Accept both clipIds in constructor
   - Filter both clips in `apply()`
   - Update `toJSON()` / `fromJSON()`

3. **Update command tests**
   - Verify both splits get new IDs
   - Test undo/redo with new ID scheme
   - Test serialization/deserialization

#### Phase 2: Caller Updates (1 day)

1. **EditingActions.ts**

```typescript
// Before
const command = new SplitClipCommand(clipId, time, frameRate, clip);
execute(command);
const newClipId = command.getCreatedClipId();

// After
const command = new SplitClipCommand(clipId, time, frameRate, clip);
execute(command);
const leftClipId = command.getLeftClipId();
const rightClipId = command.getRightClipId();

// Update selection to include both clips
setSelectedClipIds([leftClipId, rightClipId]);
```

2. **Timeline UI components**
   - Update split handling to track both new IDs
   - Update selection state to select both clips after split
   - Update any clipId-based lookups

#### Phase 3: Migration Strategy (1-2 days)

1. **Version detection**

```typescript
// In project loader
function migrateSplitClips(project: Project): Project {
  // Detect old projects (before this change)
  if (project.version < "2.0.0") {
    // Add migration flag
    return {
      ...project,
      _requiresSplitMigration: true,
    };
  }
  return project;
}
```

2. **Runtime detection**

```typescript
// In SplitClipCommand.fromJSON()
static fromJSON(data: Record<string, any>): SplitClipCommand {
  const cmd = new SplitClipCommand(...);

  // Old format: only newClipId exists
  if (data.newClipId && !data.leftClipId && !data.rightClipId) {
    // Treat as old format - left keeps original ID
    cmd.leftClipId = data.clipId;  // Original ID
    cmd.rightClipId = data.newClipId;  // New ID
  } else {
    // New format: both IDs exist
    cmd.leftClipId = data.leftClipId;
    cmd.rightClipId = data.rightClipId;
  }

  return cmd;
}
```

3. **User notification**
   - Show migration warning for old projects
   - Option to auto-migrate or keep old behavior
   - Document breaking change in release notes

#### Phase 4: Testing (2-3 days)

1. **Unit tests**
   - ✅ Both splits get new IDs
   - ✅ Original clip is removed
   - ✅ Undo restores original clip
   - ✅ Redo re-creates both splits with same IDs
   - ✅ Serialization preserves IDs
   - ✅ Multiple splits in sequence work correctly

2. **Integration tests**
   - ✅ Split during playback (no black frames)
   - ✅ Volume adjustment after split affects correct clip
   - ✅ Effects applied after split affect correct clip
   - ✅ Selection state updates correctly
   - ✅ Undo/redo works across multiple splits

3. **Migration tests**
   - ✅ Old projects load correctly
   - ✅ Old command history replays correctly
   - ✅ Mixed old/new commands in same project

---

## Risk Analysis

### High Risks

1. **Breaking Change for Existing Projects**
   - **Mitigation:** Version-based migration with backward compatibility
   - **Detection:** Check project version and command format
   - **Rollback:** Keep old behavior for legacy projects

2. **Command History Corruption**
   - **Mitigation:** Extensive undo/redo testing
   - **Detection:** Monitor error rates on command replay
   - **Rollback:** Fail gracefully and warn user

3. **Selection State Confusion**
   - **Mitigation:** Auto-select both clips after split
   - **Detection:** User testing and feedback
   - **Rollback:** Document new behavior clearly

### Medium Risks

1. **Performance Impact**
   - **Mitigation:** ID generation is O(1), no performance change
   - **Detection:** Benchmark split operations
   - **Rollback:** N/A (no performance risk)

2. **PreviewMediaPool Integration**
   - **Mitigation:** Registry uses cacheKey, not clipId (unaffected)
   - **Detection:** Test media playback after splits
   - **Rollback:** Existing registry logic continues to work

### Low Risks

1. **UI Rendering Glitches**
   - **Mitigation:** Epoch increment triggers re-render
   - **Detection:** Visual inspection during testing
   - **Rollback:** Standard React re-render logic applies

---

## Alternative: Targeted Fix (If Full Refactor Not Feasible)

If Option 1 is deemed too risky, consider this minimal fix:

### Minimal Fix: Clear Property References on Split

**Changes:**

1. When split executes, explicitly clear effects/overlays/volume from left clip
2. Force user to re-apply properties to desired clip
3. Add UI warning: "Split clip properties cleared - reapply as needed"

**Implementation:**

```typescript
// In SplitClipCommand.apply()
const leftClip = {
  ...clip,
  duration: leftDuration,
  trimOut: leftTrimOut,
  // Clear potentially confusing properties
  effects: undefined,
  overlays: undefined,
  volume: 1.0, // Reset to default
};
```

**Pros:**

- ✅ Minimal code change
- ✅ No migration needed
- ✅ Prevents wrong property application

**Cons:**

- ❌ Destroys user's work (properties lost)
- ❌ Poor UX (forced to reapply)
- ❌ Doesn't fix fundamental issue
- ❌ User frustration

**Verdict:** Not recommended - breaks user expectations worse than current bug.

---

## Recommendation

**Proceed with Option 1: Generate New IDs for Both Splits**

**Rationale:**

1. Clean architectural solution
2. Fixes root cause, not symptoms
3. Aligns with user mental model
4. Proper migration path available
5. Benefits outweigh risks

**Timeline:**

- Phase 1 (Core): 1-2 days
- Phase 2 (Callers): 1 day
- Phase 3 (Migration): 1-2 days
- Phase 4 (Testing): 2-3 days
- **Total:** 5-8 days for complete implementation and testing

**Go/No-Go Decision Criteria:**

- ✅ GO if: Team can allocate 5-8 days for proper implementation
- ❌ NO-GO if: Must ship within 2-3 days (too risky without proper testing)

**If NO-GO:**

- Document as known issue in release notes
- Add warning tooltip in UI when splitting clips
- Plan for next major release (breaking change)
- Consider minimal workaround (reset properties with user consent)

---

## Appendix: Code Locations

### Files to Modify

1. **Core Command** (Required)
   - `src/core/history/commands/SplitClipCommand.ts` - Main implementation
   - `src/core/history/commands/__tests__/SplitClipCommand.test.ts` - Update tests

2. **Callers** (Required)
   - `src/core/interactions/EditingActions.ts` - Update split action
   - `src/store/timelineStore.ts` - Update any split handling

3. **UI Components** (Required)
   - Search for `getCreatedClipId()` calls - update to handle both IDs
   - Update selection logic after split

4. **Tests** (Required)
   - `src/store/__tests__/timelineStore.test.ts` - Update split tests
   - Add integration tests for split + property modification

### Files to Review (Not Modify)

1. **PreviewMediaPool** (Should work without changes)
   - `src/core/resources/PreviewMediaPool.ts` - Registry logic unaffected
   - Already handles new clipIds via epoch change

2. **Rendering** (Should work without changes)
   - Rasterizer uses clipId from timeline
   - Epoch change triggers re-render with new IDs

---

## Success Metrics

1. **Functional Correctness**
   - ✅ Volume adjustments affect correct clip after split
   - ✅ Effects apply to correct clip after split
   - ✅ Undo/redo works correctly
   - ✅ Multiple splits work correctly

2. **User Experience**
   - ✅ Both splits selectable independently
   - ✅ No property confusion
   - ✅ Clear visual feedback

3. **Compatibility**
   - ✅ Old projects load correctly
   - ✅ Old command history replays correctly
   - ✅ No data loss during migration

4. **Performance**
   - ✅ No performance regression
   - ✅ Split operation remains <50ms

---

## Conclusion

FINDING-012 is a well-scoped architectural issue with a clear solution path. The recommended approach (Option 1) addresses the root cause, provides proper migration, and improves system consistency. The 5-8 day implementation timeline is reasonable for the scope and risk level.

**Status:** Investigation Complete ✅  
**Next Step:** Review with team → Approve implementation → Begin Phase 1  
**Owner:** TBD  
**Target Release:** TBD (requires breaking change window)
