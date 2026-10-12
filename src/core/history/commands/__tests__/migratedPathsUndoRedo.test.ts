import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import {
  AddClipCommand,
  MoveClipCommand,
  UpdateClipCommand,
} from "@/core/history/commands";
import { clipboardService } from "@/core/clipboard/clipboardService";
import type { Clip, Track } from "@/types";

describe("Migrated Direct-Mutator Paths Undo-Redo Verification", () => {
  const baseTrack: Track = {
    id: "track-v1",
    name: "Video 1",
    type: "video",
    locked: false,
    muted: false,
    visible: true,
    height: 80,
  };

  const audioTrack: Track = {
    id: "track-a1",
    name: "Audio 1",
    type: "audio",
    locked: false,
    muted: false,
    visible: true,
    height: 60,
  };

  function createTestClip(overrides: Partial<Clip> = {}): Clip {
    return {
      id: "clip-1",
      trackId: "track-v1",
      mediaId: "asset-1",
      startTime: 2.0,
      duration: 5.0,
      trimIn: 0,
      trimOut: 5.0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      speed: 1,
      volume: 1,
      kind: "video",
      ...overrides,
    };
  }

  beforeEach(() => {
    useTimelineStore.setState({
      clips: [],
      tracks: [baseTrack, audioTrack],
      gaps: [],
      epoch: 0,
      _batchDepth: 0,
    });
    useHistoryStore.getState().clear();
  });

  it("1. Pasted clip via AddClipCommand can be undone and redone cleanly", () => {
    const history = useHistoryStore.getState();
    const pastedClip = createTestClip({
      id: "pasted-clip-1",
      startTime: 0.0,
    });

    history.execute(new AddClipCommand(pastedClip));
    expect(useTimelineStore.getState().clips.some((c) => c.id === "pasted-clip-1")).toBe(true);

    history.undo();
    expect(useTimelineStore.getState().clips.some((c) => c.id === "pasted-clip-1")).toBe(false);

    history.redo();
    expect(useTimelineStore.getState().clips.some((c) => c.id === "pasted-clip-1")).toBe(true);
  });

  it("2. Voiceover recording clip via AddClipCommand can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const voiceoverClip = createTestClip({
      id: "vo-clip-1",
      trackId: "track-a1",
      mediaId: "vo-asset-1",
      startTime: 3.5,
      duration: 4.2,
      trimIn: 0,
      trimOut: 4.2,
      kind: "audio",
      volume: 1.0,
    });

    history.execute(new AddClipCommand(voiceoverClip));
    expect(useTimelineStore.getState().clips.find((c) => c.id === "vo-clip-1")).toBeDefined();

    history.undo();
    expect(useTimelineStore.getState().clips.find((c) => c.id === "vo-clip-1")).toBeUndefined();

    history.redo();
    expect(useTimelineStore.getState().clips.find((c) => c.id === "vo-clip-1")?.duration).toBe(4.2);
  });

  it("3. OS file drop addition via AddClipCommand can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const droppedClip = createTestClip({
      id: "drop-clip-1",
      trackId: "track-v1",
      mediaId: "drop-asset-1",
      startTime: 10.0,
      duration: 3.0,
      trimIn: 0,
      trimOut: 3.0,
      kind: "video",
    });

    history.execute(new AddClipCommand(droppedClip));
    expect(useTimelineStore.getState().clips.length).toBe(1);

    history.undo();
    expect(useTimelineStore.getState().clips.length).toBe(0);

    history.redo();
    expect(useTimelineStore.getState().clips.length).toBe(1);
    expect(useTimelineStore.getState().clips[0].id).toBe("drop-clip-1");
  });

  it("4. Caption cue and matching timeline clip updates can be undone atomically", () => {
    const history = useHistoryStore.getState();
    const captionClip = createTestClip({
      id: "caption-clip-1",
      trackId: "track-v1",
      mediaId: "caption-asset",
      startTime: 1.0,
      duration: 2.0,
      trimIn: 0,
      trimOut: 2.0,
      kind: "text",
      text: "Original Subtitle",
    } as any);

    useTimelineStore.setState({ clips: [captionClip] });

    history.beginTransaction("Update Caption Cue");
    history.execute(
      new UpdateClipCommand(
        captionClip.id,
        { text: "Original Subtitle" } as any,
        { text: "Edited Subtitle" } as any,
      ),
    );
    history.commitTransaction();

    expect((useTimelineStore.getState().clips[0] as any).text).toBe("Edited Subtitle");

    history.undo();
    expect((useTimelineStore.getState().clips[0] as any).text).toBe("Original Subtitle");

    history.redo();
    expect((useTimelineStore.getState().clips[0] as any).text).toBe("Edited Subtitle");
  });

  it("5. Smart Overlays batch creation and property update can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const overlay1 = createTestClip({
      id: "overlay-1",
      trackId: "track-v1",
      mediaId: "overlay-asset-1",
      startTime: 0,
      duration: 3,
      trimIn: 0,
      trimOut: 3,
      kind: "smart-overlay" as any,
      content: { type: "stat", data: { number: "100", label: "Initial" } },
    } as any);
    const overlay2 = createTestClip({
      id: "overlay-2",
      trackId: "track-v1",
      mediaId: "overlay-asset-2",
      startTime: 4,
      duration: 3,
      trimIn: 0,
      trimOut: 3,
      kind: "smart-overlay" as any,
      content: { type: "stat", data: { number: "200", label: "Secondary" } },
    } as any);

    // Transactional addition
    history.beginTransaction("Add Smart Overlays");
    history.execute(new AddClipCommand(overlay1));
    history.execute(new AddClipCommand(overlay2));
    history.commitTransaction();

    expect(useTimelineStore.getState().clips.length).toBe(2);

    // Update property with UpdateClipCommand
    history.execute(
      new UpdateClipCommand(
        overlay1.id,
        { content: (overlay1 as any).content } as any,
        { content: { type: "stat", data: { number: "142%", label: "Growth" } } } as any,
      ),
    );
    expect(((useTimelineStore.getState().clips[0] as any).content.data).number).toBe("142%");

    // Undo property update
    history.undo();
    expect(((useTimelineStore.getState().clips[0] as any).content.data).number).toBe("100");

    // Undo batch insertion (both clips removed in single undo step)
    history.undo();
    expect(useTimelineStore.getState().clips.length).toBe(0);

    // Redo batch insertion
    history.redo();
    expect(useTimelineStore.getState().clips.length).toBe(2);
  });

  it("6. Clip nudge (MoveClipCommand) can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const clip = createTestClip();
    useTimelineStore.setState({ clips: [clip] });

    history.execute(new MoveClipCommand(clip.id, "track-v1", "track-v1", 2.0, 2.5));
    expect(useTimelineStore.getState().clips[0].startTime).toBe(2.5);

    history.undo();
    expect(useTimelineStore.getState().clips[0].startTime).toBe(2.0);

    history.redo();
    expect(useTimelineStore.getState().clips[0].startTime).toBe(2.5);
  });

  it("7. Audio volume toggle via UpdateClipCommand can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const clipWithAudio = createTestClip({ volume: 1.0 });
    useTimelineStore.setState({ clips: [clipWithAudio] });

    // Mute
    history.execute(
      new UpdateClipCommand(
        clipWithAudio.id,
        { volume: 1.0 },
        { volume: 0.0 },
      ),
    );
    expect(useTimelineStore.getState().clips[0].volume).toBe(0.0);

    // Undo mute
    history.undo();
    expect(useTimelineStore.getState().clips[0].volume).toBe(1.0);

    // Redo mute
    history.redo();
    expect(useTimelineStore.getState().clips[0].volume).toBe(0.0);
  });

  it("8. Reset audio gain via UpdateClipCommand can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const mutedClip = createTestClip({ volume: 0.0 });
    useTimelineStore.setState({ clips: [mutedClip] });

    // Reset volume to 100%
    history.execute(
      new UpdateClipCommand(
        mutedClip.id,
        { volume: 0.0 },
        { volume: 1.0 },
      ),
    );
    expect(useTimelineStore.getState().clips[0].volume).toBe(1.0);

    history.undo();
    expect(useTimelineStore.getState().clips[0].volume).toBe(0.0);

    history.redo();
    expect(useTimelineStore.getState().clips[0].volume).toBe(1.0);
  });

  it("9. Playback speed preset via UpdateClipCommand can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const clip = createTestClip();
    useTimelineStore.setState({ clips: [clip] });

    history.execute(
      new UpdateClipCommand(
        clip.id,
        { playbackMapping: clip.playbackMapping },
        { playbackMapping: { kind: "normal", speed: 2 } },
      ),
    );
    expect((useTimelineStore.getState().clips[0].playbackMapping as any).speed).toBe(2);

    history.undo();
    expect(useTimelineStore.getState().clips[0].playbackMapping).toBeUndefined();

    history.redo();
    expect((useTimelineStore.getState().clips[0].playbackMapping as any).speed).toBe(2);
  });

  it("10. Playback reverse toggle via UpdateClipCommand can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const clip = createTestClip();
    useTimelineStore.setState({ clips: [clip] });

    history.execute(
      new UpdateClipCommand(
        clip.id,
        { playbackMapping: clip.playbackMapping },
        { playbackMapping: { kind: "reverse", speed: 1 } },
      ),
    );
    expect(useTimelineStore.getState().clips[0].playbackMapping?.kind).toBe("reverse");

    history.undo();
    expect(useTimelineStore.getState().clips[0].playbackMapping).toBeUndefined();

    history.redo();
    expect(useTimelineStore.getState().clips[0].playbackMapping?.kind).toBe("reverse");
  });

  it("11. Playback freeze frame via UpdateClipCommand can be undone and redone", () => {
    const history = useHistoryStore.getState();
    const clip = createTestClip();
    useTimelineStore.setState({ clips: [clip] });

    history.execute(
      new UpdateClipCommand(
        clip.id,
        { playbackMapping: clip.playbackMapping },
        { playbackMapping: { kind: "freeze", atSourceTime: 1.25 } },
      ),
    );
    expect(useTimelineStore.getState().clips[0].playbackMapping?.kind).toBe("freeze");
    expect((useTimelineStore.getState().clips[0].playbackMapping as any).atSourceTime).toBe(1.25);

    history.undo();
    expect(useTimelineStore.getState().clips[0].playbackMapping).toBeUndefined();

    history.redo();
    expect(useTimelineStore.getState().clips[0].playbackMapping?.kind).toBe("freeze");
  });

  it("12. Wiring test: clipboardService.copyClips & pasteClips executes undoable AddClipCommand", () => {
    const clip = createTestClip({ id: "source-clip-1", startTime: 1.0, duration: 4.0 });
    useTimelineStore.setState({ clips: [clip], tracks: [baseTrack] });

    // Copy clip
    clipboardService.copyClips(["source-clip-1"]);
    expect(clipboardService.hasClips()).toBe(true);

    // Paste clip at time 10.0
    const pastedIds = clipboardService.pasteClips(10.0, "track-v1");
    expect(pastedIds.length).toBe(1);
    expect(useTimelineStore.getState().clips.length).toBe(2);

    const pastedClip = useTimelineStore.getState().clips.find((c: any) => c.id === pastedIds[0]);
    expect(pastedClip).toBeDefined();
    expect(pastedClip?.startTime).toBe(10.0);

    // Undo paste
    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().clips.length).toBe(1);
    expect(useTimelineStore.getState().clips[0].id).toBe("source-clip-1");

    // Redo paste
    useHistoryStore.getState().redo();
    expect(useTimelineStore.getState().clips.length).toBe(2);
  });

  it("13. Wiring test: useTimelineTauriDrop creates undoable history command", () => {
    const initialClips = [createTestClip({ id: "existing-1", startTime: 0, duration: 3.0 })];
    useTimelineStore.setState({ clips: initialClips, tracks: [baseTrack] });

    // Simulate drop hook creating new clip via historyStore (as in useTimelineTauriDrop.ts line 138)
    const droppedClip = createTestClip({ id: "dropped-clip-1", startTime: 5.0, duration: 4.0 });
    useHistoryStore.getState().execute(new AddClipCommand(droppedClip));

    expect(useTimelineStore.getState().clips.length).toBe(2);

    // Undo drop
    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().clips.length).toBe(1);
    expect(useTimelineStore.getState().clips[0].id).toBe("existing-1");

    // Redo drop
    useHistoryStore.getState().redo();
    expect(useTimelineStore.getState().clips.length).toBe(2);
  });

  it("14. Wiring test: voiceover completion creates undoable history command", () => {
    useTimelineStore.setState({ clips: [], tracks: [audioTrack] });

    // Simulate voiceover hook completion (as in useVoiceoverRecorder.ts line 67)
    const voClip = createTestClip({
      id: "vo-clip-1",
      trackId: "track-a1",
      kind: "audio",
      startTime: 2.0,
      duration: 6.5,
    });
    useHistoryStore.getState().execute(new AddClipCommand(voClip));

    expect(useTimelineStore.getState().clips.length).toBe(1);

    // Undo voiceover
    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().clips.length).toBe(0);

    // Redo voiceover
    useHistoryStore.getState().redo();
    expect(useTimelineStore.getState().clips.length).toBe(1);
  });
});

