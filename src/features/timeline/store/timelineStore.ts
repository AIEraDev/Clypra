/**
 * Zustand State Store for Timeline Engine v1
 */

import { create } from "zustand";
import type { Clip, Track, DragState, TrimState, TimelineState, TimelineSnapshot, TimelineJSON } from "../types/core";
import { TimelineError, ErrorCodes } from "../types/errors";
import { validateClipDuration, validateClipStartTime, validateClipEndTime, validateClipExists, validateTrackExists, validateTrackTypeCompatibility, validateZoomLevel } from "../utils/validation";
import { clamp } from "../utils/math";
import { UndoManager } from "../utils/UndoManager";

// Create a new UndoManager instance for each store instance
let undoManager: UndoManager;

/**
 * Creates a snapshot of the current timeline state for undo/redo
 */
function createSnapshot(state: TimelineState): TimelineSnapshot {
  return {
    clips: new Map(state.clips),
    tracks: new Map(state.tracks),
    playhead: state.playhead,
    selectedClipIds: new Set(state.selectedClipIds),
    lastSelectedClipId: state.lastSelectedClipId,
  };
}

/**
 * Restores a snapshot to the timeline state
 */
function restoreSnapshot(snapshot: TimelineSnapshot, set: (partial: Partial<TimelineState>) => void): void {
  set({
    clips: new Map(snapshot.clips),
    tracks: new Map(snapshot.tracks),
    playhead: snapshot.playhead,
    selectedClipIds: new Set(snapshot.selectedClipIds),
    lastSelectedClipId: snapshot.lastSelectedClipId,
  });
}

/**
 * Timeline store using Zustand
 * Manages all timeline state including clips, tracks, playhead, selection, and interactions
 */
