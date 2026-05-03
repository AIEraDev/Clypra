# Creating GitHub Issues from Audit

This document provides templates for creating GitHub issues for each bug found in the audit.

---

## Issue Template Format

```markdown
## Description

[Brief description of the bug]

## Severity

[Critical / High / Medium / Low]

## Priority

[P0 / P1 / P2]

## Location

**Files:**

- `path/to/file.ts:line`

## Current Behavior

[What currently happens]

## Expected Behavior

[What should happen]

## Steps to Reproduce

1. [Step 1]
2. [Step 2]
3. [Step 3]

## Impact

[How this affects users]

## Proposed Solution

[Brief description of fix]

## Related Issues

- Related to #[issue number]
- Blocks #[issue number]

## Audit Reference

- **Bug ID:** BUG-XXX
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md)
- **Fix Guide:** See [AUDIT_FIX_GUIDE.md](../AUDIT_FIX_GUIDE.md)

## Labels

`audit:critical` `audit:p0` `audit:bug`
```

---

## Critical Issues (P0)

### Issue 1: Clip Dragging Not Implemented

```markdown
## Description

Clips cannot be dragged to reposition them on the timeline after initial placement.

## Severity

Critical

## Priority

P0

## Location

**Files:**

- `src/components/editor/timeline/Clip.tsx`
- `src/components/editor/timeline/Track.tsx`

## Current Behavior

- Clips have `useDrag` configured
- No drop handler exists to process the drag
- Clips remain at initial position

## Expected Behavior

- User can drag clip within same track to change start time
- User can drag clip to different track
- Visual feedback during drag
- Locked tracks prevent dragging

## Steps to Reproduce

1. Import a video file
2. Drag it to timeline to create a clip
3. Try to drag the clip to a new position
4. Nothing happens

## Impact

- Core editing functionality is missing
- Users cannot reposition clips after placement
- Makes timeline editing nearly impossible

## Proposed Solution

1. Add drop handler to Track component accepting "CLIP" type
2. Calculate new start time from drop position
3. Update clip position or track via store
4. Add visual feedback during drag

## Related Issues

- Related to #[clip-resizing-issue]
- Blocks #[multi-select-issue]

## Audit Reference

- **Bug ID:** BUG-020
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#bug-020)
- **Fix Guide:** See [AUDIT_FIX_GUIDE.md](../AUDIT_FIX_GUIDE.md#bug-020)

## Labels

`audit:critical` `audit:p0` `audit:bug` `timeline` `drag-drop`
```

### Issue 2: Clip Resizing Not Implemented

```markdown
## Description

Clip resize handles exist but do not function - cannot trim clips visually.

## Severity

Critical

## Priority

P0

## Location

**Files:**

- `src/components/editor/timeline/Clip.tsx:24`

## Current Behavior

- Resize handles are visible on clip edges
- `isResizing` state is set but not used
- No mouse move handlers
- Clips cannot be trimmed

## Expected Behavior

- Drag left edge to adjust trim in (start time)
- Drag right edge to adjust trim out (duration)
- Visual feedback during resize
- Clamp to valid range (0 to media duration)
- Locked tracks prevent resizing

## Steps to Reproduce

1. Create a clip on timeline
2. Try to drag left or right edge
3. Nothing happens

## Impact

- Cannot trim clips to desired length
- Core editing functionality missing
- Users must delete and re-add clips to change duration

## Proposed Solution

1. Add mouse event handlers for resize start
2. Track mouse movement during resize
3. Calculate new trim values based on delta
4. Update clip via store
5. Add visual feedback

## Related Issues

- Related to #[clip-dragging-issue]
- Blocks #[precise-editing-issue]

## Audit Reference

- **Bug ID:** BUG-021
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#bug-021)
- **Fix Guide:** See [AUDIT_FIX_GUIDE.md](../AUDIT_FIX_GUIDE.md#bug-021)

## Labels

`audit:critical` `audit:p0` `audit:bug` `timeline` `clip-editing`
```

### Issue 3: Playback Drift Compensation

```markdown
## Description

Video playback accumulates drift over time, causing videos to desync.

## Severity

Critical

## Priority

P0

## Location

**Files:**

- `src/store/playbackStore.ts:24`
- `src/hooks/usePlayback.ts`

## Current Behavior

- Playback uses `setInterval` with fixed 16ms
- No drift compensation
- Videos desync after 30-60 seconds
- Sync gets progressively worse

## Expected Behavior

- Playback maintains accurate timing
- No drift accumulation
- Videos stay in sync for entire duration
- Frame-accurate playback

## Steps to Reproduce

1. Import multiple video clips
2. Place on timeline
3. Play for 60 seconds
4. Observe videos drifting out of sync

## Impact

- Unusable for precise editing
- Multi-track projects become unwatchable
- Professional editing impossible

## Proposed Solution

1. Replace `setInterval` with `requestAnimationFrame`
2. Track actual elapsed time using `performance.now()`
3. Calculate current time from elapsed time
4. Compensate for any drift automatically

## Related Issues

- Related to #[video-sync-tolerance-issue]
- Blocks #[multi-track-editing-issue]

## Audit Reference

- **Bug ID:** BUG-014
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#bug-014)
- **Fix Guide:** See [AUDIT_FIX_GUIDE.md](../AUDIT_FIX_GUIDE.md#bug-014)

## Labels

`audit:critical` `audit:p0` `audit:bug` `playback` `performance`
```

