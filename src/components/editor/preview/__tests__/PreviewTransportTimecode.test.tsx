import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewTransport } from "../PreviewTransport";

describe("PreviewTransport - Interactive Jump to Timecode", () => {
  const defaultProps = {
    currentTime: 10.0,
    duration: 60.0,
    isPlaying: false,
    onPlayPause: vi.fn(),
    onSeek: vi.fn(),
    formatTime: (sec: number) => `00:${String(Math.floor(sec)).padStart(2, "0")}`,
    frameRate: 30,
  };

  it("displays current timecode and duration", () => {
    render(<PreviewTransport {...defaultProps} />);
    expect(screen.getByText("00:10")).toBeDefined();
    expect(screen.getByText("00:60")).toBeDefined();
  });

  it("switches to text input when clicking on the current timecode", () => {
    render(<PreviewTransport {...defaultProps} />);
    const timecodeElem = screen.getByText("00:10");
    fireEvent.click(timecodeElem);

    const input = screen.getByPlaceholderText("00:10");
    expect(input).toBeDefined();
  });

  it("submits relative timecode jump on Enter (+15 frames)", () => {
    const onSeek = vi.fn();
    render(<PreviewTransport {...defaultProps} onSeek={onSeek} />);

    fireEvent.click(screen.getByText("00:10"));
    const input = screen.getByPlaceholderText("00:10");

    fireEvent.change(input, { target: { value: "+15" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // 10.0 + 15/30 = 10.5s
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(10.5);
    // Exits edit mode
    expect(screen.queryByPlaceholderText("00:10")).toBeNull();
  });

  it("submits absolute timecode jump on Enter", () => {
    const onSeek = vi.fn();
    render(<PreviewTransport {...defaultProps} onSeek={onSeek} />);

    fireEvent.click(screen.getByText("00:10"));
    const input = screen.getByPlaceholderText("00:10");

    fireEvent.change(input, { target: { value: "00:00:25:00" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(25);
  });

  it("cancels timecode edit without seeking when pressing Escape", () => {
    const onSeek = vi.fn();
    render(<PreviewTransport {...defaultProps} onSeek={onSeek} />);

    fireEvent.click(screen.getByText("00:10"));
    const input = screen.getByPlaceholderText("00:10");

    fireEvent.change(input, { target: { value: "+999" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("00:10")).toBeNull();
  });
});
