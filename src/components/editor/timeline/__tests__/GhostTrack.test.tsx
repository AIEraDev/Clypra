import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GhostTrack } from "../GhostTrack";

vi.mock("react-dnd", () => ({
  useDrop: () => [{ isOver: true, canDrop: true }, vi.fn()],
}));

describe("GhostTrack localization", () => {
  it("renders the localized new-track label", () => {
    render(<GhostTrack insertIndex={1} isDragging />);

    expect(screen.getByText("新轨道")).toBeInTheDocument();
  });
});
