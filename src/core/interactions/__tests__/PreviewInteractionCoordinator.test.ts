import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PreviewInteractionCoordinator,
  resetPreviewInteractionCoordinator,
} from "../PreviewInteractionCoordinator";

describe("PreviewInteractionCoordinator", () => {
  beforeEach(() => resetPreviewInteractionCoordinator());

  function setup(state: "playing" | "paused" = "paused") {
    let current = state;
    const pause = vi.fn(() => {
      current = "paused";
    });
    const play = vi.fn(() => {
      current = "playing";
    });
    const coordinator = new PreviewInteractionCoordinator();
    coordinator.registerTransport({
      getState: () => current,
      pause,
      play,
    });
    return { coordinator, pause, play };
  }

  it("pauses and resumes one content interaction around its commit", () => {
    const { coordinator, pause, play } = setup("playing");
    const token = coordinator.begin("transform");

    expect(pause).toHaveBeenCalledOnce();
    expect(coordinator.isCurrent(token)).toBe(true);

    coordinator.commit(token);
    expect(play).toHaveBeenCalledOnce();
    expect(coordinator.getSnapshot().active).toBeNull();
  });

  it("keeps only one active interaction and does not resume between conflicts", () => {
    const { coordinator, pause, play } = setup("playing");
    const first = coordinator.begin("transform");
    const second = coordinator.begin("scrub");

    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();

    coordinator.cancel(second);
    expect(play).toHaveBeenCalledOnce();
  });

  it("invalidates stale work without confusing it with an interaction", () => {
    const { coordinator } = setup();
    const before = coordinator.getGeneration().revision;
    coordinator.invalidate();
    expect(coordinator.getGeneration().revision).toBeGreaterThan(before);
    expect(coordinator.getSnapshot().active).toBeNull();
  });

  it("does not resume when a project reset cancels a paused interaction", () => {
    const { coordinator, play } = setup("playing");
    const token = coordinator.begin("clip-trim");
    coordinator.cancel(token, "project-reset");
    expect(play).not.toHaveBeenCalled();
  });

  it("pauses and invalidates playback when a blocking modal opens", () => {
    const { coordinator, pause, play } = setup("playing");
    const before = coordinator.getGeneration().revision;

    coordinator.requestPause();

    expect(pause).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
    expect(coordinator.getGeneration().revision).toBeGreaterThan(before);
    expect(coordinator.getSnapshot().active).toBeNull();
  });

  it("does not resume playback when the blocking modal closes", () => {
    const { coordinator, pause, play } = setup("paused");

    coordinator.requestPause();

    expect(pause).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("can commit a property edit without resuming playback", () => {
    const { coordinator, pause, play } = setup("playing");
    const token = coordinator.begin("property-edit");

    expect(pause).toHaveBeenCalledOnce();
    coordinator.commit(token, false);

    expect(play).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot().active).toBeNull();
  });
});
