# Spatial Motion Path Removal - Code Review

## Review Metadata
- **Reviewer**: AI Code Review Agent
- **Date**: 2026-10-28
- **Commit Range**: `1a8dbec7..6b818e7e` (6 commits)
- **Scope**: Complete removal of spatial motion path UI overlay feature

---

## Executive Summary

**VERDICT**: **CHANGES_REQUESTED** — Critical blocker identified.

The spatial motion path removal was executed systematically across 5 commits with proper separation of concerns. However, **the mathematical engine (`spatialMotionPath.ts`) and its tests were preserved, while the export remains in `src/core/animation/index.ts`**, creating a **critical inconsistency** with the original removal plan and user intent.

The user explicitly requested: **"I don't need it delete it and remove it completely from the system"** and confirmed complete removal. The current state leaves core engine code exposed through the public animation API despite removing all UI consumers.

---

## Findings

### 🔴 BLOCKER 1: Incomplete Removal — Mathematical Engine Still Exported

**File**: `src/core/animation/index.ts:7`

**Issue**: The `spatialMotionPath` module remains exported from the animation API barrel despite:
1. User requesting "complete removal from the system"
2. All UI consumers being deleted (SpatialMotionPath.tsx)
3. All UI integration points being removed
4. All type properties being removed (showMotionPath)
5. The removal plan explicitly listing this export for deletion in Phase 3

**Current state**:
```typescript
export * from "./keyframeTrackOps";
export * from "./spatialMotionPath";  // ❌ Still present
```

**Evidence**: 
- `src/core/animation/index.ts:7` contains `export * from "./spatialMotionPath";`
- `src/core/animation/spatialMotionPath.ts` exists (18,770 bytes, 500+ lines)
- `src/core/animation/__tests__/spatialMotionPath.test.ts` exists (5,789 bytes)

**Consequence**: 
- Dead code remains in the public API surface
- Future developers may attempt to use the exported functions without UI
- Violates user's explicit "complete removal" requirement
- Inconsistent with the removal plan's stated intent

**Required correction**:
Either:
1. **Option A (Complete Removal)**: Delete `spatialMotionPath.ts`, `spatialMotionPath.test.ts`, and remove the export from `index.ts` as originally planned
2. **Option B (Preserve Engine)**: Obtain explicit user approval to preserve the mathematical engine with clear documentation explaining why it's kept despite "complete removal" being requested

**Blocking severity**: This directly contradicts the user's explicit request and creates API surface inconsistency.

---

## Verification Checklist Results

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | All 8 files deleted | ❌ **FAIL** | Only 3 files deleted (SpatialMotionPath.tsx, SpatialMotionPath.test.tsx, previewMotionBlur.ts). Engine files remain. |
| 2 | All 7 source files modified correctly | ✅ PASS | NativeProgramPreview.tsx, TransformSection.tsx, selectionCoordinator.ts, selectionCoordinator.test.ts, TransformOverlay.tsx, types/index.ts, goldenProjectManifest.ts all modified correctly |
| 3 | All 4 documentation files updated | ✅ PASS | coverage-ledger.md, 00-inventory.md, 04-overlay-rendering.md, 02-pause-handover.md all updated |
| 4 | TypeScript compiles without errors | ⚠️ **UNKNOWN** | No verification evidence recorded in commits or task logs |
| 5 | All tests pass | ⚠️ **UNKNOWN** | No test execution evidence provided |
| 6 | Production build succeeds | ⚠️ **UNKNOWN** | No build evidence provided |
| 7 | Zero references remain | ❌ **FAIL** | `index.ts` still exports spatialMotionPath; engine files remain |
| 8 | No broken dependencies | ⚠️ **UNKNOWN** | Cannot verify without TypeScript compilation evidence |
| 9 | Other overlays functional | ⚠️ **CANNOT VERIFY** | No runtime testing evidence provided |
| 10 | Selection coordinator protections intact | ✅ PASS | Transform handle protections preserved, spatial selectors cleanly removed |

---

## Detailed File Review

### ✅ Files Correctly Deleted (3/8 expected)

1. **`src/components/editor/preview/SpatialMotionPath.tsx`** — Correctly deleted (commit 1a8dbec7)
2. **`src/components/editor/preview/__tests__/SpatialMotionPath.test.tsx`** — Correctly deleted (commit 1a8dbec7)
3. **`src/core/animation/previewMotionBlur.ts`** — Correctly deleted (commit 4ad9d88c)

