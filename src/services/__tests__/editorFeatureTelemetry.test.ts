import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EditorFeatureTelemetry,
  type ShuttleTelemetryPayload,
  type OtioInterchangeTelemetryPayload,
  type TimecodeJumpTelemetryPayload,
} from "../editorFeatureTelemetry";
import { perfLogService } from "../perfLogService";
import { exportToOTIO, type OTIOTimeline } from "@/lib/export/otioExporter";
import { importFromOTIO } from "@/lib/export/otioImporter";
import { EditingActions, type TimelineEditTelemetry } from "@/core/interactions/EditingActions";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import type { Track, Clip, Project } from "@/types";

const makeClip = (id: string, overrides: Partial<Clip> = {}): Clip => ({
  id,
  trackId: "t1",
  mediaId: "m1",
  name: id,
  startTime: 0,
  duration: 4,
  trimIn: 0,
  trimOut: 4,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
  ...overrides,
});

describe("EditorFeatureTelemetry & Validations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Shuttle Telemetry", () => {
    it("enqueues shuttle-transition log entry for speed changes", () => {
      const enqueueSpy = vi.spyOn(perfLogService, "enqueue");
      vi.spyOn(perfLogService, "getSessionId").mockReturnValue("test-session-1");

      EditorFeatureTelemetry.recordShuttle({
        action: "shuttle-speed",
        fromSpeed: 1.0,
        toSpeed: 2.0,
        direction: "forward",
        frameRate: 30,
        playheadTime: 4.5,
      });

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const entry = enqueueSpy.mock.calls[0][0];
      expect(entry.kind).toBe("shuttle-transition");
      expect(entry.sessionId).toBe("test-session-1");
      const payload = entry.payload as ShuttleTelemetryPayload;
      expect(payload).toEqual({
        action: "shuttle-speed",
        fromSpeed: 1.0,
        toSpeed: 2.0,
        direction: "forward",
        frameRate: 30,
        playheadTime: 4.5,
      });
    });

    it("enqueues shuttle-transition log entry for jog frame steps", () => {
      const enqueueSpy = vi.spyOn(perfLogService, "enqueue");
      EditorFeatureTelemetry.recordShuttle({
        action: "jog-step",
        direction: "step-forward",
        frameRate: 24,
        playheadTime: 1.0,
      });

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const payload = enqueueSpy.mock.calls[0][0].payload as ShuttleTelemetryPayload;
      expect(payload).toMatchObject({
        action: "jog-step",
        direction: "step-forward",
      });
    });

    it("does not throw when enqueue fails (non-blocking guarantee)", () => {
      vi.spyOn(perfLogService, "enqueue").mockImplementation(() => {
        throw new Error("Disk full or channel closed");
      });

      expect(() => {
        EditorFeatureTelemetry.recordShuttle({
          action: "jog-step",
          direction: "step-backward",
        });
      }).not.toThrow();
    });
  });

  describe("OTIO Interchange Telemetry & Invariant Validation", () => {
    it("validates a compliant OTIO timeline structure", () => {
      const compliantTimeline: OTIOTimeline = {
        OTIO_SCHEMA: "Timeline.1",
        name: "Test Timeline",
        tracks: {
          OTIO_SCHEMA: "Stack.1",
          name: "tracks",
          children: [
            {
              OTIO_SCHEMA: "Track.1",
              name: "Video 1",
              kind: "Video",
              children: [
                {
                  OTIO_SCHEMA: "Clip.2",
                  name: "Clip 1",
                  source_range: {
                    OTIO_SCHEMA: "TimeRange.1",
                    start_time: { OTIO_SCHEMA: "RationalTime.1", value: 0, rate: 30 },
                    duration: { OTIO_SCHEMA: "RationalTime.1", value: 60, rate: 30 },
                  },
                  media_reference: {
                    OTIO_SCHEMA: "MissingReference.1",
                  },
                },
              ],
            },
          ],
        },
      };

      const result = EditorFeatureTelemetry.validateOtioExport(compliantTimeline);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects schema violations in OTIO export", () => {
      const brokenTimeline: any = {
        OTIO_SCHEMA: "Corrupted.1",
        name: "Broken",
        tracks: {
          OTIO_SCHEMA: "WrongStack",
          children: [
            {
              OTIO_SCHEMA: "InvalidTrack",
              children: [
                {
                  source_range: {
                    start_time: { value: -10 },
                    duration: { value: 0 },
                  },
                },
              ],
            },
          ],
        },
      };

      const result = EditorFeatureTelemetry.validateOtioExport(brokenTimeline);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid OTIO_SCHEMA"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Missing or invalid tracks stack"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Invalid track schema"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Negative start_time"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Non-positive duration"))).toBe(true);
    });

    it("validates OTIO import integrity against model invariants", () => {
      const validImport = {
        tracks: [{ id: "t1" }],
        clips: [{ id: "c1", trackId: "t1", duration: 5, startTime: 0, trimIn: 0 }],
      };
      expect(EditorFeatureTelemetry.validateOtioImport(validImport).valid).toBe(true);

      const invalidImport = {
        tracks: [{ id: "t1" }],
        clips: [
          { id: "c1", trackId: "nonexistent", duration: -1, startTime: -5, trimIn: -2 },
        ],
      };
      const validation = EditorFeatureTelemetry.validateOtioImport(invalidImport);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toHaveLength(4);
    });

    it("automatically triggers telemetry and validation during exportToOTIO and importFromOTIO", () => {
      const enqueueSpy = vi.spyOn(perfLogService, "enqueue");

      const tracks: Track[] = [{ id: "t-1", type: "video", name: "V1", muted: false, locked: false, visible: true, height: 64, volume: 1.0 }];
      const clips: Clip[] = [
        makeClip("c-1", {
          trackId: "t-1",
          mediaId: "m-1",
          name: "Test Clip",
          startTime: 2.0, // gap before clip
          duration: 3.0,
          trimIn: 1.0,
          trimOut: 4.0,
        }),
      ];

      const exported = exportToOTIO({
        projectName: "Telemetry Test",
        frameRate: 30,
        tracks,
        clips,
      });

      expect(exported).toBeDefined();
      const exportCalls = enqueueSpy.mock.calls.filter((c) => c[0].kind === "otio-interchange");
      expect(exportCalls.length).toBeGreaterThanOrEqual(1);
      const exportPayload = exportCalls[0][0].payload as OtioInterchangeTelemetryPayload;
      expect(exportPayload.action).toBe("export");
      expect(exportPayload.trackCount).toBe(1);
      expect(exportPayload.clipCount).toBe(1);
      expect(exportPayload.gapCount).toBe(1);
      expect(exportPayload.success).toBe(true);

      // Now import
      const imported = importFromOTIO(exported);
      expect(imported.clips).toHaveLength(1);

      const importCalls = enqueueSpy.mock.calls.filter(
        (c) => c[0].kind === "otio-interchange" && (c[0].payload as OtioInterchangeTelemetryPayload).action === "import",
      );
      expect(importCalls).toHaveLength(1);
      const importPayload = importCalls[0][0].payload as OtioInterchangeTelemetryPayload;
      expect(importPayload.success).toBe(true);
    });
  });

  describe("Timecode Jump Telemetry", () => {
    it("enqueues timecode-jump log entries with precision metadata", () => {
      const enqueueSpy = vi.spyOn(perfLogService, "enqueue");

      EditorFeatureTelemetry.recordTimecodeJump({
        rawInput: "+01:00",
        fromTime: 5.0,
        toTime: 6.0,
        deltaSeconds: 1.0,
        isRelative: true,
        frameRate: 30,
        dropFrame: false,
        durationMs: 0.12,
        success: true,
      });

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const entry = enqueueSpy.mock.calls[0][0];
      expect(entry.kind).toBe("timecode-jump");
      const payload = entry.payload as TimecodeJumpTelemetryPayload;
      expect(payload.rawInput).toBe("+01:00");
      expect(payload.isRelative).toBe(true);
      expect(payload.success).toBe(true);
    });
  });

  describe("NLE Timeline Edit Telemetry (Slide & Roll)", () => {
    beforeEach(() => {
      useTimelineStore.setState({
        tracks: [{ id: "t1", type: "video", name: "V1", muted: false, locked: false, visible: true, height: 64, volume: 1.0 }],
        clips: [
          makeClip("c1", { trackId: "t1", mediaId: "m1", startTime: 0, duration: 4, trimIn: 0, trimOut: 4 }),
          makeClip("c2", { trackId: "t1", mediaId: "m2", startTime: 4, duration: 4, trimIn: 0, trimOut: 4 }),
        ],
      });
      useProjectStore.setState({
        project: {
          id: "p1",
          name: "P1",
          createdAt: 0,
          updatedAt: 0,
          aspectRatio: "16:9",
          canvasWidth: 1920,
          canvasHeight: 1080,
          frameRate: 30,
          duration: 60,
        } as Project,
        mediaAssets: [],
      });
      useHistoryStore.setState({ past: [], future: [] } as any);
    });

    it("records timeline-edit telemetry on rollEdit success", () => {
      const enqueueSpy = vi.spyOn(perfLogService, "enqueue");

      const res = EditingActions.rollEdit("c1", "c2", 1.0);
      expect(res.success).toBe(true);

      const rollEvents = enqueueSpy.mock.calls.filter((c) => c[0].kind === "timeline-edit");
      expect(rollEvents).toHaveLength(1);
      const payload = rollEvents[0][0].payload as TimelineEditTelemetry;
      expect(payload.operation).toBe("roll");
      expect(payload.clipId).toBe("c1");
      expect(payload.secondaryClipId).toBe("c2");
      expect(payload.deltaApplied).toBeCloseTo(1.0, 3);
      expect(payload.success).toBe(true);
    });

    it("records timeline-edit telemetry on slideClip failure", () => {
      const enqueueSpy = vi.spyOn(perfLogService, "enqueue");

      // Slide non-existent clip
      const res = EditingActions.slideClip("non-existent", 1.0);
      expect(res.success).toBe(false);

      const slideEvents = enqueueSpy.mock.calls.filter((c) => c[0].kind === "timeline-edit");
      expect(slideEvents).toHaveLength(1);
      const payload = slideEvents[0][0].payload as TimelineEditTelemetry;
      expect(payload.operation).toBe("slide");
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("Clip not found");
    });
  });
});
