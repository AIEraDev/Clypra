# Spatial Motion Path Feature Complete Removal Plan

## Task Summary
Complete removal of the spatial motion path feature from Clypra, including the interactive SVG overlay component, mathematical engine, UI controls, type definitions, selector protections, documentation references, and dead motion blur preview code.

---

## 1. Files to Delete (5 files)

### Component & Tests
- **`src/components/editor/preview/SpatialMotionPath.tsx`** (456 lines)
  - Main React component rendering interactive SVG overlay with Bézier trajectory curves, keyframe anchors, tangent handles, and playhead cursor
  - Receives viewport transform, canvas dimensions, and selected clip from stores
  - Handles pointer drag interactions for spatial keyframe editing

- **`src/components/editor/preview/__tests__/SpatialMotionPath.test.tsx`** (~140 lines)
  - Component unit tests covering SVG rendering, keyframe anchor rendering, playhead cursor visibility, and interactive attribute marking
  - Uses vitest + @testing-library/react

### Mathematical Engine & Tests
- **`src/core/animation/spatialMotionPath.ts`** (~500 lines)
  - Analytical 2D cubic Bézier trajectory geometry engine
  - Functions: `extractSpatialPathNodes`, `computeAutoSmoothTangents`, `buildSpatialSegments`, `evaluateSpatialBezier`, `evaluateSpatialBezierDerivative`, `evaluateSpatialPosition`, `evaluateSpatialVelocity`, `calculateShutterDisplacement`, `generateSpatialPathSvg`, `generatePathFrameTicks`, `updateSpatialKeyframePosition`, `updateSpatialTangentHandle`, `insertSpatialKeyframeOnPath`
  - Exports types: `SpatialPoint`, `SpatialTangent`, `SpatialPathNode`, `SpatialSegment`, `SpatialVelocity`, `ShutterBlurDisplacement`, `PathFrameTick`

- **`src/core/animation/__tests__/spatialMotionPath.test.ts`** (~200 lines)
  - Unit tests for mathematical engine covering node extraction, tangent computation, Bézier evaluation, velocity calculations, and keyframe updates

### Dead Code
- **`src/core/animation/previewMotionBlur.ts`** (~90 lines)
  - CSS/SVG filter parameter calculator for DOM canvas motion blur preview
  - Exports `PreviewMotionBlurParams` interface and `getPreviewMotionBlurParams` function
  - **Confirmed dead code**: Not imported or referenced anywhere in the codebase
  - Originally intended for DOM canvas fallback path; GPU shutter blur uses `multi_track_blend.wgsl` instead

---

## 2. Files to Modify (8 files)

### A. Remove Component Import & JSX Usage

#### `src/components/editor/preview/NativeProgramPreview.tsx`
**Lines to modify**: ~40 (import), ~5337–5346 (JSX usage)

**Changes**:
1. **Remove import** (line ~40):
   ```typescript
   import { ConnectedSpatialMotionPath } from "./SpatialMotionPath";
   ```

2. **Remove JSX block** (lines ~5337–5346):
   ```tsx
   <ConnectedSpatialMotionPath
     canvasWidth={canvasWidth}
     canvasHeight={canvasHeight}
     scale={scale}
     viewport={viewport}
     displayOffset={{ x: offsetX, y: offsetY }}
     displayWidth={displayWidth}
     displayHeight={displayHeight}
   />
   ```

**Verification**: Component renders preview overlays (TransformOverlay, SafeOverlay) without spatial motion path; no TypeScript errors.

---

### B. Remove UI Toggle Button

#### `src/components/editor/properties/shared/TransformSection.tsx`
**Lines to modify**: ~462–487 (toggle button block)

**Changes**:
Remove the conditional button block that toggles `showMotionPath` property:
```tsx
{hasPositionKeyframes && (
  <button
    type="button"
    onClick={() =>
      handleUpdate(
        "showMotionPath",
        selectedClip.showMotionPath === false
          ? undefined
          : false,
      )
    }
    className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-all cursor-pointer ${
      selectedClip.showMotionPath === false
        ? "text-text-muted hover:text-accent hover:bg-accent/10"
        : "text-accent bg-accent/10"
    }`}
    title={
      selectedClip.showMotionPath === false
        ? "Show motion path"
        : "Hide motion path"
    }
  >
    <Route className="w-3 h-3" />
    Path
  </button>
)}
```

**Note**: The `hasPositionKeyframes` variable (derived from `visualKeyframes?.x` and `visualKeyframes?.y`) is still used by other UI elements in this section, so do NOT remove it.

**Verification**: Properties panel renders without motion path toggle; position keyframe UI remains functional.

---

### C. Remove Export from Animation Index

#### `src/core/animation/index.ts`
**Line to remove**: Line 7

**Current content**:
```typescript
export * from "./springPhysics";
export * from "./cubicBezier";
export * from "./curvePresets";
export * from "./timeAnchor";
export * from "./motionPresets";
export * from "./keyframeTrackOps";
export * from "./spatialMotionPath";
```

**After removal**:
```typescript
export * from "./springPhysics";
export * from "./cubicBezier";
export * from "./curvePresets";
export * from "./timeAnchor";
export * from "./motionPresets";
export * from "./keyframeTrackOps";
```

**Verification**: Animation module exports remain valid; no downstream import errors.

---

### D. Remove Type Property from Clip Interface

#### `src/types/index.ts`
**Lines to remove**: ~552–553

**Current content** (lines ~550–555):
```typescript
  /** Cinematic GPU shutter motion blur configuration */
  motionBlur?: ClipMotionBlurConfig;
  /** Optional override to force show or hide spatial motion path on canvas preview */
  showMotionPath?: boolean;
  audioPath?: string;
  /** Source clip identity for generated detach-audio clips. */
  detachedFromClipId?: string;
