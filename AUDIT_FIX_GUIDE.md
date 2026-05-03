# Clypra Video Editor - Bug Fix Guide

This guide provides step-by-step instructions for fixing the critical bugs identified in the audit.

---

## 🚨 Priority 0: Critical Bugs (Fix First)

### BUG-020: Clip Dragging Not Implemented

**Severity:** Critical  
**Effort:** Medium (2-3 days)  
**Files:** `src/components/editor/timeline/Clip.tsx`, `src/components/editor/timeline/Track.tsx`

#### Problem

Clips have `useDrag` configured but there's no drop handler to actually move them.

#### Solution

1. **Add drop handler to Track component:**

```typescript
// In src/components/editor/timeline/Track.tsx

const [, drop] = useDrop(
  () => ({
    accept: ["MEDIA_ASSET", "CLIP"], // Add "CLIP" type
    drop: (item: DragItem | Clip, monitor: any) => {
      if (track.locked) return;

      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) return;

      const trackElement = document.querySelector(`[data-track-id="${track.id}"]`);
      if (!trackElement) return;

      const rect = (trackElement as HTMLElement).getBoundingClientRect();
      const x = clientOffset.x - rect.left;
      const startTime = Math.max(0, x / pixelsPerSecond);

      // Check if it's a media asset or existing clip
      if ("asset" in item) {
        // Existing logic for media assets
        addClipFromAsset(item.asset, track.id, startTime);
      } else {
        // Moving existing clip
        const clip = item as Clip;
        if (clip.trackId === track.id) {
          // Same track - just update position
          moveClip(clip.id, startTime);
        } else {
          // Different track - update both track and position
          updateClip(clip.id, { trackId: track.id, startTime });
        }
      }
    },
  }),
  [track.id, pixelsPerSecond, addClipFromAsset, moveClip, updateClip],
);
```

2. **Update Clip component drag configuration:**

```typescript
// In src/components/editor/timeline/Clip.tsx

const [{ isDragging }, drag] = useDrag(
  () => ({
    type: "CLIP",
    item: () => {
      // Return the full clip object
      return { ...clip };
    },
    canDrag: !locked,
    collect: (monitor: any) => ({
      isDragging: monitor.isDragging(),
    }),
    end: (item, monitor) => {
      // Optional: handle drag end
      if (!monitor.didDrop()) {
        // Drag was cancelled
        console.log("Drag cancelled");
      }
    },
  }),
  [clip, locked],
);
```

3. **Add visual feedback during drag:**

```typescript
// In src/components/editor/timeline/Track.tsx

const [{ isOver, canDrop }, drop] = useDrop(
  () => ({
    accept: ["MEDIA_ASSET", "CLIP"],
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
    drop: // ... existing drop logic
  }),
  // ... dependencies
);

// Update className
className={`relative border-b border-border transition-colors
  ${selectedTrackId === track.id ? "bg-[#1f242b]" : "hover:bg-[#1f242b]"}
  ${isOver && canDrop ? "bg-cyan-500/10 ring-1 ring-cyan-500/50" : ""}
`}
```

#### Testing

- [ ] Drag clip within same track
- [ ] Drag clip to different track
- [ ] Drag clip to locked track (should not work)
- [ ] Cancel drag (ESC key)
- [ ] Drag multiple clips (after multi-select implemented)

---

### BUG-021: Clip Resizing Not Implemented

**Severity:** Critical  
**Effort:** Medium (2-3 days)  
**Files:** `src/components/editor/timeline/Clip.tsx`

#### Problem

Resize handles exist but the `isResizing` state is not used to actually resize clips.

#### Solution

1. **Add mouse event handlers:**