### ❌ Files Incorrectly Preserved (2 expected deletions)

4. **`src/core/animation/spatialMotionPath.ts`** — Still exists (18,770 bytes)
5. **`src/core/animation/__tests__/spatialMotionPath.test.ts`** — Still exists (5,789 bytes)

### ✅ Files Correctly Modified (7/7)

1. **`src/components/editor/preview/NativeProgramPreview.tsx`** (commit e6b2f81b)
   - ✅ Import removed
   - ✅ JSX usage removed
   - ✅ No broken imports remain

2. **`src/components/editor/properties/shared/TransformSection.tsx`** (commit e6b2f81b)
   - ✅ Motion path toggle button removed
   - ✅ `hasPositionKeyframes` variable preserved for other UI

3. **`src/core/selection/selectionCoordinator.ts`** (commit 2135ba88)
   - ✅ `data-spatial-motion-path` selector removed
   - ✅ `data-motion-path-handle` selector removed
   - ✅ Transform handle protections preserved

4. **`src/core/selection/__tests__/selectionCoordinator.test.ts`** (commit 2135ba88)
   - ✅ Spatial motion path test case removed
   - ✅ Other protection tests intact

5. **`src/components/editor/transform/TransformOverlay.tsx`** (commit 2135ba88)
   - ✅ Spatial motion path selectors removed from `handleCanvasMouseDown`
   - ✅ Transform handle selector preserved

6. **`src/types/index.ts`** (commit b1f41c9b)
   - ✅ `showMotionPath?: boolean` property removed from Clip interface
   - ✅ No type errors introduced

7. **`src/benchmarks/goldenProjectManifest.ts`** (commit b1f41c9b)
   - ✅ `showMotionPath: true` removed from badge sticker clip

### ✅ Documentation Files Correctly Updated (4/4)

1. **`docs/preview-audit/coverage-ledger.md`** (commit 6b818e7e)
   - ✅ SpatialMotionPath.tsx entry removed from coverage table

2. **`docs/preview-audit/00-inventory.md`** (commit 6b818e7e)
   - ✅ SpatialMotionPath.tsx entry removed from inventory

3. **`docs/preview-audit-preliminary/03-flows/04-overlay-rendering.md`** (commit 6b818e7e)
   - ✅ SpatialMotionPath.tsx removed from interactive DOM components list
   - ✅ TransformOverlay and SafeOverlay preserved

4. **`docs/preview-audit-preliminary/03-flows/02-pause-handover.md`** (commit 6b818e7e)
   - ✅ SpatialMotionPath removed from React overlays list

---

## Search Verification Results

### ✅ Clean Removals (No Active References)

- **`data-spatial-motion-path`**: Zero references in source code (only in .git logs and removal plan)
- **`showMotionPath`**: Zero references in source code (only in .git logs and removal plan)
- **`SpatialMotionPath`** (component): Zero references in source code
- **`ConnectedSpatialMotionPath`**: Zero references in source code
- **`data-motion-path-handle`**: Zero references in source code
- **`previewMotionBlur`**: Zero references (dead code successfully removed)

### ❌ Remaining References (Engine)

- **`spatialMotionPath`** (module): 
  - `src/core/animation/index.ts:7` — exports the module
  - `src/core/animation/__tests__/spatialMotionPath.test.ts:14` — imports from engine
  - Engine files still exist and are tested

---

## Missing Verification Evidence

The following required verification steps were **not documented** in commit messages or task logs:

1. **TypeScript Compilation**: No evidence of `npx tsc --noEmit` execution
2. **Fast Verification Suite**: No evidence of `npm run verify:fast` execution
3. **Test Suite Execution**: No evidence of `npm run test` or `npx vitest` execution
4. **Production Build**: No evidence of `npm run build` execution
5. **Runtime Manual Verification**: No evidence of dev server testing

Per AGENTS.md § 6 Definition of Done:
> Before reporting any task complete, every agent must verify:
> 5. **Verification Evidence**: `npx tsc --noEmit` passed with 0 errors, relevant test files executed and passed

**Impact**: Cannot confirm the removal is functionally correct without compilation and test evidence.

---