```

**After removal**:
```typescript
  /** Cinematic GPU shutter motion blur configuration */
  motionBlur?: ClipMotionBlurConfig;
  audioPath?: string;
  /** Source clip identity for generated detach-audio clips. */
  detachedFromClipId?: string;
```

**Verification**: Clip interface compiles without `showMotionPath`; no references to this property remain in codebase (except golden project manifest, handled separately).

---

### E. Remove showMotionPath from Benchmark Manifest

#### `src/benchmarks/goldenProjectManifest.ts`
**Line to remove**: ~552

**Current content** (lines ~548–555):
```typescript
      height: 140,
      opacity: 0.9,
      rotation: 15,
      kind: "sticker",
      role: "overlay",
      stickerFormat: "static",
      showMotionPath: true,
      visualKeyframes: {
        x: badgePositionKeyframes,
      },
```

**After removal**:
```typescript
      height: 140,
      opacity: 0.9,
      rotation: 15,
      kind: "sticker",
      role: "overlay",
      stickerFormat: "static",
      visualKeyframes: {
        x: badgePositionKeyframes,
      },
```

**Verification**: Golden project manifest compiles and loads without `showMotionPath` property.

---

### F. Remove Selector Protection Logic

#### `src/core/selection/selectionCoordinator.ts`
**Lines to remove**: ~29–30

**Current content** (lines ~26–32):
```typescript
  // 1. Transform overlay handles and move surfaces
  if (
    target.closest("[data-transform-handle]") ||
    target.closest("[data-transform-overlay]") ||
    target.closest("[data-spatial-motion-path]") ||
    target.closest("[data-motion-path-handle]")
  ) {
    return true;
  }
```

**After removal**:
```typescript
  // 1. Transform overlay handles and move surfaces
  if (
    target.closest("[data-transform-handle]") ||
    target.closest("[data-transform-overlay]")
  ) {
    return true;
  }
```

**Verification**: Selection coordinator protects transform handles; no spatial motion path selectors remain.

---

### G. Remove Test Case from Selection Coordinator Tests

#### `src/core/selection/__tests__/selectionCoordinator.test.ts`
**Lines to remove**: ~40–49

**Current content**:
```typescript
    it("protects spatial motion path and motion path handles", () => {
      const motionPath = document.createElement("svg");
      motionPath.setAttribute("data-spatial-motion-path", "true");
      const handle = document.createElement("g");
      handle.setAttribute("data-motion-path-handle", "true");
      motionPath.appendChild(handle);

      expect(isProtectedInteractiveElement(handle)).toBe(true);
      expect(isProtectedInteractiveElement(motionPath)).toBe(true);
    });
```

**Remove entire test case block**.

**Verification**: Test suite runs without this test; remaining protection tests pass.

---

### H. Update TransformOverlay Selector

#### `src/components/editor/transform/TransformOverlay.tsx`
**Line to modify**: ~1048

**Current content** (lines ~1044–1052):
```typescript
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      // Don't handle if clicking on a handle or during drag
      if (
        isDragging ||
        (e.target as HTMLElement).closest(
          "[data-transform-handle], [data-spatial-motion-path], [data-motion-path-handle]",
        )
      ) {
        return;
      }
```

**After removal**:
```typescript
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      // Don't handle if clicking on a handle or during drag
      if (
        isDragging ||
        (e.target as HTMLElement).closest(
          "[data-transform-handle]",
        )
      ) {
        return;
      }
