/**
 * Core type definitions for Timeline Engine v1
 */

export interface Clip {
  id: string;
  trackId: string;
  startTime: number; // Timeline position in seconds
  duration: number; // Clip length in seconds
  sourceMediaPath: string; // Path to source video/audio file
  sourceStart: number; // Trim start in source media
  sourceEnd: number; // Trim end in source media
  type: "video" | "audio" | "text";

  // Visual assets (generated asynchronously)
  filmstripUrl: string | null;
  waveformPeaks: number[] | null;

  // Metadata
  name: string;
  locked: boolean;
  muted: boolean;
}

export interface Track {
  id: string;
  name: string;
  type: "video" | "audio" | "text" | "effects";
  order: number; // Vertical stacking order (higher = on top)
  height: number; // Track height in pixels
  locked: boolean; // Prevent editing
  visible: boolean; // Show/hide in preview
  muted: boolean; // Mute audio
  color: string; // Track color for visual identification
}

export interface DragState {
  clipIds: string[]; // Clips being dragged (supports multi-select)
  startX: number; // Initial pointer X
  startTimes: Map<string, number>; // Original clip start times
  currentOffset: number; // Current time offset from original
  snapTarget: SnapTarget | null;
}

export interface TrimState {
  clipId: string;
  edge: "start" | "end";
  originalStartTime: number;
  originalDuration: number;
  currentTime: number;
  snapTarget: SnapTarget | null;
}

export interface SnapTarget {
  time: number;
  type: "playhead" | "clip-start" | "clip-end" | "marker";
  sourceId?: string; // ID of clip or marker
}

export interface TimelineSnapshot {
  clips: Map<string, Clip>;
  tracks: Map<string, Track>;
  playhead: number;
  selectedClipIds: Set<string>;
  lastSelectedClipId: string | null;
}

export interface TimelineState {
  // Core timeline data
  clips: Map<string, Clip>;
  tracks: Map<string, Track>;

  // Playback and view state
  playhead: number;
  duration: number;
  pxPerSec: number;
  scrollLeft: number;
  scrollTop: number;
  isPlaying: boolean; // Playback state for canvas preview

  // Selection and interaction
  selectedClipIds: Set<string>;
  lastSelectedClipId: string | null; // Track last selected clip for Shift+click range selection
  dragState: DragState | null;
  trimState: TrimState | null;

  // Snap settings
  snapToPlayhead: boolean;
  snapToClips: boolean;
  snapToMarkers: boolean;

  // History for undo/redo
  history: TimelineSnapshot[];
  historyIndex: number;

  // Clip actions
  addClip: (clip: Clip) => void;
  updateClip: (id: string, updates: Partial<Clip>) => void;
  deleteClip: (id: string) => void;
  moveClip: (id: string, startTime: number, trackId: string) => void;
  trimClip: (id: string, startTime: number, duration: number) => void;
  splitClip: (id: string, splitTime: number) => void;

  // Track actions
  addTrack: (track: Track) => void;
  updateTrack: (id: string, updates: Partial<Track>) => void;
  deleteTrack: (id: string) => void;
  reorderTrack: (id: string, newOrder: number) => void;
  toggleTrackLock: (id: string) => void;
  toggleTrackVisibility: (id: string) => void;
  toggleTrackMute: (id: string) => void;

  // Playhead and view actions
  setPlayhead: (time: number) => void;
  setZoom: (pxPerSec: number) => void;
  setScroll: (left: number, top: number) => void;
  setIsPlaying: (isPlaying: boolean) => void; // Control playback state
  setDuration: (duration: number) => void; // Set timeline duration

  // Selection actions
  selectClip: (id: string, multi: boolean) => void;
  selectRange: (id: string) => void; // Shift+click range selection
  deselectAll: () => void;

  // Interaction state setters
  setDragState: (state: DragState | null) => void;
  setTrimState: (state: TrimState | null) => void;

  // Undo/redo actions
  undo: () => void;
  redo: () => void;
  clearHistory?: () => void; // Optional for testing

  // Serialization
  toJSON: () => TimelineJSON;
  fromJSON: (json: TimelineJSON) => void;
}

export interface TimelineJSON {
  clips: Array<Clip>;
  tracks: Array<Track>;
  playhead: number;
  duration: number;
  pxPerSec: number;
  snapToPlayhead: boolean;
  snapToClips: boolean;
  snapToMarkers: boolean;
}