```typescript
// In src/components/editor/timeline/Clip.tsx

const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
const [resizeStart, setResizeStart] = useState<{ x: number; startTime: number; duration: number } | null>(null);

const handleResizeStart = (e: React.MouseEvent, side: "left" | "right") => {
  e.stopPropagation();
  if (locked) return;

  setIsResizing(side);
  setResizeStart({
    x: e.clientX,
    startTime: clip.startTime,
    duration: clip.duration,
  });

  // Prevent text selection during resize
  document.body.style.userSelect = "none";
};

useEffect(() => {
  if (!isResizing || !resizeStart) return;

  const handleMouseMove = (e: MouseEvent) => {
    const deltaX = e.clientX - resizeStart.x;
    const deltaTime = deltaX / pixelsPerSecond;

    if (isResizing === "left") {
      // Resize from left (trim in)
      const newStartTime = Math.max(0, resizeStart.startTime + deltaTime);
      const newDuration = resizeStart.duration - (newStartTime - resizeStart.startTime);
      const newTrimIn = clip.trimIn + (newStartTime - resizeStart.startTime);

      // Clamp to valid range
      if (newDuration > 0.1 && newTrimIn >= 0 && newTrimIn < clip.trimOut) {
        updateClip(clip.id, {
          startTime: newStartTime,
          duration: newDuration,
          trimIn: newTrimIn,
        });
      }
    } else {
      // Resize from right (trim out)
      const newDuration = Math.max(0.1, resizeStart.duration + deltaTime);
      const newTrimOut = clip.trimIn + newDuration;

      // Get media asset to check max duration
      const maxDuration = mediaAsset?.duration || clip.trimOut;

      if (newTrimOut <= maxDuration) {
        updateClip(clip.id, {
          duration: newDuration,
          trimOut: newTrimOut,
        });
      }
    }
  };

  const handleMouseUp = () => {
    setIsResizing(null);
    setResizeStart(null);
    document.body.style.userSelect = "";
  };

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);

  return () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };
}, [isResizing, resizeStart, clip, pixelsPerSecond, updateClip, mediaAsset]);
```

2. **Update resize handle styling:**

```typescript
{/* Left trim handle */}
<div
  className={`absolute left-0 w-2 h-full hover:bg-cyan-300/40 cursor-ew-resize z-10
    ${isResizing === 'left' ? 'bg-cyan-300/60' : 'bg-black/20'}
  `}
  onMouseDown={(e) => handleResizeStart(e, "left")}
/>

{/* Right trim handle */}
<div
  className={`absolute right-0 w-2 h-full hover:bg-cyan-300/40 cursor-ew-resize z-10
    ${isResizing === 'right' ? 'bg-cyan-300/60' : 'bg-black/20'}
  `}
  onMouseDown={(e) => handleResizeStart(e, "right")}
/>
```

3. **Add visual feedback:**

```typescript
// Add to clip container className
className={`absolute h-full rounded-sm overflow-hidden transition-colors border
  ${selected ? "border border-accent/60" : ""}
  ${isDragging ? "opacity-50" : ""}
  ${locked ? "cursor-not-allowed" : ""}
  ${isResizing ? "ring-2 ring-cyan-500" : ""}
  ${getClipColor()}
`}
```

#### Testing

- [ ] Resize from left edge (trim in)
- [ ] Resize from right edge (trim out)
- [ ] Resize to minimum duration (0.1s)
- [ ] Resize beyond media duration (should clamp)
- [ ] Resize on locked track (should not work)
- [ ] Resize updates preview correctly

---

### BUG-014: Playback Drift Compensation

**Severity:** Critical  
**Effort:** High (2-3 days)  
**Files:** `src/store/playbackStore.ts`, `src/hooks/usePlayback.ts`

#### Problem

Playback uses `setInterval` with fixed 16ms, causing drift over time.

#### Solution

1. **Replace interval with drift-compensated loop:**

```typescript
// In src/store/playbackStore.ts

interface PlaybackStore {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  frameRate: number;
  animationFrameId: number | null; // Changed from intervalId
  playStartTime: number | null; // Track when playback started
  playStartOffset: number; // Track where playback started in timeline
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setDuration: (duration: number) => void;
  setFrameRate: (fps: number) => void;
}

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  frameRate: 30,
  animationFrameId: null,
  playStartTime: null,
  playStartOffset: 0,

  play: () => {
    const state = get();
    if (state.isPlaying) return;

    const startTime = performance.now();
    const startOffset = state.currentTime;

    set({
      isPlaying: true,
      playStartTime: startTime,
      playStartOffset: startOffset,
    });

    const tick = () => {
      const current = get();
      if (!current.isPlaying) return;

      // Calculate elapsed time since play started
      const now = performance.now();
      const elapsed = (now - (current.playStartTime || now)) / 1000;
      const newTime = current.playStartOffset + elapsed;

      if (newTime >= current.duration) {
        get().stop();
      } else {
        set({ currentTime: newTime });
        const frameId = requestAnimationFrame(tick);
        set({ animationFrameId: frameId });
      }
    };

    const frameId = requestAnimationFrame(tick);
    set({ animationFrameId: frameId });
  },

  pause: () => {
    const state = get();
    if (state.animationFrameId !== null) {
      cancelAnimationFrame(state.animationFrameId);
    }
    set({
      isPlaying: false,
      animationFrameId: null,
      playStartTime: null,
    });
  },

  stop: () => {
    const state = get();
    if (state.animationFrameId !== null) {
      cancelAnimationFrame(state.animationFrameId);
    }
    set({
      isPlaying: false,
      currentTime: 0,
      animationFrameId: null,
      playStartTime: null,
      playStartOffset: 0,
    });
  },

  seek: (time) => {
    const state = get();
    if (state.animationFrameId !== null) {
      cancelAnimationFrame(state.animationFrameId);
    }
    const clamped = Math.max(0, Math.min(time, state.duration));
    set({
      currentTime: clamped,
      isPlaying: false,
      animationFrameId: null,
      playStartTime: null,
      playStartOffset: clamped,
    });
  },

  setDuration: (duration) => {
    set({ duration });
  },

  setFrameRate: (fps) => {
    set({ frameRate: fps });
  },
}));
```

