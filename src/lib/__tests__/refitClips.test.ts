import { beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { refitClipsForCanvasChange } from "../timeline/refitClips";
import type { TextClip, Clip } from "@/types";

describe("refitClipsForCanvasChange", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      clips: [],
      tracks: [],
    });
    useProjectStore.setState({
      project: null,
      mediaAssets: [],
    });
  });

  it("scales text clips proportionally when aspect ratio changes", () => {
    const textClip: TextClip = {
      id: "clip-text",
      kind: "text",
      trackId: "track-text",
      mediaId: "",
      startTime: 0,
      duration: 3,
      trimIn: 0,
      trimOut: 3,
      x: 100,
      y: 200,
      width: 400,
      height: 100,
      opacity: 1,
      rotation: 0,
      text: "HELLO",
      fontFamily: "Inter",
      fontSize: 32,
      color: "#ffffff",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      paddingX: 16,
      paddingY: 16,
    };

    useTimelineStore.setState({
      clips: [textClip],
    });

    // Fit from 1920x1080 to 960x540 (scale is exactly 0.5)
    refitClipsForCanvasChange(960, 540, 1920, 1080);

    const updated = useTimelineStore.getState().clips[0] as TextClip;
    expect(updated.x).toBe(50);
    expect(updated.y).toBe(100);
    expect(updated.width).toBe(200);
    expect(updated.height).toBe(50);
    expect(updated.fontSize).toBe(16);
  });

  it("refits video clips based on their fitMode", () => {
    const videoClip: Clip = {
      id: "clip-video",
      kind: "video",
      trackId: "track-video",
      mediaId: "asset-video",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      fitMode: "contain",
      sourceAspectRatio: 16 / 9,
    };

    useTimelineStore.setState({
      clips: [videoClip],
    });

    useProjectStore.setState({
      mediaAssets: [
        {
          id: "asset-video",
          type: "video",
          name: "Video",
          path: "/path/video.mp4",
          width: 1920,
          height: 1080,
          duration: 10,
          size: 0,
        },
      ],
    });

    // Fit to vertical format: 1080x1920
    refitClipsForCanvasChange(1080, 1920, 1920, 1080);

    const updated = useTimelineStore.getState().clips[0];
    // With fitMode "contain", a 16:9 clip fits to width: width = 1080, height = 1080 / (16/9) = 607.5
    // Centered: y = (1920 - 607.5) / 2 = 656.25
    expect(updated.width).toBe(1080);
    expect(updated.height).toBeCloseTo(607.5, 1);
    expect(updated.x).toBe(0);
    expect(updated.y).toBeCloseTo(656.25, 1);
  });

  it("synchronizes clip.conform and scales user offsets when canvas changes", () => {
    const videoClip: any = {
      id: "clip-video-conform",
      kind: "video",
      trackId: "track-video",
      mediaId: "asset-video",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      fitMode: "contain",
      conform: {
        mode: "fit",
        sourceWidth: 1920,
        sourceHeight: 1080,
        userScale: 1,
        userOffsetX: 20,
        userOffsetY: 10,
      },
    };

    useTimelineStore.setState({
      clips: [videoClip],
    });

    useProjectStore.setState({
      mediaAssets: [
        {
          id: "asset-video",
          type: "video",
          name: "Video",
          path: "/path/video.mp4",
          width: 1920,
          height: 1080,
          duration: 10,
          size: 0,
        },
      ],
    });

    // Halve canvas from 1920x1080 to 960x540
    refitClipsForCanvasChange(960, 540, 1920, 1080);

    const updated = useTimelineStore.getState().clips[0] as any;
    expect(updated.conform).toBeDefined();
    expect(updated.conform.mode).toBe("fit");
    expect(updated.conform.userOffsetX).toBe(10); // 20 * 0.5
    expect(updated.conform.userOffsetY).toBe(5);  // 10 * 0.5
  });
});