## Commit Structure Analysis

### ✅ Excellent Separation of Concerns

The removal was executed across **6 well-structured commits**:

1. **1a8dbec7**: Remove UI component and tests (SpatialMotionPath.tsx, SpatialMotionPath.test.tsx)
2. **e6b2f81b**: Remove UI integration (NativeProgramPreview.tsx, TransformSection.tsx)
3. **2135ba88**: Remove selector protections (selectionCoordinator.ts, TransformOverlay.tsx, tests)
4. **b1f41c9b**: Remove type property (Clip interface, goldenProjectManifest.ts)
5. **4ad9d88c**: Remove dead code (previewMotionBlur.ts)
6. **6b818e7e**: Update documentation (4 doc files)

Each commit message follows Conventional Commits format with detailed change descriptions.

---

## Architecture Invariants Check

Reviewed against AGENTS.md § 2 Architectural Invariants:

| Invariant | Status | Notes |
|-----------|--------|-------|
| 1. Single Time Source | ✅ N/A | No playback clock changes |
| 2. EvaluatedScene Currency | ✅ N/A | No render pipeline changes |
| 3. Command-Pattern Mutations | ✅ N/A | No timeline mutations added |
| 4. Async Asset Hydration | ✅ N/A | No asset loading changes |
| 5. IPC Discipline | ✅ PASS | No new IPC calls added |
| 10. Preserve Docs & Comments | ✅ PASS | Only removed code-related comments deleted |
| 13. Active Presenter Verification | ✅ PASS | No presenter logic modified |

---

## Security & Data Safety

- ✅ No user data affected (clip position keyframes remain intact)
- ✅ No authentication/authorization changes
- ✅ No external API calls introduced
- ✅ No dependency changes
- ✅ Read-only documentation updates

---

## Cross-Platform Compatibility

- ✅ No OS-specific code introduced
- ✅ No platform branching added
- ✅ DOM selector removals are platform-agnostic
- ✅ TypeScript changes are cross-platform

---

## Regression Risk Assessment

**Low Risk** — Spatial motion path was an isolated visual overlay feature with no dependencies from critical systems:

- ✅ Timeline editing unaffected
- ✅ Playback engine unaffected  
- ✅ Export pipeline unaffected
- ✅ Transform editing (TransformOverlay) preserved
- ✅ Safe overlay rendering preserved
- ✅ Selection coordination preserved (other interactive elements)

**Medium Risk** — Missing verification evidence:
- ⚠️ Cannot confirm no TypeScript errors without compilation evidence
- ⚠️ Cannot confirm tests pass without execution evidence

---

## Recommendations

### Required Actions (Blockers)

1. **Resolve Mathematical Engine Inconsistency**:
   - Obtain explicit user clarification: Should the engine be preserved or deleted?
   - If preserving: Add documentation explaining retention rationale and update removal plan
   - If deleting: Remove `spatialMotionPath.ts`, `spatialMotionPath.test.ts`, and export from `index.ts`

2. **Provide Verification Evidence**:
   - Execute `npx tsc --noEmit` and record output
   - Execute `npm run verify:fast` and record output
   - Execute relevant test suites and record results

### Optional Improvements

3. Update removal plan to reflect actual execution (engine preserved vs. plan stated deletion)
4. Add runtime verification notes if dev server testing was performed

---

## Conclusion

The spatial motion path UI removal was executed with excellent commit discipline and systematic separation of concerns. All UI integration points, type properties, selector protections, and documentation were cleanly removed.

However, the **mathematical engine remains exported** despite the user's explicit "complete removal" request, creating a critical inconsistency between stated intent and implementation. Additionally, **no verification evidence** was recorded to confirm TypeScript compilation or test passage.

**Blocking Issue**: Engine export inconsistency must be resolved before approval.

**Required**: Verification evidence (tsc, tests) must be provided per Definition of Done.

---

## Review Completion Statement

This review examined:
- ✅ 6 commits across 5 file deletions (3 executed, 2 pending)
- ✅ 7 source file modifications (all correct)
- ✅ 4 documentation updates (all correct)
- ✅ Grep searches for lingering references
- ✅ Architecture invariants compliance
- ❌ Verification evidence (missing)
- ❌ Engine export consistency (blocker identified)

**Next Action**: User decision on engine preservation + provide verification evidence.
