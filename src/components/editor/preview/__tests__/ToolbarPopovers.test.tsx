import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaybackSpeedSelector } from "../PlaybackSpeedSelector";
import { AspectSelector } from "../AspectSelector";
import { PlaybackQualitySelector } from "../PlaybackQualitySelector";
import { PreviewTransport } from "../PreviewTransport";

describe("Toolbar Popovers & Modals", () => {
  describe("PreviewTransport", () => {
    it("renders with high stacking priority class and unclipped controls row", () => {
      const { container } = render(
        <PreviewTransport
          currentTime={0}
          duration={10}
          isPlaying={false}
          onPlayPause={vi.fn()}
          onSeek={vi.fn()}
          formatTime={(s) => `00:${s < 10 ? "0" : ""}${s}`}
        />
      );

      const root = container.firstChild as HTMLElement;
      expect(root.className).toContain("relative");
      expect(root.className).toContain("z-30");

      // Controls row should not have overflow-hidden so popovers can project upwards
      const controlsRow = root.querySelector(".h-10");
      expect(controlsRow?.className).not.toContain("overflow-hidden");
    });
  });

  describe("PlaybackSpeedSelector", () => {
    const TestSpeedWrapper = () => {
      const [speed, setSpeed] = useState(1);
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button data-testid="outside-button">Outside</button>
          <PlaybackSpeedSelector
            playbackSpeed={speed}
            speedMenuOpen={open}
            setSpeedMenuOpen={setOpen}
            setSpeed={setSpeed}
          />
        </div>
      );
    };

    it("opens popover on click and updates speed on option select", () => {
      render(<TestSpeedWrapper />);

      const toggleButton = screen.getByTitle("Playback speed");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

      fireEvent.click(toggleButton);
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      const option2x = screen.getByText("2x");
      fireEvent.click(option2x);

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByText("2x")).toBeInTheDocument();
    });

    it("closes popover when clicking outside", () => {
      render(<TestSpeedWrapper />);

      fireEvent.click(screen.getByTitle("Playback speed"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId("outside-button"));
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("closes popover when pressing Escape", () => {
      render(<TestSpeedWrapper />);

      fireEvent.click(screen.getByTitle("Playback speed"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  describe("AspectSelector", () => {
    const TestAspectWrapper = () => {
      const [preset, setPreset] = useState<any>("16:9");
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button data-testid="outside-button">Outside</button>
          <AspectSelector
            aspectMenuOpen={open}
            setAspectMenuOpen={setOpen}
            previewAspectPreset={preset}
            selectAspectPreset={setPreset}
            canvasWidth={1920}
            canvasHeight={1080}
          />
        </div>
      );
    };

    it("opens popover on click and updates aspect ratio on select", () => {
      render(<TestAspectWrapper />);

      const toggleButton = screen.getByTitle("Preview aspect ratio");
      fireEvent.click(toggleButton);
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      const option916 = screen.getByTitle(/9:16/i);
      fireEvent.click(option916);

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByText("9:16")).toBeInTheDocument();
    });

    it("closes popover on outside click and Escape", () => {
      render(<TestAspectWrapper />);

      fireEvent.click(screen.getByTitle("Preview aspect ratio"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId("outside-button"));
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTitle("Preview aspect ratio"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  describe("PlaybackQualitySelector", () => {
    const TestQualityWrapper = () => {
      const [quality, setQuality] = useState<any>("high");
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button data-testid="outside-button">Outside</button>
          <PlaybackQualitySelector
            previewQuality={quality}
            qualityMenuOpen={open}
            setQualityMenuOpen={setOpen}
            setPreviewQuality={setQuality}
          />
        </div>
      );
    };

    it("opens popover on click and changes quality setting", () => {
      render(<TestQualityWrapper />);

      fireEvent.click(screen.getByTitle("Playback quality"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Full quality"));
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByText("full")).toBeInTheDocument();
    });

    it("closes on outside click and Escape", () => {
      render(<TestQualityWrapper />);

      fireEvent.click(screen.getByTitle("Playback quality"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId("outside-button"));
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTitle("Playback quality"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });
});