#### Testing

- [ ] Play for 60 seconds, check drift < 100ms
- [ ] Pause and resume multiple times
- [ ] Seek during playback
- [ ] Play to end, verify stops correctly
- [ ] Multiple videos stay in sync

---

### BUG-013: Video Sync Tolerance Too High

**Severity:** Critical  
**Effort:** Low (1 hour)  
**Files:** `src/components/editor/PreviewPanel.tsx`

#### Problem

Sync tolerance is 0.05s (50ms), should be < 1 frame.

#### Solution

```typescript
// In src/components/editor/PreviewPanel.tsx

useEffect(() => {
  Object.values(videoRefs.current).forEach((video) => {
    if (!video) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;

    const layer = scene.layers.find((l) => l.mediaId === video.dataset.mediaId && l.clipId === video.dataset.clipId);
    if (!layer) return;

    const t = Math.max(0, Math.min(layer.sourceTime, Math.max(0, video.duration - 0.01)));

    // Calculate frame-accurate tolerance
    const frameDuration = 1 / Math.max(1, frameRate);
    const syncTolerance = frameDuration / 2; // Half a frame

    // Only seek if difference is significant
    if (Math.abs(video.currentTime - t) > syncTolerance) {
      video.currentTime = t;
    }

    video.muted = isMuted || volume === 0;
    video.volume = Math.max(0, Math.min(1, volume / 100));

    if (isPlaying) {
      try {
        const p = video.play();
        if (p && typeof p.catch === "function") void p.catch(() => undefined);
      } catch {
        // noop in test/jsdom environments
      }
    } else {
      try {
        video.pause();
      } catch {
        // noop
      }
    }
  });
}, [scene, isPlaying, isMuted, volume, frameRate]); // Add frameRate dependency
```

#### Testing

- [ ] Videos stay in sync during playback
- [ ] No visible jitter or stuttering
- [ ] Sync maintained after seeking
- [ ] Works at different frame rates (24, 30, 60fps)

---

### BUG-026: No Undo/Redo System

**Severity:** Critical  
**Effort:** High (3-4 days)  
**Files:** `src/store/timelineStore.ts`, `src/store/projectStore.ts`, new middleware

#### Problem

No way to undo/redo actions.

#### Solution

1. **Create undo middleware:**

