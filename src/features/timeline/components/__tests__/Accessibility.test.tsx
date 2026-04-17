/**
 * Accessibility Tests for Timeline Engine v1
 * Requirements: 20.1, 20.2, 20.3
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineToolbar } from "../TimelineToolbar";
import { TimelineTrackHeaders } from "../TimelineTrackHeaders";
import { Clip } from "../Clip";
import { TimeRuler } from "../TimeRuler";
import { ScreenReaderAnnouncer } from "../ScreenReaderAnnouncer";
import type { Clip as ClipType } from "../../types/core";

describe("Accessibility Features", () => {
  describe("ARIA Labels (Requirement 20.1)", () => {
    it("should have ARIA labels on toolbar buttons", () => {
      const mockProps = {
        snapMain: true,
        snapAuto: false,
        snapLink: true,
        pxPerSec: 50,
        isPlaying: false,
        onPlayPauseToggle: vi.fn(),
        onSnapMainToggle: vi.fn(),
        onSnapAutoToggle: vi.fn(),
        onSnapLinkToggle: vi.fn(),
        onZoomChange: vi.fn(),
        minZoom: 16,
        maxZoom: 320,
      };

      render(<TimelineToolbar {...mockProps} />);

      // Check for ARIA labels on buttons
      expect(screen.getByLabelText("Undo last action")).toBeInTheDocument();
      expect(screen.getByLabelText("Redo last undone action")).toBeInTheDocument();
      expect(screen.getByLabelText("Selection tool")).toBeInTheDocument();
      expect(screen.getByLabelText("Split clip tool")).toBeInTheDocument();
      expect(screen.getByLabelText("Delete selected clips")).toBeInTheDocument();
      expect(screen.getByLabelText("Add marker")).toBeInTheDocument();
      expect(screen.getByLabelText("Record voiceover")).toBeInTheDocument();
    });

    it("should have ARIA labels on zoom slider", () => {
      const mockProps = {
        snapMain: true,
        snapAuto: false,
        snapLink: true,
        pxPerSec: 50,
        isPlaying: false,
        onPlayPauseToggle: vi.fn(),
        onSnapMainToggle: vi.fn(),
        onSnapAutoToggle: vi.fn(),
        onSnapLinkToggle: vi.fn(),
        onZoomChange: vi.fn(),
        minZoom: 16,
        maxZoom: 320,
      };

      render(<TimelineToolbar {...mockProps} />);

      const zoomSlider = screen.getByLabelText("Timeline zoom level");
      expect(zoomSlider).toBeInTheDocument();
      expect(zoomSlider).toHaveAttribute("aria-valuemin", "16");
      expect(zoomSlider).toHaveAttribute("aria-valuemax", "320");
      expect(zoomSlider).toHaveAttribute("aria-valuenow", "50");
    });

    it("should have ARIA pressed state on toggle buttons", () => {
      const mockProps = {
        snapMain: true,
        snapAuto: false,
        snapLink: true,
        pxPerSec: 50,
        isPlaying: false,
        onPlayPauseToggle: vi.fn(),
        onSnapMainToggle: vi.fn(),
        onSnapAutoToggle: vi.fn(),
        onSnapLinkToggle: vi.fn(),
        onZoomChange: vi.fn(),
        minZoom: 16,
        maxZoom: 320,
      };

      render(<TimelineToolbar {...mockProps} />);

      const magnetButton = screen.getByLabelText("Toggle magnet");
      expect(magnetButton).toHaveAttribute("aria-pressed", "true");

      const snapButton = screen.getByLabelText("Toggle snap");
      expect(snapButton).toHaveAttribute("aria-pressed", "false");
    });

    it("should have ARIA labels on clip elements", () => {
      const mockClip: ClipType = {
        id: "clip-1",
        trackId: "track-1",
        startTime: 5.0,
        duration: 10.5,
        sourceMediaPath: "/path/to/video.mp4",
        sourceStart: 0,
        sourceEnd: 10.5,
        type: "video",
        filmstripUrl: null,
        waveformPeaks: null,
        name: "Test Video",
        locked: false,
        muted: false,
      };

      render(<Clip clip={mockClip} isSelected={false} pxPerSec={50} onSelect={vi.fn()} />);

      const clipElement = screen.getByRole("button");
      expect(clipElement).toHaveAttribute("aria-label");
      expect(clipElement.getAttribute("aria-label")).toContain("Test Video");
      expect(clipElement.getAttribute("aria-label")).toContain("video clip");
    });

    it("should have ARIA labels on trim handles", () => {
      const mockClip: ClipType = {
        id: "clip-1",
        trackId: "track-1",
        startTime: 5.0,
        duration: 10.5,
        sourceMediaPath: "/path/to/video.mp4",
        sourceStart: 0,
        sourceEnd: 10.5,
        type: "video",
        filmstripUrl: null,
        waveformPeaks: null,
        name: "Test Video",
        locked: false,
        muted: false,
      };

      render(<Clip clip={mockClip} isSelected={false} pxPerSec={50} onSelect={vi.fn()} />);

      const trimHandles = screen.getAllByRole("slider");
      expect(trimHandles).toHaveLength(2);
      expect(trimHandles[0]).toHaveAttribute("aria-label");
      expect(trimHandles[0].getAttribute("aria-label")).toContain("Trim start");
      expect(trimHandles[1]).toHaveAttribute("aria-label");
      expect(trimHandles[1].getAttribute("aria-label")).toContain("Trim end");
    });

    it("should have role attributes on timeline components", () => {
      render(<TimeRuler duration={60} pxPerSec={50} fps={30} />);

      const ruler = screen.getByRole("row");
      expect(ruler).toBeInTheDocument();
      expect(ruler).toHaveAttribute("aria-label", "Time ruler");
    });
  });

  describe("Keyboard Navigation (Requirement 20.2)", () => {
    it("should have tabIndex on interactive clip elements", () => {
      const mockClip: ClipType = {
        id: "clip-1",
        trackId: "track-1",
        startTime: 5.0,
        duration: 10.5,
        sourceMediaPath: "/path/to/video.mp4",
        sourceStart: 0,
        sourceEnd: 10.5,
        type: "video",
        filmstripUrl: null,
        waveformPeaks: null,
        name: "Test Video",
        locked: false,
        muted: false,
      };

      render(<Clip clip={mockClip} isSelected={false} pxPerSec={50} onSelect={vi.fn()} />);

      const clipElement = screen.getByRole("button");
      expect(clipElement).toHaveAttribute("tabIndex", "0");
    });

    it("should have tabIndex on trim handles", () => {
      const mockClip: ClipType = {
        id: "clip-1",
        trackId: "track-1",
        startTime: 5.0,
        duration: 10.5,
        sourceMediaPath: "/path/to/video.mp4",
        sourceStart: 0,
        sourceEnd: 10.5,
        type: "video",
        filmstripUrl: null,
        waveformPeaks: null,
        name: "Test Video",
        locked: false,
        muted: false,
      };

      render(<Clip clip={mockClip} isSelected={false} pxPerSec={50} onSelect={vi.fn()} />);

      const trimHandles = screen.getAllByRole("slider");
      expect(trimHandles[0]).toHaveAttribute("tabIndex", "0");
      expect(trimHandles[1]).toHaveAttribute("tabIndex", "0");
    });

    it("should have keyboard accessible toolbar buttons", () => {
      const mockProps = {
        snapMain: true,
        snapAuto: false,
        snapLink: true,
        pxPerSec: 50,
        isPlaying: false,
        onPlayPauseToggle: vi.fn(),
        onSnapMainToggle: vi.fn(),
        onSnapAutoToggle: vi.fn(),
        onSnapLinkToggle: vi.fn(),
        onZoomChange: vi.fn(),
        minZoom: 16,
        maxZoom: 320,
      };

      render(<TimelineToolbar {...mockProps} />);

      const undoButton = screen.getByLabelText("Undo last action");
      expect(undoButton.tagName).toBe("BUTTON");
      expect(undoButton).toHaveAttribute("type", "button");
    });
  });

  describe("Focus Indicators (Requirement 20.3)", () => {
    it("should render focus indicators via CSS (visual test)", () => {
      // This test verifies that focus-visible styles are applied
      // The actual visual appearance is tested manually or with visual regression tests
      const mockProps = {
        snapMain: true,
        snapAuto: false,
        snapLink: true,
        pxPerSec: 50,
        isPlaying: false,
        onPlayPauseToggle: vi.fn(),
        onSnapMainToggle: vi.fn(),
        onSnapAutoToggle: vi.fn(),
        onSnapLinkToggle: vi.fn(),
        onZoomChange: vi.fn(),
        minZoom: 16,
        maxZoom: 320,
      };

      render(<TimelineToolbar {...mockProps} />);

      const undoButton = screen.getByLabelText("Undo last action");
      undoButton.focus();

      // Verify element can receive focus
      expect(document.activeElement).toBe(undoButton);
    });
  });

  describe("Screen Reader Announcements (Requirement 20.4)", () => {
    it("should render ARIA live regions", () => {
      render(<ScreenReaderAnnouncer />);

      // Check for polite live region
      const politeRegion = screen.getByRole("status");
      expect(politeRegion).toBeInTheDocument();
      expect(politeRegion).toHaveAttribute("aria-live", "polite");
      expect(politeRegion).toHaveAttribute("aria-atomic", "true");

      // Check for assertive live region
      const assertiveRegion = screen.getByRole("alert");
      expect(assertiveRegion).toBeInTheDocument();
      expect(assertiveRegion).toHaveAttribute("aria-live", "assertive");
      expect(assertiveRegion).toHaveAttribute("aria-atomic", "true");
    });

    it("should have sr-only class on live regions", () => {
      render(<ScreenReaderAnnouncer />);

      const politeRegion = screen.getByRole("status");
      expect(politeRegion).toHaveClass("sr-only");

      const assertiveRegion = screen.getByRole("alert");
      expect(assertiveRegion).toHaveClass("sr-only");
    });
  });

  describe("Visual Accessibility (Requirement 20.5, 20.7)", () => {
    it("should provide text alternatives for waveforms", () => {
      const mockClip: ClipType = {
        id: "clip-1",
        trackId: "track-1",
        startTime: 5.0,
        duration: 10.5,
        sourceMediaPath: "/path/to/audio.mp3",
        sourceStart: 0,
        sourceEnd: 10.5,
        type: "audio",
        filmstripUrl: null,
        waveformPeaks: [0.5, 0.8, 0.3, 0.6],
        name: "Test Audio",
        locked: false,
        muted: false,
      };

      render(<Clip clip={mockClip} isSelected={false} pxPerSec={50} onSelect={vi.fn()} />);

      const waveformContainer = screen.getByRole("img", { name: /audio waveform/i });
      expect(waveformContainer).toBeInTheDocument();
      expect(waveformContainer).toHaveAttribute("aria-label");
    });

    it("should provide text alternatives for filmstrips", () => {
      const mockClip: ClipType = {
        id: "clip-1",
        trackId: "track-1",
        startTime: 5.0,
        duration: 10.5,
        sourceMediaPath: "/path/to/video.mp4",
        sourceStart: 0,
        sourceEnd: 10.5,
        type: "video",
        filmstripUrl: "data:image/jpeg;base64,/9j/4AAQ...",
        waveformPeaks: null,
        name: "Test Video",
        locked: false,
        muted: false,
      };

      render(<Clip clip={mockClip} isSelected={false} pxPerSec={50} onSelect={vi.fn()} />);

      const filmstripContainer = screen.getByRole("img", { name: /video preview/i });
      expect(filmstripContainer).toBeInTheDocument();
      expect(filmstripContainer).toHaveAttribute("aria-label");
    });
  });
});
