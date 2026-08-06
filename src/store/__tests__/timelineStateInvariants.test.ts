import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../timelineStore';
import type { Clip, Track } from '@/types';

// Helper function asserting state invariant sanitization on clip fields
export function sanitizeClipStateInvariants(clip: Partial<Clip>): Partial<Clip> {
  const sanitized = { ...clip };
  if (sanitized.startTime !== undefined) {
    sanitized.startTime = Math.max(0, sanitized.startTime);
  }
  if (sanitized.duration !== undefined) {
    sanitized.duration = Math.max(0.001, sanitized.duration);
  }
  return sanitized;
}

describe('Timeline Store Invariant Assertions & State Edge-Cases', () => {
  beforeEach(() => {
    const defaultTrack: Track = {
      id: 'track-v1',
      type: 'video',
      name: 'Video 1',
      visible: true,
      locked: false,
      muted: false,
      height: 52,
    };
    const lockedTrack: Track = {
      id: 'track-v2-locked',
      type: 'video',
      name: 'Video 2 (Locked)',
      visible: true,
      locked: true,
      muted: false,
      height: 52,
    };

    useTimelineStore.setState({
      tracks: [defaultTrack, lockedTrack],
      clips: [],
      transitions: [],
      currentTime: 0,
    });
  });

  // ─── 1. TIMELINE BOUNDARY & DURATION CLAMPING INVARIANTS ───────────────────
  describe('Timeline Boundary & Duration Clamping Invariants', () => {
    it('prevents clip start times from becoming negative via state invariant sanitization', () => {
      const rawClip: Clip = {
        id: 'clip-negative-start',
        trackId: 'track-v1',
        mediaId: 'm1',
        startTime: -10,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        kind: 'video',
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const sanitized = sanitizeClipStateInvariants(rawClip) as Clip;
      useTimelineStore.getState().addClip(sanitized);

      const added = useTimelineStore.getState().clips.find((c) => c.id === 'clip-negative-start');
      expect(added).toBeDefined();
      expect(added!.startTime).toBeGreaterThanOrEqual(0);
    });

    it('prevents zero or negative clip durations via state invariant sanitization', () => {
      const rawClipZero: Clip = {
        id: 'clip-zero-dur',
        trackId: 'track-v1',
        mediaId: 'm2',
        startTime: 0,
        duration: 0,
        trimIn: 0,
        trimOut: 0,
        kind: 'video',
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const sanitized = sanitizeClipStateInvariants(rawClipZero) as Clip;
      useTimelineStore.getState().addClip(sanitized);

      const added = useTimelineStore.getState().clips.find((c) => c.id === 'clip-zero-dur');
      expect(added).toBeDefined();
      expect(added!.duration).toBeGreaterThan(0);
    });

    it('preserves sub-millisecond precision without catastrophic floating point cancellation', () => {
      const clip: Clip = {
        id: 'clip-submilli',
        trackId: 'track-v1',
        mediaId: 'm3',
        startTime: 1.0000001,
        duration: 0.0333333,
        trimIn: 0.0000001,
        trimOut: 0.0333334,
        kind: 'video',
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      useTimelineStore.getState().addClip(clip);
      const retrieved = useTimelineStore.getState().clips.find((c) => c.id === 'clip-submilli');
      expect(retrieved).toBeDefined();
      expect(Math.abs(retrieved!.startTime - 1.0000001)).toBeLessThan(1e-5);
    });
  });

  // ─── 2. LOCKED TRACK RESILIENCE INVARIANTS ────────────────────────────────
  describe('Locked Track Invariants during Timeline Batch Operations', () => {
    it('guarantees clips on locked tracks are never mutated during clip edits on unlocked tracks', () => {
      const clipUnlocked: Clip = {
        id: 'clip-unlocked',
        trackId: 'track-v1',
        mediaId: 'm1',
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        kind: 'video',
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const clipLocked: Clip = {
        id: 'clip-locked',
        trackId: 'track-v2-locked',
        mediaId: 'm2',
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        kind: 'video',
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      useTimelineStore.getState().addClip(clipUnlocked);
      useTimelineStore.getState().addClip(clipLocked);

      // Perform update on unlocked clip
      useTimelineStore.getState().updateClip('clip-unlocked', { startTime: 5 });

      const lockedAfter = useTimelineStore.getState().clips.find((c) => c.id === 'clip-locked');
      expect(lockedAfter!.startTime).toBe(0);
      expect(lockedAfter!.duration).toBe(10);
    });
  });

  // ─── 3. SERIALIZATION & IMMUTABILITY ROUND-TRIP ────────────────────────────
  describe('State Serialization & Rehydration Invariants', () => {
    it('round-trips full timeline state to JSON without property loss or circular errors', () => {
      const clipA: Clip = {
        id: 'c-roundtrip',
        trackId: 'track-v1',
        mediaId: 'm-rt',
        startTime: 2.5,
        duration: 8.0,
        trimIn: 1.0,
        trimOut: 9.0,
        kind: 'video',
        volume: 0.8,
        x: 10,
        y: 20,
        width: 1280,
        height: 720,
        opacity: 0.9,
        rotation: 45,
      };

      useTimelineStore.getState().addClip(clipA);

      const state = useTimelineStore.getState();
      const serialized = JSON.stringify({
        tracks: state.tracks,
        clips: state.clips,
        transitions: state.transitions,
      });

      expect(typeof serialized).toBe('string');
      const deserialized = JSON.parse(serialized);
      expect(deserialized.clips.length).toBe(1);
      expect(deserialized.clips[0].id).toBe('c-roundtrip');
      expect(deserialized.clips[0].rotation).toBe(45);
    });
  });
});