```

**Verification**: Transform overlay handles pointer events correctly; no spatial motion path selectors in closest() check.

---

## 3. Documentation Files to Update (4 files)

### A. Remove Coverage Ledger Entry

#### `docs/preview-audit/coverage-ledger.md`
**Line to remove**: Line 44

**Current content** (lines 43–46):
```markdown
| `src/components/editor/preview/ProgramPreview.tsx` | 36 | 1–36 | 100% | Complete |
| `src/components/editor/preview/SourcePreview.tsx` | 949 | 1–949 | 100% | Complete |
| `src/components/editor/preview/SpatialMotionPath.tsx` | 456 | 1–456 | 100% | Complete |
| `src/components/editor/preview/StickerSourcePreview.tsx` | 161 | 1–161 | 100% | Complete |
```

**After removal**:
```markdown
| `src/components/editor/preview/ProgramPreview.tsx` | 36 | 1–36 | 100% | Complete |
| `src/components/editor/preview/SourcePreview.tsx` | 949 | 1–949 | 100% | Complete |
| `src/components/editor/preview/StickerSourcePreview.tsx` | 161 | 1–161 | 100% | Complete |
```

---

### B. Remove Inventory Entries

#### `docs/preview-audit/00-inventory.md`
**Lines to remove**: Line 72 (appears 3 times in table due to multiple exports listed)

**Current content** (lines ~71–74):
```markdown
| `src/components/editor/preview/ProgramPreview.tsx` | 36 | 1 | Exports ProgramPreview |
| `src/components/editor/preview/SourcePreview.tsx` | 949 | 3 | Exports SourcePreview |
| `src/components/editor/preview/SpatialMotionPath.tsx` | 456 | 1 | Exports SpatialMotionPath, ConnectedSpatialMotionPath |
| `src/components/editor/preview/StickerSourcePreview.tsx` | 161 | 1 | Exports StickerSourcePreviewHandle, StickerSourcePreview |
```

**After removal**:
```markdown
| `src/components/editor/preview/ProgramPreview.tsx` | 36 | 1 | Exports ProgramPreview |
| `src/components/editor/preview/SourcePreview.tsx` | 949 | 3 | Exports SourcePreview |
| `src/components/editor/preview/StickerSourcePreview.tsx` | 161 | 1 | Exports StickerSourcePreviewHandle, StickerSourcePreview |
```

---

### C. Update Overlay Rendering Flow Documentation

#### `docs/preview-audit-preliminary/03-flows/04-overlay-rendering.md`
**Lines to modify**: ~52 (list item)

**Current content** (lines ~49–53):
```markdown
3. Interactive DOM components render directly above the canvas inside the preview container:
   - `TransformOverlay.tsx`: Interactive bounding box handles for scale, rotation, and translation.
   - `SafeOverlay.tsx`: Action-safe and title-safe guidelines.
   - `SpatialMotionPath.tsx`: Keyframe motion trajectories and control points.
```

**After removal**:
```markdown
3. Interactive DOM components render directly above the canvas inside the preview container:
   - `TransformOverlay.tsx`: Interactive bounding box handles for scale, rotation, and translation.
   - `SafeOverlay.tsx`: Action-safe and title-safe guidelines.
```

---

### D. Update Pause Handover Flow Documentation

#### `docs/preview-audit-preliminary/03-flows/02-pause-handover.md`
**Line to modify**: ~15

**Current content** (lines ~14–17):
```markdown
- **During Paused Inspection & Editing**:
  - React overlays (`TransformOverlay`, `SafeOverlay`, `SpatialMotionPath`, and text inline editors) must accept mouse events and render on top of the video frame.
  - The native child window must be hidden (`hide_native_surface`) so that the WebView's HTML5 `<canvas>` and DOM overlays become visible and interactable.
```

**After removal**:
```markdown
- **During Paused Inspection & Editing**:
  - React overlays (`TransformOverlay`, `SafeOverlay`, and text inline editors) must accept mouse events and render on top of the video frame.
  - The native child window must be hidden (`hide_native_surface`) so that the WebView's HTML5 `<canvas>` and DOM overlays become visible and interactable.
```

---

## 4. Order of Operations (Dependency-Safe Sequence)

Execute deletions and modifications in this order to avoid intermediate TypeScript compilation errors:

### Phase 1: Remove UI Integration Points (No Type Errors)
1. **Remove JSX usage** in `NativeProgramPreview.tsx` (component call)
2. **Remove UI toggle** in `TransformSection.tsx` (button block)
3. **Remove selector protections** in `selectionCoordinator.ts` and `TransformOverlay.tsx`
4. **Remove test case** in `selectionCoordinator.test.ts`

**Verification**: Run `npx tsc --noEmit` → should pass (component still exists, just unused)

---

### Phase 2: Remove Type Property & Benchmark Usage
5. **Remove `showMotionPath` property** from `src/types/index.ts` (Clip interface)
6. **Remove `showMotionPath: true`** from `goldenProjectManifest.ts`

**Verification**: Run `npx tsc --noEmit` → should pass (property removed cleanly)

---

### Phase 3: Remove Export (Component Still Exists)
7. **Remove export** from `src/core/animation/index.ts`

**Verification**: Run `npx tsc --noEmit` → should pass (engine module no longer exported)

---

### Phase 4: Delete Files (Final Cleanup)
8. **Delete component** and test: `SpatialMotionPath.tsx`, `SpatialMotionPath.test.tsx`
9. **Delete engine** and test: `spatialMotionPath.ts`, `spatialMotionPath.test.ts`
10. **Delete dead code**: `previewMotionBlur.ts`
11. **Remove import** in `NativeProgramPreview.tsx` (import statement)

**Verification**: Run `npx tsc --noEmit` → should pass (all references removed)

---

### Phase 5: Update Documentation
12. Update all 4 documentation files (coverage ledger, inventory, overlay rendering, pause handover)

**Verification**: Run `npm run docs:check` → should pass (internal doc links valid)

---

## 5. Verification Steps After Removal

### A. Type Safety & Build
```bash
# 1. TypeScript compilation (zero errors)
npx tsc --noEmit

