import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { Smile } from "lucide-react";
import { FeaturePlaceholder } from "../FeaturePlaceholder";

describe("FeaturePlaceholder", () => {
  it("renders title, description, and status badge", () => {
    render(
      <FeaturePlaceholder
        icon={Smile}
        title="Stickers are on the way"
        description="Add animated stickers and emojis to your clips."
        status="in-progress"
      />,
    );

    expect(screen.getByText("Stickers are on the way")).toBeDefined();
    expect(
      screen.getByText("Add animated stickers and emojis to your clips."),
    ).toBeDefined();
    expect(screen.getByText("In development")).toBeDefined();
  });

  it("renders different status labels correctly", () => {
    const { rerender } = render(
      <FeaturePlaceholder
        icon={Smile}
        title="Test"
        description="Test desc"
        status="planned"
      />,
    );
    expect(screen.getByText("Planned")).toBeDefined();

    rerender(
      <FeaturePlaceholder
        icon={Smile}
        title="Test"
        description="Test desc"
        status="beta"
      />,
    );
    expect(screen.getByText("Almost ready")).toBeDefined();
  });

  it("renders planned bullet items when provided", () => {
    render(
      <FeaturePlaceholder
        icon={Smile}
        title="Stickers"
        description="Coming soon"
        planned={[
          "Animated and static stickers",
          "Search by name",
          "Canvas rotate",
        ]}
      />,
    );

    expect(screen.getByText("Animated and static stickers")).toBeDefined();
    expect(screen.getByText("Search by name")).toBeDefined();
    expect(screen.getByText("Canvas rotate")).toBeDefined();
  });

  it("fires action onClick when action button is clicked", () => {
    const handleAction = vi.fn();
    render(
      <FeaturePlaceholder
        icon={Smile}
        title="Feature"
        description="Desc"
        action={{ label: "Follow progress", onClick: handleAction }}
      />,
    );

    const button = screen.getByRole("button", { name: "Follow progress" });
    expect(button).toBeDefined();

    fireEvent.click(button);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it("renders footer when provided", () => {
    render(
      <FeaturePlaceholder
        icon={Smile}
        title="Feature"
        description="Desc"
        footer={<span data-testid="version-note">v1.7.0 preview</span>}
      />,
    );

    expect(screen.getByTestId("version-note")).toBeDefined();
    expect(screen.getByText("v1.7.0 preview")).toBeDefined();
  });

  it("renders ghost layout for grid and list", () => {
    const { container, rerender } = render(
      <FeaturePlaceholder
        icon={Smile}
        title="Grid Feature"
        description="Grid desc"
        ghost="grid"
      />,
    );

    // Ghost grid has 9 dashed items
    const dashedBoxes = container.querySelectorAll(".border-dashed");
    expect(dashedBoxes.length).toBe(9);

    rerender(
      <FeaturePlaceholder
        icon={Smile}
        title="List Feature"
        description="List desc"
        ghost="list"
      />,
    );
    const listDashedBoxes = container.querySelectorAll(".border-dashed");
    expect(listDashedBoxes.length).toBe(5);

    rerender(
      <FeaturePlaceholder
        icon={Smile}
        title="None Feature"
        description="None desc"
        ghost="none"
      />,
    );
    const noneDashedBoxes = container.querySelectorAll(".border-dashed");
    expect(noneDashedBoxes.length).toBe(0);
  });
});