```typescript
// Create new file: src/store/middleware/undoMiddleware.ts

import { StateCreator, StoreMutatorIdentifier } from "zustand";

interface UndoState {
  past: any[];
  future: any[];
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

type UndoMiddleware = <T extends object, Mps extends [StoreMutatorIdentifier, unknown][] = [], Mcs extends [StoreMutatorIdentifier, unknown][] = []>(config: StateCreator<T, Mps, Mcs>, options?: { limit?: number; exclude?: (keyof T)[] }) => StateCreator<T & UndoState, Mps, Mcs>;

export const undoMiddleware: UndoMiddleware =
  (config, options = {}) =>
  (set, get, api) => {
    const { limit = 50, exclude = [] } = options;

    const undoState: UndoState = {
      past: [],
      future: [],

      undo: () => {
        const { past, future } = get() as any;
        if (past.length === 0) return;

        const previous = past[past.length - 1];
        const current = getSnapshot(get(), exclude);

        set({
          ...previous,
          past: past.slice(0, -1),
          future: [current, ...future].slice(0, limit),
        } as any);
      },

      redo: () => {
        const { past, future } = get() as any;
        if (future.length === 0) return;

        const next = future[0];
        const current = getSnapshot(get(), exclude);

        set({
          ...next,
          past: [...past, current].slice(-limit),
          future: future.slice(1),
        } as any);
      },

      canUndo: () => {
        const { past } = get() as any;
        return past.length > 0;
      },

      canRedo: () => {
        const { future } = get() as any;
        return future.length > 0;
      },

      clearHistory: () => {
        set({ past: [], future: [] } as any);
      },
    };

    const getSnapshot = (state: any, exclude: (keyof any)[]) => {
      const snapshot: any = {};
      for (const key in state) {
        if (!exclude.includes(key) && key !== "past" && key !== "future") {
          snapshot[key] = state[key];
        }
      }
      return snapshot;
    };

    const wrappedSet: typeof set = (partial, replace) => {
      const current = getSnapshot(get(), exclude);
      const { past } = get() as any;

      set(partial, replace);

      // Add current state to history
      set({
        past: [...past, current].slice(-limit),
        future: [], // Clear future on new action
      } as any);
    };

    return {
      ...config(wrappedSet, get, api),
      ...undoState,
    };
  };
```

2. **Apply to timeline store:**

```typescript
// In src/store/timelineStore.ts

import { undoMiddleware } from "./middleware/undoMiddleware";

export const useTimelineStore = create<TimelineStore>()(
  undoMiddleware(
    (set, get) => ({
      // ... existing store implementation
    }),
    {
      limit: 50,
      exclude: ["scrollLeft", "pixelsPerSecond"], // Don't track these in history
    },
  ),
);
```

3. **Add keyboard shortcuts:**

```typescript
// In src/hooks/useKeyboardShortcuts.ts

import { useEffect } from "react";
import { useTimelineStore } from "../store/timelineStore";

export const useKeyboardShortcuts = () => {
  const { undo, redo, canUndo, canRedo } = useTimelineStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) {
          undo();
        }
      }

      // Redo: Cmd+Shift+Z (Mac) or Ctrl+Y (Windows/Linux)
      if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") || (e.ctrlKey && e.key === "y")) {
        e.preventDefault();
        if (canRedo()) {
          redo();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);
};
```

4. **Add UI buttons:**

```typescript
// In src/components/editor/timeline/TimelineToolbar.tsx

import { Undo, Redo } from 'lucide-react';
import { useTimelineStore } from '../../../store/timelineStore';

// Add to toolbar:
const { undo, redo, canUndo, canRedo } = useTimelineStore();

<Button
  variant="ghost"
  size="icon-sm"
  onClick={undo}
  disabled={!canUndo()}
  title="Undo (Cmd+Z)"
>
  <Undo className="w-4 h-4" />
</Button>

<Button
  variant="ghost"
  size="icon-sm"
  onClick={redo}
  disabled={!canRedo()}
  title="Redo (Cmd+Shift+Z)"
>
  <Redo className="w-4 h-4" />
</Button>
```

#### Testing

- [ ] Undo clip creation
- [ ] Undo clip deletion
- [ ] Undo clip move
- [ ] Undo clip resize
- [ ] Redo after undo
- [ ] Undo/redo with keyboard shortcuts
- [ ] History limit works (50 actions)
- [ ] New action clears redo history

---

### BUG-005: Drop Zone Conflicts

**Severity:** High  
**Effort:** Medium (1-2 days)  
**Files:** `src/hooks/useFileDrop.ts`, `src/components/editor/MediaPanel.tsx`, `src/components/editor/timeline/Timeline.tsx`

#### Problem

Both MediaPanel and Timeline listen to the same Tauri drag events, causing conflicts.

#### Solution

1. **Create drop zone manager:**

```typescript
// Create new file: src/hooks/useDropZoneManager.ts

import { create } from "zustand";

interface DropZoneState {
  activeZone: string | null;
  setActiveZone: (zone: string | null) => void;
  isZoneActive: (zone: string) => boolean;
}

export const useDropZoneManager = create<DropZoneState>((set, get) => ({
  activeZone: null,

  setActiveZone: (zone) => {
    set({ activeZone: zone });
  },

  isZoneActive: (zone) => {
    return get().activeZone === zone;
  },
}));
```

