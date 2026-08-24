# Antigravity investigation prompt: timeline toolbar audit

## Mission

Audit the timeline toolbar end to end and report the highest-confidence defects, missing coverage, and command-routing inconsistencies. The toolbar is a high-traffic editor surface. Trace each control from rendered UI event through its command/action, state mutation, history entry, and any affected viewport or selection state.

This is an investigation first. Do not make broad refactors or speculative fixes. Only change code if a minimal, clearly justified test is needed to prove a finding; otherwise return findings and proposed fixes without modifying production behavior.

## Repository context

- Project root: `src/`
- Toolbar: `src/components/editor/timeline/TimelineToolbar.tsx`
- Clip registry: `src/core/commands/clipCommands.ts`
- Timeline registry: `src/core/commands/timelineCommands.ts`
- Registry types/hooks: `src/core/commands/types.ts`, `src/core/commands/useClipCommands.ts`, `src/core/commands/useTimelineCommands.ts`
- History bridge: `src/store/historyStore.ts`, `src/core/history/CommandJournal.ts`
- Timeline state/actions: `src/store/timelineStore.ts`
- Zoom math: `src/lib/timeline/timelineZoom.ts`, `src/lib/timeline/timelineViewport.ts`
- Zoom interaction hooks: `src/hooks/timeline/useAnchoredTimelineZoom.ts`, `src/hooks/timeline/useTimelineZoom.ts`, `src/hooks/timeline/useTimelineZoomSpring.ts`
- Compound clip model/commands: `src/core/timeline/compoundClips.ts`, `src/core/history/commands/CompoundClipCommands.ts`
- Clipboard/duplication: `src/core/clipboard/clipboardService.ts`
- Relevant tests: `src/components/editor/timeline/__tests__/TimelineToolbar.test.tsx`, `src/components/editor/timeline/__tests__/Timeline.test.tsx`, `src/core/commands/__tests__/clipCommands.test.ts`, `src/core/commands/__tests__/crossSurfaceEquivalence.test.ts`, `src/core/history/commands/__tests__/CompoundClipCommands.test.ts`, `src/core/history/commands/__tests__/rippleDeleteComplexScenarios.test.ts`, and zoom hook tests.

## Controls in scope

Inspect every visible or conditionally visible toolbar control, including:

1. Undo and redo.
2. Swap selected clips.
3. Delete left/right at playhead.
4. Split all at playhead.
5. Delete selected clips.
6. Duplicate selected clips.
7. Close gaps.
8. Preview-quality picker and voiceover control only for routing/state consistency if they share the toolbar surface.
9. Fit sequence, zoom out, zoom slider/rail, keyboard zoom, and zoom in.

Also check keyboard and wheel paths that change the same timeline state, because the slider thumb and zoom buttons must reflect one source of truth.

## Investigation questions

### A. Command-registry completeness

- For each clip operation, determine whether the toolbar invokes `clipCommandRegistry`/`clipCommands`, `timelineCommands`, `EditingActions`, a store method, or a local handler.
- Flag any toolbar action that bypasses the canonical registry when an equivalent registry command exists.
- Check whether the bypass changes enabled-state logic, shortcut behavior, toast/error behavior, history integration, or selection semantics.
- Do not assume that a registry entry alone proves migration; follow the actual event handler.
- Compare toolbar behavior with context-menu and shortcut behavior using the cross-surface tests and command contexts.

### B. History fidelity: undo/redo/duplicate/delete/split

- Establish whether history snapshots preserve the complete clip object by serialization or reconstruct fields manually.
- Explicitly verify newer fields: `kind`, compound children, `audioPath`, `detachedFromClipId`, and any other fields on the current clip type.
- Test or inspect undo and redo around compound creation/ungrouping, audio detachment, duplication, split, delete, and ripple operations.
- Confirm epoch/cache invalidation and selection cleanup are intentional and do not hide state loss.
- Report any field-preservation gap separately from a UI-routing gap.

### C. Compound clip semantics

For a compound clip, verify the expected atomic external behavior:

- Split: disabled or rejected with a clear reason; no partial parent/child corruption.
- Trim-left/trim-right: disabled or rejected if compound clips are move-only.
- Delete: removes the compound as one unit and does not leave orphan children.
- Duplicate: deep-copies children with fresh IDs and preserves all relevant child fields and internal gaps.
- Ripple delete/trim: treats the compound atomically externally while preserving internal child timing and gaps.
- Locked-track behavior: all of the above agree with the registry predicates and actual command execution.

Trace both selected-clip and clicked-clip paths, including clicking a clip outside the current selection.