### Issue 4: No Undo/Redo System

```markdown
## Description

No undo/redo functionality exists - users cannot recover from mistakes.

## Severity

Critical

## Priority

P0

## Location

**Files:**

- `src/store/timelineStore.ts`
- `src/store/projectStore.ts`
- New: `src/store/middleware/undoMiddleware.ts`

## Current Behavior

- No undo/redo functionality
- All actions are permanent
- No way to recover from mistakes

## Expected Behavior

- Cmd+Z / Ctrl+Z to undo
- Cmd+Shift+Z / Ctrl+Y to redo
- UI buttons for undo/redo
- History limit (50 actions)
- New actions clear redo history

## Steps to Reproduce

1. Make any edit (add clip, delete clip, etc.)
2. Try to undo with Cmd+Z
3. Nothing happens

## Impact

- Major usability issue
- Users afraid to experiment
- Mistakes are permanent
- Professional editing impossible

## Proposed Solution

1. Create undo middleware for Zustand
2. Track state history (past/future arrays)
3. Implement undo/redo actions
4. Add keyboard shortcuts
5. Add UI buttons to toolbar

## Related Issues

- Blocks all editing features
- Required for MVP

## Audit Reference

- **Bug ID:** BUG-026
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#bug-026)
- **Fix Guide:** See [AUDIT_FIX_GUIDE.md](../AUDIT_FIX_GUIDE.md#bug-026)

## Labels

`audit:critical` `audit:p0` `audit:bug` `ux` `state-management`
```

### Issue 5: Drop Zone Conflicts

```markdown
## Description

MediaPanel and Timeline both listen to same Tauri drag events, causing conflicts.

## Severity

High

## Priority

P1

## Location

**Files:**

- `src/hooks/useFileDrop.ts`
- `src/components/editor/MediaPanel.tsx`
- `src/components/editor/timeline/Timeline.tsx`

## Current Behavior

- Both components listen to `tauri://drag-drop`
- No zone priority or mutual exclusion
- May process drop twice
- Unpredictable behavior

## Expected Behavior

- Only one zone processes each drop
- Clear visual feedback for active zone
- No double processing
- Reliable drag & drop

## Steps to Reproduce

1. Drag file from desktop
2. Hover over media panel
3. Move to timeline
4. Drop
5. May be processed by both zones

## Impact

- Unpredictable drag & drop behavior
- Files may be imported twice
- Clips may be created in wrong place
- Poor user experience

## Proposed Solution

1. Create drop zone manager
2. Track active zone globally
3. Only active zone processes drop
4. Update both components to use manager

## Related Issues

- Related to #[media-import-issue]
- Related to #[timeline-drop-issue]

## Audit Reference

