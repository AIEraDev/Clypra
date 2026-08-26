import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PropertiesPanel } from "../PropertiesPanel";
import { EmptyPropertiesState } from "../properties/EmptyPropertiesState";

describe("PropertiesPanel collapse and expand behavior", () => {
  it("renders collapse button when expanded and triggers onToggleCollapse", () => {
    const onToggleCollapse = vi.fn();
    render(
      <EmptyPropertiesState
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
      />,
    );

    const collapseButton = screen.getByTitle("Collapse properties panel");
    expect(collapseButton).toBeDefined();
    fireEvent.click(collapseButton);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("renders expand button and 44px rail when collapsed and triggers onToggleCollapse", () => {
    const onToggleCollapse = vi.fn();
    const { container } = render(
      <EmptyPropertiesState
        collapsed={true}
        onToggleCollapse={onToggleCollapse}
      />,
    );

    const panelDiv = container.firstChild as HTMLElement;
    expect(panelDiv.style.width).toBe("44px");

    const expandButton = screen.getByTitle("Expand properties panel");
    expect(expandButton).toBeDefined();
    fireEvent.click(expandButton);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);

    const shortcutButton = screen.getByTitle("Expand Canvas & Background Settings");
    expect(shortcutButton).toBeDefined();
    fireEvent.click(shortcutButton);
    expect(onToggleCollapse).toHaveBeenCalledTimes(2);
  });

  it("renders PropertiesPanel collapsed state with expand button and triggers expand on click", () => {
    const onToggleCollapse = vi.fn();
    const { container } = render(
      <PropertiesPanel
        collapsed={true}
        onToggleCollapse={onToggleCollapse}
      />,
    );

    const panelDiv = container.firstChild as HTMLElement;
    expect(panelDiv.style.width).toBe("44px");

    const expandButton = screen.getByTitle("Expand properties panel");
    expect(expandButton).toBeDefined();
    fireEvent.click(expandButton);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});