### D. Navigation and frame-time accuracy

- Identify what previous/next or left/right toolbar actions actually step or trim; do not infer from icon names.
- Verify frame stepping uses the project `FrameTime`/integer-tick contract where applicable.
- Look for float accumulation, off-by-one frame errors, and behavior at zero, clip boundaries, sequence end, and gaps.
- Verify undo/redo of navigation or edit operations does not mix playback/UI state with persistent timeline state unintentionally.

### E. Zoom precision and source-of-truth consistency

- Confirm slider position maps to zoom logarithmically through `getZoomRatio`/`getZoomFromRatio`, not linearly.
- Confirm the displayed thumb is derived from the actual store `zoomLevel` and remains correct after slider, keyboard, button, shortcut, and Ctrl+wheel changes.
- Confirm zoom buttons use the geometric `1.25` factor and clamp at the supported limits.
- Confirm `pixelsPerSecond`, `zoomLevel`, and SRP/temporal tier calculations remain synchronized.
- Confirm fit-to-sequence computes a valid exact density for the full timeline duration, including empty timelines, long timelines, gaps, label-column width, and the final visible edge.
- Confirm mouse/playhead anchoring preserves the same timeline time under the cursor/playhead, clamps scroll correctly, and does not use stale state.
- Inspect the spring path for feedback loops, redundant `setPixelsPerSecond` calls, and divergence between animated and store values.

### F. Performance and input behavior

- Inspect continuous slider dragging for RAF coalescing or equivalent throttling. Count store writes/render-triggering updates where practical.
- Check pointer capture, pointer cancel, lost capture, and unmount cleanup.
- Check keyboard autorepeat for zoom and whether it produces uncontrolled work or incorrect anchor reuse.
- Check wheel/pinch and slider interactions for competing updates or stale anchors.

### G. Disabled and accessibility state

Evaluate toolbar state with:

- no clips/tracks;
- a normal unlocked clip selected;
- a compound clip selected;
- a locked-track clip selected;
- a playhead outside/at the exact edge/inside a clip;
- two selected clips for swap;
- undo/redo stacks empty and non-empty.

For each state, compare the rendered `disabled`, visibility, `aria-*`, and tooltip state against the registry `isEnabled`/`isVisible` predicates and actual command behavior. Flag hand-maintained UI predicates that can diverge.

## Required workflow

1. Read the toolbar and all referenced handlers/hooks before drawing conclusions.
2. Trace each control to its final mutation and history path.
3. Read existing tests before adding any new test.
4. Run the smallest relevant test files first, then typecheck. Use the repository's package scripts; do not invent a new test command.
5. If a suspected defect is not reproducible, distinguish “not covered,” “not reproducible,” and “verified correct.”
6. Keep findings evidence-based with file and line references and short execution/test evidence.

Suggested commands:

```sh
npm test -- --run \
  src/components/editor/timeline/__tests__/TimelineToolbar.test.tsx \
  src/components/editor/timeline/__tests__/Timeline.test.tsx \
  src/core/commands/__tests__/clipCommands.test.ts \
  src/core/commands/__tests__/crossSurfaceEquivalence.test.ts \
  src/core/history/commands/__tests__/CompoundClipCommands.test.ts \
  src/core/history/commands/__tests__/rippleDeleteComplexScenarios.test.ts
npm run typecheck
```

If the first command's script forwarding is incompatible with the package manager, run the equivalent `vitest run` command without changing test selection.

## Deliverable format

Return a concise audit report with:

### Executive result

State whether the toolbar is fully registry-routed and whether zoom inputs share a consistent source of truth.

### Findings

For each finding, use:

- **ID / severity:** `P0`–`P3`, where P0 blocks editing/data safety and P3 is coverage or maintainability risk.
- **Title**
- **Evidence:** absolute or repository-relative file paths and line numbers.
- **Reproduction or proof path**
- **Impact**
- **Recommended minimal fix**
- **Test needed or existing test that proves it**

### Verified-correct areas

List important checks that passed, with the test or code evidence.

### Coverage gaps

List behaviors that appear correct but lack meaningful regression coverage.

### Prioritized follow-up

Order fixes by user-visible risk. Separate production fixes from test-only additions. Do not include speculative refactors.

## Boundaries

- Do not redesign the toolbar.
- Do not change zoom constants or compound semantics without citing an existing product invariant or test expectation.
- Do not weaken disabled states to make tests pass.
- Preserve unrelated working-tree changes.
- If implementing a minimal fix is explicitly requested later, add focused regression tests first and run the relevant suite plus typecheck.