- **Bug ID:** BUG-005
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#bug-005)
- **Fix Guide:** See [AUDIT_FIX_GUIDE.md](../AUDIT_FIX_GUIDE.md#bug-005)

## Labels

`audit:high` `audit:p1` `audit:bug` `drag-drop` `ux`
```

### Issue 6: Video Sync Tolerance Too High

```markdown
## Description

Video sync tolerance is 50ms, should be < 1 frame for accuracy.

## Severity

Critical

## Priority

P1

## Location

**Files:**

- `src/components/editor/PreviewPanel.tsx:73`

## Current Behavior

- Sync tolerance hardcoded to 0.05s (50ms)
- Videos can be 1-2 frames out of sync
- Not frame-accurate

## Expected Behavior

- Tolerance should be < 1 frame duration
- At 30fps: < 33ms
- At 60fps: < 16ms
- Frame-accurate synchronization

## Steps to Reproduce

1. Import video with burned-in timecode
2. Play and observe sync
3. May see 1-2 frame offset

## Impact

- Not frame-accurate
- Professional editing requires frame accuracy
- Visible sync issues in some cases

## Proposed Solution

1. Calculate tolerance from frame rate
2. Use `frameDuration / 2` as tolerance
3. Make tolerance dynamic based on project frame rate

## Related Issues

- Related to #[playback-drift-issue]
- Blocks #[frame-accurate-editing-issue]

## Audit Reference

- **Bug ID:** BUG-013
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#bug-013)
- **Fix Guide:** See [AUDIT_FIX_GUIDE.md](../AUDIT_FIX_GUIDE.md#bug-013)

## Labels

`audit:critical` `audit:p1` `audit:bug` `playback` `precision`
```

---

## High Priority Issues (P1)

### Issue 7: Drop Position Ignored on Timeline

````markdown
## Description

Files dropped on timeline always go to end, ignoring mouse position.

## Severity

High

## Priority

P1

## Location

**Files:**

- `src/components/editor/timeline/Timeline.tsx:96`

## Current Behavior

- Drop always uses `getTimelineEndTime()`
- Mouse position ignored
- Cannot drop at specific time

## Expected Behavior

- Calculate time from mouse X position
- Drop clip at mouse position
- Respect zoom level and scroll

## Steps to Reproduce

1. Drag file to timeline
2. Drop at specific position
3. Clip appears at end instead

## Impact

- Cannot place clips at specific times
- Must drag clips after drop (which is also broken)
- Poor user experience

## Proposed Solution

Calculate drop time from mouse position:

```typescript
const dropTime = (clientX - rect.left + scrollLeft) / pixelsPerSecond;
```
````

## Audit Reference

- **Bug ID:** BUG-027
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#bug-027)

## Labels

`audit:high` `audit:p1` `audit:bug` `timeline` `drag-drop`

````

---

## Medium Priority Issues (P2)

### Issue 8: Image Duration Not Set

```markdown
## Description
Image assets have duration: 0 instead of DEFAULT_STILL_DURATION_SECONDS.

## Severity
Medium

## Priority
P2

## Location
**Files:**
- `src/hooks/useMediaImport.ts:48`

## Current Behavior
- Images imported with `duration: 0`
- Should use `DEFAULT_STILL_DURATION_SECONDS` (5s)

## Expected Behavior
- Images should have default duration of 5 seconds
- Consistent with clip creation logic

## Steps to Reproduce
1. Import an image file
2. Check asset duration
3. Shows 0 instead of 5

## Impact
- Images may not display correctly
- Inconsistent with clip creation
- Minor display issues

## Proposed Solution
```typescript
duration: DEFAULT_STILL_DURATION_SECONDS,
````

## Audit Reference

- **Bug ID:** BUG-001
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#bug-001)

## Labels

`audit:medium` `audit:p2` `audit:bug` `media-import`

````

---

## Feature Requests from Audit

### Feature: Save/Load Projects

```markdown
## Description
Implement project persistence - save and load projects.

## Priority
Critical for MVP

## Current State
- Projects lost on close
- No persistence layer
- No file format defined

## Proposed Implementation
1. Define project file format (JSON)
2. Implement save dialog
3. Implement load dialog
4. Store project metadata
5. Store media references
6. Store timeline state

## User Stories
- As a user, I want to save my project so I don't lose my work
- As a user, I want to load a previous project to continue editing
- As a user, I want to see recent projects on launch

## Acceptance Criteria
- [ ] Can save project to file
- [ ] Can load project from file
- [ ] Recent projects list
- [ ] Auto-save (optional)
- [ ] Project metadata (name, date, etc.)

## Audit Reference
- **Missing Feature:** Critical
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#61-critical-missing-features)

## Labels
`audit:enhancement` `audit:p0` `feature` `persistence`
````

### Feature: Video Export

```markdown
## Description

Implement video export functionality to output edited videos.

## Priority

Critical for MVP

## Current State

- No export functionality
- Cannot output edited videos
- Workflow incomplete

## Proposed Implementation

1. Design export dialog (format, quality, etc.)
2. Implement FFmpeg export pipeline
3. Show progress indicator
4. Handle errors gracefully
5. Support multiple formats (MP4, MOV, WebM)

## User Stories

- As a user, I want to export my edited video
- As a user, I want to choose export format and quality
- As a user, I want to see export progress

## Acceptance Criteria

- [ ] Export dialog with options
- [ ] Support MP4, MOV, WebM formats
- [ ] Quality presets (low, medium, high)
- [ ] Progress indicator
- [ ] Error handling
- [ ] Cancel export

## Audit Reference

- **Missing Feature:** Critical
- **Audit Report:** See [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md#61-critical-missing-features)

## Labels

`audit:enhancement` `audit:p0` `feature` `export`
```

---

## Bulk Issue Creation Script

Use this script to create all issues at once:

```bash
#!/bin/bash

# Create issues using GitHub CLI
gh issue create --title "Clip dragging not implemented" --body-file issue-templates/bug-020.md --label "audit:critical,audit:p0,audit:bug,timeline"

gh issue create --title "Clip resizing not implemented" --body-file issue-templates/bug-021.md --label "audit:critical,audit:p0,audit:bug,timeline"

gh issue create --title "Playback drift compensation" --body-file issue-templates/bug-014.md --label "audit:critical,audit:p0,audit:bug,playback"

gh issue create --title "No undo/redo system" --body-file issue-templates/bug-026.md --label "audit:critical,audit:p0,audit:bug,ux"

gh issue create --title "Drop zone conflicts" --body-file issue-templates/bug-005.md --label "audit:high,audit:p1,audit:bug,drag-drop"

gh issue create --title "Video sync tolerance too high" --body-file issue-templates/bug-013.md --label "audit:critical,audit:p1,audit:bug,playback"

# Add more as needed...
```

---

## Issue Tracking

Create a GitHub Project board with these columns:

1. **Backlog** - All audit issues
2. **P0 - Week 1** - Critical bugs
3. **P1 - Week 2-3** - High priority
4. **P2 - Week 4+** - Medium/Low priority
5. **In Progress** - Currently being worked on
6. **In Review** - PRs under review
7. **Done** - Completed and merged

---

**Use these templates to systematically create issues for all audit findings!**
