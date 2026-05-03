# Clypra Audit - Quick Reference Card

**Date:** May 3, 2026 | **Version:** 0.1.0

---

## 🚨 TOP 6 CRITICAL BUGS

| #   | Bug                               | Impact                 | Fix Time |
| --- | --------------------------------- | ---------------------- | -------- |
| 1   | **No clip dragging** (BUG-020)    | Can't reposition clips | 2-3 days |
| 2   | **No clip resizing** (BUG-021)    | Can't trim clips       | 2-3 days |
| 3   | **Playback drift** (BUG-014)      | Videos desync          | 2-3 days |
| 4   | **No undo/redo** (BUG-026)        | Can't fix mistakes     | 3-4 days |
| 5   | **Drop zone conflicts** (BUG-005) | Unpredictable drops    | 1-2 days |
| 6   | **Sync tolerance high** (BUG-013) | Frame inaccuracy       | 1 hour   |

**Total Fix Time:** ~2 weeks with 1 developer

---

## 📊 STATUS AT A GLANCE

```
Production Ready:    ❌ NO
MVP Ready:           ❌ NO (4-6 weeks away)
Core Features:       ⚠️  55% complete
Critical Bugs:       🔴 6 blockers
Test Coverage:       ⚠️  ~30%
```

---

## ✅ WHAT WORKS

- ✅ Media import (dialog & drag-drop)
- ✅ Media library display
- ✅ Preview rendering
- ✅ Track management
- ✅ Timeline display
- ✅ Clip creation
- ✅ Basic playback controls

---

## ❌ WHAT'S BROKEN

- ❌ Clip repositioning (can't drag)
- ❌ Clip trimming (can't resize)
- ❌ Playback sync (drifts over time)
- ❌ Undo/redo (doesn't exist)
- ❌ Save/load (no persistence)
- ❌ Export (can't output video)
- ❌ Multi-select (one clip only)
- ❌ Keyboard shortcuts (minimal)

---

## 🎯 WEEK 1 PRIORITIES

### Day 1-2: Clip Dragging

- [ ] Add drop handler to Track component
- [ ] Update Clip drag configuration
- [ ] Add visual feedback
- [ ] Test thoroughly

### Day 3-4: Clip Resizing

- [ ] Add mouse event handlers
- [ ] Implement trim logic
- [ ] Update visual feedback
- [ ] Test edge cases

### Day 5: Playback Sync

- [ ] Replace setInterval with requestAnimationFrame
- [ ] Add drift compensation
- [ ] Reduce sync tolerance
- [ ] Test for 60+ seconds

---

## 📁 KEY FILES TO MODIFY

### For Clip Manipulation

```
src/components/editor/timeline/Clip.tsx
src/components/editor/timeline/Track.tsx
src/store/timelineStore.ts
```

### For Playback Sync

```
src/store/playbackStore.ts
src/components/editor/PreviewPanel.tsx
src/hooks/usePlayback.ts
```

### For Undo/Redo

```
src/store/middleware/undoMiddleware.ts (new)
src/store/timelineStore.ts
src/hooks/useKeyboardShortcuts.ts
```

### For Drop Zones

```
src/hooks/useFileDrop.ts
src/hooks/useDropZoneManager.ts (new)
src/components/editor/MediaPanel.tsx
src/components/editor/timeline/Timeline.tsx
```

---

## 🧪 TESTING CHECKLIST

After each fix, verify:

### Clip Manipulation

- [ ] Drag clip within track
- [ ] Drag clip to different track
- [ ] Resize from left edge
- [ ] Resize from right edge
- [ ] Locked tracks prevent edits

### Playback

- [ ] Play for 60 seconds
- [ ] Check drift < 100ms
- [ ] Videos stay in sync
- [ ] Seeking is accurate

### Undo/Redo

- [ ] Undo clip operations
- [ ] Redo after undo
- [ ] Keyboard shortcuts work
- [ ] History limit enforced

---

## 📚 DOCUMENTATION

- **Full Report:** `AUDIT_FINDINGS.md` (detailed analysis)
- **Summary:** `AUDIT_SUMMARY.md` (executive overview)
- **Fix Guide:** `AUDIT_FIX_GUIDE.md` (step-by-step fixes)
- **Process:** `AUDIT_PROMPT.md` (methodology)
- **This Card:** `QUICK_REFERENCE.md` (you are here)

---

## 💡 QUICK TIPS

### Before You Start

1. Read the fix guide for your bug
2. Check existing tests for examples
3. Create a feature branch
4. Write tests first (TDD)

### While Coding

1. Test incrementally
2. Commit often
3. Follow existing patterns
4. Add comments for complex logic

### Before PR

1. Run all tests: `npm test`
2. Manual testing checklist
3. Update documentation
4. Add changelog entry

---

## 🆘 NEED HELP?

### Bug Not Clear?

→ Read full description in `AUDIT_FINDINGS.md`

### Don't Know How to Fix?

→ Check code examples in `AUDIT_FIX_GUIDE.md`

### Need Context?

→ Review related files and existing tests

### Still Stuck?

→ Ask team or create discussion issue

---

## 📈 PROGRESS TRACKING

### Week 1 Goals

- [ ] BUG-020: Clip dragging
- [ ] BUG-021: Clip resizing
- [ ] BUG-014: Playback drift
- [ ] BUG-013: Sync tolerance
- [ ] BUG-005: Drop zones

### Week 2-3 Goals

- [ ] Save/load projects
- [ ] Basic video export
- [ ] Undo/redo system
- [ ] Keyboard shortcuts
- [ ] Multi-select

### Week 4 Goals

- [ ] Error handling
- [ ] Progress indicators
- [ ] Confirmation dialogs
- [ ] Bug fixes
- [ ] Test coverage

---

## 🎯 SUCCESS METRICS

### MVP Ready When:

- ✅ All critical bugs fixed
- ✅ Can import, edit, and export
- ✅ Undo/redo works
- ✅ Save/load works
- ✅ Test coverage > 60%
- ✅ No data loss scenarios

---

## 🔗 USEFUL COMMANDS

```bash
# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with UI
npm run test:ui

# Build project
npm run build

# Run dev server
npm run dev

# Run Tauri app
npm run tauri dev
```

---

## 📞 CONTACTS

- **Audit Report:** See `AUDIT_FINDINGS.md`
- **Questions:** Create GitHub discussion
- **Bugs:** Create GitHub issue
- **PRs:** Follow contribution guidelines

---

**Keep this card handy while working on fixes!**

**Last Updated:** May 3, 2026
