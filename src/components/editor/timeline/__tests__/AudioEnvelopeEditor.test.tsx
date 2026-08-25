import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import type { Clip } from "@/types";
import { AudioEnvelopeEditor } from "../AudioEnvelopeEditor";

const mocks = vi.hoisted(() => ({
  updateClip: vi.fn(),
  addAudioKeyframe: vi.fn(),
  removeAudioKeyframe: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/store/timelineStore", () => ({
  useTimelineStore: (selector: (state: typeof mocks) => unknown) =>
    selector(mocks),
}));

vi.mock("@/store/historyStore", () => ({
  useHistoryStore: () => ({ execute: mocks.execute }),
}));

const createClip = (volume = 1, fades: Partial<Pick<Clip, "fadeIn" | "fadeOut">> = {}): Clip =>
  ({
    id: "clip-1",
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    volume,
    ...fades,
  }) as Clip;

const setRect = (element: HTMLElement, rect: { width: number; height: number }) => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: rect.width,
      bottom: rect.height,
      width: rect.width,
      height: rect.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
};

const prepareSlider = (volume = 1) => {
  render(
    <AudioEnvelopeEditor
      clip={createClip(volume)}
      clipWidthPx={400}
      pixelsPerSecond={40}
    />,
  );

  const slider = screen.getByRole("slider", { name: "Clip volume" });
  const lane = slider.parentElement;
  const container = lane?.parentElement;
  if (!lane || !container) throw new Error("Audio envelope layout was not rendered");
  setRect(container, { width: 400, height: 80 });
  setRect(lane, { width: 400, height: 16 });

  Object.defineProperty(slider, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(slider, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(slider, "hasPointerCapture", {
    configurable: true,
    value: vi.fn(() => true),
  });

  return slider;
};

describe("AudioEnvelopeEditor volume interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it.each([20, 200, 380])(
    "starts a drag from any horizontal position (%ipx)",
    (clientX) => {
      const slider = prepareSlider();

      fireEvent.pointerDown(slider, { pointerId: 1, clientX, clientY: 2 });
      fireEvent.pointerMove(slider, { pointerId: 1, clientX, clientY: 8.4 });

      expect(slider).toHaveAttribute("aria-valuenow", "50");
      expect(mocks.updateClip).toHaveBeenCalledWith("clip-1", { volume: 0.5 });
    },
  );

  it("moves the visible guide with volume and follows the pointer with its tooltip", () => {
    const slider = prepareSlider();

    expect(slider.style.top).toBe("50%");

    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 100, clientY: 2 });
    const tooltip = () => screen.getByText("Vol 100%");
    expect(tooltip()).toHaveStyle({ left: "100px", top: "22px" });

    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 320, clientY: 40 });

    expect(slider.style.top).toBe("80%");
    expect(screen.getByText("Vol 0%")).toHaveStyle({ left: "320px", top: "40px" });
  });

  it("clamps the tooltip to the clip when dragged at the edges", () => {
    const slider = prepareSlider();

    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(screen.getByText("Vol 100%")).toHaveStyle({ left: "28px", top: "22px" });

    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 400, clientY: 80 });
    expect(screen.getByText("Vol 0%")).toHaveStyle({ left: "372px", top: "76px" });
  });

  it("cleans up on pointer cancellation without leaving the tooltip active", () => {
    const slider = prepareSlider();

    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 200, clientY: 2 });
    expect(screen.getByText("Vol 100%")).toBeInTheDocument();

    fireEvent.pointerCancel(slider, { pointerId: 1 });

    expect(screen.queryByText(/Vol/)).not.toBeInTheDocument();
  });

  it("cleans up when pointer capture is lost", () => {
    const slider = prepareSlider();

    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 200, clientY: 2 });
    fireEvent.lostPointerCapture(slider, { pointerId: 1 });

    expect(screen.queryByText(/Vol/)).not.toBeInTheDocument();
    expect(mocks.execute).toHaveBeenCalledTimes(0);
  });

  it("records one history command when the drag completes", () => {
    const slider = prepareSlider();

    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 200, clientY: 2 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 200, clientY: 8.4 });
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 200, clientY: 8.4 });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0]).toBeInstanceOf(TransformClipCommand);
    expect((mocks.execute.mock.calls[0][0] as any).newTransform.volume).toBe(0.5);
  });

  it("preserves a 66% to 31% adjustment after mouse-up", () => {
    const slider = prepareSlider(0.66);

    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 200, clientY: 5.92 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 200, clientY: 10.4 });
    expect(slider).toHaveAttribute("aria-valuenow", "31");

    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 200, clientY: 10.4 });

    const lastCall = mocks.execute.mock.calls[mocks.execute.mock.calls.length - 1];
    const command = lastCall?.[0] as any;
    expect(command).toBeInstanceOf(TransformClipCommand);
    expect(command.newTransform.volume).toBeCloseTo(0.31, 8);
  });

  it("resets volume through history on double-click", () => {
    const slider = prepareSlider(0.5);

    fireEvent.doubleClick(slider);

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0]).toBeInstanceOf(TransformClipCommand);
  });

  it("keeps full-height fade handles at their clip positions", () => {
    render(
      <AudioEnvelopeEditor
        clip={createClip(1, { fadeIn: 2, fadeOut: 1.5 })}
        clipWidthPx={400}
        pixelsPerSecond={40}
      />,
    );

    expect(screen.getByRole("button", { name: "Fade in handle" })).toHaveStyle({ left: "80px", top: "0px", height: "100%" });
    expect(screen.getByRole("button", { name: "Fade out handle" })).toHaveStyle({ left: "340px", top: "0px", height: "100%" });

    const fadePaths = Array.from(document.querySelectorAll("svg path"));
    expect(fadePaths.some((path) => path.getAttribute("d")?.includes(" C "))).toBe(true);
    expect(fadePaths.some((path) => path.getAttribute("fill") === "var(--clypra-clip-envelope-fill)")).toBe(true);

    cleanup();
    render(<AudioEnvelopeEditor clip={createClip()} clipWidthPx={400} pixelsPerSecond={40} />);
    expect(screen.getByRole("button", { name: "Fade in handle" })).toHaveStyle({ left: "0px", top: "0px", height: "100%" });
    expect(screen.getByRole("button", { name: "Fade out handle" })).toHaveStyle({ left: "400px", top: "0px", height: "100%" });
    expect(screen.getByTestId("audio-fade-in-handle").querySelector("span")).toHaveStyle({ top: "6%" });
    expect(screen.getByTestId("audio-fade-out-handle").querySelector("span")).toHaveStyle({ top: "6%" });
  });

  it("drags a fade-in handle horizontally and records one undoable edit", () => {
    render(
      <AudioEnvelopeEditor
        clip={createClip()}
        clipWidthPx={400}
        pixelsPerSecond={40}
      />,
    );
    const handle = screen.getByRole("button", { name: "Fade in handle" });
    const lane = handle.parentElement;
    if (!lane) throw new Error("Fade handle lane was not rendered");
    setRect(lane, { width: 400, height: 80 });
    Object.defineProperty(handle, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(handle, "releasePointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(handle, "hasPointerCapture", { configurable: true, value: vi.fn(() => true) });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120, clientY: 20 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 120, clientY: 20 });

    expect(mocks.updateClip).toHaveBeenCalledWith("clip-1", { fadeIn: 3 });
    const command = mocks.execute.mock.calls[0][0] as any;
    expect(command).toBeInstanceOf(TransformClipCommand);
    expect(command.newTransform.fadeIn).toBe(3);
  });

  it("drags a fade-out handle inward without allowing the two fades to overlap", () => {
    render(
      <AudioEnvelopeEditor
        clip={createClip(1, { fadeIn: 7 })}
        clipWidthPx={400}
        pixelsPerSecond={40}
      />,
    );
    const handle = screen.getByRole("button", { name: "Fade out handle" });
    const lane = handle.parentElement;
    if (!lane) throw new Error("Fade handle lane was not rendered");
    setRect(lane, { width: 400, height: 80 });
    Object.defineProperty(handle, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(handle, "releasePointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(handle, "hasPointerCapture", { configurable: true, value: vi.fn(() => true) });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 20 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 20 });

    expect(mocks.updateClip).toHaveBeenCalledWith("clip-1", { fadeOut: 3 });
  });
});
