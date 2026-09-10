import { describe, it, expect } from "vitest";
import { ApplyCaptionTrackStyleCommand } from "../CaptionTrackStyleCommand";
import type { TextClip } from "@/types";

describe("ApplyCaptionTrackStyleCommand", () => {
  const clip1 = {
    id: "caption-1",
    kind: "text",
    trackId: "track-captions",
    startTime: 0,
    duration: 2,
    text: "First caption cue",
    fontFamily: "Inter Variable",
    fontSize: 32,
    color: "#ffffff",
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    paddingX: 0,
    paddingY: 0,
    textRole: "caption",
  } as unknown as TextClip;

  const clip2 = {
    id: "caption-2",
    kind: "text",
    trackId: "track-captions",
    startTime: 2.5,
    duration: 3,
    text: "Second caption cue",
    fontFamily: "Inter Variable",
    fontSize: 32,
    color: "#ffffff",
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    paddingX: 0,
    paddingY: 0,
    textRole: "caption",
  } as unknown as TextClip;

  const otherClip = {
    id: "video-1",
    kind: "video",
    trackId: "track-video",
    startTime: 0,
    duration: 10,
  } as any;

  it("broadcasts plain text styling across all captions on track while preserving text and timing", () => {
    const initialState = {
      clips: [clip1, clip2, otherClip],
      epoch: 1,
    };

    const cmd = new ApplyCaptionTrackStyleCommand("track-captions", {
      fontFamily: "Outfit Variable",
      fontSize: 40,
      color: "#FFE600",
      stroke: { color: "#000000", width: 4 },
      background: { color: "rgba(0,0,0,0.8)", padding: 10, borderRadius: 8 },
    });

    const nextState = cmd.apply(initialState);
    expect(nextState.epoch).toBe(2);

    const c1 = nextState.clips.find((c: any) => c.id === "caption-1") as TextClip;
    const c2 = nextState.clips.find((c: any) => c.id === "caption-2") as TextClip;
    const v1 = nextState.clips.find((c: any) => c.id === "video-1");

    expect(c1.fontFamily).toBe("Outfit Variable");
    expect(c1.fontSize).toBe(40);
    expect(c1.color).toBe("#FFE600");
    expect(c1.stroke?.width).toBe(4);
    expect(c1.background?.padding).toBe(10);
    expect(c1.text).toBe("First caption cue"); // text preserved!
    expect(c1.startTime).toBe(0); // timing preserved!

    expect(c2.fontFamily).toBe("Outfit Variable");
    expect(c2.text).toBe("Second caption cue");

    expect(v1?.kind).toBe("video"); // other clip untouched!

    // Invert / Undo
    const undoCmd = cmd.invert();
    const restoredState = undoCmd.apply(nextState);

    const r1 = restoredState.clips.find((c: any) => c.id === "caption-1") as TextClip;
    expect(r1.fontFamily).toBe("Inter Variable");
    expect(r1.fontSize).toBe(32);
    expect(r1.color).toBe("#ffffff");
    expect(r1.stroke).toBeUndefined();
  });

  it("broadcasts text effects across all captions", () => {
    const initialState = {
      clips: [clip1, clip2],
      epoch: 1,
    };

    const cmd = new ApplyCaptionTrackStyleCommand("track-captions", {
      styleId: "neon-crimson",
    });

    const nextState = cmd.apply(initialState);
    const c1 = nextState.clips.find((c: any) => c.id === "caption-1") as TextClip;
    const c2 = nextState.clips.find((c: any) => c.id === "caption-2") as TextClip;

    expect(c1.styleId).toBe("neon-crimson");
    expect(c2.styleId).toBe("neon-crimson");
  });
});
