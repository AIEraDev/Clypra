import { afterEach, describe, expect, it, vi } from "vitest";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { useProjectStore } from "../projectStore";
import { useTimelineStore } from "../timelineStore";
import { useHistoryStore } from "../historyStore";

describe("history timeline persistence bridge", () => {
  const originalScheduleAutoSave = useProjectStore.getState().scheduleAutoSave;

  afterEach(() => {
    useProjectStore.setState({ scheduleAutoSave: originalScheduleAutoSave });
    useHistoryStore.getState().clear();
  });

  it("persists text edits made through the properties command path", () => {
    const scheduleAutoSave = vi.fn();
    useProjectStore.setState({ scheduleAutoSave });
    useTimelineStore.setState({
      clips: [{
        id: "text-1",
        kind: "text",
        trackId: "text-track",
        mediaId: "",
        startTime: 0,
        duration: 4,
        trimIn: 0,
        trimOut: 4,
        x: 0,
        y: 0,
        width: 500,
        height: 100,
        opacity: 1,
        rotation: 0,
        text: "Text",
        fontFamily: "Inter",
        fontSize: 48,
        color: "#fff",
        align: "center",
        valign: "middle",
        lineHeight: 1.2,
        paddingX: 16,
        paddingY: 16,
      } as any],
      epoch: 0,
    });

    useHistoryStore.getState().execute(
      new TransformClipCommand("text-1", { text: "Text" } as any, { text: "Abdulkabir Musa" } as any),
    );

    expect((useTimelineStore.getState().clips[0] as any).text).toBe("Abdulkabir Musa");
    expect(scheduleAutoSave).toHaveBeenCalledTimes(1);
  });
});
