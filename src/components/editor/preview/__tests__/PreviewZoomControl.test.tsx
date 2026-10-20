import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getViewportController,
  resetViewportController,
} from "@/core/interactions";
import { PreviewZoomControl } from "../PreviewZoomControl";

describe("PreviewZoomControl", () => {
  beforeEach(() => resetViewportController());
  afterEach(() => resetViewportController());

  it("CLY-PREVIEW-047: changes only the preview viewport and can restore fit", () => {
    render(<PreviewZoomControl />);

    fireEvent.click(screen.getByRole("button", { name: "Preview zoom" }));
    fireEvent.change(screen.getByRole("slider", { name: "Preview zoom level" }), {
      target: { value: "2" },
    });

    expect(getViewportController().getViewport()).toEqual({
      zoom: 2,
      panX: 0,
      panY: 0,
    });

    fireEvent.click(screen.getByRole("button", { name: "Fit preview" }));
    expect(getViewportController().getViewport()).toEqual({
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  });

  it("closes with Escape without changing the viewport", () => {
    render(<PreviewZoomControl />);
    fireEvent.click(screen.getByRole("button", { name: "Preview zoom" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("slider")).toBeNull();
    expect(getViewportController().getViewport().zoom).toBe(1);
  });
});