2. **Update useFileDrop hook:**

```typescript
// In src/hooks/useFileDrop.ts

import { useDropZoneManager } from "./useDropZoneManager";

export const useFileDrop = ({
  onDrop,
  enabled = true,
  zoneId, // Add zone identifier
}: UseFileDropOptions & { zoneId: string }) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isProcessingRef = useRef(false);
  const { setActiveZone, isZoneActive } = useDropZoneManager();

  useEffect(() => {
    if (!enabled) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const unlistenHover = await listen<{ position: { x: number; y: number } }>("tauri://drag-over", (event) => {
          if (!containerRef.current) return;

          const rect = containerRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;
          const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

          if (isOver) {
            setActiveZone(zoneId);
            setIsDraggingOver(true);
          } else if (isZoneActive(zoneId)) {
            setActiveZone(null);
            setIsDraggingOver(false);
          }
        });

        const unlistenDrop = await listen<{
          paths: string[];
          position: { x: number; y: number };
        }>("tauri://drag-drop", async (event) => {
          // Only process if this is the active zone
          if (!isZoneActive(zoneId) || isProcessingRef.current) {
            return;
          }

          setIsDraggingOver(false);
          setActiveZone(null);

          isProcessingRef.current = true;
          try {
            await onDrop(event.payload.paths);
          } finally {
            isProcessingRef.current = false;
          }
        });

        const unlistenCancel = await listen("tauri://drag-cancelled", () => {
          setIsDraggingOver(false);
          setActiveZone(null);
        });

        unlisten = () => {
          unlistenHover();
          unlistenDrop();
          unlistenCancel();
        };
      } catch (error) {
        console.error("[useFileDrop] Failed to setup file drop listener:", error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
      if (isZoneActive(zoneId)) {
        setActiveZone(null);
      }
    };
  }, [enabled, onDrop, zoneId, isZoneActive, setActiveZone]);

  return { containerRef, isDraggingOver };
};
```

3. **Update MediaPanel:**

```typescript
// In src/components/editor/MediaPanel.tsx

const { containerRef, isDraggingOver } = useFileDrop({
  onDrop: handleTauriFileDrop,
  enabled: true,
  zoneId: "media-panel", // Add unique ID
});
```

4. **Update Timeline:**

```typescript
// In src/components/editor/timeline/Timeline.tsx

// Remove the manual event listeners and use the hook instead
const { containerRef: timelineRef, isDraggingOver } = useFileDrop({
  onDrop: handleTauriFileDrop,
  enabled: true,
  zoneId: 'timeline', // Add unique ID
});

// Update ref usage
<div ref={timelineRef} ...>
```

#### Testing

- [ ] Drop on media panel only affects media panel
- [ ] Drop on timeline only affects timeline
- [ ] Visual feedback shows correct zone
- [ ] No double processing of drops
- [ ] Drag between zones works correctly

---

## 📋 Testing Checklist

After implementing fixes, run through this checklist:

### Clip Manipulation

- [ ] Can drag clip within track
- [ ] Can drag clip to different track
- [ ] Can resize clip from left
- [ ] Can resize clip from right
- [ ] Locked tracks prevent manipulation
- [ ] Undo/redo works for all operations

### Playback

- [ ] Play/pause works
- [ ] No drift after 60 seconds
- [ ] Videos stay in sync
- [ ] Seeking is accurate
- [ ] Frame stepping works

### Drag & Drop

- [ ] Drop on media panel adds to library
- [ ] Drop on timeline creates clip
- [ ] No conflicts between zones
- [ ] Visual feedback correct

### Undo/Redo

- [ ] Undo clip creation
- [ ] Undo clip deletion
- [ ] Undo clip move
- [ ] Undo clip resize
- [ ] Redo works
- [ ] Keyboard shortcuts work
- [ ] History limit enforced

---

## 🔄 After Fixes

1. **Run all tests:** `npm test`
2. **Manual testing:** Go through checklist above
3. **Performance testing:** Test with 50+ clips
4. **Update documentation:** Document new features
5. **Create release notes:** List what was fixed

---

## 📞 Need Help?

If you encounter issues while implementing these fixes:

1. Check the full audit report for context
2. Review existing tests for examples
3. Look at similar implementations in the codebase
4. Test incrementally - don't implement everything at once

---

**Good luck! These fixes will significantly improve the editor's usability.**
