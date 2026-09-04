import { describe, test, expect, beforeEach } from "vitest";
import { useTimelineDraftStore, type DraftClipDescriptor } from "../timelineDraftStore";

describe("TimelineDraftStore", () => {
  const mockClips: DraftClipDescriptor[] = [
    { id: "clip-1", trackId: "track-1", startTime: 2.0, duration: 4.0 },
    { id: "clip-2", trackId: "track-1", startTime: 6.0, duration: 3.0 },
  ];

  beforeEach(() => {
    useTimelineDraftStore.getState().cancelGesture();
  });

  test("initial state is idle", () => {
    const state = useTimelineDraftStore.getState();
    expect(state.isDrafting).toBe(false);
    expect(state.activeGesture).toBeNull();
    expect(state.draftClips).toEqual({});
  });

  test("startGesture initializes draft state", () => {
    useTimelineDraftStore.getState().startGesture("move", mockClips);
    const state = useTimelineDraftStore.getState();

    expect(state.isDrafting).toBe(true);
    expect(state.activeGesture).toBe("move");
    expect(state.draftClips["clip-1"]).toEqual(mockClips[0]);
    expect(state.draftClips["clip-2"]).toEqual(mockClips[1]);
  });

  test("updateDraft updates positions and snap guides without committing", () => {
    useTimelineDraftStore.getState().startGesture("move", mockClips);

    const updatedClip: DraftClipDescriptor = {
      id: "clip-1",
      trackId: "track-2",
      startTime: 3.5,
      duration: 4.0,
    };

    useTimelineDraftStore.getState().updateDraft(
      [updatedClip],
      { trackId: "track-2", time: 3.5 },
      [{ time: 3.5, type: "clip-start" }],
    );

    const state = useTimelineDraftStore.getState();
    expect(state.draftClips["clip-1"].trackId).toBe("track-2");
    expect(state.draftClips["clip-1"].startTime).toBe(3.5);
    expect(state.insertionTarget).toEqual({ trackId: "track-2", time: 3.5 });
    expect(state.snapGuides).toHaveLength(1);
    expect(state.isDrafting).toBe(true);
  });

  test("commitGesture returns result and resets store", () => {
    useTimelineDraftStore.getState().startGesture("trim-end", mockClips);

    const trimmedClip: DraftClipDescriptor = {
      id: "clip-1",
      trackId: "track-1",
      startTime: 2.0,
      duration: 5.5,
    };

    useTimelineDraftStore.getState().updateDraft([trimmedClip]);
    const result = useTimelineDraftStore.getState().commitGesture();

    expect(result).toBeDefined();
    expect(result?.gesture).toBe("trim-end");
    expect(result?.clips.find((c) => c.id === "clip-1")?.duration).toBe(5.5);

    const state = useTimelineDraftStore.getState();
    expect(state.isDrafting).toBe(false);
    expect(state.activeGesture).toBeNull();
  });

  test("cancelGesture discards draft changes", () => {
    useTimelineDraftStore.getState().startGesture("move", mockClips);
    useTimelineDraftStore.getState().updateDraft([{
      id: "clip-1",
      trackId: "track-99",
      startTime: 99.0,
      duration: 4.0,
    }]);

    useTimelineDraftStore.getState().cancelGesture();

    const state = useTimelineDraftStore.getState();
    expect(state.isDrafting).toBe(false);
    expect(state.activeGesture).toBeNull();
    expect(state.draftClips).toEqual({});
  });
});
