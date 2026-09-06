import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isProtectedInteractiveElement,
  shouldClearSelectionOnPointerDown,
} from "../selectionCoordinator";
import { useUIStore } from "@/store/uiStore";

describe("selectionCoordinator", () => {
  beforeEach(() => {
    useUIStore.setState({
      selectedClipIds: ["clip-1"],
      selectedTrackId: null,
      selectedGapId: null,
      selectedTransitionId: null,
    });
  });

  describe("isProtectedInteractiveElement", () => {
    it("protects transform handle elements", () => {
      const container = document.createElement("div");
      container.setAttribute("data-transform-handle", "nw");
      const inner = document.createElement("span");
      container.appendChild(inner);

      expect(isProtectedInteractiveElement(inner)).toBe(true);
      expect(isProtectedInteractiveElement(container)).toBe(true);
    });

    it("protects transform overlay elements", () => {
      const overlay = document.createElement("div");
      overlay.setAttribute("data-transform-overlay", "true");
      const inner = document.createElement("div");
      overlay.appendChild(inner);

      expect(isProtectedInteractiveElement(inner)).toBe(true);
      expect(isProtectedInteractiveElement(overlay)).toBe(true);
    });

    it("protects program preview viewport canvas region (delegates to canvas hit tester)", () => {
      const viewport = document.createElement("div");
      viewport.setAttribute("data-testid", "program-preview-viewport");
      const canvas = document.createElement("canvas");
      viewport.appendChild(canvas);

      expect(isProtectedInteractiveElement(canvas)).toBe(true);
      expect(isProtectedInteractiveElement(viewport)).toBe(true);
    });

    it("protects properties panel and its child controls", () => {
      const panel = document.createElement("div");
      panel.setAttribute("data-properties-panel", "true");
      const input = document.createElement("input");
      const label = document.createElement("label");
      const emptyDiv = document.createElement("div");
      panel.appendChild(input);
      panel.appendChild(label);
      panel.appendChild(emptyDiv);

      expect(isProtectedInteractiveElement(input)).toBe(true);
      expect(isProtectedInteractiveElement(label)).toBe(true);
      expect(isProtectedInteractiveElement(emptyDiv)).toBe(true);
      expect(isProtectedInteractiveElement(panel)).toBe(true);
    });

    it("protects interactive form controls", () => {
      expect(isProtectedInteractiveElement(document.createElement("button"))).toBe(true);
      expect(isProtectedInteractiveElement(document.createElement("input"))).toBe(true);
      expect(isProtectedInteractiveElement(document.createElement("textarea"))).toBe(true);
      expect(isProtectedInteractiveElement(document.createElement("select"))).toBe(true);
      expect(isProtectedInteractiveElement(document.createElement("a"))).toBe(true);
    });

    it("protects timeline clips and interactive timeline items", () => {
      const clip = document.createElement("div");
      clip.setAttribute("data-clip-id", "clip-123");
      expect(isProtectedInteractiveElement(clip)).toBe(true);

      const timelineInteractive = document.createElement("div");
      timelineInteractive.setAttribute("data-timeline-interactive", "true");
      expect(isProtectedInteractiveElement(timelineInteractive)).toBe(true);

      const playhead = document.createElement("div");
      playhead.setAttribute("data-playhead", "true");
      expect(isProtectedInteractiveElement(playhead)).toBe(true);
    });

    it("protects color pickers and Radix portals", () => {
      const colorPicker = document.createElement("div");
      colorPicker.className = "clypra-color-picker";
      expect(isProtectedInteractiveElement(colorPicker)).toBe(true);

      const radixPopper = document.createElement("div");
      radixPopper.setAttribute("data-radix-popper-content-wrapper", "");
      expect(isProtectedInteractiveElement(radixPopper)).toBe(true);
    });

    it("protects panel resizers / splitters", () => {
      const resizer = document.createElement("div");
      resizer.className = "resizer-horizontal";
      expect(isProtectedInteractiveElement(resizer)).toBe(true);
    });

    it("identifies neutral editor elements as NOT protected (eligible for deselection)", () => {
      const neutralDiv = document.createElement("div");
      const body = document.body;
      const sidebarBackground = document.createElement("div");
      sidebarBackground.className = "panel-shell";
      const letterboxPadding = document.createElement("div");
      letterboxPadding.className = "preview-letterbox";

      expect(isProtectedInteractiveElement(neutralDiv)).toBe(false);
      expect(isProtectedInteractiveElement(body)).toBe(false);
      expect(isProtectedInteractiveElement(sidebarBackground)).toBe(false);
      expect(isProtectedInteractiveElement(letterboxPadding)).toBe(false);
    });
  });

  describe("shouldClearSelectionOnPointerDown", () => {
    it("returns false for secondary mouse clicks (e.g. right click)", () => {
      const neutralDiv = document.createElement("div");
      expect(shouldClearSelectionOnPointerDown(neutralDiv, 2)).toBe(false);
    });

    it("returns false when there is no active selection", () => {
      useUIStore.setState({
        selectedClipIds: [],
        selectedTrackId: null,
        selectedGapId: null,
        selectedTransitionId: null,
      });
      const neutralDiv = document.createElement("div");
      expect(shouldClearSelectionOnPointerDown(neutralDiv, 0)).toBe(false);
    });

    it("returns true on primary click on neutral space when selection exists", () => {
      const neutralDiv = document.createElement("div");
      expect(shouldClearSelectionOnPointerDown(neutralDiv, 0)).toBe(true);
    });

    it("returns false on primary click on protected element even when selection exists", () => {
      const button = document.createElement("button");
      expect(shouldClearSelectionOnPointerDown(button, 0)).toBe(false);
    });
  });
});
