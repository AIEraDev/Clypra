import { describe, expect, it, vi } from "vitest";
import {
  FilmstripDemandController,
  type FilmstripDemand,
} from "../FilmstripDemandController";
import { filmstripTelemetry } from "../../filmstrip/filmstripTelemetry";

const demand = (clipId: string, pixelsPerSecond: number): FilmstripDemand => ({
  clipId,
  videoPath: "/test.mp4",
  trimIn: 0,
  trimOut: 10,
  duration: 10,
  clipStartTime: 0,
  clipWidthPx: pixelsPerSecond * 10,
  viewportScrollLeft: 0,
  viewportWidth: 1000,
  pixelsPerSecond,
});

describe("FilmstripDemandController", () => {
  it("publishes retained tiles during interaction and dispatches only the latest settled demand", async () => {
    vi.useFakeTimers();
    let interacting = true;
    const publishRetained = vi.fn();
    const dispatch = vi.fn();
    const controller = new FilmstripDemandController({
      isInteractionActive: () => interacting,
      publishRetained,
      dispatch,
    });

    controller.submit(demand("clip-1", 30));
    controller.submit(demand("clip-1", 45));
    controller.submit(demand("clip-1", 60));

    expect(publishRetained).toHaveBeenCalledTimes(3);
    expect(dispatch).not.toHaveBeenCalled();

    interacting = false;
    await vi.advanceTimersByTimeAsync(80);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        clipId: "clip-1",
        pixelsPerSecond: 60,
        requestCause: "zoom",
      }),
    );
    controller.dispose();
    vi.useRealTimers();
  });

  it("cancels a deferred demand when its clip is removed", async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const controller = new FilmstripDemandController({
      isInteractionActive: () => true,
      publishRetained: vi.fn(),
      dispatch,
    });

    controller.submit(demand("clip-1", 30));
    controller.cancel("clip-1");
    await vi.advanceTimersByTimeAsync(500);

    expect(dispatch).not.toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });

  it("does not redispatch an unchanged settled viewport that is already covered by fallbacks", () => {
    filmstripTelemetry.clear();
    const dispatch = vi.fn();
    const controller = new FilmstripDemandController({
      isInteractionActive: () => false,
      publishRetained: vi.fn(),
      dispatch,
    });

    controller.submit(demand("clip-1", 60));
    controller.submit(demand("clip-1", 60));
    expect(dispatch).toHaveBeenCalledTimes(1);

    controller.submit(demand("clip-1", 61));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(filmstripTelemetry.getSummary().duplicateDemandsSuppressed).toBe(1);
    controller.dispose();
  });

  it("does not turn a changing playhead into a new filmstrip decode demand", () => {
    const dispatch = vi.fn();
    const controller = new FilmstripDemandController({
      isInteractionActive: () => false,
      publishRetained: vi.fn(),
      dispatch,
    });

    controller.submit({ ...demand("clip-1", 60), playheadTime: 1 });
    controller.submit({ ...demand("clip-1", 60), playheadTime: 7 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("permits the next external settled demand after preview interrupts extraction", () => {
    const dispatch = vi.fn();
    const controller = new FilmstripDemandController({
      isInteractionActive: () => false,
      publishRetained: vi.fn(),
      dispatch,
    });

    controller.submit(demand("clip-1", 60));
    controller.forgetDispatchedDemand("clip-1");
    controller.submit(demand("clip-1", 60));

    expect(dispatch).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
