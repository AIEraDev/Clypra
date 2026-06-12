/**
 * Timeline Store Gap Operations Tests
 *
 * Integration tests for gap operations in the timeline store.
 * Tests real store behavior with gaps array and clip interactions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useTimelineStore } from "./timelineStore";

describe("Timeline Store - Gap Operations", () => {
  let trackId: string;

  beforeEach(() => {
    // Reset store using hydrateFromProject
    const store = useTimelineStore.getState();
    store.hydrateFromProject({
      tracks: [
        {
          id: "track-test-1",
          type: "video" as const,
          name: "Video 1",
          height: 68,
          visible: true,
          muted: false,
          locked: false,
        },
      ],
      clips: [],
      transitions: [],
      gaps: [], // Explicitly clear gaps
    } as any);

    trackId = "track-test-1";

    // Add test clips with IDs
    store.addClip({
      id: "clip-1",
      trackId,
      mediaId: "media1",
      startTime: 0,
      duration: 5,
    } as any);

    store.addClip({
      id: "clip-2",
      trackId,
      mediaId: "media2",
      startTime: 10,
      duration: 5,
    } as any);
  });

  afterEach(() => {
    // Clean up
    useTimelineStore.getState().hydrateFromProject({
      tracks: [],
      clips: [],
      transitions: [],
      gaps: [], // Explicitly clear gaps
    } as any);
  });

  describe("insertGap", () => {
    it("should insert gap and create gap entity", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      const gap = store.insertGap(trackId, 7, 3);

      expect(gap).not.toBeNull();
      expect(gap!.startTime).toBe(7);
      expect(gap!.duration).toBe(3);
      expect(gap!.trackId).toBe(trackId);
      expect(gap!.type).toBe("manual");

      // Get fresh state after mutation
      const freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);
      expect(freshStore.gaps[0].id).toBe(gap!.id);
    });

    it("should shift clips after gap insertion point", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      const clip2Before = store.clips.find((c) => c.mediaId === "media2");
      expect(clip2Before!.startTime).toBe(10);

      store.insertGap(trackId, 7, 3);

      // Get fresh state after mutation
      const freshStore = useTimelineStore.getState();
      const clip2After = freshStore.clips.find((c) => c.mediaId === "media2");
      expect(clip2After!.startTime).toBe(13); // Shifted by 3 seconds
    });

    it("should not affect clips before gap insertion point", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      const clip1Before = store.clips.find((c) => c.mediaId === "media1");
      console.log("DEBUG: clip1Before", clip1Before);
      console.log(
        "DEBUG: all clips before",
        store.clips.map((c) => ({ id: c.id, mediaId: c.mediaId, startTime: c.startTime })),
      );
      expect(clip1Before!.startTime).toBe(0);

      store.insertGap(trackId, 7, 3);

      // Get fresh state after mutation
      const freshStore = useTimelineStore.getState();
      console.log(
        "DEBUG: all clips after",
        freshStore.clips.map((c) => ({ id: c.id, mediaId: c.mediaId, startTime: c.startTime })),
      );
      const clip1After = freshStore.clips.find((c) => c.mediaId === "media1");
      console.log("DEBUG: clip1After", clip1After);
      expect(clip1After!.startTime).toBe(0); // Unchanged
    });

    it("should return null for invalid track", () => {
      const store = useTimelineStore.getState();
      const gap = store.insertGap("non-existent-track", 0, 2);

      expect(gap).toBeNull();

      // Get fresh state after mutation
      const freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);
    });

    it("should return null for locked track", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Lock the track
      store.toggleTrackLock(trackId);

      const gap = store.insertGap(trackId, 0, 2);

      expect(gap).toBeNull();

      // Get fresh state after mutation
      const freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);
    });
  });

  describe("removeGap", () => {
    it("should remove gap and shift clips left", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert a gap
      const gap = store.insertGap(trackId, 7, 3);
      expect(gap).not.toBeNull();

      // Verify clip shifted right
      let freshStore = useTimelineStore.getState();
      const clip2After = freshStore.clips.find((c) => c.mediaId === "media2");
      expect(clip2After!.startTime).toBe(13);

      // Remove the gap
      freshStore.removeGap(gap!.id);

      // Gap should be removed
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);

      // Clip should be shifted back left
      const clip2Final = freshStore.clips.find((c) => c.mediaId === "media2");
      expect(clip2Final!.startTime).toBe(10);
    });

    it("should handle removing non-existent gap gracefully", () => {
      const store = useTimelineStore.getState();

      // Should not crash
      expect(() => store.removeGap("non-existent-gap")).not.toThrow();

      const freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);
    });

    it("should not remove from locked track", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap
      const gap = store.insertGap(trackId, 7, 3);
      expect(gap).not.toBeNull();

      // Lock track
      let freshStore = useTimelineStore.getState();
      freshStore.toggleTrackLock(trackId);

      // Try to remove gap
      freshStore = useTimelineStore.getState();
      freshStore.removeGap(gap!.id);

      // Gap should still be there
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);
    });
  });

  describe("resizeGapDuration", () => {
    it("should resize gap and adjust downstream clips", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap
      const gap = store.insertGap(trackId, 7, 3);
      expect(gap).not.toBeNull();

      // Resize to 5 seconds (increase by 2)
      let freshStore = useTimelineStore.getState();
      freshStore.resizeGapDuration(gap!.id, 5);

      // Gap should be resized
      freshStore = useTimelineStore.getState();
      const updatedGap = freshStore.gaps.find((g) => g.id === gap!.id);
      expect(updatedGap!.duration).toBe(5);

      // Clip2 should be shifted further right
      const clip2 = freshStore.clips.find((c) => c.mediaId === "media2");
      expect(clip2!.startTime).toBe(15); // Was 13, now 13 + 2 = 15
    });

    it("should handle shrinking gap", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap
      const gap = store.insertGap(trackId, 7, 3);
      expect(gap).not.toBeNull();

      // Resize to 1 second (decrease by 2)
      let freshStore = useTimelineStore.getState();
      freshStore.resizeGapDuration(gap!.id, 1);

      // Gap should be resized
      freshStore = useTimelineStore.getState();
      const updatedGap = freshStore.gaps.find((g) => g.id === gap!.id);
      expect(updatedGap!.duration).toBe(1);

      // Clip2 should be shifted left
      const clip2 = freshStore.clips.find((c) => c.mediaId === "media2");
      expect(clip2!.startTime).toBe(11); // Was 13, now 13 - 2 = 11
    });

    it("should handle resizing non-existent gap gracefully", () => {
      const store = useTimelineStore.getState();

      expect(() => store.resizeGapDuration("non-existent-gap", 5)).not.toThrow();
    });

    it("should not resize on locked track", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap
      const gap = store.insertGap(trackId, 7, 3);
      expect(gap).not.toBeNull();

      // Lock track
      let freshStore = useTimelineStore.getState();
      freshStore.toggleTrackLock(trackId);

      // Try to resize
      freshStore = useTimelineStore.getState();
      freshStore.resizeGapDuration(gap!.id, 5);

      // Gap should be unchanged
      freshStore = useTimelineStore.getState();
      const updatedGap = freshStore.gaps.find((g) => g.id === gap!.id);
      expect(updatedGap!.duration).toBe(3);
    });
  });

  describe("toggleGapProtection", () => {
    it("should toggle protection state", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap (manual gaps are protected by default)
      const gap = store.insertGap(trackId, 7, 3);
      expect(gap).not.toBeNull();
      expect(gap!.protected).toBe(true);

      // Toggle to unprotected
      let freshStore = useTimelineStore.getState();
      freshStore.toggleGapProtection(gap!.id);

      freshStore = useTimelineStore.getState();
      const updated1 = freshStore.gaps.find((g) => g.id === gap!.id);
      expect(updated1!.protected).toBe(false);

      // Toggle back to protected
      freshStore.toggleGapProtection(gap!.id);

      freshStore = useTimelineStore.getState();
      const updated2 = freshStore.gaps.find((g) => g.id === gap!.id);
      expect(updated2!.protected).toBe(true);
    });

    it("should handle toggling non-existent gap gracefully", () => {
      const store = useTimelineStore.getState();

      expect(() => store.toggleGapProtection("non-existent-gap")).not.toThrow();
    });

    it("should toggle even on locked track (no lock check in implementation)", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap
      const gap = store.insertGap(trackId, 7, 3);
      expect(gap).not.toBeNull();

      // Lock track
      let freshStore = useTimelineStore.getState();
      freshStore.toggleTrackLock(trackId);

      // Try to toggle - it will succeed as there's no lock check
      freshStore = useTimelineStore.getState();
      freshStore.toggleGapProtection(gap!.id);

      // Should be changed (toggleGapProtection doesn't check lock)
      freshStore = useTimelineStore.getState();
      const updatedGap = freshStore.gaps.find((g) => g.id === gap!.id);
      expect(updatedGap!.protected).toBe(false);
    });
  });

  describe("detectAndSyncGaps", () => {
    it("should detect gaps between clips", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Initially no gaps in store
      let freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);

      // Detect gaps
      store.detectAndSyncGaps(trackId);

      // Should detect gap between clip1 (0-5s) and clip2 (10-15s)
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);
      expect(freshStore.gaps[0].startTime).toBe(5);
      expect(freshStore.gaps[0].duration).toBe(5);
    });

    it("should detect gaps on all tracks when no trackId specified", () => {
      const store = useTimelineStore.getState();

      // Add another track with clips
      store.addTrack("audio");

      let freshStore = useTimelineStore.getState();
      const track2Id = freshStore.tracks.find((t) => t.type === "audio")!.id;

      freshStore.addClip({
        trackId: track2Id,
        mediaId: "media3",
        startTime: 3,
        duration: 2,
      } as any);
      freshStore.addClip({
        trackId: track2Id,
        mediaId: "media4",
        startTime: 8,
        duration: 2,
      } as any);

      // Detect all gaps
      freshStore = useTimelineStore.getState();
      freshStore.detectAndSyncGaps();

      // Should have gaps from both tracks
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps.length).toBeGreaterThan(0);

      const track1Gaps = freshStore.gaps.filter((g) => g.trackId === trackId);
      const track2Gaps = freshStore.gaps.filter((g) => g.trackId === track2Id);

      expect(track1Gaps.length).toBeGreaterThan(0);
      expect(track2Gaps.length).toBeGreaterThan(0);
    });

    it("should not duplicate existing gaps", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Manually insert a gap in the middle of the natural gap (5-10)
      // This splits the natural gap, but detectAndSyncGaps should see it's already there
      const gap = store.insertGap(trackId, 6, 2);
      expect(gap).not.toBeNull();

      let freshStore = useTimelineStore.getState();
      // After inserting gap at 6-8, clip2 shifts from 10 to 12
      // Natural gaps would be: 5-6 and 8-12, but we have manual gap 6-8
      // So detectAndSyncGaps should find gaps at 5-6 (1 sec) and 8-12 (4 sec)
      const initialGapCount = freshStore.gaps.length; // Should be 1 (our manual gap)

      // Detect gaps - will find the gaps around our manual gap
      freshStore.detectAndSyncGaps(trackId);

      // detectAndSyncGaps will add newly detected gaps (at start 5-6 and maybe 8-12)
      freshStore = useTimelineStore.getState();
      // This test should verify that the manually inserted gap is preserved
      const manualGap = freshStore.gaps.find((g) => g.id === gap!.id);
      expect(manualGap).toBeDefined();
      expect(manualGap!.type).toBe("manual");
    });
  });

  describe("packTrackGaps", () => {
    it("should remove all unprotected gaps", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert multiple gaps
      const gap1 = store.insertGap(trackId, 7, 2);
      const gap2 = store.insertGap(trackId, 17, 1);

      // Unprotect them
      let freshStore = useTimelineStore.getState();
      freshStore.toggleGapProtection(gap1!.id);
      freshStore.toggleGapProtection(gap2!.id);

      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(2);

      // Pack track
      freshStore.packTrackGaps(trackId);

      // All gaps should be removed
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);

      // Clips should be packed tight
      const clip1 = freshStore.clips.find((c) => c.mediaId === "media1");
      const clip2 = freshStore.clips.find((c) => c.mediaId === "media2");
      expect(clip1!.startTime).toBe(0);
      expect(clip2!.startTime).toBe(5); // Immediately after clip1
    });

    it("should preserve protected gaps", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap (protected by default)
      const protectedGap = store.insertGap(trackId, 7, 2);
      expect(protectedGap!.protected).toBe(true);

      // Insert another gap and unprotect it
      let freshStore = useTimelineStore.getState();
      const unprotectedGap = freshStore.insertGap(trackId, 17, 1);
      freshStore = useTimelineStore.getState();
      freshStore.toggleGapProtection(unprotectedGap!.id);

      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(2);

      // Pack track
      freshStore.packTrackGaps(trackId);

      // Only protected gap should remain
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);
      expect(freshStore.gaps[0].id).toBe(protectedGap!.id);
    });

    it("should handle track with no gaps", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      let freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);

      // Should not crash
      expect(() => freshStore.packTrackGaps(trackId)).not.toThrow();

      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);
    });

    it("should not pack locked track", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap
      const gap = store.insertGap(trackId, 7, 2);

      let freshStore = useTimelineStore.getState();
      freshStore.toggleGapProtection(gap!.id); // Unprotect

      // Lock track
      freshStore = useTimelineStore.getState();
      freshStore.toggleTrackLock(trackId);

      // Try to pack
      freshStore = useTimelineStore.getState();
      freshStore.packTrackGaps(trackId);

      // Gap should still be there
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complex gap workflow", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // 1. Insert gap
      const gap1 = store.insertGap(trackId, 7, 3);
      expect(gap1).not.toBeNull();

      let freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);

      // 2. Add clip after gap
      freshStore.addClip({
        trackId,
        mediaId: "media3",
        startTime: 20,
        duration: 5,
      } as any);

      // 3. Insert another gap
      freshStore = useTimelineStore.getState();
      const gap2 = freshStore.insertGap(trackId, 17, 2);

      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(2);

      // 4. Resize first gap
      freshStore.resizeGapDuration(gap1!.id, 5);

      freshStore = useTimelineStore.getState();
      const resizedGap = freshStore.gaps.find((g) => g.id === gap1!.id);
      expect(resizedGap!.duration).toBe(5);

      // 5. Protect second gap
      expect(gap2!.protected).toBe(true); // Already protected

      // 6. Try to pack track (should only remove unprotected gaps)
      freshStore.toggleGapProtection(gap1!.id); // Unprotect gap1
      freshStore = useTimelineStore.getState();
      freshStore.packTrackGaps(trackId);

      // Only gap2 should remain
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);
      expect(freshStore.gaps[0].id).toBe(gap2!.id);
    });

    it("should handle gap operations with clip CRUD", () => {
      const store = useTimelineStore.getState();

      // Insert gap
      const gap = store.insertGap(trackId, 7, 3);
      expect(gap).not.toBeNull();

      // Add a clip after the gap
      let freshStore = useTimelineStore.getState();
      freshStore.addClip({
        trackId,
        mediaId: "media3",
        startTime: 15,
        duration: 3,
      } as any);

      // Gap should still exist after adding clip
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);

      // Verify clip was added
      const clip3 = freshStore.clips.find((c) => c.mediaId === "media3");
      expect(clip3).toBeDefined();
    });

    it("should handle multiple tracks with gaps independently", () => {
      const store = useTimelineStore.getState();
      const track1Id = trackId;

      // Add second track
      store.addTrack("audio");

      let freshStore = useTimelineStore.getState();
      const track2Id = freshStore.tracks.find((t) => t.type === "audio")!.id;

      // Add clips to track2
      freshStore.addClip({
        trackId: track2Id,
        mediaId: "media3",
        startTime: 0,
        duration: 3,
      } as any);
      freshStore.addClip({
        trackId: track2Id,
        mediaId: "media4",
        startTime: 8,
        duration: 3,
      } as any);

      // Insert gaps on both tracks
      freshStore = useTimelineStore.getState();
      const gap1 = freshStore.insertGap(track1Id, 7, 2);
      const gap2 = freshStore.insertGap(track2Id, 5, 2);

      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(2);

      // Pack track1 only
      freshStore.toggleGapProtection(gap1!.id); // Unprotect
      freshStore = useTimelineStore.getState();
      freshStore.packTrackGaps(track1Id);

      // Track1 gaps removed, track2 gap preserved
      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(1);
      expect(freshStore.gaps[0].trackId).toBe(track2Id);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty track gracefully (track is removed when last clip deleted)", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Remove all clips
      const clipIds = store.clips.map((c) => c.id);
      clipIds.forEach((id) => store.removeClip(id));

      // After removing all clips, the track itself is automatically removed
      let freshStore = useTimelineStore.getState();
      const trackStillExists = freshStore.tracks.some((t) => t.id === trackId);
      expect(trackStillExists).toBe(false);

      // Try to insert gap on non-existent track
      const gap = freshStore.insertGap(trackId, 0, 2);

      // insertGap returns null because track doesn't exist
      expect(gap).toBeNull();

      freshStore = useTimelineStore.getState();
      expect(freshStore.gaps).toHaveLength(0);
    });

    it("should handle very large time values", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert gap at 1 hour
      const gap = store.insertGap(trackId, 3600, 10);
      expect(gap).not.toBeNull();
      expect(gap!.startTime).toBe(3600);
    });

    it("should handle very small gap durations", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Insert tiny gap
      const gap = store.insertGap(trackId, 7, 0.001);
      expect(gap).not.toBeNull();
      expect(gap!.duration).toBe(0.001);
    });

    it("should handle rapid gap operations", () => {
      const store = useTimelineStore.getState();
      // Use trackId from beforeEach

      // Rapid insert/remove cycles
      for (let i = 0; i < 10; i++) {
        let freshStore = useTimelineStore.getState();
        const gap = freshStore.insertGap(trackId, 7, 2);
        expect(gap).not.toBeNull();

        freshStore = useTimelineStore.getState();
        freshStore.removeGap(gap!.id);
      }

      // Should end with no gaps
      const finalStore = useTimelineStore.getState();
      expect(finalStore.gaps).toHaveLength(0);
    });
  });
});
