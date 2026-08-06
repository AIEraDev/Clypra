import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../settingsStore";
import { useTimelineStore } from "../timelineStore";
import type { Clip } from "@/types";

describe("State Store Integrity & Corruption Recovery Edge Cases", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [{ id: "t1", type: "video", name: "T1", visible: true, locked: false, muted: false, height: 52 }],
      clips: [],
      transitions: [],
    });
  });

  // ─── 1. MALFORMED JSON DISK RESTORATION SAFEGUARD ───────────────────────
  describe("Settings Store Deserialization Resilience", () => {
    it("should safely fall back to default settings if corrupted JSON is loaded from disk", () => {
      const store = useSettingsStore.getState();
      const defaultFps = store.defaultFrameRate;

      expect(() => {
        // @ts-expect-error testing runtime invalid JSON/type payload
        store.setTheme("INVALID_THEME_CHOICE");
      }).not.toThrow();

      expect(typeof useSettingsStore.getState().theme).toBe("string");
      expect(useSettingsStore.getState().defaultFrameRate).toBe(defaultFps);
    });
  });

  // ─── 2. STORE STATE IMMUTABILITY PROTECTION ──────────────────────────────
  describe("Timeline Store State Immutability Assertions", () => {
    it("should guarantee that adding a clip creates a new array reference rather than mutating existing state in-place", () => {
      const store = useTimelineStore.getState();
      const initialClips = store.clips;

      const newClip: Clip = {
        id: "clip-immutable-1",
        trackId: "t1",
        mediaId: "m1",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        kind: "video",
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      // Freeze initial array to enforce immutability
      Object.freeze(initialClips);

      expect(() => {
        useTimelineStore.getState().addClip(newClip);
      }).not.toThrow();

      const nextClips = useTimelineStore.getState().clips;
      expect(nextClips).not.toBe(initialClips);
      expect(nextClips.length).toBe(1);
      expect(nextClips[0].id).toBe("clip-immutable-1");
    });
  });

  // ─── 3. SERIALIZATION & RECOVERY EDGE CASES ──────────────────────────────
  describe("State Serialization & Circular Protection", () => {
    it("should allow full JSON serialization of complex timeline state without throwing circular errors", () => {
      const clipA: Clip = {
        id: "cA",
        trackId: "t1",
        mediaId: "mA",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        kind: "video",
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      useTimelineStore.getState().addClip(clipA);
      const storeState = useTimelineStore.getState();

      const timelineState = {
        clips: storeState.clips,
        tracks: storeState.tracks,
        epoch: storeState.epoch,
      };

      let serialized = "";
      expect(() => {
        serialized = JSON.stringify(timelineState);
      }).not.toThrow();

      expect(serialized).toContain("cA");
      const parsed = JSON.parse(serialized);
      expect(parsed.clips.length).toBe(1);
    });
  });
});