# 2. Fast verification suite (architecture + typecheck + preview render loop)
npm run verify:fast

# 3. Full production build
npm run build
```

**Expected**: All checks pass; no references to `SpatialMotionPath`, `spatialMotionPath`, or `showMotionPath` remain.

---

### B. Test Suite Coverage
```bash
# 1. Run all unit tests
npm run test

# 2. Preview subsystem tests (ensure no broken imports)
npx vitest run src/components/editor/preview/__tests__/

# 3. Animation module tests (ensure spatial engine removed cleanly)
npx vitest run src/core/animation/__tests__/

# 4. Selection coordinator tests (verify test removal)
npx vitest run src/core/selection/__tests__/selectionCoordinator.test.ts
```

**Expected**: All tests pass; no failing imports or missing modules.

---

### C. Documentation Link Validation
```bash
npm run docs:check
```

**Expected**: No broken internal documentation links.

---

### D. Grep Verification (No Lingering References)
```bash
# Search for any remaining references to deleted code
grep -r "SpatialMotionPath" src/
grep -r "spatialMotionPath" src/
grep -r "showMotionPath" src/
grep -r "data-spatial-motion-path" src/
grep -r "data-motion-path-handle" src/
grep -r "previewMotionBlur" src/
grep -r "getPreviewMotionBlurParams" src/
```

**Expected**: Zero results (all references removed).

---

### E. Runtime Verification
```bash
# Start dev server and verify preview overlays render correctly
npm run tauri dev
```

**Manual checks**:
1. Open project with clips containing position keyframes
2. Select a clip with animated position
3. Verify TransformOverlay renders (bounding box handles)
4. Verify SafeOverlay renders (safe zone guides)
5. Verify NO spatial motion path SVG overlay appears
6. Verify properties panel Transform section does NOT show "Path" toggle button
7. Verify clicking on preview canvas selects/deselects clips correctly (no selector errors)

---

## 6. Risk Assessment & Rollback Strategy

### Low-Risk Removal
- Spatial motion path is a **non-essential visual debug overlay** feature
- No critical editor functionality depends on it
- Zero data model changes (clip position keyframes remain intact)
- Timeline, playback, export, and transform editing unaffected

### Potential Side Effects (Mitigated)
1. **Users with existing `showMotionPath: false` in projects**: Property will be silently ignored (no crash)
2. **Dead code `previewMotionBlur.ts`**: Confirmed unused; safe to delete
3. **Documentation drift**: All known references updated in this plan

### Rollback Procedure
If issues arise post-removal:
1. Revert commit(s) in single atomic unit
2. Restore all 5 deleted files from git history
3. Restore all 8 modified file sections
4. Re-run verification suite

---

## 7. Definition of Done

- [ ] All 5 files deleted
- [ ] All 8 files modified correctly
- [ ] All 4 documentation files updated
- [ ] `npx tsc --noEmit` passes (0 errors)
- [ ] `npm run verify:fast` passes
- [ ] `npm run test` passes (all unit tests)
- [ ] `npm run docs:check` passes
- [ ] Grep verification confirms zero lingering references
- [ ] Runtime manual verification confirms overlay rendering works correctly
- [ ] No console errors or warnings in dev server
- [ ] Git commit message follows Conventional Commits: `feat: remove spatial motion path overlay feature`

---

## 8. Related Context

**Original user request**: "I don't need it delete it and remove it completely from the system" (in response to discovering `data-spatial-motion-path="true"` in preview rendering code).

**User intent**: Complete removal of spatial motion path feature — no partial deprecation, no feature flag, no future reintroduction planned.

**User confirmation**: Selected options: (a) Complete removal, (b) Update documentation, (b) Remove UI controls.

**Codebase context**: Clypra v1.6.0, React 19 + TypeScript 5.8 + Vite 7, Tauri 2.11 + Rust, Zustand v5 state management.