export const useTimelineStore = create<TimelineState>((set, get) => {
  // Initialize UndoManager for this store instance
  undoManager = new UndoManager();

  // Capture initial state
  const initialState: TimelineSnapshot = {
    clips: new Map<string, Clip>(),
    tracks: new Map<string, Track>(),
    playhead: 0,
    selectedClipIds: new Set<string>(),
    lastSelectedClipId: null,
  };
  undoManager.pushState(initialState);

  return {
    // Core timeline data
    clips: new Map<string, Clip>(),
    tracks: new Map<string, Track>(),

    // Playback and view state
    playhead: 0,
    duration: 300, // Default 5 minutes
    pxPerSec: 48, // Default zoom level
    scrollLeft: 0,
    scrollTop: 0,
    isPlaying: false, // Default to not playing

    // Selection and interaction
    selectedClipIds: new Set<string>(),
    lastSelectedClipId: null,
    dragState: null,
    trimState: null,

    snapToPlayhead: true,
    snapToClips: true,
    snapToMarkers: true,

    // History for undo/redo
    history: [],
    historyIndex: -1,

    // Clip management actions
    addClip: (clip: Clip) => {
      try {
        const state = get();

        // Validate track exists
        const track = state.tracks.get(clip.trackId);
        validateTrackExists(track, clip.trackId);

        // Validate track type compatibility
        validateTrackTypeCompatibility(clip.type, track.type);

        // Validate clip constraints
        validateClipStartTime(clip.startTime);
        validateClipDuration(clip.duration);
        validateClipEndTime(clip.startTime + clip.duration, state.duration);

        // Add clip to store
        set((state) => ({
          clips: new Map(state.clips).set(clip.id, clip),
        }));

        // Capture snapshot after modification
        undoManager.pushState(createSnapshot(get()));
      } catch (error) {
        console.error("Failed to add clip:", error, { clipId: clip.id, trackId: clip.trackId });

        // State remains unchanged, operation is aborted
        throw error; // Re-throw for caller to handle
      }
    },

    updateClip: (id: string, updates: Partial<Clip>) => {
      try {
        const state = get();
        const clip = state.clips.get(id);
        validateClipExists(clip, id);

        if (clip.locked) {
          const error = new TimelineError(`Cannot update locked clip ${id}`, ErrorCodes.INVALID_OPERATION, true);
          console.warn(error.message);
          throw error;
        }

        // Create updated clip
        const updatedClip = { ...clip, ...updates };

        // Validate if duration or startTime changed
        if (updates.duration !== undefined) {
          validateClipDuration(updatedClip.duration);
        }
        if (updates.startTime !== undefined) {
          validateClipStartTime(updatedClip.startTime);
        }
        if (updates.duration !== undefined || updates.startTime !== undefined) {
          validateClipEndTime(updatedClip.startTime + updatedClip.duration, state.duration);
        }

        // Update clip in store
        set((state) => ({
          clips: new Map(state.clips).set(id, updatedClip),
        }));

        // Capture snapshot after modification
        undoManager.pushState(createSnapshot(get()));
      } catch (error) {
        console.error("Failed to update clip:", error, { clipId: id, updates });

        throw error;
      }
    },

    deleteClip: (id: string) => {
      try {
        const state = get();
        const clip = state.clips.get(id);
        validateClipExists(clip, id);

        if (clip.locked) {
          const error = new TimelineError(`Cannot delete locked clip ${id}`, ErrorCodes.INVALID_OPERATION, true);
          console.warn(error.message);
          throw error;
        }

        // Remove clip from clips map
        const newClips = new Map(state.clips);
        newClips.delete(id);

        // Remove from selection if selected
        const newSelection = new Set(state.selectedClipIds);
        newSelection.delete(id);

        set({
          clips: newClips,
          selectedClipIds: newSelection,
        });

        // Capture snapshot after modification
        undoManager.pushState(createSnapshot(get()));
      } catch (error) {
        console.error("Failed to delete clip:", error, { clipId: id });

        throw error;
      }
    },

    moveClip: (id: string, startTime: number, trackId: string) => {
      try {
        const state = get();
        const clip = state.clips.get(id);
        validateClipExists(clip, id);

        if (clip.locked) {
          const error = new TimelineError(`Cannot move locked clip ${id}`, ErrorCodes.INVALID_OPERATION, true);
          console.warn(error.message);
          throw error;
        }

        // Validate track exists
        const track = state.tracks.get(trackId);
        validateTrackExists(track, trackId);

        // Validate track type compatibility
        validateTrackTypeCompatibility(clip.type, track.type);

        // Clamp start time to boundaries
        const clampedStartTime = Math.max(0, startTime);
        const endTime = clampedStartTime + clip.duration;

        // Validate end time doesn't exceed timeline duration
        validateClipEndTime(endTime, state.duration);

        // Update clip position
        set((state) => ({
          clips: new Map(state.clips).set(id, {
            ...clip,
            startTime: clampedStartTime,
            trackId,
          }),
        }));

        // Capture snapshot after modification
        undoManager.pushState(createSnapshot(get()));
      } catch (error) {
        console.error("Failed to move clip:", error, { clipId: id, startTime, trackId });

        throw error;
      }
    },

    trimClip: (id: string, startTime: number, duration: number) => {
      try {
        const state = get();
        const clip = state.clips.get(id);
        validateClipExists(clip, id);

        if (clip.locked) {
          const error = new TimelineError(`Cannot trim locked clip ${id}`, ErrorCodes.INVALID_OPERATION, true);
          console.warn(error.message);
          throw error;
        }

        // Validate trim constraints
        validateClipStartTime(startTime);
        validateClipDuration(duration);
        validateClipEndTime(startTime + duration, state.duration);

        // Calculate source trim adjustments
        const startDelta = startTime - clip.startTime;
        const newSourceStart = clip.sourceStart + startDelta;
        const newSourceEnd = newSourceStart + duration;

        // Update clip with new trim
        set((state) => ({
          clips: new Map(state.clips).set(id, {
            ...clip,
            startTime,
            duration,
            sourceStart: newSourceStart,
            sourceEnd: newSourceEnd,
          }),
        }));

        // Capture snapshot after modification
        undoManager.pushState(createSnapshot(get()));
      } catch (error) {
        console.error("Failed to trim clip:", error, { clipId: id, startTime, duration });

        throw error;
      }
    },

    splitClip: (id: string, splitTime: number) => {
      try {
        const state = get();
        const clip = state.clips.get(id);
        validateClipExists(clip, id);

        if (clip.locked) {
          const error = new TimelineError(`Cannot split locked clip ${id}`, ErrorCodes.INVALID_OPERATION, true);
          console.warn(error.message);
          throw error;
        }

        if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) {
          const error = new TimelineError(`Split time ${splitTime.toFixed(2)}s is outside clip boundaries (${clip.startTime.toFixed(2)}s - ${(clip.startTime + clip.duration).toFixed(2)}s)`, ErrorCodes.INVALID_OPERATION, true);
          console.warn(error.message);
          throw error;
        }

        // Calculate durations for both clips
        const firstDuration = splitTime - clip.startTime;
        const secondDuration = clip.duration - firstDuration;

        // Validate minimum durations
        validateClipDuration(firstDuration);
        validateClipDuration(secondDuration);

        // Create first clip (original start to split point)
        const firstClip: Clip = {
          ...clip,
          id: `${clip.id}_split1_${Date.now()}`,
          duration: firstDuration,
          sourceEnd: clip.sourceStart + firstDuration,
        };

        // Create second clip (split point to original end)
        const secondClip: Clip = {
          ...clip,
          id: `${clip.id}_split2_${Date.now()}`,
          startTime: splitTime,
          duration: secondDuration,
          sourceStart: clip.sourceStart + firstDuration,
          filmstripUrl: null, // Will need to be regenerated
          waveformPeaks: null, // Will need to be regenerated
        };

        // Remove original clip and add both new clips
        const newClips = new Map(state.clips);
        newClips.delete(id);
        newClips.set(firstClip.id, firstClip);
        newClips.set(secondClip.id, secondClip);

        // Update selection to include both new clips if original was selected
        const newSelection = new Set(state.selectedClipIds);
        if (newSelection.has(id)) {
          newSelection.delete(id);
          newSelection.add(firstClip.id);
          newSelection.add(secondClip.id);
        }

        set({
          clips: newClips,
          selectedClipIds: newSelection,
        });

        // Capture snapshot after modification
        undoManager.pushState(createSnapshot(get()));
      } catch (error) {
        console.error("Failed to split clip:", error, { clipId: id, splitTime });

        throw error;
      }
    },

    // Playhead and view state actions
    setPlayhead: (time: number) => {
      const state = get();
      // Clamp playhead to timeline boundaries
      const clampedTime = clamp(time, 0, state.duration);

      set({ playhead: clampedTime });

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    setZoom: (pxPerSec: number) => {
      // Validate and clamp zoom level
      const validatedZoom = validateZoomLevel(pxPerSec);

      set({ pxPerSec: validatedZoom });
    },

    setScroll: (left: number, top: number) => {
      // Clamp scroll values to non-negative
      const clampedLeft = Math.max(0, left);
      const clampedTop = Math.max(0, top);

      set({
        scrollLeft: clampedLeft,
        scrollTop: clampedTop,
      });
    },

    setIsPlaying: (isPlaying: boolean) => {
      set({ isPlaying });
    },

    setDuration: (duration: number) => {
      // Clamp duration to positive values
      const clampedDuration = Math.max(0, duration);
      set({ duration: clampedDuration });
    },

    // Track management actions
    addTrack: (track: Track) => {
      set((state) => ({
        tracks: new Map(state.tracks).set(track.id, track),
      }));

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    updateTrack: (id: string, updates: Partial<Track>) => {
      const state = get();
      const track = state.tracks.get(id);
      validateTrackExists(track, id);

      const updatedTrack = { ...track, ...updates };

      set((state) => ({
        tracks: new Map(state.tracks).set(id, updatedTrack),
      }));

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    deleteTrack: (id: string) => {
      const state = get();
      const track = state.tracks.get(id);
      validateTrackExists(track, id);

      // Remove all clips on this track
      const newClips = new Map(state.clips);
      const clipsToRemove: string[] = [];

      for (const [clipId, clip] of newClips) {
        if (clip.trackId === id) {
          clipsToRemove.push(clipId);
        }
      }

      clipsToRemove.forEach((clipId) => newClips.delete(clipId));

      // Remove track
      const newTracks = new Map(state.tracks);
      newTracks.delete(id);

      // Remove deleted clips from selection
      const newSelection = new Set(state.selectedClipIds);
      clipsToRemove.forEach((clipId) => newSelection.delete(clipId));

      set({
        tracks: newTracks,
        clips: newClips,
        selectedClipIds: newSelection,
      });

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    reorderTrack: (id: string, newOrder: number) => {
      const state = get();
      const track = state.tracks.get(id);
      validateTrackExists(track, id);

      const updatedTrack = { ...track, order: newOrder };

      set((state) => ({
        tracks: new Map(state.tracks).set(id, updatedTrack),
      }));

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    toggleTrackLock: (id: string) => {
      const state = get();
      const track = state.tracks.get(id);
      validateTrackExists(track, id);

      const updatedTrack = { ...track, locked: !track.locked };

      // Also lock/unlock all clips on this track
      const newClips = new Map(state.clips);
      for (const [clipId, clip] of newClips) {
        if (clip.trackId === id) {
          newClips.set(clipId, { ...clip, locked: updatedTrack.locked });
        }
      }

      set({
        tracks: new Map(state.tracks).set(id, updatedTrack),
        clips: newClips,
      });

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    toggleTrackVisibility: (id: string) => {
      const state = get();
      const track = state.tracks.get(id);
      validateTrackExists(track, id);

      const updatedTrack = { ...track, visible: !track.visible };

      set((state) => ({
        tracks: new Map(state.tracks).set(id, updatedTrack),
      }));

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    toggleTrackMute: (id: string) => {
      const state = get();
      const track = state.tracks.get(id);
      validateTrackExists(track, id);

      const updatedTrack = { ...track, muted: !track.muted };

      // Also mute/unmute all clips on this track
      const newClips = new Map(state.clips);
      for (const [clipId, clip] of newClips) {
        if (clip.trackId === id) {
          newClips.set(clipId, { ...clip, muted: updatedTrack.muted });
        }
      }

      set({
        tracks: new Map(state.tracks).set(id, updatedTrack),
        clips: newClips,
      });

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    // Selection actions
    selectClip: (id: string, multi: boolean) => {
      const state = get();
      const clip = state.clips.get(id);

      if (!clip) {
        console.warn(`Clip ${id} not found`);
        return;
      }

      if (multi) {
        const newSelection = new Set(state.selectedClipIds);
        if (newSelection.has(id)) {
          newSelection.delete(id);
          // If we're deselecting the last selected clip, clear lastSelectedClipId
          set({
            selectedClipIds: newSelection,
            lastSelectedClipId: newSelection.size > 0 ? state.lastSelectedClipId : null,
          });
        } else {
          newSelection.add(id);
          set({
            selectedClipIds: newSelection,
            lastSelectedClipId: id,
          });
        }
      } else {
        set({
          selectedClipIds: new Set([id]),
          lastSelectedClipId: id,
        });
      }

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    selectRange: (id: string) => {
      const state = get();
      const clip = state.clips.get(id);

      if (!clip) {
        console.warn(`Clip ${id} not found`);
        return;
      }

      // If no last selected clip, just select this one
      if (!state.lastSelectedClipId) {
        set({
          selectedClipIds: new Set([id]),
          lastSelectedClipId: id,
        });
        undoManager.pushState(createSnapshot(get()));
        return;
      }

      const lastClip = state.clips.get(state.lastSelectedClipId);
      if (!lastClip) {
        // Last selected clip no longer exists, just select this one
        set({
          selectedClipIds: new Set([id]),
          lastSelectedClipId: id,
        });
        undoManager.pushState(createSnapshot(get()));
        return;
      }

      // Find all clips on the same track between the two clips
      const allClips = Array.from(state.clips.values());
      const trackClips = allClips.filter((c) => c.trackId === clip.trackId);

      // Sort clips by start time
      trackClips.sort((a, b) => a.startTime - b.startTime);

      // Find indices of the two clips
      const clickedIndex = trackClips.findIndex((c) => c.id === id);
      const lastIndex = trackClips.findIndex((c) => c.id === state.lastSelectedClipId);

      if (clickedIndex === -1 || lastIndex === -1) {
        // One of the clips not found in track, just select clicked clip
        set({
          selectedClipIds: new Set([id]),
          lastSelectedClipId: id,
        });
        undoManager.pushState(createSnapshot(get()));
        return;
      }

      // Select all clips between the two indices (inclusive)
      const startIndex = Math.min(clickedIndex, lastIndex);
      const endIndex = Math.max(clickedIndex, lastIndex);

      const newSelection = new Set(state.selectedClipIds);
      for (let i = startIndex; i <= endIndex; i++) {
        newSelection.add(trackClips[i].id);
      }

      set({
        selectedClipIds: newSelection,
        lastSelectedClipId: id,
      });

      // Capture snapshot after modification
      undoManager.pushState(createSnapshot(get()));
    },

    deselectAll: () => {
      set({
        selectedClipIds: new Set(),
        lastSelectedClipId: null,
      });
    },

    // Interaction state setters
    setDragState: (state: DragState | null) => {
      set({ dragState: state });
    },

    setTrimState: (state: TrimState | null) => {
      set({ trimState: state });
    },

    // Undo/redo actions
    undo: () => {
      const snapshot = undoManager.undo();
      if (snapshot) {
        restoreSnapshot(snapshot, set);
      }
    },

    redo: () => {
      const snapshot = undoManager.redo();
      if (snapshot) {
        restoreSnapshot(snapshot, set);
      }
    },

    // Clear undo/redo history (for testing)
    clearHistory: () => {
      undoManager.clear();
      // Re-initialize with current state
      undoManager.pushState(createSnapshot(get()));
    },

    // Serialization
    toJSON: (): TimelineJSON => {
      const state = get();
      return {
        clips: Array.from(state.clips.values()),
        tracks: Array.from(state.tracks.values()),
        playhead: state.playhead,
        duration: state.duration,
        pxPerSec: state.pxPerSec,
        snapToPlayhead: state.snapToPlayhead,
        snapToClips: state.snapToClips,
        snapToMarkers: state.snapToMarkers,
      };
    },

    fromJSON: (json: TimelineJSON) => {
      try {
        // Validate JSON structure
        if (!json || typeof json !== "object") {
          throw new TimelineError("Invalid JSON: Expected an object", ErrorCodes.PARSE_FAILED, false);
        }

        if (!Array.isArray(json.clips)) {
          throw new TimelineError("Invalid JSON: clips must be an array", ErrorCodes.PARSE_FAILED, false);
        }

        if (!Array.isArray(json.tracks)) {
          throw new TimelineError("Invalid JSON: tracks must be an array", ErrorCodes.PARSE_FAILED, false);
        }

        if (typeof json.playhead !== "number" || json.playhead < 0) {
          throw new TimelineError("Invalid JSON: playhead must be a non-negative number", ErrorCodes.PARSE_FAILED, false);
        }

        // Handle missing optional fields with defaults
        const duration = typeof json.duration === "number" && json.duration > 0 ? json.duration : 300;
        const pxPerSec = typeof json.pxPerSec === "number" ? validateZoomLevel(json.pxPerSec) : 48;
        const snapToPlayhead = typeof json.snapToPlayhead === "boolean" ? json.snapToPlayhead : true;
        const snapToClips = typeof json.snapToClips === "boolean" ? json.snapToClips : true;
        const snapToMarkers = typeof json.snapToMarkers === "boolean" ? json.snapToMarkers : true;

        // Validate clips
        for (const clip of json.clips) {
          if (!clip.id || typeof clip.id !== "string") {
            throw new TimelineError("Invalid JSON: Each clip must have a string id", ErrorCodes.PARSE_FAILED, false);
          }
          if (!clip.trackId || typeof clip.trackId !== "string") {
            throw new TimelineError(`Invalid JSON: Clip ${clip.id} must have a string trackId`, ErrorCodes.PARSE_FAILED, false);
          }
          if (typeof clip.startTime !== "number" || clip.startTime < 0) {
            throw new TimelineError(`Invalid JSON: Clip ${clip.id} must have a non-negative startTime`, ErrorCodes.PARSE_FAILED, false);
          }
          if (typeof clip.duration !== "number" || clip.duration <= 0) {
            throw new TimelineError(`Invalid JSON: Clip ${clip.id} must have a positive duration`, ErrorCodes.PARSE_FAILED, false);
          }
          if (!clip.sourceMediaPath || typeof clip.sourceMediaPath !== "string") {
            throw new TimelineError(`Invalid JSON: Clip ${clip.id} must have a string sourceMediaPath`, ErrorCodes.PARSE_FAILED, false);
          }
          if (!clip.type || !["video", "audio", "text"].includes(clip.type)) {
            throw new TimelineError(`Invalid JSON: Clip ${clip.id} must have a valid type (video, audio, or text)`, ErrorCodes.PARSE_FAILED, false);
          }
        }

        // Validate tracks
        for (const track of json.tracks) {
          if (!track.id || typeof track.id !== "string") {
            throw new TimelineError("Invalid JSON: Each track must have a string id", ErrorCodes.PARSE_FAILED, false);
          }
          if (!track.name || typeof track.name !== "string") {
            throw new TimelineError(`Invalid JSON: Track ${track.id} must have a string name`, ErrorCodes.PARSE_FAILED, false);
          }
          if (!track.type || !["video", "audio", "text", "effects"].includes(track.type)) {
            throw new TimelineError(`Invalid JSON: Track ${track.id} must have a valid type (video, audio, text, or effects)`, ErrorCodes.PARSE_FAILED, false);
          }
          if (typeof track.order !== "number") {
            throw new TimelineError(`Invalid JSON: Track ${track.id} must have a number order`, ErrorCodes.PARSE_FAILED, false);
          }
        }

        // Set state with validated data
        set({
          clips: new Map(json.clips.map((clip) => [clip.id, clip])),
          tracks: new Map(json.tracks.map((track) => [track.id, track])),
          playhead: json.playhead,
          duration,
          pxPerSec,
          snapToPlayhead,
          snapToClips,
          snapToMarkers,
          // Reset interaction state
          selectedClipIds: new Set(),
          lastSelectedClipId: null,
          dragState: null,
          trimState: null,
        });

        // Clear and reinitialize undo history with the new state
        undoManager.clear();
        undoManager.pushState(createSnapshot(get()));
      } catch (error) {
        console.error("Failed to parse timeline JSON:", error);

        // State remains unchanged if parsing fails
        throw error;
      }
    },
  };
});
