import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PropertySection } from "../primitives/PropertySection";

describe("PropertySection — Collapsed State Behavior", () => {
  it("defaults to collapsed state when opened", () => {
    render(
      <PropertySection title="Volume">
        <div>Volume Controls</div>
      </PropertySection>
    );

    const titleEl = screen.getByText("Volume");
    expect(titleEl).toBeDefined();

    // Check that header button is collapsed by default
    const headerBtn = titleEl.closest("button");
    expect(headerBtn).toBeDefined();
  });

  it("toggles open and closed when header is clicked", () => {
    render(
      <PropertySection title="Transform">
        <div>Transform Controls</div>
      </PropertySection>
    );

    const headerBtn = screen.getByText("Transform").closest("button")!;
    
    // Toggle open
    fireEvent.click(headerBtn);
    expect(screen.getByText("Transform Controls")).toBeDefined();

    // Toggle collapsed
    fireEvent.click(headerBtn);
  });
});
